/**
 * Task 6.9 — staging, publication, retirement and rollback under INJECTED
 * failure.
 *
 * The contract these cases exist to hold is a single sentence from design
 * decision 9: at every instant a reader sees either a fully readable
 * pre-publication state (legacy flat Store, intact flat tree) or one complete
 * published state (layout v2, complete partitions) — never a partial tree. The
 * `layoutVersion: 2` flip is the only linearization point, so "did the flip
 * happen?" is the question every assertion below turns on.
 *
 * Failures are injected through the Module's own filesystem adapter, which is
 * local-substitutable by design (decision 14). Nothing here reaches inside the
 * Module.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getGlobalDataDir,
  registerStore,
  unregisterStoreRegistration,
} from '../../../src/core/index.js';
import { writeStoreMetadataState } from '../../../src/core/store/foundation.js';
import { productionStoreIssueDependencies } from '../../../src/core/store/issues/dependencies.js';
import { deriveLegacyIssueUid } from '../../../src/core/store/issues/identity.js';
import { issueLockKey, withIssueLock } from '../../../src/core/store/issues/locks.js';
import { StoreIssuesModule } from '../../../src/core/store/issues/module.js';
import { StoreQueryModuleImpl } from '../../../src/core/store/query/module.js';
import { writeStoreProjectRecord } from '../../../src/core/store/project-records.js';
import {
  StoreLayoutMigration,
  productionStoreLayoutMigrationDependencies,
  readRecoveryManifest,
  withDeterministicIdentity,
  type ImmutableMigrationPlan,
  type LayoutMigrationCheckpoint,
  type StoreLayoutMigrationDependencies,
} from '../../../src/core/store/layout-migration/index.js';
import { createOpenSpecRoot, writeSpec } from '../../helpers/rasen-fixtures.js';
import { isolatedGitEnv } from '../../helpers/store-git.js';
import { verifyRecoveryOperationOwnership } from '../../../src/core/store/layout-migration/apply.js';
import { snapshotDirectory } from '../../helpers/fs-snapshot.js';

const STORE_UID = '11111111-2222-4333-8444-666666666666';
const STORE_ID = 'team-store';
const PROJECT_ID = 'elftia';
const TARGET_LINE = 'line-0.2';

/** Where the injected failure fires. */
interface Injection {
  /** Observe, pause, or fail one semantic protocol boundary. */
  readonly checkpoint?: (event: LayoutMigrationCheckpoint) => Promise<void>;
  /** Throw from `copyTree` when the destination ends with this suffix. */
  readonly failCopyTo?: string;
  /**
   * Corrupt one file inside the copied tree instead of failing, to break digest
   * verification. The value is `<copy destination suffix>|<file inside it>`.
   */
  readonly corruptAfterCopyTo?: readonly [string, string];
  /** Throw from `rename` when the destination ends with this suffix. */
  readonly failRenameTo?: string;
  /** Rename successfully, then emulate process death before completion marking. */
  readonly failAfterRenameTo?: string;
  /** Throw from `writeText` when the target ends with this suffix. */
  readonly failWriteTo?: string;
  /** Throw from `removeTree` when the target ends with this suffix. */
  readonly failRemoveTo?: string;
}

function endsWithSegments(target: string, suffix: string): boolean {
  return target.split(path.sep).join('/').endsWith(suffix);
}

/** Every FILE below `root`, relative and sorted. Empty directories are not files. */
function filesUnder(root: string): string[] {
  const found: string[] = [];
  const walk = (current: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(current, entry.name), relative);
      else found.push(relative);
    }
  };
  walk(root, '');
  return found.sort();
}

/**
 * A filesystem adapter that fails exactly once, at a named step. Failing once
 * rather than always is deliberate: the recovery path that runs afterwards
 * needs a working filesystem, and a rollback that only passes because every
 * write is broken proves nothing.
 */
function injectingFs(
  base: StoreLayoutMigrationDependencies,
  injection: Injection
): StoreLayoutMigrationDependencies {
  let fired = false;
  const trip = (): boolean => {
    if (fired) return false;
    fired = true;
    return true;
  };
  return {
    ...base,
    async checkpoint(event) {
      await base.checkpoint(event);
      await injection.checkpoint?.(event);
    },
    fs: {
      ...base.fs,
      async copyTree(source, destination) {
        if (injection.failCopyTo && endsWithSegments(destination, injection.failCopyTo) && trip()) {
          throw new Error(`injected copy failure at ${destination}`);
        }
        await base.fs.copyTree(source, destination);
        if (
          injection.corruptAfterCopyTo &&
          endsWithSegments(destination, injection.corruptAfterCopyTo[0]) &&
          trip()
        ) {
          fs.writeFileSync(
            path.join(destination, injection.corruptAfterCopyTo[1]),
            'corrupted after staging\n',
            'utf8'
          );
        }
      },
      async rename(source, destination) {
        if (
          injection.failRenameTo &&
          endsWithSegments(destination, injection.failRenameTo) &&
          trip()
        ) {
          throw new Error(`injected rename failure at ${destination}`);
        }
        await base.fs.rename(source, destination);
        if (
          injection.failAfterRenameTo &&
          endsWithSegments(destination, injection.failAfterRenameTo) &&
          trip()
        ) {
          throw new Error(`injected after-rename crash at ${destination}`);
        }
      },
      async writeText(target, content) {
        if (injection.failWriteTo && endsWithSegments(target, injection.failWriteTo) && trip()) {
          throw new Error(`injected write failure at ${target}`);
        }
        await base.fs.writeText(target, content);
      },
      async removeTree(target) {
        if (injection.failRemoveTo && endsWithSegments(target, injection.failRemoveTo) && trip()) {
          throw new Error(`injected remove failure at ${target}`);
        }
        await base.fs.removeTree(target);
      },
    },
  };
}

describe('store layout v2 migration — apply, recovery, and retirement', () => {
  let tempDir: string;
  let globalDataDir: string;
  let storeRoot: string;
  let gitEnv: NodeJS.ProcessEnv;
  let savedXdg: string | undefined;
  let savedRasenHome: string | undefined;

  function git(...args: string[]): void {
    execFileSync('git', ['-C', storeRoot, ...args], {
      env: { ...process.env, ...gitEnv },
      windowsHide: true,
      stdio: 'pipe',
    });
  }

  function migration(injection: Injection = {}): StoreLayoutMigration {
    return new StoreLayoutMigration(
      injectingFs(
        withDeterministicIdentity(productionStoreLayoutMigrationDependencies, {
          now: '2026-08-07T00:00:00.000Z',
        }),
        injection
      ),
      { globalDataDir }
    );
  }

  function input(overrides: Record<string, unknown> = {}): never {
    return {
      storeSelector: STORE_ID,
      startPath: storeRoot,
      globalDataDir,
      ...overrides,
    } as never;
  }

  /** The literal layout v2 addresses; never computed through the contract under test. */
  const at = {
    metadata: (): string => path.join(storeRoot, '.rasen-store', 'store.yaml'),
    catalog: (): string => path.join(storeRoot, '.rasen-store', 'projects', `${PROJECT_ID}.yaml`),
    targetLine: (): string =>
      path.join(storeRoot, '.rasen-store', 'target-lines', `${TARGET_LINE}.yaml`),
    receipts: (): string => path.join(storeRoot, '.rasen-store', 'migration', 'receipts'),
    partitionSpec: (): string =>
      path.join(storeRoot, 'rasen', 'projects', PROJECT_ID, 'specs', 'billing', 'spec.md'),
    partitionChange: (): string =>
      path.join(storeRoot, 'rasen', 'projects', PROJECT_ID, 'changes', 'fix-a', 'proposal.md'),
    flatSpec: (): string => path.join(storeRoot, 'rasen', 'specs', 'billing', 'spec.md'),
    flatChange: (): string => path.join(storeRoot, 'rasen', 'changes', 'fix-a', 'proposal.md'),
  };

  function declaredLayoutVersion(): string {
    return fs.readFileSync(at.metadata(), 'utf8');
  }

  function receiptCount(): number {
    try {
      return fs.readdirSync(at.receipts()).length;
    } catch {
      return 0;
    }
  }

  /** Every reader still sees a legacy flat Store holding its complete flat tree. */
  function expectFullyReadablePrePublicationState(): void {
    expect(declaredLayoutVersion()).not.toContain('layoutVersion: 2');
    expect(fs.readFileSync(at.flatSpec(), 'utf8')).toBe('# billing\n');
    expect(fs.readFileSync(at.flatChange(), 'utf8')).toBe('# fix-a\n');
    expect(fs.readFileSync(at.catalog(), 'utf8')).toContain('version: 1');
    expect(receiptCount()).toBe(0);
  }

  /** Every reader sees layout v2 with the complete partition behind it. */
  function expectCompletePublishedState(): void {
    expect(declaredLayoutVersion()).toContain('layoutVersion: 2');
    expect(fs.readFileSync(at.partitionSpec(), 'utf8')).toBe('# billing\n');
    expect(fs.readFileSync(at.partitionChange(), 'utf8')).toBe('# fix-a\n');
    expect(fs.readFileSync(at.catalog(), 'utf8')).toContain('version: 2');
    expect(fs.existsSync(at.targetLine())).toBe(true);
    expect(receiptCount()).toBe(1);
  }

  async function applicablePlan(instance = migration()): Promise<{
    plan: ImmutableMigrationPlan;
    token: NonNullable<Awaited<ReturnType<StoreLayoutMigration['plan']>>['token']>;
  }> {
    const plan = await instance.plan(input({ mappingPath: 'rasen/mapping.yaml' }));
    expect(plan.blockers).toEqual([]);
    expect(plan.applicable).toBe(true);
    expect(plan.token).toBeDefined();
    return { plan, token: plan.token as never };
  }

  async function coordinatorPlan(
    instance: StoreLayoutMigration,
    issueIds: readonly string[] = ['release-coordinator']
  ): Promise<{
    plan: ImmutableMigrationPlan;
    token: NonNullable<ImmutableMigrationPlan['token']>;
  }> {
    for (const issueId of issueIds) {
      const coordinator = path.join(storeRoot, 'rasen', 'changes', issueId);
      fs.mkdirSync(coordinator, { recursive: true });
      fs.writeFileSync(path.join(coordinator, 'proposal.md'), `# legacy ${issueId}\n`, 'utf8');
    }
    const declarations = issueIds.flatMap((issueId) => [
      `  ${issueId}:`,
      '    kind: store-issue',
      `    issueId: ${issueId}`,
      `    title: Coordinate ${issueId}`,
    ]);
    fs.writeFileSync(
      path.join(storeRoot, 'rasen', 'mapping.yaml'),
      [
        'version: 2',
        `defaultTargetLine: ${TARGET_LINE}`,
        'targetLines:',
        `  ${TARGET_LINE}:`,
        '    storeRef: refs/heads/main',
        '    projects:',
        `      ${PROJECT_ID}:`,
        '        codeRef: refs/heads/main',
        'changes:',
        ...declarations,
        '',
      ].join('\n'),
      'utf8'
    );
    git('add', '-A');
    git('commit', '-m', 'declare coordinator conversion');
    const plan = await instance.plan(input({ mappingPath: 'rasen/mapping.yaml' }));
    expect(plan.schemaVersion).toBe(2);
    expect(plan.applicable).toBe(true);
    expect(plan.token).toBeDefined();
    return { plan, token: plan.token as NonNullable<ImmutableMigrationPlan['token']> };
  }

  beforeEach(async () => {
    tempDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-layout-apply-'))
    );
    savedXdg = process.env.XDG_DATA_HOME;
    savedRasenHome = process.env.RASEN_HOME;
    delete process.env.RASEN_HOME;
    process.env.XDG_DATA_HOME = path.join(tempDir, 'data');
    globalDataDir = getGlobalDataDir({ env: process.env });
    gitEnv = isolatedGitEnv(tempDir);

    storeRoot = path.join(tempDir, 'team-store');
    createOpenSpecRoot(storeRoot);
    await writeStoreMetadataState(storeRoot, {
      version: 2,
      uid: STORE_UID,
      id: STORE_ID,
    });
    await registerStore({ id: STORE_ID, localPath: storeRoot, globalDataDir });
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId: PROJECT_ID,
      roles: { planning: true, knowledge: true },
      adoption: {
        specs: ['billing'],
        changes: ['fix-a'],
        adoptedAt: '2026-01-02T03:04:05.000Z',
      },
    });
    writeSpec(storeRoot, 'billing', '# billing\n');
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'changes', 'fix-a'), { recursive: true });
    fs.writeFileSync(path.join(storeRoot, 'rasen', 'changes', 'fix-a', 'proposal.md'), '# fix-a\n');
    fs.writeFileSync(
      path.join(storeRoot, 'rasen', 'mapping.yaml'),
      [
        'version: 1',
        `defaultTargetLine: ${TARGET_LINE}`,
        'targetLines:',
        `  ${TARGET_LINE}:`,
        '    storeRef: refs/heads/main',
        '    projects:',
        `      ${PROJECT_ID}:`,
        '        codeRef: refs/heads/main',
        '',
      ].join('\n'),
      'utf8'
    );

    execFileSync('git', ['init', '-b', 'main', storeRoot], {
      env: { ...process.env, ...gitEnv },
      windowsHide: true,
      stdio: 'pipe',
    });
    git('add', '-A');
    git('commit', '-m', 'seed legacy flat store');
  });

  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedXdg;
    if (savedRasenHome === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = savedRasenHome;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('publishes the whole tree and retires it, as the baseline the failures are measured against', async () => {
    const { token } = await applicablePlan();
    const result = await migration().apply(token);

    expect(result.phase).toBe('published');
    expectCompletePublishedState();
    // Sources are COPIED, not moved: the flat tree survives publication and is
    // only removed by the separate retirement step.
    expect(fs.existsSync(at.flatSpec())).toBe(true);
    expect(result.suggestedCommits).toHaveLength(1);

    const retired = await migration().recover(input({ action: 'retire-flat' }));
    expect(retired.phase).toBe('retired');
    expect(fs.existsSync(path.join(storeRoot, 'rasen', 'specs'))).toBe(false);
    expectCompletePublishedState();
  });

  it('publishes generated Issue bytes without copying the legacy coordinator tree', async () => {
    const coordinator = path.join(storeRoot, 'rasen', 'changes', 'release-coordinator');
    fs.mkdirSync(coordinator, { recursive: true });
    fs.writeFileSync(path.join(coordinator, 'proposal.md'), '# legacy coordinator\n', 'utf8');
    fs.writeFileSync(
      path.join(storeRoot, 'rasen', 'mapping.yaml'),
      [
        'version: 2',
        `defaultTargetLine: ${TARGET_LINE}`,
        'targetLines:',
        `  ${TARGET_LINE}:`,
        '    storeRef: refs/heads/main',
        '    projects:',
        `      ${PROJECT_ID}:`,
        '        codeRef: refs/heads/main',
        'changes:',
        '  release-coordinator:',
        '    kind: store-issue',
        '    issueId: release-coordinator',
        '    title: Coordinate the release',
        '',
      ].join('\n'),
      'utf8'
    );
    git('add', '-A');
    git('commit', '-m', 'declare coordinator conversion');

    const instance = migration();
    const plan = await instance.plan(input({ mappingPath: 'rasen/mapping.yaml' }));
    expect(plan.schemaVersion).toBe(2);
    await instance.apply(plan.token!);

    const issueRoot = path.join(storeRoot, 'rasen', 'issues', 'release-coordinator');
    expect(fs.readFileSync(path.join(issueRoot, 'issue.yaml'), 'utf8')).toContain(
      'title: Coordinate the release'
    );
    expect(fs.existsSync(path.join(issueRoot, 'proposal.md'))).toBe(false);
    expect(fs.readFileSync(path.join(coordinator, 'proposal.md'), 'utf8')).toBe(
      '# legacy coordinator\n'
    );
    const receiptName = fs.readdirSync(at.receipts())[0]!;
    const receipt = JSON.parse(
      fs.readFileSync(path.join(at.receipts(), receiptName), 'utf8')
    ) as Record<string, unknown>;
    expect(receipt).toMatchObject({
      schemaVersion: 2,
      sourceRevision: {
        repositoryKind: 'store',
        role: 'planning-source',
        storeUid: STORE_UID,
        ref: 'refs/heads/main',
      },
      conversions: [
        {
          source: { lifecycle: 'active-change', alias: 'release-coordinator' },
          issue: { id: 'release-coordinator', state: 'open' },
        },
      ],
    });
    expect(JSON.stringify(receipt)).not.toContain('codeCommit');

    const query = new StoreQueryModuleImpl();
    const queryInput = { store: STORE_ID, startPath: storeRoot, globalDataDir };
    const legacyUid = deriveLegacyIssueUid(STORE_UID, 'release-coordinator');
    expect((await query.listIssues(queryInput)).issues).toEqual([
      expect.objectContaining({
        issueId: legacyUid,
        record: expect.objectContaining({ state: 'open' }),
        latestRevisionId: null,
        uncommitted: true,
      }),
    ]);
    expect((await query.showIssue({ ...queryInput, issueId: 'release-coordinator' })).issue.record)
      .toMatchObject({ title: 'Coordinate the release', state: 'open' });

    const issues = new StoreIssuesModule();
    await issues.publishPlan({
      ...queryInput,
      issueId: 'release-coordinator',
      nodes: [
        {
          nodeId: 'docs',
          kind: 'intent',
          projectId: PROJECT_ID,
          targetLineId: TARGET_LINE,
          summary: 'Publish the integration guide',
        },
      ],
    });
    expect(
      (await query.resolveExecutionPlan({ ...queryInput, issueId: 'release-coordinator' }))
        .revision
    ).toMatchObject({ revisionId: '0001' });

    await issues.setState({
      ...queryInput,
      issueId: 'release-coordinator',
      state: 'dropped',
      reason: 'Operator stopped this coordination effort.',
    });
    expect((await query.showIssue({ ...queryInput, issueId: 'release-coordinator' })).issue.record)
      .toMatchObject({ state: 'dropped' });
    expect(
      (JSON.parse(fs.readFileSync(path.join(at.receipts(), receiptName), 'utf8')) as {
        conversions: Array<{ issue: { state: string } }>;
      }).conversions[0]?.issue.state
    ).toBe('open');
  }, 120_000);

  it('preserves non-ASCII mapping, plan, source, title, recovery, receipt, and Git provenance', async () => {
    const sourceAlias = '跨项目协调';
    const mappingRelative = 'rasen/迁移映射.yaml';
    const planRelative = 'rasen/迁移输入/执行计划.yaml';
    const sourceRelative = `rasen/changes/${sourceAlias}`;
    const sourceBody = '# 协调发布 — Ãurea âncora\n';
    const coordinator = path.join(storeRoot, ...sourceRelative.split('/'));
    fs.mkdirSync(coordinator, { recursive: true });
    fs.writeFileSync(path.join(coordinator, 'proposal.md'), sourceBody, 'utf8');
    const planPath = path.join(storeRoot, ...planRelative.split('/'));
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(
      planPath,
      [
        'nodes:',
        '  - nodeId: guide',
        '    kind: intent',
        `    projectId: ${PROJECT_ID}`,
        `    targetLineId: ${TARGET_LINE}`,
        '    summary: 发布中文集成指南',
        '    dependsOn: []',
        '',
      ].join('\n'),
      'utf8'
    );
    fs.writeFileSync(
      path.join(storeRoot, ...mappingRelative.split('/')),
      [
        'version: 2',
        `defaultTargetLine: ${TARGET_LINE}`,
        'targetLines:',
        `  ${TARGET_LINE}:`,
        '    storeRef: refs/heads/main',
        '    projects:',
        `      ${PROJECT_ID}:`,
        '        codeRef: refs/heads/main',
        'changes:',
        `  ${sourceAlias}:`,
        '    kind: store-issue',
        '    issueId: release-coordinator',
        '    title: 协调跨项目发布',
        `    plan: ${planRelative}`,
        '',
      ].join('\n'),
      'utf8'
    );
    git('add', '-A');
    git('commit', '-m', 'declare non-ASCII coordinator conversion');

    let crashed = false;
    const interrupted = migration({
      checkpoint: async (event) => {
        if (!crashed && event.kind === 'operation-renamed' && event.operationKind === 'issue-tree') {
          crashed = true;
          throw new Error('injected non-ASCII recovery crash');
        }
      },
    });
    const plan = await interrupted.plan(input({ mappingPath: mappingRelative }));
    await expect(interrupted.apply(plan.token!)).rejects.toThrow(/non-ASCII recovery crash/u);
    await expect(migration().recover(input({ action: 'resume' }))).resolves.toMatchObject({
      phase: 'published',
    });

    const issueRoot = path.join(storeRoot, 'rasen', 'issues', 'release-coordinator');
    expect(fs.readFileSync(path.join(issueRoot, 'issue.yaml'), 'utf8')).toContain(
      'title: 协调跨项目发布'
    );
    expect(fs.readFileSync(path.join(issueRoot, 'plans', '0001.yaml'), 'utf8')).toContain(
      'summary: 发布中文集成指南'
    );
    const receiptName = fs.readdirSync(at.receipts())[0]!;
    const receipt = JSON.parse(
      fs.readFileSync(path.join(at.receipts(), receiptName), 'utf8')
    ) as {
      mapping: { path: string };
      conversions: Array<{
        source: { alias: string; path: string; digest: string };
        planInput: { path: string };
      }>;
    };
    expect(receipt.mapping.path).toBe(mappingRelative);
    expect(receipt.conversions[0]?.source).toMatchObject({
      alias: sourceAlias,
      path: sourceRelative,
      digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(receipt.conversions[0]?.planInput.path).toBe(planRelative);

    await migration().recover(input({ action: 'retire-flat' }));
    expect(fs.existsSync(coordinator)).toBe(false);
    const restored = execFileSync(
      'git',
      ['-C', storeRoot, 'show', `HEAD:${sourceRelative}/proposal.md`],
      { env: { ...process.env, ...gitEnv }, windowsHide: true, encoding: 'utf8', stdio: 'pipe' }
    );
    expect(restored).toBe(sourceBody);
  }, 180_000);

  const publicationBarriers: readonly {
    readonly name: string;
    readonly matches: (event: LayoutMigrationCheckpoint) => boolean;
  }[] = [
    {
      name: 'generated destination precondition',
      matches: event => event.kind === 'generated-destination-precondition',
    },
    {
      name: 'prepared Issue operation manifest',
      matches: event =>
        event.kind === 'operation-manifest-write' &&
        event.operationKind === 'issue-tree' &&
        event.status === 'prepared' &&
        event.phase === 'after',
    },
    {
      name: 'Issue destination rename',
      matches: event =>
        event.kind === 'operation-renamed' && event.operationKind === 'issue-tree',
    },
    {
      name: 'Issue completion mark',
      matches: event =>
        event.kind === 'operation-manifest-write' &&
        event.operationKind === 'issue-tree' &&
        event.status === 'completed' &&
        event.phase === 'after',
    },
    {
      name: 'receipt rename',
      matches: event =>
        event.kind === 'operation-renamed' && event.operationKind === 'receipt',
    },
    {
      name: 'layout flip',
      matches: event => event.kind === 'layout-flip' && event.phase === 'after',
    },
    {
      name: 'final durable manifest',
      matches: event =>
        event.kind === 'final-manifest-write' && event.phase === 'after',
    },
  ];

  it.each(publicationBarriers)(
    'holds create/state/plan writes through the $name barrier and releases canonical bytes',
    async ({ matches }) => {
      let announce!: (event: LayoutMigrationCheckpoint) => void;
      let release!: () => void;
      const reached = new Promise<LayoutMigrationCheckpoint>((resolve) => {
        announce = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let paused = false;
      const instance = migration({
        checkpoint: async (event) => {
          if (paused || !matches(event)) return;
          paused = true;
          announce(event);
          await held;
        },
      });
      const { plan, token } = await coordinatorPlan(instance);
      const applyPromise = instance.apply(token);
      await reached;

      const issueId = 'release-coordinator';
      const issueRoot = path.join(storeRoot, 'rasen', 'issues', issueId);
      const existedBefore = fs.existsSync(issueRoot);
      const before = existedBefore ? snapshotDirectory(issueRoot) : null;
      const issues = new StoreIssuesModule();
      const scope = { store: STORE_ID, startPath: storeRoot, globalDataDir, issueId };
      const mutations = await Promise.allSettled([
        issues.create({ ...scope, title: 'racing create' }),
        issues.setState({ ...scope, state: 'resolved' }),
        issues.publishPlan({
          ...scope,
          nodes: [
            {
              nodeId: 'blocked-docs',
              kind: 'intent' as const,
              projectId: PROJECT_ID,
              targetLineId: TARGET_LINE,
              summary: 'Must not publish inside the migration window',
            },
          ],
        }),
      ]);
      expect(mutations.every((result) => result.status === 'rejected')).toBe(true);
      expect(fs.existsSync(issueRoot)).toBe(existedBefore);
      if (before !== null) expect(snapshotDirectory(issueRoot)).toEqual(before);

      release();
      await applyPromise;

      const generated = plan.items.find((item) => item.name === issueId)?.materialization;
      expect(generated?.kind).toBe('generated-tree');
      if (generated?.kind !== 'generated-tree') throw new Error('expected generated Issue');
      for (const file of generated.files) {
        expect(
          fs.readFileSync(
            path.join(issueRoot, file.relativePath.split('/').join(path.sep)),
            'utf8'
          )
        ).toBe(file.content);
      }
      const receiptName = fs.readdirSync(at.receipts())[0]!;
      const receipt = JSON.parse(
        fs.readFileSync(path.join(at.receipts(), receiptName), 'utf8')
      ) as {
        conversions: Array<{
          issue: { id: string };
          outputs: Array<{ path: string; digest: string }>;
        }>;
      };
      expect(receipt.conversions.find((entry) => entry.issue.id === issueId)?.outputs)
        .toEqual(generated.files.map((file) => ({
          role: file.role,
          path: `rasen/issues/${issueId}/${file.relativePath}`,
          schemaVersion: 1,
          digest: file.digest,
        })));

      await expect(issues.create({ ...scope, title: 'late create' })).rejects.toMatchObject({
        issueCode: 'issue_alias_conflict',
      });
      await issues.publishPlan({
        ...scope,
        nodes: [
          {
            nodeId: 'live-docs',
            kind: 'intent',
            projectId: PROJECT_ID,
            targetLineId: TARGET_LINE,
            summary: 'Publish through the canonical live Issue',
          },
        ],
      });
      await issues.setState({ ...scope, state: 'resolved' });
      expect(fs.existsSync(path.join(issueRoot, 'plans', '0001.yaml'))).toBe(true);
      expect(fs.readFileSync(path.join(issueRoot, 'issue.yaml'), 'utf8')).toContain(
        'state: resolved'
      );
    },
    180_000
  );

  it('lets an ordinary create that owns the Issue key first finish, then refuses migration unchanged', async () => {
    const instance = migration();
    const { token } = await coordinatorPlan(instance);
    // Model another writer observing an already-published Store view before
    // this stale migration gets the key. The plan was frozen while flat; the
    // create is now a legal ordinary Issue command and must win unchanged.
    const legacyMetadata = declaredLayoutVersion();
    await writeStoreMetadataState(storeRoot, {
      version: 2,
      uid: STORE_UID,
      id: STORE_ID,
      layoutVersion: 2,
    });
    const issueId = 'release-coordinator';
    const createUid = '22222222-2222-4222-8222-222222222222';
    const recordPath = path.join(storeRoot, 'rasen', 'issues', createUid, 'issue.yaml');
    let announce!: () => void;
    let release!: () => void;
    const writeReached = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let paused = false;
    const creator = new StoreIssuesModule({
      dependencies: {
        ...productionStoreIssueDependencies,
        mintIssueUid: () => createUid,
        fs: {
          ...productionStoreIssueDependencies.fs,
          async writeTextAtomic(target, content, expectedBefore) {
            await productionStoreIssueDependencies.fs.writeTextAtomic!(
              target,
              content,
              expectedBefore
            );
            if (!paused && path.resolve(target) === path.resolve(recordPath)) {
              paused = true;
              announce();
              await held;
            }
          },
        },
      },
    });
    const scope = { store: STORE_ID, startPath: storeRoot, globalDataDir, issueId };
    const createPromise = creator.create({ ...scope, title: 'Created before migration' });
    await writeReached;
    // Restore the exact flat metadata while the creator still owns allocation.
    // The migration must reject the newly claimed alias, not merely the
    // temporary layout flip that made the ordinary create legal.
    fs.writeFileSync(at.metadata(), legacyMetadata, 'utf8');
    const applyPromise = instance.apply(token);
    release();
    await createPromise;
    const before = snapshotDirectory(path.dirname(recordPath));

    await expect(applyPromise).rejects.toThrow(/now identifies/iu);
    expect(snapshotDirectory(path.dirname(recordPath))).toEqual(before);
    expect(fs.readFileSync(recordPath, 'utf8')).toContain('Created before migration');
    expect(declaredLayoutVersion()).toBe(legacyMetadata);
  }, 120_000);

  it('refuses migration when another V2 Issue already owns the projected legacy UID', async () => {
    const instance = migration();
    const { token } = await coordinatorPlan(instance);
    const legacyMetadata = declaredLayoutVersion();
    await writeStoreMetadataState(storeRoot, {
      version: 2,
      uid: STORE_UID,
      id: STORE_ID,
      layoutVersion: 2,
    });

    const issueId = 'release-coordinator';
    const projectedUid = deriveLegacyIssueUid(STORE_UID, issueId);
    const creator = new StoreIssuesModule({
      dependencies: {
        ...productionStoreIssueDependencies,
        mintIssueUid: () => projectedUid,
      },
    });
    await creator.create({
      store: STORE_ID,
      startPath: storeRoot,
      globalDataDir,
      title: 'Allocated under another presentation',
    });
    fs.writeFileSync(at.metadata(), legacyMetadata, 'utf8');

    const ownerRoot = path.join(storeRoot, 'rasen', 'issues', projectedUid);
    const before = snapshotDirectory(ownerRoot);
    await expect(instance.apply(token)).rejects.toThrow(/UID already belongs/iu);

    expect(snapshotDirectory(ownerRoot)).toEqual(before);
    expect(
      fs.existsSync(path.join(storeRoot, 'rasen', 'issues', issueId))
    ).toBe(false);
    expect(declaredLayoutVersion()).toBe(legacyMetadata);
  }, 120_000);

  it('refuses migration when a declared Store ref already owns the generated alias', async () => {
    const issueId = 'release-coordinator';
    const otherUid = '33333333-3333-4333-8333-333333333333';
    const legacyMetadata = declaredLayoutVersion();
    git('switch', '-c', 'release');
    await writeStoreMetadataState(storeRoot, {
      version: 2,
      uid: STORE_UID,
      id: STORE_ID,
      layoutVersion: 2,
    });
    await new StoreIssuesModule({
      dependencies: {
        ...productionStoreIssueDependencies,
        mintIssueUid: () => otherUid,
      },
    }).create({
      store: STORE_ID,
      startPath: storeRoot,
      globalDataDir,
      issueId,
      title: 'Already owned on the release ref',
    });
    fs.writeFileSync(at.metadata(), legacyMetadata, 'utf8');
    git('add', '-A');
    git('commit', '-m', 'claim migration alias on release ref');
    git('switch', 'main');

    const coordinator = path.join(storeRoot, 'rasen', 'changes', issueId);
    fs.mkdirSync(coordinator, { recursive: true });
    fs.writeFileSync(path.join(coordinator, 'proposal.md'), '# legacy coordinator\n', 'utf8');
    fs.writeFileSync(
      path.join(storeRoot, 'rasen', 'mapping.yaml'),
      [
        'version: 2',
        `defaultTargetLine: ${TARGET_LINE}`,
        'targetLines:',
        `  ${TARGET_LINE}:`,
        '    storeRef: refs/heads/release',
        '    projects:',
        `      ${PROJECT_ID}:`,
        '        codeRef: refs/heads/main',
        'changes:',
        `  ${issueId}:`,
        '    kind: store-issue',
        `    issueId: ${issueId}`,
        '    title: Coordinate the release',
        '',
      ].join('\n'),
      'utf8'
    );
    git('add', '-A');
    git('commit', '-m', 'plan coordinator conversion against release ref');

    const instance = migration();
    const plan = await instance.plan(input({ mappingPath: 'rasen/mapping.yaml' }));
    expect(plan.applicable).toBe(true);
    const before = snapshotDirectory(path.join(storeRoot, 'rasen'));
    await expect(instance.apply(plan.token!)).rejects.toThrow(/no longer unique|now identifies/iu);
    expect(snapshotDirectory(path.join(storeRoot, 'rasen'))).toEqual(before);
    expect(fs.existsSync(path.join(storeRoot, 'rasen', 'issues', issueId))).toBe(false);
  }, 120_000);

  it('bounds a second same-ref migration with overlapping Issues and completes the first without deadlock', async () => {
    let announce!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let paused = false;
    const first = migration({
      checkpoint: async (event) => {
        if (paused || event.kind !== 'generated-destination-precondition') return;
        paused = true;
        announce();
        await held;
      },
    });
    const { token } = await coordinatorPlan(first, [
      'release-coordinator',
      'other-coordinator',
    ]);
    const firstApply = first.apply(token);
    await reached;

    await expect(migration().apply(token)).rejects.toThrow(/held by|lock/iu);
    release();
    await expect(firstApply).resolves.toMatchObject({ phase: 'published' });
    expectCompletePublishedState();
    expect(
      fs.existsSync(
        path.join(storeRoot, 'rasen', 'issues', 'other-coordinator', 'issue.yaml')
      )
    ).toBe(true);
  }, 120_000);

  it('coordinates real different-ref migrations with overlapping/disjoint Issues and ordinary commands', async () => {
    const disjointRoot = path.join(tempDir, 'team-store-disjoint');
    const overlapRoot = path.join(tempDir, 'team-store-overlap');
    git('branch', 'disjoint-ref');
    git('branch', 'overlap-ref');
    git('worktree', 'add', disjointRoot, 'disjoint-ref');
    git('worktree', 'add', overlapRoot, 'overlap-ref');

    const registerAt = async (root: string): Promise<void> => {
      await unregisterStoreRegistration({ id: STORE_ID, globalDataDir });
      await registerStore({ id: STORE_ID, localPath: root, globalDataDir });
    };
    const seedCoordinatorRef = (root: string, ref: string, issueId: string): void => {
      const coordinator = path.join(root, 'rasen', 'changes', issueId);
      fs.mkdirSync(coordinator, { recursive: true });
      fs.writeFileSync(path.join(coordinator, 'proposal.md'), `# legacy ${issueId}\n`, 'utf8');
      fs.writeFileSync(
        path.join(root, 'rasen', 'mapping.yaml'),
        [
          'version: 2',
          `defaultTargetLine: ${TARGET_LINE}`,
          'targetLines:',
          `  ${TARGET_LINE}:`,
          `    storeRef: refs/heads/${ref}`,
          '    projects:',
          `      ${PROJECT_ID}:`,
          '        codeRef: refs/heads/main',
          'changes:',
          `  ${issueId}:`,
          '    kind: store-issue',
          `    issueId: ${issueId}`,
          `    title: Coordinate ${issueId}`,
          '',
        ].join('\n'),
        'utf8'
      );
      execFileSync('git', ['-C', root, 'add', '-A'], {
        env: { ...process.env, ...gitEnv },
        windowsHide: true,
        stdio: 'pipe',
      });
      execFileSync('git', ['-C', root, 'commit', '-m', `seed ${ref}`], {
        env: { ...process.env, ...gitEnv },
        windowsHide: true,
        stdio: 'pipe',
      });
    };

    let announce!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let paused = false;
    const mainMigration = migration({
      checkpoint: async (event) => {
        if (paused || event.kind !== 'layout-flip' || event.phase !== 'after') return;
        paused = true;
        announce();
        await held;
      },
    });
    const { token: mainToken } = await coordinatorPlan(mainMigration, ['release-coordinator']);
    const mainApply = mainMigration.apply(mainToken);
    await reached;

    seedCoordinatorRef(disjointRoot, 'disjoint-ref', 'other-coordinator');
    await registerAt(disjointRoot);
    const disjointMigration = migration();
    const disjointPlan = await disjointMigration.plan(
      input({ startPath: disjointRoot, mappingPath: 'rasen/mapping.yaml' })
    );
    expect(disjointPlan.applicable).toBe(true);
    await expect(disjointMigration.apply(disjointPlan.token!)).rejects.toThrow(/held by|lock/iu);
    expect(
      fs.existsSync(path.join(disjointRoot, 'rasen', 'issues', 'other-coordinator'))
    ).toBe(false);

    await registerAt(storeRoot);
    await expect(
      new StoreIssuesModule().setState({
        store: STORE_ID,
        startPath: storeRoot,
        globalDataDir,
        issueId: 'release-coordinator',
        state: 'resolved',
      })
    ).rejects.toThrow(/held by|lock/iu);

    seedCoordinatorRef(overlapRoot, 'overlap-ref', 'release-coordinator');
    await registerAt(overlapRoot);
    const overlapMigration = migration();
    const overlapPlan = await overlapMigration.plan(
      input({ startPath: overlapRoot, mappingPath: 'rasen/mapping.yaml' })
    );
    expect(overlapPlan.applicable).toBe(true);
    await expect(overlapMigration.apply(overlapPlan.token!)).rejects.toThrow(/held by|lock/iu);
    expect(
      fs.existsSync(path.join(overlapRoot, 'rasen', 'issues', 'release-coordinator'))
    ).toBe(false);

    release();
    await expect(mainApply).resolves.toMatchObject({ phase: 'published', ref: 'refs/heads/main' });
    expect(
      fs.existsSync(path.join(storeRoot, 'rasen', 'issues', 'release-coordinator', 'issue.yaml'))
    ).toBe(true);
    await registerAt(disjointRoot);
    await expect(disjointMigration.apply(disjointPlan.token!)).resolves.toMatchObject({
      phase: 'published',
      ref: 'refs/heads/disjoint-ref',
    });
    const disjointIssues = new StoreIssuesModule();
    await disjointIssues.setState({
      store: STORE_ID,
      startPath: disjointRoot,
      globalDataDir,
      issueId: 'other-coordinator',
      state: 'resolved',
    });
    expect(
      fs.readFileSync(
        path.join(disjointRoot, 'rasen', 'issues', 'other-coordinator', 'issue.yaml'),
        'utf8'
      )
    ).toContain('state: resolved');
    await registerAt(storeRoot);
  }, 180_000);

  const prePublicationFaults: readonly {
    readonly name: string;
    readonly issueIds: readonly string[];
    readonly matches: (event: LayoutMigrationCheckpoint) => boolean;
  }[] = [
    {
      name: 'generated file write',
      issueIds: ['release-coordinator'],
      matches: event => event.kind === 'generated-file-write' && event.phase === 'before',
    },
    {
      name: 'generated tree digest verification',
      issueIds: ['release-coordinator'],
      matches: event => event.kind === 'generated-tree-digest-verification',
    },
    {
      name: 'first Issue-batch acquisition',
      issueIds: ['release-coordinator', 'other-coordinator'],
      matches: event => event.kind === 'issue-lock-acquired' && event.index === 0,
    },
    {
      name: 'second Issue-batch acquisition',
      issueIds: ['release-coordinator', 'other-coordinator'],
      matches: event => event.kind === 'issue-lock-acquired' && event.index === 1,
    },
    {
      name: 'migration-run acquisition',
      issueIds: ['release-coordinator'],
      matches: event => event.kind === 'migration-run-acquired',
    },
  ];

  it.each(prePublicationFaults)(
    'releases every acquired lock after an injected $name failure',
    async ({ issueIds, matches, name }) => {
      let fired = false;
      const failing = migration({
        checkpoint: async (event) => {
          if (!fired && matches(event)) {
            fired = true;
            throw new Error(`injected ${name} failure`);
          }
        },
      });
      const { token } = await coordinatorPlan(failing, issueIds);
      await expect(failing.apply(token)).rejects.toThrow(`injected ${name} failure`);
      expect(declaredLayoutVersion()).not.toContain('layoutVersion: 2');
      expect(receiptCount()).toBe(0);

      // A bounded probe immediately reacquires the same first Issue key;
      // success proves partial batch, run-lock, and callback failures all left
      // no held lock behind. Ordinary write behavior at every barrier is
      // covered by the publication-barrier matrix above.
      const issueId = issueIds[0]!;
      let reacquired = false;
      await withIssueLock(
        productionStoreIssueDependencies.coordination(globalDataDir),
        issueLockKey({
          storeUid: STORE_UID,
          issueUid: deriveLegacyIssueUid(STORE_UID, issueId),
        }),
        async () => {
          reacquired = true;
        },
        { deadlineMs: 100, pollMs: 10 }
      );
      expect(reacquired).toBe(true);

      // These failures happen before a durable publication operation exists,
      // so the supported continuation is a fresh apply of the same immutable
      // token. The checkpoint is one-shot; a successful retry proves both the
      // flat-state side of the fault and the absence of leaked run/Issue locks.
      await expect(failing.apply(token)).resolves.toMatchObject({ phase: 'published' });
      expectCompletePublishedState();
      for (const generatedId of issueIds) {
        expect(
          fs.existsSync(path.join(storeRoot, 'rasen', 'issues', generatedId, 'issue.yaml'))
        ).toBe(true);
      }
    },
    120_000
  );

  const publicationFaults: readonly {
    readonly name: string;
    readonly matches: (event: LayoutMigrationCheckpoint) => boolean;
  }[] = [
    {
      name: 'prepared-operation manifest write',
      matches: event =>
        event.kind === 'operation-manifest-write' &&
        event.operationKind === 'issue-tree' &&
        event.status === 'prepared' &&
        event.phase === 'before',
    },
    {
      name: 'prepared-operation durable persist',
      matches: event =>
        event.kind === 'operation-manifest-write' &&
        event.operationKind === 'issue-tree' &&
        event.status === 'prepared' &&
        event.phase === 'after',
    },
    {
      name: 'Issue rename before completion mark',
      matches: event =>
        event.kind === 'operation-renamed' && event.operationKind === 'issue-tree',
    },
    {
      name: 'project tree rename before completion mark',
      matches: event =>
        event.kind === 'operation-renamed' && event.operationKind === 'item',
    },
    {
      name: 'operation completion-mark write',
      matches: event =>
        event.kind === 'operation-manifest-write' &&
        event.operationKind === 'issue-tree' &&
        event.status === 'completed' &&
        event.phase === 'before',
    },
    {
      name: 'receipt rename',
      matches: event =>
        event.kind === 'operation-renamed' && event.operationKind === 'receipt',
    },
    {
      name: 'layout flip',
      matches: event => event.kind === 'layout-flip' && event.phase === 'before',
    },
    {
      name: 'final manifest write',
      matches: event =>
        event.kind === 'final-manifest-write' && event.phase === 'before',
    },
    {
      name: 'final manifest durable persist',
      matches: event =>
        event.kind === 'final-manifest-write' && event.phase === 'after',
    },
  ];

  it.each(publicationFaults)(
    'fresh-process resume completes after an injected $name failure',
    async ({ matches, name }) => {
      let fired = false;
      const interrupted = migration({
        checkpoint: async (event) => {
          if (!fired && matches(event)) {
            fired = true;
            throw new Error(`injected ${name} failure`);
          }
        },
      });
      const { token } = await coordinatorPlan(interrupted);
      await expect(interrupted.apply(token)).rejects.toThrow(`injected ${name} failure`);
      const status = await migration().status(input());
      expect(status.phase).toBe('failed');

      const resumed = await migration().recover(input({ action: 'resume' }));
      expect(resumed.phase).toBe('published');
      expectCompletePublishedState();
      expect(
        fs.existsSync(
          path.join(storeRoot, 'rasen', 'issues', 'release-coordinator', 'issue.yaml')
        )
      ).toBe(true);
    },
    120_000
  );

  it('uses the recover call root for the generated-Issue batch when no constructor root exists', async () => {
    let crashed = false;
    const interrupted = migration({
      checkpoint: async (event) => {
        if (!crashed && event.kind === 'operation-renamed' && event.operationKind === 'issue-tree') {
          crashed = true;
          throw new Error('injected custom-root recovery crash');
        }
      },
    });
    const { token } = await coordinatorPlan(interrupted);
    await expect(interrupted.apply(token)).rejects.toThrow(/custom-root recovery crash/u);

    const restarted = new StoreLayoutMigration(
      injectingFs(
        withDeterministicIdentity(productionStoreLayoutMigrationDependencies, {
          now: '2026-08-07T00:00:00.000Z',
        }),
        {}
      )
    );
    const key = issueLockKey({
      storeUid: STORE_UID,
      issueUid: deriveLegacyIssueUid(STORE_UID, 'release-coordinator'),
    });
    await withIssueLock(
      productionStoreIssueDependencies.coordination(globalDataDir),
      key,
      async () => {
        await expect(
          restarted.recover(input({ action: 'resume', globalDataDir }))
        ).rejects.toThrow(/held by|lock/iu);
      }
    );

    await expect(
      restarted.recover(input({ action: 'resume', globalDataDir }))
    ).resolves.toMatchObject({ phase: 'published' });
    expectCompletePublishedState();
  }, 120_000);

  it('strictly reloads an exact legacy-v1 manifest and resumes it after restart', async () => {
    const { token } = await applicablePlan();
    await expect(
      migration({ failRenameTo: `.rasen-store/target-lines/${TARGET_LINE}.yaml` }).apply(token)
    ).rejects.toThrow(/injected rename failure/u);
    const recorded = await migration().status(input());
    const manifestPath = recorded.manifestPath as string;
    const strengthened = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    const { runId: _runId, operations: _operations, ...baseShape } = strengthened;
    const legacy = { ...baseShape, version: 1 };
    expect(() =>
      readRecoveryManifest({ ...legacy, runId: 'f'.repeat(64) })
    ).toThrow(/invalid|unrecognized/iu);
    fs.writeFileSync(manifestPath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');

    const restarted = migration();
    await expect(restarted.status(input())).resolves.toMatchObject({
      phase: 'failed',
      createdPaths: [],
      publicationComplete: false,
    });
    await expect(restarted.recover(input({ action: 'resume' }))).resolves.toMatchObject({
      phase: 'published',
    });
    expectCompletePublishedState();
    const upgraded = readRecoveryManifest(
      JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown
    );
    expect(upgraded.version).toBe(2);
    expect(upgraded.runId).toMatch(/^[0-9a-f]{64}$/u);
  }, 120_000);

  it('makes the legacy-v1 upgrade immediately restart-safe and a second fresh process publishes remaining entries', async () => {
    const { plan, token } = await applicablePlan();
    await expect(
      migration({ failRenameTo: `rasen/projects/${PROJECT_ID}/specs/billing` }).apply(token)
    ).rejects.toThrow(/injected rename failure/u);
    const recorded = await migration().status(input());
    const manifestPath = recorded.manifestPath as string;
    const strengthened = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    const { runId: _runId, operations: _operations, ...baseShape } = strengthened;
    const legacy = { ...baseShape, version: 1 };
    expect(legacy.createdPaths).toEqual(expect.arrayContaining([at.targetLine()]));
    fs.writeFileSync(manifestPath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');

    let crashed = false;
    const firstRestart = migration({
      checkpoint: async (event) => {
        if (!crashed && event.kind === 'legacy-recovery-upgrade' && event.phase === 'after') {
          crashed = true;
          throw new Error('injected crash after durable legacy upgrade');
        }
      },
    });
    await expect(firstRestart.recover(input({ action: 'resume' }))).rejects.toThrow(
      /crash after durable legacy upgrade/u
    );

    const boundary = readRecoveryManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
    expect(boundary.version).toBe(2);
    const adopted = boundary.operations?.find(
      (operation) => operation.destination === at.targetLine()
    );
    expect(adopted).toMatchObject({
      status: 'completed',
      expectedDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(fs.existsSync(adopted!.destination)).toBe(true);
    expect(fs.existsSync(adopted!.staged)).toBe(false);
    await expect(
      verifyRecoveryOperationOwnership(
        productionStoreLayoutMigrationDependencies,
        boundary,
        plan
      )
    ).resolves.toBeUndefined();

    await expect(migration().recover(input({ action: 'resume' }))).resolves.toMatchObject({
      phase: 'published',
    });
    expectCompletePublishedState();
    expect(fs.readFileSync(at.targetLine(), 'utf8')).toContain(`id: ${TARGET_LINE}`);
    const published = readRecoveryManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
    expect(published.version).toBe(2);
    expect(published.operations?.every((operation) => operation.status === 'completed')).toBe(true);
  }, 120_000);

  it.each([
    'missing recorded destination',
    'unplanned recorded path',
    'duplicate recorded path',
    'wrong-kind recorded content',
    'incompatible receipt state',
  ] as const)(
    'fails closed on legacy-v1 %s without upgrading or mutating unknown bytes',
    async (tamper) => {
      const { token } = await applicablePlan();
      const interruption =
        tamper === 'incompatible receipt state'
          ? { failWriteTo: '.rasen-store/store.yaml' }
          : { failRenameTo: `rasen/projects/${PROJECT_ID}/specs/billing` };
      await expect(migration(interruption).apply(token)).rejects.toThrow(/injected/u);
      const recorded = await migration().status(input());
      const manifestPath = recorded.manifestPath as string;
      const strengthened = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
      const { runId: _runId, operations: _operations, ...baseShape } = strengthened;
      const legacy = { ...baseShape, version: 1 } as Record<string, unknown> & {
        createdPaths: string[];
      };
      const first = legacy.createdPaths[0]!;

      if (tamper === 'missing recorded destination') {
        fs.rmSync(first, { recursive: true, force: true });
      } else if (tamper === 'unplanned recorded path') {
        const foreign = path.join(storeRoot, 'foreign-owned.txt');
        fs.writeFileSync(foreign, 'foreign bytes\n', 'utf8');
        legacy.createdPaths = [...legacy.createdPaths, foreign];
      } else if (tamper === 'duplicate recorded path') {
        legacy.createdPaths = [...legacy.createdPaths, first];
      } else if (tamper === 'wrong-kind recorded content') {
        fs.rmSync(first, { recursive: true, force: true });
        fs.mkdirSync(first, { recursive: true });
        fs.writeFileSync(path.join(first, 'foreign.txt'), 'foreign directory bytes\n', 'utf8');
      } else {
        const receiptPath = legacy.createdPaths.find((candidate) =>
          candidate.includes(`${path.sep}migration${path.sep}receipts${path.sep}`)
        );
        expect(receiptPath).toBeDefined();
        const receipt = JSON.parse(fs.readFileSync(receiptPath!, 'utf8')) as {
          phases: Array<{ phase: string; at: string }>;
        };
        receipt.phases = [{ phase: 'staged', at: '2020-01-01T00:00:00.000Z' }];
        fs.writeFileSync(receiptPath!, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
      }

      const legacyBytes = `${JSON.stringify(legacy, null, 2)}\n`;
      fs.writeFileSync(manifestPath, legacyBytes, 'utf8');
      const before = new Map(
        [...snapshotDirectory(storeRoot)].filter(([relative]) => !relative.startsWith('.rasen/'))
      );
      const expectedCode =
        tamper === 'incompatible receipt state'
          ? 'migration_recovery_digest_mismatch'
          : 'migration_recovery_ambiguous';

      await expect(migration().recover(input({ action: 'resume' }))).rejects.toMatchObject({
        diagnostic: { code: expectedCode, fix: expect.any(String) },
      });
      expect(fs.readFileSync(manifestPath, 'utf8')).toBe(legacyBytes);
      expect(readRecoveryManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))).version).toBe(1);
      const after = new Map(
        [...snapshotDirectory(storeRoot)].filter(([relative]) => !relative.startsWith('.rasen/'))
      );
      expect(after).toEqual(before);
    },
    120_000
  );

  it('rejects mismatched bytes at a legacy-v1 recorded destination without changing them', async () => {
    const { token } = await applicablePlan();
    await expect(
      migration({ failRenameTo: `rasen/projects/${PROJECT_ID}/specs/billing` }).apply(token)
    ).rejects.toThrow(/injected rename failure/u);
    const recorded = await migration().status(input());
    const manifestPath = recorded.manifestPath as string;
    const strengthened = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    const { runId: _runId, operations: _operations, ...baseShape } = strengthened;
    const legacy = { ...baseShape, version: 1 };
    fs.writeFileSync(manifestPath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');
    const foreignBytes = 'version: 1\ntargetLineId: foreign\n';
    fs.writeFileSync(at.targetLine(), foreignBytes, 'utf8');

    await expect(migration().recover(input({ action: 'resume' }))).rejects.toMatchObject({
      diagnostic: { code: 'migration_recovery_digest_mismatch', fix: expect.any(String) },
    });
    expect(fs.readFileSync(at.targetLine(), 'utf8')).toBe(foreignBytes);
    expect(readRecoveryManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))).version).toBe(1);
  }, 120_000);

  it('strictly reloads an exact legacy-v1 manifest and rolls back only its recorded paths', async () => {
    const { token } = await applicablePlan();
    const before = snapshotDirectory(storeRoot);
    await expect(
      migration({ failRenameTo: `rasen/projects/${PROJECT_ID}/specs/billing` }).apply(token)
    ).rejects.toThrow(/injected rename failure/u);
    const recorded = await migration().status(input());
    const manifestPath = recorded.manifestPath as string;
    const strengthened = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    const { runId: _runId, operations: _operations, ...baseShape } = strengthened;
    const legacy = { ...baseShape, version: 1 };
    expect(legacy.createdPaths).toEqual(expect.arrayContaining([at.targetLine()]));
    fs.writeFileSync(manifestPath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');

    await expect(migration().recover(input({ action: 'rollback' }))).resolves.toMatchObject({
      phase: 'rolled-back',
    });
    expectFullyReadablePrePublicationState();
    const after = snapshotDirectory(storeRoot);
    for (const [key, value] of before) {
      expect(after.get(key), `legacy rollback lost or changed ${key}`).toBe(value);
    }
  }, 120_000);

  it('injects plan-input read failure before planning writes any publication state', async () => {
    const coordinator = path.join(storeRoot, 'rasen', 'changes', 'release-coordinator');
    fs.mkdirSync(coordinator, { recursive: true });
    fs.writeFileSync(path.join(coordinator, 'proposal.md'), '# legacy coordinator\n', 'utf8');
    const inputPath = path.join(storeRoot, 'rasen', 'migration-inputs', 'release-plan.yaml');
    fs.mkdirSync(path.dirname(inputPath), { recursive: true });
    fs.writeFileSync(
      inputPath,
      [
        'nodes:',
        '  - nodeId: docs',
        '    kind: intent',
        `    projectId: ${PROJECT_ID}`,
        `    targetLineId: ${TARGET_LINE}`,
        '    summary: Publish docs',
        '',
      ].join('\n'),
      'utf8'
    );
    fs.writeFileSync(
      path.join(storeRoot, 'rasen', 'mapping.yaml'),
      [
        'version: 2',
        `defaultTargetLine: ${TARGET_LINE}`,
        'targetLines:',
        `  ${TARGET_LINE}:`,
        '    storeRef: refs/heads/main',
        '    projects:',
        `      ${PROJECT_ID}:`,
        '        codeRef: refs/heads/main',
        'changes:',
        '  release-coordinator:',
        '    kind: store-issue',
        '    issueId: release-coordinator',
        '    title: Coordinate release',
        '    plan: rasen/migration-inputs/release-plan.yaml',
        '',
      ].join('\n'),
      'utf8'
    );
    git('add', '-A');
    git('commit', '-m', 'declare plan input');
    let fired = false;
    const failing = migration({
      checkpoint: async (event) => {
        if (!fired && event.kind === 'plan-input-read') {
          fired = true;
          throw new Error('injected plan-input read failure');
        }
      },
    });

    await expect(
      failing.plan(input({ mappingPath: 'rasen/mapping.yaml' }))
    ).rejects.toThrow(/injected plan-input read failure/iu);
    expect(declaredLayoutVersion()).not.toContain('layoutVersion: 2');
    expect(receiptCount()).toBe(0);
    expect(fs.existsSync(path.join(storeRoot, 'rasen', 'issues'))).toBe(false);

    const retryPlan = await failing.plan(input({ mappingPath: 'rasen/mapping.yaml' }));
    expect(retryPlan.applicable).toBe(true);
    await expect(failing.apply(retryPlan.token!)).resolves.toMatchObject({ phase: 'published' });
    expect(
      fs.existsSync(
        path.join(storeRoot, 'rasen', 'issues', 'release-coordinator', 'plans', '0001.yaml')
      )
    ).toBe(true);
  }, 120_000);

  it('a failed copy leaves the flat tree fully readable and nothing published', async () => {
    const { token } = await applicablePlan();
    const before = snapshotDirectory(storeRoot);

    await expect(
      migration({ failCopyTo: 'specs/billing' }).apply(token)
    ).rejects.toThrow(/injected copy failure/u);

    expectFullyReadablePrePublicationState();
    expect(fs.existsSync(path.join(storeRoot, 'rasen', 'projects'))).toBe(false);
    // Staging is the only residue, and it is under the machine-local `.rasen/`.
    const after = snapshotDirectory(storeRoot);
    for (const key of after.keys()) {
      if (key.startsWith('.rasen/')) continue;
      expect(before.has(key), `unexpected new path ${key}`).toBe(true);
    }
  });

  it('a staged file that no longer matches its source fails verification before any publication', async () => {
    const { token } = await applicablePlan();

    await expect(
      migration({ corruptAfterCopyTo: ['specs/billing', 'spec.md'] }).apply(token)
    ).rejects.toThrow(/digest|verif|match/iu);

    expectFullyReadablePrePublicationState();
    expect(fs.existsSync(path.join(storeRoot, 'rasen', 'projects'))).toBe(false);
  });

  it.each([
    ['UTF-8 BOM', Buffer.from([0xef, 0xbb, 0xbf, 0x61])],
    ['invalid UTF-8 bytes', Buffer.from([0xff, 0xfe, 0xfd])],
    ['U+FFFD', Buffer.from('title: replacement \uFFFD marker\n', 'utf8')],
    ['mojibake sentinel', Buffer.from('title: FranÃ§ais double decode\n', 'utf8')],
  ] as const)(
    'rejects generated YAML containing %s before publication',
    async (_name, corruptBytes) => {
      let corrupted = false;
      const instance = migration({
        checkpoint: async (event) => {
          if (
            !corrupted &&
            event.kind === 'generated-file-write' &&
            event.phase === 'after'
          ) {
            corrupted = true;
            fs.writeFileSync(event.path, corruptBytes);
          }
        },
      });
      const { token } = await coordinatorPlan(instance);
      await expect(instance.apply(token)).rejects.toThrow(/digest|strict UTF-8|verif/iu);
      expectFullyReadablePrePublicationState();
      expect(
        fs.existsSync(path.join(storeRoot, 'rasen', 'issues', 'release-coordinator'))
      ).toBe(false);
    },
    120_000
  );

  it('a rename that fails mid-publication never flips the layout, and rollback restores the Store exactly', async () => {
    const { token } = await applicablePlan();
    const before = snapshotDirectory(storeRoot);

    // The second partition rename: the first one has already landed, so the
    // partition on disk really is partial when the failure fires.
    await expect(
      migration({ failRenameTo: `rasen/projects/${PROJECT_ID}/specs/billing` }).apply(token)
    ).rejects.toThrow(/injected rename failure/u);

    // The linearization point was never crossed, so every reader still sees a
    // legacy flat Store — even though a target-line catalog and part of the
    // partition are already on disk.
    expect(declaredLayoutVersion()).not.toContain('layoutVersion: 2');
    expect(fs.existsSync(at.partitionChange())).toBe(true);
    expect(fs.existsSync(at.partitionSpec())).toBe(false);
    expect(fs.readFileSync(at.flatSpec(), 'utf8')).toBe('# billing\n');
    expect(fs.readFileSync(at.flatChange(), 'utf8')).toBe('# fix-a\n');

    const status = await migration().status(input());
    expect(status.phase).toBe('failed');
    expect(status.publicationComplete).toBe(false);
    expect(status.failure).toContain('injected rename failure');

    const rolledBack = await migration().recover(input({ action: 'rollback' }));
    expect(rolledBack.phase).toBe('rolled-back');
    // Only manifest-recorded created paths were removed, and the replaced
    // catalog bytes came back verbatim.
    expect(fs.existsSync(at.targetLine())).toBe(false);
    expect(fs.readFileSync(at.catalog(), 'utf8')).toBe(
      before.get(`.rasen-store/projects/${PROJECT_ID}.yaml`)
    );
    expectFullyReadablePrePublicationState();

    const after = snapshotDirectory(storeRoot);
    for (const [key, value] of before) {
      expect(after.get(key), `rollback lost or changed ${key}`).toBe(value);
    }
  });

  it('a fresh process reconciles an after-rename prepared operation by run id and digest', async () => {
    const { token } = await applicablePlan();
    const destinationSuffix = `rasen/projects/${PROJECT_ID}/changes/fix-a`;

    await expect(
      migration({ failAfterRenameTo: destinationSuffix }).apply(token)
    ).rejects.toThrow(/after-rename crash/u);

    expect(fs.existsSync(at.partitionChange())).toBe(true);
    expect(declaredLayoutVersion()).not.toContain('layoutVersion: 2');

    const status = await migration().status(input());
    const manifestRaw = JSON.parse(
      fs.readFileSync(status.manifestPath as string, 'utf8')
    ) as Record<string, unknown>;
    const manifest = readRecoveryManifest(manifestRaw);
    expect(manifest.runId).toMatch(/^[0-9a-f]{64}$/u);
    expect(manifest.runId).not.toBe(manifest.planId);
    expect(manifest.operations?.every(operation => operation.runId === manifest.runId)).toBe(true);
    const unknownField = JSON.parse(JSON.stringify(manifestRaw)) as Record<string, unknown>;
    ((unknownField.operations as Record<string, unknown>[])[0]!).foreign = true;
    expect(() => readRecoveryManifest(unknownField)).toThrow(/invalid|unrecognized/iu);
    const foreignRun = JSON.parse(JSON.stringify(manifestRaw)) as Record<string, unknown>;
    ((foreignRun.operations as Record<string, unknown>[])[0]!).runId = 'f'.repeat(64);
    expect(() => readRecoveryManifest(foreignRun)).toThrow(/foreign prepared operation/iu);

    const resumed = await migration().recover(input({ action: 'resume' }));
    expect(resumed.phase).toBe('published');
    expectCompletePublishedState();
  }, 120_000);

  it.each(['target-line-catalog', 'item', 'issue-tree', 'receipt'] as const)(
    'fresh-process resume reconciles an after-%s-rename crash',
    async (operationKind) => {
      let crashed = false;
      const interrupted = migration({
        checkpoint: async (event) => {
          if (
            !crashed &&
            event.kind === 'operation-renamed' &&
            event.operationKind === operationKind
          ) {
            crashed = true;
            throw new Error(`injected after-${operationKind}-rename crash`);
          }
        },
      });
      const { token } = await coordinatorPlan(interrupted);
      await expect(interrupted.apply(token)).rejects.toThrow(
        new RegExp(`after-${operationKind}-rename`, 'u')
      );

      const status = await migration().status(input());
      const manifest = readRecoveryManifest(
        JSON.parse(fs.readFileSync(status.manifestPath as string, 'utf8')) as unknown
      );
      const prepared = manifest.operations?.find(
        (operation) => operation.kind === operationKind && operation.status === 'prepared'
      );
      expect(prepared).toBeDefined();
      expect(fs.existsSync(prepared!.destination)).toBe(true);
      expect(fs.existsSync(prepared!.staged)).toBe(false);

      const resumed = await migration().recover(input({ action: 'resume' }));
      expect(resumed.phase).toBe('published');
      expectCompletePublishedState();
      expect(
        fs.existsSync(
          path.join(storeRoot, 'rasen', 'issues', 'release-coordinator', 'issue.yaml')
        )
      ).toBe(true);
    },
    120_000
  );

  it.each(['target-line-catalog', 'item', 'issue-tree', 'receipt'] as const)(
    'fresh-process rollback removes an owned after-%s-rename result and preserves flat truth',
    async (operationKind) => {
      let crashed = false;
      const interrupted = migration({
        checkpoint: async (event) => {
          if (
            !crashed &&
            event.kind === 'operation-renamed' &&
            event.operationKind === operationKind
          ) {
            crashed = true;
            throw new Error(`injected after-${operationKind}-rename crash`);
          }
        },
      });
      const { token } = await coordinatorPlan(interrupted);
      await expect(interrupted.apply(token)).rejects.toThrow(
        new RegExp(`after-${operationKind}-rename`, 'u')
      );
      const status = await migration().status(input());
      const manifest = readRecoveryManifest(
        JSON.parse(fs.readFileSync(status.manifestPath as string, 'utf8')) as unknown
      );
      const prepared = manifest.operations?.find(
        (operation) => operation.kind === operationKind && operation.status === 'prepared'
      );
      expect(prepared).toBeDefined();
      expect(fs.existsSync(prepared!.destination)).toBe(true);

      const rolledBack = await migration().recover(input({ action: 'rollback' }));
      expect(rolledBack.phase).toBe('rolled-back');
      expect(fs.existsSync(prepared!.destination)).toBe(false);
      expectFullyReadablePrePublicationState();
    },
    120_000
  );

  it.each(['absent', 'both-present', 'unrecorded', 'digest-mismatch'] as const)(
    'fresh-process resume and rollback block %s recovery state without deletion',
    async (tamper) => {
      let crashed = false;
      const interrupted = migration({
        checkpoint: async (event) => {
          if (
            !crashed &&
            event.kind === 'operation-renamed' &&
            event.operationKind === 'issue-tree'
          ) {
            crashed = true;
            throw new Error('injected after-Issue-rename crash');
          }
        },
      });
      const { token } = await coordinatorPlan(interrupted);
      await expect(interrupted.apply(token)).rejects.toThrow(/after-Issue-rename/iu);
      const status = await migration().status(input());
      const manifestPath = status.manifestPath as string;
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
        operations: Array<{
          kind: string;
          status: string;
          staged: string;
          destination: string;
        }>;
      };
      const operation = raw.operations.find(
        (candidate) => candidate.kind === 'issue-tree' && candidate.status === 'prepared'
      )!;
      if (tamper === 'absent') {
        fs.rmSync(operation.destination, { recursive: true, force: true });
      } else if (tamper === 'both-present') {
        fs.mkdirSync(path.dirname(operation.staged), { recursive: true });
        fs.cpSync(operation.destination, operation.staged, { recursive: true });
      } else if (tamper === 'unrecorded') {
        raw.operations = raw.operations.filter((candidate) => candidate !== operation);
        fs.writeFileSync(manifestPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
      } else {
        fs.appendFileSync(path.join(operation.destination, 'issue.yaml'), '# tampered\n', 'utf8');
      }
      const before = snapshotDirectory(storeRoot);
      const expectedCode =
        tamper === 'digest-mismatch'
          ? 'migration_recovery_digest_mismatch'
          : tamper === 'unrecorded'
            ? 'migration_recovery_unrecorded_destination'
            : 'migration_recovery_ambiguous';

      await expect(migration().recover(input({ action: 'resume' }))).rejects.toMatchObject({
        diagnostic: { code: expectedCode, fix: expect.any(String) },
      });
      expect(snapshotDirectory(storeRoot)).toEqual(before);
      await expect(migration().recover(input({ action: 'rollback' }))).rejects.toMatchObject({
        diagnostic: { code: expectedCode, fix: expect.any(String) },
      });
      expect(snapshotDirectory(storeRoot)).toEqual(before);
    },
    120_000
  );

  it('a failed layout flip leaves the Store legacy-flat and rollback removes every published path', async () => {
    const { token } = await applicablePlan();
    const before = snapshotDirectory(storeRoot);

    await expect(
      migration({ failWriteTo: '.rasen-store/store.yaml' }).apply(token)
    ).rejects.toThrow(/injected write failure/u);

    // Everything else is renamed into place, but the flip is last, so the Store
    // is still legacy flat and the flat tree is still the truth readers see.
    expect(declaredLayoutVersion()).not.toContain('layoutVersion: 2');
    expect(fs.existsSync(at.partitionSpec())).toBe(true);
    expect(fs.readFileSync(at.flatSpec(), 'utf8')).toBe('# billing\n');

    await migration().recover(input({ action: 'rollback' }));

    expectFullyReadablePrePublicationState();
    expect(fs.existsSync(at.targetLine())).toBe(false);
    // Rollback removes only what the manifest proves the run created, so the
    // empty directories `rename` made on the way stay. That is residue, not a
    // partial tree: no file survives under the partition, so no reader can
    // read one, and `store_layout_partition_orphan` reports the shell.
    expect(filesUnder(path.join(storeRoot, 'rasen', 'projects'))).toEqual([]);
    const after = snapshotDirectory(storeRoot);
    for (const [key, value] of before) {
      expect(after.get(key), `rollback lost or changed ${key}`).toBe(value);
    }
  });

  it('a failed retirement leaves one complete published state, and re-running finishes it', async () => {
    const { token } = await applicablePlan();
    await migration().apply(token);

    await expect(
      migration({ failRemoveTo: 'rasen/changes' }).recover(input({ action: 'retire-flat' }))
    ).rejects.toThrow(/injected remove failure/u);

    // Partial retirement is still one complete published state: the partitions
    // are whole and the layout flip stands, so no reader sees a partial tree.
    expectCompletePublishedState();

    const retried = await migration().recover(input({ action: 'retire-flat' }));
    expect(retried.phase).toBe('retired');
    expect(fs.existsSync(path.join(storeRoot, 'rasen', 'specs'))).toBe(false);
    expect(fs.existsSync(path.join(storeRoot, 'rasen', 'changes'))).toBe(false);
    expectCompletePublishedState();
  });

  it('rollback after retirement refuses and names Git as the recovery path', async () => {
    const { token } = await applicablePlan();
    await migration().apply(token);
    await migration().recover(input({ action: 'retire-flat' }));

    await expect(
      migration().recover(input({ action: 'rollback' }))
    ).rejects.toMatchObject({
      diagnostic: {
        code: 'migration_rollback_after_retirement',
        fix: expect.stringContaining('Git'),
      },
    });
    expectCompletePublishedState();
  });

  it('resume after a successful publication is a no-op rather than a second publication', async () => {
    const { token } = await applicablePlan();
    await migration().apply(token);
    const receipt = fs.readdirSync(at.receipts())[0] as string;

    const resumed = await migration().recover(input({ action: 'resume' }));

    expect(resumed.phase).toBe('published');
    expect(resumed.published).toEqual([]);
    expect(fs.readdirSync(at.receipts())).toEqual([receipt]);
    expectCompletePublishedState();
  });
});
