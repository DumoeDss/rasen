/**
 * archive.json accounting (design `file-placement-collapse-archive`, D4).
 *
 * Resolves and writes the structured disposition-accounting file that lives
 * inside an archived change directory. This is SEPARATE from
 * `.openspec.yaml` (quality capture) — the two coexist (D5).
 *
 * The file SHALL NOT record the planning-root commit hash (D4): `archive.json`
 * is itself inside that commit, so the hash is an unclosable self-reference.
 * The binding identifiers are `codeCommit` (cross-repo, closable) and evidence
 * content hashes (content-addressed, closable). The planning side records
 * branch + clean/dirty state only.
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

import { gitHeadCommit, isConfirmedGitWorkTree } from './store/git.js';
import { evidenceDir } from './file-placement.js';

const execFileAsync = promisify(execFile);

export interface EvidenceEntry {
  /** Path relative to the archived change directory (e.g. `evidence/review-report.md`). */
  path: string;
  sha256: string;
}

export interface ProbeEntry {
  /** Execution-root-relative path of the probe directory left in place (静置). */
  path: string;
  /** The code commit the probe was tested against. */
  codeCommit: string;
}

export interface HandoffAbsorbedEntry {
  /** Handoff file path relative to the change directory. */
  file: string;
  /** `absorbed` (deleted — dead-ends covered by design/evidence) or `preserved` (moved to evidence/handoff/). */
  outcome: 'absorbed' | 'preserved';
}

export interface ResolveArchiveAccountingInput {
  /** Semantic change name. */
  changeName: string;
  /** Where the change directory landed after the move (the archive path). */
  archivedDir: string;
  /**
   * The execution root — the code checkout being worked on. For an in-repo
   * run this IS the planning root; for a store-selected run it is the code
   * project's root. `codeCommit` is resolved from here.
   */
  executionRoot: string;
  /** The planning root — where the change directory lives. Used for `planningBranch` + `planningTreeState`. */
  planningRoot: string;
  /** Filenames deleted by the ephemera cleaner. */
  ephemeraDiscarded: string[];
  /**
   * Handoff absorption judgment from the skill sidecar. `null` when no
   * sidecar was written (no judgment made).
   */
  handoffAbsorbed: HandoffAbsorbedEntry[] | null;
  /** Probe directories left in place (静置). */
  probes: ProbeEntry[];
}

export interface ArchiveAccounting {
  change: string;
  archivedAt: string;
  codeCommit: string | null;
  planningBranch: string | null;
  planningTreeState: 'clean' | 'dirty';
  evidence: EvidenceEntry[];
  probes: ProbeEntry[];
  /**
   * `null` = no absorption judgment was made (skill didn't run / manual
   * archive). `[]` = judgment made, nothing absorbed.
   */
  handoffAbsorbed: HandoffAbsorbedEntry[] | null;
  ephemeraDiscarded: string[];
  missing: string[];
}

/** Sidecar filename the archive skill writes for the CLI to read (M2 fix). */
export const ARCHIVE_INPUT_SIDECAR_FILENAME = '.rasen-archive-input.json';

export interface ArchiveInputSidecar {
  handoffAbsorbed?: HandoffAbsorbedEntry[];
  probes?: ProbeEntry[];
}

/**
 * Computes the sha256 hex digest of a file's content.
 */
async function sha256File(absPath: string): Promise<string> {
  const content = await fs.readFile(absPath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Walks the evidence directory inside the archived change directory and hashes
 * every file. Paths are relative to the archived change directory (prefixed
 * with `evidence/`). Non-existent evidence directory → empty array.
 */
async function hashEvidence(archivedDir: string): Promise<EvidenceEntry[]> {
  const evidencePath = evidenceDir(archivedDir);
  const entries: EvidenceEntry[] = [];

  async function walk(dir: string, prefix: string): Promise<void> {
    let dirents: import('node:fs').Dirent[];
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of dirents) {
      if (entry.isFile()) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        const hash = await sha256File(path.join(dir, entry.name));
        entries.push({ path: `evidence/${rel}`, sha256: hash });
      } else if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      }
    }
  }

  await walk(evidencePath, '');
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

/**
 * Resolves the planning root's current branch name, or null when not a git
 * work tree or on a detached HEAD.
 */
async function resolvePlanningBranch(planningRoot: string): Promise<string | null> {
  try {
    const isGit = await isConfirmedGitWorkTree(planningRoot);
    if (!isGit) return null;
    const { stdout } = await execFileAsync(
      'git',
      ['-C', planningRoot, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { windowsHide: true }
    );
    const branch = stdout.trim();
    // 'HEAD' means detached HEAD — no branch name to record.
    return branch === 'HEAD' ? null : branch;
  } catch {
    return null;
  }
}

/**
 * Resolves whether the planning root's working tree has uncommitted changes.
 * Non-git roots record `clean` (no state to dirty).
 */
async function resolvePlanningTreeState(planningRoot: string): Promise<'clean' | 'dirty'> {
  try {
    const isGit = await isConfirmedGitWorkTree(planningRoot);
    if (!isGit) return 'clean';
    const { stdout } = await execFileAsync(
      'git',
      ['-C', planningRoot, 'status', '--porcelain'],
      { windowsHide: true }
    );
    return stdout.trim().length > 0 ? 'dirty' : 'clean';
  } catch {
    return 'clean';
  }
}

/**
 * Checks for common expected evidence items and lists the absent ones.
 * Advisory: a change may legitimately archive without a ship log or
 * verification report.
 */
function resolveMissing(evidenceEntries: EvidenceEntry[]): string[] {
  const missing: string[] = [];
  const paths = new Set(evidenceEntries.map((e) => e.path));
  if (!paths.has('evidence/ship-log.md')) {
    missing.push('ship-log');
  }
  if (!paths.has('evidence/verification-report.md')) {
    missing.push('verification-report');
  }
  return missing;
}

/**
 * Reads the archive-input sidecar file from the change directory (before the
 * move) and returns its parsed contents, or null when absent. The skill writes
 * this file to pass its absorption judgment and probe discoveries to the CLI.
 * The CLI reads it, uses the data for archive.json, then deletes it so it does
 * not enter the archive (M2 fix).
 */
export async function readArchiveInputSidecar(
  changeDir: string
): Promise<ArchiveInputSidecar | null> {
  const sidecarPath = path.join(changeDir, ARCHIVE_INPUT_SIDECAR_FILENAME);
  try {
    const content = await fs.readFile(sidecarPath, 'utf-8');
    return JSON.parse(content) as ArchiveInputSidecar;
  } catch {
    return null;
  }
}

/**
 * Removes the sidecar file from the change directory after the CLI has read it.
 * Best-effort: a failure to delete is logged but does not block the archive.
 */
export async function removeArchiveInputSidecar(changeDir: string): Promise<void> {
  const sidecarPath = path.join(changeDir, ARCHIVE_INPUT_SIDECAR_FILENAME);
  try {
    await fs.rm(sidecarPath, { force: true });
  } catch {
    // Best-effort — the move will carry it if deletion fails, which is a
    // minor cosmetic issue (the file is hidden and harmless in the archive).
  }
}

/**
 * PURE resolution: gathers all archive.json fields from the filesystem and git
 * state WITHOUT writing anything. This is the seam the archive path calls
 * after the directory move. The `codeCommit` is resolved from the execution
 * root (for a store-selected run, the code project's HEAD — NOT the store's).
 */
export async function resolveArchiveAccounting(
  input: ResolveArchiveAccountingInput
): Promise<ArchiveAccounting> {
  const [codeCommit, planningBranch, planningTreeState, evidence] = await Promise.all([
    gitHeadCommit(input.executionRoot),
    resolvePlanningBranch(input.planningRoot),
    resolvePlanningTreeState(input.planningRoot),
    hashEvidence(input.archivedDir),
  ]);

  return {
    change: input.changeName,
    archivedAt: new Date().toISOString(),
    codeCommit,
    planningBranch,
    planningTreeState,
    evidence,
    probes: input.probes,
    handoffAbsorbed: input.handoffAbsorbed,
    ephemeraDiscarded: input.ephemeraDiscarded,
    missing: resolveMissing(evidence),
  };
}

/**
 * Writes `archive.json` inside an archived change directory. Called by the
 * archive path after the directory move. The file is pretty-printed JSON with
 * a trailing newline, sorted top-level keys for deterministic diff output.
 */
export async function writeArchiveJson(
  archivedDir: string,
  accounting: ArchiveAccounting
): Promise<void> {
  // Sort top-level keys for deterministic output.
  const ordered: Record<string, unknown> = {
    change: accounting.change,
    archivedAt: accounting.archivedAt,
    codeCommit: accounting.codeCommit,
    planningBranch: accounting.planningBranch,
    planningTreeState: accounting.planningTreeState,
    evidence: accounting.evidence,
    probes: accounting.probes,
    handoffAbsorbed: accounting.handoffAbsorbed,
    ephemeraDiscarded: accounting.ephemeraDiscarded,
    missing: accounting.missing,
  };
  const content = JSON.stringify(ordered, null, 2) + '\n';
  await fs.writeFile(path.join(archivedDir, 'archive.json'), content, 'utf-8');
}
