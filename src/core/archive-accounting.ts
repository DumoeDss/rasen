/**
 * Fail-closed disposition accounting for finalized archive payloads.
 *
 * Only a confirmed non-Git root receives the documented null/clean values.
 * Evidence is recursively inventoried without following symlinks and the
 * ledger is atomically written and verified before active-source removal.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { evidenceDir } from './file-placement.js';
import { isConfirmedGitWorkTree } from './store/git.js';

const execFileAsync = promisify(execFile);

export interface EvidenceEntry {
  path: string;
  sha256: string;
}

export interface ProbeEntry {
  path: string;
  codeCommit: string;
}

export interface HandoffAbsorbedEntry {
  file: string;
  outcome: 'absorbed' | 'preserved';
}

export interface ResolveArchiveAccountingInput {
  changeName: string;
  archivedDir: string;
  executionRoot: string;
  planningRoot: string;
  ephemeraDiscarded: string[];
  handoffAbsorbed: HandoffAbsorbedEntry[] | null;
  probes: ProbeEntry[];
  archivedAt?: string;
  gitFacts?: {
    codeCommit: string | null;
    planningBranch: string | null;
    planningTreeState: 'clean' | 'dirty';
  };
}

export interface ArchiveAccounting {
  change: string;
  archivedAt: string;
  codeCommit: string | null;
  planningBranch: string | null;
  planningTreeState: 'clean' | 'dirty';
  evidence: EvidenceEntry[];
  probes: ProbeEntry[];
  handoffAbsorbed: HandoffAbsorbedEntry[] | null;
  ephemeraDiscarded: string[];
  missing: string[];
}

export const ARCHIVE_INPUT_SIDECAR_FILENAME = '.rasen-archive-input.json';

/**
 * Compatibility shape for callers that have not moved to the strict
 * `resolveArchiveSidecar` engine API yet.
 */
export interface ArchiveInputSidecar {
  schemaVersion?: number;
  change?: string;
  handoff?: {
    complete?: boolean;
    decisions?: Array<{ path: string; outcome: 'absorbed' | 'preserved' }>;
  };
  probes?: ProbeEntry[];
  handoffAbsorbed?: HandoffAbsorbedEntry[];
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

export class ArchiveAccountingError extends Error {
  readonly operation: string;
  readonly path: string;
  readonly code?: string;

  constructor(operation: string, target: string, error: unknown) {
    const code = errorCode(error);
    super(
      `${operation} failed for ${target}${code ? ` (${code})` : ''}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    this.name = 'ArchiveAccountingError';
    this.operation = operation;
    this.path = target;
    if (code) this.code = code;
  }
}

function sameFileIdentity(left: import('node:fs').Stats, right: import('node:fs').Stats): boolean {
  return (
    left.isFile() &&
    right.isFile() &&
    !left.isSymbolicLink() &&
    !right.isSymbolicLink() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

async function sha256File(absPath: string): Promise<string> {
  try {
    const before = await fs.lstat(absPath);
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new Error('Evidence entry must be a regular file.');
    }
    const content = await fs.readFile(absPath);
    const after = await fs.lstat(absPath);
    if (!sameFileIdentity(before, after)) {
      const drift = new Error('Evidence entry changed while it was being hashed.');
      (drift as NodeJS.ErrnoException).code = 'ESTALE';
      throw drift;
    }
    return createHash('sha256').update(content).digest('hex');
  } catch (error) {
    if (error instanceof ArchiveAccountingError) throw error;
    throw new ArchiveAccountingError('evidence-hash', absPath, error);
  }
}

export async function hashArchiveEvidence(archivedDir: string): Promise<EvidenceEntry[]> {
  const root = evidenceDir(archivedDir);
  const entries: EvidenceEntry[] = [];

  async function walk(directory: string, prefix: string): Promise<void> {
    let dirents: import('node:fs').Dirent[];
    try {
      dirents = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (!prefix && errorCode(error) === 'ENOENT') return;
      throw new ArchiveAccountingError('evidence-readdir', directory, error);
    }
    dirents.sort((left, right) => left.name.localeCompare(right.name));
    for (const dirent of dirents) {
      const absolute = path.join(directory, dirent.name);
      let stat: import('node:fs').Stats;
      try {
        stat = await fs.lstat(absolute);
      } catch (error) {
        throw new ArchiveAccountingError('evidence-lstat', absolute, error);
      }
      if (stat.isSymbolicLink()) {
        throw new ArchiveAccountingError(
          'evidence-containment',
          absolute,
          new Error('Evidence symlinks are not permitted.')
        );
      }
      if (stat.isFile()) {
        const relative = prefix ? `${prefix}/${dirent.name}` : dirent.name;
        entries.push({
          path: `evidence/${relative}`,
          sha256: await sha256File(absolute),
        });
      } else if (stat.isDirectory()) {
        await walk(absolute, prefix ? `${prefix}/${dirent.name}` : dirent.name);
      } else {
        throw new ArchiveAccountingError(
          'evidence-lstat',
          absolute,
          new Error('Evidence contains a non-regular entry.')
        );
      }
    }
  }

  await walk(root, '');
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return entries;
}

async function confirmedGitState(root: string): Promise<'git' | 'non-git'> {
  const state = await isConfirmedGitWorkTree(root);
  if (state === true) return 'git';
  if (state === false) return 'non-git';
  throw new ArchiveAccountingError(
    'git-work-tree',
    root,
    new Error('Git state could not be confirmed.')
  );
}

async function gitExec(root: string, args: string[], operation: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, ...args], {
      windowsHide: true,
    });
    return stdout.trim();
  } catch (error) {
    throw new ArchiveAccountingError(operation, root, error);
  }
}

async function resolveCodeCommit(executionRoot: string): Promise<string | null> {
  if ((await confirmedGitState(executionRoot)) === 'non-git') return null;
  const commit = await gitExec(
    executionRoot,
    ['rev-parse', '--verify', 'HEAD^{commit}'],
    'git-code-commit'
  );
  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    throw new ArchiveAccountingError(
      'git-code-commit',
      executionRoot,
      new Error('Git returned a non-full commit id.')
    );
  }
  return commit.toLowerCase();
}

async function resolvePlanningGitFacts(
  planningRoot: string
): Promise<{ branch: string | null; treeState: 'clean' | 'dirty' }> {
  if ((await confirmedGitState(planningRoot)) === 'non-git') {
    return { branch: null, treeState: 'clean' };
  }
  const [branch, status] = await Promise.all([
    gitExec(planningRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], 'git-planning-branch'),
    gitExec(planningRoot, ['status', '--porcelain'], 'git-planning-status'),
  ]);
  return {
    branch: branch === 'HEAD' ? null : branch,
    treeState: status.length > 0 ? 'dirty' : 'clean',
  };
}

/**
 * The missing-evidence names, shared by the v1 accounting record and the
 * Archive v2 record so both writers report the same absences. Exported rather
 * than duplicated: two independent copies of this rule would drift.
 */
export function resolveMissingEvidenceNames(
  evidenceEntries: readonly EvidenceEntry[]
): string[] {
  const paths = new Set(evidenceEntries.map(entry => entry.path));
  const missing: string[] = [];
  if (!paths.has('evidence/ship-log.md')) missing.push('ship-log');
  if (!paths.has('evidence/verification-report.md')) missing.push('verification-report');
  return missing;
}

function resolveMissing(evidenceEntries: EvidenceEntry[]): string[] {
  return resolveMissingEvidenceNames(evidenceEntries);
}

/**
 * Legacy read-only helper. It deliberately distinguishes ENOENT from every
 * other failure; new archive code validates the value with
 * `resolveArchiveSidecar` before apply.
 */
export async function readArchiveInputSidecar(
  changeDir: string
): Promise<ArchiveInputSidecar | null> {
  const sidecarPath = path.join(changeDir, ARCHIVE_INPUT_SIDECAR_FILENAME);
  let content: string;
  try {
    content = await fs.readFile(sidecarPath, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw new ArchiveAccountingError('sidecar-read', sidecarPath, error);
  }
  try {
    return JSON.parse(content) as ArchiveInputSidecar;
  } catch (error) {
    throw new ArchiveAccountingError('sidecar-parse', sidecarPath, error);
  }
}

/**
 * Compatibility helper retained for external imports. The engine itself
 * never mutates the active sidecar; it excludes the control file while
 * copying the staged payload and removes the active directory source-last.
 */
export async function removeArchiveInputSidecar(_changeDir: string): Promise<void> {
  return;
}

export async function resolveArchiveAccounting(
  input: ResolveArchiveAccountingInput
): Promise<ArchiveAccounting> {
  const evidencePromise = hashArchiveEvidence(input.archivedDir);
  const codeCommitPromise = input.gitFacts
    ? Promise.resolve(input.gitFacts.codeCommit)
    : resolveCodeCommit(input.executionRoot);
  const planningFactsPromise = input.gitFacts
    ? Promise.resolve({
        branch: input.gitFacts.planningBranch,
        treeState: input.gitFacts.planningTreeState,
      })
    : resolvePlanningGitFacts(input.planningRoot);
  const [codeCommit, planningFacts, evidence] = await Promise.all([
    codeCommitPromise,
    planningFactsPromise,
    evidencePromise,
  ]);

  return {
    change: input.changeName,
    archivedAt: input.archivedAt ?? new Date().toISOString(),
    codeCommit,
    planningBranch: planningFacts.branch,
    planningTreeState: planningFacts.treeState,
    evidence,
    probes: [...input.probes].sort((left, right) => left.path.localeCompare(right.path)),
    handoffAbsorbed:
      input.handoffAbsorbed === null
        ? null
        : [...input.handoffAbsorbed].sort((left, right) => left.file.localeCompare(right.file)),
    ephemeraDiscarded: [...input.ephemeraDiscarded].sort(),
    missing: resolveMissing(evidence),
  };
}

function orderedAccounting(accounting: ArchiveAccounting): Record<string, unknown> {
  return {
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
}

export function serializeArchiveAccounting(accounting: ArchiveAccounting): string {
  return `${JSON.stringify(orderedAccounting(accounting), null, 2)}\n`;
}

function accountingEquals(left: ArchiveAccounting, right: unknown): boolean {
  return (
    typeof right === 'object' &&
    right !== null &&
    JSON.stringify(orderedAccounting(left)) === JSON.stringify(right)
  );
}

export async function verifyArchiveAccounting(
  archivedDir: string,
  expected: ArchiveAccounting
): Promise<void> {
  const ledgerPath = path.join(archivedDir, 'archive.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(ledgerPath, 'utf8'));
  } catch (error) {
    throw new ArchiveAccountingError('archive-json-read', ledgerPath, error);
  }
  if (!accountingEquals(expected, parsed)) {
    throw new ArchiveAccountingError(
      'archive-json-verify',
      ledgerPath,
      new Error('Parsed ledger differs from planned accounting.')
    );
  }
  const actualEvidence = await hashArchiveEvidence(archivedDir);
  if (JSON.stringify(actualEvidence) !== JSON.stringify(expected.evidence)) {
    throw new ArchiveAccountingError(
      'archive-json-evidence-verify',
      ledgerPath,
      new Error('Finalized evidence hashes do not match archive.json.')
    );
  }
}

export function archiveAccountingTemporaryPath(
  archivedDir: string,
  content: string
): string {
  const digest = createHash('sha256').update(content, 'utf8').digest('hex');
  return path.join(archivedDir, `.archive.json.rasen-intent-${digest}`);
}

export function archiveAccountingOwnershipError(message: string): Error {
  const error = new Error(message);
  (error as NodeJS.ErrnoException).code =
    'archive_accounting_ownership_unverified';
  return error;
}

export interface ArchiveAccountingTemporaryIdentity {
  readonly dev: string;
  readonly ino: string;
  readonly mode: string;
  readonly size: string;
  readonly mtimeNs: string;
  readonly ctimeNs: string;
}

export function accountingIdentity(stat: {
  dev: number | bigint;
  ino: number | bigint;
  mode: number | bigint;
  size: number | bigint;
  mtimeMs: number | bigint;
  ctimeMs: number | bigint;
  mtimeNs?: bigint;
  ctimeNs?: bigint;
}): ArchiveAccountingTemporaryIdentity {
  const mtimeNs =
    stat.mtimeNs ?? BigInt(Math.trunc(Number(stat.mtimeMs) * 1e6));
  const ctimeNs =
    stat.ctimeNs ?? BigInt(Math.trunc(Number(stat.ctimeMs) * 1e6));
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: String(stat.mode),
    size: String(stat.size),
    mtimeNs: String(mtimeNs),
    ctimeNs: String(ctimeNs),
  };
}

export function sameAccountingIdentity(
  left: ArchiveAccountingTemporaryIdentity,
  right: ArchiveAccountingTemporaryIdentity
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function writeArchiveJson(
  archivedDir: string,
  accounting: ArchiveAccounting,
  expectedTemporaryIdentity?: ArchiveAccountingTemporaryIdentity
): Promise<void> {
  const ledgerPath = path.join(archivedDir, 'archive.json');
  const content = serializeArchiveAccounting(accounting);
  const tempPath = archiveAccountingTemporaryPath(archivedDir, content);
  let handle: FileHandle | undefined;
  try {
    let temporary: string | null;
    try {
      const stat = await fs.lstat(tempPath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw archiveAccountingOwnershipError(
          'the deterministic accounting intent is not a real file'
        );
      }
      temporary = await fs.readFile(tempPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      temporary = null;
    }
    if (
      temporary !== null &&
      (expectedTemporaryIdentity === undefined ||
        !sameAccountingIdentity(
          accountingIdentity(await fs.lstat(tempPath, { bigint: true })),
          expectedTemporaryIdentity
        ))
    ) {
      throw archiveAccountingOwnershipError(
        'the deterministic accounting intent lacks matching journal identity'
      );
    }
    if (temporary !== null && temporary !== content) {
      throw archiveAccountingOwnershipError(
        'the deterministic accounting intent contains disagreeing bytes'
      );
    }
    if (temporary === null) {
      handle = await fs.open(tempPath, 'wx', 0o600);
      await handle.writeFile(content, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
    }
    try {
      await fs.link(tempPath, ledgerPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const [ledger, temporaryStat] = await Promise.all([
        fs.lstat(ledgerPath),
        fs.lstat(tempPath),
      ]);
      if (
        !ledger.isFile() ||
        ledger.isSymbolicLink() ||
        !sameAccountingIdentity(
          accountingIdentity(ledger),
          accountingIdentity(temporaryStat)
        )
      ) {
        throw archiveAccountingOwnershipError(
          'the existing archive ledger is not the journal-owned temporary inode'
        );
      }
    }
    await verifyArchiveAccounting(archivedDir, accounting);
    await fs.unlink(tempPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  } catch (error) {
    await handle?.close().catch(() => undefined);
    throw new ArchiveAccountingError('archive-json-write', ledgerPath, error);
  }
}
