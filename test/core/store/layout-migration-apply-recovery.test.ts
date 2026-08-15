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

import { getGlobalDataDir, registerStore } from '../../../src/core/index.js';
import { writeStoreMetadataState } from '../../../src/core/store/foundation.js';
import { writeStoreProjectRecord } from '../../../src/core/store/project-records.js';
import {
  StoreLayoutMigration,
  productionStoreLayoutMigrationDependencies,
  withDeterministicIdentity,
  type StoreLayoutMigrationDependencies,
} from '../../../src/core/store/layout-migration/index.js';
import { createOpenSpecRoot, writeSpec } from '../../helpers/rasen-fixtures.js';
import { isolatedGitEnv } from '../../helpers/store-git.js';
import { snapshotDirectory } from '../../helpers/fs-snapshot.js';

const STORE_UID = '11111111-2222-4333-8444-666666666666';
const STORE_ID = 'team-store';
const PROJECT_ID = 'elftia';
const TARGET_LINE = 'line-0.2';

/** Where the injected failure fires. */
interface Injection {
  /** Throw from `copyTree` when the destination ends with this suffix. */
  readonly failCopyTo?: string;
  /**
   * Corrupt one file inside the copied tree instead of failing, to break digest
   * verification. The value is `<copy destination suffix>|<file inside it>`.
   */
  readonly corruptAfterCopyTo?: readonly [string, string];
  /** Throw from `rename` when the destination ends with this suffix. */
  readonly failRenameTo?: string;
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
    token: NonNullable<Awaited<ReturnType<StoreLayoutMigration['plan']>>['token']>;
  }> {
    const plan = await instance.plan(input({ mappingPath: 'rasen/mapping.yaml' }));
    expect(plan.blockers).toEqual([]);
    expect(plan.applicable).toBe(true);
    expect(plan.token).toBeDefined();
    return { token: plan.token as never };
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
