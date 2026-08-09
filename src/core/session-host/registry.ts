import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { getGlobalDataDir } from '../global-config.js';
import { isNodeErrorCode } from '../file-state.js';
import {
  HOST_REGISTRY_SCHEMA,
  LEGACY_HOST_REGISTRY_SCHEMA,
  type HostedRequestRecord,
  type HostedSessionRecord,
  type HostedSessionState,
} from './contracts.js';

const fsp = fs.promises;
const LEASE_SCHEMA = 1;
const DEFAULT_RENAME_ATTEMPTS = 8;
const SETTLED_REQUEST_RETENTION = 64;
const PRUNED_REQUEST_FILTER_BYTES = 1024;
const PRUNED_REQUEST_FILTER_HASHES = 7;

export type RegistryFaultPhase =
  | 'before-lease'
  | 'after-lease'
  | 'after-candidate-write'
  | 'after-candidate-flush'
  | 'before-replace'
  | 'after-replace'
  | 'before-lease-release';

export class SessionHostRegistryError extends Error {
  constructor(
    public readonly code:
      | 'registry-busy'
      | 'registry-corrupt'
      | 'stale-generation'
      | 'session-not-found'
      | 'session-exists',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'SessionHostRegistryError';
  }
}

interface RegistryPayload {
  schema: typeof HOST_REGISTRY_SCHEMA;
  generation: number;
  sessions: Record<string, HostedSessionRecord>;
}

interface RegistryDocument extends RegistryPayload {
  digest: string;
}

interface LeaseToken {
  version: typeof LEASE_SCHEMA;
  pid: number;
  nonce: string;
  createdAt: string;
}

export interface SessionHostRegistryOptions {
  env?: NodeJS.ProcessEnv;
  /** Parent data directory. The registry itself is always below session-host/. */
  stateDir?: string;
  fault?: (phase: RegistryFaultPhase) => void;
  processAlive?: (pid: number) => boolean;
  platform?: NodeJS.Platform;
  rename?: typeof fsp.rename;
  renameAttempts?: number;
  /** Deterministic permission-fault seam; production uses fs.promises.readFile. */
  readRegistryFile?: (registryPath: string) => Promise<string>;
  /** Deterministic cwd identity seams for unavailable/Windows path branches. */
  statCwd?: (cwd: string) => { isDirectory(): boolean };
  realpathCwd?: (cwd: string) => string;
  pathPlatform?: NodeJS.Platform;
  /** Test/rollback seam: older binaries accept only v1 and preserve v2 bytes. */
  acceptedSchema?: typeof HOST_REGISTRY_SCHEMA | typeof LEGACY_HOST_REGISTRY_SCHEMA;
}

export interface SessionHostRegistry {
  readonly paths: { root: string; registryPath: string; leasePath: string };
  load(): Promise<void>;
  get(sessionId: string): HostedSessionRecord | undefined;
  list(): HostedSessionRecord[];
  create(record: HostedSessionRecord): Promise<HostedSessionRecord>;
  update(
    sessionId: string,
    expected: number | { generation: number; revision: number },
    mutate: (current: HostedSessionRecord) => HostedSessionRecord
  ): Promise<HostedSessionRecord>;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

export function digestSessionHostText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function documentFor(payload: RegistryPayload): RegistryDocument {
  return { ...payload, digest: digest(payload) };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isFiniteTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

const HOST_STATES = new Set<HostedSessionState>([
  'starting',
  'idle',
  'active',
  'cancelling',
  'interrupted',
  'recovering',
  'failed',
  'retiring',
  'retired',
]);
const REQUEST_STATES = new Set([
  'prepared',
  'sent',
  'settled',
  'cancelled',
  'ambiguous',
]);

const REQUEST_KEYS = new Set([
  'requestId',
  'inputDigest',
  'generation',
  'state',
  'preparedAt',
  'sentAt',
  'settledAt',
  'resultDigest',
  'resultRef',
  'diagnostic',
]);

const SESSION_KEYS = new Set([
  'sessionId',
  'backend',
  'backendVersion',
  'backendSessionId',
  'cwd',
  'cwdDigest',
  'hostState',
  'generation',
  'revision',
  'createdAt',
  'updatedAt',
  'requests',
  'prunedRequestFilter',
  'process',
  'processTerminal',
  'recoveryReason',
  'retirementReason',
]);

const PROCESS_KEYS = new Set([
  'generation',
  'ownerToken',
  'runtimeRef',
  'displayPid',
  'preparedAt',
  'declaration',
]);
const DECLARATION_KEYS = new Set(['tier', 'exactCancel', 'scopeEmptyProof']);
const PROCESS_TERMINAL_KEYS = new Set([
  'outcome',
  'emptiness',
  'label',
  'groupObservedEmpty',
  'forced',
  'recordedAt',
]);
const PROCESS_TERMINAL_OUTCOMES = new Set(['cancelled', 'completed', 'never-activated']);
const LEGACY_PROCESS_KEYS = new Set([
  'generation',
  'rootPid',
  'processInstanceId',
  'ownerToken',
  'startedAt',
]);

function parseRequest(value: unknown): HostedRequestRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('request must be an object');
  }
  const request = value as Partial<HostedRequestRecord>;
  if (
    Object.keys(request).some((key) => !REQUEST_KEYS.has(key)) ||
    typeof request.requestId !== 'string' ||
    typeof request.inputDigest !== 'string' ||
    !Number.isInteger(request.generation) ||
    (request.generation ?? -1) < 0 ||
    !REQUEST_STATES.has(request.state ?? '') ||
    !isFiniteTimestamp(request.preparedAt) ||
    (request.sentAt !== undefined && !isFiniteTimestamp(request.sentAt)) ||
    (request.settledAt !== undefined && !isFiniteTimestamp(request.settledAt)) ||
    (request.resultDigest !== undefined && typeof request.resultDigest !== 'string') ||
    (request.resultRef !== undefined && typeof request.resultRef !== 'string') ||
    (request.diagnostic !== undefined && typeof request.diagnostic !== 'string')
  ) {
    throw new Error('invalid request shape');
  }
  return request as HostedRequestRecord;
}

function sameCanonicalPath(left: string, right: string, platform: NodeJS.Platform): boolean {
  if (platform !== 'win32') return left === right;
  return (
    path.win32.normalize(left).toLocaleLowerCase('en-US') ===
    path.win32.normalize(right).toLocaleLowerCase('en-US')
  );
}

interface CwdIdentityReader {
  stat(cwd: string): { isDirectory(): boolean };
  realpath(cwd: string): string;
}

function parseSession(
  value: unknown,
  key: string,
  platform: NodeJS.Platform,
  cwdIdentity: CwdIdentityReader,
  schema: typeof HOST_REGISTRY_SCHEMA | typeof LEGACY_HOST_REGISTRY_SCHEMA = HOST_REGISTRY_SCHEMA
): HostedSessionRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('session must be an object');
  }
  const record = value as Partial<HostedSessionRecord>;
  if (
    Object.keys(record).some((field) => !SESSION_KEYS.has(field)) ||
    record.sessionId !== key ||
    typeof record.backend !== 'string' ||
    !record.backend ||
    typeof record.cwd !== 'string' ||
    !(platform === 'win32'
      ? path.win32.isAbsolute(record.cwd)
      : path.posix.isAbsolute(record.cwd)) ||
    typeof record.cwdDigest !== 'string' ||
    typeof record.hostState !== 'string' ||
    !HOST_STATES.has(record.hostState as HostedSessionState) ||
    typeof record.generation !== 'number' ||
    !Number.isInteger(record.generation) ||
    record.generation < 0 ||
    (record.revision !== undefined &&
      (!Number.isInteger(record.revision) || record.revision < 0)) ||
    !isFiniteTimestamp(record.createdAt) ||
    !isFiniteTimestamp(record.updatedAt) ||
    !Array.isArray(record.requests)
  ) {
    throw new Error('invalid session shape');
  }
  if (record.prunedRequestFilter !== undefined) {
    if (typeof record.prunedRequestFilter !== 'string') {
      throw new Error('invalid pruned request filter');
    }
    const decoded = Buffer.from(record.prunedRequestFilter, 'base64');
    if (
      decoded.byteLength !== PRUNED_REQUEST_FILTER_BYTES ||
      decoded.toString('base64') !== record.prunedRequestFilter
    ) {
      throw new Error('invalid pruned request filter');
    }
  }
  const cwdStat = cwdIdentity.stat(record.cwd);
  if (!cwdStat.isDirectory()) throw new Error('session cwd is not a directory');
  const canonical = cwdIdentity.realpath(record.cwd);
  if (!sameCanonicalPath(canonical, record.cwd, platform)) {
    throw new Error('session cwd is not canonical');
  }
  if (digestSessionHostText(record.cwd) !== record.cwdDigest) {
    throw new Error('session cwd digest mismatch');
  }
  const requests = record.requests.map(parseRequest);
  const unfinished = requests.filter((request) =>
    ['prepared', 'sent'].includes(request.state)
  );
  if (unfinished.length > 1) throw new Error('session has multiple unfinished requests');
  if (record.process !== undefined) {
    const processFacts = record.process as unknown as Record<string, unknown>;
    if (schema === LEGACY_HOST_REGISTRY_SCHEMA) {
      if (
        Object.keys(processFacts).some((field) => !LEGACY_PROCESS_KEYS.has(field)) ||
        !Number.isInteger(processFacts.generation) ||
        processFacts.generation !== record.generation ||
        typeof processFacts.ownerToken !== 'string' ||
        !processFacts.ownerToken
      ) {
        throw new Error('invalid legacy process facts');
      }
      throw new Error('legacy-containment-uncertain');
    }
    if (
      Object.keys(processFacts).some((field) => !PROCESS_KEYS.has(field)) ||
      !Number.isInteger(processFacts.generation) ||
      processFacts.generation !== record.generation ||
      typeof processFacts.runtimeRef !== 'string' ||
      !/^rasen-process-scope\/1:[A-Za-z0-9_-]{16,4096}$/.test(processFacts.runtimeRef) ||
      (processFacts.displayPid !== undefined &&
        (!Number.isInteger(processFacts.displayPid) || Number(processFacts.displayPid) <= 0)) ||
      typeof processFacts.ownerToken !== 'string' ||
      !processFacts.ownerToken ||
      !isFiniteTimestamp(processFacts.preparedAt)
    ) {
      throw new Error('invalid process facts');
    }
    if (processFacts.declaration !== undefined) {
      const declaration = processFacts.declaration as Record<string, unknown>;
      // Both limit flags are literal false; a record claiming otherwise is not
      // a best-effort declaration and is refused rather than read leniently.
      if (
        typeof declaration !== 'object' ||
        declaration === null ||
        Array.isArray(declaration) ||
        Object.keys(declaration).some((field) => !DECLARATION_KEYS.has(field)) ||
        declaration.tier !== 'best-effort' ||
        declaration.exactCancel !== false ||
        declaration.scopeEmptyProof !== false
      ) {
        throw new Error('invalid best-effort scope declaration');
      }
    }
  }
  if (record.processTerminal !== undefined) {
    const terminal = record.processTerminal as unknown as Record<string, unknown>;
    if (
      typeof terminal !== 'object' ||
      terminal === null ||
      Array.isArray(terminal) ||
      Object.keys(terminal).some((field) => !PROCESS_TERMINAL_KEYS.has(field)) ||
      typeof terminal.outcome !== 'string' ||
      !PROCESS_TERMINAL_OUTCOMES.has(terminal.outcome) ||
      terminal.emptiness !== 'unproven' ||
      typeof terminal.label !== 'string' ||
      !terminal.label ||
      typeof terminal.groupObservedEmpty !== 'boolean' ||
      typeof terminal.forced !== 'boolean' ||
      !isFiniteTimestamp(terminal.recordedAt)
    ) {
      throw new Error('invalid process terminal');
    }
  }
  return { ...(record as HostedSessionRecord), revision: record.revision ?? 0, requests };
}

function parseDocument(
  content: string,
  platform: NodeJS.Platform,
  cwdIdentity: CwdIdentityReader,
  acceptedSchema?: typeof HOST_REGISTRY_SCHEMA | typeof LEGACY_HOST_REGISTRY_SCHEMA
): RegistryDocument {
  let value: unknown;
  try {
    value = JSON.parse(content) as unknown;
  } catch (error) {
    throw new SessionHostRegistryError(
      'registry-corrupt',
      'Hosted Session registry contains malformed JSON; original bytes were preserved.',
      { cause: error }
    );
  }
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('document must be an object');
    }
    const candidate = value as Partial<RegistryDocument>;
    if (
      Object.keys(candidate).some(
        (key) => !['schema', 'generation', 'sessions', 'digest'].includes(key)
      ) ||
      ![HOST_REGISTRY_SCHEMA, LEGACY_HOST_REGISTRY_SCHEMA].includes(candidate.schema as never) ||
      (acceptedSchema !== undefined && candidate.schema !== acceptedSchema) ||
      typeof candidate.generation !== 'number' ||
      !Number.isInteger(candidate.generation) ||
      candidate.generation < 0 ||
      typeof candidate.sessions !== 'object' ||
      candidate.sessions === null ||
      Array.isArray(candidate.sessions) ||
      typeof candidate.digest !== 'string'
    ) {
      throw new Error('invalid registry envelope');
    }
    const rawPayload = {
      schema: candidate.schema,
      generation: candidate.generation,
      sessions: candidate.sessions,
    };
    if (digest(rawPayload) !== candidate.digest) throw new Error('registry digest mismatch');
    const sessions: Record<string, HostedSessionRecord> = {};
    for (const [key, session] of Object.entries(candidate.sessions)) {
      sessions[key] = parseSession(
        session,
        key,
        platform,
        cwdIdentity,
        candidate.schema as typeof HOST_REGISTRY_SCHEMA | typeof LEGACY_HOST_REGISTRY_SCHEMA
      );
    }
    const payload: RegistryPayload = {
      schema: HOST_REGISTRY_SCHEMA,
      generation: candidate.generation,
      sessions,
    };
    // Normalize additive lifecycle fields (currently revision=0) only after
    // verifying the exact authored bytes, then carry a digest for the
    // normalized in-memory document into its next atomic publication.
    return documentFor(payload);
  } catch (error) {
    if (error instanceof SessionHostRegistryError) throw error;
    throw new SessionHostRegistryError(
      'registry-corrupt',
      `Hosted Session registry failed schema, digest, or canonical-path validation; original bytes were preserved (${error instanceof Error ? error.message : 'unknown'}).`,
      { cause: error }
    );
  }
}

function parseLease(content: string): LeaseToken | undefined {
  try {
    const value = JSON.parse(content) as Partial<LeaseToken>;
    if (
      value.version !== LEASE_SCHEMA ||
      !Number.isInteger(value.pid) ||
      (value.pid ?? 0) <= 0 ||
      typeof value.nonce !== 'string' ||
      !value.nonce ||
      !isFiniteTimestamp(value.createdAt)
    ) {
      return undefined;
    }
    return value as LeaseToken;
  } catch {
    return undefined;
  }
}

function defaultProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function bloomIndexes(requestId: string): number[] {
  const value = createHash('sha256').update(requestId, 'utf8').digest();
  const bitCount = PRUNED_REQUEST_FILTER_BYTES * 8;
  return Array.from({ length: PRUNED_REQUEST_FILTER_HASHES }, (_, index) =>
    value.readUInt32BE(index * 4) % bitCount
  );
}

function addPrunedRequestIds(current: string | undefined, requestIds: string[]): string | undefined {
  if (requestIds.length === 0) return current;
  const bits = current
    ? Buffer.from(current, 'base64')
    : Buffer.alloc(PRUNED_REQUEST_FILTER_BYTES);
  for (const requestId of requestIds) {
    for (const bit of bloomIndexes(requestId)) bits[bit >> 3] |= 1 << (bit & 7);
  }
  return bits.toString('base64');
}

export function prunedRequestIdMayExist(
  record: Pick<HostedSessionRecord, 'prunedRequestFilter'>,
  requestId: string
): boolean {
  if (!record.prunedRequestFilter) return false;
  const bits = Buffer.from(record.prunedRequestFilter, 'base64');
  return bloomIndexes(requestId).every((bit) => (bits[bit >> 3] & (1 << (bit & 7))) !== 0);
}

function pruneSettledRequests(record: HostedSessionRecord): HostedSessionRecord {
  const protectedRequests = record.requests.filter((request) =>
    ['prepared', 'sent', 'ambiguous'].includes(request.state)
  );
  const terminal = record.requests.filter(
    (request) => !['prepared', 'sent', 'ambiguous'].includes(request.state)
  );
  const prunedCount = Math.max(0, terminal.length - SETTLED_REQUEST_RETENTION);
  const pruned = terminal.slice(0, prunedCount);
  return {
    ...record,
    requests: [
      ...terminal.slice(prunedCount),
      ...protectedRequests,
    ].sort((left, right) => Date.parse(left.preparedAt) - Date.parse(right.preparedAt)),
    ...(pruned.length > 0 || record.prunedRequestFilter
      ? {
          prunedRequestFilter: addPrunedRequestIds(
            record.prunedRequestFilter,
            pruned.map((request) => request.requestId)
          ),
        }
      : {}),
  };
}

export function createSessionHostRegistry(
  options: SessionHostRegistryOptions = {}
): SessionHostRegistry {
  const platform = options.platform ?? process.platform;
  const pathPlatform = options.pathPlatform ?? process.platform;
  const cwdIdentity: CwdIdentityReader = {
    stat: options.statCwd ?? fs.statSync,
    realpath: options.realpathCwd ?? fs.realpathSync.native,
  };
  const parent = options.stateDir ?? getGlobalDataDir({ env: options.env });
  const root = path.join(parent, 'session-host');
  const registryPath = path.join(root, 'registry.json');
  const leasePath = path.join(root, 'registry.writer.lock');
  const paths = { root, registryPath, leasePath };
  let current = documentFor({ schema: HOST_REGISTRY_SCHEMA, generation: 0, sessions: {} });
  let sameInstanceMutationTail: Promise<void> = Promise.resolve();

  async function readDisk(): Promise<RegistryDocument> {
    try {
      const content = options.readRegistryFile
        ? await options.readRegistryFile(registryPath)
        : await fsp.readFile(registryPath, 'utf8');
      return parseDocument(content, pathPlatform, cwdIdentity, options.acceptedSchema);
    } catch (error) {
      if (isNodeErrorCode(error, 'ENOENT')) {
        return documentFor({ schema: HOST_REGISTRY_SCHEMA, generation: 0, sessions: {} });
      }
      if (error instanceof SessionHostRegistryError) throw error;
      throw new SessionHostRegistryError(
        'registry-corrupt',
        `Hosted Session registry could not be read; original bytes were preserved (${(error as NodeJS.ErrnoException).code ?? 'unknown'}).`,
        { cause: error }
      );
    }
  }

  async function load(): Promise<void> {
    current = await readDisk();
  }

  async function acquireLease(): Promise<{ text: string; token: LeaseToken }> {
    options.fault?.('before-lease');
    await fsp.mkdir(root, { recursive: true, mode: 0o700 });
    await fsp.chmod(root, 0o700).catch(() => undefined);
    for (;;) {
      const token: LeaseToken = {
        version: LEASE_SCHEMA,
        pid: process.pid,
        nonce: randomBytes(16).toString('hex'),
        createdAt: new Date().toISOString(),
      };
      const text = `${JSON.stringify(token)}\n`;
      try {
        const handle = await fsp.open(leasePath, 'wx', 0o600);
        try {
          await handle.writeFile(text, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        options.fault?.('after-lease');
        return { text, token };
      } catch (error) {
        if (!isNodeErrorCode(error, 'EEXIST')) throw error;
      }

      let observed: string;
      try {
        observed = await fsp.readFile(leasePath, 'utf8');
      } catch (error) {
        if (isNodeErrorCode(error, 'ENOENT')) continue;
        throw new SessionHostRegistryError('registry-busy', 'Unable to inspect hosted registry lease.', {
          cause: error,
        });
      }
      const owner = parseLease(observed);
      if (!owner || (options.processAlive ?? defaultProcessAlive)(owner.pid)) {
        throw new SessionHostRegistryError(
          'registry-busy',
          'Hosted Session registry already has a live or unprovable writer.'
        );
      }

      const tombstone = path.join(root, `.registry.writer.${owner.nonce}.recovered`);
      try {
        await fsp.writeFile(
          tombstone,
          `${JSON.stringify({ version: 1, pid: process.pid, createdAt: new Date().toISOString() })}\n`,
          { encoding: 'utf8', flag: 'wx', mode: 0o600 }
        );
      } catch (error) {
        if (isNodeErrorCode(error, 'EEXIST')) {
          throw new SessionHostRegistryError(
            'registry-busy',
            'Stale hosted registry lease recovery already has an elected owner.'
          );
        }
        throw error;
      }
      const reread = await fsp.readFile(leasePath, 'utf8').catch(() => '');
      if (reread !== observed) {
        throw new SessionHostRegistryError(
          'registry-busy',
          'Hosted registry ownership changed during stale recovery.'
        );
      }
      await fsp.unlink(leasePath);
    }
  }

  async function releaseLease(owner: { text: string }): Promise<void> {
    options.fault?.('before-lease-release');
    const attempts = options.renameAttempts ?? DEFAULT_RENAME_ATTEMPTS;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        if ((await fsp.readFile(leasePath, 'utf8')) !== owner.text) return;
        await fsp.unlink(leasePath);
        return;
      } catch (error) {
        if (isNodeErrorCode(error, 'ENOENT')) return;
        const code = (error as NodeJS.ErrnoException).code;
        const retryable =
          platform === 'win32' && ['EACCES', 'EPERM', 'EBUSY'].includes(code ?? '');
        if (!retryable || attempt + 1 >= attempts) {
          throw new SessionHostRegistryError(
            'registry-busy',
            'Hosted Session registry owner could not release its exact lease safely.',
            { cause: error }
          );
        }
        await new Promise<void>((resolve) =>
          setTimeout(resolve, Math.min(100, 5 * 2 ** attempt))
        );
      }
    }
  }

  async function renameWithRetry(candidate: string): Promise<void> {
    const rename = options.rename ?? fsp.rename;
    const attempts = options.renameAttempts ?? DEFAULT_RENAME_ATTEMPTS;
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(candidate, registryPath);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const retryable = platform === 'win32' && ['EACCES', 'EPERM', 'EBUSY'].includes(code ?? '');
        if (!retryable || attempt + 1 >= attempts) {
          throw new SessionHostRegistryError(
            'registry-busy',
            `Hosted Session registry could not atomically replace its target (${code ?? 'unknown'}).`,
            { cause: error }
          );
        }
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(100, 5 * 2 ** attempt)));
      }
    }
  }

  async function publish(next: RegistryDocument): Promise<void> {
    const candidate = path.join(
      root,
      `.registry.${process.pid}.${randomBytes(8).toString('hex')}.candidate`
    );
    const handle = await fsp.open(candidate, 'wx', 0o600);
    let replaced = false;
    try {
      try {
        await handle.writeFile(`${JSON.stringify(next)}\n`, 'utf8');
        options.fault?.('after-candidate-write');
        await handle.sync();
        options.fault?.('after-candidate-flush');
      } finally {
        await handle.close();
      }
      options.fault?.('before-replace');
      await renameWithRetry(candidate);
      replaced = true;
      options.fault?.('after-replace');
    } finally {
      if (!replaced) await fsp.unlink(candidate).catch(() => undefined);
    }
  }

  async function mutateDocument<T>(
    mutate: (document: RegistryDocument) => { document: RegistryDocument; result: T }
  ): Promise<T> {
    let releaseTurn!: () => void;
    const prior = sameInstanceMutationTail;
    sameInstanceMutationTail = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    await prior;
    try {
      const owner = await acquireLease();
      let mutation: { document: RegistryDocument; result: T } | undefined;
      try {
        const disk = await readDisk();
        mutation = mutate(disk);
        await publish(mutation.document);
      } finally {
        await releaseLease(owner);
      }
      current = mutation.document;
      return clone(mutation.result);
    } finally {
      releaseTurn();
    }
  }

  return {
    paths,
    load,
    get(sessionId) {
      const record = current.sessions[sessionId];
      return record ? clone(record) : undefined;
    },
    list() {
      return Object.values(current.sessions).map(clone);
    },
    create(record) {
      return mutateDocument((disk) => {
        if (disk.sessions[record.sessionId]) {
          throw new SessionHostRegistryError(
            'session-exists',
            `Hosted Session ${record.sessionId} already exists.`
          );
        }
        const validated = parseSession(record, record.sessionId, pathPlatform, cwdIdentity);
        const payload: RegistryPayload = {
          schema: HOST_REGISTRY_SCHEMA,
          generation: disk.generation + 1,
          sessions: { ...disk.sessions, [record.sessionId]: validated },
        };
        return { document: documentFor(payload), result: validated };
      });
    },
    update(sessionId, expected, mutate) {
      return mutateDocument((disk) => {
        const existing = disk.sessions[sessionId];
        if (!existing) {
          throw new SessionHostRegistryError(
            'session-not-found',
            `Hosted Session ${sessionId} does not exist.`
          );
        }
        const expectedGeneration = typeof expected === 'number' ? expected : expected.generation;
        const expectedRevision = typeof expected === 'number' ? undefined : expected.revision;
        if (existing.generation !== expectedGeneration) {
          throw new SessionHostRegistryError(
            'stale-generation',
            `Hosted Session ${sessionId} is generation ${existing.generation}, not ${expectedGeneration}.`
          );
        }
        if (expectedRevision !== undefined && (existing.revision ?? 0) !== expectedRevision) {
          throw new SessionHostRegistryError(
            'stale-generation',
            `Hosted Session ${sessionId} is revision ${existing.revision ?? 0}, not ${expectedRevision}.`
          );
        }
        const requested = pruneSettledRequests(mutate(clone(existing)));
        requested.revision = (existing.revision ?? 0) + 1;
        const normalized = parseSession(
          requested,
          sessionId,
          pathPlatform,
          cwdIdentity
        );
        const payload: RegistryPayload = {
          schema: HOST_REGISTRY_SCHEMA,
          generation: disk.generation + 1,
          sessions: { ...disk.sessions, [sessionId]: normalized },
        };
        return { document: documentFor(payload), result: normalized };
      });
    },
  };
}
