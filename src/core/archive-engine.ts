import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { promises as fs } from 'node:fs';
import type { BigIntStats, Dirent, Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import {
  applyEphemeraDeletion,
  classifyEphemera,
  type EphemeraBlocker,
  type EphemeraCandidateFingerprint,
  type EphemeraClassification,
  type EphemeraFileSystem,
  type EphemeraPreservedEntry,
} from './ephemera-cleaner.js';
import {
  resolveArchiveAccounting,
  serializeArchiveAccounting,
  verifyArchiveAccounting,
  writeArchiveJson,
  type ArchiveAccounting,
  type HandoffAbsorbedEntry,
  type ResolveArchiveAccountingInput,
} from './archive-accounting.js';
import {
  NATIVE_PATH_IDENTITY_FLAVOR,
  pathIdentityEquals,
  type PathIdentityFlavor,
} from './path-identity.js';
import { isConfirmedGitWorkTree } from './store/git.js';

const execFileAsync = promisify(execFile);

export const ARCHIVE_PLAN_VERSION = 2 as const;
export const ARCHIVE_JOURNAL_FILENAME = '.rasen-archive-journal.json';
export const ARCHIVE_PUBLISHED_MARKER_FILENAME = '.rasen-archive-published.json';
export const ARCHIVE_CONTROL_FILENAMES = new Set([
  '.rasen-archive-input.json',
  ARCHIVE_JOURNAL_FILENAME,
  ARCHIVE_PUBLISHED_MARKER_FILENAME,
]);
export const ARCHIVE_PLAN_TOKEN_PREFIX = 'archive-v1';

export type ArchiveBlockerOperation =
  | 'source-lstat'
  | 'source-inventory'
  | 'source-read'
  | 'target-lstat'
  | 'sidecar-read'
  | 'sidecar-validate'
  | 'handoff-inventory'
  | 'handoff-lstat'
  | 'probe-lstat'
  | 'probe-realpath'
  | 'probe-git'
  | 'cleaner'
  | 'validation'
  | 'tasks'
  | 'timing'
  | 'git'
  | 'quality'
  | 'evidence'
  | 'stage'
  | 'copy'
  | 'handoff'
  | 'spec'
  | 'publish'
  | 'accounting'
  | 'cleaner-apply'
  | 'source-remove'
  | 'journal';

export interface ArchiveBlocker {
  operation: ArchiveBlockerOperation;
  path: string;
  code?: string;
  message: string;
}

export interface ArchiveTreeEntry {
  path: string;
  kind: 'file' | 'directory' | 'symlink';
  mode?: number;
  executable?: boolean;
  size?: string;
  sha256?: string;
  linkTarget?: string;
}

export interface ArchiveStatIdentity {
  dev: string;
  ino: string;
  mode: string;
  size: string;
  mtimeNs: string;
  ctimeNs: string;
}

export interface ArchiveAuthorityEntry {
  path: string;
  kind: ArchiveTreeEntry['kind'];
  identity: ArchiveStatIdentity;
}

export interface ArchiveTreeFingerprint {
  algorithm: 'sha256';
  digest: string;
  entries: ArchiveTreeEntry[];
  rootIdentity: ArchiveStatIdentity;
  authorityDigest: string;
  authorityEntries: ArchiveAuthorityEntry[];
}

export interface PreparedArchiveSpecAction {
  actionId?: string;
  capability: string;
  action: 'create' | 'update' | 'delete';
  source: string;
  target: string;
  sourceSha256: string;
  targetPrecondition:
    | { state: 'absent' }
    | {
        state: 'file';
        sha256: string;
        identity?: ArchiveStatIdentity;
        capabilityTree?: ArchiveTreeFingerprint;
      };
  rebuilt: string;
  counts: {
    added: number;
    modified: number;
    removed: number;
    renamed: number;
  };
}

export interface ArchiveHandoffDecision {
  path: string;
  outcome: 'absorbed' | 'preserved';
}

export interface ArchiveProbeDecision {
  path: string;
  codeCommit: string;
}

export interface ArchiveIntentV1 {
  schemaVersion: 1;
  change: string;
  handoff: {
    complete: true;
    decisions: ArchiveHandoffDecision[];
  };
  probes: ArchiveProbeDecision[];
}

export interface ArchiveSidecarProjection {
  status: 'absent' | 'valid' | 'invalid';
  schemaVersion: number | null;
  change: string | null;
  disposition: 'unjudged-preserve-all' | 'judged';
  handoff: {
    complete: boolean | null;
    decisions: ArchiveHandoffDecision[];
    inventory: string[];
  };
  probes: ArchiveProbeDecision[];
  blockers: ArchiveBlocker[];
}

export interface ArchiveCleanerProjection {
  keepEphemera: boolean;
  classification: {
    discarded: string[];
    preserved: string[];
    aborted: boolean;
    abortReason?: string;
    candidates: EphemeraCandidateFingerprint[];
    preservedEntries: EphemeraPreservedEntry[];
    sourceSignals: string[];
    blockers: EphemeraBlocker[];
    complete: boolean;
  };
  effectiveDelete: string[];
  effectivePreserve: string[];
}

export interface ArchiveQualityInput {
  path: string;
  sha256: string;
}

export interface ArchivePlan {
  schemaVersion: typeof ARCHIVE_PLAN_VERSION;
  transactionId: string;
  planHash: string;
  change: string;
  createdAt: string;
  roots: {
    planning: string;
    execution: string;
  };
  paths: {
    active: string;
    archiveParent: string;
    stage: string;
    final: string;
    journal: string;
    publishedJournal: string;
    ephemera: string;
  };
  sourceFingerprint: ArchiveTreeFingerprint | null;
  git: {
    execution: {
      state: 'git' | 'non-git' | 'error';
      codeCommit: string | null;
    };
    planning: {
      state: 'git' | 'non-git' | 'error';
      branch: string | null;
      treeState: 'clean' | 'dirty';
    };
  };
  preconditions: {
    source: 'directory' | 'missing' | 'invalid' | 'error';
    target: 'absent' | 'present' | 'error';
  };
  decisions: {
    validation: 'passed' | 'skipped' | 'blocked';
    tasks: {
      total: number;
      completed: number;
      override: boolean;
    };
    timing: {
      mode: 'in-ship' | 'on-merge';
      deliveryMode: 'pr' | 'push' | 'local' | null;
      override: boolean;
    };
  };
  specActions: PreparedArchiveSpecAction[];
  sidecar: ArchiveSidecarProjection;
  cleaner: ArchiveCleanerProjection;
  qualityInputs: ArchiveQualityInput[];
  evidenceInputs: string[];
  shipLog: {
    source: string | null;
    sha256: string | null;
    recordedCommit: string | null;
  };
  actions: Array<{
    order: number;
    kind:
      | 'write-spec'
      | 'delete-spec'
      | 'create-stage'
      | 'copy-payload'
      | 'apply-handoff'
      | 'finalize-ship-log'
      | 'capture-quality'
      | 'publish'
      | 'clean-ephemera'
      | 'write-accounting'
      | 'remove-active'
      | 'complete-journal';
    path: string;
  }>;
  blockers: ArchiveBlocker[];
  complete: boolean;
}

export type ArchiveJournalPhase =
  | 'planned'
  | 'staged'
  | 'handoff-finalized'
  | 'evidence-finalized'
  | 'specs-applied'
  | 'published'
  | 'cleaner-progress'
  | 'accounting-finalized'
  | 'source-removed'
  | 'complete'
  | 'failed';

export interface ArchiveIntegrityFailure {
  detectedAt: string;
  operation: ArchiveBlockerOperation;
  path: string;
  code?: string;
  message: string;
  safeAction: {
    kind: 'manual-recovery-required';
    guidance: string;
  };
}

export interface ArchiveJournal {
  schemaVersion: 2;
  transactionId: string;
  planHash: string;
  change: string;
  phase: ArchiveJournalPhase;
  activePath: string;
  stagePath: string;
  finalPath: string;
  ephemeraDisposed: string[];
  phaseFingerprints: Record<
    string,
    {
      state: 'intent' | 'verified';
      scope: 'stage' | 'final';
      before: ArchiveTreeFingerprint;
      expectedAfter: ArchiveTreeFingerprint;
      observedAfter?: ArchiveTreeFingerprint;
    }
  >;
  finalReservation: {
    identity: ArchiveStatIdentity | null;
    entries: Array<{
      path: string;
      kind: ArchiveTreeEntry['kind'];
      expected: ArchiveTreeEntry;
      state: 'intent' | 'copied';
      identity?: ArchiveStatIdentity;
    }>;
  };
  specProgress: Array<{
    actionId: string;
    action: PreparedArchiveSpecAction['action'];
    target: string;
    backupOrQuarantine: string | null;
    temporary: string | null;
    claimIdentity?: ArchiveStatIdentity;
    temporaryIdentity?: ArchiveStatIdentity;
    publishedIdentity?: ArchiveStatIdentity;
    state:
      | 'pending'
      | 'intent-durable'
      | 'claimed'
      | 'published'
      | 'verified'
      | 'complete'
      | 'conflict'
      | 'failed';
    error?: string;
  }>;
  cleanerProgress: Array<{
    path: string;
    state:
      | 'pending'
      | 'delete-intent'
      | 'deleted'
      | 'deleted-after-intent'
      | 'already-absent'
      | 'conflict'
      | 'failed';
    error?: string;
  }>;
  sourceProgress: {
    state:
      | 'pending'
      | 'delete-intent'
      | 'claimed'
      | 'removing'
      | 'removed'
      | 'conflict'
      | 'failed';
    quarantine: string;
    error?: string;
  };
  updatedAt: string;
  failure?: {
    operation: string;
    path: string;
    code?: string;
    message: string;
    resumePhase?: ArchiveJournalPhase;
  };
  integrityFailure?: ArchiveIntegrityFailure;
}

export interface ArchiveApplyResult {
  status: 'complete' | 'blocked' | 'recoverable';
  transactionId: string;
  planHash: string;
  change: string;
  path: string;
  journalPath: string;
  resumed: boolean;
  specsUpdated: boolean;
  totals: {
    added: number;
    modified: number;
    removed: number;
    renamed: number;
  };
  ephemeraDiscarded: string[];
  ephemeraPreserved: string[];
  blockers: ArchiveBlocker[];
  recoveryCommand?: string;
  manualRecoveryAction?: ArchiveIntegrityFailure['safeAction'];
}

export interface StoredArchivePlanV1 {
  schemaVersion: 1;
  kind: 'rasen.archive-plan';
  transactionId: string;
  planHash: string;
  createdAt: string;
  plan: ArchivePlan;
}

interface ArchivePublishedMarkerV1 {
  schemaVersion: 1;
  kind: 'rasen.archive-published';
  transactionId: string;
  planHash: string;
  archivePath: string;
  payloadDigest: string;
}

type ArchiveFsStat = Stats | BigIntStats;

export interface ArchiveFileSystem {
  access(target: string): Promise<void>;
  copyFile(source: string, target: string, flags?: number): Promise<void>;
  lstat(target: string): Promise<ArchiveFsStat>;
  mkdir(target: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  open(
    target: string,
    flags: string | number,
    mode?: number
  ): Promise<FileHandle>;
  readHandle(handle: FileHandle, target: string): Promise<Buffer>;
  readFile(target: string): Promise<Buffer>;
  readFile(target: string, encoding: BufferEncoding): Promise<string>;
  readdir(target: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  readlink(target: string): Promise<string>;
  realpath(target: string): Promise<string>;
  rename(source: string, target: string): Promise<void>;
  link(existingPath: string, newPath: string): Promise<void>;
  rmdir(target: string): Promise<void>;
  rm(target: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  symlink(target: string, path: string, type?: 'dir' | 'file' | 'junction'): Promise<void>;
  unlink(target: string): Promise<void>;
  writeFile(target: string, data: string | Uint8Array, options?: { flag?: string }): Promise<void>;
}

export interface ArchiveGitAdapter {
  exec: (root: string, args: string[]) => Promise<string>;
  state(root: string): Promise<'git' | 'non-git'>;
}

export interface ArchiveEngineAdapters {
  fs: ArchiveFileSystem;
  git: ArchiveGitAdapter;
  now(): Date;
  transactionId(): string;
  sha256(data: string | Uint8Array): string;
  classifyEphemera(
    ephemeraDir: string,
    fileSystem?: EphemeraFileSystem
  ): Promise<EphemeraClassification>;
  applyEphemeraDeletion(
    ephemeraDir: string,
    classification: EphemeraClassification,
    fileSystem?: EphemeraFileSystem
  ): Promise<string[]>;
  resolveArchiveAccounting(input: ResolveArchiveAccountingInput): Promise<ArchiveAccounting>;
  verifyArchiveAccounting(
    archivedDir: string,
    accounting: ArchiveAccounting
  ): Promise<void>;
  writeArchiveJson(archivedDir: string, accounting: ArchiveAccounting): Promise<void>;
}

export const defaultArchiveEngineAdapters: ArchiveEngineAdapters = {
  fs: {
    access: target => fs.access(target),
    copyFile: (source, target, flags) => fs.copyFile(source, target, flags),
    lstat: target => fs.lstat(target, { bigint: true }),
    mkdir: (target, options) => fs.mkdir(target, options),
    open: (target, flags, mode) => fs.open(target, flags, mode),
    readHandle: handle => handle.readFile(),
    readFile: ((target: string, encoding?: BufferEncoding) =>
      encoding ? fs.readFile(target, encoding) : fs.readFile(target)) as ArchiveFileSystem['readFile'],
    readdir: (target, options) => fs.readdir(target, options),
    readlink: target => fs.readlink(target),
    realpath: target => fs.realpath(target),
    rename: (source, target) => fs.rename(source, target),
    link: (existingPath, newPath) => fs.link(existingPath, newPath),
    rmdir: target => fs.rmdir(target),
    rm: (target, options) => fs.rm(target, options),
    symlink: (target, linkPath, type) => fs.symlink(target, linkPath, type),
    unlink: target => fs.unlink(target),
    writeFile: (target, data, options) => fs.writeFile(target, data, options),
  },
  git: {
    exec: async (root, args) => {
      const { stdout } = await execFileAsync('git', ['-C', root, ...args], {
        windowsHide: true,
      });
      return stdout.trim();
    },
    state: async root => {
      const state = await isConfirmedGitWorkTree(root);
      if (state === true) return 'git';
      if (state === false) return 'non-git';
      throw new Error(`Git state could not be confirmed for ${root}`);
    },
  },
  now: () => new Date(),
  transactionId: () => randomUUID(),
  sha256: data => createHash('sha256').update(data).digest('hex'),
  classifyEphemera,
  applyEphemeraDeletion,
  resolveArchiveAccounting,
  verifyArchiveAccounting,
  writeArchiveJson,
};

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function blocker(
  operation: ArchiveBlockerOperation,
  target: string,
  error: unknown
): ArchiveBlocker {
  const code = errorCode(error);
  return {
    operation,
    path: target,
    ...(code ? { code } : {}),
    message: error instanceof Error ? error.message : String(error),
  };
}

function normalizeRelative(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

/**
 * Stable JSON used for plan and journal identity. Object keys are sorted at
 * every depth; array order remains semantic and is therefore preserved.
 */
export function stableArchiveJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableArchiveJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableArchiveJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function statScalar(value: number | bigint): string {
  return typeof value === 'bigint' ? value.toString() : String(value);
}

function statNanoseconds(
  stat: ArchiveFsStat,
  nanosecondField: 'mtimeNs' | 'ctimeNs',
  millisecondField: 'mtimeMs' | 'ctimeMs'
): string {
  const nanoseconds = (stat as BigIntStats)[nanosecondField];
  if (typeof nanoseconds === 'bigint') return nanoseconds.toString();
  const milliseconds = stat[millisecondField];
  if (typeof milliseconds === 'bigint') {
    return (milliseconds * 1_000_000n).toString();
  }
  return BigInt(Math.trunc(milliseconds * 1_000_000)).toString();
}

function archiveStatIdentity(stat: ArchiveFsStat): ArchiveStatIdentity {
  return {
    dev: statScalar(stat.dev),
    ino: statScalar(stat.ino),
    mode: statScalar(stat.mode),
    size: statScalar(stat.size),
    mtimeNs: statNanoseconds(stat, 'mtimeNs', 'mtimeMs'),
    ctimeNs: statNanoseconds(stat, 'ctimeNs', 'ctimeMs'),
  };
}

function archiveDeletionIdentity(
  stat: ArchiveFsStat,
  kind: ArchiveAuthorityEntry['kind']
): ArchiveStatIdentity {
  const complete = archiveStatIdentity(stat);
  return kind === 'directory'
    ? {
        ...complete,
        size: '0',
        mtimeNs: '0',
        ctimeNs: '0',
      }
    : complete;
}

function identityMatches(left: ArchiveFsStat, right: ArchiveFsStat): boolean {
  return stableArchiveJson(archiveStatIdentity(left)) ===
    stableArchiveJson(archiveStatIdentity(right));
}

function staleArchiveObject(target: string, detail: string): Error {
  const error = new Error(`${detail}: ${target}`);
  (error as NodeJS.ErrnoException).code = 'ESTALE';
  return error;
}

/**
 * Read a regular file through the exact opened object. O_NOFOLLOW is used
 * where the host exposes it; all hosts additionally bind both handle stats
 * and the final pathname identity to the initial lstat.
 */
async function readStableArchiveFile(
  target: string,
  adapters: ArchiveEngineAdapters
): Promise<{ content: Buffer; stat: ArchiveFsStat }> {
  const beforePath = await adapters.fs.lstat(target);
  if (!beforePath.isFile() || beforePath.isSymbolicLink()) {
    throw staleArchiveObject(target, 'Archive file is not a regular no-follow object');
  }
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await adapters.fs.open(target, fsConstants.O_RDONLY | noFollow);
  try {
    const beforeHandle = await handle.stat({ bigint: true });
    if (!beforeHandle.isFile() || !identityMatches(beforePath, beforeHandle)) {
      throw staleArchiveObject(target, 'Archive pathname changed before handle read');
    }
    const content = await adapters.fs.readHandle(handle, target);
    const afterHandle = await handle.stat({ bigint: true });
    if (!afterHandle.isFile() || !identityMatches(beforeHandle, afterHandle)) {
      throw staleArchiveObject(target, 'Archive opened file changed during read');
    }
    const afterPath = await adapters.fs.lstat(target);
    if (
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      !identityMatches(afterHandle, afterPath)
    ) {
      throw staleArchiveObject(target, 'Archive pathname changed during handle read');
    }
    return { content, stat: afterPath };
  } finally {
    await handle.close();
  }
}

export function hashArchivePlan(
  plan: Omit<ArchivePlan, 'planHash'>,
  adapters: Pick<ArchiveEngineAdapters, 'sha256'> = defaultArchiveEngineAdapters
): string {
  return adapters.sha256(stableArchiveJson(plan));
}

/**
 * A symlink-safe, deterministic source identity. Engine control files are
 * omitted because they are intent/recovery transport, not archive payload.
 */
export async function fingerprintArchiveTree(
  root: string,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters
): Promise<ArchiveTreeFingerprint> {
  const entries: ArchiveTreeEntry[] = [];
  const authorityEntries: ArchiveAuthorityEntry[] = [];

  async function walk(
    directory: string,
    prefix: string,
    directoryBefore: ArchiveFsStat
  ): Promise<void> {
    const dirents = await adapters.fs.readdir(directory, { withFileTypes: true });
    const filtered = dirents
      .filter(dirent => prefix || !ARCHIVE_CONTROL_FILENAMES.has(dirent.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    if (!prefix) {
      const sidecar = dirents.find(
        dirent => dirent.name === '.rasen-archive-input.json'
      );
      if (sidecar) {
        const absolute = path.join(directory, sidecar.name);
        const before = await adapters.fs.lstat(absolute);
        const after = await adapters.fs.lstat(absolute);
        if (!before.isFile() || !after.isFile() || !identityMatches(before, after)) {
          throw staleArchiveObject(
            absolute,
            'Archive sidecar changed while fingerprinting'
          );
        }
        authorityEntries.push({
          path: sidecar.name,
          kind: 'file',
          identity: archiveDeletionIdentity(after, 'file'),
        });
      }
    }
    for (const dirent of filtered) {
      const absolute = path.join(directory, dirent.name);
      const relative = normalizeRelative(prefix ? path.join(prefix, dirent.name) : dirent.name);
      const before = await adapters.fs.lstat(absolute);
      if (before.isSymbolicLink()) {
        const linkTarget = await adapters.fs.readlink(absolute);
        const after = await adapters.fs.lstat(absolute);
        if (!after.isSymbolicLink() || !identityMatches(before, after)) {
          throw staleArchiveObject(
            absolute,
            'Archive symlink changed while fingerprinting'
          );
        }
        entries.push({
          path: relative,
          kind: 'symlink',
          linkTarget,
        });
        authorityEntries.push({
          path: relative,
          kind: 'symlink',
          identity: archiveDeletionIdentity(after, 'symlink'),
        });
      } else if (before.isDirectory()) {
        entries.push({
          path: relative,
          kind: 'directory',
        });
        await walk(absolute, relative, before);
        const after = await adapters.fs.lstat(absolute);
        if (!after.isDirectory() || !identityMatches(before, after)) {
          throw staleArchiveObject(
            absolute,
            'Archive directory changed while fingerprinting'
          );
        }
        authorityEntries.push({
          path: relative,
          kind: 'directory',
          identity: archiveDeletionIdentity(after, 'directory'),
        });
      } else if (before.isFile()) {
        const stable = await readStableArchiveFile(absolute, adapters);
        if (!identityMatches(before, stable.stat)) {
          throw staleArchiveObject(
            absolute,
            'Archive file changed before handle-bound fingerprinting'
          );
        }
        entries.push({
          path: relative,
          kind: 'file',
          executable:
            process.platform === 'win32'
              ? false
              : (BigInt(stable.stat.mode) & 0o111n) !== 0n,
          size: statScalar(stable.stat.size),
          sha256: adapters.sha256(stable.content),
        });
        authorityEntries.push({
          path: relative,
          kind: 'file',
          identity: archiveDeletionIdentity(stable.stat, 'file'),
        });
      } else {
        throw new Error(`Unsupported archive payload entry: ${absolute}`);
      }
    }

    const namesAfter = (await adapters.fs.readdir(directory, { withFileTypes: true }))
      .filter(dirent => prefix || !ARCHIVE_CONTROL_FILENAMES.has(dirent.name))
      .map(dirent => dirent.name)
      .sort((left, right) => left.localeCompare(right));
    if (
      stableArchiveJson(namesAfter) !==
      stableArchiveJson(filtered.map(dirent => dirent.name))
    ) {
      throw staleArchiveObject(
        directory,
        'Archive directory children changed while fingerprinting'
      );
    }
    const directoryAfter = await adapters.fs.lstat(directory);
    if (!directoryAfter.isDirectory() || !identityMatches(directoryBefore, directoryAfter)) {
      throw staleArchiveObject(
        directory,
        'Archive directory identity changed while fingerprinting'
      );
    }
  }

  const rootBefore = await adapters.fs.lstat(root);
  if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink()) {
    throw staleArchiveObject(root, 'Archive root is not the planned real directory');
  }
  await walk(root, '', rootBefore);
  const rootAfter = await adapters.fs.lstat(root);
  if (!rootAfter.isDirectory() || !identityMatches(rootBefore, rootAfter)) {
    throw staleArchiveObject(root, 'Archive root identity changed while fingerprinting');
  }
  const rootIdentity = archiveDeletionIdentity(rootAfter, 'directory');
  return {
    algorithm: 'sha256',
    digest: adapters.sha256(stableArchiveJson(entries)),
    entries,
    rootIdentity,
    authorityDigest: adapters.sha256(
      stableArchiveJson({ rootIdentity, entries: authorityEntries })
    ),
    authorityEntries,
  };
}

function archivePayloadFingerprintMatches(
  left: ArchiveTreeFingerprint,
  right: ArchiveTreeFingerprint
): boolean {
  return (
    left.digest === right.digest &&
    stableArchiveJson(left.entries) === stableArchiveJson(right.entries)
  );
}

function archiveDeletionAuthorityMatches(
  left: ArchiveTreeFingerprint,
  right: ArchiveTreeFingerprint
): boolean {
  return (
    archivePayloadFingerprintMatches(left, right) &&
    left.authorityDigest === right.authorityDigest &&
    stableArchiveJson(left.rootIdentity) === stableArchiveJson(right.rootIdentity) &&
    stableArchiveJson(left.authorityEntries) ===
      stableArchiveJson(right.authorityEntries)
  );
}

export function projectArchiveCleaner(
  classification: EphemeraClassification,
  keepEphemera: boolean
): ArchiveCleanerProjection {
  const candidates = [...(classification.candidates ?? [])].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
  const preservedEntries = [...(classification.preservedEntries ?? [])].sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.reason.localeCompare(right.reason)
  );
  const sourceSignals = [...(classification.sourceSignals ?? [])].sort();
  const blockers = [...(classification.blockers ?? [])].sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.operation.localeCompare(right.operation)
  );
  const complete = classification.complete !== false && blockers.length === 0;
  const candidatePaths = candidates.map(candidate => candidate.relativePath);
  const effectivePreserve = [
    ...new Set([
      ...classification.preserved,
      ...(keepEphemera || classification.aborted ? candidatePaths : []),
    ]),
  ].sort();

  return {
    keepEphemera,
    classification: {
      discarded: [...classification.discarded].sort(),
      preserved: [...classification.preserved].sort(),
      aborted: classification.aborted,
      ...(classification.abortReason ? { abortReason: classification.abortReason } : {}),
      candidates,
      preservedEntries,
      sourceSignals,
      blockers,
      complete,
    },
    effectiveDelete:
      keepEphemera || classification.aborted || !complete ? [] : [...classification.discarded].sort(),
    effectivePreserve,
  };
}

export interface ArchivePathApi {
  sep: string;
  join(...paths: string[]): string;
  resolve(...paths: string[]): string;
  relative(from: string, to: string): string;
  isAbsolute(target: string): boolean;
  dirname(target: string): string;
  basename(target: string): string;
}

export interface ArchiveTransactionPaths {
  archiveParent: string;
  stage: string;
  final: string;
  journal: string;
  publishedJournal: string;
}

export function resolveArchiveTransactionPaths(
  archiveParent: string,
  date: string,
  change: string,
  transactionId: string,
  pathApi: ArchivePathApi = path
): ArchiveTransactionPaths {
  const resolvedParent = pathApi.resolve(archiveParent);
  const stage = pathApi.join(
    resolvedParent,
    `.rasen-archive-stage-${transactionId}`
  );
  const final = pathApi.join(resolvedParent, `${date}-${change}`);
  return {
    archiveParent: resolvedParent,
    stage,
    final,
    journal: pathApi.join(stage, ARCHIVE_JOURNAL_FILENAME),
    publishedJournal: pathApi.join(final, ARCHIVE_JOURNAL_FILENAME),
  };
}

export function archiveDatePrefixedNameMatches(
  candidate: string,
  change: string,
  flavor: PathIdentityFlavor = NATIVE_PATH_IDENTITY_FLAVOR
): boolean {
  const match = candidate.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
  return !!match && pathIdentityEquals(match[1], change, flavor);
}

export function isArchiveContainedPath(
  root: string,
  candidate: string,
  pathApi: ArchivePathApi = path
): boolean {
  const relative = pathApi.relative(pathApi.resolve(root), pathApi.resolve(candidate));
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${pathApi.sep}`) &&
      !pathApi.isAbsolute(relative))
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keySet = new Set(allowed);
  return Object.keys(record).every(key => keySet.has(key));
}

export function validArchiveIntentRelativePath(
  relativePath: string,
  requiredPrefix?: string,
  pathApi: ArchivePathApi = path
): boolean {
  if (
    relativePath.length === 0 ||
    pathApi.isAbsolute(relativePath) ||
    /^[a-z]:[\\/]/i.test(relativePath) ||
    relativePath.includes('\\') ||
    relativePath.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
  ) {
    return false;
  }
  return requiredPrefix === undefined || relativePath.startsWith(`${requiredPrefix}/`);
}

async function inventoryHandoff(
  changeRoot: string,
  adapters: ArchiveEngineAdapters
): Promise<{ inventory: string[]; blockers: ArchiveBlocker[] }> {
  const handoffRoot = path.join(changeRoot, 'handoff');
  const inventory: string[] = [];
  const blockers: ArchiveBlocker[] = [];

  async function walk(directory: string, prefix: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await adapters.fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (!prefix && errorCode(error) === 'ENOENT') return;
      blockers.push(blocker('handoff-inventory', directory, error));
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = normalizeRelative(path.join('handoff', prefix, entry.name));
      let stat: ArchiveFsStat;
      try {
        stat = await adapters.fs.lstat(absolute);
      } catch (error) {
        blockers.push(blocker('handoff-lstat', absolute, error));
        continue;
      }
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
        blockers.push({
          operation: 'handoff-lstat',
          path: absolute,
          message: 'Handoff inventory entries must be regular files or directories; symlinks are forbidden.',
        });
      } else if (stat.isDirectory()) {
        await walk(absolute, prefix ? path.join(prefix, entry.name) : entry.name);
      } else {
        try {
          await adapters.fs.readFile(absolute);
          inventory.push(relative);
        } catch (error) {
          blockers.push(blocker('handoff-lstat', absolute, error));
        }
      }
    }
  }

  await walk(handoffRoot, '');
  inventory.sort();
  blockers.sort((left, right) => left.path.localeCompare(right.path));
  return { inventory, blockers };
}

export async function createArchiveIntentTemplate(
  changeRoot: string,
  change: string,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters
): Promise<ArchiveIntentV1> {
  const { inventory, blockers } = await inventoryHandoff(changeRoot, adapters);
  if (blockers.length > 0) {
    throw new Error(
      blockers.map(item => `${item.operation}: ${item.message}`).join('; ')
    );
  }
  return {
    schemaVersion: 1,
    change,
    handoff: {
      complete: true,
      decisions: inventory.map(relativePath => ({
        path: relativePath,
        outcome: 'preserved',
      })),
    },
    probes: [],
  };
}

/**
 * Strict, mutation-free archive intent validation. Only an ENOENT sidecar is
 * interpreted as no judgment; every other read/schema/inventory failure is a
 * blocker. Probe paths are checked both lexically and through realpath.
 */
export async function resolveArchiveSidecar(
  changeRoot: string,
  executionRoot: string,
  change: string,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters,
  intentFile?: string
): Promise<ArchiveSidecarProjection> {
  const { inventory, blockers } = await inventoryHandoff(changeRoot, adapters);
  const embeddedSidecarPath = path.join(changeRoot, '.rasen-archive-input.json');
  let sidecarPath = embeddedSidecarPath;
  let content: string | undefined;
  let embeddedContent: string | undefined;
  try {
    embeddedContent = await adapters.fs.readFile(embeddedSidecarPath, 'utf8');
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      blockers.push(blocker('sidecar-read', embeddedSidecarPath, error));
    }
  }
  if (intentFile) {
    sidecarPath = path.resolve(intentFile);
    try {
      content = await adapters.fs.readFile(sidecarPath, 'utf8');
    } catch (error) {
      blockers.push(blocker('sidecar-read', sidecarPath, error));
    }
    if (content !== undefined && embeddedContent !== undefined) {
      try {
        if (
          stableArchiveJson(JSON.parse(content)) !==
          stableArchiveJson(JSON.parse(embeddedContent))
        ) {
          blockers.push({
            operation: 'sidecar-validate',
            path: sidecarPath,
            message:
              'External intent and in-change sidecar are ambiguous because their normalized content differs.',
          });
        }
      } catch {
        // The normal strict parse below reports the selected file; malformed
        // embedded input is still ambiguous and therefore blocking.
        blockers.push({
          operation: 'sidecar-validate',
          path: embeddedSidecarPath,
          message: 'In-change sidecar could not be compared with external intent.',
        });
      }
    }
  } else {
    content = embeddedContent;
  }
  if (content === undefined) {
    return {
      status: blockers.length === 0 ? 'absent' : 'invalid',
      schemaVersion: null,
      change: null,
      disposition: 'unjudged-preserve-all',
      handoff: { complete: null, decisions: [], inventory },
      probes: [],
      blockers,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    blockers.push(blocker('sidecar-validate', sidecarPath, error));
  }
  const root = isPlainRecord(parsed) ? parsed : undefined;
  if (
    !root ||
    !hasOnlyKeys(root, ['schemaVersion', 'change', 'handoff', 'probes']) ||
    root.schemaVersion !== 1 ||
    root.change !== change ||
    !isPlainRecord(root.handoff) ||
    !hasOnlyKeys(root.handoff, ['complete', 'decisions']) ||
    root.handoff.complete !== true ||
    !Array.isArray(root.handoff.decisions) ||
    !Array.isArray(root.probes)
  ) {
    blockers.push({
      operation: 'sidecar-validate',
      path: sidecarPath,
      message:
        'Archive input must be schemaVersion 1, bound to this change, and contain complete handoff decisions plus probes.',
    });
  }

  const decisions: ArchiveHandoffDecision[] = [];
  const decisionPaths = new Set<string>();
  if (root && isPlainRecord(root.handoff) && Array.isArray(root.handoff.decisions)) {
    for (const value of root.handoff.decisions) {
      if (
        !isPlainRecord(value) ||
        !hasOnlyKeys(value, ['path', 'outcome']) ||
        typeof value.path !== 'string' ||
        (value.outcome !== 'absorbed' && value.outcome !== 'preserved') ||
        !validArchiveIntentRelativePath(value.path, 'handoff')
      ) {
        blockers.push({
          operation: 'sidecar-validate',
          path: sidecarPath,
          message: 'Every handoff decision needs a contained handoff/ path and an allowed outcome.',
        });
        continue;
      }
      const absolute = path.resolve(changeRoot, ...value.path.split('/'));
      if (!isArchiveContainedPath(path.join(changeRoot, 'handoff'), absolute)) {
        blockers.push({
          operation: 'sidecar-validate',
          path: value.path,
          message: 'Handoff decision escapes the handoff directory.',
        });
      } else if (decisionPaths.has(value.path)) {
        blockers.push({
          operation: 'sidecar-validate',
          path: value.path,
          message: 'Duplicate handoff decision.',
        });
      } else {
        decisionPaths.add(value.path);
        decisions.push({ path: value.path, outcome: value.outcome });
      }
    }
  }
  decisions.sort((left, right) => left.path.localeCompare(right.path));

  if (
    decisions.length !== inventory.length ||
    inventory.some(relativePath => !decisionPaths.has(relativePath)) ||
    decisions.some(decision => !inventory.includes(decision.path))
  ) {
    blockers.push({
      operation: 'sidecar-validate',
      path: sidecarPath,
      message: 'Handoff decisions must exactly cover the current regular-file inventory.',
    });
  }

  const probes: ArchiveProbeDecision[] = [];
  const probePaths = new Set<string>();
  let executionReal: string | undefined;
  try {
    executionReal = await adapters.fs.realpath(executionRoot);
  } catch (error) {
    if (root && Array.isArray(root.probes) && root.probes.length > 0) {
      blockers.push(blocker('probe-realpath', executionRoot, error));
    }
  }
  if (root && Array.isArray(root.probes)) {
    for (const value of root.probes) {
      if (
        !isPlainRecord(value) ||
        !hasOnlyKeys(value, ['path', 'codeCommit']) ||
        typeof value.path !== 'string' ||
        typeof value.codeCommit !== 'string' ||
        !validArchiveIntentRelativePath(value.path) ||
        !/^[0-9a-f]{40}$/i.test(value.codeCommit)
      ) {
        blockers.push({
          operation: 'sidecar-validate',
          path: sidecarPath,
          message: 'Every probe needs a contained relative path and a full 40-hex commit id.',
        });
        continue;
      }
      if (probePaths.has(value.path)) {
        blockers.push({
          operation: 'sidecar-validate',
          path: value.path,
          message: 'Duplicate probe path.',
        });
        continue;
      }
      probePaths.add(value.path);
      const absolute = path.resolve(executionRoot, ...value.path.split('/'));
      if (!isArchiveContainedPath(executionRoot, absolute)) {
        blockers.push({
          operation: 'probe-realpath',
          path: value.path,
          message: 'Probe path escapes the execution root lexically.',
        });
        continue;
      }
      try {
        const stat = await adapters.fs.lstat(absolute);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          throw new Error('Probe must be a real directory.');
        }
        const actualReal = await adapters.fs.realpath(absolute);
        if (!executionReal || !isArchiveContainedPath(executionReal, actualReal)) {
          throw new Error('Probe resolves outside the execution root.');
        }
      } catch (error) {
        blockers.push(blocker('probe-lstat', absolute, error));
        continue;
      }
      try {
        await adapters.git.exec(executionRoot, [
          'cat-file',
          '-e',
          `${value.codeCommit}^{commit}`,
        ]);
      } catch (error) {
        blockers.push(blocker('probe-git', value.path, error));
        continue;
      }
      probes.push({ path: value.path, codeCommit: value.codeCommit.toLowerCase() });
    }
  }
  probes.sort((left, right) => left.path.localeCompare(right.path));
  blockers.sort(
    (left, right) =>
      left.operation.localeCompare(right.operation) || left.path.localeCompare(right.path)
  );

  return {
    status: blockers.length === 0 ? 'valid' : 'invalid',
    schemaVersion: root?.schemaVersion === 1 ? 1 : null,
    change: typeof root?.change === 'string' ? root.change : null,
    disposition: 'judged',
    handoff: {
      complete: root && isPlainRecord(root.handoff) ? root.handoff.complete === true : false,
      decisions,
      inventory,
    },
    probes,
    blockers,
  };
}

export interface CreateArchivePlanInput {
  change: string;
  planningRoot: string;
  executionRoot: string;
  activePath: string;
  archiveParent: string;
  ephemeraPath: string;
  date: string;
  keepEphemera: boolean;
  validation: ArchivePlan['decisions']['validation'];
  tasks: ArchivePlan['decisions']['tasks'];
  timing: ArchivePlan['decisions']['timing'];
  specActions: PreparedArchiveSpecAction[];
  sidecar: ArchiveSidecarProjection;
  qualityInputs?: ArchiveQualityInput[];
  evidenceInputs?: string[];
  shipLog?: ArchivePlan['shipLog'];
  preparationBlockers?: ArchiveBlocker[];
  transactionId?: string;
  createdAt?: string;
}

async function discoverArchiveEvidenceInputs(
  activePath: string,
  sidecar: ArchiveSidecarProjection,
  adapters: ArchiveEngineAdapters
): Promise<{
  evidenceInputs: string[];
  qualityInputs: ArchiveQualityInput[];
  blockers: ArchiveBlocker[];
}> {
  const evidenceInputs: string[] = [];
  const qualityInputs: ArchiveQualityInput[] = [];
  const blockers: ArchiveBlocker[] = [];
  const evidenceRoot = path.join(activePath, 'evidence');

  async function walk(directory: string, prefix: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await adapters.fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (!prefix && errorCode(error) === 'ENOENT') return;
      blockers.push(blocker('evidence', directory, error));
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = normalizeRelative(prefix ? path.join(prefix, entry.name) : entry.name);
      let stat: ArchiveFsStat;
      try {
        stat = await adapters.fs.lstat(absolute);
      } catch (error) {
        blockers.push(blocker('evidence', absolute, error));
        continue;
      }
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        blockers.push({
          operation: 'evidence',
          path: absolute,
          message: 'Evidence inventory entries must be regular files or directories; symlinks are forbidden.',
        });
      } else if (stat.isDirectory()) {
        await walk(absolute, relative);
      } else {
        try {
          const content = await adapters.fs.readFile(absolute);
          const archiveRelative = `evidence/${relative}`;
          evidenceInputs.push(archiveRelative);
          if (isQualityFilename(entry.name)) {
            qualityInputs.push({
              path: archiveRelative,
              sha256: adapters.sha256(content),
            });
          }
        } catch (error) {
          blockers.push(blocker('evidence', absolute, error));
        }
      }
    }
  }

  await walk(evidenceRoot, '');
  if (!evidenceInputs.includes('evidence/ship-log.md')) {
    evidenceInputs.push('evidence/ship-log.md');
  }
  if (sidecar.disposition === 'judged') {
    for (const decision of sidecar.handoff.decisions) {
      if (decision.outcome !== 'preserved') continue;
      const relative = decision.path.replace(/^handoff\//, '');
      const projected = `evidence/handoff/${relative}`;
      evidenceInputs.push(projected);
      if (isQualityFilename(path.basename(relative))) {
        const source = path.join(activePath, ...decision.path.split('/'));
        try {
          qualityInputs.push({
            path: projected,
            sha256: adapters.sha256(await adapters.fs.readFile(source)),
          });
        } catch (error) {
          blockers.push(blocker('quality', source, error));
        }
      }
    }
  }

  try {
    const topLevel = await adapters.fs.readdir(activePath, { withFileTypes: true });
    topLevel.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of topLevel) {
      if (!isQualityFilename(entry.name)) continue;
      const absolute = path.join(activePath, entry.name);
      try {
        const stat = await adapters.fs.lstat(absolute);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new Error('Legacy quality input must be a regular file.');
        }
        qualityInputs.push({
          path: entry.name,
          sha256: adapters.sha256(await adapters.fs.readFile(absolute)),
        });
      } catch (error) {
        blockers.push(blocker('quality', absolute, error));
      }
    }
  } catch (error) {
    blockers.push(blocker('quality', activePath, error));
  }

  evidenceInputs.sort();
  qualityInputs.sort((left, right) => left.path.localeCompare(right.path));
  blockers.sort(
    (left, right) =>
      left.operation.localeCompare(right.operation) || left.path.localeCompare(right.path)
  );
  return {
    evidenceInputs: [...new Set(evidenceInputs)],
    qualityInputs: qualityInputs.filter(
      (item, index, all) => all.findIndex(candidate => candidate.path === item.path) === index
    ),
    blockers,
  };
}

async function resolveArchiveGitPlan(
  planningRoot: string,
  executionRoot: string,
  adapters: ArchiveEngineAdapters
): Promise<{ git: ArchivePlan['git']; blockers: ArchiveBlocker[] }> {
  const blockers: ArchiveBlocker[] = [];
  const git: ArchivePlan['git'] = {
    execution: { state: 'error', codeCommit: null },
    planning: { state: 'error', branch: null, treeState: 'clean' },
  };
  try {
    const state = await adapters.git.state(executionRoot);
    if (state === 'non-git') {
      git.execution = { state, codeCommit: null };
    } else {
      const commit = await adapters.git.exec(executionRoot, [
        'rev-parse',
        '--verify',
        'HEAD^{commit}',
      ]);
      if (!/^[0-9a-f]{40}$/i.test(commit)) {
        throw new Error('Git returned a non-full execution commit.');
      }
      git.execution = { state, codeCommit: commit.toLowerCase() };
    }
  } catch (error) {
    blockers.push(blocker('git', executionRoot, error));
  }
  try {
    const state = await adapters.git.state(planningRoot);
    if (state === 'non-git') {
      git.planning = { state, branch: null, treeState: 'clean' };
    } else {
      const [branchValue, status] = await Promise.all([
        adapters.git.exec(planningRoot, ['rev-parse', '--abbrev-ref', 'HEAD']),
        adapters.git.exec(planningRoot, ['status', '--porcelain']),
      ]);
      git.planning = {
        state,
        branch: branchValue === 'HEAD' ? null : branchValue,
        treeState: status.length > 0 ? 'dirty' : 'clean',
      };
    }
  } catch (error) {
    blockers.push(blocker('git', planningRoot, error));
  }
  return { git, blockers };
}

/**
 * First mutation-free planner seam. Validation/spec preparation and strict
 * sidecar resolution are supplied as already-read facts so adapters can be
 * tested independently; no apply action is performed here.
 */
export async function createArchivePlan(
  input: CreateArchivePlanInput,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters
): Promise<ArchivePlan> {
  const blockers: ArchiveBlocker[] = [
    ...input.sidecar.blockers,
    ...(input.preparationBlockers ?? []),
  ];
  const transactionId = input.transactionId ?? adapters.transactionId();
  const transactionPaths = resolveArchiveTransactionPaths(
    input.archiveParent,
    input.date,
    input.change,
    transactionId
  );
  let sourceFingerprint: ArchiveTreeFingerprint | null = null;
  let source: ArchivePlan['preconditions']['source'] = 'missing';
  try {
    const stat = await adapters.fs.lstat(input.activePath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      source = 'invalid';
      blockers.push({
        operation: 'source-lstat',
        path: input.activePath,
        message: 'Active change source must be a real directory.',
      });
    } else {
      source = 'directory';
      sourceFingerprint = await fingerprintArchiveTree(input.activePath, adapters);
    }
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      blockers.push({
        operation: 'source-lstat',
        path: input.activePath,
        code: 'ENOENT',
        message: `Active change source does not exist: ${input.activePath}`,
      });
    } else {
      source = 'error';
      blockers.push(blocker('source-inventory', input.activePath, error));
    }
  }

  const finalPath = transactionPaths.final;
  let target: ArchivePlan['preconditions']['target'] = 'absent';
  try {
    await adapters.fs.lstat(finalPath);
    target = 'present';
    blockers.push({
      operation: 'target-lstat',
      path: finalPath,
      code: 'EEXIST',
      message: `Archive target already exists: ${finalPath}`,
    });
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      target = 'error';
      blockers.push(blocker('target-lstat', finalPath, error));
    }
  }

  const cleanerClassification = await adapters.classifyEphemera(input.ephemeraPath);
  const cleaner = projectArchiveCleaner(cleanerClassification, input.keepEphemera);
  for (const cleanerBlocker of cleaner.classification.blockers) {
    blockers.push({
      operation: 'cleaner',
      path: cleanerBlocker.path,
      ...(cleanerBlocker.code ? { code: cleanerBlocker.code } : {}),
      message: cleanerBlocker.message,
    });
  }
  if (!cleaner.classification.complete) {
    blockers.push({
      operation: 'cleaner',
      path: input.ephemeraPath,
      message: 'Ephemera classification is incomplete.',
    });
  }
  if (input.validation === 'blocked') {
    blockers.push({
      operation: 'validation',
      path: input.activePath,
      message: 'Archive validation did not pass.',
    });
  }
  if (input.tasks.completed < input.tasks.total && !input.tasks.override) {
    blockers.push({
      operation: 'tasks',
      path: input.activePath,
      message: `${input.tasks.total - input.tasks.completed} task(s) are incomplete.`,
    });
  }
  if (
    input.timing.mode === 'on-merge' &&
    input.timing.deliveryMode === 'pr' &&
    !input.timing.override
  ) {
    blockers.push({
      operation: 'timing',
      path: input.activePath,
      message: 'A recorded PR delivery requires explicit merge confirmation.',
    });
  }

  const discoveredInputs =
    source === 'directory'
      ? await discoverArchiveEvidenceInputs(
          input.activePath,
          input.sidecar,
          adapters
        )
      : {
          evidenceInputs: [] as string[],
          qualityInputs: [] as ArchiveQualityInput[],
          blockers: [] as ArchiveBlocker[],
        };
  blockers.push(...discoveredInputs.blockers);
  const gitPlan = await resolveArchiveGitPlan(
    input.planningRoot,
    input.executionRoot,
    adapters
  );
  blockers.push(...gitPlan.blockers);
  blockers.sort(
    (left, right) =>
      left.operation.localeCompare(right.operation) || left.path.localeCompare(right.path)
  );
  const stage = transactionPaths.stage;
  const normalizedSpecActions: PreparedArchiveSpecAction[] = [];
  for (const rawAction of [...input.specActions].sort((left, right) =>
    left.target.localeCompare(right.target)
  )) {
    try {
      let targetPrecondition = rawAction.targetPrecondition;
      if (targetPrecondition.state === 'file') {
        const targetStat = await adapters.fs.lstat(rawAction.target);
        targetPrecondition = {
          ...targetPrecondition,
          identity: archiveDeletionIdentity(targetStat, 'file'),
          ...(rawAction.action === 'delete'
            ? {
                capabilityTree: await fingerprintArchiveTree(
                  path.dirname(rawAction.target),
                  adapters
                ),
              }
            : {}),
        };
      }
      const actionWithoutId = {
        ...rawAction,
        targetPrecondition,
      };
      normalizedSpecActions.push({
        ...actionWithoutId,
        actionId:
          rawAction.actionId ??
          adapters.sha256(
            stableArchiveJson({
              ...actionWithoutId,
              source: path.resolve(rawAction.source),
              target: path.resolve(rawAction.target),
            })
          ),
      });
    } catch (error) {
      blockers.push(blocker('spec', rawAction.target, error));
    }
  }
  blockers.sort(
    (left, right) =>
      left.operation.localeCompare(right.operation) ||
      left.path.localeCompare(right.path)
  );
  const actions: ArchivePlan['actions'] = [];
  for (const specAction of normalizedSpecActions) {
    actions.push({
      order: actions.length + 1,
      kind: specAction.action === 'delete' ? 'delete-spec' : 'write-spec',
      path: specAction.target,
    });
  }
  for (const action of [
    ['create-stage', stage],
    ['copy-payload', input.activePath],
    ['apply-handoff', path.join(stage, 'handoff')],
    ['finalize-ship-log', path.join(stage, 'evidence', 'ship-log.md')],
    ['capture-quality', path.join(stage, 'evidence')],
    ['publish', finalPath],
    ['clean-ephemera', input.ephemeraPath],
    ['write-accounting', path.join(finalPath, 'archive.json')],
    ['remove-active', input.activePath],
    ['complete-journal', path.join(finalPath, ARCHIVE_JOURNAL_FILENAME)],
  ] as const) {
    actions.push({ order: actions.length + 1, kind: action[0], path: action[1] });
  }

  const withoutHash: Omit<ArchivePlan, 'planHash'> = {
    schemaVersion: ARCHIVE_PLAN_VERSION,
    transactionId,
    change: input.change,
    createdAt: input.createdAt ?? adapters.now().toISOString(),
    roots: {
      planning: path.resolve(input.planningRoot),
      execution: path.resolve(input.executionRoot),
    },
    paths: {
      active: path.resolve(input.activePath),
      archiveParent: transactionPaths.archiveParent,
      stage,
      final: finalPath,
      journal: transactionPaths.journal,
      publishedJournal: transactionPaths.publishedJournal,
      ephemera: path.resolve(input.ephemeraPath),
    },
    sourceFingerprint,
    git: gitPlan.git,
    preconditions: { source, target },
    decisions: {
      validation: input.validation,
      tasks: input.tasks,
      timing: input.timing,
    },
    specActions: normalizedSpecActions,
    sidecar: input.sidecar,
    cleaner,
    qualityInputs: [...(input.qualityInputs ?? discoveredInputs.qualityInputs)].sort((left, right) =>
      left.path.localeCompare(right.path)
    ),
    evidenceInputs: [...(input.evidenceInputs ?? discoveredInputs.evidenceInputs)].sort(),
    shipLog: input.shipLog ?? {
      source: null,
      sha256: null,
      recordedCommit: null,
    },
    actions,
    blockers,
    complete:
      source === 'directory' &&
      target === 'absent' &&
      cleaner.classification.complete &&
      blockers.length === 0,
  };

  return {
    ...withoutHash,
    planHash: hashArchivePlan(withoutHash, adapters),
  };
}

function planWithoutHash(plan: ArchivePlan): Omit<ArchivePlan, 'planHash'> {
  const { planHash: _planHash, ...withoutHash } = plan;
  return withoutHash;
}

function planIdentityValid(plan: ArchivePlan, adapters: ArchiveEngineAdapters): boolean {
  return (
    plan.schemaVersion === ARCHIVE_PLAN_VERSION &&
    hashArchivePlan(planWithoutHash(plan), adapters) === plan.planHash
  );
}

function archivePlanToken(plan: Pick<ArchivePlan, 'transactionId' | 'planHash'>): string {
  return `${ARCHIVE_PLAN_TOKEN_PREFIX}:${plan.transactionId}:${plan.planHash}`;
}

function parseArchivePlanToken(token: string): {
  transactionId: string;
  planHash: string;
} {
  const match = token.match(/^archive-v1:([0-9a-f-]{36}):([0-9a-f]{64})$/i);
  if (!match) throw new Error('Invalid archive plan token.');
  return { transactionId: match[1], planHash: match[2].toLowerCase() };
}

function assertStoredArchivePlanPaths(plan: ArchivePlan): void {
  const absolute = [
    plan.roots.planning,
    plan.roots.execution,
    plan.paths.active,
    plan.paths.archiveParent,
    plan.paths.stage,
    plan.paths.final,
    plan.paths.journal,
    plan.paths.publishedJournal,
    plan.paths.ephemera,
  ];
  if (absolute.some(candidate => !path.isAbsolute(candidate))) {
    throw new Error('Stored archive plan contains a non-absolute path.');
  }
  if (
    !isArchiveContainedPath(plan.roots.planning, plan.paths.active) ||
    !isArchiveContainedPath(plan.roots.planning, plan.paths.archiveParent) ||
    !isArchiveContainedPath(plan.roots.execution, plan.paths.ephemera) ||
    path.dirname(plan.paths.stage) !== plan.paths.archiveParent ||
    path.dirname(plan.paths.final) !== plan.paths.archiveParent ||
    plan.paths.journal !== path.join(plan.paths.stage, ARCHIVE_JOURNAL_FILENAME) ||
    plan.paths.publishedJournal !==
      path.join(plan.paths.final, ARCHIVE_JOURNAL_FILENAME) ||
    path.basename(plan.paths.stage) !==
      `.rasen-archive-stage-${plan.transactionId}`
  ) {
    throw new Error('Stored archive plan path containment or transaction binding is invalid.');
  }
}

/**
 * Persist the exact reviewed plan in the machine-owned transaction store.
 * The transaction directory is exclusively reserved, so its final rename
 * cannot clobber another plan.
 */
export async function persistArchivePlan(
  plan: ArchivePlan,
  globalDataDir: string,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters
): Promise<string> {
  if (!planIdentityValid(plan, adapters)) {
    throw new Error('Cannot persist an archive plan with an invalid canonical hash.');
  }
  assertStoredArchivePlanPaths(plan);
  const transactionsRoot = path.resolve(globalDataDir, 'archive-transactions');
  const transactionDirectory = path.join(transactionsRoot, plan.transactionId);
  const planPath = path.join(transactionDirectory, 'plan.json');
  await adapters.fs.mkdir(transactionsRoot, { recursive: true });
  try {
    await adapters.fs.mkdir(transactionDirectory);
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error;
    const existing = await loadStoredArchivePlan(archivePlanToken(plan), globalDataDir, adapters);
    if (stableArchiveJson(existing) === stableArchiveJson(plan)) {
      return archivePlanToken(plan);
    }
    throw new Error(`Archive transaction store collision: ${transactionDirectory}`);
  }
  const envelope: StoredArchivePlanV1 = {
    schemaVersion: 1,
    kind: 'rasen.archive-plan',
    transactionId: plan.transactionId,
    planHash: plan.planHash,
    createdAt: plan.createdAt,
    plan,
  };
  await atomicWriteJson(planPath, envelope, plan.transactionId, adapters);
  return archivePlanToken(plan);
}

export async function loadStoredArchivePlan(
  token: string,
  globalDataDir: string,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters
): Promise<ArchivePlan> {
  const parsedToken = parseArchivePlanToken(token);
  const planPath = path.join(
    path.resolve(globalDataDir, 'archive-transactions'),
    parsedToken.transactionId,
    'plan.json'
  );
  const parsed = JSON.parse(await adapters.fs.readFile(planPath, 'utf8')) as unknown;
  if (
    !isPlainRecord(parsed) ||
    !hasOnlyKeys(parsed, [
      'schemaVersion',
      'kind',
      'transactionId',
      'planHash',
      'createdAt',
      'plan',
    ]) ||
    parsed.schemaVersion !== 1 ||
    parsed.kind !== 'rasen.archive-plan' ||
    parsed.transactionId !== parsedToken.transactionId ||
    parsed.planHash !== parsedToken.planHash ||
    typeof parsed.createdAt !== 'string' ||
    !isPlainRecord(parsed.plan)
  ) {
    throw new Error(`Invalid stored archive plan envelope: ${planPath}`);
  }
  const plan = parsed.plan as unknown as ArchivePlan;
  if (
    plan.transactionId !== parsedToken.transactionId ||
    plan.planHash !== parsedToken.planHash ||
    !planIdentityValid(plan, adapters)
  ) {
    throw new Error(`Stored archive plan identity mismatch: ${planPath}`);
  }
  assertStoredArchivePlanPaths(plan);
  return plan;
}

async function pathExists(
  target: string,
  adapters: ArchiveEngineAdapters
): Promise<'present' | 'absent'> {
  try {
    await adapters.fs.lstat(target);
    return 'present';
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return 'absent';
    throw error;
  }
}

async function atomicWriteJson(
  target: string,
  value: unknown,
  transactionId: string,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.tmp-${transactionId}-${randomUUID()}`
  );
  const handle = await adapters.fs.open(temporary, 'wx', 0o600);
  let closed = false;
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    closed = true;
    await adapters.fs.rename(temporary, target);
    await flushArchiveDirectory(path.dirname(target), adapters);
  } catch (error) {
    if (!closed) await handle.close().catch(() => undefined);
    await adapters.fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function flushArchiveDirectory(
  directory: string,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  let handle: import('node:fs/promises').FileHandle | undefined;
  try {
    handle = await adapters.fs.open(directory, 'r');
    await handle.sync();
    await handle.close();
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (
      !['EISDIR', 'EINVAL', 'EPERM', 'ENOTSUP', 'EACCES'].includes(
        errorCode(error) ?? ''
      )
    ) {
      throw error;
    }
  }
}

async function writeJournal(
  journalPath: string,
  journal: ArchiveJournal,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  await atomicWriteJson(journalPath, journal, journal.transactionId, adapters);
}

async function readJournal(
  journalPath: string,
  adapters: ArchiveEngineAdapters
): Promise<ArchiveJournal | null> {
  let content: string;
  try {
    content = await adapters.fs.readFile(journalPath, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
  const value = JSON.parse(content) as ArchiveJournal;
  const integrityFailure = value.integrityFailure as unknown;
  const integritySafeAction = isPlainRecord(integrityFailure)
    ? integrityFailure.safeAction
    : undefined;
  if (
    value.schemaVersion !== 2 ||
    typeof value.transactionId !== 'string' ||
    typeof value.planHash !== 'string' ||
    typeof value.phase !== 'string' ||
    (integrityFailure !== undefined &&
      (!isPlainRecord(integrityFailure) ||
        typeof integrityFailure.detectedAt !== 'string' ||
        typeof integrityFailure.operation !== 'string' ||
        typeof integrityFailure.path !== 'string' ||
        (integrityFailure.code !== undefined &&
          typeof integrityFailure.code !== 'string') ||
        typeof integrityFailure.message !== 'string' ||
        !isPlainRecord(integritySafeAction) ||
        integritySafeAction.kind !== 'manual-recovery-required' ||
        typeof integritySafeAction.guidance !== 'string'))
  ) {
    const suffix =
      (value as { schemaVersion?: unknown }).schemaVersion === 1
        ? ' Version 1 recovery state requires manual recovery; no destructive state is inferred.'
        : '';
    throw new Error(`Invalid archive journal: ${journalPath}.${suffix}`);
  }
  return value;
}

function journalFor(
  plan: ArchivePlan,
  phase: ArchiveJournalPhase,
  ephemeraDisposed: string[],
  adapters: ArchiveEngineAdapters,
  failure?: ArchiveJournal['failure'],
  previous?: ArchiveJournal | null
): ArchiveJournal {
  const sourceClaimRoot = path.join(
    path.dirname(plan.paths.active),
    `.rasen-archive-source-${plan.transactionId}`
  );
  return {
    schemaVersion: 2,
    transactionId: plan.transactionId,
    planHash: plan.planHash,
    change: plan.change,
    phase,
    activePath: plan.paths.active,
    stagePath: plan.paths.stage,
    finalPath: plan.paths.final,
    ephemeraDisposed: [...ephemeraDisposed].sort(),
    phaseFingerprints: previous?.phaseFingerprints ?? {},
    finalReservation:
      previous?.finalReservation ?? {
        identity: null,
        entries: [],
      },
    specProgress:
      previous?.specProgress ??
      plan.specActions.map(action => ({
        actionId:
          action.actionId ??
          adapters.sha256(stableArchiveJson(action)),
        action: action.action,
        target: action.target,
        backupOrQuarantine: null,
        temporary: null,
        state: 'pending',
      })),
    cleanerProgress:
      previous?.cleanerProgress ??
      plan.cleaner.effectiveDelete.map(relativePath => ({
        path: relativePath,
        state: 'pending',
      })),
    sourceProgress:
      previous?.sourceProgress ?? {
        state: 'pending',
        quarantine: path.join(sourceClaimRoot, plan.change),
      },
    updatedAt: adapters.now().toISOString(),
    ...(failure ? { failure } : {}),
    ...(previous?.integrityFailure
      ? { integrityFailure: previous.integrityFailure }
      : {}),
  };
}

const JOURNAL_PHASE_ORDER: Record<ArchiveJournalPhase, number> = {
  planned: 0,
  staged: 1,
  'handoff-finalized': 2,
  'evidence-finalized': 3,
  'specs-applied': 4,
  published: 5,
  'cleaner-progress': 6,
  'accounting-finalized': 7,
  'source-removed': 8,
  complete: 9,
  failed: -1,
};

function phaseAtLeast(
  phase: ArchiveJournalPhase,
  threshold: ArchiveJournalPhase
): boolean {
  return JOURNAL_PHASE_ORDER[phase] >= JOURNAL_PHASE_ORDER[threshold];
}

function applyFailure(
  plan: ArchivePlan,
  journalPath: string,
  resumed: boolean,
  ephemeraDisposed: string[],
  error: unknown,
  operation: ArchiveBlockerOperation,
  operationPath: string,
  totals: ArchiveApplyResult['totals']
): ArchiveApplyResult {
  const code = errorCode(error);
  return {
    status: 'recoverable',
    transactionId: plan.transactionId,
    planHash: plan.planHash,
    change: plan.change,
    path: plan.paths.final,
    journalPath,
    resumed,
    specsUpdated: Object.values(totals).some(value => value > 0),
    totals,
    ephemeraDiscarded: [...ephemeraDisposed].sort(),
    ephemeraPreserved: plan.cleaner.effectivePreserve,
    blockers: [
      {
        operation,
        path: operationPath,
        ...(code ? { code } : {}),
        message: error instanceof Error ? error.message : String(error),
      },
    ],
    recoveryCommand: `rasen archive --apply-plan ${archivePlanToken(plan)} --yes`,
  };
}

function totalsFromSpecProgress(
  plan: ArchivePlan,
  journal: ArchiveJournal | null
): ArchiveApplyResult['totals'] {
  const totals = { added: 0, modified: 0, removed: 0, renamed: 0 };
  const complete = new Set(
    journal?.specProgress
      .filter(progress => progress.state === 'complete')
      .map(progress => progress.actionId) ?? []
  );
  for (const action of plan.specActions) {
    const actionId = action.actionId ?? '';
    if (!complete.has(actionId)) continue;
    totals.added += action.counts.added;
    totals.modified += action.counts.modified;
    totals.removed += action.counts.removed;
    totals.renamed += action.counts.renamed;
  }
  return totals;
}

/**
 * Structural duck type keeps archive-engine independent from the concrete
 * accounting error class while retaining its precise operation/path.
 */
class ArchiveAccountingErrorLike {
  operation!: string;
  path!: string;
  static [Symbol.hasInstance](value: unknown): boolean {
    return (
      typeof value === 'object' &&
      value !== null &&
      'operation' in value &&
      typeof (value as { operation?: unknown }).operation === 'string' &&
      'path' in value &&
      typeof (value as { path?: unknown }).path === 'string'
    );
  }
}

async function copyArchivePayload(
  source: string,
  target: string,
  adapters: ArchiveEngineAdapters,
  topLevel = true
): Promise<void> {
  const entries = await adapters.fs.readdir(source, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (topLevel && ARCHIVE_CONTROL_FILENAMES.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    const stat = await adapters.fs.lstat(from);
    if (stat.isSymbolicLink()) {
      const linkTarget = await adapters.fs.readlink(from);
      await adapters.fs.symlink(linkTarget, to);
    } else if (stat.isDirectory()) {
      await adapters.fs.mkdir(to);
      await copyArchivePayload(from, to, adapters, false);
    } else if (stat.isFile()) {
      await adapters.fs.copyFile(from, to, fsConstants.COPYFILE_EXCL);
    } else {
      throw new Error(`Unsupported archive payload entry: ${from}`);
    }
  }
}

/**
 * Publish a fully flushed temporary file without replacing an existing
 * destination. A same-volume hard link is atomic and fails with EEXIST.
 */
export async function publishArchiveFileNoReplace(
  temporary: string,
  target: string,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters
): Promise<void> {
  await adapters.fs.link(temporary, target);
  await adapters.fs.unlink(temporary);
  await flushArchiveDirectory(path.dirname(target), adapters);
}

export async function reserveArchiveDestination(
  target: string,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters
): Promise<void> {
  await adapters.fs.mkdir(target);
  await flushArchiveDirectory(path.dirname(target), adapters);
}

async function publishArchiveMarker(
  plan: ArchivePlan,
  payload: ArchiveTreeFingerprint,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  const target = path.join(plan.paths.final, ARCHIVE_PUBLISHED_MARKER_FILENAME);
  const temporary = path.join(
    plan.paths.final,
    `.${ARCHIVE_PUBLISHED_MARKER_FILENAME}.tmp-${plan.transactionId}-${randomUUID()}`
  );
  const marker: ArchivePublishedMarkerV1 = {
    schemaVersion: 1,
    kind: 'rasen.archive-published',
    transactionId: plan.transactionId,
    planHash: plan.planHash,
    archivePath: plan.paths.final,
    payloadDigest: payload.digest,
  };
  const handle = await adapters.fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${stableArchiveJson(marker)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    await publishArchiveFileNoReplace(temporary, target, adapters);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await adapters.fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readArchiveMarker(
  plan: ArchivePlan,
  adapters: ArchiveEngineAdapters
): Promise<ArchivePublishedMarkerV1 | null> {
  const markerPath = path.join(
    plan.paths.final,
    ARCHIVE_PUBLISHED_MARKER_FILENAME
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      (await readStableArchiveFile(markerPath, adapters)).content.toString('utf8')
    );
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
  if (
    !isPlainRecord(parsed) ||
    parsed.schemaVersion !== 1 ||
    parsed.kind !== 'rasen.archive-published' ||
    parsed.transactionId !== plan.transactionId ||
    parsed.planHash !== plan.planHash ||
    parsed.archivePath !== plan.paths.final ||
    typeof parsed.payloadDigest !== 'string'
  ) {
    throw staleArchiveObject(
      markerPath,
      'Invalid archive publication marker'
    );
  }
  return parsed as unknown as ArchivePublishedMarkerV1;
}

async function archiveEntryFromSource(
  absolute: string,
  relative: string,
  stat: ArchiveFsStat,
  adapters: ArchiveEngineAdapters
): Promise<ArchiveTreeEntry> {
  if (stat.isSymbolicLink()) {
    return {
      path: relative,
      kind: 'symlink',
      linkTarget: await adapters.fs.readlink(absolute),
    };
  }
  if (stat.isDirectory()) {
    return { path: relative, kind: 'directory' };
  }
  if (stat.isFile()) {
    const stable = await readStableArchiveFile(absolute, adapters);
    if (!identityMatches(stat, stable.stat)) {
      throw staleArchiveObject(
        absolute,
        'Archive copy source changed before handle-bound read'
      );
    }
    return {
      path: relative,
      kind: 'file',
      executable:
        process.platform === 'win32'
          ? false
          : (BigInt(stable.stat.mode) & 0o111n) !== 0n,
      size: statScalar(stable.stat.size),
      sha256: adapters.sha256(stable.content),
    };
  }
  throw new Error(`Unsupported archive payload entry: ${absolute}`);
}

async function verifyReservedArchiveEntry(
  absolute: string,
  expected: ArchiveTreeEntry,
  identity: ArchiveStatIdentity,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  const stat = await adapters.fs.lstat(absolute);
  const kind: ArchiveTreeEntry['kind'] = stat.isSymbolicLink()
    ? 'symlink'
    : stat.isDirectory()
      ? 'directory'
      : stat.isFile()
        ? 'file'
        : expected.kind;
  if (
    kind !== expected.kind ||
    stableArchiveJson(archiveDeletionIdentity(stat, kind)) !==
      stableArchiveJson(identity)
  ) {
    throw staleArchiveObject(
      absolute,
      'Reserved archive entry identity changed during recovery'
    );
  }
  if (kind === 'symlink') {
    if ((await adapters.fs.readlink(absolute)) !== expected.linkTarget) {
      throw staleArchiveObject(
        absolute,
        'Reserved archive symlink target changed during recovery'
      );
    }
  } else if (kind === 'file') {
    const stable = await readStableArchiveFile(absolute, adapters);
    if (
      adapters.sha256(stable.content) !== expected.sha256 ||
      statScalar(stable.stat.size) !== expected.size ||
      (process.platform !== 'win32' &&
        ((BigInt(stable.stat.mode) & 0o111n) !== 0n) !== expected.executable)
    ) {
      throw staleArchiveObject(
        absolute,
        'Reserved archive file payload changed during recovery'
      );
    }
  }
}

async function listReservedArchivePayloadPaths(
  directory: string,
  adapters: ArchiveEngineAdapters
): Promise<string[]> {
  const paths: string[] = [];
  async function walk(current: string, prefix: string): Promise<void> {
    const entries = await adapters.fs.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (!prefix && ARCHIVE_CONTROL_FILENAMES.has(entry.name)) continue;
      const relative = normalizeRelative(
        prefix ? path.join(prefix, entry.name) : entry.name
      );
      paths.push(relative);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await walk(path.join(current, entry.name), relative);
      }
    }
  }
  await walk(directory, '');
  return paths;
}

async function assertOwnedArchiveReservation(
  plan: ArchivePlan,
  journal: ArchiveJournal,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  if (!journal.finalReservation?.identity) {
    const conflict = new Error(
      `Archive reservation has no durable identity capability: ${plan.paths.final}`
    );
    (conflict as NodeJS.ErrnoException).code = 'ESTALE';
    throw conflict;
  }
  const stat = await adapters.fs.lstat(plan.paths.final);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stableArchiveJson(archiveDeletionIdentity(stat, 'directory')) !==
      stableArchiveJson(journal.finalReservation.identity)
  ) {
    throw staleArchiveObject(
      plan.paths.final,
      'Archive reservation identity changed during recovery'
    );
  }
  const accounted = new Set(
    journal.finalReservation.entries
      .filter(entry => entry.state === 'copied')
      .map(entry => entry.path)
  );
  const current = await listReservedArchivePayloadPaths(plan.paths.final, adapters);
  const unaccounted = current.filter(relative => !accounted.has(relative));
  if (unaccounted.length > 0) {
    const conflict = new Error(
      `Archive reservation contains unaccounted occupant(s): ${unaccounted.join(', ')}`
    );
    (conflict as NodeJS.ErrnoException).code = 'EEXIST';
    throw conflict;
  }
  for (const entry of journal.finalReservation.entries) {
    const absolute = path.join(plan.paths.final, ...entry.path.split('/'));
    const state = await pathExists(absolute, adapters);
    if (entry.state === 'intent') {
      if (state === 'present') {
        const conflict = new Error(
          `Archive reservation entry appeared before its identity was durably observed: ${absolute}`
        );
        (conflict as NodeJS.ErrnoException).code = 'EEXIST';
        throw conflict;
      }
      continue;
    }
    if (state !== 'present' || !entry.identity) {
      throw staleArchiveObject(
        absolute,
        'Recorded reserved archive entry is absent or lacks identity'
      );
    }
    await verifyReservedArchiveEntry(
      absolute,
      entry.expected,
      entry.identity,
      adapters
    );
  }
}

async function copyArchivePayloadIntoReservation(
  plan: ArchivePlan,
  journal: ArchiveJournal,
  adapters: ArchiveEngineAdapters,
  flush: () => Promise<void>
): Promise<void> {
  await assertOwnedArchiveReservation(plan, journal, adapters);

  async function walk(source: string, prefix: string): Promise<void> {
    const entries = await adapters.fs.readdir(source, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (!prefix && ARCHIVE_CONTROL_FILENAMES.has(entry.name)) continue;
      const from = path.join(source, entry.name);
      const relative = normalizeRelative(
        prefix ? path.join(prefix, entry.name) : entry.name
      );
      const to = path.join(plan.paths.final, ...relative.split('/'));
      const stat = await adapters.fs.lstat(from);
      const expected = await archiveEntryFromSource(
        from,
        relative,
        stat,
        adapters
      );
      let progress = journal.finalReservation.entries.find(
        candidate => candidate.path === relative
      );
      if (!progress) {
        progress = {
          path: relative,
          kind: expected.kind,
          expected,
          state: 'intent',
        };
        journal.finalReservation.entries.push(progress);
        journal.finalReservation.entries.sort((left, right) =>
          left.path.localeCompare(right.path)
        );
        await flush();
      } else if (
        progress.kind !== expected.kind ||
        stableArchiveJson(progress.expected) !== stableArchiveJson(expected)
      ) {
        throw staleArchiveObject(
          from,
          'Staged archive entry changed after copy intent'
        );
      }

      const targetState = await pathExists(to, adapters);
      if (progress.state === 'copied') {
        if (targetState !== 'present' || !progress.identity) {
          throw staleArchiveObject(
            to,
            'Recorded reserved archive entry disappeared'
          );
        }
        await verifyReservedArchiveEntry(
          to,
          progress.expected,
          progress.identity,
          adapters
        );
      } else {
        if (targetState === 'present') {
          const conflict = new Error(
            `Unaccounted object occupies intended archive path: ${to}`
          );
          (conflict as NodeJS.ErrnoException).code = 'EEXIST';
          throw conflict;
        }
        if (expected.kind === 'symlink') {
          await adapters.fs.symlink(expected.linkTarget!, to);
        } else if (expected.kind === 'directory') {
          await adapters.fs.mkdir(to);
        } else {
          await adapters.fs.copyFile(from, to, fsConstants.COPYFILE_EXCL);
        }
        const observed = await adapters.fs.lstat(to);
        progress.identity = archiveDeletionIdentity(observed, expected.kind);
        progress.state = 'copied';
        await flush();
        await verifyReservedArchiveEntry(
          to,
          expected,
          progress.identity,
          adapters
        );
      }

      if (expected.kind === 'directory') {
        await walk(from, relative);
      }
    }
  }
  await walk(plan.paths.stage, '');
  await assertOwnedArchiveReservation(plan, journal, adapters);
}

function identityForAuthorityEntry(
  stat: ArchiveFsStat,
  kind: ArchiveAuthorityEntry['kind']
): ArchiveStatIdentity {
  return archiveDeletionIdentity(stat, kind);
}

/**
 * Delete only the exact objects represented by a previously verified
 * deletion authority. Every leaf is revalidated immediately before unlink;
 * directories are removed bottom-up without recursive rm.
 */
export async function removeClaimedArchiveTreeGuarded(
  claimedRoot: string,
  authority: ArchiveTreeFingerprint,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters
): Promise<void> {
  const ordered = [...authority.authorityEntries].sort(
    (left, right) =>
      right.path.split('/').length - left.path.split('/').length ||
      right.path.localeCompare(left.path)
  );
  for (const entry of ordered) {
    const absolute = path.join(claimedRoot, ...entry.path.split('/'));
    const stat = await adapters.fs.lstat(absolute);
    const kind: ArchiveAuthorityEntry['kind'] = stat.isSymbolicLink()
      ? 'symlink'
      : stat.isDirectory()
        ? 'directory'
        : stat.isFile()
          ? 'file'
          : entry.kind;
    if (
      kind !== entry.kind ||
      stableArchiveJson(identityForAuthorityEntry(stat, kind)) !==
        stableArchiveJson(entry.identity)
    ) {
      const conflict = new Error(
        `Claimed archive object identity changed before deletion: ${absolute}`
      );
      (conflict as NodeJS.ErrnoException).code = 'ESTALE';
      throw conflict;
    }
    if (kind === 'directory') await adapters.fs.rmdir(absolute);
    else await adapters.fs.unlink(absolute);
  }
  const rootStat = await adapters.fs.lstat(claimedRoot);
  if (
    !rootStat.isDirectory() ||
    stableArchiveJson(archiveDeletionIdentity(rootStat, 'directory')) !==
      stableArchiveJson(authority.rootIdentity)
  ) {
    const conflict = new Error(
      `Claimed archive root identity changed before deletion: ${claimedRoot}`
    );
    (conflict as NodeJS.ErrnoException).code = 'ESTALE';
    throw conflict;
  }
  await adapters.fs.rmdir(claimedRoot);
}

async function removeEmptyDirectories(
  directory: string,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await adapters.fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      await removeEmptyDirectories(path.join(directory, entry.name), adapters);
    }
  }
  const remaining = await adapters.fs.readdir(directory, { withFileTypes: true });
  if (remaining.length === 0) {
    await adapters.fs.rm(directory, { recursive: true, force: false });
  }
}

async function applyStagedHandoff(
  plan: ArchivePlan,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  if (plan.sidecar.disposition === 'unjudged-preserve-all') return;
  for (const decision of plan.sidecar.handoff.decisions) {
    const relativeParts = decision.path.split('/');
    const source = path.join(plan.paths.stage, ...relativeParts);
    if (decision.outcome === 'absorbed') {
      try {
        await adapters.fs.unlink(source);
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
      }
      continue;
    }
    const handoffRelative = relativeParts.slice(1);
    const destination = path.join(
      plan.paths.stage,
      'evidence',
      'handoff',
      ...handoffRelative
    );
    await adapters.fs.mkdir(path.dirname(destination), { recursive: true });
    const sourceState = await pathExists(source, adapters);
    const destinationState = await pathExists(destination, adapters);
    if (sourceState === 'absent' && destinationState === 'present') continue;
    if (sourceState === 'present' && destinationState === 'absent') {
      await adapters.fs.rename(source, destination);
      continue;
    }
    throw new Error(
      `Handoff resume conflict: source=${sourceState}, destination=${destinationState}, path=${decision.path}`
    );
  }
  await removeEmptyDirectories(path.join(plan.paths.stage, 'handoff'), adapters);
}

function extractRecordedShipCommit(content: string): string | null {
  const match = content.match(/^\*\*Commit:\*\*\s*([0-9a-f]{7,64})\s*$/im);
  return match?.[1] ?? null;
}

async function finalizeStagedShipLog(
  plan: ArchivePlan,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  const evidenceRoot = path.join(plan.paths.stage, 'evidence');
  const target = path.join(evidenceRoot, 'ship-log.md');
  await adapters.fs.mkdir(evidenceRoot, { recursive: true });
  let content: string;
  try {
    content = await adapters.fs.readFile(target, 'utf8');
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
    const stagedLegacy = path.join(plan.paths.stage, 'ship-log.md');
    try {
      content = await adapters.fs.readFile(stagedLegacy, 'utf8');
    } catch (legacyError) {
      if (errorCode(legacyError) !== 'ENOENT') throw legacyError;
      if (plan.shipLog.source) {
        const sourceContent = await adapters.fs.readFile(plan.shipLog.source, 'utf8');
        if (
          plan.shipLog.sha256 &&
          adapters.sha256(sourceContent) !== plan.shipLog.sha256
        ) {
          const drift = new Error('Ship log changed after archive planning.');
          (drift as NodeJS.ErrnoException).code = 'ESTALE';
          throw drift;
        }
        content = sourceContent;
      } else {
        content = `# Ship Log: ${plan.change}\n`;
      }
    }
  }

  const archiveHeading = /^## Archive\s*$/im;
  if (archiveHeading.test(content)) {
    if (!content.includes(`**Transaction:** ${plan.transactionId}`)) {
      throw new Error('Ship log already has an archive section for another transaction.');
    }
    return;
  }
  const recordedCommit = plan.shipLog.recordedCommit ?? extractRecordedShipCommit(content);
  const suffix = [
    '',
    '## Archive',
    `**Date:** ${plan.createdAt}`,
    ...(recordedCommit ? [`**Ship commit:** ${recordedCommit}`] : []),
    `**Outcome:** archived at ${plan.paths.final}`,
    `**Transaction:** ${plan.transactionId}`,
    '',
  ].join('\n');
  const finalizedContent = `${content}${suffix}`;
  await adapters.fs.writeFile(target, finalizedContent, {
    flag: 'wx',
  }).catch(async error => {
    if (errorCode(error) !== 'EEXIST') throw error;
    await adapters.fs.writeFile(target, finalizedContent);
  });
}

function isQualityFilename(name: string): boolean {
  return /(?:-review|-report|-audit)\.md$/i.test(name);
}

export interface ArchiveQualitySummary {
  files: string[];
  metrics: Record<string, number>;
}

export async function captureArchiveQuality(
  archiveRoot: string,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters
): Promise<ArchiveQualitySummary> {
  const evidenceRoot = path.join(archiveRoot, 'evidence');
  const summary: ArchiveQualitySummary = { files: [], metrics: {} };

  async function walk(directory: string, prefix: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await adapters.fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (!prefix && errorCode(error) === 'ENOENT') return;
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = normalizeRelative(prefix ? path.join(prefix, entry.name) : entry.name);
      const stat = await adapters.fs.lstat(absolute);
      if (stat.isSymbolicLink()) {
        throw new Error(`Quality evidence may not contain symlinks: ${absolute}`);
      }
      if (stat.isDirectory()) {
        await walk(absolute, relative);
      } else if (stat.isFile() && isQualityFilename(entry.name)) {
        const archiveRelative = `evidence/${relative}`;
        const content = await adapters.fs.readFile(absolute, 'utf8');
        const metricCount = content
          .split(/\r?\n/)
          .filter(line => /\b(?:findings|issues|scenarios):/i.test(line.trim())).length;
        summary.files.push(archiveRelative);
        summary.metrics[archiveRelative] = metricCount;
      }
    }
  }

  await walk(evidenceRoot, '');
  // Compatibility: archives produced before canonical evidence placement kept
  // quality reports at the change root. Continue recording those exact
  // top-level paths while all new workflow guidance writes under evidence/.
  let legacyEntries: Dirent[];
  try {
    legacyEntries = await adapters.fs.readdir(archiveRoot, { withFileTypes: true });
  } catch (error) {
    throw error;
  }
  legacyEntries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of legacyEntries) {
    if (!isQualityFilename(entry.name)) continue;
    const absolute = path.join(archiveRoot, entry.name);
    const stat = await adapters.fs.lstat(absolute);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Legacy quality input must be a regular file: ${absolute}`);
    }
    const content = await adapters.fs.readFile(absolute, 'utf8');
    summary.files.push(entry.name);
    summary.metrics[entry.name] = content
      .split(/\r?\n/)
      .filter(line => /\b(?:findings|issues|scenarios):/i.test(line.trim())).length;
  }
  summary.files.sort();
  summary.metrics = Object.fromEntries(
    Object.entries(summary.metrics).sort(([left], [right]) => left.localeCompare(right))
  );
  if (summary.files.length === 0) return summary;

  const metadataPath = path.join(archiveRoot, '.openspec.yaml');
  let metadata: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(await adapters.fs.readFile(metadataPath, 'utf8'));
    if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
      throw new Error('.openspec.yaml must contain a mapping.');
    }
    metadata = (parsed as Record<string, unknown> | null) ?? {};
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  metadata.quality = summary;
  await adapters.fs.writeFile(metadataPath, stringifyYaml(metadata));
  return summary;
}

function sameArchiveObject(
  stat: ArchiveFsStat,
  planned: ArchiveStatIdentity,
  kind: ArchiveAuthorityEntry['kind']
): boolean {
  const actual = archiveDeletionIdentity(stat, kind);
  return (
    actual.dev === planned.dev &&
    actual.ino === planned.ino &&
    actual.mode === planned.mode &&
    actual.size === planned.size
  );
}

async function writeFlushedExclusiveFile(
  target: string,
  bytes: string | Uint8Array,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  const handle = await adapters.fs.open(target, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function applySpecActions(
  plan: ArchivePlan,
  adapters: ArchiveEngineAdapters,
  journal: ArchiveJournal,
  flush: () => Promise<void>
): Promise<ArchiveApplyResult['totals']> {
  const stateRank: Record<ArchiveJournal['specProgress'][number]['state'], number> = {
    pending: 0,
    'intent-durable': 1,
    claimed: 2,
    published: 3,
    verified: 4,
    complete: 5,
    conflict: -1,
    failed: -1,
  };

  async function conflict(
    progress: ArchiveJournal['specProgress'][number],
    message: string,
    code: string
  ): Promise<never> {
    const error = new Error(message);
    (error as NodeJS.ErrnoException).code = code;
    progress.state = 'conflict';
    progress.error = message;
    await flush();
    throw error;
  }

  async function stableFileHash(target: string): Promise<{
    sha256: string;
    stat: ArchiveFsStat;
  }> {
    const stable = await readStableArchiveFile(target, adapters);
    return {
      sha256: adapters.sha256(stable.content),
      stat: stable.stat,
    };
  }

  for (const action of plan.specActions) {
    const actionId = action.actionId!;
    const progress = journal.specProgress.find(
      candidate => candidate.actionId === actionId
    );
    if (!progress) {
      throw new Error(`Missing durable spec progress for ${action.target}.`);
    }
    if (progress.state === 'complete') continue;
    if ((await stableFileHash(action.source)).sha256 !== action.sourceSha256) {
      const drift = new Error(`Delta spec changed after planning: ${action.source}`);
      (drift as NodeJS.ErrnoException).code = 'ESTALE';
      throw drift;
    }

    const targetDirectory = path.dirname(action.target);
    const claimRoot = path.join(
      targetDirectory,
      `.rasen-archive-spec-${plan.transactionId}-${actionId.slice(0, 12)}`
    );
    const backup = path.join(claimRoot, action.action === 'delete' ? 'capability' : 'original');
    const temporary = path.join(claimRoot, 'result.tmp');
    progress.backupOrQuarantine =
      action.action === 'create' ? null : backup;
    progress.temporary = action.action === 'delete' ? null : temporary;
    if (progress.state === 'pending') {
      progress.state = 'intent-durable';
      await flush();
    }

    if (action.action === 'delete') {
      if (
        action.targetPrecondition.state !== 'file' ||
        !action.targetPrecondition.capabilityTree
      ) {
        throw new Error(`Delete spec is missing full-tree authority: ${action.target}`);
      }
      const capabilityDirectory = path.dirname(action.target);
      const claimParent = path.dirname(capabilityDirectory);
      const deleteClaimRoot = path.join(
        claimParent,
        `.rasen-archive-spec-${plan.transactionId}-${actionId.slice(0, 12)}`
      );
      const quarantine = path.join(deleteClaimRoot, path.basename(capabilityDirectory));
      progress.backupOrQuarantine = quarantine;
      try {
        await adapters.fs.mkdir(deleteClaimRoot);
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error;
      }
      if (
        progress.state === 'claimed' &&
        (await pathExists(quarantine, adapters)) === 'absent'
      ) {
        await adapters.fs.rmdir(deleteClaimRoot).catch(error => {
          if (errorCode(error) !== 'ENOENT') throw error;
        });
        progress.state = 'complete';
        await flush();
        continue;
      }
      if ((await pathExists(quarantine, adapters)) === 'absent') {
        const current = await fingerprintArchiveTree(capabilityDirectory, adapters);
        if (
          !archiveDeletionAuthorityMatches(
            current,
            action.targetPrecondition.capabilityTree
          )
        ) {
          const drift = new Error(
            `Capability tree changed after planning: ${capabilityDirectory}`
          );
          (drift as NodeJS.ErrnoException).code = 'ESTALE';
          progress.state = 'conflict';
          progress.error = drift.message;
          await flush();
          throw drift;
        }
        await adapters.fs.rename(capabilityDirectory, quarantine);
      }
      const claimed = await fingerprintArchiveTree(quarantine, adapters);
      if (
        !archiveDeletionAuthorityMatches(
          claimed,
          action.targetPrecondition.capabilityTree
        )
      ) {
        const conflict = new Error(
          `Claimed capability identity mismatch; retained at ${quarantine}`
        );
        (conflict as NodeJS.ErrnoException).code = 'ESTALE';
        progress.state = 'conflict';
        progress.error = conflict.message;
        await flush();
        throw conflict;
      }
      progress.state = 'claimed';
      await flush();
      await removeClaimedArchiveTreeGuarded(
        quarantine,
        action.targetPrecondition.capabilityTree,
        adapters
      );
      await adapters.fs.rmdir(deleteClaimRoot);
      progress.state = 'complete';
      await flush();
      continue;
    }

    await adapters.fs.mkdir(targetDirectory, { recursive: true });
    try {
      await adapters.fs.mkdir(claimRoot);
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
    }
    const claimStat = await adapters.fs.lstat(claimRoot);
    if (!claimStat.isDirectory() || claimStat.isSymbolicLink()) {
      await conflict(progress, `Invalid spec claim directory: ${claimRoot}`, 'ESTALE');
    }
    const claimIdentity = archiveDeletionIdentity(claimStat, 'directory');
    if (
      progress.claimIdentity &&
      stableArchiveJson(progress.claimIdentity) !== stableArchiveJson(claimIdentity)
    ) {
      await conflict(
        progress,
        `Spec claim directory identity changed: ${claimRoot}`,
        'ESTALE'
      );
    }
    if (!progress.claimIdentity) {
      progress.claimIdentity = claimIdentity;
      await flush();
    }

    const rebuiltHash = adapters.sha256(action.rebuilt);
    const verifiedBeforeAttempt = stateRank[progress.state] >= stateRank.verified;
    const durableProgress = progress;

    async function ensureTemporary(): Promise<void> {
      const temporaryState = await pathExists(temporary, adapters);
      if (temporaryState === 'absent') {
        if (durableProgress.temporaryIdentity) {
          return;
        }
        await writeFlushedExclusiveFile(temporary, action.rebuilt, adapters);
      }
      const current = await stableFileHash(temporary);
      if (current.sha256 !== rebuiltHash) {
        await conflict(
          durableProgress,
          `Spec temporary payload changed: ${temporary}`,
          'ESTALE'
        );
      }
      const identity = archiveDeletionIdentity(current.stat, 'file');
      if (
        durableProgress.temporaryIdentity &&
        stableArchiveJson(durableProgress.temporaryIdentity) !==
          stableArchiveJson(identity)
      ) {
        await conflict(
          durableProgress,
          `Spec temporary identity changed: ${temporary}`,
          'ESTALE'
        );
      }
      if (!durableProgress.temporaryIdentity) {
        durableProgress.temporaryIdentity = identity;
        await flush();
      }
    }

    async function reconcilePublishedTarget(): Promise<boolean> {
      if ((await pathExists(action.target, adapters)) === 'absent') return false;
      const current = await stableFileHash(action.target);
      if (
        action.action === 'update' &&
        stateRank[durableProgress.state] < stateRank.claimed &&
        action.targetPrecondition.state === 'file' &&
        action.targetPrecondition.identity &&
        sameArchiveObject(current.stat, action.targetPrecondition.identity, 'file') &&
        current.sha256 === action.targetPrecondition.sha256
      ) {
        return false;
      }
      const currentIdentity = archiveDeletionIdentity(current.stat, 'file');
      const owned =
        (durableProgress.temporaryIdentity &&
          sameArchiveObject(
            current.stat,
            durableProgress.temporaryIdentity,
            'file'
          )) ||
        (durableProgress.publishedIdentity &&
          sameArchiveObject(
            current.stat,
            durableProgress.publishedIdentity,
            'file'
          ));
      if (current.sha256 !== rebuiltHash || !owned) {
        await conflict(
          durableProgress,
          `Spec target exists without this transaction's publication identity: ${action.target}`,
          current.sha256 === rebuiltHash ? 'EEXIST' : 'ESTALE'
        );
      }
      durableProgress.publishedIdentity = currentIdentity;
      if (stateRank[durableProgress.state] < stateRank.published) {
        durableProgress.state = 'published';
      }
      await flush();
      if ((await pathExists(temporary, adapters)) === 'present') {
        const temporaryStat = await adapters.fs.lstat(temporary);
        if (
          !durableProgress.temporaryIdentity ||
          !sameArchiveObject(
            temporaryStat,
            durableProgress.temporaryIdentity,
            'file'
          ) ||
          !sameArchiveObject(temporaryStat, currentIdentity, 'file')
        ) {
          await conflict(
            durableProgress,
            `Spec temporary is not the published hard-link object: ${temporary}`,
            'ESTALE'
          );
        }
        await adapters.fs.unlink(temporary);
        await flushArchiveDirectory(claimRoot, adapters);
      }
      return true;
    }

    let publishedTarget = await reconcilePublishedTarget();
    if (!publishedTarget) {
      await ensureTemporary();
      if (!progress.temporaryIdentity) {
        throw new Error(`Spec temporary identity is not durable: ${temporary}`);
      }
      if (action.action === 'create') {
        await publishArchiveFileNoReplace(temporary, action.target, adapters);
      } else {
        if (action.targetPrecondition.state !== 'file') {
          throw new Error(`Update spec is missing a file precondition: ${action.target}`);
        }
        if ((await pathExists(backup, adapters)) === 'absent') {
          const current = await stableFileHash(action.target);
          if (
            !action.targetPrecondition.identity ||
            !sameArchiveObject(current.stat, action.targetPrecondition.identity, 'file') ||
            current.sha256 !== action.targetPrecondition.sha256
          ) {
            await conflict(
              progress,
              `Target spec changed after planning: ${action.target}`,
              'ESTALE'
            );
          }
          await adapters.fs.rename(action.target, backup);
        }
        const claimed = await stableFileHash(backup);
        if (
          !action.targetPrecondition.identity ||
          !sameArchiveObject(claimed.stat, action.targetPrecondition.identity, 'file') ||
          claimed.sha256 !== action.targetPrecondition.sha256
        ) {
          await conflict(
            progress,
            `Claimed spec target identity mismatch; retained at ${backup}`,
            'ESTALE'
          );
        }
        if (stateRank[progress.state] < stateRank.claimed) {
          progress.state = 'claimed';
          await flush();
        }
        await publishArchiveFileNoReplace(temporary, action.target, adapters);
      }
      const target = await stableFileHash(action.target);
      if (
        target.sha256 !== rebuiltHash ||
        !sameArchiveObject(target.stat, progress.temporaryIdentity, 'file')
      ) {
        await conflict(
          progress,
          `Published spec verification failed: ${action.target}`,
          'ESTALE'
        );
      }
      progress.publishedIdentity = archiveDeletionIdentity(target.stat, 'file');
      progress.state = 'published';
      await flush();
      publishedTarget = true;
    }

    if (!publishedTarget) {
      throw new Error(`Spec publication did not produce a target: ${action.target}`);
    }
    const result = await stableFileHash(action.target);
    if (
      result.sha256 !== rebuiltHash ||
      !progress.publishedIdentity ||
      !sameArchiveObject(result.stat, progress.publishedIdentity, 'file')
    ) {
      await conflict(
        progress,
        `Published spec verification failed: ${action.target}`,
        'ESTALE'
      );
    }
    progress.state = 'verified';
    await flush();

    if (action.action === 'update') {
      const backupState = await pathExists(backup, adapters);
      if (backupState === 'present') {
        const backupFile = await stableFileHash(backup);
        if (
          action.targetPrecondition.state !== 'file' ||
          !action.targetPrecondition.identity ||
          !sameArchiveObject(backupFile.stat, action.targetPrecondition.identity, 'file') ||
          backupFile.sha256 !== action.targetPrecondition.sha256
        ) {
          await conflict(
            progress,
            `Spec backup identity changed before removal: ${backup}`,
            'ESTALE'
          );
        }
        await adapters.fs.unlink(backup);
        await flushArchiveDirectory(claimRoot, adapters);
      } else if (!verifiedBeforeAttempt) {
        await conflict(
          progress,
          `Spec backup disappeared before verified cleanup intent: ${backup}`,
          'ESTALE'
        );
      }
    }
    await adapters.fs.rmdir(claimRoot).catch(error => {
      if (errorCode(error) !== 'ENOENT') throw error;
    });
    progress.state = 'complete';
    await flush();
  }
  return totalsFromSpecProgress(plan, journal);
}

async function classifySingleCleanerCandidate(
  plan: ArchivePlan,
  relativePath: string
): Promise<EphemeraClassification> {
  const candidate = plan.cleaner.classification.candidates.find(
    entry => entry.relativePath === relativePath
  );
  if (!candidate) {
    throw new Error(`Archive plan is missing cleaner fingerprint for ${relativePath}`);
  }
  return {
    discarded: [relativePath],
    preserved: [],
    aborted: false,
    candidates: [candidate],
    preservedEntries: [],
    sourceSignals: [],
    blockers: [],
    complete: true,
  };
}

function handoffAccounting(plan: ArchivePlan): HandoffAbsorbedEntry[] | null {
  if (plan.sidecar.disposition === 'unjudged-preserve-all') return null;
  return plan.sidecar.handoff.decisions.map(decision => ({
    file: decision.path,
    outcome: decision.outcome,
  }));
}

async function revalidateArchiveGitPlan(
  plan: ArchivePlan,
  adapters: ArchiveEngineAdapters,
  recoveryOwned = false
): Promise<void> {
  const actual = await resolveArchiveGitPlan(
    plan.roots.planning,
    plan.roots.execution,
    adapters
  );
  if (recoveryOwned && actual.git.planning.state === 'git') {
    const excluded = [
      plan.paths.active,
      plan.paths.stage,
      plan.paths.final,
      plan.paths.ephemera,
      path.join(
        path.dirname(plan.paths.active),
        `.rasen-archive-source-${plan.transactionId}`
      ),
      ...plan.specActions.map(action => action.target),
      ...plan.specActions.map(action => {
        const actionId = action.actionId ?? adapters.sha256(stableArchiveJson(action));
        const parent =
          action.action === 'delete'
            ? path.dirname(path.dirname(action.target))
            : path.dirname(action.target);
        return path.join(
          parent,
          `.rasen-archive-spec-${plan.transactionId}-${actionId.slice(0, 12)}`
        );
      }),
    ]
      .filter(candidate => isArchiveContainedPath(plan.roots.planning, candidate))
      .map(candidate =>
        normalizeRelative(path.relative(plan.roots.planning, candidate))
      )
      .filter(relative => relative.length > 0);
    const status = await adapters.git.exec(plan.roots.planning, [
      'status',
      '--porcelain',
      '--',
      '.',
      ...excluded.flatMap(relative => [
        `:(exclude)${relative}`,
        `:(exclude)${relative}/**`,
      ]),
    ]);
    actual.git.planning.treeState = status.length > 0 ? 'dirty' : 'clean';
  }
  if (
    actual.blockers.length > 0 ||
    stableArchiveJson(actual.git.execution) !== stableArchiveJson(plan.git.execution) ||
    actual.git.planning.state !== plan.git.planning.state ||
    actual.git.planning.branch !== plan.git.planning.branch ||
    actual.git.planning.treeState !== plan.git.planning.treeState
  ) {
    const drift = new Error('Git facts changed or became ambiguous after archive planning.');
    (drift as NodeJS.ErrnoException).code = 'ESTALE';
    throw drift;
  }
}

async function revalidateArchiveProbes(
  plan: ArchivePlan,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  let executionReal: string | undefined;
  if (plan.sidecar.probes.length > 0) {
    executionReal = await adapters.fs.realpath(plan.roots.execution);
  }
  for (const probe of plan.sidecar.probes) {
    const absolute = path.resolve(
      plan.roots.execution,
      ...probe.path.split('/')
    );
    if (!isArchiveContainedPath(plan.roots.execution, absolute)) {
      throw new Error(`Probe escaped execution root after planning: ${probe.path}`);
    }
    const stat = await adapters.fs.lstat(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Probe is no longer a real directory: ${probe.path}`);
    }
    const actualReal = await adapters.fs.realpath(absolute);
    if (!executionReal || !isArchiveContainedPath(executionReal, actualReal)) {
      throw new Error(`Probe resolves outside execution root: ${probe.path}`);
    }
    await adapters.git.exec(plan.roots.execution, [
      'cat-file',
      '-e',
      `${probe.codeCommit}^{commit}`,
    ]);
  }
}

/**
 * Apply the exact immutable plan. The active source is copied and verified,
 * all archive-local transformations happen in the stage, publication is one
 * exclusive same-parent rename, and source removal is the final destructive
 * operation.
 */
export async function applyArchive(
  plan: ArchivePlan,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters
): Promise<ArchiveApplyResult> {
  if (!planIdentityValid(plan, adapters)) {
    return {
      status: 'blocked',
      transactionId: plan.transactionId,
      planHash: plan.planHash,
      change: plan.change,
      path: plan.paths.final,
      journalPath: plan.paths.journal,
      resumed: false,
      specsUpdated: false,
      totals: { added: 0, modified: 0, removed: 0, renamed: 0 },
      ephemeraDiscarded: [],
      ephemeraPreserved: plan.cleaner.effectivePreserve,
      blockers: [
        {
          operation: 'validation',
          path: plan.paths.active,
          message: 'Archive plan hash or schema version is invalid.',
        },
      ],
    };
  }
  if (!plan.complete || plan.blockers.length > 0) {
    return {
      status: 'blocked',
      transactionId: plan.transactionId,
      planHash: plan.planHash,
      change: plan.change,
      path: plan.paths.final,
      journalPath: plan.paths.journal,
      resumed: false,
      specsUpdated: false,
      totals: { added: 0, modified: 0, removed: 0, renamed: 0 },
      ephemeraDiscarded: [],
      ephemeraPreserved: plan.cleaner.effectivePreserve,
      blockers: plan.blockers,
    };
  }

  let resumed = false;
  let published = false;
  let finalReserved = false;
  let journalPath = plan.paths.journal;
  let ephemeraDisposed: string[] = [];
  let totals = { added: 0, modified: 0, removed: 0, renamed: 0 };
  let currentPhase: ArchiveJournalPhase = 'planned';
  let ownsRecoveryState = false;
  let currentOperation: ArchiveBlockerOperation = 'source-inventory';
  let currentOperationPath = plan.paths.active;
  let journalSnapshot: ArchiveJournal | null = null;

  async function persistJournalPhase(
    target: string,
    phase: ArchiveJournalPhase,
    failure?: ArchiveJournal['failure']
  ): Promise<void> {
    journalSnapshot = journalFor(
      plan,
      phase,
      ephemeraDisposed,
      adapters,
      failure,
      journalSnapshot
    );
    await writeJournal(target, journalSnapshot, adapters);
  }

  async function recordVerifiedFingerprint(
    name: string,
    scope: 'stage' | 'final',
    before: ArchiveTreeFingerprint,
    observedAfter: ArchiveTreeFingerprint
  ): Promise<void> {
    if (!journalSnapshot) {
      journalSnapshot = journalFor(
        plan,
        currentPhase,
        ephemeraDisposed,
        adapters
      );
    }
    journalSnapshot.phaseFingerprints[name] = {
      state: 'verified',
      scope,
      before,
      expectedAfter: observedAfter,
      observedAfter,
    };
  }

  async function recordIntentFingerprint(
    name: string,
    scope: 'stage' | 'final',
    before: ArchiveTreeFingerprint,
    expectedAfter: ArchiveTreeFingerprint,
    targetJournal: string
  ): Promise<void> {
    if (!journalSnapshot) {
      journalSnapshot = journalFor(
        plan,
        currentPhase,
        ephemeraDisposed,
        adapters
      );
    }
    journalSnapshot.phaseFingerprints[name] = {
      state: 'intent',
      scope,
      before,
      expectedAfter,
    };
    await persistJournalPhase(targetJournal, currentPhase);
  }

  async function projectStageTransform(
    mutator: (projectionPlan: ArchivePlan) => Promise<void>
  ): Promise<ArchiveTreeFingerprint> {
    const projection = path.join(
      plan.paths.archiveParent,
      `.rasen-archive-projection-${plan.transactionId}-${randomUUID()}`
    );
    await adapters.fs.mkdir(projection);
    try {
      await copyArchivePayload(plan.paths.stage, projection, adapters);
      await mutator({
        ...plan,
        paths: { ...plan.paths, stage: projection },
      });
      return await fingerprintArchiveTree(projection, adapters);
    } finally {
      await adapters.fs.rm(projection, { recursive: true, force: true });
    }
  }

  async function projectAccountingTransform(
    accounting: ArchiveAccounting
  ): Promise<ArchiveTreeFingerprint> {
    const projection = path.join(
      plan.paths.archiveParent,
      `.rasen-archive-accounting-${plan.transactionId}-${randomUUID()}`
    );
    await adapters.fs.mkdir(projection);
    try {
      await copyArchivePayload(plan.paths.final, projection, adapters);
      await adapters.fs.writeFile(
        path.join(projection, 'archive.json'),
        serializeArchiveAccounting(accounting),
        { flag: 'wx' }
      );
      return await fingerprintArchiveTree(projection, adapters);
    } finally {
      await adapters.fs.rm(projection, { recursive: true, force: true });
    }
  }

  async function verifyRecordedPayloadForResume(): Promise<void> {
    if (!journalSnapshot) return;
    const records = Object.entries(journalSnapshot.phaseFingerprints);
    const scopes: Array<'stage' | 'final'> = finalReserved
      ? published
        ? ['final']
        : ['stage', 'final']
      : ['stage'];
    for (const scope of scopes) {
      const matching = records.filter(([, value]) => value.scope === scope);
      const latest = matching.at(-1);
      if (!latest) continue;
      if (
        scope === 'final' &&
        latest[0] === 'final-reserved' &&
        latest[1].state === 'intent'
      ) {
        await assertOwnedArchiveReservation(plan, journalSnapshot, adapters);
        continue;
      }
      const expected = latest[1].observedAfter ?? latest[1].expectedAfter;
      const root = scope === 'final' ? plan.paths.final : plan.paths.stage;
      const current = await fingerprintArchiveTree(root, adapters);
      const matchesExpected = archivePayloadFingerprintMatches(current, expected);
      const matchesBefore =
        latest[1].state === 'intent' &&
        archivePayloadFingerprintMatches(current, latest[1].before);
      if (!matchesExpected && !matchesBefore) {
        const conflict = new Error(
          `Archive ${scope} payload changed after verified phase ${latest[0]}.`
        );
        (conflict as NodeJS.ErrnoException).code = 'ESTALE';
        throw conflict;
      }
      if (latest[1].state === 'intent' && matchesExpected) {
        latest[1].state = 'verified';
        latest[1].observedAfter = current;
        const reconciledPhase: Partial<
          Record<string, ArchiveJournalPhase>
        > = {
          'payload-copied': 'staged',
          'handoff-finalized': 'handoff-finalized',
          'evidence-finalized': 'evidence-finalized',
          'accounting-finalized': 'accounting-finalized',
        };
        const promoted = reconciledPhase[latest[0]];
        if (
          promoted &&
          JOURNAL_PHASE_ORDER[promoted] > JOURNAL_PHASE_ORDER[currentPhase]
        ) {
          currentPhase = promoted;
        }
        await persistJournalPhase(
          finalReserved ? plan.paths.publishedJournal : plan.paths.journal,
          currentPhase
        );
      }
    }
  }

  async function verifyCompletedTransaction(
    completed: ArchiveJournal
  ): Promise<void> {
    const marker = await readArchiveMarker(plan, adapters);
    if (!marker) {
      throw staleArchiveObject(
        path.join(plan.paths.final, ARCHIVE_PUBLISHED_MARKER_FILENAME),
        'Completed archive is missing its publication marker'
      );
    }
    const accountingPhase =
      completed.phaseFingerprints['accounting-finalized'];
    if (
      !accountingPhase ||
      accountingPhase.scope !== 'final' ||
      accountingPhase.state !== 'verified' ||
      !accountingPhase.observedAfter
    ) {
      throw staleArchiveObject(
        plan.paths.publishedJournal,
        'Completed archive lacks a verified accounting payload capability'
      );
    }
    if (marker.payloadDigest !== accountingPhase.before.digest) {
      throw staleArchiveObject(
        path.join(plan.paths.final, ARCHIVE_PUBLISHED_MARKER_FILENAME),
        'Publication marker is not bound to the completed accounting phase'
      );
    }
    const finalPayload = await fingerprintArchiveTree(plan.paths.final, adapters);
    if (
      !archivePayloadFingerprintMatches(
        finalPayload,
        accountingPhase.observedAfter
      )
    ) {
      throw staleArchiveObject(
        plan.paths.final,
        'Completed archive payload differs from its verified phase fingerprint'
      );
    }
    const ledgerPath = path.join(plan.paths.final, 'archive.json');
    let accounting: ArchiveAccounting;
    try {
      const parsed = JSON.parse(
        (await readStableArchiveFile(ledgerPath, adapters)).content.toString('utf8')
      ) as ArchiveAccounting;
      if (
        !isPlainRecord(parsed) ||
        parsed.change !== plan.change ||
        parsed.archivedAt !== plan.createdAt ||
        parsed.codeCommit !== plan.git.execution.codeCommit ||
        parsed.planningBranch !== plan.git.planning.branch ||
        parsed.planningTreeState !== plan.git.planning.treeState ||
        stableArchiveJson(parsed.ephemeraDiscarded) !==
          stableArchiveJson([...completed.ephemeraDisposed].sort()) ||
        stableArchiveJson(parsed.probes) !==
          stableArchiveJson(plan.sidecar.probes) ||
        stableArchiveJson(parsed.handoffAbsorbed) !==
          stableArchiveJson(handoffAccounting(plan))
      ) {
        throw new Error('Completed archive accounting is not bound to its plan and journal.');
      }
      accounting = parsed;
    } catch (error) {
      if (errorCode(error)) throw error;
      const invalid = new Error(
        `Completed archive accounting verification failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      (invalid as NodeJS.ErrnoException).code = 'ESTALE';
      throw invalid;
    }
    await adapters.verifyArchiveAccounting(plan.paths.final, accounting);
  }

  function completedIntegrityFailureResult(
    integrityFailure: ArchiveIntegrityFailure
  ): ArchiveApplyResult {
    return {
      status: 'recoverable',
      transactionId: plan.transactionId,
      planHash: plan.planHash,
      change: plan.change,
      path: plan.paths.final,
      journalPath: plan.paths.publishedJournal,
      resumed: true,
      specsUpdated: Object.values(totals).some(value => value > 0),
      totals,
      ephemeraDiscarded: [...ephemeraDisposed].sort(),
      ephemeraPreserved: plan.cleaner.effectivePreserve,
      blockers: [
        {
          operation: integrityFailure.operation,
          path: integrityFailure.path,
          ...(integrityFailure.code ? { code: integrityFailure.code } : {}),
          message: integrityFailure.message,
        },
      ],
      manualRecoveryAction: integrityFailure.safeAction,
    };
  }

  function bindPublishedRecoveryJournal(completed: ArchiveJournal): void {
    resumed = true;
    published = true;
    finalReserved = true;
    ownsRecoveryState = true;
    journalPath = plan.paths.publishedJournal;
    currentPhase =
      completed.phase === 'failed'
        ? completed.failure?.resumePhase ?? 'source-removed'
        : completed.phase;
    journalSnapshot = completed;
    ephemeraDisposed = [...completed.ephemeraDisposed];
    totals = totalsFromSpecProgress(plan, completed);
  }

  async function persistCompletedIntegrityFailure(
    completed: ArchiveJournal,
    integrityFailure: ArchiveIntegrityFailure
  ): Promise<ArchiveApplyResult> {
    const terminalJournal: ArchiveJournal = {
      ...completed,
      updatedAt: integrityFailure.detectedAt,
      integrityFailure,
    };
    journalSnapshot = terminalJournal;
    try {
      await writeJournal(plan.paths.publishedJournal, terminalJournal, adapters);
      return completedIntegrityFailureResult(integrityFailure);
    } catch (persistenceError) {
      let authoritative: ArchiveJournal | null = null;
      let rereadError: unknown;
      try {
        authoritative = await readJournal(plan.paths.publishedJournal, adapters);
      } catch (error) {
        rereadError = error;
      }
      if (
        authoritative?.transactionId === plan.transactionId &&
        authoritative.planHash === plan.planHash
      ) {
        bindPublishedRecoveryJournal(authoritative);
        if (authoritative.integrityFailure) {
          return completedIntegrityFailureResult(
            authoritative.integrityFailure
          );
        }
      } else {
        bindPublishedRecoveryJournal(completed);
      }

      const persistenceCode = errorCode(persistenceError);
      const persistenceMessage =
        persistenceError instanceof Error
          ? persistenceError.message
          : String(persistenceError);
      const rereadDetail = rereadError
        ? ` The authoritative journal could not be reread: ${
            rereadError instanceof Error ? rereadError.message : String(rereadError)
          }.`
        : '';
      const persistenceFailure: ArchiveIntegrityFailure = {
        detectedAt: integrityFailure.detectedAt,
        operation: 'journal',
        path: plan.paths.publishedJournal,
        ...(persistenceCode ? { code: persistenceCode } : {}),
        message:
          `The completed archive failed integrity verification, but the engine could not persist its manual-recovery alert: ${persistenceMessage}.` +
          ` Original integrity failure: ${integrityFailure.message}.${rereadDetail}`,
        safeAction: {
          kind: 'manual-recovery-required',
          guidance:
            'Automatic archive resume is disabled because the completed archive failed integrity verification and its terminal alert could not be confirmed durable. ' +
            `Preserve the published archive and journal, inspect ${integrityFailure.path}, resolve the journal I/O failure at ${plan.paths.publishedJournal}, restore the archive from a trusted source, and obtain operator verification before any further archive action. ` +
            'A later invocation may retry recording the alert but cannot repair the archive automatically.',
        },
      };
      return completedIntegrityFailureResult(persistenceFailure);
    }
  }

  try {
    const preflightStage = await pathExists(plan.paths.stage, adapters);
    const preflightFinal = await pathExists(plan.paths.final, adapters);
    let recoveryOwned = false;
    if (preflightStage === 'present') {
      const existing = await readJournal(plan.paths.journal, adapters);
      recoveryOwned =
        existing?.transactionId === plan.transactionId &&
        existing.planHash === plan.planHash;
    }
    if (preflightFinal === 'present') {
      const existing = await readJournal(plan.paths.publishedJournal, adapters);
      const publishedRecoveryOwned =
        existing?.transactionId === plan.transactionId &&
        existing.planHash === plan.planHash;
      recoveryOwned = recoveryOwned || publishedRecoveryOwned;
      if (publishedRecoveryOwned && existing?.integrityFailure) {
        bindPublishedRecoveryJournal(existing);
        return completedIntegrityFailureResult(existing.integrityFailure);
      }
    }
    currentOperation = 'git';
    currentOperationPath = plan.roots.execution;
    await revalidateArchiveGitPlan(plan, adapters, recoveryOwned);
    currentOperation = 'probe-git';
    await revalidateArchiveProbes(plan, adapters);
    currentOperation = 'source-inventory';
    currentOperationPath = plan.paths.active;
    let sourceNow: ArchiveTreeFingerprint;
    let sourceClaimedAtStart = false;
    try {
      sourceNow = await fingerprintArchiveTree(plan.paths.active, adapters);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        const completed = await readJournal(plan.paths.publishedJournal, adapters);
        if (
          completed &&
          completed.transactionId === plan.transactionId &&
          completed.planHash === plan.planHash &&
          (completed.phase === 'complete' ||
            (completed.phase === 'failed' &&
              completed.failure?.resumePhase === 'source-removed'))
        ) {
          bindPublishedRecoveryJournal(completed);
          currentOperation = 'accounting';
          currentOperationPath = plan.paths.final;
          if (completed.integrityFailure) {
            return completedIntegrityFailureResult(completed.integrityFailure);
          }
          try {
            await verifyCompletedTransaction(completed);
          } catch (error) {
            const accountingError =
              error instanceof ArchiveAccountingErrorLike ? error : undefined;
            const operation: ArchiveBlockerOperation = accountingError
              ? accountingError.operation.startsWith('evidence')
                ? 'evidence'
                : 'accounting'
              : currentOperation;
            const operationPath = accountingError?.path ?? currentOperationPath;
            const code = errorCode(error);
            const message = error instanceof Error ? error.message : String(error);
            const integrityFailure: ArchiveIntegrityFailure = {
              detectedAt: adapters.now().toISOString(),
              operation,
              path: operationPath,
              ...(code ? { code } : {}),
              message,
              safeAction: {
                kind: 'manual-recovery-required',
                guidance:
                  'Automatic archive resume is disabled because the completed archive failed integrity verification. ' +
                  `Preserve the published archive and journal, inspect ${operationPath}, restore the archive from a trusted source, and obtain operator verification before any further archive action.`,
              },
            };
            currentOperation = 'journal';
            currentOperationPath = journalPath;
            return persistCompletedIntegrityFailure(
              completed,
              integrityFailure
            );
          }
          if (completed.phase !== 'complete') {
            currentPhase = 'source-removed';
            currentOperation = 'journal';
            currentOperationPath = journalPath;
            await persistJournalPhase(journalPath, 'complete');
          }
          return {
            status: 'complete',
            transactionId: plan.transactionId,
            planHash: plan.planHash,
            change: plan.change,
            path: plan.paths.final,
            journalPath: plan.paths.publishedJournal,
            resumed: true,
            specsUpdated: Object.values(totals).some(value => value > 0),
            totals,
            ephemeraDiscarded: [...completed.ephemeraDisposed].sort(),
            ephemeraPreserved: plan.cleaner.effectivePreserve,
            blockers: [],
          };
        }
        if (
          completed &&
          completed.transactionId === plan.transactionId &&
          completed.planHash === plan.planHash &&
          ['delete-intent', 'claimed', 'removing', 'removed'].includes(
            completed.sourceProgress.state
          )
        ) {
          sourceClaimedAtStart = true;
          sourceNow = plan.sourceFingerprint!;
          resumed = true;
          finalReserved = true;
          published = (await readArchiveMarker(plan, adapters)) !== null;
          ownsRecoveryState = true;
          journalPath = plan.paths.publishedJournal;
          journalSnapshot = completed;
          ephemeraDisposed = [...completed.ephemeraDisposed];
          currentPhase =
            completed.phase === 'failed'
              ? completed.failure?.resumePhase ?? 'accounting-finalized'
              : completed.phase;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    if (
      !sourceClaimedAtStart &&
      (!plan.sourceFingerprint ||
        !archiveDeletionAuthorityMatches(sourceNow, plan.sourceFingerprint))
    ) {
      const drift = new Error('Active archive source changed after planning.');
      (drift as NodeJS.ErrnoException).code = 'ESTALE';
      throw drift;
    }

    currentOperation = 'stage';
    currentOperationPath = plan.paths.stage;
    const stageState = await pathExists(plan.paths.stage, adapters);
    const finalState = await pathExists(plan.paths.final, adapters);
    if (finalState === 'present') {
      currentOperation = 'publish';
      currentOperationPath = plan.paths.final;
      const existing = await readJournal(plan.paths.publishedJournal, adapters);
      if (
        !existing ||
        existing.transactionId !== plan.transactionId ||
        existing.planHash !== plan.planHash
      ) {
        const collision = new Error(
          `Unrelated archive target exists: ${plan.paths.final}; planned stage: ${plan.paths.stage}`
        );
        (collision as NodeJS.ErrnoException).code = 'EEXIST';
        throw collision;
      }
      resumed = true;
      journalSnapshot = existing;
      finalReserved = true;
      const marker = await readArchiveMarker(plan, adapters);
      published = marker !== null;
      if (marker) {
        const finalPayload = await fingerprintArchiveTree(plan.paths.final, adapters);
        const accountingIntent =
          existing.phaseFingerprints['accounting-finalized'];
        const matchesAccountingIntent =
          accountingIntent?.state === 'intent' &&
          archivePayloadFingerprintMatches(
            finalPayload,
            accountingIntent.expectedAfter
          );
        if (finalPayload.digest !== marker.payloadDigest &&
            !matchesAccountingIntent &&
            !phaseAtLeast(
              existing.phase === 'failed'
                ? existing.failure?.resumePhase ?? 'published'
                : existing.phase,
              'accounting-finalized'
            )) {
          const conflict = new Error(
            'Published archive payload no longer matches its commit marker.'
          );
          (conflict as NodeJS.ErrnoException).code = 'ESTALE';
          throw conflict;
        }
      }
      ownsRecoveryState = true;
      journalPath = plan.paths.publishedJournal;
      ephemeraDisposed = [...existing.ephemeraDisposed];
      currentPhase =
        existing.phase === 'failed'
          ? existing.failure?.resumePhase ?? (published ? 'published' : 'specs-applied')
          : existing.phase;
    } else if (stageState === 'present') {
      currentOperation = 'stage';
      currentOperationPath = plan.paths.stage;
      const existing = await readJournal(plan.paths.journal, adapters);
      if (
        !existing ||
        existing.transactionId !== plan.transactionId ||
        existing.planHash !== plan.planHash
      ) {
        const collision = new Error(
          `Unrelated archive stage exists: ${plan.paths.stage}; final target: ${plan.paths.final}`
        );
        (collision as NodeJS.ErrnoException).code = 'EEXIST';
        throw collision;
      }
      resumed = true;
      journalSnapshot = existing;
      ownsRecoveryState = true;
      ephemeraDisposed = [...existing.ephemeraDisposed];
      currentPhase =
        existing.phase === 'failed'
          ? existing.failure?.resumePhase ?? 'planned'
          : existing.phase;
    } else {
      await adapters.fs.mkdir(plan.paths.archiveParent, { recursive: true });
      await adapters.fs.mkdir(plan.paths.stage);
      ownsRecoveryState = true;
      currentOperation = 'journal';
      currentOperationPath = plan.paths.journal;
      await persistJournalPhase(plan.paths.journal, 'planned');
      currentPhase = 'planned';
    }

    if (resumed && currentPhase !== 'planned') {
      currentOperation = finalReserved ? 'publish' : 'stage';
      currentOperationPath = finalReserved ? plan.paths.final : plan.paths.stage;
      await verifyRecordedPayloadForResume();
    }
    if (journalSnapshot) {
      totals = totalsFromSpecProgress(plan, journalSnapshot);
      ephemeraDisposed = journalSnapshot.cleanerProgress
        .filter(
          progress =>
            progress.state === 'deleted' ||
            progress.state === 'deleted-after-intent'
        )
        .map(progress => progress.path)
        .sort();
    }

    if (!published && currentPhase === 'planned') {
      currentOperation = 'stage';
      currentOperationPath = plan.paths.stage;
      if (resumed) {
        // A failed copy or staged-tree verification can leave an arbitrary
        // partial payload. The matching transaction journal proves ownership,
        // so rebuild that engine-owned stage rather than merging into it.
        await adapters.fs.rm(plan.paths.stage, { recursive: true, force: false });
        await adapters.fs.mkdir(plan.paths.stage);
        currentOperation = 'journal';
        currentOperationPath = plan.paths.journal;
        journalSnapshot = null;
        await persistJournalPhase(plan.paths.journal, 'planned');
      }
      currentOperation = 'copy';
      currentOperationPath = plan.paths.stage;
      const beforeCopy = await fingerprintArchiveTree(plan.paths.stage, adapters);
      await recordIntentFingerprint(
        'payload-copied',
        'stage',
        beforeCopy,
        plan.sourceFingerprint!,
        plan.paths.journal
      );
      await copyArchivePayload(plan.paths.active, plan.paths.stage, adapters);
      const stagedFingerprint = await fingerprintArchiveTree(plan.paths.stage, adapters);
      if (
        !plan.sourceFingerprint ||
        !archivePayloadFingerprintMatches(stagedFingerprint, plan.sourceFingerprint)
      ) {
        const mismatch = new Error('Staged archive payload does not match the planned source.');
        (mismatch as NodeJS.ErrnoException).code = 'ESTALE';
        throw mismatch;
      }
      currentOperation = 'journal';
      currentOperationPath = plan.paths.journal;
      await recordVerifiedFingerprint(
        'payload-copied',
        'stage',
        plan.sourceFingerprint!,
        stagedFingerprint
      );
      await persistJournalPhase(plan.paths.journal, 'staged');
      currentPhase = 'staged';
    }

    if (!published) {
      if (!phaseAtLeast(currentPhase, 'handoff-finalized')) {
        const before = await fingerprintArchiveTree(plan.paths.stage, adapters);
        const expected = await projectStageTransform(projectionPlan =>
          applyStagedHandoff(projectionPlan, adapters)
        );
        await recordIntentFingerprint(
          'handoff-finalized',
          'stage',
          before,
          expected,
          plan.paths.journal
        );
        currentOperation = 'handoff';
        currentOperationPath = path.join(plan.paths.stage, 'handoff');
        await applyStagedHandoff(plan, adapters);
        currentOperation = 'journal';
        currentOperationPath = plan.paths.journal;
        const after = await fingerprintArchiveTree(plan.paths.stage, adapters);
        if (!archivePayloadFingerprintMatches(after, expected)) {
          const mismatch = new Error(
            'Handoff transform did not match its durable expected payload.'
          );
          (mismatch as NodeJS.ErrnoException).code = 'ESTALE';
          throw mismatch;
        }
        await recordVerifiedFingerprint(
          'handoff-finalized',
          'stage',
          before,
          after
        );
        await persistJournalPhase(plan.paths.journal, 'handoff-finalized');
        currentPhase = 'handoff-finalized';
      }
      if (!phaseAtLeast(currentPhase, 'evidence-finalized')) {
        const before = await fingerprintArchiveTree(plan.paths.stage, adapters);
        const expected = await projectStageTransform(async projectionPlan => {
          await finalizeStagedShipLog(projectionPlan, adapters);
          await captureArchiveQuality(projectionPlan.paths.stage, adapters);
        });
        await recordIntentFingerprint(
          'evidence-finalized',
          'stage',
          before,
          expected,
          plan.paths.journal
        );
        currentOperation = 'quality';
        currentOperationPath = path.join(plan.paths.stage, 'evidence');
        await finalizeStagedShipLog(plan, adapters);
        const quality = await captureArchiveQuality(plan.paths.stage, adapters);
        if (
          stableArchiveJson(quality.files) !==
          stableArchiveJson(plan.qualityInputs.map(input => input.path))
        ) {
          const mismatch = new Error(
            'Staged quality inventory differs from the immutable archive plan.'
          );
          (mismatch as NodeJS.ErrnoException).code = 'ESTALE';
          throw mismatch;
        }
        for (const input of plan.qualityInputs) {
          const absolute = path.join(plan.paths.stage, ...input.path.split('/'));
          if (adapters.sha256(await adapters.fs.readFile(absolute)) !== input.sha256) {
            const mismatch = new Error(
              `Staged quality input differs from the immutable archive plan: ${input.path}`
            );
            (mismatch as NodeJS.ErrnoException).code = 'ESTALE';
            throw mismatch;
          }
        }
        currentOperation = 'journal';
        currentOperationPath = plan.paths.journal;
        const after = await fingerprintArchiveTree(plan.paths.stage, adapters);
        if (!archivePayloadFingerprintMatches(after, expected)) {
          const mismatch = new Error(
            'Evidence transform did not match its durable expected payload.'
          );
          (mismatch as NodeJS.ErrnoException).code = 'ESTALE';
          throw mismatch;
        }
        await recordVerifiedFingerprint(
          'evidence-finalized',
          'stage',
          before,
          after
        );
        await persistJournalPhase(plan.paths.journal, 'evidence-finalized');
        currentPhase = 'evidence-finalized';
      }
      if (!phaseAtLeast(currentPhase, 'specs-applied')) {
        currentOperation = 'spec';
        currentOperationPath = plan.paths.active;
        if (!journalSnapshot) {
          throw new Error('Prepared spec actions require a durable journal.');
        }
        totals = await applySpecActions(
          plan,
          adapters,
          journalSnapshot,
          () => persistJournalPhase(plan.paths.journal, currentPhase)
        );
        currentOperation = 'journal';
        currentOperationPath = plan.paths.journal;
        await persistJournalPhase(plan.paths.journal, 'specs-applied');
        currentPhase = 'specs-applied';
      } else {
        totals = totalsFromSpecProgress(plan, journalSnapshot);
      }
      currentOperation = 'publish';
      currentOperationPath = plan.paths.final;
      if (!finalReserved) {
        await reserveArchiveDestination(plan.paths.final, adapters);
        finalReserved = true;
        published = false;
        journalPath = plan.paths.publishedJournal;
        const reservationStat = await adapters.fs.lstat(plan.paths.final);
        if (
          !reservationStat.isDirectory() ||
          reservationStat.isSymbolicLink()
        ) {
          throw staleArchiveObject(
            plan.paths.final,
            'Fresh archive reservation is not a real directory'
          );
        }
        const initialOccupants = await listReservedArchivePayloadPaths(
          plan.paths.final,
          adapters
        );
        if (initialOccupants.length > 0) {
          const conflict = new Error(
            `Fresh archive reservation is not empty: ${initialOccupants.join(', ')}`
          );
          (conflict as NodeJS.ErrnoException).code = 'EEXIST';
          throw conflict;
        }
        if (!journalSnapshot) {
          journalSnapshot = journalFor(
            plan,
            currentPhase,
            ephemeraDisposed,
            adapters
          );
        }
        journalSnapshot.finalReservation = {
          identity: archiveDeletionIdentity(reservationStat, 'directory'),
          entries: [],
        };
        currentOperation = 'journal';
        currentOperationPath = journalPath;
        await persistJournalPhase(journalPath, 'specs-applied');
      } else {
        if (!journalSnapshot) {
          throw new Error('Archive reservation recovery requires a durable journal.');
        }
        await assertOwnedArchiveReservation(plan, journalSnapshot, adapters);
      }

      currentOperation = 'copy';
      currentOperationPath = plan.paths.final;
      const stagedPayload = await fingerprintArchiveTree(plan.paths.stage, adapters);
      const beforeFinalCopy = await fingerprintArchiveTree(
        plan.paths.final,
        adapters
      );
      await recordIntentFingerprint(
        'final-reserved',
        'final',
        beforeFinalCopy,
        stagedPayload,
        journalPath
      );
      if (!journalSnapshot) {
        throw new Error('Archive reservation copy requires a durable journal.');
      }
      await copyArchivePayloadIntoReservation(
        plan,
        journalSnapshot,
        adapters,
        () => persistJournalPhase(journalPath, currentPhase)
      );
      const finalPayload = await fingerprintArchiveTree(plan.paths.final, adapters);
      if (!archivePayloadFingerprintMatches(finalPayload, stagedPayload)) {
        const mismatch = new Error(
          'Reserved archive payload does not match the verified stage.'
        );
        (mismatch as NodeJS.ErrnoException).code = 'ESTALE';
        throw mismatch;
      }
      await recordVerifiedFingerprint(
        'final-reserved',
        'final',
        stagedPayload,
        finalPayload
      );
      currentOperation = 'journal';
      currentOperationPath = journalPath;
      await persistJournalPhase(journalPath, 'specs-applied');

      currentOperation = 'publish';
      currentOperationPath = path.join(
        plan.paths.final,
        ARCHIVE_PUBLISHED_MARKER_FILENAME
      );
      await publishArchiveMarker(plan, finalPayload, adapters);
      published = true;
      currentOperation = 'journal';
      currentOperationPath = journalPath;
      await persistJournalPhase(journalPath, 'published');
      currentPhase = 'published';
    }

    for (const relativePath of plan.cleaner.effectiveDelete) {
      if (!journalSnapshot) {
        throw new Error('Archive cleaner requires a durable journal.');
      }
      const progress = journalSnapshot.cleanerProgress.find(
        entry => entry.path === relativePath
      );
      if (!progress) {
        throw new Error(`Archive cleaner progress is missing ${relativePath}.`);
      }
      if (
        progress.state === 'deleted' ||
        progress.state === 'deleted-after-intent'
      ) {
        if (!ephemeraDisposed.includes(relativePath)) {
          ephemeraDisposed.push(relativePath);
        }
        continue;
      }
      if (progress.state === 'already-absent') continue;
      currentOperation = 'cleaner-apply';
      currentOperationPath = path.join(plan.paths.ephemera, relativePath);
      const candidateState = await pathExists(currentOperationPath, adapters);
      if (progress.state === 'pending' && candidateState === 'absent') {
        progress.state = 'already-absent';
        await persistJournalPhase(journalPath, 'cleaner-progress');
        continue;
      }
      if (progress.state === 'delete-intent' && candidateState === 'absent') {
        progress.state = 'deleted-after-intent';
        if (!ephemeraDisposed.includes(relativePath)) {
          ephemeraDisposed.push(relativePath);
        }
        await persistJournalPhase(journalPath, 'cleaner-progress');
        currentPhase = 'cleaner-progress';
        continue;
      }
      if (progress.state === 'pending') {
        progress.state = 'delete-intent';
        await persistJournalPhase(journalPath, 'cleaner-progress');
      }
      const single = await classifySingleCleanerCandidate(plan, relativePath);
      const deleted = await adapters.applyEphemeraDeletion(
        plan.paths.ephemera,
        single
      );
      if (deleted.includes(relativePath)) {
        progress.state = 'deleted';
        if (!ephemeraDisposed.includes(relativePath)) {
          ephemeraDisposed.push(relativePath);
        }
      } else {
        progress.state = 'failed';
        progress.error = 'Cleaner did not report the planned candidate as deleted.';
        throw new Error(progress.error);
      }
      currentOperation = 'journal';
      currentOperationPath = journalPath;
      await persistJournalPhase(journalPath, 'cleaner-progress');
      currentPhase = 'cleaner-progress';
    }

    if (!phaseAtLeast(currentPhase, 'accounting-finalized')) {
      currentOperation = 'accounting';
      currentOperationPath = path.join(plan.paths.final, 'archive.json');
      const accounting = await adapters.resolveArchiveAccounting({
        changeName: plan.change,
        archivedDir: plan.paths.final,
        executionRoot: plan.roots.execution,
        planningRoot: plan.roots.planning,
        ephemeraDiscarded: ephemeraDisposed,
        handoffAbsorbed: handoffAccounting(plan),
        probes: plan.sidecar.probes,
        archivedAt: plan.createdAt,
        gitFacts: {
          codeCommit: plan.git.execution.codeCommit,
          planningBranch: plan.git.planning.branch,
          planningTreeState: plan.git.planning.treeState,
        },
      });
      const beforeAccounting = await fingerprintArchiveTree(
        plan.paths.final,
        adapters
      );
      const expectedAccounting = await projectAccountingTransform(accounting);
      await recordIntentFingerprint(
        'accounting-finalized',
        'final',
        beforeAccounting,
        expectedAccounting,
        journalPath
      );
      await adapters.writeArchiveJson(plan.paths.final, accounting);
      currentOperation = 'journal';
      currentOperationPath = journalPath;
      const accountingFingerprint = await fingerprintArchiveTree(
        plan.paths.final,
        adapters
      );
      if (
        !archivePayloadFingerprintMatches(
          accountingFingerprint,
          expectedAccounting
        )
      ) {
        const mismatch = new Error(
          'Accounting transform did not match its durable expected payload.'
        );
        (mismatch as NodeJS.ErrnoException).code = 'ESTALE';
        throw mismatch;
      }
      await recordVerifiedFingerprint(
        'accounting-finalized',
        'final',
        beforeAccounting,
        accountingFingerprint
      );
      await persistJournalPhase(journalPath, 'accounting-finalized');
      currentPhase = 'accounting-finalized';
    }

    currentOperation = 'source-remove';
    if (!journalSnapshot) {
      throw new Error('Archive source deletion requires a durable journal.');
    }
    const sourceQuarantine = journalSnapshot.sourceProgress.quarantine;
    const sourceClaimRoot = path.dirname(sourceQuarantine);
    if (!sourceClaimedAtStart) {
      const sourceBeforeRemove = await fingerprintArchiveTree(
        plan.paths.active,
        adapters
      );
      if (
        !plan.sourceFingerprint ||
        !archiveDeletionAuthorityMatches(
          sourceBeforeRemove,
          plan.sourceFingerprint
        )
      ) {
        const drift = new Error(
          'Active archive source changed before source-last removal.'
        );
        (drift as NodeJS.ErrnoException).code = 'ESTALE';
        throw drift;
      }
      journalSnapshot.sourceProgress.state = 'delete-intent';
      currentOperationPath = plan.paths.active;
      await persistJournalPhase(journalPath, 'accounting-finalized');
      try {
        await adapters.fs.mkdir(sourceClaimRoot);
      } catch (error) {
        if (
          errorCode(error) !== 'EEXIST' ||
          (await pathExists(sourceQuarantine, adapters)) === 'present'
        ) {
          throw error;
        }
      }
      await adapters.fs.rename(plan.paths.active, sourceQuarantine);
    }

    if (
      sourceClaimedAtStart &&
      journalSnapshot.sourceProgress.state === 'removing' &&
      (await pathExists(sourceQuarantine, adapters)) === 'absent'
    ) {
      journalSnapshot.sourceProgress.state = 'removed';
      await adapters.fs.rmdir(sourceClaimRoot).catch(error => {
        if (errorCode(error) !== 'ENOENT') throw error;
      });
      await persistJournalPhase(journalPath, 'source-removed');
    }
    if (journalSnapshot.sourceProgress.state !== 'removed') {
      currentOperationPath = sourceQuarantine;
      const claimed = await fingerprintArchiveTree(sourceQuarantine, adapters);
      if (
        !plan.sourceFingerprint ||
        !archiveDeletionAuthorityMatches(claimed, plan.sourceFingerprint)
      ) {
        journalSnapshot.sourceProgress.state = 'conflict';
        journalSnapshot.sourceProgress.error =
          'Claimed source does not match planned deletion authority.';
        await persistJournalPhase(journalPath, 'accounting-finalized');
        const conflict = new Error(
          `Claimed source identity mismatch; retained at ${sourceQuarantine}`
        );
        (conflict as NodeJS.ErrnoException).code = 'ESTALE';
        throw conflict;
      }
      journalSnapshot.sourceProgress.state = 'claimed';
      await persistJournalPhase(journalPath, 'accounting-finalized');
      journalSnapshot.sourceProgress.state = 'removing';
      await persistJournalPhase(journalPath, 'accounting-finalized');
      await removeClaimedArchiveTreeGuarded(
        sourceQuarantine,
        plan.sourceFingerprint,
        adapters
      );
      await adapters.fs.rmdir(sourceClaimRoot);
      journalSnapshot.sourceProgress.state = 'removed';
      await persistJournalPhase(journalPath, 'source-removed');
    }
    currentPhase = 'source-removed';
    await adapters.fs.rm(plan.paths.stage, {
      recursive: true,
      force: false,
    }).catch(error => {
      if (errorCode(error) !== 'ENOENT') throw error;
    });
    currentOperation = 'journal';
    currentOperationPath = journalPath;
    await persistJournalPhase(journalPath, 'complete');

    return {
      status: 'complete',
      transactionId: plan.transactionId,
      planHash: plan.planHash,
      change: plan.change,
      path: plan.paths.final,
      journalPath,
      resumed,
      specsUpdated: Object.values(totals).some(value => value > 0),
      totals,
      ephemeraDiscarded: [...ephemeraDisposed].sort(),
      ephemeraPreserved: plan.cleaner.effectivePreserve,
      blockers: [],
    };
  } catch (error) {
    const accountingError =
      error instanceof ArchiveAccountingErrorLike ? error : undefined;
    const resultOperation: ArchiveBlockerOperation = accountingError
      ? accountingError.operation.startsWith('evidence')
        ? 'evidence'
        : 'accounting'
      : currentOperation;
    const resultPath = accountingError?.path ?? currentOperationPath;
    const failure = {
      operation: accountingError?.operation ?? currentOperation,
      path: resultPath,
      ...(errorCode(error) ? { code: errorCode(error) } : {}),
      message: error instanceof Error ? error.message : String(error),
      resumePhase: currentPhase,
    };
    const retainedJournal = finalReserved
      ? plan.paths.publishedJournal
      : plan.paths.journal;
    if (ownsRecoveryState) {
      await persistJournalPhase(retainedJournal, 'failed', failure).catch(
        () => undefined
      );
    }
    totals = totalsFromSpecProgress(plan, journalSnapshot);
    if (journalSnapshot) {
      ephemeraDisposed = journalSnapshot.cleanerProgress
        .filter(
          progress =>
            progress.state === 'deleted' ||
            progress.state === 'deleted-after-intent'
        )
        .map(progress => progress.path)
        .sort();
    }
    return applyFailure(
      plan,
      retainedJournal,
      resumed,
      ephemeraDisposed,
      error,
      resultOperation,
      resultPath,
      totals
    );
  }
}
