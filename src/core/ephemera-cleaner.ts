/**
 * Conservative ephemera cleanup.
 *
 * Classification is a complete, read-only preflight. Apply consumes that
 * preflight and deletes only unchanged, regular, top-level whitelist entries.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { Dirent, Stats } from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';

import {
  NATIVE_PATH_IDENTITY_FLAVOR,
  pathIdentityEquals,
  type PathIdentityFlavor,
} from './path-identity.js';
import { parsePortfolioState } from './pipeline-registry/portfolio-state.js';
import { parseRunState } from './pipeline-registry/run-state.js';

export const KNOWN_STATE_FILENAMES = [
  'auto-run.json',
  'portfolio-run.json',
  'goal-run.json',
] as const;

export const CONTROL_STATE_FILENAMES = [
  '.signal',
  '.lock',
  '.heartbeat',
  'expert-selection-explicit.json',
] as const;

export const SOURCE_MANIFEST_FILENAMES = [
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
  'build.rs',
  'rust-toolchain.toml',
] as const;

export const SOURCE_DIRECTORY_NAMES = [
  'src',
  'source',
  'lib',
  'include',
  'native',
] as const;

export const SOURCE_EXTENSIONS = [
  '.c',
  '.cc',
  '.cpp',
  '.cs',
  '.go',
  '.h',
  '.hpp',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.kts',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.swift',
  '.ts',
  '.tsx',
] as const;

const RUN_STATE_NAMES = new Set<string>(KNOWN_STATE_FILENAMES);
const CONTROL_STATE_NAMES = new Set<string>(CONTROL_STATE_FILENAMES);
const SOURCE_DIRECTORY_NAME_SET = new Set<string>(SOURCE_DIRECTORY_NAMES);
const SOURCE_EXTENSION_SET = new Set<string>(SOURCE_EXTENSIONS);
const RAW_LOG_PATTERN = /\.log$/i;
const RAW_JSON_PATTERN = /^raw-.*\.json$/i;
const BENCHMARK_PATTERN = /^benchmark-.*\.json$/i;
const VERSION_KEYS = ['version', 'schemaVersion', 'formatVersion'] as const;
const MAX_GOAL_ROUNDS = 10_000;
const MAX_GOAL_TEXT = 1_000_000;

const GoalRoundSchema = z
  .object({
    round: z.number().int().positive(),
    score: z.number().finite().optional(),
    measurePassed: z.boolean().optional(),
    evaluateSatisfied: z.boolean().optional(),
    detail: z.string().max(MAX_GOAL_TEXT).optional(),
    gaps: z.array(z.string().max(MAX_GOAL_TEXT)).max(10_000).optional(),
    error: z.string().max(MAX_GOAL_TEXT).optional(),
    gitTreeFingerprint: z.string().min(1).max(4096).optional(),
    stallStreak: z.number().int().nonnegative().optional(),
    blockedStreak: z.number().int().nonnegative().optional(),
    blocker: z.string().max(MAX_GOAL_TEXT).optional(),
  })
  .passthrough()
  .refine(
    record =>
      record.score !== undefined ||
      record.measurePassed !== undefined ||
      record.evaluateSatisfied !== undefined ||
      record.detail !== undefined ||
      record.gaps !== undefined ||
      record.error !== undefined ||
      record.gitTreeFingerprint !== undefined,
    { message: 'goal round has no recorded judgment' }
  );

const GoalRunSchema = z.union([
  GoalRoundSchema,
  z.array(GoalRoundSchema).max(MAX_GOAL_ROUNDS),
  z
    .object({
      rounds: z.array(GoalRoundSchema).max(MAX_GOAL_ROUNDS),
    })
    .passthrough(),
]);

export interface EphemeraFileSystem {
  readdir(dir: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  lstat(target: string): Promise<Stats>;
  readFile(target: string): Promise<Buffer>;
  unlink(target: string): Promise<void>;
}

const defaultFileSystem: EphemeraFileSystem = {
  readdir: (dir, options) => fs.readdir(dir, options),
  lstat: target => fs.lstat(target),
  readFile: target => fs.readFile(target),
  unlink: target => fs.unlink(target),
};

export type EphemeraOperation = 'readdir' | 'lstat' | 'readFile' | 'validate' | 'unlink';

export interface EphemeraBlocker {
  operation: EphemeraOperation;
  path: string;
  code?: string;
  message: string;
}

export interface EphemeraPreservedEntry {
  path: string;
  reason:
    | 'unknown'
    | 'nested'
    | 'directory'
    | 'symlink'
    | 'special'
    | 'invalid-state'
    | 'source-signal'
    | 'inspection-blocked'
    | 'cleaning-aborted';
  detail?: string;
}

export interface EphemeraCandidateFingerprint {
  relativePath: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  dev: number;
  ino: number;
  mode: number;
  sha256: string;
}

export interface EphemeraClassification {
  /** Compatibility projection: top-level whitelist entries eligible to delete. */
  discarded: string[];
  /** Compatibility projection: every reported preserved path. */
  preserved: string[];
  aborted: boolean;
  abortReason?: string;
  candidates?: EphemeraCandidateFingerprint[];
  preservedEntries?: EphemeraPreservedEntry[];
  sourceSignals?: string[];
  blockers?: EphemeraBlocker[];
  complete?: boolean;
}

export class EphemeraPlanError extends Error {
  readonly blockers: EphemeraBlocker[];

  constructor(message: string, blockers: EphemeraBlocker[] = []) {
    super(message);
    this.name = 'EphemeraPlanError';
    this.blockers = blockers;
  }
}

type StateValidator = (content: string) => void;

function validateSupportedVersion(content: string): unknown {
  const parsed = JSON.parse(content) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return parsed;
  const record = parsed as Record<string, unknown>;
  for (const key of VERSION_KEYS) {
    if (!(key in record)) continue;
    if (record[key] !== 1 && record[key] !== '1') {
      throw new Error(`unsupported ${key} ${JSON.stringify(record[key])}`);
    }
  }
  return parsed;
}

function validateGoalRun(content: string): void {
  const parsed = validateSupportedVersion(content);
  const result = GoalRunSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid goal run-state: ${result.error.issues
        .map(issue => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`
    );
  }
}

export const STATE_VALIDATORS: Readonly<Record<(typeof KNOWN_STATE_FILENAMES)[number], StateValidator>> =
  Object.freeze({
    'auto-run.json': content => {
      validateSupportedVersion(content);
      parseRunState(content);
    },
    'portfolio-run.json': content => {
      validateSupportedVersion(content);
      parsePortfolioState(content);
    },
    'goal-run.json': validateGoalRun,
  });

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException)?.code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function blocker(operation: EphemeraOperation, target: string, error: unknown): EphemeraBlocker {
  const code = errorCode(error);
  return {
    operation,
    path: target,
    ...(code ? { code } : {}),
    message: errorMessage(error),
  };
}

function isWhitelistedRawMaterial(name: string): boolean {
  return (
    CONTROL_STATE_NAMES.has(name) ||
    RAW_LOG_PATTERN.test(name) ||
    RAW_JSON_PATTERN.test(name) ||
    BENCHMARK_PATTERN.test(name)
  );
}

function statIdentity(stat: Stats): Omit<EphemeraCandidateFingerprint, 'relativePath' | 'sha256'> {
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
  };
}

function sameFingerprint(
  expected: EphemeraCandidateFingerprint,
  stat: Stats,
  content: Buffer
): boolean {
  const actual = statIdentity(stat);
  return (
    stat.isFile() &&
    !stat.isSymbolicLink() &&
    actual.size === expected.size &&
    actual.mtimeMs === expected.mtimeMs &&
    actual.ctimeMs === expected.ctimeMs &&
    actual.dev === expected.dev &&
    actual.ino === expected.ino &&
    actual.mode === expected.mode &&
    createHash('sha256').update(content).digest('hex') === expected.sha256
  );
}

export function sourceManifestNameMatches(
  name: string,
  pathIdentityFlavor: PathIdentityFlavor = NATIVE_PATH_IDENTITY_FLAVOR
): boolean {
  return SOURCE_MANIFEST_FILENAMES.some(manifest =>
    pathIdentityEquals(manifest, name, pathIdentityFlavor)
  );
}

function sourceSignal(
  relativePath: string,
  stat: Stats,
  pathIdentityFlavor: PathIdentityFlavor
): boolean {
  const name = path.basename(relativePath);
  if (sourceManifestNameMatches(name, pathIdentityFlavor)) return true;
  if (stat.isDirectory() && SOURCE_DIRECTORY_NAME_SET.has(name.toLowerCase())) return true;
  return stat.isFile() && SOURCE_EXTENSION_SET.has(path.extname(name).toLowerCase());
}

function normalizeRelative(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

/**
 * Complete recursive preflight. `ENOENT` means absence; every other inspection
 * error is a blocker. Symlinks are reported and never followed.
 */
export async function classifyEphemera(
  ephemeraDir: string,
  fileSystem: EphemeraFileSystem = defaultFileSystem,
  pathIdentityFlavor: PathIdentityFlavor = NATIVE_PATH_IDENTITY_FLAVOR
): Promise<EphemeraClassification> {
  const candidates: EphemeraCandidateFingerprint[] = [];
  const preservedEntries: EphemeraPreservedEntry[] = [];
  const sourceSignals: string[] = [];
  const blockers: EphemeraBlocker[] = [];

  async function inspect(target: string, relativePath: string, topLevel: boolean): Promise<void> {
    let stat: Stats;
    try {
      stat = await fileSystem.lstat(target);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return;
      const failure = blocker('lstat', target, error);
      blockers.push(failure);
      preservedEntries.push({
        path: normalizeRelative(relativePath),
        reason: 'inspection-blocked',
        detail: failure.message,
      });
      return;
    }

    const rel = normalizeRelative(relativePath);
    if (sourceSignal(rel, stat, pathIdentityFlavor)) {
      sourceSignals.push(rel);
      preservedEntries.push({ path: rel, reason: 'source-signal' });
    }

    if (stat.isSymbolicLink()) {
      preservedEntries.push({ path: rel, reason: 'symlink' });
      return;
    }

    if (stat.isDirectory()) {
      preservedEntries.push({ path: rel, reason: topLevel ? 'directory' : 'nested' });
      let entries: Dirent[];
      try {
        entries = await fileSystem.readdir(target, { withFileTypes: true });
      } catch (error) {
        if (errorCode(error) === 'ENOENT') return;
        const failure = blocker('readdir', target, error);
        blockers.push(failure);
        preservedEntries.push({
          path: rel,
          reason: 'inspection-blocked',
          detail: failure.message,
        });
        return;
      }
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        await inspect(path.join(target, entry.name), path.join(relativePath, entry.name), false);
      }
      return;
    }

    if (!stat.isFile()) {
      preservedEntries.push({ path: rel, reason: 'special' });
      return;
    }

    if (!topLevel) {
      preservedEntries.push({ path: rel, reason: 'nested' });
      return;
    }

    const name = path.basename(relativePath);
    if (!RUN_STATE_NAMES.has(name) && !isWhitelistedRawMaterial(name)) {
      preservedEntries.push({ path: rel, reason: 'unknown' });
      return;
    }

    let content: Buffer;
    try {
      content = await fileSystem.readFile(target);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return;
      const failure = blocker('readFile', target, error);
      blockers.push(failure);
      preservedEntries.push({
        path: rel,
        reason: 'inspection-blocked',
        detail: failure.message,
      });
      return;
    }

    if (RUN_STATE_NAMES.has(name)) {
      try {
        STATE_VALIDATORS[name as keyof typeof STATE_VALIDATORS](content.toString('utf8'));
      } catch (error) {
        preservedEntries.push({
          path: rel,
          reason: 'invalid-state',
          detail: errorMessage(error),
        });
        return;
      }
    }

    candidates.push({
      relativePath: rel,
      ...statIdentity(stat),
      sha256: createHash('sha256').update(content).digest('hex'),
    });
  }

  let topEntries: Dirent[];
  try {
    topEntries = await fileSystem.readdir(ephemeraDir, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return {
        discarded: [],
        preserved: [],
        aborted: false,
        candidates: [],
        preservedEntries: [],
        sourceSignals: [],
        blockers: [],
        complete: true,
      };
    }
    blockers.push(blocker('readdir', ephemeraDir, error));
    return {
      discarded: [],
      preserved: [],
      aborted: true,
      abortReason: `${errorCode(error) ?? 'ERROR'} reading ${ephemeraDir}`,
      candidates: [],
      preservedEntries: [],
      sourceSignals: [],
      blockers,
      complete: false,
    };
  }

  topEntries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of topEntries) {
    await inspect(path.join(ephemeraDir, entry.name), entry.name, true);
  }

  candidates.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  preservedEntries.sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.reason.localeCompare(right.reason)
  );
  sourceSignals.sort();
  blockers.sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.operation.localeCompare(right.operation)
  );

  const aborted = sourceSignals.length > 0 || blockers.length > 0;
  const abortReason = aborted
    ? sourceSignals[0] ??
      `${blockers[0]?.code ?? 'ERROR'} ${blockers[0]?.operation ?? 'inspect'} ${blockers[0]?.path ?? ephemeraDir}`
    : undefined;
  if (aborted) {
    for (const candidate of candidates) {
      preservedEntries.push({
        path: candidate.relativePath,
        reason: 'cleaning-aborted',
        detail: abortReason,
      });
    }
    preservedEntries.sort(
      (left, right) =>
        left.path.localeCompare(right.path) || left.reason.localeCompare(right.reason)
    );
  }
  const preserved = [...new Set(preservedEntries.map(entry => entry.path))].sort();
  return {
    discarded: aborted ? [] : candidates.map(candidate => candidate.relativePath),
    preserved,
    aborted,
    ...(abortReason ? { abortReason } : {}),
    candidates,
    preservedEntries,
    sourceSignals,
    blockers,
    complete: blockers.length === 0,
  };
}

function candidateFor(
  classification: EphemeraClassification,
  relativePath: string
): EphemeraCandidateFingerprint | undefined {
  return classification.candidates?.find(candidate => candidate.relativePath === relativePath);
}

/**
 * Apply a complete preflight. Candidate identity and content are revalidated
 * immediately before a non-recursive unlink.
 */
export async function applyEphemeraDeletion(
  ephemeraDir: string,
  classification: EphemeraClassification,
  fileSystem: EphemeraFileSystem = defaultFileSystem
): Promise<string[]> {
  const blockers = classification.blockers ?? [];
  if (classification.aborted || classification.complete === false || blockers.length > 0) {
    throw new EphemeraPlanError(
      `Ephemera deletion refused: classification is ${classification.aborted ? 'aborted' : 'incomplete'}`,
      blockers
    );
  }

  const deleted: string[] = [];
  for (const relativePath of classification.discarded) {
    if (
      path.isAbsolute(relativePath) ||
      relativePath.includes('/') ||
      relativePath.includes('\\') ||
      relativePath === '.' ||
      relativePath === '..'
    ) {
      throw new EphemeraPlanError(`Ephemera deletion refused for non-top-level path: ${relativePath}`);
    }

    const expected = candidateFor(classification, relativePath);
    if (!expected) {
      throw new EphemeraPlanError(`Ephemera deletion refused: missing fingerprint for ${relativePath}`);
    }

    const target = path.join(ephemeraDir, relativePath);
    let stat: Stats;
    try {
      stat = await fileSystem.lstat(target);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') continue;
      throw new EphemeraPlanError(
        `Ephemera deletion refused: ${errorCode(error) ?? 'ERROR'} inspecting ${relativePath}`,
        [blocker('lstat', target, error)]
      );
    }
    let content: Buffer;
    try {
      content = await fileSystem.readFile(target);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') continue;
      throw new EphemeraPlanError(
        `Ephemera deletion refused: ${errorCode(error) ?? 'ERROR'} reading ${relativePath}`,
        [blocker('readFile', target, error)]
      );
    }

    if (!sameFingerprint(expected, stat, content)) {
      throw new EphemeraPlanError(
        `Ephemera deletion refused: candidate changed after classification: ${relativePath}`
      );
    }

    try {
      await fileSystem.unlink(target);
      deleted.push(relativePath);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') continue;
      throw new EphemeraPlanError(
        `Ephemera deletion failed: ${errorCode(error) ?? 'ERROR'} unlinking ${relativePath}`,
        [blocker('unlink', target, error)]
      );
    }
  }
  return deleted;
}

export async function cleanEphemera(
  ephemeraDir: string,
  options: {
    dryRun?: boolean;
    fileSystem?: EphemeraFileSystem;
    pathIdentityFlavor?: PathIdentityFlavor;
  } = {}
): Promise<{ classification: EphemeraClassification; deleted: string[] }> {
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  const classification = await classifyEphemera(
    ephemeraDir,
    fileSystem,
    options.pathIdentityFlavor ?? NATIVE_PATH_IDENTITY_FLAVOR
  );
  if (options.dryRun || classification.aborted) {
    return { classification, deleted: [] };
  }
  const deleted = await applyEphemeraDeletion(ephemeraDir, classification, fileSystem);
  return { classification, deleted };
}

/**
 * Stable recursive content hash for dry-run byte-preservation tests. Symlinks
 * are hashed as links and are never followed.
 */
export async function hashDirectoryTree(dir: string): Promise<string> {
  const hash = createHash('sha256');

  async function walkSorted(target: string, prefix: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(target, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return;
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(target, entry.name);
      hash.update(rel);
      hash.update('\0');
      if (entry.isSymbolicLink()) {
        hash.update(await fs.readlink(absolute));
        hash.update('\0');
      } else if (entry.isDirectory()) {
        await walkSorted(absolute, rel);
      } else if (entry.isFile()) {
        hash.update(await fs.readFile(absolute));
        hash.update('\0');
      }
    }
  }

  await walkSorted(dir, '');
  return hash.digest('hex');
}
