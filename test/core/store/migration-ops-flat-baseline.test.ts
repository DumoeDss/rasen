/**
 * Task 1.2 — the legacy flat Store behavior this change deliberately KEEPS.
 *
 * The task asked for a pre-move baseline. By the time it could be written the
 * writers had already moved, so it is retrospective by necessity: it pins what
 * the LEGACY paths still do, which is the more useful artifact anyway. If a
 * later slice narrows one of these, this file is what turns red.
 *
 * The four legacy behaviors, and why each survives:
 *
 * - **eject** — refusing it would trap content in a Store nobody can migrate.
 * - **`archive relocate --to in-repo`** — the same argument: it is the way out.
 * - **membership records** — a flat Store keeps writing `version: 1`, because
 *   only migration flips a record to the v2 catalog.
 * - **drift diagnosis** — a flat Store is diagnosable, and diagnosis repairs
 *   nothing. (`store doctor`'s layout findings against a flat Store are in
 *   `layout-migration-doctor.test.ts`, which gives its Store a real Git repo.)
 *
 * What a flat Store no longer does is asserted elsewhere, with citations:
 * `new change` and `archive` in `test/commands/declared-store-fallback.test.ts`
 * and `test/cli-e2e/store-lifecycle.test.ts`, and adopt in
 * `test/core/store/layout-no-dual-write.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getGlobalDataDir, registerStore } from '../../../src/core/index.js';
import {
  diagnoseMigrationDrift,
  ejectProject,
  migrateStoreMembership,
  relocateArchive,
} from '../../../src/core/store/migration-ops.js';
import { readStoreMembership } from '../../../src/core/store/membership-layout.js';
import { writeStoreProjectRecord } from '../../../src/core/store/project-records.js';
import { readStorePointer, updateProjectConfigKey } from '../../../src/core/project-config.js';
import { createOpenSpecRoot, writeSpec } from '../../helpers/rasen-fixtures.js';

const STORE_ID = 'team-store';
const PROJECT_ID = '9d1f0f3a-8b2c-4a7e-9c11-2f3b4c5d6e70';

function ls(dir: string): string[] {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

describe('legacy flat Store behavior this change keeps working', () => {
  let tempDir: string;
  let globalDataDir: string;
  let storeRoot: string;
  let savedXdg: string | undefined;
  let savedRasenHome: string | undefined;

  beforeEach(async () => {
    tempDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-flat-baseline-'))
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

  /** A pointer repo whose content the flat Store holds, as adoption left it. */
  async function seedAdoptedProject(name = 'my-app'): Promise<string> {
    const root = path.join(tempDir, name);
    createOpenSpecRoot(root);
    fs.rmSync(path.join(root, 'rasen', 'specs'), { recursive: true, force: true });
    fs.rmSync(path.join(root, 'rasen', 'changes'), { recursive: true, force: true });
    updateProjectConfigKey(root, 'store', STORE_ID);
    updateProjectConfigKey(root, 'projectId', PROJECT_ID);

    writeSpec(storeRoot, 'billing', '## Purpose\n\np\n\n## Requirements\n\n- r\n');
    const changeDir = path.join(storeRoot, 'rasen', 'changes', 'add-thing');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# add-thing\n');

    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId: PROJECT_ID,
      roles: { planning: true, knowledge: false },
      adoption: {
        specs: ['billing'],
        changes: ['add-thing'],
        adoptedAt: '2026-01-02T03:04:05.000Z',
      },
    });
    return root;
  }

  it('eject still restores flat content into the project, so nothing is trapped', async () => {
    const source = await seedAdoptedProject();

    const ejected = await ejectProject({
      projectId: PROJECT_ID,
      storeId: STORE_ID,
      globalDataDir,
      destinationPath: source,
    });

    expect(ejected.specs).toEqual(['billing']);
    expect(ejected.changes).toEqual(['add-thing']);
    expect(ls(path.join(source, 'rasen', 'specs'))).toEqual(['billing']);
    expect(ls(path.join(source, 'rasen', 'changes'))).toContain('add-thing');
    // The flat namespace is emptied, not partitioned.
    expect(ls(path.join(storeRoot, 'rasen', 'specs'))).toEqual([]);
    expect(fs.existsSync(path.join(storeRoot, 'rasen', 'projects'))).toBe(false);
    expect(readStorePointer(source).value).toBeUndefined();
  });

  it('eject dry-run still previews without moving anything', async () => {
    const source = await seedAdoptedProject();

    const preview = await ejectProject({
      projectId: PROJECT_ID,
      storeId: STORE_ID,
      globalDataDir,
      destinationPath: source,
      dryRun: true,
    });

    expect(preview.specs).toEqual(['billing']);
    expect(ls(path.join(storeRoot, 'rasen', 'specs'))).toEqual(['billing']);
    expect(ls(path.join(source, 'rasen', 'specs'))).toEqual([]);
  });

  it('archive relocate --to in-repo still consolidates a machine-home archive', async () => {
    const source = path.join(tempDir, 'my-app');
    createOpenSpecRoot(source);
    const { resolveProjectHome } = await import('../../../src/core/project-home.js');
    const home = await resolveProjectHome(source, { ensure: true, globalDataDir });
    fs.mkdirSync(path.join(home!.archiveDir, '2026-07-01-old'), { recursive: true });
    fs.writeFileSync(path.join(home!.archiveDir, '2026-07-01-old', 'proposal.md'), 'old\n');

    const result = await relocateArchive({
      projectRoot: source,
      to: 'in-repo',
      globalDataDir,
    });

    expect(result.moves.map((move) => move.name)).toContain('2026-07-01-old');
    expect(ls(path.join(source, 'rasen', 'changes', 'archive'))).toContain('2026-07-01-old');
  });

  it('a flat Store keeps writing version 1 membership records', async () => {
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId: PROJECT_ID,
      roles: { planning: false, knowledge: true },
    });

    const read = await readStoreMembership(storeRoot, PROJECT_ID, STORE_ID);
    expect(read.layout).toBe(1);
    expect(read.entry?.layout).toBe(1);
    expect(
      fs.readFileSync(
        path.join(storeRoot, '.rasen-store', 'projects', `${PROJECT_ID}.yaml`),
        'utf8'
      )
    ).toContain('version: 1');
  });

  it('the explicit membership migration still runs against a flat Store and keeps version 1', async () => {
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId: PROJECT_ID,
      roles: { planning: false, knowledge: true },
    });

    const preview = await migrateStoreMembership({ storeId: STORE_ID, globalDataDir });
    expect(preview.applied).toBe(false);

    const applied = await migrateStoreMembership({
      storeId: STORE_ID,
      apply: true,
      globalDataDir,
    });
    expect(applied.applied).toBe(true);
    // Only the migration Module flips a record to the v2 catalog; the explicit
    // membership migration leaves a flat Store's records at version 1.
    expect(
      fs.readFileSync(
        path.join(storeRoot, '.rasen-store', 'projects', `${PROJECT_ID}.yaml`),
        'utf8'
      )
    ).toContain('version: 1');
  });

  it('drift diagnosis still reads a flat Store and repairs nothing', async () => {
    const source = await seedAdoptedProject();
    // A recorded name the flat content does not have.
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId: PROJECT_ID,
      roles: { planning: true, knowledge: false },
      adoption: {
        specs: ['billing', 'missing-capability'],
        changes: [],
        adoptedAt: '2026-01-02T03:04:05.000Z',
      },
    });

    const drift = await diagnoseMigrationDrift(source, { globalDataDir });

    expect(drift.map((entry) => entry.code)).toContain('drift_manifest_missing_content');
    // Read-only: the recorded name list is untouched.
    expect(
      fs.readFileSync(
        path.join(storeRoot, '.rasen-store', 'projects', `${PROJECT_ID}.yaml`),
        'utf8'
      )
    ).toContain('missing-capability');
  });

});
