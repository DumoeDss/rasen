import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ArchiveCommand } from '../../src/core/archive.js';
import {
  completeGeneratedArchiveIntent,
  createGeneratedArchiveConsumerArgv,
  GENERATED_ARCHIVE_COMMAND_EXAMPLES,
  type GeneratedArchiveConsumer,
} from '../../src/core/archive-consumer-invocation.js';
import type { ArchiveIntentV1 } from '../../src/core/archive-engine.js';
import { hashArchiveEvidence } from '../../src/core/archive-accounting.js';
import { createProgram } from '../../src/cli/index.js';
import { getArchiveChangeSkillTemplate } from '../../src/core/templates/workflows/archive-change.js';
import { getBulkArchiveChangeSkillTemplate } from '../../src/core/templates/workflows/bulk-archive-change.js';
import { getShipCommandSkillTemplate } from '../../src/core/templates/workflows/ship.js';
import { isolatedGitEnv } from '../helpers/store-git.js';

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  confirm: vi.fn(),
}));

const GENERATED_INTENT_COMMAND =
  GENERATED_ARCHIVE_COMMAND_EXAMPLES.intentTemplate;
const GENERATED_PLAN_COMMAND =
  GENERATED_ARCHIVE_COMMAND_EXAMPLES.savedPreview;
const GENERATED_APPLY_COMMAND =
  GENERATED_ARCHIVE_COMMAND_EXAMPLES.apply;

interface ConsumerSnapshot {
  cleaner: {
    discarded: string[];
    preserved: string[];
  };
  handoff: unknown;
  probes: unknown;
  quality: string;
  evidence: Array<{ path: string; sha256: string }>;
  shipLog: string;
  journal: {
    phase: string;
    change: string;
    ephemeraDisposed: string[];
    activePath: string;
    finalPath: string;
  };
  accounting: Record<string, unknown>;
}

describe('direct and generated archive consumers share one engine transaction', () => {
  let root: string;
  let originalCwd: string;
  let originalConsoleLog: typeof console.log;
  let originalExitCode: typeof process.exitCode;
  let originalRasenHome: string | undefined;
  let originalXdgDataHome: string | undefined;
  let probeCommit: string;

  const change = 'equivalent-consumer';

  beforeAll(async () => {
    originalCwd = process.cwd();
    originalConsoleLog = console.log;
    originalExitCode = process.exitCode;
    originalRasenHome = process.env.RASEN_HOME;
    originalXdgDataHome = process.env.XDG_DATA_HOME;

    root = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-archive-consumers-'));
    process.chdir(root);
    delete process.env.RASEN_HOME;
    process.env.XDG_DATA_HOME = path.join(root, 'xdg-data');
    await fs.mkdir(path.join(root, 'rasen', 'changes', 'archive'), {
      recursive: true,
    });
    await fs.mkdir(path.join(root, 'rasen', 'specs'), { recursive: true });
    await fs.mkdir(path.join(root, 'experiments', 'probe'), { recursive: true });
    await fs.mkdir(path.join(root, 'experiments', 'probe-two'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, 'experiments', 'probe', 'result.txt'),
      'verified probe bytes\n'
    );
    await fs.writeFile(
      path.join(root, 'experiments', 'probe-two', 'result.txt'),
      'second verified probe bytes\n'
    );

    const gitEnv = isolatedGitEnv(root);
    execFileSync('git', ['init'], { cwd: root, env: gitEnv, stdio: 'ignore' });
    execFileSync('git', ['add', 'experiments/probe', 'experiments/probe-two'], {
      cwd: root,
      env: gitEnv,
    });
    execFileSync('git', ['commit', '-m', 'test: add archive probe'], {
      cwd: root,
      env: gitEnv,
      stdio: 'ignore',
    });
    probeCommit = execFileSync(
      'git',
      ['rev-parse', '--verify', 'HEAD^{commit}'],
      { cwd: root, env: gitEnv, encoding: 'utf8' }
    ).trim();
  });

  afterAll(async () => {
    console.log = originalConsoleLog;
    process.exitCode = originalExitCode;
    process.chdir(originalCwd);
    if (originalRasenHome === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = originalRasenHome;
    if (originalXdgDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = originalXdgDataHome;
    await fs.rm(root, { recursive: true, force: true });
  });

  async function writeEquivalentFixture(writeEmbeddedIntent: boolean): Promise<void> {
    const active = path.join(root, 'rasen', 'changes', change);
    const ephemera = path.join(root, '.rasen', 'changes', change, 'ephemera');
    await fs.mkdir(path.join(active, 'evidence', 'quality'), { recursive: true });
    await fs.mkdir(path.join(active, 'handoff'), { recursive: true });
    await fs.mkdir(ephemera, { recursive: true });
    await fs.writeFile(path.join(active, 'proposal.md'), '# Equivalent\n');
    await fs.writeFile(path.join(active, 'tasks.md'), '- [x] Complete\n');
    await fs.writeFile(
      path.join(active, 'evidence', 'quality', 'review-report.md'),
      '# Review\nFindings: 2\n'
    );
    await fs.writeFile(
      path.join(active, 'handoff', 'absorbed.md'),
      'already represented\n'
    );
    await fs.writeFile(
      path.join(active, 'handoff', 'preserved.md'),
      'retain this dead end\n'
    );
    await fs.writeFile(path.join(ephemera, 'trace.log'), 'discard this trace\n');
    await fs.writeFile(path.join(ephemera, 'keep.txt'), 'preserve this note\n');
    if (writeEmbeddedIntent) {
      await fs.writeFile(
        path.join(active, '.rasen-archive-input.json'),
        JSON.stringify({
        schemaVersion: 1,
        change,
        handoff: {
          complete: true,
          decisions: [
            { path: 'handoff/absorbed.md', outcome: 'absorbed' },
            { path: 'handoff/preserved.md', outcome: 'preserved' },
          ],
        },
        probes: [{ path: 'experiments/probe', codeCommit: probeCommit }],
        })
      );
    }
  }

  async function invokeConsumer(
    label: string,
    generatedInstructions: string | null
  ): Promise<ConsumerSnapshot> {
    if (generatedInstructions) {
      expect(
        generatedInstructions,
        `${label} must prescribe the authoritative apply command`
      ).toContain(GENERATED_APPLY_COMMAND);
      expect(generatedInstructions).toContain(GENERATED_INTENT_COMMAND);
      expect(generatedInstructions).toContain(GENERATED_PLAN_COMMAND);
    }
    await writeEquivalentFixture(generatedInstructions === null);
    const probeBefore = await fs.readFile(
      path.join(root, 'experiments', 'probe', 'result.txt')
    );
    const logs: string[] = [];
    console.log = (...values: unknown[]) => {
      logs.push(values.map(value => String(value)).join(' '));
    };
    process.exitCode = undefined;

    let token: string | undefined;
    if (generatedInstructions) {
      const consumer: GeneratedArchiveConsumer = label.includes('single')
        ? 'single'
        : label.includes('bulk')
          ? 'bulk'
          : 'in-ship';
      let generatedArgv = createGeneratedArchiveConsumerArgv(consumer, {
        change,
        intentPath: '<pending>',
        planToken: '<pending>',
      });
      await createProgram({ locale: 'en' }).parseAsync([
        'node',
        'rasen',
        ...generatedArgv.intentTemplate,
      ]);
      const templatePayload = JSON.parse(logs.at(-1) ?? '{}') as {
        archive: { intent: ArchiveIntentV1 };
      };
      const intent = completeGeneratedArchiveIntent(
        templatePayload.archive.intent,
        {
          handoffOutcomes: {
            'handoff/absorbed.md': 'absorbed',
            'handoff/preserved.md': 'preserved',
          },
          probes: [{ path: 'experiments/probe', codeCommit: probeCommit }],
        }
      );
      const intentPath = path.join(
        root,
        '.rasen',
        'changes',
        change,
        'archive-intent.json'
      );
      await fs.mkdir(path.dirname(intentPath), { recursive: true });
      await fs.writeFile(intentPath, JSON.stringify(intent));
      logs.length = 0;

      generatedArgv = createGeneratedArchiveConsumerArgv(consumer, {
        change,
        intentPath,
        planToken: '<pending>',
      });
      await createProgram({ locale: 'en' }).parseAsync([
        'node',
        'rasen',
        ...generatedArgv.savedPreview,
      ]);
      const previewPayload = JSON.parse(logs.at(-1) ?? '{}') as {
        archive: { planToken: string; plan: { complete: boolean } };
      };
      expect(previewPayload.archive.plan.complete).toBe(true);
      token = previewPayload.archive.planToken;
      logs.length = 0;
      generatedArgv = createGeneratedArchiveConsumerArgv(consumer, {
        change,
        intentPath,
        planToken: token,
      });
      await createProgram({ locale: 'en' }).parseAsync([
        'node',
        'rasen',
        ...generatedArgv.apply,
      ]);
    } else {
      const command = new ArchiveCommand();
      await command.execute(change, { yes: true, json: true });
    }
    expect(process.exitCode, logs.join('\n')).toBeUndefined();
    const payload = JSON.parse(logs.at(-1) ?? '{}') as {
      archive: {
        path?: string;
        ephemeraDiscarded?: string[];
        ephemeraPreserved?: string[];
        result?: {
          path: string;
          ephemeraDiscarded: string[];
          ephemeraPreserved: string[];
        };
      };
    };
    const applyResult = payload.archive.result ?? payload.archive;
    const final = applyResult.path!;
    const accounting = JSON.parse(
      await fs.readFile(path.join(final, 'archive.json'), 'utf8')
    ) as Record<string, unknown> & {
      evidence: Array<{ path: string; sha256: string }>;
    };
    const actualEvidence = await hashArchiveEvidence(final);
    expect(actualEvidence).toEqual(accounting.evidence);
    expect(
      await fs.readFile(path.join(root, 'experiments', 'probe', 'result.txt'))
    ).toEqual(probeBefore);
    expect(
      await fs.readFile(path.join(final, 'evidence', 'handoff', 'preserved.md'), 'utf8')
    ).toBe('retain this dead end\n');
    await expect(
      fs.access(path.join(final, 'handoff', 'absorbed.md'))
    ).rejects.toMatchObject({ code: 'ENOENT' });

    const journal = JSON.parse(
      await fs.readFile(path.join(final, '.rasen-archive-journal.json'), 'utf8')
    ) as {
      phase: string;
      change: string;
      ephemeraDisposed: string[];
      activePath: string;
      finalPath: string;
    };
    const quality = await fs.readFile(path.join(final, '.openspec.yaml'), 'utf8');
    const shipLog = (
      await fs.readFile(path.join(final, 'evidence', 'ship-log.md'), 'utf8')
    )
      .replace(/^\*\*Date:\*\*.*$/m, '**Date:** <time>')
      .replace(/^\*\*Transaction:\*\*.*$/m, '**Transaction:** <transaction>');

    const normalizedEvidence = actualEvidence.map(entry => ({
      ...entry,
      ...(entry.path === 'evidence/ship-log.md'
        ? { sha256: '<transaction-bound>' }
        : {}),
    }));
    const normalizedAccounting = {
      ...accounting,
      archivedAt: '<time>',
      evidence: normalizedEvidence,
    };
    const snapshot: ConsumerSnapshot = {
      cleaner: {
        discarded: applyResult.ephemeraDiscarded!,
        preserved: applyResult.ephemeraPreserved!,
      },
      handoff: accounting.handoffAbsorbed,
      probes: accounting.probes,
      quality,
      evidence: normalizedEvidence,
      shipLog,
      journal: {
        phase: journal.phase,
        change: journal.change,
        ephemeraDisposed: journal.ephemeraDisposed,
        activePath: journal.activePath,
        finalPath: journal.finalPath,
      },
      accounting: normalizedAccounting,
    };

    await fs.rm(final, { recursive: true, force: true });
    return snapshot;
  }

  it('keeps the direct controller as a separate deterministic engine parity baseline', async () => {
    const first = await invokeConsumer('direct CLI first', null);
    const second = await invokeConsumer('direct CLI second', null);

    expect(second).toEqual(first);
    expect(first.cleaner).toEqual({
      discarded: ['trace.log'],
      preserved: ['keep.txt'],
    });
    expect(first.journal.phase).toBe('complete');
  });

  it('executes single, bulk, and in-ship generated argv through real Commander', async () => {
    const consumers = [
      ['generated single', getArchiveChangeSkillTemplate().instructions],
      ['generated bulk', getBulkArchiveChangeSkillTemplate().instructions],
      ['generated in-ship', getShipCommandSkillTemplate().instructions],
    ] as const;
    const snapshots: ConsumerSnapshot[] = [];
    for (const [label, instructions] of consumers) {
      snapshots.push(await invokeConsumer(label, instructions));
    }

    for (const snapshot of snapshots) {
      expect(snapshot).toEqual(snapshots[0]);
      expect(snapshot.cleaner).toEqual({
        discarded: ['trace.log'],
        preserved: ['keep.txt'],
      });
      expect(snapshot.journal.phase).toBe('complete');
    }
  });

  it.each([
    {
      label: 'empty-handoff',
      consumer: 'single' as const,
      handoff: false,
      probes: [] as const,
      absentIntent: false,
      skipSpecs: false,
    },
    {
      label: 'probe-only',
      consumer: 'single' as const,
      handoff: false,
      probes: [{ path: 'experiments/probe', codeCommit: '' }] as const,
      absentIntent: false,
      skipSpecs: false,
    },
    {
      label: 'multiple-probe',
      consumer: 'bulk' as const,
      handoff: false,
      probes: [
        { path: 'experiments/probe', codeCommit: '' },
        { path: 'experiments/probe-two', codeCommit: '' },
      ] as const,
      absentIntent: false,
      skipSpecs: false,
    },
    {
      label: 'absent-intent',
      consumer: 'in-ship' as const,
      handoff: false,
      probes: [] as const,
      absentIntent: true,
      skipSpecs: false,
    },
    {
      label: 'skip-specs',
      consumer: 'bulk' as const,
      handoff: false,
      probes: [] as const,
      absentIntent: false,
      skipSpecs: true,
    },
  ])(
    'executes the generated $label argv variant through real Commander',
    async variant => {
      const active = path.join(root, 'rasen', 'changes', change);
      const ephemera = path.join(root, '.rasen', 'changes', change, 'ephemera');
      await fs.mkdir(path.join(active, 'evidence', 'quality'), {
        recursive: true,
      });
      await fs.mkdir(ephemera, { recursive: true });
      await fs.writeFile(path.join(active, 'proposal.md'), '# Variant\n');
      await fs.writeFile(path.join(active, 'tasks.md'), '- [x] Complete\n');
      await fs.writeFile(
        path.join(active, 'evidence', 'quality', 'review-report.md'),
        '# Review\nFindings: 0\n'
      );
      if (variant.handoff) {
        await fs.mkdir(path.join(active, 'handoff'), { recursive: true });
      }
      if (variant.skipSpecs) {
        const delta = path.join(active, 'specs', 'skipped', 'spec.md');
        await fs.mkdir(path.dirname(delta), { recursive: true });
        await fs.writeFile(
          delta,
          '# Skipped - Changes\n\n## ADDED Requirements\n\n' +
            '### Requirement: Skipped\nThe system SHALL skip this update.\n\n' +
            '#### Scenario: Skip\n- **WHEN** archive runs\n- **THEN** the spec is skipped\n'
        );
      }
      await fs.writeFile(path.join(ephemera, 'trace.log'), 'discard\n');

      const logs: string[] = [];
      console.log = (...values: unknown[]) => {
        logs.push(values.map(value => String(value)).join(' '));
      };
      process.exitCode = undefined;
      let intentPath: string | undefined;
      const probes = variant.probes.map(probe => ({
        ...probe,
        codeCommit: probeCommit,
      }));

      if (!variant.absentIntent) {
        const templateArgv = createGeneratedArchiveConsumerArgv(
          variant.consumer,
          { change, planToken: '<pending>' }
        );
        await createProgram({ locale: 'en' }).parseAsync([
          'node',
          'rasen',
          ...templateArgv.intentTemplate,
        ]);
        const templatePayload = JSON.parse(logs.at(-1) ?? '{}') as {
          archive: { intent: ArchiveIntentV1 };
        };
        const intent = completeGeneratedArchiveIntent(
          templatePayload.archive.intent,
          { probes }
        );
        intentPath = path.join(
          root,
          '.rasen',
          'changes',
          change,
          `archive-intent-${variant.label}.json`
        );
        await fs.mkdir(path.dirname(intentPath), { recursive: true });
        await fs.writeFile(intentPath, JSON.stringify(intent));
        logs.length = 0;
      }

      let generatedArgv = createGeneratedArchiveConsumerArgv(
        variant.consumer,
        {
          change,
          intentPath,
          planToken: '<pending>',
          skipSpecs: variant.skipSpecs,
        }
      );
      if (variant.skipSpecs) {
        expect(generatedArgv.savedPreview).toContain('--skip-specs');
      }
      await createProgram({ locale: 'en' }).parseAsync([
        'node',
        'rasen',
        ...generatedArgv.savedPreview,
      ]);
      const preview = JSON.parse(logs.at(-1) ?? '{}') as {
        archive: {
          planToken: string;
          plan: {
            complete: boolean;
            sidecar: { status: string };
            specActions: unknown[];
          };
        };
      };
      expect(preview.archive.plan.complete).toBe(true);
      expect(preview.archive.plan.sidecar.status).toBe(
        variant.absentIntent ? 'absent' : 'valid'
      );
      if (variant.skipSpecs) {
        expect(preview.archive.plan.specActions).toEqual([]);
      }

      logs.length = 0;
      generatedArgv = createGeneratedArchiveConsumerArgv(variant.consumer, {
        change,
        intentPath,
        planToken: preview.archive.planToken,
        skipSpecs: variant.skipSpecs,
      });
      await createProgram({ locale: 'en' }).parseAsync([
        'node',
        'rasen',
        ...generatedArgv.apply,
      ]);
      const applied = JSON.parse(logs.at(-1) ?? '{}') as {
        archive: { result: { status: string; path: string } };
      };
      expect(applied.archive.result.status).toBe('complete');
      expect(process.exitCode).toBeUndefined();
      const accounting = JSON.parse(
        await fs.readFile(
          path.join(applied.archive.result.path, 'archive.json'),
          'utf8'
        )
      ) as { probes: Array<{ path: string }> };
      expect(accounting.probes.map(probe => probe.path)).toEqual(
        probes.map(probe => probe.path)
      );
      if (variant.skipSpecs) {
        await expect(
          fs.access(path.join(root, 'rasen', 'specs', 'skipped', 'spec.md'))
        ).rejects.toMatchObject({ code: 'ENOENT' });
      }
      await fs.rm(applied.archive.result.path, {
        recursive: true,
        force: true,
      });
    }
  );
});
