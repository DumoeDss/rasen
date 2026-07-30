import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

import {
  acquireOwnerAwareFileLock,
  releaseOwnerAwareFileLock,
  type FileLockErrorInfo,
  type FileLockErrorKind,
} from '../file-state.js';
import {
  RuntimeExecutionRefSchema,
  type RuntimeExecutionRef,
} from '../session-runtime-context.js';
import { claudeProjectsDir } from '../agent-context.js';
import type { SessionSpace } from './session-registry.js';
import type {
  HostErrorCode,
  HostLifecycleEvent,
  HostResultEnvelope,
  HostSnapshot,
  HostTurnInput,
  RecoverHostInput,
  SessionSupervisor,
} from './supervisor.js';

export const DURABLE_SESSION_REGISTRY_SCHEMA = 'rasen-session-registry/1' as const;
export const MAX_DURABLE_TERMINAL_WAKES = 64;
export const MAX_DURABLE_IDEMPOTENCY_TOMBSTONES = 4096;
export const WINDOWS_DURABLE_WAKE_PERSISTENCE_BUDGET_MS = 750;

const REGISTRY_FILE_NAME = 'sessions.json';
const REGISTRY_LOCK_FILE_NAME = 'sessions.json.lock';
const WAKE_LOCK_DIRECTORY_NAME = 'session-wake-locks';
const WINDOWS_REPLACE_ERROR_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const DURABLE_MESSAGE_ID_DIGEST_DOMAIN = 'rasen-session-message-id/1';

/**
 * Converts a process-local caller identity into the only form that may cross
 * the durable boundary. Including the UTF-8 byte length makes the
 * domain-separated encoding unambiguous without retaining the raw id.
 */
export function durableSessionMessageIdDigest(messageId: string): string {
  const byteLength = Buffer.byteLength(messageId, 'utf-8');
  return createHash('sha256')
    .update(`${DURABLE_MESSAGE_ID_DIGEST_DOMAIN}\0${byteLength}:`, 'utf-8')
    .update(messageId, 'utf-8')
    .digest('hex');
}

export interface TrustedCanonicalRunRef {
  /**
   * This discriminator documents the admission boundary: callers must obtain
   * the run directory from canonical Run selection, never from a raw session
   * key, cwd guess, project enhancement directory, or registry content.
   */
  kind: 'trusted-canonical-run';
  runId: string;
  canonicalRunDir: string;
}

export interface DurableSessionRegistryPaths {
  canonicalRunDir: string;
  registryPath: string;
  mutationLockPath: string;
  wakeLockDirectory: string;
}

export type DurableSessionStatus =
  | 'starting'
  | 'idle'
  | 'waking'
  | 'lost'
  | 'stale'
  | 'retiring'
  | 'retired';

export interface DurableSessionOwner {
  ownerInstanceId: string;
  ownerPid: number;
  hostId: string;
  childPid: number;
  boundAt: string;
}

export interface DurableTouchPolicy {
  mode: 'auto' | 'never';
  deadlineAt?: string;
  maxTouches: number;
  touchesUsed: number;
  deadlineAction: 'stop' | 'retire-silent';
}

export interface DurableDispatchFence {
  messageIdDigest: string;
  admittedAt: string;
  phase: 'admitted' | 'dispatching';
  dispatchFenceAt?: string;
  kind?: 'interactive' | 'touch';
  touchOrdinal?: number;
  touchAttempt?: number;
}

export type DurableWakeOutcome =
  | 'completed'
  | 'pre_delivery_failed'
  | 'delivery_uncertain';

export interface DurableTerminalWake {
  messageIdDigest: string;
  admittedAt: string;
  dispatchFenceAt?: string;
  settledAt: string;
  outcome: DurableWakeOutcome;
  kind?: 'interactive' | 'touch';
  touchOrdinal?: number;
  touchAttempt?: number;
  code?: string;
  resultRef?: string;
  resultDigest?: string;
}

export interface DurableIdempotencyTombstone {
  messageIdDigest: string;
  disposition: DurableWakeOutcome;
}

export interface DurableSessionLifecycle {
  createdAt: string;
  updatedAt: string;
  lastWakeAt?: string;
  lostAt?: string;
  recoveredAt?: string;
  retirementRequestedAt?: string;
  retiredAt?: string;
  reason?: string;
}

export interface DurableSessionRecord {
  sessionKey: string;
  role: string;
  actionId?: string;
  nodeId?: string;
  invocationId?: string;
  hostKind: 'stream-json';
  cwd: string;
  attachedRoots: string[];
  space?: SessionSpace;
  execution?: RuntimeExecutionRef;
  model?: string;
  effort?: string;
  claudeSessionId?: string;
  status: DurableSessionStatus;
  owner?: DurableSessionOwner;
  lifecycle: DurableSessionLifecycle;
  touchPolicy: DurableTouchPolicy;
  inFlight?: DurableDispatchFence;
  idempotencyTombstones: DurableIdempotencyTombstone[];
  wakes: DurableTerminalWake[];
}

export interface DurableSessionRegistryDocument {
  schema: typeof DURABLE_SESSION_REGISTRY_SCHEMA;
  runId: string;
  revision: number;
  updatedAt: string;
  launcherSessionIds: string[];
  sessions: DurableSessionRecord[];
}

export type DurableRegistryDiagnosticCode =
  | 'run_directory_invalid'
  | 'registry_absent'
  | 'registry_corrupt'
  | 'unsupported_schema'
  | 'run_mismatch'
  | 'session_not_found'
  | 'session_conflict'
  | 'invalid_transition'
  | 'idempotency_capacity_exhausted'
  | 'registry_lock_timeout'
  | 'registry_lock_permission'
  | 'registry_write_failed';

export interface DurableRegistryDiagnostic {
  code: DurableRegistryDiagnosticCode;
  message: string;
  path?: string;
  causeCode?: string;
}

export type DurableRegistryReadResult =
  | { ok: true; registry: DurableSessionRegistryDocument }
  | { ok: false; diagnostic: DurableRegistryDiagnostic };

export interface RegisterDurableSessionInput {
  sessionKey: string;
  role: string;
  actionId?: string;
  nodeId?: string;
  invocationId?: string;
  cwd: string;
  attachedRoots?: readonly string[];
  space?: SessionSpace;
  execution?: RuntimeExecutionRef;
  model?: string;
  effort?: string;
  claudeSessionId: string;
  owner: DurableSessionOwner;
  touchPolicy: DurableTouchPolicy;
  launcherSessionId?: string;
}

export type ReserveDurableSessionInput = Omit<
  RegisterDurableSessionInput,
  'claudeSessionId' | 'owner'
>;

export interface BindDurableSessionInput {
  sessionKey: string;
  claudeSessionId: string;
  owner: DurableSessionOwner;
}

export type DurableSessionMutationResult =
  | {
      ok: true;
      registry: DurableSessionRegistryDocument;
      session: DurableSessionRecord;
    }
  | { ok: false; diagnostic: DurableRegistryDiagnostic };

export interface DurableSessionRegistryStore {
  readonly paths: DurableSessionRegistryPaths;
  read(): Promise<DurableRegistryReadResult>;
  get(sessionKey: string): Promise<
    | { ok: true; session: DurableSessionRecord; registry: DurableSessionRegistryDocument }
    | { ok: false; diagnostic: DurableRegistryDiagnostic }
  >;
  list(): Promise<
    | { ok: true; sessions: DurableSessionRecord[]; registry: DurableSessionRegistryDocument }
    | { ok: false; diagnostic: DurableRegistryDiagnostic }
  >;
  reserve(input: ReserveDurableSessionInput): Promise<DurableSessionMutationResult>;
  bind(input: BindDurableSessionInput): Promise<DurableSessionMutationResult>;
  register(input: RegisterDurableSessionInput): Promise<DurableSessionMutationResult>;
}

export type DurableWakeLeaseDiagnosticCode =
  | 'wake_busy'
  | 'wake_lock_malformed'
  | 'wake_lock_permission'
  | 'wake_lock_timeout'
  | 'wake_lock_error';

export interface DurableWakeLeaseDiagnostic {
  code: DurableWakeLeaseDiagnosticCode;
  message: string;
  lockPath: string;
  ownerState: 'live' | 'dead' | 'malformed' | 'ambiguous' | 'permission';
  ownerPid?: number;
  causeCode?: string;
}

export interface DurableSessionWakeLease {
  lockPath: string;
  release(): Promise<void>;
}

export interface AcquireDurableSessionWakeLeaseOptions {
  store: DurableSessionRegistryStore;
  sessionKey: string;
  ownerInstanceId: string;
  deadlineMs?: number;
  pollMs?: number;
}

export type AcquireDurableSessionWakeLeaseResult =
  | { ok: true; lease: DurableSessionWakeLease }
  | { ok: false; diagnostic: DurableWakeLeaseDiagnostic };

/**
 * Filesystem boundary used by durable registry storage and transcript probing.
 * The production adapter delegates to Node. Tests can fault one exact boundary
 * without mocking management-layer collaborators.
 */
export interface DurableRegistryFileSystem {
  lstat(targetPath: string): fs.Stats;
  realpath(targetPath: string): string;
  readText(targetPath: string): string;
  createDirectory(targetPath: string): void;
  writeExclusive(targetPath: string, content: string): void;
  flushFile(targetPath: string): void;
  replace(sourcePath: string, targetPath: string): void;
  remove(targetPath: string): void;
  flushDirectory(targetPath: string): void;
}

export const nodeDurableRegistryFileSystem: DurableRegistryFileSystem = {
  lstat: (targetPath) => fs.lstatSync(targetPath),
  realpath: (targetPath) => fs.realpathSync.native(targetPath),
  readText: (targetPath) => fs.readFileSync(targetPath, 'utf-8'),
  createDirectory: (targetPath) => fs.mkdirSync(targetPath, { recursive: true }),
  writeExclusive: (targetPath, content) => {
    fs.writeFileSync(targetPath, content, {
      encoding: 'utf-8',
      flag: 'wx',
      mode: 0o600,
    });
  },
  flushFile: (targetPath) => {
    const descriptor = fs.openSync(targetPath, 'r+');
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  },
  replace: (sourcePath, targetPath) => fs.renameSync(sourcePath, targetPath),
  remove: (targetPath) => fs.rmSync(targetPath, { force: true }),
  flushDirectory: (targetPath) => {
    if (process.platform === 'win32') return;
    const descriptor = fs.openSync(targetPath, 'r');
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  },
};

export interface CreateDurableSessionRegistryStoreOptions {
  run: TrustedCanonicalRunRef;
  platform?: NodeJS.Platform;
  clock?: () => Date | string;
  filesystem?: DurableRegistryFileSystem;
  lockDeadlineMs?: number;
  lockPollMs?: number;
  replaceDeadlineMs?: number;
  replacePollMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

function timestampSchema() {
  return z.string().refine((value) => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
  }, 'Expected an ISO-8601 UTC timestamp');
}

const TimestampSchema = timestampSchema();
const NonEmptyStringSchema = z.string().min(1);
const MessageIdDigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const SessionSpaceSchema = z
  .object({
    type: z.enum(['project', 'store']),
    id: NonEmptyStringSchema,
    root: NonEmptyStringSchema,
  })
  .strict();
const DurableSessionOwnerSchema = z
  .object({
    ownerInstanceId: NonEmptyStringSchema,
    ownerPid: z.number().int().positive(),
    hostId: NonEmptyStringSchema,
    childPid: z.number().int().positive(),
    boundAt: TimestampSchema,
  })
  .strict();
const DurableTouchPolicySchema = z
  .object({
    mode: z.enum(['auto', 'never']),
    deadlineAt: TimestampSchema.optional(),
    maxTouches: z.number().int().nonnegative(),
    touchesUsed: z.number().int().nonnegative(),
    deadlineAction: z.enum(['stop', 'retire-silent']),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.touchesUsed > policy.maxTouches) {
      context.addIssue({
        code: 'custom',
        message: 'touchesUsed cannot exceed maxTouches',
      });
    }
  });
const DurableDispatchFenceSchema = z
  .object({
    messageIdDigest: MessageIdDigestSchema,
    admittedAt: TimestampSchema,
    phase: z.enum(['admitted', 'dispatching']),
    dispatchFenceAt: TimestampSchema.optional(),
    kind: z.enum(['interactive', 'touch']).optional(),
    touchOrdinal: z.number().int().positive().optional(),
    touchAttempt: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((fence, context) => {
    if (fence.phase === 'admitted' && fence.dispatchFenceAt !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'An admitted wake cannot have a dispatch fence',
      });
    }
    if (fence.phase === 'dispatching' && fence.dispatchFenceAt === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'A dispatching wake requires a dispatch fence',
      });
    }
    if (
      fence.kind === 'touch'
      && (fence.touchOrdinal === undefined || fence.touchAttempt === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A touch dispatch fence requires its ordinal and attempt',
      });
    }
    if (
      fence.kind !== 'touch'
      && (fence.touchOrdinal !== undefined || fence.touchAttempt !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Only a touch dispatch fence may carry touch metadata',
      });
    }
  });
const DurableTerminalWakeSchema = z
  .object({
    messageIdDigest: MessageIdDigestSchema,
    admittedAt: TimestampSchema,
    dispatchFenceAt: TimestampSchema.optional(),
    settledAt: TimestampSchema,
    outcome: z.enum([
      'completed',
      'pre_delivery_failed',
      'delivery_uncertain',
    ]),
    kind: z.enum(['interactive', 'touch']).optional(),
    touchOrdinal: z.number().int().positive().optional(),
    touchAttempt: z.number().int().positive().optional(),
    code: NonEmptyStringSchema.optional(),
    resultRef: NonEmptyStringSchema.optional(),
    resultDigest: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  })
  .strict()
  .superRefine((wake, context) => {
    if (
      wake.kind === 'touch'
      && (wake.touchOrdinal === undefined || wake.touchAttempt === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A terminal touch wake requires its ordinal and attempt',
      });
    }
    if (
      wake.kind !== 'touch'
      && (wake.touchOrdinal !== undefined || wake.touchAttempt !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Only a terminal touch wake may carry touch metadata',
      });
    }
  });
const DurableIdempotencyTombstoneSchema = z
  .object({
    messageIdDigest: MessageIdDigestSchema,
    disposition: z.enum([
      'completed',
      'pre_delivery_failed',
      'delivery_uncertain',
    ]),
  })
  .strict();
const DurableSessionLifecycleSchema = z
  .object({
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    lastWakeAt: TimestampSchema.optional(),
    lostAt: TimestampSchema.optional(),
    recoveredAt: TimestampSchema.optional(),
    retirementRequestedAt: TimestampSchema.optional(),
    retiredAt: TimestampSchema.optional(),
    reason: NonEmptyStringSchema.optional(),
  })
  .strict();
const DurableSessionRecordSchema = z
  .object({
    sessionKey: NonEmptyStringSchema,
    role: NonEmptyStringSchema,
    actionId: NonEmptyStringSchema.optional(),
    nodeId: NonEmptyStringSchema.optional(),
    invocationId: NonEmptyStringSchema.optional(),
    hostKind: z.literal('stream-json'),
    cwd: NonEmptyStringSchema,
    attachedRoots: z.array(NonEmptyStringSchema),
    space: SessionSpaceSchema.optional(),
    execution: RuntimeExecutionRefSchema.optional(),
    model: NonEmptyStringSchema.optional(),
    effort: NonEmptyStringSchema.optional(),
    claudeSessionId: NonEmptyStringSchema.optional(),
    status: z.enum([
      'starting',
      'idle',
      'waking',
      'lost',
      'stale',
      'retiring',
      'retired',
    ]),
    owner: DurableSessionOwnerSchema.optional(),
    lifecycle: DurableSessionLifecycleSchema,
    touchPolicy: DurableTouchPolicySchema,
    inFlight: DurableDispatchFenceSchema.optional(),
    idempotencyTombstones: z
      .array(DurableIdempotencyTombstoneSchema)
      .max(MAX_DURABLE_IDEMPOTENCY_TOMBSTONES),
    wakes: z.array(DurableTerminalWakeSchema).max(MAX_DURABLE_TERMINAL_WAKES),
  })
  .strict()
  .superRefine((session, context) => {
    if (session.owner !== undefined && session.claudeSessionId === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'An owner binding requires a Claude session identity',
      });
    }
    if (session.status === 'starting') {
      if (
        session.owner !== undefined
        || session.claudeSessionId !== undefined
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'A starting session is an unbound bootstrap reservation only',
        });
      }
    }
    if (session.status === 'idle') {
      if (session.owner === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'An idle session requires a current owner binding',
        });
      }
      if (session.inFlight !== undefined) {
        context.addIssue({
          code: 'custom',
          message: 'An idle session cannot retain in-flight delivery',
        });
      }
    }
    if (session.status === 'waking') {
      if (session.claudeSessionId === undefined || session.inFlight === undefined) {
        context.addIssue({
          code: 'custom',
          message:
            'A waking session requires a Claude identity and in-flight delivery',
        });
      }
    } else if (
      session.status !== 'starting'
      && session.inFlight !== undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: 'In-flight delivery requires waking or bootstrap status',
      });
    }
    if (
      (
        session.status === 'lost'
        || session.status === 'stale'
        || session.status === 'retired'
      )
      && session.owner !== undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: `${session.status} sessions cannot retain an owner binding`,
      });
    }
    if (
      (
        session.status === 'lost'
        || session.status === 'stale'
        || session.status === 'retiring'
      )
      && session.inFlight !== undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: `${session.status} sessions cannot retain in-flight delivery`,
      });
    }
    if (session.status === 'retired' && session.lifecycle.retiredAt === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'A retired session requires retiredAt',
      });
    }
    if (session.status === 'retired' && session.inFlight !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'A retired session cannot retain in-flight delivery',
      });
    }
    let previousTombstoneDigest: string | undefined;
    const durableDispositionByDigest = new Map<string, DurableWakeOutcome>();
    for (const tombstone of session.idempotencyTombstones) {
      if (
        previousTombstoneDigest !== undefined
        && previousTombstoneDigest >= tombstone.messageIdDigest
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Idempotency tombstones must have unique, strictly ascending digests',
        });
      }
      previousTombstoneDigest = tombstone.messageIdDigest;
      durableDispositionByDigest.set(
        tombstone.messageIdDigest,
        tombstone.disposition
      );
    }
    const presentationDigests = new Set<string>();
    for (const wake of session.wakes) {
      if (presentationDigests.has(wake.messageIdDigest)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate terminal wake ${wake.messageIdDigest}`,
        });
      }
      presentationDigests.add(wake.messageIdDigest);
      const disposition = durableDispositionByDigest.get(wake.messageIdDigest);
      if (disposition === undefined || disposition !== wake.outcome) {
        context.addIssue({
          code: 'custom',
          message:
            `Presentation wake ${wake.messageIdDigest} lacks its durable disposition`,
        });
      }
    }
    if (
      session.inFlight
      && durableDispositionByDigest.has(session.inFlight.messageIdDigest)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'An in-flight message cannot already be terminal',
      });
    }
    if (
      session.inFlight
      && session.idempotencyTombstones.length
        >= MAX_DURABLE_IDEMPOTENCY_TOMBSTONES
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A full idempotency index cannot retain an in-flight message',
      });
    }
  });

export const DurableSessionRegistrySchema = z
  .object({
    schema: z.literal(DURABLE_SESSION_REGISTRY_SCHEMA),
    runId: NonEmptyStringSchema,
    revision: z.number().int().nonnegative(),
    updatedAt: TimestampSchema,
    launcherSessionIds: z.array(NonEmptyStringSchema),
    sessions: z.array(DurableSessionRecordSchema),
  })
  .strict()
  .superRefine((registry, context) => {
    const launchers = new Set<string>();
    for (const launcher of registry.launcherSessionIds) {
      if (launchers.has(launcher)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate launcher session identity ${launcher}`,
        });
      }
      launchers.add(launcher);
    }
    const sessions = new Set<string>();
    for (const session of registry.sessions) {
      if (sessions.has(session.sessionKey)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate logical session identity ${session.sessionKey}`,
        });
      }
      sessions.add(session.sessionKey);
    }
  });

function errnoCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

function diagnostic(
  code: DurableRegistryDiagnosticCode,
  message: string,
  targetPath?: string,
  cause?: unknown
): DurableRegistryDiagnostic {
  return {
    code,
    message,
    ...(targetPath !== undefined ? { path: targetPath } : {}),
    ...(errnoCode(cause) !== undefined ? { causeCode: errnoCode(cause) } : {}),
  };
}

class DurableRegistryFault extends Error {
  readonly diagnostic: DurableRegistryDiagnostic;

  constructor(value: DurableRegistryDiagnostic) {
    super(value.message);
    this.name = 'DurableRegistryFault';
    this.diagnostic = value;
  }
}

class DurableWakeLeaseFault extends Error {
  readonly kind: FileLockErrorKind;
  readonly info: FileLockErrorInfo;

  constructor(kind: FileLockErrorKind, info: FileLockErrorInfo) {
    super(`Durable wake lease ${kind}`);
    this.name = 'DurableWakeLeaseFault';
    this.kind = kind;
    this.info = info;
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowIso(clock: () => Date | string): string {
  const value = clock();
  const timestamp = typeof value === 'string' ? value : value.toISOString();
  if (!TimestampSchema.safeParse(timestamp).success) {
    throw new Error(`Clock returned a non-canonical timestamp: ${timestamp}`);
  }
  return timestamp;
}

export function durablePathIdentity(
  targetPath: string,
  platform: NodeJS.Platform = process.platform
): string {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const normalized = pathApi.normalize(targetPath);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function durablePathsEqual(
  left: string,
  right: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  return durablePathIdentity(left, platform) === durablePathIdentity(right, platform);
}

function canonicalExistingDirectory(
  targetPath: string,
  filesystem: DurableRegistryFileSystem,
  label: string,
  rejectAlias: boolean
): string {
  if (!path.isAbsolute(targetPath)) {
    throw new DurableRegistryFault(
      diagnostic(
        'run_directory_invalid',
        `${label} must be an absolute existing directory.`,
        targetPath
      )
    );
  }
  let presentedStat: fs.Stats;
  let canonicalStat: fs.Stats;
  let canonical: string;
  try {
    presentedStat = filesystem.lstat(targetPath);
    canonical = filesystem.realpath(targetPath);
    canonicalStat = filesystem.lstat(canonical);
  } catch (error) {
    throw new DurableRegistryFault(
      diagnostic(
        'run_directory_invalid',
        `${label} cannot be resolved as an existing directory.`,
        targetPath,
        error
      )
    );
  }
  if (
    !canonicalStat.isDirectory()
    || canonicalStat.isSymbolicLink()
    || (rejectAlias && (
      !presentedStat.isDirectory()
      || presentedStat.isSymbolicLink()
    ))
  ) {
    throw new DurableRegistryFault(
      diagnostic(
        'run_directory_invalid',
        `${label} must be a non-symlink directory.`,
        targetPath
      )
    );
  }
  if (rejectAlias && !durablePathsEqual(path.resolve(targetPath), canonical)) {
    throw new DurableRegistryFault(
      diagnostic(
        'run_directory_invalid',
        `${label} is not the trusted canonical directory.`,
        targetPath
      )
    );
  }
  return canonical;
}

export function resolveDurableSessionRegistryPaths(
  run: TrustedCanonicalRunRef,
  filesystem: DurableRegistryFileSystem = nodeDurableRegistryFileSystem
): DurableSessionRegistryPaths {
  if (run.kind !== 'trusted-canonical-run' || run.runId.trim().length === 0) {
    throw new DurableRegistryFault(
      diagnostic(
        'run_directory_invalid',
        'Durable session storage requires trusted canonical Run admission.',
        run.canonicalRunDir
      )
    );
  }
  const canonicalRunDir = canonicalExistingDirectory(
    run.canonicalRunDir,
    filesystem,
    'The canonical Run directory',
    true
  );
  return {
    canonicalRunDir,
    registryPath: path.join(canonicalRunDir, REGISTRY_FILE_NAME),
    mutationLockPath: path.join(canonicalRunDir, REGISTRY_LOCK_FILE_NAME),
    wakeLockDirectory: path.join(canonicalRunDir, WAKE_LOCK_DIRECTORY_NAME),
  };
}

export function durableSessionWakeLockPath(
  paths: DurableSessionRegistryPaths,
  sessionKey: string,
  platform: NodeJS.Platform = process.platform
): string {
  const digest = createHash('sha256').update(sessionKey, 'utf-8').digest('hex');
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  return pathApi.join(paths.wakeLockDirectory, `${digest}.lock`);
}

function strictRead(
  paths: DurableSessionRegistryPaths,
  runId: string,
  filesystem: DurableRegistryFileSystem
): DurableRegistryReadResult {
  let stat: fs.Stats;
  try {
    stat = filesystem.lstat(paths.registryPath);
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') {
      return {
        ok: false,
        diagnostic: diagnostic(
          'registry_absent',
          `No reusable-session registry exists for run ${runId}.`,
          paths.registryPath
        ),
      };
    }
    return {
      ok: false,
      diagnostic: diagnostic(
        'registry_corrupt',
        `The reusable-session registry cannot be inspected.`,
        paths.registryPath,
        error
      ),
    };
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return {
      ok: false,
      diagnostic: diagnostic(
        'registry_corrupt',
        'The reusable-session registry must be a regular non-symlink file.',
        paths.registryPath
      ),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(filesystem.readText(paths.registryPath));
  } catch (error) {
    return {
      ok: false,
      diagnostic: diagnostic(
        'registry_corrupt',
        'The reusable-session registry is not complete valid JSON.',
        paths.registryPath,
        error
      ),
    };
  }
  const declaredSchema = (
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { schema?: unknown }).schema
      : undefined
  );
  if (declaredSchema !== DURABLE_SESSION_REGISTRY_SCHEMA) {
    return {
      ok: false,
      diagnostic: diagnostic(
        'unsupported_schema',
        `Unsupported reusable-session registry schema ${String(declaredSchema)}.`,
        paths.registryPath
      ),
    };
  }
  const validated = DurableSessionRegistrySchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      diagnostic: diagnostic(
        'registry_corrupt',
        'The reusable-session registry does not match its strict schema.',
        paths.registryPath
      ),
    };
  }
  if (validated.data.runId !== runId) {
    return {
      ok: false,
      diagnostic: diagnostic(
        'run_mismatch',
        `The reusable-session registry belongs to run ${validated.data.runId}, not ${runId}.`,
        paths.registryPath
      ),
    };
  }
  return {
    ok: true,
    registry: validated.data as DurableSessionRegistryDocument,
  };
}

function normalizedRegistry(
  registry: DurableSessionRegistryDocument
): DurableSessionRegistryDocument {
  return {
    schema: DURABLE_SESSION_REGISTRY_SCHEMA,
    runId: registry.runId,
    revision: registry.revision,
    updatedAt: registry.updatedAt,
    launcherSessionIds: [...registry.launcherSessionIds].sort(),
    sessions: [...registry.sessions]
      .map((session) => ({
        ...session,
        attachedRoots: [...session.attachedRoots],
        idempotencyTombstones: [...session.idempotencyTombstones].sort(
          (left, right) => compareMessageIdDigests(
            left.messageIdDigest,
            right.messageIdDigest
          )
        ),
        wakes: [...session.wakes]
          .sort((left, right) => left.settledAt.localeCompare(right.settledAt))
          .slice(-MAX_DURABLE_TERMINAL_WAKES),
      }))
      .sort((left, right) => left.sessionKey.localeCompare(right.sessionKey)),
  };
}

function compareMessageIdDigests(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function registryBytes(registry: DurableSessionRegistryDocument): string {
  return `${JSON.stringify(normalizedRegistry(registry), null, 2)}\n`;
}

async function sleepDefault(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

interface DurableStoreInternal {
  run: TrustedCanonicalRunRef;
  paths: DurableSessionRegistryPaths;
  filesystem: DurableRegistryFileSystem;
  clock: () => Date | string;
  transact<T>(
    allowAbsent: boolean,
    mutate: (registry: DurableSessionRegistryDocument) => T
  ): Promise<
    | { ok: true; registry: DurableSessionRegistryDocument; value: T }
      | { ok: false; diagnostic: DurableRegistryDiagnostic }
  >;
  transactPair<TFirst, TSecond>(
    first: (registry: DurableSessionRegistryDocument) => TFirst,
    second: (registry: DurableSessionRegistryDocument) => TSecond
  ): Promise<
    | {
        ok: true;
        registry: DurableSessionRegistryDocument;
        value: readonly [TFirst, TSecond];
      }
    | { ok: false; diagnostic: DurableRegistryDiagnostic }
  >;
}

const durableStoreInternals = new WeakMap<
  DurableSessionRegistryStore,
  DurableStoreInternal
>();

function pidLiveness(pid: number): 'live' | 'dead' | 'ambiguous' {
  try {
    process.kill(pid, 0);
    return 'live';
  } catch (error) {
    const code = errnoCode(error);
    if (code === 'ESRCH') return 'dead';
    if (code === 'EPERM') return 'live';
    return 'ambiguous';
  }
}

function classifyWakeLeaseFailure(
  fault: DurableWakeLeaseFault,
  internal: DurableStoreInternal,
  lockPath: string
): DurableWakeLeaseDiagnostic {
  const causeCode = errnoCode(fault.info.cause);
  if (
    fault.kind === 'create-failed'
    && (causeCode === 'EACCES' || causeCode === 'EPERM')
  ) {
    return {
      code: 'wake_lock_permission',
      message: `Permission denied while acquiring the reusable-session wake lease.`,
      lockPath,
      ownerState: 'permission',
      ...(causeCode !== undefined ? { causeCode } : {}),
    };
  }
  if (fault.kind === 'create-failed') {
    return {
      code: 'wake_lock_error',
      message: `The reusable-session wake lease could not be acquired.`,
      lockPath,
      ownerState: 'ambiguous',
      ...(causeCode !== undefined ? { causeCode } : {}),
    };
  }

  let content: string;
  try {
    content = internal.filesystem.readText(lockPath);
  } catch (error) {
    const readCode = errnoCode(error);
    return {
      code:
        readCode === 'EACCES' || readCode === 'EPERM'
          ? 'wake_lock_permission'
          : 'wake_lock_timeout',
      message:
        readCode === 'EACCES' || readCode === 'EPERM'
          ? 'The reusable-session wake lease owner cannot be inspected due to permissions.'
          : 'The reusable-session wake lease remained ambiguously owned until timeout.',
      lockPath,
      ownerState:
        readCode === 'EACCES' || readCode === 'EPERM'
          ? 'permission'
          : 'ambiguous',
      ...(readCode !== undefined ? { causeCode: readCode } : {}),
    };
  }
  const match = content.match(/^pid:\s*(\d+)$/mu);
  if (!match) {
    return {
      code: 'wake_lock_malformed',
      message: 'The reusable-session wake lease has malformed owner metadata.',
      lockPath,
      ownerState: 'malformed',
    };
  }
  const ownerPid = Number(match[1]);
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
    return {
      code: 'wake_lock_malformed',
      message: 'The reusable-session wake lease has malformed owner metadata.',
      lockPath,
      ownerState: 'malformed',
    };
  }
  const ownerState = pidLiveness(ownerPid);
  if (ownerState === 'live') {
    return {
      code: 'wake_busy',
      message: `Reusable session wake is already owned by live process ${ownerPid}.`,
      lockPath,
      ownerState,
      ownerPid,
    };
  }
  return {
    code: 'wake_lock_timeout',
    message:
      ownerState === 'dead'
        ? 'A proven-dead wake owner changed during reclamation; acquisition timed out safely.'
        : 'The reusable-session wake lease owner liveness is ambiguous.',
    lockPath,
    ownerState,
    ownerPid,
  };
}

export async function acquireDurableSessionWakeLease(
  options: AcquireDurableSessionWakeLeaseOptions
): Promise<AcquireDurableSessionWakeLeaseResult> {
  const internal = durableStoreInternals.get(options.store);
  const lockPath = durableSessionWakeLockPath(
    options.store.paths,
    options.sessionKey
  );
  if (!internal) {
    return {
      ok: false,
      diagnostic: {
        code: 'wake_lock_error',
        message: 'The wake lease requires a durable registry store from this module.',
        lockPath,
        ownerState: 'ambiguous',
      },
    };
  }
  try {
    const handle = await acquireOwnerAwareFileLock({
      lockPath,
      errorFor: (kind, info) => new DurableWakeLeaseFault(kind, info),
      deadlineMs: options.deadlineMs,
      pollMs: options.pollMs,
      holder: `session-wake:${internal.run.runId}:${options.ownerInstanceId}`,
    });
    let released = false;
    return {
      ok: true,
      lease: {
        lockPath,
        async release() {
          if (released) return;
          released = true;
          await releaseOwnerAwareFileLock(handle);
        },
      },
    };
  } catch (error) {
    if (error instanceof DurableWakeLeaseFault) {
      return {
        ok: false,
        diagnostic: classifyWakeLeaseFailure(error, internal, lockPath),
      };
    }
    return {
      ok: false,
      diagnostic: {
        code: 'wake_lock_error',
        message: 'The reusable-session wake lease failed unexpectedly.',
        lockPath,
        ownerState: 'ambiguous',
        ...(errnoCode(error) !== undefined
          ? { causeCode: errnoCode(error) }
          : {}),
      },
    };
  }
}

function lockError(
  kind: FileLockErrorKind,
  info: FileLockErrorInfo
): DurableRegistryFault {
  const code = errnoCode(info.cause);
  if (kind === 'timeout') {
    return new DurableRegistryFault(
      diagnostic(
        'registry_lock_timeout',
        'The reusable-session registry is busy.',
        info.lockPath
      )
    );
  }
  return new DurableRegistryFault(
    diagnostic(
      code === 'EACCES' || code === 'EPERM'
        ? 'registry_lock_permission'
        : 'registry_write_failed',
      'The reusable-session registry lock could not be created.',
      info.lockPath,
      info.cause
    )
  );
}

export function createDurableSessionRegistryStore(
  options: CreateDurableSessionRegistryStoreOptions
): DurableSessionRegistryStore {
  const filesystem = options.filesystem ?? nodeDurableRegistryFileSystem;
  const paths = resolveDurableSessionRegistryPaths(options.run, filesystem);
  const clock = options.clock ?? (() => new Date());
  const sleep = options.sleep ?? sleepDefault;
  const platform = options.platform ?? process.platform;

  async function replaceRegistry(registry: DurableSessionRegistryDocument): Promise<void> {
    const temporaryPath = path.join(
      paths.canonicalRunDir,
      `.${REGISTRY_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`
    );
    let temporaryCreated = false;
    try {
      filesystem.writeExclusive(temporaryPath, registryBytes(registry));
      temporaryCreated = true;
      filesystem.flushFile(temporaryPath);
      const deadline = Date.now() + (options.replaceDeadlineMs ?? 1_000);
      while (true) {
        try {
          filesystem.replace(temporaryPath, paths.registryPath);
          temporaryCreated = false;
          break;
        } catch (error) {
          if (
            platform !== 'win32'
            || !WINDOWS_REPLACE_ERROR_CODES.has(errnoCode(error) ?? '')
            || Date.now() >= deadline
          ) {
            throw error;
          }
          await sleep(Math.max(1, options.replacePollMs ?? 25));
        }
      }
      try {
        filesystem.flushDirectory(paths.canonicalRunDir);
      } catch {
        // Directory flush is best-effort. The replaced file itself was
        // flushed before rename and remains a complete registry revision.
      }
    } catch (error) {
      if (temporaryCreated) {
        try {
          filesystem.remove(temporaryPath);
        } catch {
          // Cleanup is residue-only. Never hide the primary write failure or
          // remove any path that this writer did not name.
        }
      }
      throw new DurableRegistryFault(
        diagnostic(
          'registry_write_failed',
          'The reusable-session registry could not be replaced atomically.',
          paths.registryPath,
          error
        )
      );
    }
  }

  async function commitMutation<T>(
    registry: DurableSessionRegistryDocument,
    mutate: (registry: DurableSessionRegistryDocument) => T
  ): Promise<{
    registry: DurableSessionRegistryDocument;
    value: T;
  }> {
    const previousRevision = registry.revision;
    const value = mutate(registry);
    registry.revision = previousRevision + 1;
    registry.updatedAt = nowIso(clock);
    const normalized = normalizedRegistry(registry);
    const validated = DurableSessionRegistrySchema.safeParse(normalized);
    if (!validated.success || validated.data.runId !== options.run.runId) {
      throw new DurableRegistryFault(
        diagnostic(
          'invalid_transition',
          'The requested reusable-session transition would create invalid state.',
          paths.registryPath
        )
      );
    }
    const next = validated.data as DurableSessionRegistryDocument;
    await replaceRegistry(next);
    return { registry: next, value };
  }

  const internal: DurableStoreInternal = {
    run: options.run,
    paths,
    filesystem,
    clock,
    async transact<T>(
      allowAbsent: boolean,
      mutate: (registry: DurableSessionRegistryDocument) => T
    ) {
      let lock;
      try {
        lock = await acquireOwnerAwareFileLock({
          lockPath: paths.mutationLockPath,
          errorFor: lockError,
          deadlineMs: options.lockDeadlineMs,
          pollMs: options.lockPollMs,
          holder: `session-registry:${options.run.runId}`,
        });
        const current = strictRead(paths, options.run.runId, filesystem);
        let registry: DurableSessionRegistryDocument;
        if (!current.ok) {
          if (!allowAbsent || current.diagnostic.code !== 'registry_absent') {
            return current;
          }
          const createdAt = nowIso(clock);
          registry = {
            schema: DURABLE_SESSION_REGISTRY_SCHEMA,
            runId: options.run.runId,
            revision: 0,
            updatedAt: createdAt,
            launcherSessionIds: [],
            sessions: [],
          };
        } else {
          registry = cloneJson(current.registry);
        }
        const committed = await commitMutation(registry, mutate);
        return {
          ok: true,
          registry: cloneJson(committed.registry),
          value: committed.value,
        };
      } catch (error) {
        if (error instanceof DurableRegistryFault) {
          return { ok: false, diagnostic: error.diagnostic };
        }
        return {
          ok: false,
          diagnostic: diagnostic(
            'registry_write_failed',
            'The reusable-session registry transaction failed.',
            paths.registryPath,
            error
          ),
        };
      } finally {
        if (lock) await releaseOwnerAwareFileLock(lock);
      }
    },
    async transactPair<TFirst, TSecond>(
      first: (registry: DurableSessionRegistryDocument) => TFirst,
      second: (registry: DurableSessionRegistryDocument) => TSecond
    ) {
      let lock;
      try {
        lock = await acquireOwnerAwareFileLock({
          lockPath: paths.mutationLockPath,
          errorFor: lockError,
          deadlineMs: options.lockDeadlineMs,
          pollMs: options.lockPollMs,
          holder: `session-registry:${options.run.runId}`,
        });
        const current = strictRead(paths, options.run.runId, filesystem);
        if (!current.ok) return current;
        const firstCommitted = await commitMutation(
          cloneJson(current.registry),
          first
        );
        const secondCommitted = await commitMutation(
          cloneJson(firstCommitted.registry),
          second
        );
        return {
          ok: true,
          registry: cloneJson(secondCommitted.registry),
          value: [
            firstCommitted.value,
            secondCommitted.value,
          ] as const,
        };
      } catch (error) {
        if (error instanceof DurableRegistryFault) {
          return { ok: false, diagnostic: error.diagnostic };
        }
        return {
          ok: false,
          diagnostic: diagnostic(
            'registry_write_failed',
            'The reusable-session registry transaction failed.',
            paths.registryPath,
            error
          ),
        };
      } finally {
        if (lock) await releaseOwnerAwareFileLock(lock);
      }
    },
  };

  const store: DurableSessionRegistryStore = {
    paths,
    async read() {
      const result = strictRead(paths, options.run.runId, filesystem);
      return result.ok
        ? { ok: true, registry: cloneJson(result.registry) }
        : result;
    },
    async get(sessionKey) {
      const result = strictRead(paths, options.run.runId, filesystem);
      if (!result.ok) return result;
      const session = result.registry.sessions.find(
        (candidate) => candidate.sessionKey === sessionKey
      );
      if (!session) {
        return {
          ok: false,
          diagnostic: diagnostic(
            'session_not_found',
            `Reusable session ${sessionKey} does not exist.`,
            paths.registryPath
          ),
        };
      }
      return {
        ok: true,
        session: cloneJson(session),
        registry: cloneJson(result.registry),
      };
    },
    async list() {
      const result = strictRead(paths, options.run.runId, filesystem);
      return result.ok
        ? {
            ok: true,
            sessions: cloneJson(result.registry.sessions),
            registry: cloneJson(result.registry),
          }
        : result;
    },
    async reserve(input) {
      let cwd: string;
      let attachedRoots: string[];
      try {
        cwd = canonicalExistingDirectory(
          input.cwd,
          filesystem,
          'The reusable-session cwd',
          false
        );
        attachedRoots = [...(input.attachedRoots ?? [])].map((root) =>
          canonicalExistingDirectory(
            root,
            filesystem,
            'A reusable-session attached root',
            false
          )
        );
      } catch (error) {
        return {
          ok: false,
          diagnostic:
            error instanceof DurableRegistryFault
              ? error.diagnostic
              : diagnostic(
                  'run_directory_invalid',
                  'Reusable-session launch facts contain an invalid path.',
                  input.cwd,
                  error
                ),
        };
      }
      const result = await internal.transact(true, (registry) => {
        if (
          registry.sessions.some(
            (candidate) => candidate.sessionKey === input.sessionKey
          )
        ) {
          throw new DurableRegistryFault(
            diagnostic(
              'session_conflict',
              `Reusable session ${input.sessionKey} already exists.`,
              paths.registryPath
            )
          );
        }
        const createdAt = nowIso(clock);
        const session: DurableSessionRecord = {
          sessionKey: input.sessionKey,
          role: input.role,
          ...(input.actionId !== undefined
            ? { actionId: input.actionId }
            : {}),
          ...(input.nodeId !== undefined ? { nodeId: input.nodeId } : {}),
          ...(input.invocationId !== undefined
            ? { invocationId: input.invocationId }
            : {}),
          hostKind: 'stream-json',
          cwd,
          attachedRoots,
          ...(input.space !== undefined
            ? { space: cloneJson(input.space) }
            : {}),
          ...(input.execution !== undefined
            ? { execution: cloneJson(input.execution) }
            : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(input.effort !== undefined ? { effort: input.effort } : {}),
          status: 'starting',
          lifecycle: {
            createdAt,
            updatedAt: createdAt,
            reason: 'registration_reserved',
          },
          touchPolicy: cloneJson(input.touchPolicy),
          idempotencyTombstones: [],
          wakes: [],
        };
        registry.sessions.push(session);
        if (
          input.launcherSessionId !== undefined
          && !registry.launcherSessionIds.includes(input.launcherSessionId)
        ) {
          registry.launcherSessionIds.push(input.launcherSessionId);
        }
        return input.sessionKey;
      });
      if (!result.ok) return result;
      const session = result.registry.sessions.find(
        (candidate) => candidate.sessionKey === result.value
      );
      if (!session) {
        return {
          ok: false,
          diagnostic: diagnostic(
            'registry_corrupt',
            'The committed registry lost its reserved session.',
            paths.registryPath
          ),
        };
      }
      return {
        ok: true,
        registry: result.registry,
        session: cloneJson(session),
      };
    },
    async bind(input) {
      const result = await internal.transact(false, (registry) => {
        const session = registry.sessions.find(
          (candidate) => candidate.sessionKey === input.sessionKey
        );
        if (!session) {
          throw new DurableRegistryFault(
            diagnostic(
              'session_not_found',
              `Reusable session ${input.sessionKey} does not exist.`,
              paths.registryPath
            )
          );
        }
        if (session.status !== 'starting') {
          throw new DurableRegistryFault(
            diagnostic(
              'invalid_transition',
              `Reusable session ${input.sessionKey} is no longer awaiting bootstrap binding.`,
              paths.registryPath
            )
          );
        }
        session.claudeSessionId = input.claudeSessionId;
        session.owner = cloneJson(input.owner);
        session.status = 'idle';
        session.lifecycle.reason = 'bootstrap_bound';
        return input.sessionKey;
      });
      if (!result.ok) return result;
      const session = result.registry.sessions.find(
        (candidate) => candidate.sessionKey === result.value
      );
      if (!session) {
        return {
          ok: false,
          diagnostic: diagnostic(
            'registry_corrupt',
            'The committed registry lost its bound session.',
            paths.registryPath
          ),
        };
      }
      return {
        ok: true,
        registry: result.registry,
        session: cloneJson(session),
      };
    },
    async register(input) {
      let cwd: string;
      let attachedRoots: string[];
      try {
        cwd = canonicalExistingDirectory(
          input.cwd,
          filesystem,
          'The reusable-session cwd',
          false
        );
        attachedRoots = [...(input.attachedRoots ?? [])].map((root) =>
          canonicalExistingDirectory(
            root,
            filesystem,
            'A reusable-session attached root',
            false
          )
        );
      } catch (error) {
        return {
          ok: false,
          diagnostic:
            error instanceof DurableRegistryFault
              ? error.diagnostic
              : diagnostic(
                  'run_directory_invalid',
                  'Reusable-session launch facts contain an invalid path.',
                  input.cwd,
                  error
                ),
        };
      }
      const result = await internal.transact(true, (registry) => {
        if (
          registry.sessions.some(
            (candidate) => candidate.sessionKey === input.sessionKey
          )
        ) {
          throw new DurableRegistryFault(
            diagnostic(
              'session_conflict',
              `Reusable session ${input.sessionKey} already exists.`,
              paths.registryPath
            )
          );
        }
        const createdAt = nowIso(clock);
        const session: DurableSessionRecord = {
          sessionKey: input.sessionKey,
          role: input.role,
          ...(input.actionId !== undefined
            ? { actionId: input.actionId }
            : {}),
          ...(input.nodeId !== undefined ? { nodeId: input.nodeId } : {}),
          ...(input.invocationId !== undefined
            ? { invocationId: input.invocationId }
            : {}),
          hostKind: 'stream-json',
          cwd,
          attachedRoots,
          ...(input.space !== undefined
            ? { space: cloneJson(input.space) }
            : {}),
          ...(input.execution !== undefined
            ? { execution: cloneJson(input.execution) }
            : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(input.effort !== undefined ? { effort: input.effort } : {}),
          claudeSessionId: input.claudeSessionId,
          status: 'idle',
          owner: cloneJson(input.owner),
          lifecycle: {
            createdAt,
            updatedAt: createdAt,
          },
          touchPolicy: cloneJson(input.touchPolicy),
          idempotencyTombstones: [],
          wakes: [],
        };
        registry.sessions.push(session);
        if (
          input.launcherSessionId !== undefined
          && !registry.launcherSessionIds.includes(input.launcherSessionId)
        ) {
          registry.launcherSessionIds.push(input.launcherSessionId);
        }
        return input.sessionKey;
      });
      if (!result.ok) return result;
      const session = result.registry.sessions.find(
        (candidate) => candidate.sessionKey === result.value
      );
      if (!session) {
        return {
          ok: false,
          diagnostic: diagnostic(
            'registry_corrupt',
            'The committed registry lost its newly registered session.',
            paths.registryPath
          ),
        };
      }
      return {
        ok: true,
        registry: result.registry,
        session: cloneJson(session),
      };
    },
  };

  durableStoreInternals.set(store, internal);
  return store;
}

export type ClaudeTranscriptFacts =
  | {
      exists: true;
      path: string;
      canonicalPath: string;
      size: number;
      mtimeMs: number;
    }
  | {
      exists: false;
      path: string;
      reason:
        | 'missing'
        | 'invalid_session_identity'
        | 'not_regular'
        | 'symlink'
        | 'unreadable';
    };

export type ClaudeTranscriptProbe = (input: {
  cwd: string;
  claudeSessionId: string;
}) => ClaudeTranscriptFacts | Promise<ClaudeTranscriptFacts>;

export interface CreateExactClaudeTranscriptProbeOptions {
  filesystem?: DurableRegistryFileSystem;
  homeDir?: string;
  projectsDirectoryForCwd?: (cwd: string) => string;
}

export function createExactClaudeTranscriptProbe(
  options: CreateExactClaudeTranscriptProbeOptions = {}
): ClaudeTranscriptProbe {
  const filesystem = options.filesystem ?? nodeDurableRegistryFileSystem;
  const projectsDirectoryForCwd =
    options.projectsDirectoryForCwd
    ?? ((cwd: string) => claudeProjectsDir(cwd, options.homeDir));
  return ({ cwd, claudeSessionId }) => {
    const projectDirectory = projectsDirectoryForCwd(cwd);
    if (
      claudeSessionId.length === 0
      || claudeSessionId === '.'
      || claudeSessionId === '..'
      || path.basename(claudeSessionId) !== claudeSessionId
      || claudeSessionId.includes('/')
      || claudeSessionId.includes('\\')
    ) {
      return {
        exists: false,
        path: path.join(projectDirectory, `${createHash('sha256')
          .update(claudeSessionId, 'utf-8')
          .digest('hex')}.invalid`),
        reason: 'invalid_session_identity',
      };
    }
    const transcriptPath = path.join(
      projectDirectory,
      `${claudeSessionId}.jsonl`
    );
    let stat: fs.Stats;
    try {
      stat = filesystem.lstat(transcriptPath);
    } catch (error) {
      return {
        exists: false,
        path: transcriptPath,
        reason: errnoCode(error) === 'ENOENT' ? 'missing' : 'unreadable',
      };
    }
    if (stat.isSymbolicLink()) {
      return { exists: false, path: transcriptPath, reason: 'symlink' };
    }
    if (!stat.isFile()) {
      return { exists: false, path: transcriptPath, reason: 'not_regular' };
    }
    let canonicalPath: string;
    try {
      canonicalPath = filesystem.realpath(transcriptPath);
    } catch {
      return { exists: false, path: transcriptPath, reason: 'unreadable' };
    }
    return {
      exists: true,
      path: transcriptPath,
      canonicalPath,
      size: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, stat.size)),
      mtimeMs: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, stat.mtimeMs)),
    };
  };
}

export interface RegisterSessionHostInput extends HostTurnInput {
  sessionKey: string;
  messageId: string;
  role: string;
  actionId?: string;
  nodeId?: string;
  invocationId?: string;
  cwd: string;
  attachedRoots?: readonly string[];
  space?: SessionSpace;
  execution?: RuntimeExecutionRef;
  model?: string;
  effort?: string;
  touchPolicy: DurableTouchPolicy;
  launcherSessionId?: string;
}

const RegisterSessionHostInputSchema = z
  .object({
    sessionKey: NonEmptyStringSchema,
    messageId: NonEmptyStringSchema,
    role: NonEmptyStringSchema,
    actionId: NonEmptyStringSchema.optional(),
    nodeId: NonEmptyStringSchema.optional(),
    invocationId: NonEmptyStringSchema.optional(),
    message: NonEmptyStringSchema,
    timeoutMs: z.number().int().positive(),
    noOutputTimeoutMs: z.number().int().positive(),
    cwd: NonEmptyStringSchema,
    attachedRoots: z.array(NonEmptyStringSchema).optional(),
    space: SessionSpaceSchema.optional(),
    execution: RuntimeExecutionRefSchema.optional(),
    model: NonEmptyStringSchema.optional(),
    effort: NonEmptyStringSchema.optional(),
    touchPolicy: DurableTouchPolicySchema,
    launcherSessionId: NonEmptyStringSchema.optional(),
  })
  .strict();

export interface WakeDurableSessionInput extends HostTurnInput {
  sessionKey: string;
  messageId: string;
  kind?: 'interactive' | 'touch';
  expectedLastWakeAt?: string;
  touchOrdinal?: number;
  touchAttempt?: number;
}

const WakeDurableSessionInputSchema = z
  .object({
    sessionKey: NonEmptyStringSchema,
    messageId: NonEmptyStringSchema,
    message: NonEmptyStringSchema,
    timeoutMs: z.number().int().positive(),
    noOutputTimeoutMs: z.number().int().positive(),
    kind: z.enum(['interactive', 'touch']).optional(),
    expectedLastWakeAt: TimestampSchema.optional(),
    touchOrdinal: z.number().int().positive().optional(),
    touchAttempt: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.kind === 'touch'
      && (input.touchOrdinal === undefined || input.touchAttempt === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A touch wake requires its ordinal and attempt',
      });
    }
    if (
      input.kind !== 'touch'
      && (input.touchOrdinal !== undefined || input.touchAttempt !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Only a touch wake may carry touch metadata',
      });
    }
  });

export type SessionHostCoordinatorErrorCode =
  | DurableRegistryDiagnosticCode
  | DurableWakeLeaseDiagnosticCode
  | HostErrorCode
  | 'session_stale'
  | 'session_retired'
  | 'session_unrecoverable'
  | 'duplicate_message'
  | 'conditional_wake_stale'
  | 'owner_shutdown_failed';

export interface SessionHostCoordinatorFailure {
  ok: false;
  code: SessionHostCoordinatorErrorCode;
  message: string;
  diagnostic?: DurableRegistryDiagnostic | DurableWakeLeaseDiagnostic;
  session?: DurableSessionRecord;
  wake?: DurableTerminalWake;
}

export type CoordinatorSessionResult =
  | { ok: true; session: DurableSessionRecord }
  | SessionHostCoordinatorFailure;

export type CoordinatorListResult =
  | { ok: true; sessions: DurableSessionRecord[] }
  | SessionHostCoordinatorFailure;

export type CoordinatorRegisterResult =
  | {
      ok: true;
      disposition: 'completed';
      session: DurableSessionRecord;
      wake: DurableTerminalWake;
      result: HostResultEnvelope;
    }
  | {
      ok: true;
      disposition: 'duplicate';
      terminalDisposition: DurableWakeOutcome;
      messageIdDigest: string;
      session: DurableSessionRecord;
    }
  | SessionHostCoordinatorFailure;

export type CoordinatorWakeResult =
  | {
      ok: true;
      disposition: 'completed';
      session: DurableSessionRecord;
      wake: DurableTerminalWake;
      result: HostResultEnvelope;
    }
  | {
      ok: true;
      disposition: 'duplicate';
      terminalDisposition: DurableWakeOutcome;
      messageIdDigest: string;
      session: DurableSessionRecord;
    }
  | SessionHostCoordinatorFailure;

export interface SessionHostCoordinator {
  readonly ownerInstanceId: string;
  readonly store: DurableSessionRegistryStore;
  register(input: RegisterSessionHostInput): Promise<CoordinatorRegisterResult>;
  get(sessionKey: string): Promise<CoordinatorSessionResult>;
  list(): Promise<CoordinatorListResult>;
  reconcile(sessionKey: string): Promise<CoordinatorSessionResult>;
  wake(input: WakeDurableSessionInput): Promise<CoordinatorWakeResult>;
  retire(sessionKey: string, reason: string): Promise<CoordinatorSessionResult>;
  updateTouchPolicy(
    sessionKey: string,
    policy: DurableTouchPolicy,
    expectedLastWakeAt?: string
  ): Promise<CoordinatorSessionResult>;
  ownerShutdown(): Promise<
    { ok: true; sessions: DurableSessionRecord[] }
    | SessionHostCoordinatorFailure
  >;
}

export interface CreateSessionHostCoordinatorOptions
  extends Omit<CreateDurableSessionRegistryStoreOptions, 'run'> {
  run: TrustedCanonicalRunRef;
  supervisor: SessionSupervisor;
  ownerInstanceId?: string;
  ownerPid?: number;
  transcriptProbe?: ClaudeTranscriptProbe;
  wakeLeaseDeadlineMs?: number;
  wakeLeasePollMs?: number;
}

const ALLOWED_STATUS_TRANSITIONS: Readonly<
  Record<DurableSessionStatus, readonly DurableSessionStatus[]>
> = {
  starting: ['starting', 'idle', 'lost', 'stale', 'retiring'],
  idle: ['idle', 'waking', 'lost', 'stale', 'retiring'],
  waking: ['waking', 'idle', 'lost', 'stale', 'retiring'],
  lost: ['lost', 'waking', 'stale', 'retiring'],
  stale: ['stale', 'retiring'],
  retiring: ['retiring', 'retired', 'lost'],
  retired: ['retired'],
};

function setStatus(
  session: DurableSessionRecord,
  next: DurableSessionStatus
): void {
  if (!ALLOWED_STATUS_TRANSITIONS[session.status].includes(next)) {
    throw new DurableRegistryFault(
      diagnostic(
        'invalid_transition',
        `Reusable session ${session.sessionKey} cannot transition from ${session.status} to ${next}.`
      )
    );
  }
  session.status = next;
}

function coordinatorFailure(
  value: DurableRegistryDiagnostic | DurableWakeLeaseDiagnostic
): SessionHostCoordinatorFailure {
  return {
    ok: false,
    code: value.code,
    message: value.message,
    diagnostic: value,
  };
}

function hostFailure(
  code: HostErrorCode,
  message: string,
  session?: DurableSessionRecord,
  wake?: DurableTerminalWake
): SessionHostCoordinatorFailure {
  return {
    ok: false,
    code,
    message,
    ...(session !== undefined ? { session: cloneJson(session) } : {}),
    ...(wake !== undefined ? { wake: cloneJson(wake) } : {}),
  };
}

function idempotencyCapacityFailure(
  session: DurableSessionRecord,
  registryPath: string
): SessionHostCoordinatorFailure {
  const value = diagnostic(
    'idempotency_capacity_exhausted',
    `Reusable session ${session.sessionKey} has exhausted its durable idempotency capacity.`,
    registryPath
  );
  return {
    ...coordinatorFailure(value),
    session: cloneJson(session),
  };
}

function terminalWake(
  fence: DurableDispatchFence,
  settledAt: string,
  outcome: DurableWakeOutcome,
  code?: string,
  result?: HostResultEnvelope
): DurableTerminalWake {
  return {
    messageIdDigest: fence.messageIdDigest,
    admittedAt: fence.admittedAt,
    ...(fence.dispatchFenceAt !== undefined
      ? { dispatchFenceAt: fence.dispatchFenceAt }
      : {}),
    settledAt,
    outcome,
    ...(fence.kind !== undefined ? { kind: fence.kind } : {}),
    ...(fence.touchOrdinal !== undefined
      ? { touchOrdinal: fence.touchOrdinal }
      : {}),
    ...(fence.touchAttempt !== undefined
      ? { touchAttempt: fence.touchAttempt }
      : {}),
    ...(code !== undefined ? { code } : {}),
    ...(result !== undefined
      ? {
          resultDigest: createHash('sha256')
            .update(JSON.stringify(result), 'utf-8')
            .digest('hex'),
        }
      : {}),
  };
}

function accountTerminalTouch(
  session: DurableSessionRecord,
  wake: DurableTerminalWake
): void {
  if (
    wake.kind !== 'touch'
    || wake.touchOrdinal === undefined
    || wake.outcome === 'pre_delivery_failed'
  ) {
    return;
  }
  session.touchPolicy.touchesUsed = Math.max(
    session.touchPolicy.touchesUsed,
    wake.touchOrdinal
  );
}

function findIdempotencyTombstone(
  tombstones: readonly DurableIdempotencyTombstone[],
  messageIdDigest: string
): { found: DurableIdempotencyTombstone | undefined; insertionIndex: number } {
  let low = 0;
  let high = tombstones.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const comparison = compareMessageIdDigests(
      tombstones[middle].messageIdDigest,
      messageIdDigest
    );
    if (comparison < 0) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const candidate = tombstones[low];
  return {
    found:
      candidate?.messageIdDigest === messageIdDigest
        ? candidate
        : undefined,
    insertionIndex: low,
  };
}

function appendTerminalWake(
  session: DurableSessionRecord,
  wake: DurableTerminalWake
): void {
  const lookup = findIdempotencyTombstone(
    session.idempotencyTombstones,
    wake.messageIdDigest
  );
  if (lookup.found) {
    throw new DurableRegistryFault(
      diagnostic(
        'invalid_transition',
        `Wake digest ${wake.messageIdDigest} is already terminal for ${session.sessionKey}.`
      )
    );
  }
  if (
    session.idempotencyTombstones.length
    >= MAX_DURABLE_IDEMPOTENCY_TOMBSTONES
  ) {
    throw new DurableRegistryFault(
      diagnostic(
        'idempotency_capacity_exhausted',
        `Reusable session ${session.sessionKey} has exhausted its durable idempotency capacity.`
      )
    );
  }
  session.idempotencyTombstones.splice(lookup.insertionIndex, 0, {
    messageIdDigest: wake.messageIdDigest,
    disposition: wake.outcome,
  });
  session.wakes.push(wake);
  if (session.wakes.length > MAX_DURABLE_TERMINAL_WAKES) {
    session.wakes.splice(
      0,
      session.wakes.length - MAX_DURABLE_TERMINAL_WAKES
    );
  }
}

function compatibleHostStatus(host: HostSnapshot): DurableSessionStatus {
  if (host.state === 'idle') return 'idle';
  if (host.state === 'starting' || host.state === 'waking') return 'waking';
  if (host.state === 'retiring') return 'retiring';
  return 'lost';
}

export function createSessionHostCoordinator(
  options: CreateSessionHostCoordinatorOptions
): SessionHostCoordinator {
  const filesystem = options.filesystem ?? nodeDurableRegistryFileSystem;
  const clock = options.clock ?? (() => new Date());
  const ownerInstanceId = options.ownerInstanceId ?? randomUUID();
  const ownerPid = options.ownerPid ?? process.pid;
  const store = createDurableSessionRegistryStore({
    run: options.run,
    platform: options.platform,
    clock,
    filesystem,
    lockDeadlineMs: options.lockDeadlineMs,
    lockPollMs: options.lockPollMs,
    replaceDeadlineMs: options.replaceDeadlineMs,
    replacePollMs: options.replacePollMs,
    sleep: options.sleep,
  });
  const internalCandidate = durableStoreInternals.get(store);
  if (!internalCandidate) {
    throw new Error('Durable registry store internals are unavailable.');
  }
  const internal: DurableStoreInternal = internalCandidate;
  const transcriptProbe =
    options.transcriptProbe
    ?? createExactClaudeTranscriptProbe({ filesystem });
  let observerTail = Promise.resolve();

  async function mutateSession<T>(
    sessionKey: string,
    mutate: (session: DurableSessionRecord) => T
  ): Promise<
    | {
        ok: true;
        registry: DurableSessionRegistryDocument;
        session: DurableSessionRecord;
        value: T;
      }
    | { ok: false; diagnostic: DurableRegistryDiagnostic }
  > {
    const result = await internal.transact(false, (registry) => {
      const session = registry.sessions.find(
        (candidate) => candidate.sessionKey === sessionKey
      );
      if (!session) {
        throw new DurableRegistryFault(
          diagnostic(
            'session_not_found',
            `Reusable session ${sessionKey} does not exist.`,
            store.paths.registryPath
          )
        );
      }
      const value = mutate(session);
      session.lifecycle.updatedAt = nowIso(clock);
      return { sessionKey, value };
    });
    if (!result.ok) return result;
    const session = result.registry.sessions.find(
      (candidate) => candidate.sessionKey === sessionKey
    );
    if (!session) {
      return {
        ok: false,
        diagnostic: diagnostic(
          'registry_corrupt',
          `Reusable session ${sessionKey} disappeared during mutation.`,
          store.paths.registryPath
        ),
      };
    }
    return {
      ok: true,
      registry: result.registry,
      session: cloneJson(session),
      value: result.value.value,
    };
  }

  function reproveStoredCwd(cwd: string): boolean {
    try {
      const stat = filesystem.lstat(cwd);
      return (
        stat.isDirectory()
        && !stat.isSymbolicLink()
        && durablePathsEqual(filesystem.realpath(cwd), cwd)
      );
    } catch {
      return false;
    }
  }

  async function recoveryEvidence(
    session: DurableSessionRecord
  ): Promise<{ eligible: true } | { eligible: false; reason: string }> {
    if (!session.claudeSessionId) {
      return { eligible: false, reason: 'missing_claude_session_identity' };
    }
    if (!reproveStoredCwd(session.cwd)) {
      return { eligible: false, reason: 'canonical_cwd_changed' };
    }
    let facts: ClaudeTranscriptFacts;
    try {
      facts = await transcriptProbe({
        cwd: session.cwd,
        claudeSessionId: session.claudeSessionId,
      });
    } catch {
      return { eligible: false, reason: 'transcript_probe_failed' };
    }
    return facts.exists
      ? { eligible: true }
      : { eligible: false, reason: `transcript_${facts.reason}` };
  }

  async function reconcile(sessionKey: string): Promise<CoordinatorSessionResult> {
    const read = await store.get(sessionKey);
    if (!read.ok) return coordinatorFailure(read.diagnostic);
    const before = read.session;
    if (before.status === 'retired' || before.status === 'stale') {
      return { ok: true, session: before };
    }

    let currentHost: HostSnapshot | undefined;
    let bindingMatches = false;
    if (before.owner?.ownerInstanceId === ownerInstanceId) {
      currentHost = options.supervisor.getHost(before.owner.hostId);
      bindingMatches =
        currentHost !== undefined
        && currentHost.sessionId === before.claudeSessionId
        && durablePathsEqual(currentHost.cwd, before.cwd)
        && (
          currentHost.pid === undefined
          || before.owner.childPid === currentHost.pid
        );
    }
    if (
      before.inFlight !== undefined
      && before.status === 'waking'
      && bindingMatches
    ) {
      // An exact current-owner handle is proof that this coordinator still
      // owns the turn seam. Observability and policy operations must not
      // synthesize an owner crash while that operation is between its durable
      // fence and final settlement.
      return { ok: true, session: before };
    }
    if (
      before.inFlight === undefined
      && bindingMatches
      && currentHost !== undefined
      && before.status === compatibleHostStatus(currentHost)
    ) {
      return { ok: true, session: before };
    }

    const mustEvaluateRecovery =
      !bindingMatches
      || currentHost?.state === 'lost'
      || before.status === 'lost'
      || before.status === 'waking'
      || before.status === 'retiring';
    const evidence = mustEvaluateRecovery
      ? await recoveryEvidence(before)
      : { eligible: true as const };
    if (
      before.status === 'lost'
      && before.owner === undefined
      && before.inFlight === undefined
      && evidence.eligible
    ) {
      return { ok: true, session: before };
    }
    const reconciled = await mutateSession(sessionKey, (session) => {
      const settledAt = nowIso(clock);
      if (session.inFlight && !bindingMatches) {
        const fence = session.inFlight;
        const outcome: DurableWakeOutcome =
          fence.phase === 'admitted'
            ? 'pre_delivery_failed'
            : 'delivery_uncertain';
        const wake = terminalWake(
          fence,
          settledAt,
          outcome,
          fence.phase === 'admitted'
            ? 'owner_lost_before_dispatch'
            : 'owner_lost_after_dispatch_fence'
        );
        appendTerminalWake(session, wake);
        accountTerminalTouch(session, wake);
        if (outcome === 'delivery_uncertain') {
          session.lifecycle.lastWakeAt = settledAt;
        }
        session.inFlight = undefined;
        session.owner = undefined;
        setStatus(session, 'lost');
        session.lifecycle.lostAt = settledAt;
        session.lifecycle.reason =
          outcome === 'delivery_uncertain'
            ? 'dispatch_interrupted'
            : 'admission_interrupted';
      }

      if (session.status === 'starting' && !session.claudeSessionId) {
        session.owner = undefined;
        setStatus(session, 'stale');
        session.lifecycle.reason = 'missing_claude_session_identity';
        return;
      }
      if (
        session.owner?.ownerInstanceId === ownerInstanceId
        && bindingMatches
        && currentHost !== undefined
      ) {
        if (
          currentHost.state === 'lost'
          || currentHost.state === 'retired'
        ) {
          session.owner = undefined;
          setStatus(session, 'lost');
          session.lifecycle.lostAt = settledAt;
          session.lifecycle.reason = 'owner_local_host_closed';
        } else {
          const nextStatus = compatibleHostStatus(currentHost);
          setStatus(session, nextStatus);
          if (currentHost.pid !== undefined && session.owner) {
            session.owner.childPid = currentHost.pid;
          }
        }
      } else if (session.owner !== undefined) {
        // A previous-owner PID is historical metadata only. Clearing the
        // binding never adopts or signals that process.
        session.owner = undefined;
        setStatus(session, 'lost');
        session.lifecycle.lostAt = settledAt;
        session.lifecycle.reason = 'previous_owner_binding';
      }

      if (session.status === 'lost' && !evidence.eligible) {
        session.owner = undefined;
        setStatus(session, 'stale');
        session.lifecycle.reason = evidence.reason;
      }
    });
    return reconciled.ok
      ? { ok: true, session: reconciled.session }
      : coordinatorFailure(reconciled.diagnostic);
  }

  async function persistObservedLoss(event: HostLifecycleEvent): Promise<void> {
    const read = await store.read();
    if (!read.ok) return;
    const match = read.registry.sessions.find(
      (session) =>
        session.owner?.ownerInstanceId === ownerInstanceId
        && session.owner.hostId === event.host.id
        && session.status !== 'retired'
    );
    if (!match) return;
    await mutateSession(match.sessionKey, (session) => {
      if (
        session.owner?.ownerInstanceId !== ownerInstanceId
        || session.owner.hostId !== event.host.id
        || session.status === 'retired'
      ) {
        return;
      }
      session.owner = undefined;
      setStatus(session, 'lost');
      session.lifecycle.lostAt = nowIso(clock);
      session.lifecycle.reason = event.reason;
    });
  }

  const unsubscribe = options.supervisor.subscribeHostLifecycle((event) => {
    observerTail = observerTail
      .then(() => persistObservedLoss(event))
      .catch(() => undefined);
  });

  async function acquireLease(sessionKey: string) {
    return acquireDurableSessionWakeLease({
      store,
      sessionKey,
      ownerInstanceId,
      deadlineMs: options.wakeLeaseDeadlineMs,
      pollMs: options.wakeLeasePollMs,
    });
  }

  async function duplicateWakeResult(
    input: WakeDurableSessionInput,
    session: DurableSessionRecord,
    terminalDisposition: DurableWakeOutcome,
    messageIdDigest: string
  ): Promise<CoordinatorWakeResult> {
    let projected = session;
    if (
      input.kind === 'touch'
      && input.touchOrdinal !== undefined
      && terminalDisposition !== 'pre_delivery_failed'
      && session.touchPolicy.touchesUsed < input.touchOrdinal
    ) {
      const accounted = await mutateSession(input.sessionKey, (candidate) => {
        const wake = candidate.wakes.find(
          (entry) =>
            entry.messageIdDigest === messageIdDigest
            && entry.kind === 'touch'
            && entry.touchOrdinal === input.touchOrdinal
            && entry.touchAttempt === input.touchAttempt
            && entry.outcome === terminalDisposition
        );
        if (wake) accountTerminalTouch(candidate, wake);
      });
      if (!accounted.ok) return coordinatorFailure(accounted.diagnostic);
      projected = accounted.session;
    }
    return {
      ok: true,
      disposition: 'duplicate',
      terminalDisposition,
      messageIdDigest,
      session: projected,
    };
  }

  const coordinator: SessionHostCoordinator = {
    ownerInstanceId,
    store,
    async register(input) {
      const validated = RegisterSessionHostInputSchema.safeParse(input);
      if (!validated.success) {
        return coordinatorFailure(
          diagnostic(
            'invalid_transition',
            'Reusable-session registration input is invalid.',
            store.paths.registryPath
          )
        );
      }
      let cwd: string;
      let attachedRoots: string[];
      try {
        cwd = canonicalExistingDirectory(
          validated.data.cwd,
          filesystem,
          'The reusable-session cwd',
          false
        );
        attachedRoots = [...(validated.data.attachedRoots ?? [])].map((root) =>
          canonicalExistingDirectory(
            root,
            filesystem,
            'A reusable-session attached root',
            false
          )
        );
      } catch (error) {
        return coordinatorFailure(
          error instanceof DurableRegistryFault
            ? error.diagnostic
            : diagnostic(
                'run_directory_invalid',
                'Reusable-session launch facts contain an invalid path.',
                validated.data.cwd,
                error
              )
        );
      }

      const leaseResult = await acquireLease(validated.data.sessionKey);
      if (!leaseResult.ok) return coordinatorFailure(leaseResult.diagnostic);
      try {
        const messageIdDigest = durableSessionMessageIdDigest(
          validated.data.messageId
        );
        const reserved = await store.reserve({
          sessionKey: validated.data.sessionKey,
          role: validated.data.role,
          ...(validated.data.actionId !== undefined
            ? { actionId: validated.data.actionId }
            : {}),
          ...(validated.data.nodeId !== undefined
            ? { nodeId: validated.data.nodeId }
            : {}),
          ...(validated.data.invocationId !== undefined
            ? { invocationId: validated.data.invocationId }
            : {}),
          cwd,
          attachedRoots,
          ...(validated.data.space !== undefined
            ? { space: cloneJson(validated.data.space) }
            : {}),
          ...(validated.data.execution !== undefined
            ? { execution: cloneJson(validated.data.execution) }
            : {}),
          ...(validated.data.model !== undefined
            ? { model: validated.data.model }
            : {}),
          ...(validated.data.effort !== undefined
            ? { effort: validated.data.effort }
            : {}),
          touchPolicy: cloneJson(validated.data.touchPolicy),
          ...(validated.data.launcherSessionId !== undefined
            ? { launcherSessionId: validated.data.launcherSessionId }
            : {}),
        });
        if (!reserved.ok) {
          if (reserved.diagnostic.code !== 'session_conflict') {
            return coordinatorFailure(reserved.diagnostic);
          }
          const existing = await store.get(validated.data.sessionKey);
          if (!existing.ok) return coordinatorFailure(existing.diagnostic);
          const immutableFactsMatch =
            existing.session.role === validated.data.role
            && existing.session.actionId === validated.data.actionId
            && existing.session.nodeId === validated.data.nodeId
            && existing.session.invocationId === validated.data.invocationId
            && existing.session.model === validated.data.model
            && existing.session.effort === validated.data.effort
            && durablePathsEqual(existing.session.cwd, cwd)
            && isDeepStrictEqual(
              existing.session.space,
              validated.data.space
            )
            && isDeepStrictEqual(
              existing.session.execution,
              validated.data.execution
            )
            && existing.session.attachedRoots.length === attachedRoots.length
            && existing.session.attachedRoots.every((root, index) =>
              durablePathsEqual(root, attachedRoots[index]!)
            );
          if (!immutableFactsMatch) {
            return coordinatorFailure(reserved.diagnostic);
          }
          const prior = findIdempotencyTombstone(
            existing.session.idempotencyTombstones,
            messageIdDigest
          ).found;
          if (prior) {
            return {
              ok: true,
              disposition: 'duplicate',
              terminalDisposition: prior.disposition,
              messageIdDigest,
              session: existing.session,
            };
          }
          return {
            ok: false,
            code: 'wake_busy',
            message:
              `Reusable session ${validated.data.sessionKey} was registered by a concurrent bootstrap request.`,
            session: existing.session,
          };
        }

        const admittedAt = nowIso(clock);
        const dispatchFenceAt = nowIso(clock);
        const prepared = await internal.transactPair((registry) => {
          const session = registry.sessions.find(
            (candidate) =>
              candidate.sessionKey === validated.data.sessionKey
          );
          if (!session || session.status !== 'starting' || session.inFlight) {
            throw new DurableRegistryFault(
              diagnostic(
                'invalid_transition',
                `Reusable session ${validated.data.sessionKey} lost its bootstrap reservation.`,
                store.paths.registryPath
              )
            );
          }
          session.inFlight = {
            messageIdDigest,
            admittedAt,
            phase: 'admitted',
            kind: 'interactive',
          };
          session.lifecycle.updatedAt = admittedAt;
          session.lifecycle.reason = 'bootstrap_admitted';
        }, (registry) => {
          const session = registry.sessions.find(
            (candidate) =>
              candidate.sessionKey === validated.data.sessionKey
          );
          if (
            !session
            || session.status !== 'starting'
            || session.inFlight?.messageIdDigest !== messageIdDigest
            || session.inFlight.phase !== 'admitted'
          ) {
            throw new DurableRegistryFault(
              diagnostic(
                'invalid_transition',
                `Reusable session ${validated.data.sessionKey} lost its bootstrap admission before dispatch.`,
                store.paths.registryPath
              )
            );
          }
          session.inFlight = {
            ...session.inFlight,
            phase: 'dispatching',
            dispatchFenceAt,
          };
          session.lifecycle.updatedAt = dispatchFenceAt;
          session.lifecycle.reason = 'bootstrap_dispatching';
        });
        if (!prepared.ok) return coordinatorFailure(prepared.diagnostic);

        const created = await options.supervisor.createHost({
          message: validated.data.message,
          cwd,
          attachedRoots,
          timeoutMs: validated.data.timeoutMs,
          noOutputTimeoutMs: validated.data.noOutputTimeoutMs,
          ...(validated.data.space !== undefined
            ? { space: cloneJson(validated.data.space) }
            : {}),
          ...(validated.data.execution !== undefined
            ? { execution: cloneJson(validated.data.execution) }
            : {}),
        });
        const settledAt = nowIso(clock);
        const identityComplete =
          created.host?.sessionId !== undefined
          && created.host.pid !== undefined;
        const durableOutcome: DurableWakeOutcome = created.ok
          ? 'completed'
          : created.code === 'write_failed'
            ? 'pre_delivery_failed'
            : created.code === 'delivery_uncertain'
                || created.code === 'turn_timeout'
                || created.code === 'no_output_timeout'
              ? 'delivery_uncertain'
              : 'pre_delivery_failed';
        const settled = await mutateSession(
          validated.data.sessionKey,
          (session) => {
            const fence = session.inFlight;
            if (
              session.status !== 'starting'
              || !fence
              || fence.messageIdDigest !== messageIdDigest
            ) {
              throw new DurableRegistryFault(
                diagnostic(
                  'invalid_transition',
                  `Reusable session ${validated.data.sessionKey} lost its bootstrap dispatch fence.`,
                  store.paths.registryPath
                )
              );
            }
            const wake = terminalWake(
              fence,
              settledAt,
              durableOutcome,
              created.ok ? undefined : created.code,
              created.ok ? created.result : undefined
            );
            appendTerminalWake(session, wake);
            session.inFlight = undefined;
            if (identityComplete) {
              session.claudeSessionId = created.host!.sessionId!;
            }
            if (created.ok && identityComplete) {
              session.owner = {
                ownerInstanceId,
                ownerPid,
                hostId: created.host.id,
                childPid: created.host.pid!,
                boundAt: settledAt,
              };
              setStatus(session, 'idle');
              session.lifecycle.lastWakeAt = settledAt;
              session.lifecycle.reason = 'bootstrap_completed';
            } else if (
              durableOutcome === 'delivery_uncertain'
              && identityComplete
            ) {
              session.owner = undefined;
              setStatus(session, 'lost');
              session.lifecycle.lastWakeAt = settledAt;
              session.lifecycle.lostAt = settledAt;
              session.lifecycle.reason = 'bootstrap_delivery_uncertain';
            } else {
              session.owner = undefined;
              setStatus(session, 'stale');
              session.lifecycle.reason = created.ok
                ? 'bootstrap_identity_missing'
                : `bootstrap_failed:${created.code}`;
            }
            return wake;
          }
        );
        if (!settled.ok) {
          if (created.host) {
            await options.supervisor.retireHost(created.host.id);
          }
          return coordinatorFailure(settled.diagnostic);
        }
        if (!created.ok) {
          return hostFailure(
            created.code,
            created.message,
            settled.session,
            settled.value
          );
        }
        if (!identityComplete) {
          await options.supervisor.retireHost(created.host.id);
          return {
            ok: false,
            code: 'session_unrecoverable',
            message:
              'Bootstrap completed without the durable Claude identity or process binding.',
            session: settled.session,
            wake: settled.value,
          };
        }
        return {
          ok: true,
          disposition: 'completed',
          session: settled.session,
          wake: settled.value,
          result: created.result,
        };
      } finally {
        await leaseResult.lease.release();
      }
    },
    async get(sessionKey) {
      return reconcile(sessionKey);
    },
    async list() {
      const listed = await store.list();
      if (!listed.ok) return coordinatorFailure(listed.diagnostic);
      const sessions: DurableSessionRecord[] = [];
      for (const session of listed.sessions) {
        const current = await reconcile(session.sessionKey);
        if (!current.ok) return current;
        sessions.push(current.session);
      }
      return { ok: true, sessions };
    },
    reconcile,
    async updateTouchPolicy(sessionKey, policy, expectedLastWakeAt) {
      const validated = DurableTouchPolicySchema.safeParse(policy);
      if (
        !validated.success
        || (
          expectedLastWakeAt !== undefined
          && !TimestampSchema.safeParse(expectedLastWakeAt).success
        )
      ) {
        return coordinatorFailure(
          diagnostic(
            'invalid_transition',
            `Touch policy for ${sessionKey} is invalid.`,
            store.paths.registryPath
          )
        );
      }
      const leaseResult = await acquireLease(sessionKey);
      if (!leaseResult.ok) return coordinatorFailure(leaseResult.diagnostic);
      try {
        const reconciled = await reconcile(sessionKey);
        if (!reconciled.ok) return reconciled;
        if (reconciled.session.status === 'retired') {
          return {
            ok: false,
            code: 'session_retired',
            message: `Reusable session ${sessionKey} is retired.`,
            session: reconciled.session,
          };
        }
        if (
          expectedLastWakeAt !== undefined
          && reconciled.session.lifecycle.lastWakeAt !== expectedLastWakeAt
        ) {
          return {
            ok: false,
            code: 'conditional_wake_stale',
            message:
              `Touch policy for ${sessionKey} was computed from a stale wake observation.`,
            session: reconciled.session,
          };
        }
        if (
          validated.data.touchesUsed
            < reconciled.session.touchPolicy.touchesUsed
        ) {
          return {
            ok: false,
            code: 'conditional_wake_stale',
            message:
              `Touch policy for ${sessionKey} would roll back durable touch accounting.`,
            session: reconciled.session,
          };
        }
        const updated = await mutateSession(sessionKey, (session) => {
          session.touchPolicy = cloneJson(validated.data);
        });
        return updated.ok
          ? { ok: true, session: updated.session }
          : coordinatorFailure(updated.diagnostic);
      } finally {
        await leaseResult.lease.release();
      }
    },
    async retire(sessionKey, reason) {
      const leaseResult = await acquireLease(sessionKey);
      if (!leaseResult.ok) return coordinatorFailure(leaseResult.diagnostic);
      try {
        const reconciled = await reconcile(sessionKey);
        if (!reconciled.ok) return reconciled;
        if (reconciled.session.status === 'retired') return reconciled;
        const retiring = await mutateSession(sessionKey, (session) => {
          setStatus(session, 'retiring');
          session.lifecycle.retirementRequestedAt = nowIso(clock);
          session.lifecycle.reason = reason;
        });
        if (!retiring.ok) return coordinatorFailure(retiring.diagnostic);
        const owner = retiring.session.owner;
        if (owner?.ownerInstanceId === ownerInstanceId) {
          const current = options.supervisor.getHost(owner.hostId);
          if (current) await options.supervisor.retireHost(owner.hostId);
        }
        const retired = await mutateSession(sessionKey, (session) => {
          session.owner = undefined;
          session.inFlight = undefined;
          setStatus(session, 'retired');
          session.lifecycle.retiredAt = nowIso(clock);
          session.lifecycle.reason = reason;
        });
        return retired.ok
          ? { ok: true, session: retired.session }
          : coordinatorFailure(retired.diagnostic);
      } finally {
        await leaseResult.lease.release();
      }
    },
    async wake(input) {
      const validated = WakeDurableSessionInputSchema.safeParse(input);
      if (!validated.success) {
        return coordinatorFailure(
          diagnostic(
            'invalid_transition',
            'Reusable-session wake input is invalid.',
            store.paths.registryPath
          )
        );
      }
      input = validated.data;
      const leaseResult = await acquireLease(input.sessionKey);
      if (!leaseResult.ok) return coordinatorFailure(leaseResult.diagnostic);
      try {
        const messageIdDigest = durableSessionMessageIdDigest(input.messageId);
        const beforeReconciliation = await store.get(input.sessionKey);
        if (!beforeReconciliation.ok) {
          return coordinatorFailure(beforeReconciliation.diagnostic);
        }
        const priorBeforeReconciliation = findIdempotencyTombstone(
          beforeReconciliation.session.idempotencyTombstones,
          messageIdDigest
        ).found;
        if (priorBeforeReconciliation) {
          return duplicateWakeResult(
            input,
            beforeReconciliation.session,
            priorBeforeReconciliation.disposition,
            messageIdDigest
          );
        }
        if (
          beforeReconciliation.session.idempotencyTombstones.length
          >= MAX_DURABLE_IDEMPOTENCY_TOMBSTONES
        ) {
          return idempotencyCapacityFailure(
            beforeReconciliation.session,
            store.paths.registryPath
          );
        }

        const reconciled = await reconcile(input.sessionKey);
        if (!reconciled.ok) return reconciled;
        const duplicate = findIdempotencyTombstone(
          reconciled.session.idempotencyTombstones,
          messageIdDigest
        ).found;
        if (duplicate) {
          return duplicateWakeResult(
            input,
            reconciled.session,
            duplicate.disposition,
            messageIdDigest
          );
        }
        if (
          reconciled.session.idempotencyTombstones.length
          >= MAX_DURABLE_IDEMPOTENCY_TOMBSTONES
        ) {
          return idempotencyCapacityFailure(
            reconciled.session,
            store.paths.registryPath
          );
        }
        if (reconciled.session.status === 'retired') {
          return {
            ok: false,
            code: 'session_retired',
            message: `Reusable session ${input.sessionKey} is retired.`,
            session: reconciled.session,
          };
        }
        if (reconciled.session.status === 'stale') {
          return {
            ok: false,
            code: 'session_stale',
            message: `Reusable session ${input.sessionKey} has stale recovery identity.`,
            session: reconciled.session,
          };
        }
        if (!reconciled.session.claudeSessionId) {
          return {
            ok: false,
            code: 'session_unrecoverable',
            message: `Reusable session ${input.sessionKey} has no Claude session identity.`,
            session: reconciled.session,
          };
        }
        if (
          input.expectedLastWakeAt !== undefined
          && reconciled.session.lifecycle.lastWakeAt
            !== input.expectedLastWakeAt
        ) {
          return {
            ok: false,
            code: 'conditional_wake_stale',
            message: `Reusable session ${input.sessionKey} changed after the caller observed it.`,
            session: reconciled.session,
          };
        }
        if (input.kind === 'touch') {
          const expectedOrdinal =
            reconciled.session.touchPolicy.touchesUsed + 1;
          if (
            reconciled.session.touchPolicy.mode !== 'auto'
            || input.touchOrdinal !== expectedOrdinal
            || input.touchOrdinal > reconciled.session.touchPolicy.maxTouches
          ) {
            return {
              ok: false,
              code: 'conditional_wake_stale',
              message: `Reusable session ${input.sessionKey} no longer admits touch ordinal ${input.touchOrdinal}.`,
              session: reconciled.session,
            };
          }
        }

        const admittedAt = nowIso(clock);
        const dispatchFenceAt = nowIso(clock);
        const prepared = await internal.transactPair((registry) => {
          const session = registry.sessions.find(
            (candidate) => candidate.sessionKey === input.sessionKey
          );
          if (!session) {
            throw new DurableRegistryFault(
              diagnostic(
                'session_not_found',
                `Reusable session ${input.sessionKey} does not exist.`,
                store.paths.registryPath
              )
            );
          }
          const prior = findIdempotencyTombstone(
            session.idempotencyTombstones,
            messageIdDigest
          ).found;
          if (prior || session.inFlight) {
            throw new DurableRegistryFault(
              diagnostic(
                'invalid_transition',
                `Reusable session ${input.sessionKey} already has this or another admitted wake.`,
                store.paths.registryPath
              )
            );
          }
          if (
            session.idempotencyTombstones.length
            >= MAX_DURABLE_IDEMPOTENCY_TOMBSTONES
          ) {
            throw new DurableRegistryFault(
              diagnostic(
                'idempotency_capacity_exhausted',
                `Reusable session ${input.sessionKey} has exhausted its durable idempotency capacity.`,
                store.paths.registryPath
              )
            );
          }
          setStatus(session, 'waking');
          session.inFlight = {
            messageIdDigest,
            admittedAt,
            phase: 'admitted',
            kind: input.kind ?? 'interactive',
            ...(input.touchOrdinal !== undefined
              ? { touchOrdinal: input.touchOrdinal }
              : {}),
            ...(input.touchAttempt !== undefined
              ? { touchAttempt: input.touchAttempt }
              : {}),
          };
          session.lifecycle.updatedAt = admittedAt;
        }, (registry) => {
          const session = registry.sessions.find(
            (candidate) => candidate.sessionKey === input.sessionKey
          );
          if (
            !session
            || session.inFlight?.messageIdDigest !== messageIdDigest
            || session.inFlight.phase !== 'admitted'
          ) {
            throw new DurableRegistryFault(
              diagnostic(
                'invalid_transition',
                `Wake digest ${messageIdDigest} lost its admission before dispatch.`,
                store.paths.registryPath
              )
            );
          }
          session.inFlight = {
            ...session.inFlight,
            phase: 'dispatching',
            dispatchFenceAt,
          };
          session.lifecycle.updatedAt = dispatchFenceAt;
        });
        if (!prepared.ok) return coordinatorFailure(prepared.diagnostic);

        const fencedSession = prepared.registry.sessions.find(
          (session) => session.sessionKey === input.sessionKey
        );
        if (!fencedSession) {
          return coordinatorFailure(
            diagnostic(
              'registry_corrupt',
              `Reusable session ${input.sessionKey} disappeared after durable admission.`,
              store.paths.registryPath
            )
          );
        }
        const currentOwner =
          fencedSession.owner?.ownerInstanceId === ownerInstanceId
            ? fencedSession.owner
            : undefined;
        const currentHost = currentOwner
          ? options.supervisor.getHost(currentOwner.hostId)
          : undefined;
        const turnInput = {
          message: input.message,
          timeoutMs: input.timeoutMs,
          noOutputTimeoutMs: input.noOutputTimeoutMs,
        };
        const outcome = currentHost
          ? await options.supervisor.wakeHost(currentHost.id, turnInput)
          : await options.supervisor.recoverHost({
              ...turnInput,
              cwd: fencedSession.cwd,
              attachedRoots: fencedSession.attachedRoots,
              ...(fencedSession.space !== undefined
                ? { space: cloneJson(fencedSession.space) }
                : {}),
              ...(fencedSession.execution !== undefined
                ? { execution: cloneJson(fencedSession.execution) }
                : {}),
              claudeSessionId: fencedSession.claudeSessionId!,
            } satisfies RecoverHostInput);

        const settledAt = nowIso(clock);
        const durableOutcome: DurableWakeOutcome = outcome.ok
          ? 'completed'
          : outcome.code === 'write_failed'
            ? 'pre_delivery_failed'
            : outcome.code === 'delivery_uncertain'
              || outcome.code === 'turn_timeout'
              || outcome.code === 'no_output_timeout'
              ? 'delivery_uncertain'
              : 'pre_delivery_failed';
        const settled = await mutateSession(input.sessionKey, (session) => {
          const fence = session.inFlight;
          if (!fence || fence.messageIdDigest !== messageIdDigest) {
            throw new DurableRegistryFault(
              diagnostic(
                'invalid_transition',
                `Wake digest ${messageIdDigest} lost its durable dispatch fence.`,
                store.paths.registryPath
              )
            );
          }
          const wake = terminalWake(
            fence,
            settledAt,
            durableOutcome,
            outcome.ok ? undefined : outcome.code,
            outcome.ok ? outcome.result : undefined
          );
          appendTerminalWake(session, wake);
          accountTerminalTouch(session, wake);
          session.inFlight = undefined;
          if (outcome.ok) {
            if (
              outcome.host.sessionId !== session.claudeSessionId
              || !durablePathsEqual(outcome.host.cwd, session.cwd)
              || outcome.host.pid === undefined
            ) {
              session.owner = undefined;
              setStatus(session, 'stale');
              session.lifecycle.reason = 'supervisor_identity_mismatch';
              return wake;
            }
            session.owner = {
              ownerInstanceId,
              ownerPid,
              hostId: outcome.host.id,
              childPid: outcome.host.pid,
              boundAt: settledAt,
            };
            setStatus(session, 'idle');
            session.lifecycle.lastWakeAt = settledAt;
            session.lifecycle.recoveredAt = currentHost
              ? session.lifecycle.recoveredAt
              : settledAt;
            session.lifecycle.reason = 'wake_completed';
          } else if (durableOutcome === 'delivery_uncertain') {
            session.owner = undefined;
            setStatus(session, 'lost');
            session.lifecycle.lastWakeAt = settledAt;
            session.lifecycle.lostAt = settledAt;
            session.lifecycle.reason = 'delivery_uncertain';
          } else if (currentHost) {
            setStatus(session, compatibleHostStatus(currentHost));
          } else {
            session.owner = undefined;
            setStatus(session, 'lost');
            session.lifecycle.reason = 'pre_delivery_failure';
          }
          return wake;
        });
        if (!settled.ok) return coordinatorFailure(settled.diagnostic);
        const wake = settled.value;
        if (outcome.ok) {
          if (settled.session.status === 'stale') {
            return {
              ok: false,
              code: 'session_stale',
              message: 'The recovered supervisor host did not match durable identity.',
              session: settled.session,
              wake,
            };
          }
          return {
            ok: true,
            disposition: 'completed',
            session: settled.session,
            wake,
            result: outcome.result,
          };
        }
        return hostFailure(
          outcome.code,
          outcome.message,
          settled.session,
          wake
        );
      } finally {
        await leaseResult.lease.release();
      }
    },
    async ownerShutdown() {
      try {
        await options.supervisor.shutdownAll('server-shutdown');
        await observerTail;
        const result = await internal.transact(false, (registry) => {
          const lostAt = nowIso(clock);
          for (const session of registry.sessions) {
            if (
              session.owner?.ownerInstanceId !== ownerInstanceId
              || session.status === 'retired'
            ) {
              continue;
            }
            session.owner = undefined;
            setStatus(session, 'lost');
            session.lifecycle.updatedAt = lostAt;
            session.lifecycle.lostAt = lostAt;
            session.lifecycle.reason = 'owner_shutdown';
          }
        });
        return result.ok
          ? { ok: true, sessions: cloneJson(result.registry.sessions) }
          : coordinatorFailure(result.diagnostic);
      } catch (error) {
        return {
          ok: false,
          code: 'owner_shutdown_failed',
          message:
            error instanceof Error
              ? error.message
              : 'The reusable-session owner failed to shut down.',
        };
      } finally {
        unsubscribe();
      }
    },
  };

  return coordinator;
}
