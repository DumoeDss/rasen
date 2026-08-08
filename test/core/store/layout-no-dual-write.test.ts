/**
 * Task 11.3 — no dual writes, as a regression sweep rather than a per-command
 * assertion.
 *
 * Each mutation is run twice, once against a layout v2 Store and once against a
 * legacy flat one, and the whole Store tree is compared before and after. The
 * claim is directional and absolute: a v2 Store never gains a flat root-level
 * `rasen/specs` or `rasen/changes` path, and a flat Store never gains a
 * `rasen/projects` partition — whichever of adopt, eject, relocate, membership
 * write, or migration performed the write.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getGlobalDataDir, registerStore } from '../../../src/core/index.js';
import {
  adoptProject,
  ejectProject,
  relocateArchive,
} from '../../../src/core/store/migration-ops.js';
import { writeMembershipRecord } from '../../../src/core/store/membership.js';
import { writeStoreMetadataState } from '../../../src/core/store/foundation.js';
import { resolveProjectHome } from '../../../src/core/project-home.js';
import {
  createLayoutMigrationFixture,
  targetLineMapping,
  type LayoutMigrationFixture,
} from '../../helpers/layout-migration-fixture.js';
import { createOpenSpecRoot, writeSpec } from '../../helpers/rasen-fixtures.js';

const STORE_ID = 'team-store';
const TARGET_LINE = 'line-0.2';

/** Every path below `rasen/`, Store-relative POSIX, files and directories. */
function planningTree(storeRoot: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = `${prefix}/${entry.name}`;
      found.push(entry.isDirectory() ? `${relative}/` : relative);
      if (entry.isDirectory()) walk(path.join(dir, entry.name), relative);
    }
  };
  walk(path.join(storeRoot, 'rasen'), 'rasen');
  return found.sort();
}

/**
 * Every path below the Store root, `.git` excluded.
 *
 * `planningTree` walks only `rasen/`, and membership records live in
 * `.rasen-store/projects/`. A membership case comparing `planningTree` before
 * and after was therefore true by construction — it would have passed for a
 * writer that did nothing, and for one that wrote the wrong schema. The sweep
 * has to see the write it is making a claim about.
 */
function storeTree(storeRoot: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      found.push(entry.isDirectory() ? `${relative}/` : relative);
      if (entry.isDirectory()) walk(path.join(dir, entry.name), relative);
    }
  };
  walk(storeRoot, '');
  return found.sort();
}

function newPaths(before: readonly string[], after: readonly string[]): string[] {
  const seen = new Set(before);
  return after.filter((entry) => !seen.has(entry));
}

/** The flat root-level namespaces layout v2 retires. */
function flatPlanningPaths(paths: readonly string[]): string[] {
  return paths.filter(
    (entry) => entry.startsWith('rasen/specs') || entry.startsWith('rasen/changes')
  );
}

function partitionPaths(paths: readonly string[]): string[] {
  return paths.filter((entry) => entry.startsWith('rasen/projects'));
}

describe('no dual writes across the Store planning mutations', () => {
  let tempDir: string;
  let globalDataDir: string;
  let storeRoot: string;
  let savedXdg: string | undefined;
  let savedRasenHome: string | undefined;

  beforeEach(async () => {
    tempDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-no-dual-write-'))
    );
    savedXdg = process.env.XDG_DATA_HOME;
    savedRasenHome = process.env.RASEN_HOME;
    delete process.env.RASEN_HOME;
    process.env.XDG_DATA_HOME = path.join(tempDir, 'data');
    globalDataDir = getGlobalDataDir({ env: process.env });

    storeRoot = path.join(tempDir, STORE_ID);
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: STORE_ID, localPath: storeRoot, globalDataDir });
  });

  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedXdg;
    if (savedRasenHome === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = savedRasenHome;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function declareLayoutV2(): Promise<void> {
    await writeStoreMetadataState(storeRoot, {
      version: 1,
      id: STORE_ID,
      layoutVersion: 2,
    });
    const target = path.join(storeRoot, '.rasen-store', 'target-lines', `${TARGET_LINE}.yaml`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      `version: 1\nid: ${TARGET_LINE}\nstoreRef: refs/heads/main\nprojects: {}\n`
    );
  }

  const PROJECT_ID = '9d1f0f3a-8b2c-4a7e-9c11-2f3b4c5d6e70';

  /** The two-repository membership mutation input, as `membership.ts` takes it. */
  function membershipInput(projectRoot: string) {
    return {
      projectRoot,
      projectId: PROJECT_ID,
      projectDisplayId: 'elftia',
      store: { type: 'store' as const, id: STORE_ID, root: storeRoot },
      roles: { planning: false, knowledge: true },
      globalDataDir,
    };
  }

  function makeSource(name = 'my-app'): string {
    const root = path.join(tempDir, name);
    createOpenSpecRoot(root);
    writeSpec(root, 'billing', '## Purpose\n\np\n\n## Requirements\n\n- r\n');
    const changeDir = path.join(root, 'rasen', 'changes', 'add-thing');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# add-thing\n');
    return root;
  }

  it('adopt into a v2 Store writes only partitions, never a flat planning path', async () => {
    await declareLayoutV2();
    const source = makeSource();
    const before = planningTree(storeRoot);

    const adopted = await adoptProject({
      sourcePath: source,
      storeId: STORE_ID,
      globalDataDir,
      targetLine: TARGET_LINE,
    });

    const added = newPaths(before, planningTree(storeRoot));
    expect(flatPlanningPaths(added)).toEqual([]);
    expect(partitionPaths(added)).toContain(`rasen/projects/${adopted.projectId}/specs/billing/`);
  });

  it('eject from a v2 Store removes the partition and writes no flat planning path', async () => {
    await declareLayoutV2();
    const source = makeSource();
    const adopted = await adoptProject({
      sourcePath: source,
      storeId: STORE_ID,
      globalDataDir,
      targetLine: TARGET_LINE,
    });
    const before = planningTree(storeRoot);

    await ejectProject({ projectId: adopted.projectId, storeId: STORE_ID, globalDataDir });

    const after = planningTree(storeRoot);
    expect(flatPlanningPaths(newPaths(before, after))).toEqual([]);
    expect(partitionPaths(after).filter((entry) => entry.includes(adopted.projectId))).toEqual([]);
  });

  it('a membership write into a v2 Store never plants a flat planning path', async () => {
    await declareLayoutV2();
    const before = storeTree(storeRoot);

    await writeMembershipRecord(membershipInput(makeSource('member-v2')));

    const added = newPaths(before, storeTree(storeRoot));
    // The write is VISIBLE to the sweep before anything is claimed about it.
    expect(added).toContain(`.rasen-store/projects/${PROJECT_ID}.yaml`);
    expect(flatPlanningPaths(added)).toEqual([]);
    expect(partitionPaths(added)).toEqual([]);
    // The record itself is a v2 catalog rather than a v1 record; a v1 record
    // inside a v2 Store is precisely what the migration exists to remove.
    expect(
      fs.readFileSync(
        path.join(storeRoot, '.rasen-store', 'projects', `${PROJECT_ID}.yaml`),
        'utf8'
      )
    ).toContain('version: 2');
  });

  it('a membership write into a legacy flat Store never plants a partition', async () => {
    const before = storeTree(storeRoot);

    await writeMembershipRecord(membershipInput(makeSource('member-flat')));

    const added = newPaths(before, storeTree(storeRoot));
    expect(added).toContain(`.rasen-store/projects/${PROJECT_ID}.yaml`);
    expect(partitionPaths(added)).toEqual([]);
    expect(flatPlanningPaths(added)).toEqual([]);
    expect(
      fs.readFileSync(
        path.join(storeRoot, '.rasen-store', 'projects', `${PROJECT_ID}.yaml`),
        'utf8'
      )
    ).toContain('version: 1');
  });

  it('archive relocate --to store lands in the partition and writes no flat archive path', async () => {
    // `--to in-repo` on a standalone project never addresses the Store at all,
    // so asserting the Store gained nothing passed for a no-op `relocateArchive`
    // as readily as for the real one. `--to store` is the relocate direction
    // that WRITES into the Store, so it is the one this sweep must exercise.
    await declareLayoutV2();
    const source = makeSource();
    const adopted = await adoptProject({
      sourcePath: source,
      storeId: STORE_ID,
      globalDataDir,
      targetLine: TARGET_LINE,
    });
    // The pointer repo has no planning shape left after adoption, which is what
    // puts relocate in store mode; the leftover entry lives in the machine home.
    const home = await resolveProjectHome(source, { ensure: true, globalDataDir });
    const entry = path.join(home!.archiveDir, '2026-07-01-old');
    fs.mkdirSync(entry, { recursive: true });
    fs.writeFileSync(path.join(entry, 'proposal.md'), 'old\n');
    const before = storeTree(storeRoot);

    await relocateArchive({
      projectRoot: source,
      to: 'store',
      globalDataDir,
      targetLine: TARGET_LINE,
    });

    const added = newPaths(before, storeTree(storeRoot));
    // The relocation really happened, in the partition's target-line archive.
    expect(added).toContain(
      `rasen/projects/${adopted.projectId}/changes/archive/${TARGET_LINE}/2026-07-01-old/proposal.md`
    );
    expect(flatPlanningPaths(added)).toEqual([]);
    expect(fs.existsSync(path.join(entry, 'proposal.md'))).toBe(false);
  });

  it('archive relocate --to in-repo against a legacy flat Store creates no partition', async () => {
    const source = makeSource();
    const entry = path.join(source, 'rasen', 'changes', 'archive', '2026-07-01-old');
    fs.mkdirSync(entry, { recursive: true });
    fs.writeFileSync(path.join(entry, 'proposal.md'), 'old\n');
    const before = storeTree(storeRoot);

    await relocateArchive({ projectRoot: source, to: 'in-repo', globalDataDir });

    const after = storeTree(storeRoot);
    expect(partitionPaths(after)).toEqual([]);
    expect(newPaths(before, after)).toEqual([]);
    // The project's own archive is where the entry stayed, so the case is
    // about a real relocation rather than about a Store nothing addressed.
    expect(fs.existsSync(path.join(entry, 'proposal.md'))).toBe(true);
  });

  it('adopt into a legacy flat Store is refused, so neither layout is written', async () => {
    const source = makeSource();
    const before = planningTree(storeRoot);

    await expect(
      adoptProject({
        sourcePath: source,
        storeId: STORE_ID,
        globalDataDir,
        targetLine: TARGET_LINE,
      })
    ).rejects.toMatchObject({
      diagnostic: { code: 'legacy_flat_store_requires_migration' },
    });

    expect(newPaths(before, planningTree(storeRoot))).toEqual([]);
    // And the source repo kept its own planning tree.
    expect(fs.existsSync(path.join(source, 'rasen', 'specs', 'billing'))).toBe(true);
  });
});

/**
 * The fifth mutation this suite's docblock names. It was absent, so "whichever
 * of adopt, eject, relocate, membership write, or migration performed the
 * write" was a claim about four of five.
 *
 * Migration is the ONE writer that legitimately holds both layouts, for exactly
 * the window between publication and retirement — so the sweep asserts its END
 * state: every flat planning path is gone and every one of them reappears
 * inside a partition.
 */
describe('no dual writes: the layout migration itself', () => {
  let f: LayoutMigrationFixture;

  beforeEach(async () => {
    f = await createLayoutMigrationFixture('rasen-no-dual-write-migration-');
  });

  afterEach(() => {
    f.cleanup();
  });

  it('leaves a migrated Store with partitions only, and no flat planning path at all', async () => {
    await f.member('elftia', { specs: [], changes: [] });
    f.writeSpec('billing');
    f.writeChange('add-thing');
    f.write(
      'rasen/mapping.yaml',
      targetLineMapping(TARGET_LINE, ['elftia'], [
        'specs:',
        '  billing:',
        '    owner: elftia',
        'changes:',
        '  add-thing:',
        '    project: elftia',
      ])
    );
    f.commitAll();

    const before = storeTree(f.storeRoot);
    expect(flatPlanningPaths(before)).toContain('rasen/specs/billing/spec.md');

    const plan = await f.migration().plan(f.input({ mappingPath: 'rasen/mapping.yaml' }));
    expect(plan.applicable).toBe(true);
    await f.migration().apply(plan.token!);
    await f.migration().recover(f.input({ action: 'retire-flat' }));

    const after = storeTree(f.storeRoot);
    // Directional and absolute: nothing addressable through the retired flat
    // namespace survives, and the content is in the partition instead.
    expect(flatPlanningPaths(after)).toEqual([]);
    expect(partitionPaths(after)).toContain('rasen/projects/elftia/specs/billing/spec.md');
    expect(partitionPaths(after)).toContain(
      'rasen/projects/elftia/changes/add-thing/proposal.md'
    );
  });
});
