import { WORKSPACE_DIR_NAME } from '../core/config.js';
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import { resolveProjectHome, type ProjectHome } from '../core/project-home.js';

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

/** `YYYY-MM-DD-<name>` archived-change directory name (as `getArchivedChangeIds` returns). */
const ARCHIVED_NAME_PATTERN = /^(\d{4}-\d{2}-\d{2})-(.+)$/;

/**
 * The three parts of an archived change's directory name. Shared by the
 * task-detail and archive-listing handlers (ui-space-redesign-archive-page
 * design D3) so both agree byte-for-byte on how an archived change's name and
 * date are recovered from what `getArchivedChangeIds` reports.
 */
export interface ArchivedRef {
  /** The dated directory name as `getArchivedChangeIds` returns it. */
  dated: string;
  /** The `YYYY-MM-DD` prefix. */
  date: string;
  /** The un-dated change name. */
  name: string;
}

/** Splits a `YYYY-MM-DD-<name>` archived directory name into its {@link ArchivedRef} parts, or `null` when it does not match. */
export function parseArchivedRef(dated: string): ArchivedRef | null {
  const match = ARCHIVED_NAME_PATTERN.exec(dated);
  if (!match) return null;
  return { dated, date: match[1]!, name: match[2]! };
}

/**
 * Resolves which archive directory actually holds a `dated` change
 * (ui-space-redesign-archive-page design D3). `getArchivedChangeIds` unions
 * the in-repo archive and the machine-home archive without saying which holds
 * each id, so a reader that needs the on-disk location probes the in-repo dir
 * first: returns `inRepoArchiveDir` when `<inRepoArchiveDir>/<dated>` exists or
 * there is no home, otherwise the home's `archiveDir`. Read-only.
 */
export function resolveArchivedChangeDir(
  inRepoArchiveDir: string,
  home: ProjectHome | null,
  dated: string
): string {
  if (!existsSync(path.join(inRepoArchiveDir, dated)) && home) {
    return home.archiveDir;
  }
  return inRepoArchiveDir;
}

