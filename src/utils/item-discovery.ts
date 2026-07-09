import { WORKSPACE_DIR_NAME } from '../core/config.js';
import { promises as fs } from 'fs';
import path from 'path';
import { resolveProjectHome } from '../core/project-home.js';

export async function getActiveChangeIds(root: string = process.cwd()): Promise<string[]> {
  const changesPath = path.join(root, WORKSPACE_DIR_NAME, 'changes');
  try {
    const entries = await fs.readdir(changesPath, { withFileTypes: true });
    const result: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'archive') continue;
      const proposalPath = path.join(changesPath, entry.name, 'proposal.md');
      try {
        await fs.access(proposalPath);
        result.push(entry.name);
      } catch {
        // skip directories without proposal.md
      }
    }
    return result.sort();
  } catch {
    return [];
  }
}

export async function getSpecIds(root: string = process.cwd()): Promise<string[]> {
  const specsPath = path.join(root, WORKSPACE_DIR_NAME, 'specs');
  const result: string[] = [];
  try {
    const entries = await fs.readdir(specsPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const specFile = path.join(specsPath, entry.name, 'spec.md');
      try {
        await fs.access(specFile);
        result.push(entry.name);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  return result.sort();
}

async function scanArchiveDirForChangeIds(archivePath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(archivePath, { withFileTypes: true });
    const result: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const proposalPath = path.join(archivePath, entry.name, 'proposal.md');
      try {
        await fs.access(proposalPath);
        result.push(entry.name);
      } catch {
        // skip directories without proposal.md
      }
    }
    return result;
  } catch {
    return [];
  }
}

export interface GetArchivedChangeIdsOptions {
  /** Test/DI override; forwarded to `resolveProjectHome`. */
  globalDataDir?: string;
}

/**
 * Enumerates archived change ids as the sticky-union of the in-repo archive
 * directory and the project's machine-home archive (design D3): switching
 * `archive.destination` affects only future archives, never what is
 * discoverable — a change archived under one destination stays visible
 * after a later config flip. De-duplicated by id, in-repo preferred for
 * display. The home probe is read-only (`ensure: false`) and any error
 * (corrupt registry, no identity yet) degrades to in-repo-only — archived-id
 * enumeration must never break shell completion.
 */
export async function getArchivedChangeIds(
  root: string = process.cwd(),
  options: GetArchivedChangeIdsOptions = {}
): Promise<string[]> {
  const inRepoPath = path.join(root, WORKSPACE_DIR_NAME, 'changes', 'archive');
  const inRepoIds = await scanArchiveDirForChangeIds(inRepoPath);

  let externalIds: string[] = [];
  try {
    const home = await resolveProjectHome(root, {
      ensure: false,
      ...(options.globalDataDir !== undefined ? { globalDataDir: options.globalDataDir } : {}),
    });
    if (home) {
      externalIds = await scanArchiveDirForChangeIds(home.archiveDir);
    }
  } catch {
    // Degrade to in-repo-only (see doc comment above).
  }

  const seen = new Set(inRepoIds);
  const union = [...inRepoIds];
  for (const id of externalIds) {
    if (!seen.has(id)) {
      seen.add(id);
      union.push(id);
    }
  }
  return union.sort();
}

