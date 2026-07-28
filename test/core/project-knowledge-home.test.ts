import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { digestContent, serializeManifest } from '../../src/core/learned-skills/index.js';
import { resolveProjectHome } from '../../src/core/project-home.js';
import {
  digestRecordDirectory,
  migrateProjectKnowledgeHome,
  planProjectKnowledgeMigration,
  resolveProjectKnowledgeHome,
  scanLegacyProjectCatalogs,
} from '../../src/core/project-knowledge-home.js';
import {
  getProjectHomeDir,
  readProjectRegistryState,
} from '../../src/core/project-registry.js';

const ID = 'typescript-cli-routing';
const OTHER_ID = 'go-sql-transaction-locking';

describe('canonical project knowledge home', () => {
  let tempDir: string;
  let globalDataDir: string;

  beforeEach(() => {
    tempDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-pkh-')));
    globalDataDir = path.join(tempDir, 'data');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function healthyRoot(root: string): string {
    fs.mkdirSync(path.join(root, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'rasen', 'changes', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(root, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    return fs.realpathSync.native(root);
  }

  /**
   * A second checkout of the SAME project: same `projectId` in its committed
   * config, a different directory, its own machine home. This is exactly the
   * shape that used to produce two catalogs for one project.
   */
  async function makeCheckout(name: string, projectId?: string): Promise<{ root: string; projectId: string; homeDir: string }> {
    const root = healthyRoot(path.join(tempDir, name));
    if (projectId !== undefined) {
      fs.writeFileSync(
        path.join(root, 'rasen', 'config.yaml'),
        `schema: spec-driven\nprojectId: ${projectId}\n`
      );
    }
    const home = await resolveProjectHome(root, { globalDataDir });
    return { root, projectId: home!.projectId, homeDir: home!.homeDir };
  }

  /** Writes a record into a clone's OLD per-clone catalog. */
  function writeLegacyRecord(homeDir: string, id: string, body: string): string {
    const directory = path.join(homeDir, 'learned-skills', id);
    fs.mkdirSync(directory, { recursive: true });
    const manifest = {
      version: 1 as const,
      id,
      knowledgeKey: `key-${id}`,
      scope: 'project' as const,
      status: 'active' as const,
      generatedBy: 'rasen-learned-skill',
      contentDigest: digestContent(body),
      description: 'A record that predates the canonical knowledge home.',
      applicability: { mode: 'all' as const, markers: ['package.json'] },
      evidence: [],
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
    };
    fs.writeFileSync(path.join(directory, 'learned-skill.yaml'), serializeManifest(manifest));
    fs.writeFileSync(path.join(directory, 'SKILL.md'), body);
    return directory;
  }

  const canonicalRecord = (projectId: string, id: string): string =>
    path.join(resolveProjectKnowledgeHome(projectId, { globalDataDir }).catalogDir, id);

  // ---------------------------------------------------------------------------
  // The location itself
  // ---------------------------------------------------------------------------

  it('resolves one location per project identity, composed with platform path resolution', () => {
    const projectId = '3f0b0a2c-1111-4222-8333-444455556666';
    const home = resolveProjectKnowledgeHome(projectId, { globalDataDir });
    expect(home.root).toBe(path.join(globalDataDir, 'project-knowledge', projectId));
    expect(home.catalogDir).toBe(path.join(home.root, 'learned-skills'));
    // Case and surrounding whitespace do not make a second project.
    expect(
      resolveProjectKnowledgeHome(`  ${projectId.toUpperCase()}  `, { globalDataDir }).root
    ).toBe(home.root);
  });

  it('refuses an identity that cannot name a directory instead of inventing one', () => {
    expect(() => resolveProjectKnowledgeHome('../escape', { globalDataDir })).toThrow(
      /cannot key a canonical knowledge home/u
    );
  });

  it('keeps the canonical location out of the clone-specific working ephemera', async () => {
    const checkout = await makeCheckout('web');
    const home = resolveProjectKnowledgeHome(checkout.projectId, { globalDataDir });
    const machineHome = getProjectHomeDir(
      (await readProjectRegistryState({ globalDataDir }))!.projects[checkout.root]!.home,
      { globalDataDir }
    );
    expect(home.root).not.toBe(machineHome);
    expect(home.root).not.toBe(path.join(machineHome, 'archive'));
    expect(home.root.startsWith(path.join(machineHome, path.sep))).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Migration
  // ---------------------------------------------------------------------------

  it('finds every clone that carries the same project identity', async () => {
    const first = await makeCheckout('web');
    const second = await makeCheckout('web-clone', first.projectId);
    writeLegacyRecord(first.homeDir, ID, 'one\n');
    writeLegacyRecord(second.homeDir, ID, 'one\n');

    const found = await scanLegacyProjectCatalogs(first.projectId, { globalDataDir });
    expect(found.map((entry) => entry.catalogDir).sort()).toEqual(
      [
        path.join(first.homeDir, 'learned-skills'),
        path.join(second.homeDir, 'learned-skills'),
      ].sort()
    );
  });

  it('previews the plan and writes absolutely nothing', async () => {
    const checkout = await makeCheckout('web');
    const legacy = writeLegacyRecord(checkout.homeDir, ID, 'only copy\n');

    const preview = await migrateProjectKnowledgeHome(checkout.projectId, {
      globalDataDir,
      dryRun: true,
    });

    expect(preview.dryRun).toBe(true);
    expect(preview.moves.map((move) => move.id)).toEqual([ID]);
    expect(preview.moved).toEqual([]);
    // Nothing created, moved, or deleted.
    expect(fs.existsSync(legacy)).toBe(true);
    expect(fs.existsSync(canonicalRecord(checkout.projectId, ID))).toBe(false);
  });

  it('moves a single catalog and leaves nothing behind', async () => {
    const checkout = await makeCheckout('web');
    const legacy = writeLegacyRecord(checkout.homeDir, ID, 'only copy\n');
    const expected = digestRecordDirectory(legacy);

    const result = await migrateProjectKnowledgeHome(checkout.projectId, { globalDataDir });

    expect(result.status).toBe('complete');
    expect(result.moved).toEqual([ID]);
    expect(digestRecordDirectory(canonicalRecord(checkout.projectId, ID))).toBe(expected);
    expect(fs.existsSync(legacy)).toBe(false);
  });

  it('deduplicates identical catalogs, moving one and reporting the rest', async () => {
    const first = await makeCheckout('web');
    const second = await makeCheckout('web-clone', first.projectId);
    const body = 'identical in both clones\n';
    const legacyOne = writeLegacyRecord(first.homeDir, ID, body);
    const legacyTwo = writeLegacyRecord(second.homeDir, ID, body);

    const result = await migrateProjectKnowledgeHome(first.projectId, { globalDataDir });

    expect(result.status).toBe('complete');
    expect(result.moved).toEqual([ID]);
    expect(result.deduplicated).toEqual([ID]);
    expect(fs.existsSync(canonicalRecord(first.projectId, ID))).toBe(true);
    expect(fs.existsSync(legacyOne)).toBe(false);
    expect(fs.existsSync(legacyTwo)).toBe(false);
  });

  it('reports divergent catalogs and chooses, moves, and deletes nothing', async () => {
    const first = await makeCheckout('web');
    const second = await makeCheckout('web-clone', first.projectId);
    const legacyOne = writeLegacyRecord(first.homeDir, ID, 'one version\n');
    const legacyTwo = writeLegacyRecord(second.homeDir, ID, 'a DIFFERENT version\n');

    const result = await migrateProjectKnowledgeHome(first.projectId, { globalDataDir });

    expect(result.status).toBe('blocked');
    expect(result.moved).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.id).toBe(ID);
    expect(result.conflicts[0]?.participants.map((item) => item.catalogDir).sort()).toEqual(
      [path.dirname(legacyOne), path.dirname(legacyTwo)].sort()
    );
    // Neither was chosen, moved, overwritten, or deleted.
    expect(fs.existsSync(legacyOne)).toBe(true);
    expect(fs.existsSync(legacyTwo)).toBe(true);
    expect(fs.existsSync(canonicalRecord(first.projectId, ID))).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('project_knowledge_catalog_conflict');
  });

  it('migrates the knowledge two clones agree on and leaves only the conflict alone', async () => {
    const first = await makeCheckout('web');
    const second = await makeCheckout('web-clone', first.projectId);
    writeLegacyRecord(first.homeDir, ID, 'one version\n');
    writeLegacyRecord(second.homeDir, ID, 'a DIFFERENT version\n');
    writeLegacyRecord(first.homeDir, OTHER_ID, 'agreed\n');
    writeLegacyRecord(second.homeDir, OTHER_ID, 'agreed\n');

    const result = await migrateProjectKnowledgeHome(first.projectId, { globalDataDir });

    expect(result.status).toBe('partial');
    expect(result.moved).toEqual([OTHER_ID]);
    expect(result.conflicts.map((conflict) => conflict.id)).toEqual([ID]);
    expect(fs.existsSync(canonicalRecord(first.projectId, OTHER_ID))).toBe(true);
    expect(fs.existsSync(canonicalRecord(first.projectId, ID))).toBe(false);
    // Both originals of the conflicting identifier are intact.
    expect(fs.existsSync(path.join(first.homeDir, 'learned-skills', ID))).toBe(true);
    expect(fs.existsSync(path.join(second.homeDir, 'learned-skills', ID))).toBe(true);
  });

  it('re-runs safely and reports there is nothing left to do', async () => {
    const checkout = await makeCheckout('web');
    writeLegacyRecord(checkout.homeDir, ID, 'only copy\n');
    await migrateProjectKnowledgeHome(checkout.projectId, { globalDataDir });

    const again = await migrateProjectKnowledgeHome(checkout.projectId, { globalDataDir });

    expect(again.status).toBe('nothing-to-do');
    expect(again.moved).toEqual([]);
    expect(again.deduplicated).toEqual([]);
    expect(fs.existsSync(canonicalRecord(checkout.projectId, ID))).toBe(true);
  });

  it('completes an interrupted run without duplicating what already moved', async () => {
    const first = await makeCheckout('web');
    const second = await makeCheckout('web-clone', first.projectId);
    const body = 'identical in both clones\n';
    writeLegacyRecord(first.homeDir, ID, body);
    const legacyTwo = writeLegacyRecord(second.homeDir, ID, body);
    // Simulate an interruption AFTER the canonical copy was published but
    // BEFORE the originals were cleared.
    fs.mkdirSync(path.dirname(canonicalRecord(first.projectId, ID)), { recursive: true });
    fs.cpSync(legacyTwo, canonicalRecord(first.projectId, ID), { recursive: true });

    const result = await migrateProjectKnowledgeHome(first.projectId, { globalDataDir });

    expect(result.status).toBe('complete');
    expect(result.alreadyCanonical).toEqual([ID]);
    // Nothing was moved a second time; the leftovers were simply cleared.
    expect(result.moved).toEqual([]);
    expect(result.deduplicated).toEqual([ID]);
    expect(fs.existsSync(path.join(first.homeDir, 'learned-skills', ID))).toBe(false);
    expect(fs.existsSync(legacyTwo)).toBe(false);
    expect(fs.existsSync(canonicalRecord(first.projectId, ID))).toBe(true);
  });

  it('leaves every original in place when the canonical copy cannot be verified', async () => {
    const checkout = await makeCheckout('web');
    const legacy = writeLegacyRecord(checkout.homeDir, ID, 'only copy\n');
    // A pre-existing canonical directory holding DIFFERENT bytes for the same
    // id makes verification fail, which is the case that must not delete.
    const canonical = canonicalRecord(checkout.projectId, ID);
    fs.mkdirSync(canonical, { recursive: true });
    fs.writeFileSync(path.join(canonical, 'SKILL.md'), 'something else entirely\n');

    const result = await migrateProjectKnowledgeHome(checkout.projectId, { globalDataDir });

    // A divergence between the canonical copy and the clone is reported, never
    // resolved — and the original survives either way.
    expect(result.moved).toEqual([]);
    expect(fs.existsSync(legacy)).toBe(true);
    expect(fs.readFileSync(path.join(canonical, 'SKILL.md'), 'utf-8')).toBe(
      'something else entirely\n'
    );
  });

  it('reads a plan without writing anything, so a read-only surface can report it', async () => {
    const checkout = await makeCheckout('web');
    writeLegacyRecord(checkout.homeDir, ID, 'only copy\n');

    const plan = await planProjectKnowledgeMigration(checkout.projectId, { globalDataDir });

    expect(plan.target).toBe(
      resolveProjectKnowledgeHome(checkout.projectId, { globalDataDir }).catalogDir
    );
    expect(plan.moves.map((move) => move.id)).toEqual([ID]);
    expect(fs.existsSync(plan.target)).toBe(false);
  });

  it('reads two catalogs differing only in line endings as the same knowledge', async () => {
    const first = await makeCheckout('web');
    const second = await makeCheckout('web-clone', first.projectId);
    writeLegacyRecord(first.homeDir, ID, 'line one\nline two\n');
    // The same record, checked out with CRLF — a spurious conflict here would
    // block a migration that is in fact a plain duplicate.
    const other = writeLegacyRecord(second.homeDir, ID, 'line one\nline two\n');
    fs.writeFileSync(path.join(other, 'SKILL.md'), 'line one\r\nline two\r\n');

    const result = await migrateProjectKnowledgeHome(first.projectId, { globalDataDir });

    expect(result.conflicts).toEqual([]);
    expect(result.moved).toEqual([ID]);
  });
});
