/**
 * Task 8.9 — the properties partitioning exists to give, which the general
 * adopt/eject suite in `migration-ops.test.ts` does not cover.
 *
 * That suite proves the mechanics against one partition: destinations,
 * per-partition collisions, the archive target-line requirement, resume,
 * restore, unbinding. What is proved here is what only appears once there are
 * TWO projects or a partition-shaped refusal: that two projects may hold the
 * same Change and spec alias, that eject refuses to flatten a cross-line
 * archive collision, that `--all` and a missing partition are refused, and
 * that a mixed-layout Store refuses adopt outright.
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
import { writeStoreMetadataState } from '../../../src/core/store/foundation.js';
import { readStoreMembership } from '../../../src/core/store/membership-layout.js';
import { resolveProjectHome } from '../../../src/core/project-home.js';
import { createOpenSpecRoot, writeSpec } from '../../helpers/rasen-fixtures.js';

const STORE_ID = 'team-store';
const TARGET_LINE = 'line-0.2';
const OTHER_LINE = 'line-0.3';

function ls(dir: string): string[] {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

describe('store adopt and eject on project partitions', () => {
  let tempDir: string;
  let globalDataDir: string;
  let storeRoot: string;
  let savedXdg: string | undefined;
  let savedRasenHome: string | undefined;

  beforeEach(async () => {
    tempDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-v2-partitions-'))
    );
    savedXdg = process.env.XDG_DATA_HOME;
    savedRasenHome = process.env.RASEN_HOME;
    delete process.env.RASEN_HOME;
    process.env.XDG_DATA_HOME = path.join(tempDir, 'data');
    globalDataDir = getGlobalDataDir({ env: process.env });

    storeRoot = path.join(tempDir, STORE_ID);
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: STORE_ID, localPath: storeRoot, globalDataDir });
    await writeStoreMetadataState(storeRoot, {
      version: 1,
      id: STORE_ID,
      layoutVersion: 2,
    });
    for (const line of [TARGET_LINE, OTHER_LINE]) {
      const target = path.join(storeRoot, '.rasen-store', 'target-lines', `${line}.yaml`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(
        target,
        `version: 1\nid: ${line}\nstoreRef: refs/heads/main\nprojects: {}\n`
      );
    }
  });

  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedXdg;
    if (savedRasenHome === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = savedRasenHome;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /** Literal layout v2 addresses; never computed through the contract under test. */
  function partition(projectId: string, ...segments: string[]): string {
    return path.join(storeRoot, 'rasen', 'projects', projectId, ...segments);
  }

  function makeSource(name: string): string {
    const root = path.join(tempDir, name);
    createOpenSpecRoot(root);
    writeSpec(root, 'billing', '## Purpose\n\np\n\n## Requirements\n\n- r\n');
    const changeDir = path.join(root, 'rasen', 'changes', 'add-thing');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), `# ${name}\n`);
    return root;
  }

  function adopt(sourcePath: string): ReturnType<typeof adoptProject> {
    return adoptProject({
      sourcePath,
      storeId: STORE_ID,
      globalDataDir,
      targetLine: TARGET_LINE,
    });
  }

  function writeArchiveEntry(root: string, ...segments: string[]): void {
    const entry = path.join(root, ...segments);
    fs.mkdirSync(entry, { recursive: true });
    fs.writeFileSync(path.join(entry, 'proposal.md'), `${segments.at(-1)}\n`);
  }

  it('lets two projects hold the same Change and spec alias: that is the point of partitioning', async () => {
    const first = await adopt(makeSource('app-one'));
    const second = await adopt(makeSource('app-two'));

    expect(first.projectId).not.toBe(second.projectId);
    // The identical alias lives once in each partition and nowhere else.
    expect(ls(partition(first.projectId, 'changes'))).toEqual(['add-thing']);
    expect(ls(partition(second.projectId, 'changes'))).toEqual(['add-thing']);
    expect(ls(partition(first.projectId, 'specs'))).toEqual(['billing']);
    expect(ls(partition(second.projectId, 'specs'))).toEqual(['billing']);
    // And the flat namespace gained nothing.
    expect(ls(path.join(storeRoot, 'rasen', 'changes'))).toEqual(['archive']);
    expect(ls(path.join(storeRoot, 'rasen', 'changes', 'archive'))).toEqual([]);
    expect(ls(path.join(storeRoot, 'rasen', 'specs'))).toEqual([]);
  });

  it('refuses to flatten two archive entries that collide across target lines', async () => {
    const source = makeSource('app-one');
    const adopted = await adopt(source);

    // The same entry name under two lines. The in-project layout has no line
    // dimension, so eject would have to overwrite one with the other.
    writeArchiveEntry(
      partition(adopted.projectId, 'changes', 'archive', TARGET_LINE),
      '2026-07-01-old-thing'
    );
    writeArchiveEntry(
      partition(adopted.projectId, 'changes', 'archive', OTHER_LINE),
      '2026-07-01-old-thing'
    );

    await expect(
      ejectProject({ projectId: adopted.projectId, storeId: STORE_ID, globalDataDir })
    ).rejects.toThrow(/2026-07-01-old-thing/u);

    // Fail closed: both entries are still in the partition, and the project
    // repo got nothing back.
    expect(
      fs.existsSync(
        partition(
          adopted.projectId,
          'changes',
          'archive',
          TARGET_LINE,
          '2026-07-01-old-thing',
          'proposal.md'
        )
      )
    ).toBe(true);
    expect(
      fs.existsSync(
        partition(
          adopted.projectId,
          'changes',
          'archive',
          OTHER_LINE,
          '2026-07-01-old-thing',
          'proposal.md'
        )
      )
    ).toBe(true);
    expect(ls(path.join(source, 'rasen', 'changes', 'archive'))).toEqual([]);
  });

  it('flattens archive lines into the single in-project archive when they do not collide', async () => {
    const source = makeSource('app-one');
    const adopted = await adopt(source);
    writeArchiveEntry(
      partition(adopted.projectId, 'changes', 'archive', TARGET_LINE),
      '2026-07-01-alpha'
    );
    writeArchiveEntry(
      partition(adopted.projectId, 'changes', 'archive', OTHER_LINE),
      '2026-07-02-beta'
    );

    await ejectProject({ projectId: adopted.projectId, storeId: STORE_ID, globalDataDir });

    // No line directory survives into the in-project layout, where a nested
    // directory would be misread as an archive entry.
    expect(ls(path.join(source, 'rasen', 'changes', 'archive'))).toEqual([
      '2026-07-01-alpha',
      '2026-07-02-beta',
    ]);
  });

  it('reports a missing partition rather than silently succeeding', async () => {
    const adopted = await adopt(makeSource('app-one'));
    fs.rmSync(partition(adopted.projectId), { recursive: true, force: true });

    await expect(
      ejectProject({ projectId: adopted.projectId, storeId: STORE_ID, globalDataDir })
    ).rejects.toThrow(/partition/i);
  });

  it('rejects --all in a layout v2 Store, where the partition already answers the question', async () => {
    const adopted = await adopt(makeSource('app-one'));

    await expect(
      ejectProject({
        projectId: adopted.projectId,
        storeId: STORE_ID,
        globalDataDir,
        all: true,
      })
    ).rejects.toThrow(/--all/u);
    // Nothing moved.
    expect(ls(partition(adopted.projectId, 'specs'))).toEqual(['billing']);
  });

  it('refuses adopt into a mixed-layout Store rather than choosing a layout', async () => {
    // A v2 declaration with flat planning content still present and no receipt:
    // exactly the half-migrated state the migration exists to resolve.
    writeSpec(storeRoot, 'stranded', '## Purpose\n\nleft behind\n');
    const source = makeSource('app-one');

    await expect(adopt(source)).rejects.toMatchObject({
      diagnostic: { code: 'store_layout_mixed_residue' },
    });
    expect(ls(path.join(storeRoot, 'rasen', 'projects'))).toEqual([]);
    // The source repo kept everything.
    expect(ls(path.join(source, 'rasen', 'specs'))).toEqual(['billing']);
  });

  it('binds the project catalog on adopt and unbinds it on eject, keeping the catalog', async () => {
    const adopted = await adopt(makeSource('app-one'));

    const bound = await readStoreMembership(storeRoot, adopted.projectId, STORE_ID);
    expect(bound.entry?.layout).toBe(2);
    expect(bound.entry?.layout === 2 ? bound.entry.catalog : null).toMatchObject({
      version: 2,
      projectId: adopted.projectId,
      planningBinding: { state: 'bound' },
    });

    await ejectProject({ projectId: adopted.projectId, storeId: STORE_ID, globalDataDir });

    // The catalog survives eject; only the binding ends.
    const unbound = await readStoreMembership(storeRoot, adopted.projectId, STORE_ID);
    expect(unbound.entry?.layout).toBe(2);
    expect(unbound.entry?.layout === 2 ? unbound.entry.catalog : null).toMatchObject({
      version: 2,
      projectId: adopted.projectId,
      planningBinding: { state: 'unbound' },
    });
    expect(fs.existsSync(partition(adopted.projectId))).toBe(false);
  });

  it('requires an explicit target line for archive relocate --to store in a v2 Store', async () => {
    const source = makeSource('app-one');
    const adopted = await adopt(source);
    // A leftover machine-home archive entry: the pointer repo has no planning
    // shape left after adoption, which is what puts relocate in store mode.
    const home = await resolveProjectHome(source, { ensure: true, globalDataDir });
    fs.mkdirSync(home!.archiveDir, { recursive: true });
    writeArchiveEntry(home!.archiveDir, '2026-07-05-late');

    await expect(
      relocateArchive({ projectRoot: source, to: 'store', globalDataDir })
    ).rejects.toThrow(/target[- ]line/i);
    expect(
      fs.existsSync(path.join(home!.archiveDir, '2026-07-05-late', 'proposal.md'))
    ).toBe(true);

    await relocateArchive({
      projectRoot: source,
      to: 'store',
      globalDataDir,
      targetLine: TARGET_LINE,
    });
    expect(
      ls(partition(adopted.projectId, 'changes', 'archive', TARGET_LINE))
    ).toContain('2026-07-05-late');
  });
});
