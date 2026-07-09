/**
 * Legacy in-repo ephemera migration (`migrate-legacy-ephemera`): scans a
 * root's active and archived change directories for T3 process ephemera
 * (design `externalize-artifacts-t3-workdir`'s enumeration) still living
 * in-repo, and moves it to the project's machine-home work directories.
 *
 * Layering (matches tasks.md 1.1-1.4):
 *  - `discoverChangeDirs` / `scanChangeDirEphemera`: pure, home-agnostic
 *    directory reads. `countMigratableEphemera` composes these for doctor's
 *    read-only, no-home-resolution hint (never calls `resolveProjectHome`).
 *  - `runWorkMigration`: the orchestrator. Classifies tracked/untracked via
 *    `isConfirmedGitWorkTree` + one read-only `git ls-files` (FAILING CLOSED
 *    — never guessing — when the git query can't be trusted, review M2),
 *    then resolves the home with `ensure: options.execute` (review M1:
 *    identity is minted ONLY at the point of an actual write, matching
 *    `archive.ts`'s "ensure only at write time" precedent — a preview never
 *    mints and never dirties `rasen/config.yaml` or the registry). When no
 *    identity exists yet and this IS a preview, destinations are reported as
 *    pending rather than failing or minting. Only when `options.execute` is
 *    true are files actually moved.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { resolveProjectHome, type ResolveProjectHomeOptions } from './project-home.js';
import { getGlobalDataDir } from './global-config.js';
import { gitListTrackedFiles, isConfirmedGitWorkTree } from './store/git.js';

export type MigrationCandidateKind =
  | 'run-state'
  | 'handoff'
  | 'verification-report'
  | 'ship-log'
  | 'report';

const RUN_STATE_FILENAMES = new Set(['auto-run.json', 'portfolio-run.json', 'goal-run.json']);
const REPORT_PATTERN = /-report\.md$/i;
const REPORT_LIKE_NON_CANDIDATE_PATTERN = /-(review|audit)\.md$/i;

/**
 * Custom goal-loop `runArtifact` filenames are pipeline-configured and
 * cannot be enumerated statically (design D2/D6) — this fixed caveat is
 * surfaced once per scan rather than guessed at per file.
 */
export const RUN_ARTIFACT_CAVEAT_NOTE =
  "Custom goal-loop run-artifact filenames (a pipeline's configured `runArtifact`) cannot be detected automatically and are not scanned; check pipelines with non-default run-artifact names by hand.";

export interface RawMigrationCandidate {
  /** Absolute path inside the change directory. */
  source: string;
  /** Change-directory-relative path, forward-slash normalized (display + destination join key). */
  relativePath: string;
  kind: MigrationCandidateKind;
}

export interface ChangeScanResult {
  candidates: RawMigrationCandidate[];
  /** Report-like files found outside the migrate set (e.g. `*-review.md`, `*-audit.md`). */
  notes: string[];
}

async function safeReaddir(dir: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function toDisplayRelative(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

async function walkDirFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await safeReaddir(dir)) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkDirFiles(abs)));
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * Classifies the top-level (and, for `handoff/`, recursive) contents of one
 * change directory against the migrate set (design D2). Never recurses into
 * any directory other than `handoff/` — `specs/`, a would-be `research/`,
 * and anything else stay untouched by construction, not by an exclusion
 * list. Read-only; never mutates the filesystem.
 */
export async function scanChangeDirEphemera(changeDir: string): Promise<ChangeScanResult> {
  const candidates: RawMigrationCandidate[] = [];
  const notes: string[] = [];

  for (const entry of await safeReaddir(changeDir)) {
    if (entry.isDirectory()) {
      if (entry.name === 'handoff') {
        for (const abs of await walkDirFiles(path.join(changeDir, 'handoff'))) {
          candidates.push({
            source: abs,
            relativePath: toDisplayRelative(path.relative(changeDir, abs)),
            kind: 'handoff',
          });
        }
      }
      continue;
    }

    if (!entry.isFile()) continue;
    const name = entry.name;
    const source = path.join(changeDir, name);

    if (RUN_STATE_FILENAMES.has(name)) {
      candidates.push({ source, relativePath: name, kind: 'run-state' });
    } else if (name === 'verification-report.md') {
      candidates.push({ source, relativePath: name, kind: 'verification-report' });
    } else if (name === 'ship-log.md') {
      candidates.push({ source, relativePath: name, kind: 'ship-log' });
    } else if (REPORT_PATTERN.test(name)) {
      candidates.push({ source, relativePath: name, kind: 'report' });
    } else if (REPORT_LIKE_NON_CANDIDATE_PATTERN.test(name)) {
      notes.push(`Report-like file outside the migrate set (left in place): ${name}`);
    }
  }

  return { candidates, notes };
}

export interface DiscoveredChangeDir {
  /** Absolute path to the change (active) or archived-change directory. */
  changeDir: string;
  archived: boolean;
  /** Bare change name (active) or the on-disk date-prefixed archived directory name. */
  name: string;
}

/**
 * Enumerates active change dirs (skips `archive` and dotdirs) and
 * `changes/archive/*` dirs. `options.changeName` scopes to a single active
 * change (exact name match) and/or any archived dirs matching either the
 * exact on-disk name or the `YYYY-MM-DD-<changeName>` pattern — a recycled
 * name can legitimately match both an active change and one or more
 * archives from different dates; all matches are included, never merged.
 */
export async function discoverChangeDirs(
  changesDir: string,
  options: { changeName?: string } = {}
): Promise<DiscoveredChangeDir[]> {
  const results: DiscoveredChangeDir[] = [];

  for (const entry of await safeReaddir(changesDir)) {
    if (!entry.isDirectory() || entry.name === 'archive' || entry.name.startsWith('.')) continue;
    results.push({ changeDir: path.join(changesDir, entry.name), archived: false, name: entry.name });
  }

  const archiveDir = path.join(changesDir, 'archive');
  for (const entry of await safeReaddir(archiveDir)) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    results.push({ changeDir: path.join(archiveDir, entry.name), archived: true, name: entry.name });
  }

  if (options.changeName === undefined) {
    return results;
  }

  const escaped = options.changeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const archivedSuffixPattern = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escaped}$`);
  return results.filter(
    (r) => r.name === options.changeName || (r.archived && archivedSuffixPattern.test(r.name))
  );
}

export interface MigratableEphemeraCounts {
  total: number;
  untracked: number;
  tracked: number;
  /**
   * True when the tracked/untracked split could not be determined (non-git
   * root, or the git query failed) — `total` is still accurate; `untracked`
   * and `tracked` are both 0 and MUST NOT be trusted (review m1: the hint
   * must not claim a split it cannot back up).
   */
  splitUnavailable: boolean;
}

/**
 * Doctor's count-only detection (task 3.1, review m1): sums migratable
 * candidates across every discovered change dir, then splits tracked vs.
 * untracked via one read-only git classification (the same
 * `isConfirmedGitWorkTree` + `gitListTrackedFiles` pair `runWorkMigration`
 * uses) — reads only, never resolves or mints the machine home, so doctor
 * stays read-only by contract. A non-git root or a failed git query
 * degrades to `splitUnavailable: true` (total still reported) rather than
 * guessing or throwing.
 */
export async function countMigratableEphemera(
  projectRoot: string,
  changesDir: string
): Promise<MigratableEphemeraCounts> {
  const allCandidates: RawMigrationCandidate[] = [];
  for (const dir of await discoverChangeDirs(changesDir)) {
    const { candidates } = await scanChangeDirEphemera(dir.changeDir);
    allCandidates.push(...candidates);
  }
  const total = allCandidates.length;
  if (total === 0) {
    return { total: 0, untracked: 0, tracked: 0, splitUnavailable: false };
  }

  const isGitRepo = await isConfirmedGitWorkTree(projectRoot);
  if (isGitRepo === false) {
    return { total, untracked: total, tracked: 0, splitUnavailable: false };
  }
  if (isGitRepo === null) {
    return { total, untracked: 0, tracked: 0, splitUnavailable: true };
  }

  const relativeChangesDir = toDisplayRelative(path.relative(projectRoot, changesDir));
  const trackedFiles = await gitListTrackedFiles(projectRoot, relativeChangesDir);
  if (trackedFiles === null) {
    return { total, untracked: 0, tracked: 0, splitUnavailable: true };
  }

  const trackedSet = new Set(trackedFiles);
  const tracked = allCandidates.filter((c) => trackedSet.has(c.source)).length;
  return { total, untracked: total - tracked, tracked, splitUnavailable: false };
}

export type MigrationFileStatus = 'planned' | 'moved' | 'skipped-tracked' | 'conflict' | 'failed';

export interface MigrationFileReport {
  source: string;
  /**
   * Null only while `identityPending` is true (no machine identity minted
   * yet and this is a preview) — the real destination depends on a home
   * directory name that does not exist until identity is minted, which
   * preview must never do (review M1).
   */
  destination: string | null;
  relativePath: string;
  kind: MigrationCandidateKind;
  tracked: boolean;
  status: MigrationFileStatus;
  error?: string;
}

export interface ChangeMigrationReport {
  /** Bare change name (active) or archived directory name. */
  change: string;
  archived: boolean;
  changeDir: string;
  /** Null exactly when the report-level `identityPending` is true. */
  workDir: string | null;
  files: MigrationFileReport[];
  notes: string[];
}

export interface WorkMigrationReport {
  changes: ChangeMigrationReport[];
  /** False when the root is not a Git working tree (every candidate was treated as untracked). */
  gitRoot: boolean;
  /**
   * True when no machine identity exists yet AND this run did not execute
   * (`options.execute: false`): every `workDir`/`destination` is null and
   * every file's status is `'planned'` at best (no conflict check was
   * possible without a real destination). Identity is minted only when an
   * execute call actually runs (review M1) — never during a preview.
   */
  identityPending: boolean;
  notes: string[];
  summary: {
    totalCandidates: number;
    moved: number;
    skippedTracked: number;
    conflicts: number;
    failed: number;
  };
}

export interface RunWorkMigrationOptions {
  changeName?: string;
  includeTracked?: boolean;
  /** false: plan-only (preview/--dry-run/--json without --yes). true: perform the moves. */
  execute: boolean;
  /** Test/DI override; forwarded to resolveProjectHome and gitListTrackedFiles's repo root stays projectRoot. */
  globalDataDir?: string;
}

export type RunWorkMigrationResult =
  | { ok: true; report: WorkMigrationReport }
  | { ok: false; reason: 'home_unresolved' }
  | { ok: false; reason: 'change_not_found' }
  | { ok: false; reason: 'git_query_failed' };

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * File-level EXDEV/EPERM-safe move: the machine home may be on another
 * filesystem/volume than the repo, and Windows can reject a rename of a
 * held-open file. Mirrors the copy+rename fallback `archive.ts`'s
 * `moveDirectory` uses, at file granularity — needed here (rather than a
 * directory-level move) so `handoff/` merges per file against a
 * destination that may already hold some of its files (design D5).
 */
async function moveFileSafe(source: string, destination: string): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fs.rename(source, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'EXDEV' || code === 'EPERM') {
      await fs.copyFile(source, destination);
      try {
        await fs.rm(source, { force: true });
      } catch (rmError) {
        // Review's noted sub-case: the copy already landed at `destination`
        // by this point, so this is NOT "nothing happened" — it's a
        // duplicate (source left behind uncleaned). The per-candidate
        // catch above still reports `status: 'failed'` (no new status enum
        // for this narrow case), but the message says what's actually
        // true so a human isn't misled into re-running blind: a re-run
        // will correctly report this file as a `conflict` (destination
        // already exists), not silently re-move or lose it.
        const detail = rmError instanceof Error ? rmError.message : String(rmError);
        throw new Error(
          `Copied to destination but could not remove the source afterward (file is now DUPLICATED, not lost — a re-run will report it as a conflict): ${detail}`
        );
      }
    } else {
      throw error;
    }
  }
}

function effectiveGlobalDataDir(override?: string): string {
  return override ?? getGlobalDataDir();
}

/**
 * The single entry point the `work migrate` command uses for both preview
 * and execution (`options.execute` is the only behavioral switch) — this
 * keeps preview's conflict/tracked-skip classification byte-identical to
 * what execution will actually do whenever a real destination is known,
 * since both paths run the same read-only conflict check (`fs.access` on
 * the destination) before ever touching the filesystem for a move.
 */
export async function runWorkMigration(
  projectRoot: string,
  changesDir: string,
  options: RunWorkMigrationOptions
): Promise<RunWorkMigrationResult> {
  const discovered = await discoverChangeDirs(changesDir, {
    ...(options.changeName !== undefined ? { changeName: options.changeName } : {}),
  });

  if (options.changeName !== undefined && discovered.length === 0) {
    return { ok: false, reason: 'change_not_found' };
  }

  // Git classification FAILS CLOSED (review M2): `isConfirmedGitWorkTree`
  // uses git's own upward-walking resolution (the same algorithm
  // `ls-files` uses), so it can never wrongly say "not a repo" for a root
  // nested inside a parent repo. `null` means "cannot determine" — that is
  // NEVER treated as untracked; the run refuses rather than risk moving
  // real tracked content unclassified.
  const isGitRepo = await isConfirmedGitWorkTree(projectRoot);
  if (isGitRepo === null) {
    return { ok: false, reason: 'git_query_failed' };
  }

  let trackedSet = new Set<string>();
  if (isGitRepo) {
    const relativeChangesDir = toDisplayRelative(path.relative(projectRoot, changesDir));
    const trackedFiles = await gitListTrackedFiles(projectRoot, relativeChangesDir);
    if (trackedFiles === null) {
      // Confirmed a repo exists, but the tracked-files query itself failed
      // (corrupt index, lock contention, ...) — fail closed, same posture.
      return { ok: false, reason: 'git_query_failed' };
    }
    trackedSet = new Set(trackedFiles);
  }
  const gitRoot = isGitRepo;

  // Identity is minted ONLY when this call will actually write files
  // (review M1) — `ensure: options.execute` mirrors `archive.ts`'s "ensure
  // only at write time" precedent (see `archive.ts:349-358`): a preview
  // (execute:false) probes only and NEVER mints a projectId into
  // rasen/config.yaml or writes a registry entry, no matter how many times
  // it runs. `resolveProjectHome`'s ensure path can also THROW (e.g. an
  // unwritable config.yaml); that degrades to the same `home_unresolved`
  // outcome as a null resolution rather than an uncaught exception.
  const homeOptions: ResolveProjectHomeOptions = {
    ensure: options.execute,
    ...(options.globalDataDir !== undefined ? { globalDataDir: options.globalDataDir } : {}),
  };
  let home;
  try {
    home = await resolveProjectHome(projectRoot, homeOptions);
  } catch {
    home = null;
  }

  if (!home && options.execute) {
    // The real write path needs identity and could not get it — hard error
    // (design D3's "erroring with init guidance").
    return { ok: false, reason: 'home_unresolved' };
  }

  const identityPending = home === null; // implies !options.execute, per the guard above
  const notes: string[] = [RUN_ARTIFACT_CAVEAT_NOTE];
  if (!gitRoot) {
    notes.push('Root is not a Git working tree; every candidate is treated as untracked.');
  }
  if (identityPending) {
    const gdd = effectiveGlobalDataDir(options.globalDataDir);
    notes.push(
      `No machine identity is registered for this project yet, so exact destinations are not shown. They will be created under ${path.join(gdd, 'projects')} once identity is minted — which happens only when this command actually executes (not on --dry-run or a --json preview without --yes).`
    );
  }

  const changes: ChangeMigrationReport[] = [];
  let totalCandidates = 0;
  let moved = 0;
  let skippedTracked = 0;
  let conflicts = 0;
  let failed = 0;

  for (const dir of discovered) {
    const workDir = home ? (dir.archived ? home.archivedWorkDir(dir.name) : home.workDir(dir.name)) : null;
    const { candidates, notes: changeNotes } = await scanChangeDirEphemera(dir.changeDir);
    const files: MigrationFileReport[] = [];

    for (const candidate of candidates) {
      totalCandidates++;
      const destination = workDir ? path.join(workDir, ...candidate.relativePath.split('/')) : null;
      const tracked = trackedSet.has(candidate.source);
      const file: MigrationFileReport = {
        source: candidate.source,
        destination,
        relativePath: candidate.relativePath,
        kind: candidate.kind,
        tracked,
        status: 'planned',
      };

      if (tracked && !options.includeTracked) {
        file.status = 'skipped-tracked';
        skippedTracked++;
        files.push(file);
        continue;
      }

      if (destination === null) {
        // Identity not minted yet (preview only, per the guard above): no
        // real destination to conflict-check or move against. Stays
        // 'planned' — the top-level `identityPending` note explains why.
        files.push(file);
        continue;
      }

      if (await pathExists(destination)) {
        file.status = 'conflict';
        conflicts++;
        files.push(file);
        continue;
      }

      if (!options.execute) {
        files.push(file); // stays 'planned'
        continue;
      }

      try {
        await moveFileSafe(candidate.source, destination);
        file.status = 'moved';
        moved++;
      } catch (error) {
        file.status = 'failed';
        file.error = error instanceof Error ? error.message : String(error);
        failed++;
      }
      files.push(file);
    }

    changes.push({
      change: dir.name,
      archived: dir.archived,
      changeDir: dir.changeDir,
      workDir,
      files,
      notes: changeNotes,
    });
  }

  return {
    ok: true,
    report: {
      changes,
      gitRoot,
      identityPending,
      notes,
      summary: { totalCandidates, moved, skippedTracked, conflicts, failed },
    },
  };
}
