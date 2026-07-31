/**
 * Inverted legacy-state migration (`file-placement-collapse-archive`, D6).
 *
 * The direction is INVERTED from the original `migrate-legacy-ephemera`:
 * instead of scanning in-repo change directories for ephemera to move TO the
 * machine-home work directories, this migrator scans the machine-home work
 * directories for legacy state and moves it TO the terminal file-placement
 * locations child A established:
 *
 * - Old workDir reports  → `<changeRoot>/evidence/` (or `<Archive>/evidence/`)
 * - Old workDir handoff   → `<changeRoot>/handoff/`  (or `<Archive>/handoff/`)
 * - Old workDir run-state → `<executionRoot>/.rasen/changes/<c>/ephemera/`
 *   (archived changes: discard + list)
 * - Machine-root probe dirs → reclassified one-by-one per classification order
 * - `machineHome/design-docs/` → `<planningRoot>/rasen/design-docs/`
 *
 * The command name `rasen work migrate` is preserved (the old migrator was a
 * bridge to a now-retired model; inverting the direction is its natural
 * completion, not a new feature). `--dry-run` / `--json` / `--yes` /
 * `--discard-absorbed-conclusions` contract carries over.
 *
 * Never-overwrite (D7): on conflict, keep both copies and report — never skip
 * silently. Never write to git on the caller's behalf.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { resolveProjectHome, type ProjectHome } from './project-home.js';
import { findProjectRegistryEntry, getProjectHomeDir, type ProjectPathOptions } from './project-registry.js';
import { getGlobalDataDir } from './global-config.js';
import {
  evidenceDir,
  handoffDir,
  ephemeraDir,
  designDocsDir,
  resolveExecutionRoot,
} from './file-placement.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MigrationCandidateKind = 'report' | 'handoff' | 'run-state';

export type ProbeClassificationKind = 'driver-harness' | 'sampling-output' | 'conclusions';

export interface RawMigrationCandidate {
  /** Absolute path inside the machine-home work directory. */
  source: string;
  /** Work-dir-relative path, forward-slash normalized. */
  relativePath: string;
  kind: MigrationCandidateKind;
}

export interface WorkDirScanResult {
  candidates: RawMigrationCandidate[];
  /** Files found outside the migrate set (reported, not moved). */
  notes: string[];
}

export interface ProbeDirScanResult {
  /** Directory name under `machineHome/probe/`. */
  dirName: string;
  /** Absolute path to the probe directory. */
  source: string;
  classification: ProbeClassificationKind;
  /** Resulting action for the report. */
  action: 'move-to-probes' | 'move-to-ephemera' | 'discard' | 'leave';
}

export interface DiscoveredChangeDir {
  /** Absolute path to the change (active) or archived-change directory. */
  changeDir: string;
  archived: boolean;
  /** Bare change name (active) or the on-disk date-prefixed archived directory name. */
  name: string;
}

/**
 * Custom goal-loop `runArtifact` filenames are pipeline-configured and cannot
 * be enumerated statically — this fixed caveat is surfaced once per scan.
 */
export const RUN_ARTIFACT_CAVEAT_NOTE =
  "Custom goal-loop run-artifact filenames (a pipeline's configured `runArtifact`) cannot be detected automatically and are not scanned; check pipelines with non-default run-artifact names by hand.";

// ---------------------------------------------------------------------------
// Classification constants
// ---------------------------------------------------------------------------

const RUN_STATE_FILENAMES = new Set(['auto-run.json', 'portfolio-run.json', 'goal-run.json']);

const REPORT_PATTERN = /-report\.md$/i;
const REVIEW_ROUND_PATTERN = /^review-(?:fix|rereview)-round-\d+\.md$/i;
const SHIP_LOG_FILENAME = 'ship-log.md';

/**
 * Review material and config files that SHALL never be moved, even if they
 * somehow ended up in the work directory.
 */
const NEVER_MOVE_FILENAMES = new Set([
  'proposal.md',
  'design.md',
  'tasks.md',
  'retro.md',
  '.openspec.yaml',
  'planning-context.md',
]);

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

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

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * File-level EXDEV/EPERM-safe move (same fallback archive.ts uses, at file
 * granularity). Creates the destination parent as needed.
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
      } catch {
        // Source left behind — a re-run will report it as a conflict
        // (destination exists). Not lost, just duplicated.
      }
    } else {
      throw error;
    }
  }
}

function effectiveGlobalDataDir(override?: string): string {
  return override ?? getGlobalDataDir();
}

// ---------------------------------------------------------------------------
// Discovery (unchanged: still enumerates in-repo change dirs for routing)
// ---------------------------------------------------------------------------

/**
 * Enumerates active change dirs (skips `archive` and dotdirs) and
 * `changes/archive/*` dirs. `options.changeName` scopes to a single active
 * change (exact name match) and/or any archived dirs matching either the
 * exact on-disk name or the `YYYY-MM-DD-<changeName>` pattern.
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

// ---------------------------------------------------------------------------
// Scanner: machine-home work directory (the inverted scan surface)
// ---------------------------------------------------------------------------

/**
 * Classifies a single file in a machine-home work directory against the
 * migration set. Returns the kind or null when the file is not a candidate.
 */
function classifyWorkDirFile(
  name: string,
  relativePath: string
): { kind: MigrationCandidateKind } | null {
  // Review material and config files are NEVER moved.
  if (NEVER_MOVE_FILENAMES.has(name)) return null;

  // Handoff documents live under handoff/.
  if (relativePath.startsWith('handoff/')) {
    return { kind: 'handoff' };
  }

  // Run-state files.
  if (RUN_STATE_FILENAMES.has(name)) {
    return { kind: 'run-state' };
  }

  // Reports: *-report.md, ship-log.md, review-*-round-*.md
  if (REPORT_PATTERN.test(name) || name === SHIP_LOG_FILENAME || REVIEW_ROUND_PATTERN.test(name)) {
    return { kind: 'report' };
  }

  // Verification directory contents are evidence.
  if (relativePath.startsWith('verification/')) {
    return { kind: 'report' };
  }

  return null;
}

/**
 * Recursively scans a machine-home work directory for legacy files, classifying
 * each against the migrate set. Read-only; never mutates the filesystem.
 */
export async function scanMachineHomeWorkDir(workDir: string): Promise<WorkDirScanResult> {
  const candidates: RawMigrationCandidate[] = [];
  const notes: string[] = [];

  async function walk(dir: string, prefix: string): Promise<void> {
    for (const entry of await safeReaddir(dir)) {
      const abs = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const displayRel = toDisplayRelative(rel);

      if (entry.isDirectory()) {
        await walk(abs, rel);
        continue;
      }
      if (!entry.isFile()) continue;

      const classified = classifyWorkDirFile(entry.name, displayRel);
      if (classified) {
        candidates.push({ source: abs, relativePath: displayRel, kind: classified.kind });
      } else {
        notes.push(`Not in the migrate set (left in place): ${displayRel}`);
      }
    }
  }

  await walk(workDir, '');
  return { candidates, notes };
}

// ---------------------------------------------------------------------------
// Scanner: machine-root probe directories
// ---------------------------------------------------------------------------

const PROBE_DIR_NAMES = ['probe', 'probes'];
const DRIVER_EXTENSIONS = new Set(['.sh', '.js', '.ts', '.py', '.rs', '.go', '.rb']);
const DATA_EXTENSIONS = new Set(['.json', '.log', '.txt', '.csv', '.jsonl']);

/**
 * Scans the machine home for historical probe directories and classifies each
 * one-by-one per the classification order:
 * - driver/harness code (executable scripts) → move to execution root probes
 * - sampling output (raw JSON, logs, captures) → move to ephemera
 * - conclusions (markdown-only, no drivers/data) → PRESERVE by default
 *
 * Conclusions are NEVER discarded by the scan: the migrator cannot verify
 * absorption (that requires the archive skill's semantic judgment — design
 * `file-placement-collapse-archive` M3 ruling). Only an explicit
 * `--discard-absorbed-conclusions` flag at execution time can delete them.
 */
export async function scanProbeDirs(machineHome: string): Promise<ProbeDirScanResult[]> {
  const results: ProbeDirScanResult[] = [];

  for (const dirName of PROBE_DIR_NAMES) {
    const probeBase = path.join(machineHome, dirName);
    for (const entry of await safeReaddir(probeBase)) {
      if (!entry.isDirectory()) continue;
      const source = path.join(probeBase, entry.name);

      // Walk the directory and classify by file composition.
      const files = await walkDirFiles(source);
      let driverCount = 0;
      let dataCount = 0;
      let markdownCount = 0;

      for (const f of files) {
        const ext = path.extname(f).toLowerCase();
        if (DRIVER_EXTENSIONS.has(ext)) driverCount++;
        else if (DATA_EXTENSIONS.has(ext)) dataCount++;
        else if (ext === '.md') markdownCount++;
      }

      let classification: ProbeClassificationKind;
      let action: ProbeDirScanResult['action'];

      if (driverCount > 0) {
        classification = 'driver-harness';
        action = 'move-to-probes';
      } else if (dataCount > 0) {
        classification = 'sampling-output';
        action = 'move-to-ephemera';
      } else {
        // Conclusions (markdown-only, no drivers/data) or empty/unrecognized
        // directories: PRESERVE by default. The migrator cannot verify
        // absorption — only the archive skill can make that judgment.
        // --discard-absorbed-conclusions at execution time overrides this.
        classification = 'conclusions';
        action = 'leave';
      }

      results.push({ dirName: entry.name, source, classification, action });
    }
  }

  return results;
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

// ---------------------------------------------------------------------------
// Doctor count (by file type, scans machine-home work dirs)
// ---------------------------------------------------------------------------

export interface MigratableEphemeraCounts {
  total: number;
  reports: number;
  handoff: number;
  runState: number;
  /**
   * True when the machine home could not be resolved (unregistered project).
   * The hint is omitted in that case — doctor never mints identity to check.
   */
  unavailable: boolean;
}

/**
 * Doctor's count-only detection: scans machine-home work directories for
 * legacy state eligible for migration, counting by file type (reports,
 * handoff documents, run-state) so the suggested command's likely effect is
 * visible. Read-only and never mints the machine home.
 */
export async function countMigratableEphemera(
  projectRoot: string,
  _changesDir: string,
  options: { globalDataDir?: string } = {}
): Promise<MigratableEphemeraCounts> {
  const pathOptions: ProjectPathOptions =
    options.globalDataDir !== undefined ? { globalDataDir: options.globalDataDir } : {};
  const entry = await findProjectRegistryEntry(projectRoot, pathOptions);
  if (!entry) {
    return { total: 0, reports: 0, handoff: 0, runState: 0, unavailable: true };
  }

  const homeDir = getProjectHomeDir(entry.entry.home, pathOptions);

  let reports = 0;
  let handoff = 0;
  let runState = 0;

  // Scan work directories for both active and archived changes.
  const changesRoot = path.join(homeDir, 'changes');
  for (const entry of await safeReaddir(changesRoot)) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (entry.name === 'archive') {
      // Archived change work dirs.
      const archiveRoot = path.join(changesRoot, 'archive');
      for (const archEntry of await safeReaddir(archiveRoot)) {
        if (!archEntry.isDirectory()) continue;
        const workDir = path.join(archiveRoot, archEntry.name, 'work');
        const { candidates } = await scanMachineHomeWorkDir(workDir);
        for (const c of candidates) {
          if (c.kind === 'report') reports++;
          else if (c.kind === 'handoff') handoff++;
          else if (c.kind === 'run-state') runState++;
        }
      }
    } else {
      // Active change work dir.
      const workDir = path.join(changesRoot, entry.name, 'work');
      const { candidates } = await scanMachineHomeWorkDir(workDir);
      for (const c of candidates) {
        if (c.kind === 'report') reports++;
        else if (c.kind === 'handoff') handoff++;
        else if (c.kind === 'run-state') runState++;
      }
    }
  }

  return { total: reports + handoff + runState, reports, handoff, runState, unavailable: false };
}

// ---------------------------------------------------------------------------
// Orchestrator: the single entry point `rasen work migrate` calls
// ---------------------------------------------------------------------------

export type MigrationFileStatus = 'planned' | 'moved' | 'conflict' | 'failed' | 'discarded';

export interface MigrationFileReport {
  source: string;
  destination: string | null;
  relativePath: string;
  kind: MigrationCandidateKind;
  status: MigrationFileStatus;
  error?: string;
}

export interface ProbeMigrationReport {
  dirName: string;
  source: string;
  classification: ProbeClassificationKind;
  action: ProbeDirScanResult['action'];
  destination: string | null;
  status: MigrationFileStatus;
  error?: string;
}

export interface DesignDocMigrationReport {
  source: string;
  destination: string;
  status: MigrationFileStatus;
  error?: string;
}

export interface ChangeMigrationReport {
  change: string;
  archived: boolean;
  changeDir: string;
  workDir: string | null;
  files: MigrationFileReport[];
  notes: string[];
}

export interface WorkMigrationReport {
  changes: ChangeMigrationReport[];
  probeDirs: ProbeMigrationReport[];
  designDocs: DesignDocMigrationReport[];
  notes: string[];
  summary: {
    totalCandidates: number;
    moved: number;
    conflicts: number;
    failed: number;
    discarded: number;
  };
}

export interface RunWorkMigrationOptions {
  changeName?: string;
  /**
   * Explicit opt-in to delete machine-root conclusion directories that the
   * user/skill has confirmed are already absorbed by handoff or evidence.
   * Without this flag, conclusion directories are PRESERVED — the migrator
   * cannot verify absorption (that is the archive skill's semantic judgment).
   */
  discardAbsorbedConclusions?: boolean;
  /** false: plan-only (preview/--dry-run/--json without --yes). true: perform the moves. */
  execute: boolean;
  /** Test/DI override; forwarded to resolveProjectHome. */
  globalDataDir?: string;
  /** Whether the run is store-selected (execution root differs from planning root). */
  storeSelected?: boolean;
}

export type RunWorkMigrationResult =
  | { ok: true; report: WorkMigrationReport }
  | { ok: false; reason: 'home_unresolved' }
  | { ok: false; reason: 'change_not_found' };

/**
 * The single entry point for `rasen work migrate`. Scans machine-home work
 * directories for legacy state, routes it to terminal locations, reclassifies
 * probe directories, and moves design-docs — all with never-overwrite conflict
 * handling. `options.execute` is the only behavioral switch between preview
 * and real moves.
 */
export async function runWorkMigration(
  projectRoot: string,
  changesDir: string,
  options: RunWorkMigrationOptions
): Promise<RunWorkMigrationResult> {
  // Resolve the machine home (probe-only on preview, ensure on execute).
  // The preview path uses findProjectRegistryEntry (registry lookup by
  // canonical path) as a fallback when resolveProjectHome can't find the
  // project — this happens when the project is registered but projectId is
  // not yet in rasen/config.yaml (the same gap doctor's own detection
  // bridges). The execute path uses resolveProjectHome with ensure: true,
  // which writes projectId to config.yaml and creates the home directory.
  const pathOptions: ProjectPathOptions =
    options.globalDataDir !== undefined ? { globalDataDir: options.globalDataDir } : {};
  let home: ProjectHome | null;
  if (options.execute) {
    try {
      home = await resolveProjectHome(projectRoot, { ensure: true, ...pathOptions });
    } catch {
      home = null;
    }
  } else {
    try {
      home = await resolveProjectHome(projectRoot, { ensure: false, ...pathOptions });
    } catch {
      home = null;
    }
    if (!home) {
      // Fall back to registry lookup — a registered project whose
      // projectId has not been written to config.yaml yet.
      const registryEntry = await findProjectRegistryEntry(projectRoot, pathOptions);
      if (registryEntry) {
        const homeDir = getProjectHomeDir(registryEntry.entry.home, pathOptions);
        home = {
          projectId: registryEntry.entry.projectId,
          name: registryEntry.entry.name,
          mode: registryEntry.entry.mode,
          homeDir,
          workDir: (changeName: string) => path.join(homeDir, 'changes', changeName, 'work'),
          archiveDir: path.join(homeDir, 'archive'),
          archivedWorkDir: (archivedDirName: string) =>
            path.join(homeDir, 'changes', 'archive', archivedDirName, 'work'),
        };
      }
    }
  }

  if (!home) {
    if (options.execute) {
      return { ok: false, reason: 'home_unresolved' };
    }
    // Preview without a home — report pending but don't fail.
  }

  // Discover change dirs for routing (we need the change names + archived
  // status to resolve work dirs and terminal destinations).
  const discovered = await discoverChangeDirs(changesDir, {
    ...(options.changeName !== undefined ? { changeName: options.changeName } : {}),
  });

  if (options.changeName !== undefined && discovered.length === 0) {
    return { ok: false, reason: 'change_not_found' };
  }

  const notes: string[] = [RUN_ARTIFACT_CAVEAT_NOTE];
  if (!home) {
    const gdd = effectiveGlobalDataDir(options.globalDataDir);
    notes.push(
      `No machine identity is registered for this project yet, so exact destinations are not shown. They will be created under ${path.join(gdd, 'projects')} once identity is minted — which happens only when this command actually executes.`
    );
  }

  const changes: ChangeMigrationReport[] = [];
  const execRoot = resolveExecutionRoot(projectRoot, {
    cwd: process.cwd(),
    ...(options.storeSelected ? { storeSelected: true } : {}),
  });
  let totalCandidates = 0;
  let moved = 0;
  let conflicts = 0;
  let failed = 0;
  let discarded = 0;

  // --- Phase 1: scan + migrate each change's work directory ---
  for (const dir of discovered) {
    const workDir = home
      ? dir.archived
        ? home.archivedWorkDir(dir.name)
        : home.workDir(dir.name)
      : null;

    const { candidates, notes: changeNotes } = workDir
      ? await scanMachineHomeWorkDir(workDir)
      : { candidates: [], notes: [] };

    const files: MigrationFileReport[] = [];

    for (const candidate of candidates) {
      totalCandidates++;
      const file: MigrationFileReport = {
        source: candidate.source,
        destination: null,
        relativePath: candidate.relativePath,
        kind: candidate.kind,
        status: 'planned',
      };

      // Archived run-state is discarded, not migrated.
      if (candidate.kind === 'run-state' && dir.archived) {
        file.status = 'discarded';
        discarded++;
        files.push(file);
        continue;
      }

      // Resolve the terminal destination.
      const changeRoot = dir.changeDir;
      let destination: string | null = null;

      if (candidate.kind === 'report') {
        // Reports go to evidence/. Keep the relative path but strip leading
        // directory prefixes (verification/ → evidence/).
        const relPath = candidate.relativePath.replace(/^(verification\/|handoff\/)/, '');
        destination = path.join(evidenceDir(changeRoot), relPath);
      } else if (candidate.kind === 'handoff') {
        // Handoff documents go to handoff/.
        const filename = path.basename(candidate.relativePath);
        destination = path.join(handoffDir(changeRoot), filename);
      } else if (candidate.kind === 'run-state') {
        // Active run-state goes to the execution root's ephemera area.
        const filename = path.basename(candidate.relativePath);
        destination = path.join(ephemeraDir(execRoot, dir.name), filename);
      }
      file.destination = destination;

      if (!destination || !workDir) {
        // No destination resolvable (no machine home for preview).
        files.push(file);
        continue;
      }

      // Never-overwrite conflict check (D7).
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

  // --- Phase 2: reclassify machine-root probe directories ---
  const probeDirs: ProbeMigrationReport[] = [];
  if (home) {
    const probeScan = await scanProbeDirs(home.homeDir);
    for (const probe of probeScan) {
      const report: ProbeMigrationReport = {
        dirName: probe.dirName,
        source: probe.source,
        classification: probe.classification,
        action: probe.action,
        destination: null,
        status: 'planned',
      };

      if (probe.action === 'leave') {
        // Conclusions are PRESERVED by default. Only delete when the user
        // explicitly opts in via --discard-absorbed-conclusions AND this is
        // an execute run. The migrator cannot verify absorption.
        if (probe.classification === 'conclusions' && options.discardAbsorbedConclusions && options.execute) {
          report.action = 'discard';
          report.destination = null;
          try {
            await fs.rm(probe.source, { recursive: true, force: true });
            report.status = 'discarded';
            discarded++;
          } catch (error) {
            report.status = 'failed';
            report.error = error instanceof Error ? error.message : String(error);
            failed++;
          }
        } else {
          report.status = 'planned';
        }
        probeDirs.push(report);
        continue;
      }

      // Resolve destination based on classification.
      if (probe.action === 'move-to-probes') {
        report.destination = path.join(execRoot, '.rasen', 'probes', probe.dirName);
      } else if (probe.action === 'move-to-ephemera') {
        report.destination = path.join(execRoot, '.rasen', 'changes', probe.dirName, 'ephemera');
      }

      if (report.destination && (await pathExists(report.destination))) {
        report.status = 'conflict';
        conflicts++;
        probeDirs.push(report);
        continue;
      }

      if (!options.execute) {
        probeDirs.push(report);
        continue;
      }

      if (report.destination) {
        try {
          // Move the entire directory.
          await fs.mkdir(path.dirname(report.destination), { recursive: true });
          await fs.rename(probe.source, report.destination);
          report.status = 'moved';
          moved++;
        } catch (error) {
          // EPERM/EXDEV fallback: copy + remove.
          try {
            await copyDirRecursive(probe.source, report.destination);
            await fs.rm(probe.source, { recursive: true, force: true });
            report.status = 'moved';
            moved++;
          } catch (err2) {
            report.status = 'failed';
            report.error = err2 instanceof Error ? err2.message : String(err2);
            failed++;
          }
        }
      }
      probeDirs.push(report);
    }
  }

  // --- Phase 3: migrate design-docs ---
  const designDocs: DesignDocMigrationReport[] = [];
  if (home) {
    const sourceDesignDocsDir = path.join(home.homeDir, 'design-docs');
    const destDesignDocsDir = designDocsDir(projectRoot);
    const docFiles = await walkDirFiles(sourceDesignDocsDir);

    for (const docPath of docFiles) {
      const rel = path.relative(sourceDesignDocsDir, docPath);
      const destination = path.join(destDesignDocsDir, rel);
      const report: DesignDocMigrationReport = {
        source: docPath,
        destination,
        status: 'planned',
      };

      if (await pathExists(destination)) {
        report.status = 'conflict';
        conflicts++;
        designDocs.push(report);
        continue;
      }

      if (!options.execute) {
        designDocs.push(report);
        continue;
      }

      try {
        await moveFileSafe(docPath, destination);
        report.status = 'moved';
        moved++;
      } catch (error) {
        report.status = 'failed';
        report.error = error instanceof Error ? error.message : String(error);
        failed++;
      }
      designDocs.push(report);
    }
  }

  return {
    ok: true,
    report: {
      changes,
      probeDirs,
      designDocs,
      notes,
      summary: { totalCandidates, moved, conflicts, failed, discarded },
    },
  };
}

/**
 * Recursively copies a directory (EXDEV/EPERM fallback for probe dirs).
 */
async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}
