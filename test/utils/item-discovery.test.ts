import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

import { getArchivedChangeIds } from '../../src/utils/item-discovery.js';
import { resolveProjectHome } from '../../src/core/project-home.js';

/**
 * Sticky-union reader semantics (design `externalize-artifacts-archive-
 * dest`, D3): `getArchivedChangeIds` must enumerate the union of the
 * in-repo archive directory and the project's machine-home archive
 * whenever a home resolves, regardless of the currently configured
 * destination — switching destinations never orphans previously archived
 * changes.
 */
describe('getArchivedChangeIds', () => {
  let projectRoot: string;
  let globalDataDir: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-item-discovery-'));
    globalDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-item-discovery-gdd-'));
    await fs.mkdir(path.join(projectRoot, 'rasen'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(globalDataDir, { recursive: true, force: true });
  });

  async function writeArchivedChange(archiveDir: string, id: string): Promise<void> {
    const dir = path.join(archiveDir, id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'proposal.md'), '# proposal\n');
  }

  it('a home-less project enumerates only in-repo archives', async () => {
    const inRepoArchive = path.join(projectRoot, 'rasen', 'changes', 'archive');
    await writeArchivedChange(inRepoArchive, '2026-01-01-alpha');
    await writeArchivedChange(inRepoArchive, '2026-01-02-beta');

    const ids = await getArchivedChangeIds(projectRoot, { globalDataDir });

    expect(ids).toEqual(['2026-01-01-alpha', '2026-01-02-beta']);
    // Read-only: no registry created for a home-less project.
    expect(await fs
      .access(path.join(globalDataDir, 'projects'))
      .then(() => true)
      .catch(() => false)
    ).toBe(false);
  });

  it('unions in-repo and external archives for a registered project', async () => {
    const inRepoArchive = path.join(projectRoot, 'rasen', 'changes', 'archive');
    await writeArchivedChange(inRepoArchive, '2026-01-01-alpha');

    const home = await resolveProjectHome(projectRoot, { globalDataDir, ensure: true });
    await writeArchivedChange(home!.archiveDir, '2026-02-01-gamma');

    const ids = await getArchivedChangeIds(projectRoot, { globalDataDir });

    expect(ids).toEqual(['2026-01-01-alpha', '2026-02-01-gamma']);
  });

  it('de-dupes a name collision, preferring the in-repo entry', async () => {
    const inRepoArchive = path.join(projectRoot, 'rasen', 'changes', 'archive');
    await writeArchivedChange(inRepoArchive, '2026-03-01-shared');

    const home = await resolveProjectHome(projectRoot, { globalDataDir, ensure: true });
    await writeArchivedChange(home!.archiveDir, '2026-03-01-shared');

    const ids = await getArchivedChangeIds(projectRoot, { globalDataDir });

    expect(ids).toEqual(['2026-03-01-shared']);
  });

  it('a destination flip does not orphan previously archived changes (both stay enumerable)', async () => {
    const inRepoArchive = path.join(projectRoot, 'rasen', 'changes', 'archive');
    await writeArchivedChange(inRepoArchive, '2026-01-01-before-flip');

    // Simulate flipping to `external` and archiving a second change there —
    // the reader never re-resolves config, only what's on disk in both
    // locations.
    const home = await resolveProjectHome(projectRoot, { globalDataDir, ensure: true });
    await writeArchivedChange(home!.archiveDir, '2026-04-01-after-flip');

    const ids = await getArchivedChangeIds(projectRoot, { globalDataDir });

    expect(ids).toContain('2026-01-01-before-flip');
    expect(ids).toContain('2026-04-01-after-flip');
  });

  it('degrades to in-repo-only when the machine-global registry is corrupt', async () => {
    const inRepoArchive = path.join(projectRoot, 'rasen', 'changes', 'archive');
    await writeArchivedChange(inRepoArchive, '2026-01-01-alpha');

    const home = await resolveProjectHome(projectRoot, { globalDataDir, ensure: true });
    await writeArchivedChange(home!.archiveDir, '2026-02-01-gamma');

    const { getProjectRegistryPath } = await import('../../src/core/project-registry.js');
    await fs.writeFile(getProjectRegistryPath({ globalDataDir }), '{not valid json');

    const ids = await getArchivedChangeIds(projectRoot, { globalDataDir });

    expect(ids).toEqual(['2026-01-01-alpha']);
  });

  it('returns an empty list when no archives exist anywhere', async () => {
    const ids = await getArchivedChangeIds(projectRoot, { globalDataDir });
    expect(ids).toEqual([]);
  });
});
