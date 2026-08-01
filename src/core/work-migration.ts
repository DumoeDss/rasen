/**
 * Preview-first migration of legacy machine-home work into terminal placement
 * roots. Planning is read-only and complete; apply consumes its immutable
 * ordered actions and records observations separately.
 */
import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import type { Dirent, Stats } from 'node:fs';
import * as path from 'node:path';

import { resolveProjectHome, type ProjectHome } from './project-home.js';
import {
  findProjectRegistryEntry,
  getProjectHomeDir,
  type ProjectPathOptions,
} from './project-registry.js';
import { getGlobalDataDir } from './global-config.js';
import {
  designDocsDir,
  ephemeraDir,
  evidenceDir,
  handoffDir,
} from './file-placement.js';
import {
  foldPathIdentity,
  NATIVE_PATH_IDENTITY_FLAVOR,
  pathIdentityEquals,
  type PathIdentityFlavor,
} from './path-identity.js';

export type MigrationCandidateKind = 'report' | 'handoff' | 'run-state';
export type ProbeClassificationKind = 'driver-harness' | 'sampling-output' | 'conclusions';
export type WorkMigrationPhase = 'change-work' | 'probe' | 'design-doc';
export type WorkMigrationActionKind =
  | 'move-file'
  | 'move-directory'
  | 'discard-file'
  | 'discard-directory'
  | 'leave';
export type WorkMigrationOutcomeStatus =
  | 'moved'
  | 'discarded'
  | 'conflict'
  | 'already-absent'
  | 'failed'
  | 'incomplete'
  | 'left';

export interface WorkMigrationFileSystem {
  readdir(target: string): Promise<Dirent[]>;
  lstat(target: string): Promise<Stats>;
  mkdir(target: string, options: { recursive: boolean }): Promise<void>;
  link(source: string, destination: string): Promise<void>;
  copyFile(source: string, destination: string, mode: number): Promise<void>;
  readFile(target: string): Promise<Buffer>;
  unlink(target: string): Promise<void>;
  rm(target: string, options: { recursive: boolean; force: boolean }): Promise<void>;
  readlink(target: string): Promise<string>;
  symlink(target: string, destination: string, type?: 'dir' | 'file' | 'junction'): Promise<void>;
}

export const defaultWorkMigrationFileSystem: WorkMigrationFileSystem = {
  readdir: target => fs.readdir(target, { withFileTypes: true }),
  lstat: target => fs.lstat(target),
  mkdir: async (target, options) => {
    await fs.mkdir(target, options);
  },
  link: (source, destination) => fs.link(source, destination),
  copyFile: (source, destination, mode) => fs.copyFile(source, destination, mode),
  readFile: target => fs.readFile(target),
  unlink: target => fs.unlink(target),
  rm: (target, options) => fs.rm(target, options),
  readlink: target => fs.readlink(target),
  symlink: (target, destination, type) => fs.symlink(target, destination, type),
};

export interface WorkMigrationBlocker {
  phase: WorkMigrationPhase | 'changes';
  operation: 'readdir' | 'lstat' | 'readFile' | 'readlink';
  path: string;
  code?: string;
  message: string;
}

export interface WorkMigrationPrecondition {
  kind: 'source-exists' | 'source-type' | 'destination-absent';
  value: string;
}

export interface WorkMigrationStatFingerprint {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  dev: number;
  ino: number;
  mode: number;
}

export type WorkMigrationSourceFingerprint =
  | {
      kind: 'file';
      identity: WorkMigrationStatFingerprint;
      sha256: string;
    }
  | {
      kind: 'directory';
      identity: WorkMigrationStatFingerprint;
      treeSha256: string;
    };

export interface WorkMigrationAction {
  id: string;
  phase: WorkMigrationPhase;
  source: string;
  destination: string | null;
  fileType: 'file' | 'directory';
  action: WorkMigrationActionKind;
  classification: MigrationCandidateKind | ProbeClassificationKind | 'design-doc';
  owner: string | null;
  scope: 'change' | 'global';
  relativePath: string;
  preconditions: WorkMigrationPrecondition[];
  /** Required for destructive actions; apply fails closed when it is absent. */
  sourceFingerprint?: WorkMigrationSourceFingerprint;
  visibleConflict: boolean;
  notes: string[];
  change?: {
    name: string;
    archived: boolean;
    changeDir: string;
    workDir: string;
  };
  probe?: {
    dirName: string;
    reportAction: 'move-to-probes' | 'move-to-ephemera' | 'discard' | 'leave';
  };
}

export interface WorkMigrationPlan {
  version: 1;
  /** Frozen routing facts used to build every source and destination. */
  rootContext: WorkMigrationRootContext;
  /** Compatibility alias for `rootContext.planningRoot`. */
  projectRoot: string;
  /** Compatibility alias for `rootContext.changesDir`. */
  changesDir: string;
  machineHome: string | null;
  /** Compatibility alias for `rootContext.executionRoot`. */
  executionRoot: string;
  scopedChange: string | null;
  actions: WorkMigrationAction[];
  blockers: WorkMigrationBlocker[];
  complete: boolean;
  notes: string[];
  discoveredChanges: DiscoveredChangeDir[];
  changeNotes: Record<string, string[]>;
}

/**
 * The four owner roots needed by migration planning. Callers that can select
 * a Store must construct this context at the command boundary; migration code
 * never re-derives any root from cwd, registry membership, or selector state.
 */
export interface WorkMigrationRootContext {
  planningRoot: string;
  changesDir: string;
  executionRoot: string;
  legacyHomeOwnerRoot: string;
  pathIdentityFlavor: PathIdentityFlavor;
}

/** Copy and freeze command-boundary routing facts exactly once. */
export function freezeWorkMigrationRootContext(
  context: WorkMigrationRootContext
): WorkMigrationRootContext {
  if (Object.isFrozen(context)) return context;
  return Object.freeze({ ...context });
}

export interface WorkMigrationApplyOutcome {
  actionId: string;
  status: WorkMigrationOutcomeStatus;
  source: string;
  destination: string | null;
  code?: string;
  error?: string;
  survivingPaths?: string[];
  partialPaths?: string[];
}

export interface WorkMigrationApplyResult {
  applied: boolean;
  outcomes: WorkMigrationApplyOutcome[];
  blockers: WorkMigrationBlocker[];
}

export interface RawMigrationCandidate {
  source: string;
  relativePath: string;
  kind: MigrationCandidateKind;
}

export interface WorkDirScanResult {
  candidates: RawMigrationCandidate[];
  notes: string[];
  blockers?: WorkMigrationBlocker[];
}

export interface ProbeDirScanResult {
  dirName: string;
  source: string;
  classification: ProbeClassificationKind;
  action: 'move-to-probes' | 'move-to-ephemera' | 'discard' | 'leave';
}

export interface DiscoveredChangeDir {
  changeDir: string;
  archived: boolean;
  name: string;
}

export const RUN_ARTIFACT_CAVEAT_NOTE =
  "Custom goal-loop run-artifact filenames (a pipeline's configured `runArtifact`) cannot be detected automatically and are not scanned; check pipelines with non-default run-artifact names by hand.";

const RUN_STATE_FILENAMES = new Set(['auto-run.json', 'portfolio-run.json', 'goal-run.json']);
const REPORT_PATTERN = /-report\.md$/i;
const REVIEW_ROUND_PATTERN = /^review-(?:fix|rereview)-round-\d+\.md$/i;
const SHIP_LOG_FILENAME = 'ship-log.md';
const NEVER_MOVE_FILENAMES = new Set([
  'proposal.md',
  'design.md',
  'tasks.md',
  'retro.md',
  '.openspec.yaml',
  'planning-context.md',
]);
const NEVER_SCAN_DIRECTORY_NAMES = new Set(['specs']);
const PROBE_DIR_NAMES = ['probe', 'probes'];
const DRIVER_EXTENSIONS = new Set(['.sh', '.js', '.ts', '.py', '.rs', '.go', '.rb']);
const DATA_EXTENSIONS = new Set(['.json', '.log', '.txt', '.csv', '.jsonl']);

function codeOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException)?.code;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class WorkMigrationInspectionError extends Error {
  readonly operation: WorkMigrationBlocker['operation'];
  readonly target: string;
  readonly code?: string;

  constructor(
    operation: WorkMigrationBlocker['operation'],
    target: string,
    error: unknown
  ) {
    super(messageOf(error));
    this.name = 'WorkMigrationInspectionError';
    this.operation = operation;
    this.target = target;
    this.code = codeOf(error);
  }
}

function staleSource(target: string, detail: string): WorkMigrationInspectionError {
  return new WorkMigrationInspectionError(
    'lstat',
    target,
    Object.assign(new Error(detail), { code: 'ESTALE' })
  );
}

async function inspectedLstat(
  target: string,
  fileSystem: WorkMigrationFileSystem
): Promise<Stats> {
  try {
    return await fileSystem.lstat(target);
  } catch (error) {
    throw new WorkMigrationInspectionError('lstat', target, error);
  }
}

async function inspectedReaddir(
  target: string,
  fileSystem: WorkMigrationFileSystem
): Promise<Dirent[]> {
  try {
    return await fileSystem.readdir(target);
  } catch (error) {
    throw new WorkMigrationInspectionError('readdir', target, error);
  }
}

async function inspectedReadFile(
  target: string,
  fileSystem: WorkMigrationFileSystem
): Promise<Buffer> {
  try {
    return await fileSystem.readFile(target);
  } catch (error) {
    throw new WorkMigrationInspectionError('readFile', target, error);
  }
}

async function inspectedReadlink(
  target: string,
  fileSystem: WorkMigrationFileSystem
): Promise<string> {
  try {
    return await fileSystem.readlink(target);
  } catch (error) {
    throw new WorkMigrationInspectionError('readlink', target, error);
  }
}

function sourceIdentity(stat: Stats): WorkMigrationStatFingerprint {
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
  };
}

function sameSourceIdentity(left: Stats, right: Stats): boolean {
  return JSON.stringify(sourceIdentity(left)) === JSON.stringify(sourceIdentity(right));
}

function sameSourceFingerprint(
  left: WorkMigrationSourceFingerprint,
  right: WorkMigrationSourceFingerprint
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function fingerprintFile(
  target: string,
  firstStat: Stats,
  fileSystem: WorkMigrationFileSystem
): Promise<WorkMigrationSourceFingerprint> {
  if (!firstStat.isFile() || firstStat.isSymbolicLink()) {
    throw staleSource(target, 'Source is no longer the planned regular file');
  }
  const content = await inspectedReadFile(target, fileSystem);
  const secondStat = await inspectedLstat(target, fileSystem);
  if (!sameSourceIdentity(firstStat, secondStat) || !secondStat.isFile()) {
    throw staleSource(target, 'Source changed while its file fingerprint was read');
  }
  return {
    kind: 'file',
    identity: sourceIdentity(secondStat),
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

async function fingerprintDirectory(
  root: string,
  firstStat: Stats,
  fileSystem: WorkMigrationFileSystem
): Promise<WorkMigrationSourceFingerprint> {
  if (!firstStat.isDirectory() || firstStat.isSymbolicLink()) {
    throw staleSource(root, 'Source is no longer the planned regular directory');
  }
  const hash = createHash('sha256');

  async function walk(target: string, relativePath: string): Promise<void> {
    const directoryBefore = await inspectedLstat(target, fileSystem);
    if (!directoryBefore.isDirectory() || directoryBefore.isSymbolicLink()) {
      throw staleSource(target, 'Directory tree entry changed type during fingerprinting');
    }
    hash.update(
      JSON.stringify({
        type: 'directory',
        path: relativePath,
        identity: sourceIdentity(directoryBefore),
      })
    );
    hash.update('\0');

    const entries = (await inspectedReaddir(target, fileSystem)).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
    for (const entry of entries) {
      const absolute = path.join(target, entry.name);
      const relative = normalizeRelative(
        relativePath ? path.join(relativePath, entry.name) : entry.name
      );
      const before = await inspectedLstat(absolute, fileSystem);
      if (before.isSymbolicLink()) {
        const linkTarget = await inspectedReadlink(absolute, fileSystem);
        const after = await inspectedLstat(absolute, fileSystem);
        if (!sameSourceIdentity(before, after) || !after.isSymbolicLink()) {
          throw staleSource(absolute, 'Symlink changed during directory fingerprinting');
        }
        hash.update(
          JSON.stringify({
            type: 'symlink',
            path: relative,
            identity: sourceIdentity(after),
            target: linkTarget,
          })
        );
        hash.update('\0');
      } else if (before.isDirectory()) {
        await walk(absolute, relative);
        const after = await inspectedLstat(absolute, fileSystem);
        if (!sameSourceIdentity(before, after) || !after.isDirectory()) {
          throw staleSource(absolute, 'Directory changed during fingerprinting');
        }
      } else if (before.isFile()) {
        const content = await inspectedReadFile(absolute, fileSystem);
        const after = await inspectedLstat(absolute, fileSystem);
        if (!sameSourceIdentity(before, after) || !after.isFile()) {
          throw staleSource(absolute, 'File changed during directory fingerprinting');
        }
        hash.update(
          JSON.stringify({
            type: 'file',
            path: relative,
            identity: sourceIdentity(after),
            sha256: createHash('sha256').update(content).digest('hex'),
          })
        );
        hash.update('\0');
      } else {
        hash.update(
          JSON.stringify({
            type: 'special',
            path: relative,
            identity: sourceIdentity(before),
          })
        );
        hash.update('\0');
      }
    }

    const finalNames = (await inspectedReaddir(target, fileSystem))
      .map(entry => entry.name)
      .sort((left, right) => left.localeCompare(right));
    if (JSON.stringify(finalNames) !== JSON.stringify(entries.map(entry => entry.name))) {
      throw staleSource(target, 'Directory children changed during fingerprinting');
    }
    const directoryAfter = await inspectedLstat(target, fileSystem);
    if (!sameSourceIdentity(directoryBefore, directoryAfter) || !directoryAfter.isDirectory()) {
      throw staleSource(target, 'Directory identity changed during fingerprinting');
    }
  }

  await walk(root, '');
  const finalStat = await inspectedLstat(root, fileSystem);
  if (!sameSourceIdentity(firstStat, finalStat) || !finalStat.isDirectory()) {
    throw staleSource(root, 'Source directory changed while its tree fingerprint was read');
  }
  return {
    kind: 'directory',
    identity: sourceIdentity(finalStat),
    treeSha256: hash.digest('hex'),
  };
}

async function fingerprintDiscardSource(
  target: string,
  fileType: WorkMigrationAction['fileType'],
  fileSystem: WorkMigrationFileSystem
): Promise<WorkMigrationSourceFingerprint> {
  const firstStat = await inspectedLstat(target, fileSystem);
  return fileType === 'file'
    ? fingerprintFile(target, firstStat, fileSystem)
    : fingerprintDirectory(target, firstStat, fileSystem);
}

function migrationBlocker(
  phase: WorkMigrationBlocker['phase'],
  operation: WorkMigrationBlocker['operation'],
  target: string,
  error: unknown
): WorkMigrationBlocker {
  const code = codeOf(error);
  return {
    phase,
    operation,
    path: target,
    ...(code ? { code } : {}),
    message: messageOf(error),
  };
}

function fingerprintBlocker(
  phase: WorkMigrationBlocker['phase'],
  target: string,
  error: unknown
): WorkMigrationBlocker {
  if (error instanceof WorkMigrationInspectionError) {
    return {
      phase,
      operation: error.operation,
      path: error.target,
      ...(error.code ? { code: error.code } : {}),
      message: error.message,
    };
  }
  return migrationBlocker(phase, 'lstat', target, error);
}

async function readDirForPlan(
  target: string,
  phase: WorkMigrationBlocker['phase'],
  fileSystem: WorkMigrationFileSystem,
  blockers: WorkMigrationBlocker[]
): Promise<Dirent[]> {
  try {
    const entries = await fileSystem.readdir(target);
    return entries.sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return [];
    blockers.push(migrationBlocker(phase, 'readdir', target, error));
    return [];
  }
}

async function statForPlan(
  target: string,
  phase: WorkMigrationBlocker['phase'],
  fileSystem: WorkMigrationFileSystem,
  blockers: WorkMigrationBlocker[]
): Promise<Stats | null> {
  try {
    return await fileSystem.lstat(target);
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return null;
    blockers.push(migrationBlocker(phase, 'lstat', target, error));
    return null;
  }
}

function normalizeRelative(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function classifyWorkDirFile(
  name: string,
  relativePath: string
): MigrationCandidateKind | null {
  if (NEVER_MOVE_FILENAMES.has(name)) return null;
  if (relativePath.startsWith('handoff/')) return 'handoff';
  if (RUN_STATE_FILENAMES.has(name)) return 'run-state';
  if (
    REPORT_PATTERN.test(name) ||
    name === SHIP_LOG_FILENAME ||
    REVIEW_ROUND_PATTERN.test(name) ||
    relativePath.startsWith('verification/')
  ) {
    return 'report';
  }
  return null;
}

async function scanWorkDirForPlan(
  workDir: string,
  fileSystem: WorkMigrationFileSystem,
  blockers: WorkMigrationBlocker[]
): Promise<WorkDirScanResult> {
  const candidates: RawMigrationCandidate[] = [];
  const notes: string[] = [];

  async function walk(target: string, prefix: string): Promise<void> {
    const entries = await readDirForPlan(target, 'change-work', fileSystem, blockers);
    for (const entry of entries) {
      const absolute = path.join(target, entry.name);
      const relativePath = normalizeRelative(prefix ? path.join(prefix, entry.name) : entry.name);
      const directoryName =
        process.platform === 'win32' ? entry.name.toLocaleLowerCase('en-US') : entry.name;
      if (entry.isDirectory() && NEVER_SCAN_DIRECTORY_NAMES.has(directoryName)) {
        notes.push(`Review-material subtree left in place: ${relativePath}/`);
        continue;
      }
      const stat = await statForPlan(absolute, 'change-work', fileSystem, blockers);
      if (!stat) continue;
      if (stat.isSymbolicLink()) {
        notes.push(`Symlink left in place: ${relativePath}`);
      } else if (stat.isDirectory()) {
        await walk(absolute, relativePath);
      } else if (stat.isFile()) {
        const kind = classifyWorkDirFile(entry.name, relativePath);
        if (kind) candidates.push({ source: absolute, relativePath, kind });
        else notes.push(`Not in the migrate set (left in place): ${relativePath}`);
      } else {
        notes.push(`Special entry left in place: ${relativePath}`);
      }
    }
  }

  await walk(workDir, '');
  candidates.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  notes.sort();
  return { candidates, notes, blockers };
}

export async function scanMachineHomeWorkDir(
  workDir: string,
  fileSystem: WorkMigrationFileSystem = defaultWorkMigrationFileSystem
): Promise<WorkDirScanResult> {
  const blockers: WorkMigrationBlocker[] = [];
  return scanWorkDirForPlan(workDir, fileSystem, blockers);
}

export function archiveNameMatches(
  onDiskName: string,
  changeName: string,
  pathIdentityFlavor: PathIdentityFlavor = NATIVE_PATH_IDENTITY_FLAVOR
): boolean {
  const escaped = foldPathIdentity(changeName, pathIdentityFlavor).replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );
  return new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escaped}$`).test(
    foldPathIdentity(onDiskName, pathIdentityFlavor)
  );
}

export function pathsEqualForPlatform(
  left: string,
  right: string,
  pathIdentityFlavor: PathIdentityFlavor = NATIVE_PATH_IDENTITY_FLAVOR
): boolean {
  const pathApi = pathIdentityFlavor === 'win32' ? path.win32 : path.posix;
  const normalizedLeft = pathApi.resolve(left);
  const normalizedRight = pathApi.resolve(right);
  return pathIdentityEquals(normalizedLeft, normalizedRight, pathIdentityFlavor);
}

export function isPathWithin(
  parent: string,
  candidate: string,
  pathApi: typeof path.posix | typeof path.win32 = path
): boolean {
  const relative = pathApi.relative(pathApi.resolve(parent), pathApi.resolve(candidate));
  if (relative === '') return true;
  return (
    !relative.startsWith(`..${pathApi.sep}`) &&
    relative !== '..' &&
    !pathApi.isAbsolute(relative)
  );
}

async function discoverChangeDirsForPlan(
  changesDir: string,
  options: { changeName?: string; pathIdentityFlavor?: PathIdentityFlavor },
  fileSystem: WorkMigrationFileSystem,
  blockers: WorkMigrationBlocker[]
): Promise<DiscoveredChangeDir[]> {
  const pathIdentityFlavor =
    options.pathIdentityFlavor ?? NATIVE_PATH_IDENTITY_FLAVOR;
  const results: DiscoveredChangeDir[] = [];
  for (const entry of await readDirForPlan(changesDir, 'changes', fileSystem, blockers)) {
    if (entry.name === 'archive' || entry.name.startsWith('.')) continue;
    if (
      options.changeName !== undefined &&
      !pathsEqualForPlatform(entry.name, options.changeName, pathIdentityFlavor)
    ) {
      continue;
    }
    const target = path.join(changesDir, entry.name);
    const stat = await statForPlan(target, 'changes', fileSystem, blockers);
    if (stat?.isDirectory() && !stat.isSymbolicLink()) {
      results.push({ changeDir: target, archived: false, name: entry.name });
    }
  }
  const archiveDir = path.join(changesDir, 'archive');
  for (const entry of await readDirForPlan(archiveDir, 'changes', fileSystem, blockers)) {
    if (entry.name.startsWith('.')) continue;
    if (
      options.changeName !== undefined &&
      !archiveNameMatches(entry.name, options.changeName, pathIdentityFlavor)
    ) {
      continue;
    }
    const target = path.join(archiveDir, entry.name);
    const stat = await statForPlan(target, 'changes', fileSystem, blockers);
    if (stat?.isDirectory() && !stat.isSymbolicLink()) {
      results.push({ changeDir: target, archived: true, name: entry.name });
    }
  }

  return results.sort(
    (left, right) =>
      Number(left.archived) - Number(right.archived) || left.name.localeCompare(right.name)
  );
}

export async function discoverChangeDirs(
  changesDir: string,
  options: {
    changeName?: string;
    pathIdentityFlavor?: PathIdentityFlavor;
    fileSystem?: WorkMigrationFileSystem;
  } = {}
): Promise<DiscoveredChangeDir[]> {
  const blockers: WorkMigrationBlocker[] = [];
  const result = await discoverChangeDirsForPlan(
    changesDir,
    options,
    options.fileSystem ?? defaultWorkMigrationFileSystem,
    blockers
  );
  if (blockers.length > 0) {
    const first = blockers[0];
    throw Object.assign(new Error(first.message), { code: first.code, path: first.path });
  }
  return result;
}

async function walkFilesForPlan(
  root: string,
  phase: WorkMigrationPhase,
  fileSystem: WorkMigrationFileSystem,
  blockers: WorkMigrationBlocker[]
): Promise<string[]> {
  const files: string[] = [];
  async function walk(target: string): Promise<void> {
    for (const entry of await readDirForPlan(target, phase, fileSystem, blockers)) {
      const absolute = path.join(target, entry.name);
      const stat = await statForPlan(absolute, phase, fileSystem, blockers);
      if (!stat || stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) await walk(absolute);
      else if (stat.isFile()) files.push(absolute);
    }
  }
  await walk(root);
  return files.sort();
}

async function scanProbeDirsForPlan(
  machineHome: string,
  fileSystem: WorkMigrationFileSystem,
  blockers: WorkMigrationBlocker[]
): Promise<ProbeDirScanResult[]> {
  const results: ProbeDirScanResult[] = [];
  for (const baseName of PROBE_DIR_NAMES) {
    const base = path.join(machineHome, baseName);
    for (const entry of await readDirForPlan(base, 'probe', fileSystem, blockers)) {
      const source = path.join(base, entry.name);
      const stat = await statForPlan(source, 'probe', fileSystem, blockers);
      if (!stat?.isDirectory() || stat.isSymbolicLink()) continue;
      const files = await walkFilesForPlan(source, 'probe', fileSystem, blockers);
      let drivers = 0;
      let data = 0;
      for (const filename of files) {
        const extension = path.extname(filename).toLowerCase();
        if (DRIVER_EXTENSIONS.has(extension)) drivers++;
        else if (DATA_EXTENSIONS.has(extension)) data++;
      }
      const classification: ProbeClassificationKind =
        drivers > 0 ? 'driver-harness' : data > 0 ? 'sampling-output' : 'conclusions';
      results.push({
        dirName: entry.name,
        source,
        classification,
        action:
          classification === 'driver-harness'
            ? 'move-to-probes'
            : classification === 'sampling-output'
              ? 'move-to-ephemera'
              : 'leave',
      });
    }
  }
  return results.sort((left, right) => left.source.localeCompare(right.source));
}

export async function scanProbeDirs(
  machineHome: string,
  fileSystem: WorkMigrationFileSystem = defaultWorkMigrationFileSystem
): Promise<ProbeDirScanResult[]> {
  const blockers: WorkMigrationBlocker[] = [];
  const result = await scanProbeDirsForPlan(machineHome, fileSystem, blockers);
  if (blockers.length > 0) {
    const first = blockers[0];
    throw Object.assign(new Error(first.message), { code: first.code, path: first.path });
  }
  return result;
}

async function destinationConflict(
  destination: string | null,
  phase: WorkMigrationPhase,
  fileSystem: WorkMigrationFileSystem,
  blockers: WorkMigrationBlocker[]
): Promise<boolean> {
  if (!destination) return false;
  return (await statForPlan(destination, phase, fileSystem, blockers)) !== null;
}

function actionId(index: number): string {
  return `migration-${String(index + 1).padStart(6, '0')}`;
}

export interface PlanWorkMigrationOptions {
  changeName?: string;
  /** Compatibility-only: explicit root contexts carry their own flavor. */
  pathIdentityFlavor?: PathIdentityFlavor;
  discardAbsorbedConclusions?: boolean;
  globalDataDir?: string;
  /**
   * Deprecated compatibility key. Root-capable callers must pass a complete
   * `WorkMigrationRootContext`; this flag no longer derives execution from cwd.
   */
  storeSelected?: boolean;
  fileSystem?: WorkMigrationFileSystem;
  /** Internal compatibility seam: apply may resolve/create identity before planning. */
  resolvedHome?: ProjectHome | null;
}

async function resolveReadOnlyHome(
  projectRoot: string,
  globalDataDir?: string
): Promise<ProjectHome | null> {
  const pathOptions: ProjectPathOptions =
    globalDataDir !== undefined ? { globalDataDir } : {};
  try {
    const home = await resolveProjectHome(projectRoot, { ensure: false, ...pathOptions });
    if (home) return home;
  } catch {
    // Registry fallback below is still read-only.
  }
  const registry = await findProjectRegistryEntry(projectRoot, pathOptions);
  if (!registry) return null;
  const homeDir = getProjectHomeDir(registry.entry.home, pathOptions);
  return {
    projectId: registry.entry.projectId,
    name: registry.entry.name,
    mode: registry.entry.mode,
    homeDir,
    workDir: changeName => path.join(homeDir, 'changes', changeName, 'work'),
    archiveDir: path.join(homeDir, 'archive'),
    archivedWorkDir: archivedName =>
      path.join(homeDir, 'changes', 'archive', archivedName, 'work'),
  };
}

function compatibilityRootContext(
  projectRoot: string,
  changesDir: string,
  options: PlanWorkMigrationOptions
): WorkMigrationRootContext {
  return freezeWorkMigrationRootContext({
    planningRoot: projectRoot,
    changesDir,
    executionRoot: projectRoot,
    legacyHomeOwnerRoot: projectRoot,
    pathIdentityFlavor: options.pathIdentityFlavor ?? NATIVE_PATH_IDENTITY_FLAVOR,
  });
}

function isWorkMigrationRootContext(
  value: string | WorkMigrationRootContext
): value is WorkMigrationRootContext {
  return typeof value !== 'string';
}

export function planWorkMigration(
  rootContext: WorkMigrationRootContext,
  options?: PlanWorkMigrationOptions
): Promise<WorkMigrationPlan>;
export function planWorkMigration(
  projectRoot: string,
  changesDir: string,
  options?: PlanWorkMigrationOptions
): Promise<WorkMigrationPlan>;
export async function planWorkMigration(
  rootOrProject: string | WorkMigrationRootContext,
  changesDirOrOptions: string | PlanWorkMigrationOptions = {},
  legacyOptions: PlanWorkMigrationOptions = {}
): Promise<WorkMigrationPlan> {
  const explicitContext = isWorkMigrationRootContext(rootOrProject);
  const options = (
    explicitContext
      ? changesDirOrOptions
      : legacyOptions
  ) as PlanWorkMigrationOptions;
  const rootContext = explicitContext
    ? freezeWorkMigrationRootContext(rootOrProject)
    : compatibilityRootContext(rootOrProject, changesDirOrOptions as string, options);
  const projectRoot = rootContext.planningRoot;
  const changesDir = rootContext.changesDir;
  const fileSystem = options.fileSystem ?? defaultWorkMigrationFileSystem;
  const blockers: WorkMigrationBlocker[] = [];
  const home =
    options.resolvedHome !== undefined
      ? options.resolvedHome
      : await resolveReadOnlyHome(rootContext.legacyHomeOwnerRoot, options.globalDataDir);
  const executionRoot = rootContext.executionRoot;
  const discoveredChanges = await discoverChangeDirsForPlan(
    changesDir,
    {
      ...(options.changeName === undefined ? {} : { changeName: options.changeName }),
      pathIdentityFlavor: rootContext.pathIdentityFlavor,
    },
    fileSystem,
    blockers
  );
  const notes = [RUN_ARTIFACT_CAVEAT_NOTE];
  if (!home) {
    notes.push(
      `No machine identity is registered for this project yet; destinations remain pending under ${path.join(options.globalDataDir ?? getGlobalDataDir(), 'projects')}.`
    );
  }

  const pending: Omit<WorkMigrationAction, 'id'>[] = [];
  const changeNotes: Record<string, string[]> = {};

  if (home) {
    for (const change of discoveredChanges) {
      const workDir = change.archived
        ? home.archivedWorkDir(change.name)
        : home.workDir(change.name);
      const scan = await scanWorkDirForPlan(workDir, fileSystem, blockers);
      changeNotes[change.name] = scan.notes;
      for (const candidate of scan.candidates) {
        let destination: string | null = null;
        let action: WorkMigrationActionKind = 'move-file';
        let sourceFingerprint: WorkMigrationSourceFingerprint | undefined;
        if (candidate.kind === 'run-state' && change.archived) {
          action = 'discard-file';
        } else if (candidate.kind === 'report') {
          const relative = candidate.relativePath.replace(/^(verification\/|handoff\/)/, '');
          destination = path.join(evidenceDir(change.changeDir), ...relative.split('/'));
        } else if (candidate.kind === 'handoff') {
          destination = path.join(handoffDir(change.changeDir), path.basename(candidate.relativePath));
        } else {
          destination = path.join(
            ephemeraDir(executionRoot, change.name),
            path.basename(candidate.relativePath)
          );
        }
        if (action === 'discard-file') {
          try {
            sourceFingerprint = await fingerprintDiscardSource(
              candidate.source,
              'file',
              fileSystem
            );
          } catch (error) {
            blockers.push(fingerprintBlocker('change-work', candidate.source, error));
            continue;
          }
        }
        const visibleConflict = await destinationConflict(
          destination,
          'change-work',
          fileSystem,
          blockers
        );
        pending.push({
          phase: 'change-work',
          source: candidate.source,
          destination,
          fileType: 'file',
          action,
          classification: candidate.kind,
          owner: change.name,
          scope: 'change',
          relativePath: candidate.relativePath,
          preconditions: [
            { kind: 'source-exists', value: candidate.source },
            { kind: 'source-type', value: 'file' },
            ...(destination
              ? [{ kind: 'destination-absent' as const, value: destination }]
              : []),
          ],
          ...(sourceFingerprint ? { sourceFingerprint } : {}),
          visibleConflict,
          notes: [],
          change: {
            name: change.name,
            archived: change.archived,
            changeDir: change.changeDir,
            workDir,
          },
        });
      }
    }

    // Global locations have no durable per-change owner and are omitted from a
    // --change plan entirely.
    if (options.changeName === undefined) {
      const probes = await scanProbeDirsForPlan(home.homeDir, fileSystem, blockers);
      for (const probe of probes) {
        let reportAction = probe.action;
        let action: WorkMigrationActionKind;
        let destination: string | null = null;
        if (probe.classification === 'conclusions') {
          if (options.discardAbsorbedConclusions) {
            action = 'discard-directory';
            reportAction = 'discard';
          } else {
            action = 'leave';
            reportAction = 'leave';
          }
        } else if (probe.classification === 'driver-harness') {
          action = 'move-directory';
          destination = path.join(executionRoot, '.rasen', 'probes', probe.dirName);
        } else {
          action = 'move-directory';
          destination = path.join(
            executionRoot,
            '.rasen',
            'changes',
            probe.dirName,
            'ephemera'
          );
        }
        let sourceFingerprint: WorkMigrationSourceFingerprint | undefined;
        if (action === 'discard-directory') {
          try {
            sourceFingerprint = await fingerprintDiscardSource(
              probe.source,
              'directory',
              fileSystem
            );
          } catch (error) {
            blockers.push(fingerprintBlocker('probe', probe.source, error));
            continue;
          }
        }
        pending.push({
          phase: 'probe',
          source: probe.source,
          destination,
          fileType: 'directory',
          action,
          classification: probe.classification,
          owner: null,
          scope: 'global',
          relativePath: probe.dirName,
          preconditions: [
            { kind: 'source-exists', value: probe.source },
            { kind: 'source-type', value: 'directory' },
            ...(destination
              ? [{ kind: 'destination-absent' as const, value: destination }]
              : []),
          ],
          ...(sourceFingerprint ? { sourceFingerprint } : {}),
          visibleConflict: await destinationConflict(
            destination,
            'probe',
            fileSystem,
            blockers
          ),
          notes: [],
          probe: { dirName: probe.dirName, reportAction },
        });
      }

      const sourceDocs = path.join(home.homeDir, 'design-docs');
      for (const source of await walkFilesForPlan(
        sourceDocs,
        'design-doc',
        fileSystem,
        blockers
      )) {
        const relative = path.relative(sourceDocs, source);
        const destination = path.join(designDocsDir(rootContext.planningRoot), relative);
        pending.push({
          phase: 'design-doc',
          source,
          destination,
          fileType: 'file',
          action: 'move-file',
          classification: 'design-doc',
          owner: null,
          scope: 'global',
          relativePath: normalizeRelative(relative),
          preconditions: [
            { kind: 'source-exists', value: source },
            { kind: 'source-type', value: 'file' },
            { kind: 'destination-absent', value: destination },
          ],
          visibleConflict: await destinationConflict(
            destination,
            'design-doc',
            fileSystem,
            blockers
          ),
          notes: [],
        });
      }
    }
  }

  const actions = pending.map((action, index) => ({ id: actionId(index), ...action }));
  return {
    version: 1,
    rootContext,
    projectRoot,
    changesDir,
    machineHome: home?.homeDir ?? null,
    executionRoot,
    scopedChange: options.changeName ?? null,
    actions,
    blockers,
    complete: blockers.length === 0,
    notes,
    discoveredChanges,
    changeNotes,
  };
}

function outcome(
  action: WorkMigrationAction,
  status: WorkMigrationOutcomeStatus,
  extras: Omit<
    WorkMigrationApplyOutcome,
    'actionId' | 'status' | 'source' | 'destination'
  > = {}
): WorkMigrationApplyOutcome {
  return {
    actionId: action.id,
    status,
    source: action.source,
    destination: action.destination,
    ...extras,
  };
}

async function sourceStat(
  action: WorkMigrationAction,
  fileSystem: WorkMigrationFileSystem
): Promise<Stats | WorkMigrationApplyOutcome> {
  try {
    return await fileSystem.lstat(action.source);
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return outcome(action, 'already-absent');
    return outcome(action, 'failed', {
      ...(codeOf(error) ? { code: codeOf(error) } : {}),
      error: messageOf(error),
      survivingPaths: [action.source],
    });
  }
}

async function pathExistsAfterFailure(
  target: string,
  fileSystem: WorkMigrationFileSystem
): Promise<boolean> {
  try {
    await fileSystem.lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function publishFile(
  action: WorkMigrationAction,
  fileSystem: WorkMigrationFileSystem
): Promise<WorkMigrationApplyOutcome> {
  if (!action.destination) {
    return outcome(action, 'failed', { error: 'Missing destination' });
  }
  const stat = await sourceStat(action, fileSystem);
  if (!('isFile' in stat)) return stat;
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return outcome(action, 'failed', {
      error: 'Source is not a regular file',
      survivingPaths: [action.source],
    });
  }
  if (action.visibleConflict) {
    return outcome(action, 'conflict', {
      survivingPaths: [action.source, action.destination],
    });
  }

  try {
    await fileSystem.mkdir(path.dirname(action.destination), { recursive: true });
  } catch (error) {
    return outcome(action, 'failed', {
      ...(codeOf(error) ? { code: codeOf(error) } : {}),
      error: messageOf(error),
      survivingPaths: [action.source],
    });
  }

  let published = false;
  try {
    await fileSystem.link(action.source, action.destination);
    published = true;
  } catch (error) {
    const code = codeOf(error);
    if (code === 'EEXIST') {
      return outcome(action, 'conflict', {
        code,
        survivingPaths: [action.source, action.destination],
      });
    }
    if (code !== 'EXDEV') {
      return outcome(action, 'failed', {
        ...(code ? { code } : {}),
        error: messageOf(error),
        survivingPaths: [action.source],
      });
    }
    try {
      await fileSystem.copyFile(action.source, action.destination, fsConstants.COPYFILE_EXCL);
      published = true;
    } catch (copyError) {
      const copyCode = codeOf(copyError);
      const destinationExists = await pathExistsAfterFailure(action.destination, fileSystem);
      return outcome(action, copyCode === 'EEXIST' ? 'conflict' : 'failed', {
        ...(copyCode ? { code: copyCode } : {}),
        error: messageOf(copyError),
        survivingPaths: [
          action.source,
          ...(destinationExists ? [action.destination] : []),
        ],
        ...(destinationExists ? { partialPaths: [action.destination] } : {}),
      });
    }
  }

  if (!published) {
    return outcome(action, 'failed', { error: 'Destination was not published' });
  }

  try {
    const [sourceContent, destinationContent, destinationStat] = await Promise.all([
      fileSystem.readFile(action.source),
      fileSystem.readFile(action.destination),
      fileSystem.lstat(action.destination),
    ]);
    const sourceHash = createHash('sha256').update(sourceContent).digest('hex');
    const destinationHash = createHash('sha256').update(destinationContent).digest('hex');
    if (!destinationStat.isFile() || sourceHash !== destinationHash) {
      return outcome(action, 'incomplete', {
        error: 'Published file verification mismatch',
        survivingPaths: [action.source, action.destination],
        partialPaths: [action.destination],
      });
    }
  } catch (error) {
    return outcome(action, 'incomplete', {
      ...(codeOf(error) ? { code: codeOf(error) } : {}),
      error: `Published file verification failed: ${messageOf(error)}`,
      survivingPaths: [action.source, action.destination],
      partialPaths: [action.destination],
    });
  }

  try {
    await fileSystem.unlink(action.source);
    return outcome(action, 'moved');
  } catch (error) {
    return outcome(action, codeOf(error) === 'ENOENT' ? 'moved' : 'incomplete', {
      ...(codeOf(error) ? { code: codeOf(error) } : {}),
      ...(codeOf(error) === 'ENOENT' ? {} : { error: messageOf(error) }),
      ...(codeOf(error) === 'ENOENT'
        ? {}
        : {
            survivingPaths: [action.source, action.destination],
            partialPaths: [action.destination],
          }),
    });
  }
}

async function copyDirectoryExclusive(
  source: string,
  destination: string,
  fileSystem: WorkMigrationFileSystem,
  createdPaths: string[]
): Promise<void> {
  for (const entry of (await fileSystem.readdir(source)).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const sourceChild = path.join(source, entry.name);
    const destinationChild = path.join(destination, entry.name);
    const stat = await fileSystem.lstat(sourceChild);
    if (stat.isSymbolicLink()) {
      const target = await fileSystem.readlink(sourceChild);
      await fileSystem.symlink(target, destinationChild);
      createdPaths.push(destinationChild);
    } else if (stat.isDirectory()) {
      await fileSystem.mkdir(destinationChild, { recursive: false });
      createdPaths.push(destinationChild);
      await copyDirectoryExclusive(sourceChild, destinationChild, fileSystem, createdPaths);
    } else if (stat.isFile()) {
      await fileSystem.copyFile(sourceChild, destinationChild, fsConstants.COPYFILE_EXCL);
      createdPaths.push(destinationChild);
    } else {
      throw new Error(`Unsupported source entry: ${sourceChild}`);
    }
  }
}

async function directorySignature(
  root: string,
  fileSystem: WorkMigrationFileSystem
): Promise<string[]> {
  const signature: string[] = [];
  async function walk(target: string, prefix: string): Promise<void> {
    for (const entry of (await fileSystem.readdir(target)).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const absolute = path.join(target, entry.name);
      const relative = normalizeRelative(prefix ? path.join(prefix, entry.name) : entry.name);
      const stat = await fileSystem.lstat(absolute);
      if (stat.isSymbolicLink()) {
        signature.push(`l:${relative}:${await fileSystem.readlink(absolute)}`);
      } else if (stat.isDirectory()) {
        signature.push(`d:${relative}`);
        await walk(absolute, relative);
      } else if (stat.isFile()) {
        const hash = createHash('sha256')
          .update(await fileSystem.readFile(absolute))
          .digest('hex');
        signature.push(`f:${relative}:${stat.size}:${hash}`);
      } else {
        signature.push(`s:${relative}:${stat.mode}`);
      }
    }
  }
  await walk(root, '');
  return signature;
}

async function publishDirectory(
  action: WorkMigrationAction,
  fileSystem: WorkMigrationFileSystem
): Promise<WorkMigrationApplyOutcome> {
  if (!action.destination) return outcome(action, 'failed', { error: 'Missing destination' });
  const stat = await sourceStat(action, fileSystem);
  if (!('isDirectory' in stat)) return stat;
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return outcome(action, 'failed', {
      error: 'Source is not a regular directory',
      survivingPaths: [action.source],
    });
  }
  if (action.visibleConflict) {
    return outcome(action, 'conflict', {
      survivingPaths: [action.source, action.destination],
    });
  }
  try {
    await fileSystem.mkdir(path.dirname(action.destination), { recursive: true });
    await fileSystem.mkdir(action.destination, { recursive: false });
  } catch (error) {
    return outcome(action, codeOf(error) === 'EEXIST' ? 'conflict' : 'failed', {
      ...(codeOf(error) ? { code: codeOf(error) } : {}),
      error: messageOf(error),
      survivingPaths: [
        action.source,
        ...(codeOf(error) === 'EEXIST' ? [action.destination] : []),
      ],
    });
  }

  const createdPaths = [action.destination];
  try {
    await copyDirectoryExclusive(action.source, action.destination, fileSystem, createdPaths);
  } catch (error) {
    const status = codeOf(error) === 'EEXIST' ? 'conflict' : 'incomplete';
    return outcome(action, status, {
      ...(codeOf(error) ? { code: codeOf(error) } : {}),
      error: messageOf(error),
      survivingPaths: [action.source, action.destination],
      partialPaths: createdPaths,
    });
  }

  try {
    const [sourceSignature, destinationSignature] = await Promise.all([
      directorySignature(action.source, fileSystem),
      directorySignature(action.destination, fileSystem),
    ]);
    if (JSON.stringify(sourceSignature) !== JSON.stringify(destinationSignature)) {
      return outcome(action, 'incomplete', {
        error: 'Published directory verification mismatch',
        survivingPaths: [action.source, action.destination],
        partialPaths: createdPaths,
      });
    }
  } catch (error) {
    return outcome(action, 'incomplete', {
      ...(codeOf(error) ? { code: codeOf(error) } : {}),
      error: `Published directory verification failed: ${messageOf(error)}`,
      survivingPaths: [action.source, action.destination],
      partialPaths: createdPaths,
    });
  }

  try {
    await fileSystem.rm(action.source, { recursive: true, force: false });
    return outcome(action, 'moved');
  } catch (error) {
    return outcome(action, codeOf(error) === 'ENOENT' ? 'moved' : 'incomplete', {
      ...(codeOf(error) ? { code: codeOf(error) } : {}),
      ...(codeOf(error) === 'ENOENT' ? {} : { error: messageOf(error) }),
      ...(codeOf(error) === 'ENOENT'
        ? {}
        : {
            survivingPaths: [action.source, action.destination],
            partialPaths: createdPaths,
          }),
    });
  }
}

async function discardAction(
  action: WorkMigrationAction,
  fileSystem: WorkMigrationFileSystem
): Promise<WorkMigrationApplyOutcome> {
  if (!action.sourceFingerprint) {
    return outcome(action, 'failed', {
      error: 'Destructive action is missing its planned source fingerprint',
      survivingPaths: [action.source],
    });
  }

  let currentFingerprint: WorkMigrationSourceFingerprint;
  try {
    currentFingerprint = await fingerprintDiscardSource(
      action.source,
      action.fileType,
      fileSystem
    );
  } catch (error) {
    const code =
      error instanceof WorkMigrationInspectionError ? error.code : codeOf(error);
    if (code === 'ENOENT') return outcome(action, 'already-absent');
    const changed = code === 'ESTALE';
    return outcome(action, changed ? 'conflict' : 'failed', {
      ...(code ? { code } : {}),
      error: messageOf(error),
      survivingPaths: [action.source],
    });
  }

  if (!sameSourceFingerprint(action.sourceFingerprint, currentFingerprint)) {
    return outcome(action, 'conflict', {
      code: 'ESTALE',
      error: 'Source identity or content changed after migration planning',
      survivingPaths: [action.source],
    });
  }

  try {
    if (action.action === 'discard-directory') {
      await fileSystem.rm(action.source, { recursive: true, force: false });
    } else {
      await fileSystem.unlink(action.source);
    }
    return outcome(action, 'discarded');
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return outcome(action, 'already-absent');
    return outcome(action, 'failed', {
      ...(codeOf(error) ? { code: codeOf(error) } : {}),
      error: messageOf(error),
      survivingPaths: [action.source],
    });
  }
}

export async function applyWorkMigration(
  plan: WorkMigrationPlan,
  options: { fileSystem?: WorkMigrationFileSystem } = {}
): Promise<WorkMigrationApplyResult> {
  if (!plan.complete || plan.blockers.length > 0) {
    return { applied: false, outcomes: [], blockers: [...plan.blockers] };
  }
  const fileSystem = options.fileSystem ?? defaultWorkMigrationFileSystem;
  const outcomes: WorkMigrationApplyOutcome[] = [];
  for (const action of plan.actions) {
    if (action.action === 'leave') {
      outcomes.push(outcome(action, 'left', { survivingPaths: [action.source] }));
    } else if (action.action === 'discard-file' || action.action === 'discard-directory') {
      outcomes.push(await discardAction(action, fileSystem));
    } else if (action.action === 'move-file') {
      outcomes.push(await publishFile(action, fileSystem));
    } else {
      outcomes.push(await publishDirectory(action, fileSystem));
    }
  }
  return { applied: true, outcomes, blockers: [] };
}

export interface MigratableEphemeraCounts {
  total: number;
  reports: number;
  handoff: number;
  runState: number;
  unavailable: boolean;
}

export async function countMigratableEphemera(
  projectRoot: string,
  _changesDir: string,
  options: { globalDataDir?: string } = {}
): Promise<MigratableEphemeraCounts> {
  const pathOptions: ProjectPathOptions =
    options.globalDataDir !== undefined ? { globalDataDir: options.globalDataDir } : {};
  const registry = await findProjectRegistryEntry(projectRoot, pathOptions);
  if (!registry) {
    return { total: 0, reports: 0, handoff: 0, runState: 0, unavailable: true };
  }
  const homeDir = getProjectHomeDir(registry.entry.home, pathOptions);
  let reports = 0;
  let handoff = 0;
  let runState = 0;
  const roots: string[] = [];
  const changesRoot = path.join(homeDir, 'changes');
  let entries: Dirent[];
  try {
    entries = await defaultWorkMigrationFileSystem.readdir(changesRoot);
  } catch (error) {
    if (codeOf(error) === 'ENOENT') {
      return { total: 0, reports: 0, handoff: 0, runState: 0, unavailable: false };
    }
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (entry.name !== 'archive') {
      roots.push(path.join(changesRoot, entry.name, 'work'));
      continue;
    }
    const archiveRoot = path.join(changesRoot, 'archive');
    for (const archived of await defaultWorkMigrationFileSystem
      .readdir(archiveRoot)
      .catch(error => (codeOf(error) === 'ENOENT' ? [] : Promise.reject(error)))) {
      if (archived.isDirectory()) roots.push(path.join(archiveRoot, archived.name, 'work'));
    }
  }
  for (const root of roots.sort()) {
    const scan = await scanMachineHomeWorkDir(root);
    for (const candidate of scan.candidates) {
      if (candidate.kind === 'report') reports++;
      else if (candidate.kind === 'handoff') handoff++;
      else runState++;
    }
  }
  return { total: reports + handoff + runState, reports, handoff, runState, unavailable: false };
}

export type MigrationFileStatus =
  | 'planned'
  | 'moved'
  | 'conflict'
  | 'failed'
  | 'discarded'
  | 'already-absent';

export interface MigrationFileReport {
  source: string;
  destination: string | null;
  relativePath: string;
  kind: MigrationCandidateKind;
  status: MigrationFileStatus;
  action: WorkMigrationActionKind;
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
  plan: WorkMigrationPlan;
  outcomes: WorkMigrationApplyOutcome[];
  blockers: WorkMigrationBlocker[];
  summary: {
    totalCandidates: number;
    moved: number;
    conflicts: number;
    failed: number;
    discarded: number;
  };
}

export interface RunWorkMigrationOptions extends Omit<PlanWorkMigrationOptions, 'resolvedHome'> {
  execute: boolean;
}

export type RunWorkMigrationResult =
  | { ok: true; report: WorkMigrationReport }
  | { ok: false; reason: 'home_unresolved' }
  | { ok: false; reason: 'change_not_found' };

function reportStatus(
  action: WorkMigrationAction,
  outcomeRecord: WorkMigrationApplyOutcome | undefined,
  executed: boolean
): { status: MigrationFileStatus; error?: string } {
  if (!executed) {
    return { status: action.visibleConflict ? 'conflict' : 'planned' };
  }
  if (!outcomeRecord) return { status: 'failed', error: 'Apply was blocked by an incomplete plan' };
  switch (outcomeRecord.status) {
    case 'moved':
      return { status: 'moved' };
    case 'discarded':
      return { status: 'discarded' };
    case 'conflict':
      return { status: 'conflict', ...(outcomeRecord.error ? { error: outcomeRecord.error } : {}) };
    case 'already-absent':
      return { status: 'already-absent' };
    case 'failed':
    case 'incomplete':
      return { status: 'failed', error: outcomeRecord.error ?? outcomeRecord.status };
    case 'left':
      return { status: 'planned' };
  }
}

export function projectWorkMigrationReport(
  plan: WorkMigrationPlan,
  applyResult: WorkMigrationApplyResult | null
): WorkMigrationReport {
  const outcomeById = new Map(
    (applyResult?.outcomes ?? []).map(outcomeRecord => [outcomeRecord.actionId, outcomeRecord])
  );
  const executed = applyResult !== null;
  const changes: ChangeMigrationReport[] = plan.discoveredChanges.map(change => {
    const actions = plan.actions.filter(
      action => action.phase === 'change-work' && action.change?.name === change.name
    );
    return {
      change: change.name,
      archived: change.archived,
      changeDir: change.changeDir,
      workDir: actions[0]?.change?.workDir ?? null,
      files: actions.map(action => {
        const projected = reportStatus(action, outcomeById.get(action.id), executed);
        return {
          source: action.source,
          destination: action.destination,
          relativePath: action.relativePath,
          kind: action.classification as MigrationCandidateKind,
          status: projected.status,
          action: action.action,
          ...(projected.error ? { error: projected.error } : {}),
        };
      }),
      notes: plan.changeNotes[change.name] ?? [],
    };
  });
  const probeDirs: ProbeMigrationReport[] = plan.actions
    .filter(action => action.phase === 'probe')
    .map(action => {
      const projected = reportStatus(action, outcomeById.get(action.id), executed);
      return {
        dirName: action.probe!.dirName,
        source: action.source,
        classification: action.classification as ProbeClassificationKind,
        action: action.probe!.reportAction,
        destination: action.destination,
        status: projected.status,
        ...(projected.error ? { error: projected.error } : {}),
      };
    });
  const designDocs: DesignDocMigrationReport[] = plan.actions
    .filter(action => action.phase === 'design-doc')
    .map(action => {
      const projected = reportStatus(action, outcomeById.get(action.id), executed);
      return {
        source: action.source,
        destination: action.destination!,
        status: projected.status,
        ...(projected.error ? { error: projected.error } : {}),
      };
    });
  const outcomes = applyResult?.outcomes ?? [];
  return {
    changes,
    probeDirs,
    designDocs,
    notes: plan.notes,
    plan,
    outcomes,
    blockers: plan.blockers,
    summary: {
      totalCandidates: plan.actions.filter(action => action.phase === 'change-work').length,
      moved: outcomes.filter(record => record.status === 'moved').length,
      conflicts: executed
        ? outcomes.filter(record => record.status === 'conflict').length
        : plan.actions.filter(action => action.visibleConflict).length,
      failed: outcomes.filter(
        record => record.status === 'failed' || record.status === 'incomplete'
      ).length,
      discarded: executed
        ? outcomes.filter(record => record.status === 'discarded').length
        : plan.actions.filter(
            action => action.action === 'discard-file' || action.action === 'discard-directory'
          ).length,
    },
  };
}

export function runWorkMigration(
  rootContext: WorkMigrationRootContext,
  options: RunWorkMigrationOptions
): Promise<RunWorkMigrationResult>;
export function runWorkMigration(
  projectRoot: string,
  changesDir: string,
  options: RunWorkMigrationOptions
): Promise<RunWorkMigrationResult>;
export async function runWorkMigration(
  rootOrProject: string | WorkMigrationRootContext,
  changesDirOrOptions: string | RunWorkMigrationOptions,
  legacyOptions?: RunWorkMigrationOptions
): Promise<RunWorkMigrationResult> {
  const explicitContext = isWorkMigrationRootContext(rootOrProject);
  const options = (
    explicitContext ? changesDirOrOptions : legacyOptions
  ) as RunWorkMigrationOptions;
  const rootContext = explicitContext
    ? freezeWorkMigrationRootContext(rootOrProject)
    : compatibilityRootContext(rootOrProject, changesDirOrOptions as string, options);
  let resolvedHome: ProjectHome | null | undefined;
  if (options.execute) {
    const pathOptions: ProjectPathOptions =
      options.globalDataDir !== undefined ? { globalDataDir: options.globalDataDir } : {};
    try {
      resolvedHome = await resolveProjectHome(rootContext.legacyHomeOwnerRoot, {
        ensure: true,
        ...pathOptions,
      });
    } catch {
      return { ok: false, reason: 'home_unresolved' };
    }
    if (!resolvedHome) return { ok: false, reason: 'home_unresolved' };
  }
  const plan = await planWorkMigration(rootContext, {
    ...(options.changeName !== undefined ? { changeName: options.changeName } : {}),
    ...(options.pathIdentityFlavor !== undefined
      ? { pathIdentityFlavor: options.pathIdentityFlavor }
      : {}),
    ...(options.discardAbsorbedConclusions !== undefined
      ? { discardAbsorbedConclusions: options.discardAbsorbedConclusions }
      : {}),
    ...(options.globalDataDir !== undefined ? { globalDataDir: options.globalDataDir } : {}),
    ...(options.fileSystem ? { fileSystem: options.fileSystem } : {}),
    ...(resolvedHome !== undefined ? { resolvedHome } : {}),
  });
  if (options.changeName !== undefined && plan.discoveredChanges.length === 0) {
    return { ok: false, reason: 'change_not_found' };
  }
  const applyResult = options.execute
    ? await applyWorkMigration(plan, {
        ...(options.fileSystem ? { fileSystem: options.fileSystem } : {}),
      })
    : null;
  return { ok: true, report: projectWorkMigrationReport(plan, applyResult) };
}
