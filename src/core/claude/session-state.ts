import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import { FileSystemUtils } from '../../utils/file-system.js';
import { getGlobalDataDir } from '../global-config.js';
import { isNodeErrorCode } from '../file-state.js';

const fs = nodeFs.promises;
const SESSION_STATE_VERSION = 1;
const CLAIM_TOKEN_VERSION = 2;
const WORKER_TOKEN_VERSION = 1;

interface ClaudeSessionRecord {
  version: typeof SESSION_STATE_VERSION;
  sessionId: string;
  cwd: string;
  createdAt: string;
}

interface ClaudeSessionClaimToken {
  version: typeof CLAIM_TOKEN_VERSION;
  bridgePid: number;
  nonce: string;
  createdAt: string;
}

interface ClaudeSessionWorkerToken {
  version: typeof WORKER_TOKEN_VERSION;
  nonce: string;
  rootPid: number;
  createdAt: string;
}

export interface ClaudeSessionStateOptions {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  processTreeProbe?: (rootPid: number) => boolean;
}

export interface ClaudeSessionWriterClaim {
  sessionId: string;
  cwd: string;
  bindWorker: (rootPid: number) => void;
  release: () => Promise<void>;
}

export class ClaudeSessionBusyError extends Error {
  constructor(sessionId: string) {
    super(`Claude session "${sessionId}" already has an active writer.`);
    this.name = 'ClaudeSessionBusyError';
  }
}

export class ClaudeSessionCwdMismatchError extends Error {
  constructor(
    sessionId: string,
    public readonly recordedCwd: string,
    public readonly requestedCwd: string
  ) {
    super(
      `Claude session "${sessionId}" was created in "${recordedCwd}", not "${requestedCwd}".`
    );
    this.name = 'ClaudeSessionCwdMismatchError';
  }
}

export class ClaudeSessionStateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ClaudeSessionStateError';
  }
}

function sessionKey(sessionId: string): string {
  return createHash('sha256').update(sessionId, 'utf8').digest('hex');
}

export function getClaudeSessionStateDir(
  options: ClaudeSessionStateOptions = {}
): string {
  return (
    options.stateDir ??
    path.join(getGlobalDataDir({ env: options.env }), 'claude-sessions')
  );
}

export function getClaudeSessionStatePaths(
  sessionId: string,
  options: ClaudeSessionStateOptions = {}
): { recordPath: string; writerPath: string } {
  const root = getClaudeSessionStateDir(options);
  const key = sessionKey(sessionId);
  return {
    recordPath: path.join(root, `${key}.json`),
    writerPath: path.join(root, `${key}.writer.lock`),
  };
}

function canonicalizeCwd(cwd: string): string {
  return FileSystemUtils.canonicalizeExistingPath(cwd);
}

function sameCwd(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    return true;
  }
}

function windowsProcessTreeIsAlive(rootPid: number): boolean {
  const snapshot = spawnSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$ErrorActionPreference = "Stop"; @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId) | ConvertTo-Json -Compress',
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
      timeout: 5_000,
      maxBuffer: 8 * 1024 * 1024,
    }
  );
  if (snapshot.error || snapshot.status !== 0 || !snapshot.stdout.trim()) {
    // Failure to enumerate is uncertainty, not proof that the tree is dead.
    return true;
  }

  try {
    const parsed = JSON.parse(snapshot.stdout.replace(/^\uFEFF/, '')) as
      | { ProcessId?: unknown; ParentProcessId?: unknown }
      | Array<{ ProcessId?: unknown; ParentProcessId?: unknown }>;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const descendants = new Map<number, number[]>();
    for (const row of rows) {
      const pid = Number(row.ProcessId);
      const parentPid = Number(row.ParentProcessId);
      if (!Number.isInteger(pid) || !Number.isInteger(parentPid)) continue;
      const children = descendants.get(parentPid) ?? [];
      children.push(pid);
      descendants.set(parentPid, children);
    }

    const pending = [rootPid];
    const seen = new Set<number>(pending);
    while (pending.length > 0) {
      const parentPid = pending.pop()!;
      for (const childPid of descendants.get(parentPid) ?? []) {
        if (seen.has(childPid)) continue;
        return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}

function processTreeIsAlive(
  rootPid: number,
  options: ClaudeSessionStateOptions
): boolean {
  if (options.processTreeProbe) return options.processTreeProbe(rootPid);
  if (process.platform !== 'win32') {
    try {
      // Claude workers are detached process-group leaders on POSIX. Probe the
      // whole group so a surviving descendant keeps the session busy even if
      // the original CLI process has exited.
      process.kill(-rootPid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return true;
    }
  } else if (windowsProcessTreeIsAlive(rootPid)) {
    return true;
  }
  return pidIsAlive(rootPid);
}

function parseClaimToken(content: string): ClaudeSessionClaimToken | undefined {
  try {
    const parsed = JSON.parse(content) as Partial<ClaudeSessionClaimToken>;
    if (
      parsed.version !== CLAIM_TOKEN_VERSION ||
      !Number.isInteger(parsed.bridgePid) ||
      (parsed.bridgePid ?? 0) <= 0 ||
      typeof parsed.nonce !== 'string' ||
      !parsed.nonce ||
      typeof parsed.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.createdAt))
    ) {
      return undefined;
    }
    return parsed as ClaudeSessionClaimToken;
  } catch {
    return undefined;
  }
}

function parseWorkerToken(
  content: string,
  expectedNonce: string
): ClaudeSessionWorkerToken | undefined {
  try {
    const parsed = JSON.parse(content) as Partial<ClaudeSessionWorkerToken>;
    if (
      parsed.version !== WORKER_TOKEN_VERSION ||
      parsed.nonce !== expectedNonce ||
      !Number.isInteger(parsed.rootPid) ||
      (parsed.rootPid ?? 0) <= 0 ||
      typeof parsed.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.createdAt))
    ) {
      return undefined;
    }
    return parsed as ClaudeSessionWorkerToken;
  } catch {
    return undefined;
  }
}

function workerTokenPath(writerPath: string, nonce: string): string {
  return path.join(
    path.dirname(writerPath),
    `.${path.basename(writerPath)}.${nonce}.worker`
  );
}

function recoveryTombstonePath(writerPath: string, nonce: string): string {
  return path.join(
    path.dirname(writerPath),
    `.${path.basename(writerPath)}.${nonce}.recovered`
  );
}

async function readWorkerToken(
  writerPath: string,
  owner: ClaudeSessionClaimToken
): Promise<ClaudeSessionWorkerToken | undefined> {
  try {
    return parseWorkerToken(
      await fs.readFile(workerTokenPath(writerPath, owner.nonce), 'utf8'),
      owner.nonce
    );
  } catch {
    return undefined;
  }
}

async function claimIsLiveOrUncertain(
  writerPath: string,
  owner: ClaudeSessionClaimToken,
  options: ClaudeSessionStateOptions
): Promise<boolean> {
  if (pidIsAlive(owner.bridgePid)) return true;

  const worker = await readWorkerToken(writerPath, owner);
  if (!worker) {
    // The bridge may have died after spawn but before publishing the worker
    // root. The runner withholds prompt stdin until that publication, so this
    // phase cannot have started a turn, but we still fail closed: without a
    // durable root PID there is no process tree we can prove dead.
    return true;
  }
  return processTreeIsAlive(worker.rootPid, options);
}

async function reclaimDeadClaimOnce(
  writerPath: string,
  observedContent: string,
  owner: ClaudeSessionClaimToken
): Promise<boolean> {
  const tombstonePath = recoveryTombstonePath(writerPath, owner.nonce);
  try {
    // One immutable tombstone elects exactly one reclaimer for this owner
    // generation. It is intentionally retained: a late contender that saw
    // the old token can never become a second reclaimer and displace the
    // replacement live token.
    await fs.writeFile(
      tombstonePath,
      `${JSON.stringify({
        version: 1,
        pid: process.pid,
        createdAt: new Date().toISOString(),
      })}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 }
    );
  } catch (error) {
    if (!isNodeErrorCode(error, 'EEXIST')) {
      throw new ClaudeSessionStateError(
        'Unable to serialize stale Claude session claim recovery.',
        { cause: error }
      );
    }
    return false;
  }

  let current: string;
  try {
    current = await fs.readFile(writerPath, 'utf8');
  } catch {
    return false;
  }
  if (current !== observedContent) return false;

  // A valid owner generation can only release its own token while either its
  // bridge or worker tree is alive. Both were proven dead immediately before
  // this call, and the generation tombstone excludes every competing stale
  // reclaimer. A dead owner generation cannot transition back to live.
  await fs.unlink(writerPath);
  await fs
    .unlink(workerTokenPath(writerPath, owner.nonce))
    .catch(() => undefined);
  return true;
}

async function createAtomicClaim(
  writerPath: string,
  sessionId: string,
  options: ClaudeSessionStateOptions
): Promise<string> {
  const root = path.dirname(writerPath);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });

  for (;;) {
    const token: ClaudeSessionClaimToken = {
      version: CLAIM_TOKEN_VERSION,
      bridgePid: process.pid,
      nonce: randomBytes(16).toString('hex'),
      createdAt: new Date().toISOString(),
    };
    const tokenText = `${JSON.stringify(token)}\n`;
    const candidatePath = path.join(
      root,
      `.${path.basename(writerPath)}.${process.pid}.${token.nonce}.candidate`
    );

    try {
      await fs.writeFile(candidatePath, tokenText, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      try {
        // Hard-link creation is atomic and never replaces an existing path.
        // Unlike open-then-write, contenders can never observe a half-written
        // owner token.
        await fs.link(candidatePath, writerPath);
        return tokenText;
      } catch (error) {
        if (!isNodeErrorCode(error, 'EEXIST')) {
          throw new ClaudeSessionStateError(
            `Unable to create the writer claim for Claude session "${sessionId}".`,
            { cause: error }
          );
        }
      }
    } finally {
      await fs.unlink(candidatePath).catch(() => undefined);
    }

    let observedContent: string;
    try {
      observedContent = await fs.readFile(writerPath, 'utf8');
    } catch (error) {
      if (isNodeErrorCode(error, 'ENOENT')) continue;
      throw new ClaudeSessionStateError(
        `Unable to inspect the writer claim for Claude session "${sessionId}".`,
        { cause: error }
      );
    }

    const owner = parseClaimToken(observedContent);
    // Invalid/legacy tokens do not identify the actual worker tree and are
    // therefore not safely reclaimable. Fail closed instead of guessing.
    if (
      owner &&
      !(await claimIsLiveOrUncertain(writerPath, owner, options)) &&
      (await reclaimDeadClaimOnce(
        writerPath,
        observedContent,
        owner
      ))
    ) {
      continue;
    }
    throw new ClaudeSessionBusyError(sessionId);
  }
}

async function releaseAtomicClaim(
  writerPath: string,
  tokenText: string,
  nonce: string
): Promise<void> {
  try {
    const current = await fs.readFile(writerPath, 'utf8');
    if (current !== tokenText) return;
    await fs.unlink(writerPath);
    await fs.unlink(workerTokenPath(writerPath, nonce)).catch(() => undefined);
  } catch {
    // Missing/unreadable means ownership cannot be proven. Never remove a
    // path that may now belong to another writer.
  }
}

function bindWorkerToClaim(
  writerPath: string,
  tokenText: string,
  nonce: string,
  rootPid: number
): void {
  if (!Number.isInteger(rootPid) || rootPid <= 0) {
    throw new ClaudeSessionStateError(
      'Claude worker did not expose a valid process-tree root PID.'
    );
  }

  let current: string;
  try {
    current = nodeFs.readFileSync(writerPath, 'utf8');
  } catch (error) {
    throw new ClaudeSessionStateError(
      'Unable to verify Claude session ownership before binding its worker tree.',
      { cause: error }
    );
  }
  if (current !== tokenText) {
    throw new ClaudeSessionStateError(
      'Claude session ownership changed before its worker tree was bound.'
    );
  }

  const workerPath = workerTokenPath(writerPath, nonce);
  const workerToken: ClaudeSessionWorkerToken = {
    version: WORKER_TOKEN_VERSION,
    nonce,
    rootPid,
    createdAt: new Date().toISOString(),
  };
  const workerText = `${JSON.stringify(workerToken)}\n`;
  const candidatePath = `${workerPath}.${process.pid}.${randomBytes(8).toString('hex')}.candidate`;

  try {
    nodeFs.writeFileSync(candidatePath, workerText, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    try {
      nodeFs.linkSync(candidatePath, workerPath);
    } catch (error) {
      if (
        isNodeErrorCode(error, 'EEXIST') &&
        nodeFs.readFileSync(workerPath, 'utf8') === workerText
      ) {
        return;
      }
      throw error;
    }
  } catch (error) {
    throw new ClaudeSessionStateError(
      'Unable to bind the Claude worker process tree to its session claim.',
      { cause: error }
    );
  } finally {
    try {
      nodeFs.unlinkSync(candidatePath);
    } catch {
      // The candidate may already be absent after a failed create.
    }
  }
}

function parseSessionRecord(
  content: string,
  expectedSessionId: string
): ClaudeSessionRecord {
  try {
    const parsed = JSON.parse(content) as Partial<ClaudeSessionRecord>;
    if (
      parsed.version !== SESSION_STATE_VERSION ||
      parsed.sessionId !== expectedSessionId ||
      typeof parsed.cwd !== 'string' ||
      !path.isAbsolute(parsed.cwd) ||
      typeof parsed.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.createdAt))
    ) {
      throw new Error('invalid record shape');
    }
    return parsed as ClaudeSessionRecord;
  } catch (error) {
    throw new ClaudeSessionStateError(
      `Claude session state for "${expectedSessionId}" is invalid.`,
      { cause: error }
    );
  }
}

async function bindOrValidateCwd(
  recordPath: string,
  sessionId: string,
  requestedCwd: string
): Promise<void> {
  try {
    const existing = parseSessionRecord(
      await fs.readFile(recordPath, 'utf8'),
      sessionId
    );
    if (!sameCwd(existing.cwd, requestedCwd)) {
      throw new ClaudeSessionCwdMismatchError(
        sessionId,
        existing.cwd,
        requestedCwd
      );
    }
    return;
  } catch (error) {
    if (!isNodeErrorCode(error, 'ENOENT')) throw error;
  }

  const record: ClaudeSessionRecord = {
    version: SESSION_STATE_VERSION,
    sessionId,
    cwd: requestedCwd,
    createdAt: new Date().toISOString(),
  };
  try {
    await fs.writeFile(recordPath, `${JSON.stringify(record)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (isNodeErrorCode(error, 'EEXIST')) {
      const existing = parseSessionRecord(
        await fs.readFile(recordPath, 'utf8'),
        sessionId
      );
      if (!sameCwd(existing.cwd, requestedCwd)) {
        throw new ClaudeSessionCwdMismatchError(
          sessionId,
          existing.cwd,
          requestedCwd
        );
      }
      return;
    }
    throw new ClaudeSessionStateError(
      `Unable to record the working directory for Claude session "${sessionId}".`,
      { cause: error }
    );
  }
}

export async function bindClaudeSessionCwd(
  sessionId: string,
  cwd: string,
  options: ClaudeSessionStateOptions = {}
): Promise<string> {
  const canonicalCwd = canonicalizeCwd(cwd);
  const { recordPath } = getClaudeSessionStatePaths(sessionId, options);
  await fs.mkdir(path.dirname(recordPath), {
    recursive: true,
    mode: 0o700,
  });
  await bindOrValidateCwd(recordPath, sessionId, canonicalCwd);
  return canonicalCwd;
}

/**
 * Atomically claims the sole cross-process writer for one exact Claude
 * session and binds/validates that session's canonical working directory.
 */
export async function claimClaudeSessionWriter(
  sessionId: string,
  cwd: string,
  options: ClaudeSessionStateOptions = {}
): Promise<ClaudeSessionWriterClaim> {
  const canonicalCwd = canonicalizeCwd(cwd);
  const { recordPath, writerPath } = getClaudeSessionStatePaths(
    sessionId,
    options
  );
  await fs.mkdir(path.dirname(recordPath), {
    recursive: true,
    mode: 0o700,
  });
  await bindOrValidateCwd(recordPath, sessionId, canonicalCwd);
  const tokenText = await createAtomicClaim(writerPath, sessionId, options);
  const token = parseClaimToken(tokenText);
  if (!token) {
    throw new ClaudeSessionStateError(
      `Unable to parse the writer claim for Claude session "${sessionId}".`
    );
  }
  let released = false;

  const bindWorker = (rootPid: number) => {
    if (released) {
      throw new ClaudeSessionStateError(
        `Claude session "${sessionId}" writer claim was already released.`
      );
    }
    bindWorkerToClaim(writerPath, tokenText, token.nonce, rootPid);
  };

  const release = async () => {
    if (released) return;
    released = true;
    await releaseAtomicClaim(writerPath, tokenText, token.nonce);
  };

  return { sessionId, cwd: canonicalCwd, bindWorker, release };
}

export async function isClaudeSessionWriterClaimed(
  sessionId: string,
  options: ClaudeSessionStateOptions = {}
): Promise<boolean> {
  const { writerPath } = getClaudeSessionStatePaths(sessionId, options);
  try {
    const owner = parseClaimToken(await fs.readFile(writerPath, 'utf8'));
    return owner ? claimIsLiveOrUncertain(writerPath, owner, options) : true;
  } catch (error) {
    return !isNodeErrorCode(error, 'ENOENT');
  }
}
