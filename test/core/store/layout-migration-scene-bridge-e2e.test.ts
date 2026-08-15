import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { COMMAND_REGISTRY } from '../../../src/core/completions/command-registry.js';
import { parseExecutionPlanRevision } from '../../../src/core/store/issues/plans.js';
import type { StoreIssues } from '../../../src/core/store/issues/types.js';
import { digestTree } from '../../../src/core/store/layout-migration/flat-source.js';
import {
  productionStoreLayoutMigrationDependencies,
  type LayoutMigrationCheckpoint,
} from '../../../src/core/store/layout-migration/index.js';
import { snapshotDirectory } from '../../helpers/fs-snapshot.js';
import { runCLI, type RunCLIResult } from '../../helpers/run-cli.js';
import {
  createLayoutMigrationFixture,
  MIGRATION_FIXTURE_STORE_ID,
  type LayoutMigrationFixture,
} from '../../helpers/layout-migration-fixture.js';

const FIXTURE_ROOT = path.resolve('test', 'fixtures', 'layout-migration', 'scene-bridge');
const MAPPING = 'rasen/migration-mapping-v2.yaml';
const ACTIVE = 'time-qualified-preview-render-job-and-reference-video';
const NO_PLAN = 'historical-camera-path-and-timeline';
const PROJECT = 'scene-bridge';
const PROJECT_CHANGE = 'scene-render-worker';
const TARGET_LINE = 'line-0.1';
const ARCHIVED_ALIASES = [
  '2026-08-01-core-project-and-scene-lifecycle',
  '2026-08-01-protocol-spine-and-live-cube',
  '2026-08-03-named-camera-shot-camera-path-and-timeline',
] as const;

type Assert<T extends true> = T;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;

const publicIssueMethodsAreUnchanged: Assert<
  Equal<keyof StoreIssues, 'create' | 'setState' | 'publishPlan'>
> = true;

function parseJson(result: RunCLIResult): any {
  return JSON.parse(result.stdout);
}

function cliEnv(fixture: LayoutMigrationFixture): NodeJS.ProcessEnv {
  return {
    ...fixture.gitEnv,
    XDG_DATA_HOME: path.join(fixture.tempDir, 'data'),
    RASEN_HOME: '',
    OPEN_SPEC_INTERACTIVE: '0',
    RASEN_TELEMETRY: '0',
  };
}

function seedMemberCodeRepository(fixture: LayoutMigrationFixture): {
  readonly root: string;
  readonly before: Map<string, string>;
} {
  const root = path.join(fixture.tempDir, 'scene-bridge-code');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'scene.ts'), 'export const scene = "unchanged";\n', 'utf8');
  execFileSync('git', ['init', '-b', 'main', root], {
    env: { ...process.env, ...fixture.gitEnv },
    windowsHide: true,
    stdio: 'pipe',
  });
  execFileSync('git', ['-C', root, 'add', '-A'], {
    env: { ...process.env, ...fixture.gitEnv },
    windowsHide: true,
    stdio: 'pipe',
  });
  execFileSync('git', ['-C', root, 'commit', '-m', 'seed member code'], {
    env: { ...process.env, ...fixture.gitEnv },
    windowsHide: true,
    stdio: 'pipe',
  });
  return { root, before: snapshotDirectory(root) };
}

function relativeFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join('/'));
    }
  };
  walk(root);
  return files.sort();
}

const REPRESENTATIVE_HASHES = new Map<string, string>([
  [
    `rasen/changes/${ACTIVE}/proposal.md`,
    '26167bc8453d5a170480864bbfac7c8262611158c7b44bc0a6ebc59773347677',
  ],
  [
    'rasen/changes/archive/2026-08-01-core-project-and-scene-lifecycle/README.md',
    'd6b6229af065b0728ad20b5af345a4d9623918615d1473aac7b883264d685c5c',
  ],
  [
    'rasen/changes/archive/2026-08-01-protocol-spine-and-live-cube/README.md',
    '1ada3a5bf192610588368e01a27ef715387975deb5dfa601ce900ed19e1356dd',
  ],
  [
    'rasen/changes/archive/2026-08-03-named-camera-shot-camera-path-and-timeline/README.md',
    '333241240d5328c6e595ff4d3423d1c54739f9e3f1a33729517720589a0335fa',
  ],
]);

describe('scene-bridge coordinator migration fixture', () => {
  let f: LayoutMigrationFixture;

  beforeEach(async () => {
    f = await createLayoutMigrationFixture('rasen-layout-scene-bridge-');
    fs.cpSync(path.join(FIXTURE_ROOT, 'rasen'), f.at('rasen'), { recursive: true });
    await f.member(PROJECT, { specs: [], changes: [PROJECT_CHANGE] });
    f.commitAll('seed committed scene-bridge migration fixture');
  });

  afterEach(() => {
    f.cleanup();
  });

  it('pins representative real source bytes without reading the external checkout', () => {
    for (const [relative, expected] of REPRESENTATIVE_HASHES) {
      const bytes = fs.readFileSync(path.join(FIXTURE_ROOT, ...relative.split('/')));
      expect(createHash('sha256').update(bytes).digest('hex'), relative).toBe(expected);
      expect(
        fs.readFileSync(f.at(...relative.split('/'))).equals(bytes),
        `${relative} changed while seeding the fixture`
      ).toBe(true);
    }
  });

  it('plans the active and three archived coordinators with explicit legal states and one clean sourceChange plan', async () => {
    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    expect(plan.applicable).toBe(true);
    expect(plan.schemaVersion).toBe(2);

    const active = plan.items.find((item) => item.name === ACTIVE)!;
    expect(active.disposition).toMatchObject({
      kind: 'store-issue',
      issueId: ACTIVE,
      state: 'open',
      reason: null,
    });
    expect(active.planInput).toMatchObject({
      relative: 'rasen/migration-inputs/time-qualified-plan.yaml',
      digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(active.materialization?.kind).toBe('generated-tree');
    if (active.materialization?.kind !== 'generated-tree') throw new Error('expected Issue tree');
    const revisionFile = active.materialization.files.find(
      (file) => file.role === 'execution-plan'
    )!;
    const revision = parseExecutionPlanRevision(revisionFile.content, { verifyDigest: true });
    const minted = plan.mintedIdentities.find((entry) => entry.oldAlias === 'scene-render-worker')!;
    expect(revision.nodes[0]).toMatchObject({
      kind: 'change',
      projectId: 'scene-bridge',
      targetLineId: 'line-0.1',
      changeInstanceId: minted.changeInstanceId,
    });
    expect(revisionFile.content).not.toContain('sourceChange');

    expect(
      plan.items.find((item) => item.name === '2026-08-01-core-project-and-scene-lifecycle')
        ?.disposition
    ).toMatchObject({ kind: 'store-issue', state: 'resolved', reason: expect.any(String) });
    expect(
      plan.items.find((item) => item.name === '2026-08-01-protocol-spine-and-live-cube')
        ?.disposition
    ).toMatchObject({ kind: 'store-issue', state: 'dropped', reason: expect.any(String) });
    const noPlan = plan.items.find(
      (item) => item.name === '2026-08-03-named-camera-shot-camera-path-and-timeline'
    )!;
    expect(noPlan.disposition).toMatchObject({ kind: 'store-issue', state: 'open', reason: null });
    expect(noPlan.planInput).toBeUndefined();
    expect(
      noPlan.materialization?.kind === 'generated-tree'
        ? noPlan.materialization.files.map((file) => file.relativePath)
        : []
    ).toEqual(['issue.yaml']);
  });

  it('isolates a same-named second flat ref, refuses destination conflicts, resumes and rolls back publication, retries retirement, and restores Git provenance', async () => {
    const env = cliEnv(f);
    const memberRepository = seedMemberCodeRepository(f);
    const sameNamedPath = `rasen/changes/${ACTIVE}/proposal.md`;
    const secondRefBody = '# Same legacy alias on the independent second flat ref\n';

    f.switchRef('second-flat', true);
    f.write(sameNamedPath, secondRefBody);
    f.commitAll('seed same-named coordinator on second flat ref');
    const secondRefHead = f.git('rev-parse', 'HEAD').trim();
    f.switchRef('main');
    expect(f.git('show', `${secondRefHead}:${sameNamedPath}`)).toBe(secondRefBody);
    expect(fs.readFileSync(f.at(...sameNamedPath.split('/')), 'utf8')).not.toBe(secondRefBody);

    fs.mkdirSync(f.issueAt(ACTIVE), { recursive: true });
    fs.writeFileSync(f.issueAt(ACTIVE, 'foreign.txt'), 'must not be overwritten\n', 'utf8');
    const issueConflict = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    expect(issueConflict.applicable).toBe(false);
    expect(issueConflict.items.find((item) => item.name === ACTIVE)?.state).toMatchObject({
      kind: 'blocked',
      reason: 'destination-exists',
    });
    expect(fs.readFileSync(f.issueAt(ACTIVE, 'foreign.txt'), 'utf8')).toBe(
      'must not be overwritten\n'
    );
    fs.rmSync(f.issueAt(ACTIVE), { recursive: true, force: true });

    fs.mkdirSync(f.issueAt(NO_PLAN), { recursive: true });
    fs.writeFileSync(f.issueAt(NO_PLAN, 'foreign.txt'), 'second Issue conflict\n', 'utf8');
    const secondIssueConflict = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    expect(secondIssueConflict.applicable).toBe(false);
    expect(
      secondIssueConflict.items.find(
        (item) => item.name === '2026-08-03-named-camera-shot-camera-path-and-timeline'
      )?.state
    ).toMatchObject({
      kind: 'blocked',
      reason: 'destination-exists',
    });
    expect(fs.readFileSync(f.issueAt(NO_PLAN, 'foreign.txt'), 'utf8')).toBe(
      'second Issue conflict\n'
    );
    fs.rmSync(f.issueAt(NO_PLAN), { recursive: true, force: true });

    const projectDestination = f.at(
      'rasen',
      'projects',
      PROJECT,
      'changes',
      PROJECT_CHANGE
    );

    let crashed = false;
    const interrupted = f.migration({
      checkpoint: async (event: LayoutMigrationCheckpoint) => {
        if (!crashed && event.kind === 'operation-renamed' && event.operationKind === 'issue-tree') {
          crashed = true;
          throw new Error('injected scene-bridge Issue publication interruption');
        }
      },
    });
    const plan = await interrupted.plan(f.input({ mappingPath: MAPPING }));
    expect(plan.applicable).toBe(true);
    expect(plan.otherFlatRefs.map((entry) => entry.ref)).toContain('refs/heads/second-flat');
    await expect(interrupted.apply(plan.token!)).rejects.toThrow(
      /scene-bridge Issue publication interruption/u
    );

    const resumed = await runCLI(
      ['store', 'migrate-layout', MIGRATION_FIXTURE_STORE_ID, '--resume', '--json'],
      { cwd: f.storeRoot, env }
    );
    expect(resumed.exitCode, `${resumed.stdout}\n${resumed.stderr}`).toBe(0);
    expect(parseJson(resumed)).toMatchObject({ phase: 'published' });
    expect(fs.existsSync(f.issueAt(ACTIVE, 'issue.yaml'))).toBe(true);
    expect(f.git('show', `${secondRefHead}:${sameNamedPath}`)).toBe(secondRefBody);

    const rolledBack = await runCLI(
      ['store', 'migrate-layout', MIGRATION_FIXTURE_STORE_ID, '--rollback', '--json'],
      { cwd: f.storeRoot, env }
    );
    expect(rolledBack.exitCode, `${rolledBack.stdout}\n${rolledBack.stderr}`).toBe(0);
    expect(parseJson(rolledBack)).toMatchObject({ phase: 'rolled-back' });
    expect(fs.existsSync(f.at('rasen', 'changes', ACTIVE))).toBe(true);
    expect(fs.existsSync(f.issueAt(ACTIVE))).toBe(false);
    expect(fs.existsSync(projectDestination)).toBe(false);

    const applied = await runCLI(
      [
        'store',
        'migrate-layout',
        MIGRATION_FIXTURE_STORE_ID,
        '--mapping',
        MAPPING,
        '--apply',
        '--json',
      ],
      { cwd: f.storeRoot, env }
    );
    expect(applied.exitCode, `${applied.stdout}\n${applied.stderr}`).toBe(0);
    const appliedJson = parseJson(applied);
    expect(appliedJson).toMatchObject({ phase: 'published' });

    let sourceRemovalCount = 0;
    await expect(
      f
        .migration({
          checkpoint: async (event: LayoutMigrationCheckpoint) => {
            if (event.kind === 'source-removal' && ++sourceRemovalCount === 2) {
              throw new Error('injected partial scene-bridge retirement');
            }
          },
        })
        .recover(f.input({ action: 'retire-flat' }))
    ).rejects.toThrow(/partial scene-bridge retirement/u);
    const legacySourcePaths = [
      f.at('rasen', 'changes', PROJECT_CHANGE),
      f.at('rasen', 'changes', ACTIVE),
      ...ARCHIVED_ALIASES.map((alias) => f.at('rasen', 'changes', 'archive', alias)),
    ];
    const remainingAfterFailure = legacySourcePaths.filter((source) => fs.existsSync(source));
    expect(remainingAfterFailure.length).toBeGreaterThan(0);
    expect(remainingAfterFailure.length).toBeLessThan(legacySourcePaths.length);

    const retriedRetirement = await runCLI(
      ['store', 'migrate-layout', MIGRATION_FIXTURE_STORE_ID, '--retire-flat', '--json'],
      { cwd: f.storeRoot, env }
    );
    expect(
      retriedRetirement.exitCode,
      `${retriedRetirement.stdout}\n${retriedRetirement.stderr}`
    ).toBe(0);
    expect(parseJson(retriedRetirement)).toMatchObject({ phase: 'retired' });
    expect(legacySourcePaths.every((source) => !fs.existsSync(source))).toBe(true);

    const receipt = JSON.parse(fs.readFileSync(appliedJson.receiptPath, 'utf8')) as {
      sourceRevision: { headOid: string };
      conversions: Array<{
        source: { alias: string; path: string; digest: string };
      }>;
    };
    const activeConversion = receipt.conversions.find(
      (conversion) => conversion.source.alias === ACTIVE
    )!;
    f.git(
      'restore',
      `--source=${receipt.sourceRevision.headOid}`,
      '--worktree',
      '--',
      activeConversion.source.path
    );
    const restoredSource = f.at(...activeConversion.source.path.split('/'));
    expect((await digestTree(productionStoreLayoutMigrationDependencies.fs, restoredSource)).digest).toBe(
      activeConversion.source.digest
    );
    expect(snapshotDirectory(memberRepository.root)).toEqual(memberRepository.before);
    expect(f.git('show', `${secondRefHead}:${sameNamedPath}`)).toBe(secondRefBody);
  }, 300_000);

  it('keeps archive compatibility diagnostic-only after retirement with fixed token, archived-alias, and real-Change precedence', async () => {
    const env = cliEnv(f);
    const memberRepository = seedMemberCodeRepository(f);
    const selectors = [
      '--store',
      MIGRATION_FIXTURE_STORE_ID,
      '--project',
      PROJECT,
      '--target-line',
      TARGET_LINE,
    ];
    const applied = await runCLI(
      [
        'store',
        'migrate-layout',
        MIGRATION_FIXTURE_STORE_ID,
        '--mapping',
        MAPPING,
        '--apply',
        '--json',
      ],
      { cwd: f.storeRoot, env }
    );
    expect(applied.exitCode, `${applied.stdout}\n${applied.stderr}`).toBe(0);
    const retired = await runCLI(
      ['store', 'migrate-layout', MIGRATION_FIXTURE_STORE_ID, '--retire-flat', '--json'],
      { cwd: f.storeRoot, env }
    );
    expect(retired.exitCode, `${retired.stdout}\n${retired.stderr}`).toBe(0);
    const storeBeforeArchiveCommands = snapshotDirectory(f.storeRoot);

    const converted = await runCLI(['archive', ACTIVE, ...selectors, '--yes', '--json'], {
      cwd: f.storeRoot,
      env,
    });
    expect(converted.exitCode).toBe(1);
    expect(parseJson(converted).status[0]).toMatchObject({
      code: 'legacy_coordinator_became_issue',
      issueId: ACTIVE,
      storeId: MIGRATION_FIXTURE_STORE_ID,
      forwarded: false,
    });

    for (const tokenFlag of ['--apply-plan', '--abort-plan']) {
      const conflict = await runCLI(
        ['archive', ACTIVE, tokenFlag, 'not-a-token', '--outcome', 'abandoned', '--json'],
        { cwd: f.tempDir, env }
      );
      expect(conflict.exitCode).toBe(1);
      expect(parseJson(conflict).status[0].code).toBe('archive_option_conflict');
    }

    for (const alias of ARCHIVED_ALIASES) {
      const archivedAlias = await runCLI(['archive', alias, ...selectors, '--yes', '--json'], {
        cwd: f.storeRoot,
        env,
      });
      expect(archivedAlias.exitCode).toBe(1);
      expect(parseJson(archivedAlias).status[0].code).toBe('finalization_outcome_required');
    }

    const realChange = await runCLI(
      ['archive', PROJECT_CHANGE, ...selectors, '--yes', '--json'],
      { cwd: f.storeRoot, env }
    );
    expect(realChange.exitCode).toBe(1);
    expect(parseJson(realChange).status[0].code).toBe('finalization_outcome_required');
    expect(snapshotDirectory(f.storeRoot)).toEqual(storeBeforeArchiveCommands);
    expect(snapshotDirectory(memberRepository.root)).toEqual(memberRepository.before);
  }, 300_000);

  it('adds no import command, completion, index, receipt authority, acceptance, Change back-reference, member write, or legacy-tree copy', async () => {
    const env = cliEnv(f);
    const memberRepository = seedMemberCodeRepository(f);
    expect(publicIssueMethodsAreUnchanged).toBe(true);
    expect(JSON.stringify(COMMAND_REGISTRY)).not.toMatch(/import-legacy|coordinator/iu);
    const issueHelp = await runCLI(['store', 'issue', '--help'], { cwd: f.storeRoot, env });
    expect(issueHelp.exitCode, issueHelp.stderr).toBe(0);
    expect(issueHelp.stdout).not.toMatch(/import-legacy|coordinator/iu);

    const applied = await runCLI(
      [
        'store',
        'migrate-layout',
        MIGRATION_FIXTURE_STORE_ID,
        '--mapping',
        MAPPING,
        '--apply',
        '--json',
      ],
      { cwd: f.storeRoot, env }
    );
    expect(applied.exitCode, `${applied.stdout}\n${applied.stderr}`).toBe(0);
    const appliedJson = parseJson(applied);
    const receiptBytes = fs.readFileSync(appliedJson.receiptPath);
    const receipt = JSON.parse(receiptBytes.toString('utf8')) as {
      conversions: Array<{
        source: { alias: string };
        issue: { id: string; state: string; acceptanceEvidence?: string };
      }>;
    };
    expect(
      receipt.conversions
        .filter((conversion) => conversion.issue.state !== 'open')
        .every((conversion) => conversion.issue.acceptanceEvidence === 'unproven')
    ).toBe(true);

    const activeReceipt = receipt.conversions.find(
      (conversion) => conversion.source.alias === ACTIVE
    )!;
    activeReceipt.issue.state = 'dropped';
    fs.writeFileSync(appliedJson.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    const shown = await runCLI(
      ['store', 'issue', 'show', ACTIVE, '--store', MIGRATION_FIXTURE_STORE_ID, '--json'],
      { cwd: f.storeRoot, env }
    );
    expect(shown.exitCode, shown.stderr).toBe(0);
    expect(parseJson(shown).issue.record.state).toBe('open');
    fs.writeFileSync(appliedJson.receiptPath, receiptBytes);

    expect(relativeFiles(f.issueAt(ACTIVE))).toEqual(['issue.yaml', 'plans/0001.yaml']);
    for (const issueId of [
      'historical-core-project-and-scene-lifecycle',
      'historical-protocol-spine-and-live-cube',
      NO_PLAN,
    ]) {
      expect(relativeFiles(f.issueAt(issueId))).toEqual(['issue.yaml']);
    }
    const activeIssueBytes = relativeFiles(f.issueAt(ACTIVE))
      .map((relative) => fs.readFileSync(f.issueAt(ACTIVE, ...relative.split('/')), 'utf8'))
      .join('\n');
    expect(activeIssueBytes).not.toMatch(/accepted-render-handoff|sourceChange|acceptance|Dispatch/iu);
    expect(fs.existsSync(f.at('rasen', 'coordinators'))).toBe(false);
    expect(fs.existsSync(f.at('.rasen-store', 'coordinators'))).toBe(false);
    expect(fs.existsSync(f.at('.rasen-store', 'migration', 'coordinators.json'))).toBe(false);

    const migratedChange = f.at('rasen', 'projects', PROJECT, 'changes', PROJECT_CHANGE);
    expect(relativeFiles(migratedChange)).toEqual(['.openspec.yaml', 'proposal.md']);
    const migratedChangeBytes = relativeFiles(migratedChange)
      .map((relative) => fs.readFileSync(path.join(migratedChange, ...relative.split('/')), 'utf8'))
      .join('\n');
    expect(migratedChangeBytes).not.toContain(ACTIVE);
    expect(migratedChangeBytes).not.toMatch(/issueId|acceptance|Dispatch/iu);
    expect(snapshotDirectory(memberRepository.root)).toEqual(memberRepository.before);
  }, 300_000);

  it('runs the CLI preview/apply/read/receipt/retirement journey with human/JSON parity', async () => {
    const env = cliEnv(f);
    const preview = await runCLI(
      ['store', 'migrate-layout', MIGRATION_FIXTURE_STORE_ID, '--mapping', MAPPING, '--json'],
      { cwd: f.storeRoot, env }
    );
    expect(preview.exitCode, preview.stderr).toBe(0);
    const previewJson = parseJson(preview);
    expect(previewJson).toMatchObject({ applicable: true, schemaVersion: 2 });
    expect(previewJson.token).toMatchObject({ planId: previewJson.planId });
    const noPlanPreview = previewJson.items.find(
      (item: { disposition?: { issueId?: string } }) => item.disposition?.issueId === NO_PLAN
    );
    expect(noPlanPreview.continuation).toMatchObject({
      code: 'migration_issue_plan_absent',
      message: 'no plan supplied; no nodes invented',
    });

    const human = await runCLI(
      ['store', 'migrate-layout', MIGRATION_FIXTURE_STORE_ID, '--mapping', MAPPING],
      { cwd: f.storeRoot, env }
    );
    expect(human.exitCode, human.stderr).toBe(0);
    for (const item of previewJson.items as Array<{ name: string; reason: string }>) {
      expect(human.stdout).toContain(item.name);
      expect(human.stdout).toContain(item.reason);
    }
    expect(human.stdout).toContain(noPlanPreview.continuation.code);
    expect(human.stdout).toContain(noPlanPreview.continuation.command);

    const applied = await runCLI(
      [
        'store',
        'migrate-layout',
        MIGRATION_FIXTURE_STORE_ID,
        '--mapping',
        MAPPING,
        '--apply',
        '--json',
      ],
      { cwd: f.storeRoot, env }
    );
    expect(applied.exitCode, `${applied.stdout}\n${applied.stderr}`).toBe(0);
    const appliedJson = parseJson(applied);
    expect(appliedJson.phase).toBe('published');
    expect(appliedJson.suggestedCommits).toEqual([
      expect.objectContaining({
        pathspecs: ['rasen', '.rasen-store'],
        command: expect.stringContaining('add -- rasen .rasen-store'),
      }),
    ]);

    const shown = await runCLI(
      ['store', 'issue', 'show', ACTIVE, '--store', MIGRATION_FIXTURE_STORE_ID, '--json'],
      { cwd: f.storeRoot, env }
    );
    expect(shown.exitCode, shown.stderr).toBe(0);
    expect(parseJson(shown)).toMatchObject({
      issue: {
        record: { id: ACTIVE, state: 'open' },
        latestRevisionId: '0001',
      },
    });
    const noPlanShown = await runCLI(
      ['store', 'issue', 'show', NO_PLAN, '--store', MIGRATION_FIXTURE_STORE_ID, '--json'],
      { cwd: f.storeRoot, env }
    );
    expect(parseJson(noPlanShown)).toMatchObject({
      issue: { record: { id: NO_PLAN, state: 'open' }, latestRevisionId: null },
    });

    const identity = fs.readFileSync(
      f.at('rasen', 'projects', 'scene-bridge', 'changes', 'scene-render-worker', '.openspec.yaml'),
      'utf8'
    );
    expect(identity).toMatch(/instanceId: ci_[0-9a-f]{64}/u);
    const revision = parseExecutionPlanRevision(
      fs.readFileSync(f.issueAt(ACTIVE, 'plans', '0001.yaml'), 'utf8'),
      { verifyDigest: true }
    );
    expect(revision.nodes[0]).toMatchObject({
      kind: 'change',
      projectId: 'scene-bridge',
      targetLineId: 'line-0.1',
      changeInstanceId: expect.stringMatching(/^ci_[0-9a-f]{64}$/u),
    });
    const receipt = JSON.parse(
      fs.readFileSync(appliedJson.receiptPath, 'utf8')
    ) as { schemaVersion: number; planId: string; conversions: unknown[] };
    expect(receipt).toMatchObject({
      schemaVersion: 2,
      planId: appliedJson.planId,
      conversions: expect.arrayContaining([
        expect.objectContaining({ issue: expect.objectContaining({ id: ACTIVE }) }),
      ]),
    });

    const retired = await runCLI(
      ['store', 'migrate-layout', MIGRATION_FIXTURE_STORE_ID, '--retire-flat', '--json'],
      { cwd: f.storeRoot, env }
    );
    expect(retired.exitCode, retired.stderr).toBe(0);
    expect(parseJson(retired)).toMatchObject({ phase: 'retired' });
    expect(fs.existsSync(f.at('rasen', 'changes', ACTIVE))).toBe(false);
    expect(fs.existsSync(f.issueAt(ACTIVE, 'issue.yaml'))).toBe(true);
  }, 300_000);
});
