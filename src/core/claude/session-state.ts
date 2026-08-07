import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import { FileSystemUtils } from '../../utils/file-system.js';
import { getGlobalDataDir } from '../global-config.js';
import { isNodeErrorCode } from '../file-state.js';

const fs = nodeFs.promises;
const SESSION_STATE_VERSION = 1;
const CLAIM_TOKEN_VERSION = 3;
const WORKER_TOKEN_VERSION = 2;

export type ProcessInstanceInspection =
  | 'same'
  | 'different'
  | 'absent'
  | 'uncertain';

export interface ProcessInstanceProbe {
  capture(pid: number): string | undefined;
  inspect(pid: number, expectedProcessInstanceId: string): ProcessInstanceInspection;
}

interface ClaudeSessionRecord {
  version: typeof SESSION_STATE_VERSION;
  sessionId: string;
  cwd: string;
  createdAt: string;
}

interface ClaudeSessionClaimToken {
  version: typeof CLAIM_TOKEN_VERSION;
  bridgePid: number;
  bridgeProcessInstanceId: string;
  nonce: string;
  createdAt: string;
  /** Only this mode proves that no capable worker exists before bind. */
  admission?: 'supervised';
}

interface ClaudeSessionWorkerToken {
  version: typeof WORKER_TOKEN_VERSION;
  nonce: string;
  rootPid: number;
  processInstanceId: string;
  createdAt: string;
}

export interface ClaudeSessionStateOptions {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  processTreeProbe?: (rootPid: number) => boolean;
  processInstanceProbe?: ProcessInstanceProbe;
  platform?: NodeJS.Platform;
  supervisedAdmission?: boolean;
}

export interface ClaudeSessionWriterClaim {
  sessionId: string;
  cwd: string;
  ownerToken: string;
  bindWorker: (rootPid: number) => string;
  inspectWorker: (rootPid: number, processInstanceId: string) => ProcessInstanceInspection;
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
  if ((options.platform ?? process.platform) !== 'win32') {
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
      typeof parsed.bridgeProcessInstanceId !== 'string' ||
      !parsed.bridgeProcessInstanceId ||
      typeof parsed.nonce !== 'string' ||
      !parsed.nonce ||
      typeof parsed.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      (parsed.admission !== undefined && parsed.admission !== 'supervised')
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
      typeof parsed.processInstanceId !== 'string' ||
      !parsed.processInstanceId ||
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
  const bridge = instanceProbe(options).inspect(
    owner.bridgePid,
    owner.bridgeProcessInstanceId
  );
  if (bridge === 'same' || bridge === 'uncertain') return true;

  const worker = await readWorkerToken(writerPath, owner);
  if (!worker) {
    // The admitted-spawn contract starts only an inert supervisor before the
    // worker token is committed. That supervisor cannot activate the backend
    // after its bridge dies because its private activation pipe closes. The
    // exact no-worker claim is therefore a provable pre-spawn state.
    return owner.admission !== 'supervised';
  }
  const workerInstance = instanceProbe(options).inspect(
    worker.rootPid,
    worker.processInstanceId
  );
  if (workerInstance === 'different') return false;
  if (workerInstance === 'uncertain') return true;
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
    const bridgeProcessInstanceId = instanceProbe(options).capture(process.pid);
    if (!bridgeProcessInstanceId) {
      throw new ClaudeSessionStateError(
        'Unable to capture the exact writer process-start identity.'
      );
    }
    const token: ClaudeSessionClaimToken = {
      version: CLAIM_TOKEN_VERSION,
      bridgePid: process.pid,
      bridgeProcessInstanceId,
      nonce: randomBytes(16).toString('hex'),
      createdAt: new Date().toISOString(),
      ...(options.supervisedAdmission ? { admission: 'supervised' as const } : {}),
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
  rootPid: number,
  options: ClaudeSessionStateOptions
): string {
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

  const processInstanceId = instanceProbe(options).capture(rootPid);
  if (!processInstanceId) {
    throw new ClaudeSessionStateError(
      'Unable to capture the exact Claude worker process-start identity.'
    );
  }

  const workerPath = workerTokenPath(writerPath, nonce);
  const workerToken: ClaudeSessionWorkerToken = {
    version: WORKER_TOKEN_VERSION,
    nonce,
    rootPid,
    processInstanceId,
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
        return processInstanceId;
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
  return processInstanceId;
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
    return bindWorkerToClaim(writerPath, tokenText, token.nonce, rootPid, options);
  };

  const inspectWorker = (rootPid: number, processInstanceId: string) =>
    instanceProbe(options).inspect(rootPid, processInstanceId);

  const release = async () => {
    if (released) return;
    released = true;
    await releaseAtomicClaim(writerPath, tokenText, token.nonce);
  };

  return {
    sessionId,
    cwd: canonicalCwd,
    ownerToken: token.nonce,
    bindWorker,
    inspectWorker,
    release,
  };
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

function captureWindowsProcessInstance(pid: number): string | undefined {
  const command = [
    '$ErrorActionPreference = "Stop";',
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}";`,
    'if ($null -eq $p) { exit 3 };',
    '[Console]::Out.Write($p.CreationDate.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture))',
  ].join(' ');
  const result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
    {
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    }
  );
  const value = result.stdout.trim();
  return !result.error && result.status === 0 && /^\d+$/.test(value)
    ? `windows-cim:${value}`
    : undefined;
}

function captureLinuxProcessInstance(pid: number): string | undefined {
  try {
    const stat = nodeFs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const closeParen = stat.lastIndexOf(')');
    if (closeParen < 0) return undefined;
    // After comm, the first field is state (#3); process start time is #22.
    const startTicks = stat.slice(closeParen + 2).trim().split(/\s+/)[19];
    if (!/^\d+$/.test(startTicks ?? '')) return undefined;
    const bootId = nodeFs
      .readFileSync('/proc/sys/kernel/random/boot_id', 'utf8')
      .trim()
      .toLowerCase();
    if (!/^[0-9a-f-]{36}$/.test(bootId)) return undefined;
    return `linux-proc:${bootId}:${startTicks}`;
  } catch {
    return undefined;
  }
}

function defaultProcessInstanceProbe(
  platform: NodeJS.Platform = process.platform
): ProcessInstanceProbe {
  const capture = (pid: number): string | undefined => {
    if (!Number.isInteger(pid) || pid <= 0) return undefined;
    if (platform === 'win32') return captureWindowsProcessInstance(pid);
    if (platform === 'linux') return captureLinuxProcessInstance(pid);
    // Durable hosted Sessions use ProcessCapsule's native macOS birth source.
    // This legacy claim module has no exact remaining-POSIX source and fails
    // closed instead of sampling second-resolution `ps lstart` authority.
    return undefined;
  };
  return {
    capture,
    inspect(pid, expectedProcessInstanceId) {
      const current = capture(pid);
      if (current !== undefined) {
        return current === expectedProcessInstanceId ? 'same' : 'different';
      }
      return pidIsAlive(pid) ? 'uncertain' : 'absent';
    },
  };
}

function instanceProbe(options: ClaudeSessionStateOptions): ProcessInstanceProbe {
  return options.processInstanceProbe ?? defaultProcessInstanceProbe(options.platform);
}

export type ClaudeSessionStaleOwnerReap =
  | 'absent'
  | 'reaped'
  | 'live-or-uncertain';

/**
 * Reap one unattachable worker only when the durable writer nonce and worker
 * root both match the caller's registry facts and the original bridge is
 * provably dead. PID alone is never authority to signal a process tree.
 */
export async function reapClaudeSessionStaleOwner(
  sessionId: string,
  expected: { ownerToken: string; rootPid?: number; processInstanceId?: string },
  terminateTree: (rootPid: number) => Promise<void>,
  options: ClaudeSessionStateOptions = {}
): Promise<ClaudeSessionStaleOwnerReap> {
  const { writerPath } = getClaudeSessionStatePaths(sessionId, options);
  let observed: string;
  try {
    observed = await fs.readFile(writerPath, 'utf8');
  } catch (error) {
    return isNodeErrorCode(error, 'ENOENT') ? 'absent' : 'live-or-uncertain';
  }
  const owner = parseClaimToken(observed);
  if (!owner || owner.nonce !== expected.ownerToken) {
    return 'live-or-uncertain';
  }
  const bridge = instanceProbe(options).inspect(
    owner.bridgePid,
    owner.bridgeProcessInstanceId
  );
  if (bridge === 'same' || bridge === 'uncertain') {
    return 'live-or-uncertain';
  }
  const worker = await readWorkerToken(writerPath, owner);
  if (!worker) {
    if (owner.admission !== 'supervised' || expected.rootPid !== undefined) {
      return 'live-or-uncertain';
    }
    return (await reclaimDeadClaimOnce(writerPath, observed, owner))
      ? 'reaped'
      : 'live-or-uncertain';
  }
  if (expected.rootPid !== undefined && worker.rootPid !== expected.rootPid) {
    return 'live-or-uncertain';
  }

  if (
    expected.processInstanceId !== undefined &&
    worker.processInstanceId !== expected.processInstanceId
  ) {
    return 'live-or-uncertain';
  }

  const workerInstance = instanceProbe(options).inspect(
    worker.rootPid,
    worker.processInstanceId
  );
  if (workerInstance === 'uncertain') return 'live-or-uncertain';
  if (workerInstance === 'different') {
    // The old worker is provably gone. Never signal a new process which
    // merely reused its numeric PID.
    return (await reclaimDeadClaimOnce(writerPath, observed, owner))
      ? 'reaped'
      : 'live-or-uncertain';
  }

  if (processTreeIsAlive(worker.rootPid, options)) {
    if (
      workerInstance === 'absent' &&
      (options.platform ?? process.platform) === 'win32'
    ) {
      // After root exit, a Windows PID is no longer safe tree authority.
      // The admitted kill-on-close Job controller must finish containment.
      return 'live-or-uncertain';
    }
    try {
      await terminateTree(worker.rootPid);
    } catch {
      return 'live-or-uncertain';
    }
    if (processTreeIsAlive(worker.rootPid, options)) return 'live-or-uncertain';
  }
  return (await reclaimDeadClaimOnce(writerPath, observed, owner))
    ? 'reaped'
    : 'live-or-uncertain';
}
