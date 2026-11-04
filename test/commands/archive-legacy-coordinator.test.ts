import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ArchiveCommand } from '../../src/core/archive.js';
import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import {
  createStoreFinalizationFixture,
  hashTree,
  type StoreFinalizationFixture,
} from '../helpers/store-finalization-fixture.js';
import {
  productionStoreLayoutMigrationDependencies,
  queryLegacyCoordinatorConversion,
} from '../../src/core/store/layout-migration/index.js';

const PROJECT = 'app-a';
const LINE = 'line-0.2';
const ALIAS = 'legacy-coordinator';
const ISSUE = 'release-coordinator';

function parseJson(result: RunCLIResult): any {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `Could not parse JSON.\nCommand: ${result.command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\n${String(error)}`
    );
  }
}

describe('rasen archive: migrated legacy coordinator diagnostic', () => {
  let f: StoreFinalizationFixture;

  beforeEach(async () => {
    f = await createStoreFinalizationFixture({
      prefix: 'rasen-archive-legacy-coordinator-',
      projects: [PROJECT],
      lines: [
        {
          id: LINE,
          storeRef: 'refs/heads/main',
          codeRefs: { [PROJECT]: 'refs/heads/main' },
        },
      ],
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  function selectors(): string[] {
    return ['--store', f.storeId, '--project', PROJECT, '--target-line', LINE];
  }

  function receipt(
    alias = ALIAS,
    options: {
      readonly planId?: string;
      readonly issueId?: string;
      readonly lifecycle?: 'active-change' | 'archive-entry';
      readonly ref?: string;
      readonly storeUid?: string;
    } = {}
  ): Record<string, unknown> {
    const planId = options.planId ?? 'a'.repeat(64);
    const storeUid = options.storeUid ?? f.storeUid;
    const ref = options.ref ?? 'refs/heads/main';
    const issueId = options.issueId ?? ISSUE;
    const headOid = f.refOid(f.storeRoot, 'HEAD');
    return {
      schemaVersion: 2,
      planId,
      storeId: f.storeId,
      storeUid,
      ref,
      headOid,
      inventoryFingerprint: 'b'.repeat(64),
      mapping: {
        schemaVersion: 2,
        path: 'rasen/mapping.yaml',
        digest: 'c'.repeat(64),
      },
      items: [],
      changeInstances: [],
      droppedAdoption: [],
      sharedSpecResolutions: [],
      retainedDesignDocs: [],
      supersededEvidence: [],
      targetLineCatalogs: [],
      phases: [{ phase: 'published', at: '2026-08-07T00:00:00.000Z' }],
      sourceRevision: {
        repositoryKind: 'store',
        role: 'planning-source',
        storeUid,
        ref,
        headOid,
      },
      conversions: [
        {
          source: {
            lifecycle: options.lifecycle ?? 'active-change',
            alias,
            path: `rasen/changes/${alias}`,
            digest: 'd'.repeat(64),
          },
          classification: { kind: 'store-issue', nature: 'operator-asserted' },
          issue: {
            id: issueId,
            state: 'open',
            reason: null,
            stateNature: 'migration-default-open',
          },
          destination: `rasen/issues/${issueId}`,
          outputs: [
            {
              role: 'issue-record',
              path: `rasen/issues/${issueId}/issue.yaml`,
              schemaVersion: 1,
              digest: 'e'.repeat(64),
            },
          ],
        },
      ],
    };
  }

  function writeReceipt(name: string, value: unknown): string {
    const target = f.at('.rasen-store', 'migration', 'receipts', `${name}.json`);
    f.write(target, `${JSON.stringify(value, null, 2)}\n`);
    return target;
  }

  it('returns the same non-mutating compatibility refusal in JSON and human modes with or without outcome flags', async () => {
    writeReceipt('conversion', receipt());
    f.write(
      f.at('rasen', 'issues', ISSUE, 'issue.yaml'),
      [
        'version: 1',
        `id: ${ISSUE}`,
        'title: Coordinate the release',
        'state: open',
        'reason: null',
        'createdAt: 2026-08-07T00:00:00.000Z',
        '',
      ].join('\n')
    );
    const before = hashTree(f.storeRoot);

    for (const flags of [
      ['--json'],
      ['--json', '--outcome', 'abandoned', '--reason', 'not forwarded'],
      [
        '--json',
        '--outcome',
        'superseded',
        '--reason',
        'still not forwarded',
        '--by',
        `ci_${'f'.repeat(64)}`,
        '--by-target-line',
        LINE,
        '--commit',
        'a'.repeat(40),
        '--skip-specs',
        '--no-validate',
        '--keep-ephemera',
        '--dry-run',
        '--save-plan',
      ],
    ]) {
      const result = await runCLI(
        ['archive', ALIAS, ...selectors(), '--yes', ...flags],
        { cwd: f.storeRoot, env: f.env }
      );
      expect(result.exitCode).toBe(1);
      const diagnostic = parseJson(result).status[0];
      expect(diagnostic).toMatchObject({
        code: 'legacy_coordinator_became_issue',
        issueId: ISSUE,
        storeId: f.storeId,
        forwarded: false,
      });
      expect(diagnostic.continuations).toEqual([
        `rasen store issue show ${ISSUE} --store ${f.storeId}`,
        `rasen store issue state ${ISSUE} --store ${f.storeId} --state <resolved|dropped>`,
      ]);
    }

    const human = await runCLI(['archive', ALIAS, ...selectors(), '--yes'], {
      cwd: f.storeRoot,
      env: f.env,
    });
    expect(human.exitCode).toBe(1);
    expect(`${human.stdout}\n${human.stderr}`).toContain('legacy_coordinator_became_issue');
    expect(`${human.stdout}\n${human.stderr}`).toContain(
      `rasen store issue show ${ISSUE} --store ${f.storeId}`
    );
    expect(hashTree(f.storeRoot)).toEqual(before);
  }, 240_000);

  it('reads a non-ASCII receipt filename and provenance path without sanitizing the diagnostic', async () => {
    const value = receipt() as {
      conversions: Array<{ source: { path: string } }>;
    };
    value.conversions[0]!.source.path = 'rasen/changes/跨项目协调';
    writeReceipt('协调迁移收据', value);
    const before = hashTree(f.storeRoot);

    const result = await runCLI(
      ['archive', ALIAS, ...selectors(), '--yes', '--json'],
      { cwd: f.storeRoot, env: f.env }
    );
    expect(result.exitCode).toBe(1);
    expect(parseJson(result).status[0]).toMatchObject({
      code: 'legacy_coordinator_became_issue',
      issueId: ISSUE,
    });
    expect(hashTree(f.storeRoot)).toEqual(before);
  }, 120_000);

  it('fails closed when the exact active Change lookup has an operational error', async () => {
    writeReceipt('conversion', receipt());
    const active = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: ALIAS,
    });
    const operationalError = Object.assign(new Error('injected active Change lookup failure'), {
      code: 'EACCES',
    });
    let exactLookupObserved = false;
    const lstat = (async (target: fs.PathLike) => {
      if (path.resolve(String(target)) === path.resolve(active.directory)) {
        exactLookupObserved = true;
        throw operationalError;
      }
      return fs.promises.lstat(target);
    }) as typeof fs.promises.lstat;
    const before = hashTree(f.storeRoot);
    const savedCwd = process.cwd();
    const savedXdg = process.env.XDG_DATA_HOME;
    const savedRasenHome = process.env.RASEN_HOME;
    try {
      process.chdir(f.storeRoot);
      process.env.XDG_DATA_HOME = f.env.XDG_DATA_HOME;
      delete process.env.RASEN_HOME;
      await expect(
        new ArchiveCommand({ lstat }).execute(ALIAS, {
          store: f.storeId,
          project: PROJECT,
          targetLine: LINE,
          yes: true,
        })
      ).rejects.toBe(operationalError);
    } finally {
      process.chdir(savedCwd);
      if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = savedXdg;
      if (savedRasenHome === undefined) delete process.env.RASEN_HOME;
      else process.env.RASEN_HOME = savedRasenHome;
    }
    expect(exactLookupObserved).toBe(true);
    expect(hashTree(f.storeRoot)).toEqual(before);
  }, 120_000);

  it('keeps exact precedence for real Changes, token conflicts, archived conversions, and inconclusive receipts', async () => {
    writeReceipt('conversion', receipt());
    const active = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: ALIAS,
    });
    const real = await runCLI(['archive', ALIAS, ...selectors(), '--yes', '--json'], {
      cwd: f.storeRoot,
      env: f.env,
    });
    expect(real.exitCode).toBe(1);
    expect(parseJson(real).status[0].code).toBe('finalization_outcome_required');
    fs.rmSync(active.directory, { recursive: true, force: true });

    for (const tokenFlag of ['--apply-plan', '--abort-plan']) {
      const conflict = await runCLI(
        ['archive', ALIAS, tokenFlag, 'not-a-token', '--outcome', 'abandoned', '--json'],
        { cwd: f.tempDir, env: f.env }
      );
      expect(conflict.exitCode).toBe(1);
      expect(parseJson(conflict).status[0].code).toBe('archive_option_conflict');
    }

    fs.rmSync(path.dirname(writeReceipt('conversion', receipt())), {
      recursive: true,
      force: true,
    });
    writeReceipt('archived', receipt(ALIAS, { lifecycle: 'archive-entry' }));
    const archived = await runCLI(['archive', ALIAS, ...selectors(), '--yes', '--json'], {
      cwd: f.storeRoot,
      env: f.env,
    });
    expect(parseJson(archived).status[0].code).toBe('finalization_outcome_required');

    fs.rmSync(f.at('.rasen-store', 'migration', 'receipts'), {
      recursive: true,
      force: true,
    });
    writeReceipt('other-ref', receipt(ALIAS, { ref: 'refs/heads/other' }));
    writeReceipt(
      'other-store',
      receipt(ALIAS, { storeUid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })
    );
    const versionOne = receipt(ALIAS) as Record<string, unknown>;
    versionOne.schemaVersion = 1;
    versionOne.mapping = {
      path: 'rasen/mapping.yaml',
      digest: 'c'.repeat(64),
    };
    delete versionOne.sourceRevision;
    delete versionOne.conversions;
    writeReceipt('version-one', versionOne);
    expect(
      (
        await queryLegacyCoordinatorConversion(productionStoreLayoutMigrationDependencies, {
          storeRoot: f.storeRoot,
          storeUid: f.storeUid,
          ref: 'refs/heads/main',
          alias: ALIAS,
        })
      ).status
    ).toBe('absent');

    writeReceipt('invalid', { schemaVersion: 2, conversions: [] });
    const incomplete = await queryLegacyCoordinatorConversion(
      productionStoreLayoutMigrationDependencies,
      {
        storeRoot: f.storeRoot,
        storeUid: f.storeUid,
        ref: 'refs/heads/main',
        alias: ALIAS,
      }
    );
    expect(incomplete.status).toBe('incomplete-evidence');

    fs.rmSync(f.at('.rasen-store', 'migration', 'receipts'), {
      recursive: true,
      force: true,
    });
    writeReceipt('one', receipt(ALIAS, { planId: '1'.repeat(64), issueId: 'one' }));
    writeReceipt('two', receipt(ALIAS, { planId: '2'.repeat(64), issueId: 'two' }));
    expect(
      (
        await queryLegacyCoordinatorConversion(productionStoreLayoutMigrationDependencies, {
          storeRoot: f.storeRoot,
          storeUid: f.storeUid,
          ref: 'refs/heads/main',
          alias: ALIAS,
        })
      ).status
    ).toBe('ambiguous');
  }, 240_000);
});
