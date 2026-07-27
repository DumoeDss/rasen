import { createHash } from 'node:crypto';

import type {
  ActionId,
  AttemptId,
  ChangeInstanceId,
  Digest,
  EffectId,
  InvocationId,
  NodeId,
  PlanningSpaceId,
  RunId,
  WaitId,
  WorkspaceInstanceId,
} from '../contracts.js';

export type PosixPhysicalIdentity = Readonly<{
  format: 'physical-identity/1';
  platform: 'posix';
  device: bigint;
  fileIndex: bigint;
  birthIdentity: bigint;
}>;

export type WindowsPhysicalIdentity = Readonly<{
  format: 'physical-identity/1';
  platform: 'windows';
  volume: bigint;
  fileIndex: bigint;
  creationIdentity: bigint;
}>;

export type PhysicalIdentity =
  | PosixPhysicalIdentity
  | WindowsPhysicalIdentity;

export class ChangeRunIdentityError extends Error {
  constructor(
    readonly code:
      | 'invalid_identity_component'
      | 'invalid_physical_identity'
      | 'invalid_launch_intent',
    message: string
  ) {
    super(message);
    this.name = 'ChangeRunIdentityError';
  }
}

const U64_MAX = (1n << 64n) - 1n;
const encoder = new TextEncoder();

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ChangeRunIdentityError(
        'invalid_identity_component',
        'Canonical identity JSON requires a finite number.'
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`;
  }
  throw new ChangeRunIdentityError(
    'invalid_identity_component',
    `Unsupported canonical identity component: ${typeof value}.`
  );
}

function componentBytes(value: unknown): Uint8Array {
  if (typeof value === 'string') {
    return Uint8Array.from([0x73, ...encoder.encode(value)]);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ChangeRunIdentityError(
        'invalid_identity_component',
        'Identity ordinals must be non-negative safe integers.'
      );
    }
    return Uint8Array.from([0x6e, ...encoder.encode(String(value))]);
  }
  if (typeof value === 'bigint') {
    return Uint8Array.from([0x62, ...encoder.encode(String(value))]);
  }
  if (value instanceof Uint8Array) {
    return Uint8Array.from([0x78, ...value]);
  }
  return Uint8Array.from([0x6a, ...encoder.encode(canonicalJson(value))]);
}

function updateLengthPrefixed(
  hash: ReturnType<typeof createHash>,
  component: unknown
): void {
  const bytes = componentBytes(component);
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.byteLength, 0);
  hash.update(length);
  hash.update(bytes);
}

export function domainDigest(
  domain: string,
  ...components: readonly unknown[]
): Digest {
  const hash = createHash('sha256');
  updateLengthPrefixed(hash, domain);
  for (const component of components) updateLengthPrefixed(hash, component);
  return `sha256:${hash.digest('hex')}` as Digest;
}

function id<Prefix extends string>(
  prefix: Prefix,
  domain: string,
  ...components: readonly unknown[]
): `${Prefix}:${string}` {
  return `${prefix}:${domainDigest(domain, ...components).slice('sha256:'.length)}`;
}

function assertMachineHome(home: string): void {
  if (
    home.length === 0 ||
    home.length > 255 ||
    !/^[A-Za-z0-9._-]+$/.test(home) ||
    home === '.' ||
    home === '..'
  ) {
    throw new ChangeRunIdentityError(
      'invalid_identity_component',
      'Persisted registry home must be one bounded relative machine-home name.'
    );
  }
}

function assertChangeId(changeId: string): void {
  if (
    changeId.length === 0 ||
    changeId.length > 128 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(changeId)
  ) {
    throw new ChangeRunIdentityError(
      'invalid_identity_component',
      'Change ID must use the bounded portable kebab-case grammar.'
    );
  }
}

export function derivePlanningSpaceId(home: string): PlanningSpaceId {
  assertMachineHome(home);
  return id('planning-space', 'planning-space/1', home) as PlanningSpaceId;
}

export function deriveChangeInstanceId(
  planningSpaceId: PlanningSpaceId,
  changeId: string,
  physicalIdentity: PhysicalIdentity
): ChangeInstanceId {
  assertChangeId(changeId);
  return id(
    'change-instance',
    'change-instance/1',
    planningSpaceId,
    changeId,
    encodePhysicalIdentity(physicalIdentity)
  ) as ChangeInstanceId;
}

export function deriveWorkspaceInstanceId(
  planningSpaceId: PlanningSpaceId,
  physicalIdentity: PhysicalIdentity
): WorkspaceInstanceId {
  return id(
    'workspace-instance',
    'workspace-instance/1',
    planningSpaceId,
    encodePhysicalIdentity(physicalIdentity)
  ) as WorkspaceInstanceId;
}

export function deriveRunId(
  planningSpaceId: PlanningSpaceId,
  changeInstanceId: ChangeInstanceId,
  changeId: string,
  launchRequestId: string
): RunId {
  assertChangeId(changeId);
  if (launchRequestId.length === 0 || launchRequestId.length > 256) {
    throw new ChangeRunIdentityError(
      'invalid_identity_component',
      'Launch request identity must contain 1-256 characters.'
    );
  }
  return id(
    'run',
    'run',
    planningSpaceId,
    changeInstanceId,
    changeId,
    launchRequestId
  ) as RunId;
}

export function deriveNodeId(runId: RunId, hierarchicalPath: string): NodeId {
  if (
    hierarchicalPath.length === 0 ||
    hierarchicalPath.length > 1024 ||
    hierarchicalPath.includes('\\')
  ) {
    throw new ChangeRunIdentityError(
      'invalid_identity_component',
      'Hierarchical node path must be bounded and use canonical POSIX separators.'
    );
  }
  return id('node', 'node', runId, hierarchicalPath) as NodeId;
}

export function deriveInvocationId(
  runId: RunId,
  nodeId: NodeId,
  occurrence: number
): InvocationId {
  return id('invocation', 'invocation', runId, nodeId, occurrence) as InvocationId;
}

export function deriveAttemptId(
  invocationId: InvocationId,
  attemptOrdinal: number
): AttemptId {
  return id('attempt', 'attempt', invocationId, attemptOrdinal) as AttemptId;
}

export function deriveEffectId(
  invocationId: InvocationId,
  effectSlot: string
): EffectId {
  if (effectSlot.length === 0 || effectSlot.length > 128) {
    throw new ChangeRunIdentityError(
      'invalid_identity_component',
      'Effect slot must contain 1-128 characters.'
    );
  }
  return id('effect', 'effect', invocationId, effectSlot) as EffectId;
}

export function deriveActionId(
  attemptId: AttemptId,
  actionKind: 'agent' | 'command' | 'host',
  effectDescriptors: readonly Readonly<{
    slot: string;
    effectId: EffectId;
  }>[]
): ActionId {
  const descriptors = effectDescriptors
    .map((descriptor) => ({ ...descriptor }))
    .sort(
      (left, right) =>
        compareStrings(left.slot, right.slot) ||
        compareStrings(left.effectId, right.effectId)
    );
  const slots = descriptors.map((descriptor) => descriptor.slot);
  if (new Set(slots).size !== slots.length) {
    throw new ChangeRunIdentityError(
      'invalid_identity_component',
      'Effect slots must be unique before Action allocation.'
    );
  }
  const effectSet = domainDigest('effect-set', descriptors);
  return id('action', 'action', attemptId, actionKind, effectSet) as ActionId;
}

export interface WaitIdentityContext {
  readonly runId: RunId;
  readonly kind: string;
  readonly nodeId?: NodeId;
  readonly invocationId?: InvocationId;
  readonly occurrence?: number;
  readonly attemptId?: AttemptId;
  readonly actionId?: ActionId;
  readonly effectIds?: readonly EffectId[];
  readonly decisionOccurrence?: number;
  readonly workspaceInstanceId?: WorkspaceInstanceId;
  readonly reservationIntentsDigest?: Digest;
}

export function deriveWaitId(context: WaitIdentityContext): WaitId {
  const absent = '<absent>';
  const effectIds = [...(context.effectIds ?? [])].sort(compareStrings);
  return id(
    'wait',
    'wait',
    context.runId,
    context.kind,
    context.nodeId ?? absent,
    context.invocationId ?? absent,
    context.occurrence ?? absent,
    context.attemptId ?? absent,
    context.actionId ?? absent,
    effectIds,
    context.decisionOccurrence ?? absent,
    context.workspaceInstanceId ?? absent,
    context.reservationIntentsDigest ?? absent
  ) as WaitId;
}

function assertU64(value: bigint, label: string): void {
  if (value <= 0n || value > U64_MAX) {
    throw new ChangeRunIdentityError(
      'invalid_physical_identity',
      `${label} must be a non-zero unsigned 64-bit integer.`
    );
  }
}

export function encodePhysicalIdentity(
  physicalIdentity: PhysicalIdentity
): Uint8Array {
  if (physicalIdentity.format !== 'physical-identity/1') {
    throw new ChangeRunIdentityError(
      'invalid_physical_identity',
      'Unsupported physical identity major.'
    );
  }
  const bytes = Buffer.alloc(25);
  if (physicalIdentity.platform === 'posix') {
    assertU64(physicalIdentity.device, 'POSIX device');
    assertU64(physicalIdentity.fileIndex, 'POSIX inode');
    assertU64(physicalIdentity.birthIdentity, 'POSIX birth identity');
    bytes[0] = 1;
    bytes.writeBigUInt64BE(physicalIdentity.device, 1);
    bytes.writeBigUInt64BE(physicalIdentity.fileIndex, 9);
    bytes.writeBigUInt64BE(physicalIdentity.birthIdentity, 17);
  } else {
    assertU64(physicalIdentity.volume, 'Windows volume serial');
    assertU64(physicalIdentity.fileIndex, 'Windows file index');
    assertU64(physicalIdentity.creationIdentity, 'Windows creation identity');
    bytes[0] = 2;
    bytes.writeBigUInt64BE(physicalIdentity.volume, 1);
    bytes.writeBigUInt64BE(physicalIdentity.fileIndex, 9);
    bytes.writeBigUInt64BE(physicalIdentity.creationIdentity, 17);
  }
  return bytes;
}

export function decodePhysicalIdentity(bytes: Uint8Array): PhysicalIdentity {
  if (bytes.byteLength !== 25) {
    throw new ChangeRunIdentityError(
      'invalid_physical_identity',
      'Physical identity codec requires exactly 25 bytes.'
    );
  }
  const buffer = Buffer.from(bytes);
  const first = buffer.readBigUInt64BE(1);
  const second = buffer.readBigUInt64BE(9);
  const third = buffer.readBigUInt64BE(17);
  if (buffer[0] === 1) {
    const value: PosixPhysicalIdentity = {
      format: 'physical-identity/1',
      platform: 'posix',
      device: first,
      fileIndex: second,
      birthIdentity: third,
    };
    encodePhysicalIdentity(value);
    return Object.freeze(value);
  }
  if (buffer[0] === 2) {
    const value: WindowsPhysicalIdentity = {
      format: 'physical-identity/1',
      platform: 'windows',
      volume: first,
      fileIndex: second,
      creationIdentity: third,
    };
    encodePhysicalIdentity(value);
    return Object.freeze(value);
  }
  throw new ChangeRunIdentityError(
    'invalid_physical_identity',
    `Unknown physical identity platform tag ${String(buffer[0])}.`
  );
}

export function digestPhysicalIdentity(
  physicalIdentity: PhysicalIdentity
): Digest {
  return domainDigest(
    'physical-identity/1',
    encodePhysicalIdentity(physicalIdentity)
  );
}

/**
 * Read the proven physical identity of a workspace path (task 2.3/2.4 runtime
 * reader). Uses BigInt stat for stable 64-bit device/inode/volume/file-index
 * values; the birth/creation identity is the birthtime in nanoseconds. On
 * Windows the file index may be partial without elevation — that limitation
 * surfaces as identity drift, not a silent wrong match.
 */
export function readPhysicalIdentity(
  stat: Readonly<{
    device: bigint;
    ino: bigint;
    birthtimeMs: number | bigint;
  }>
): PhysicalIdentity {
  const birth = BigInt(stat.birthtimeMs) * 1_000_000n;
  if (process.platform === 'win32') {
    return {
      format: 'physical-identity/1',
      platform: 'windows',
      volume: stat.device,
      fileIndex: stat.ino,
      creationIdentity: birth,
    };
  }
  return {
    format: 'physical-identity/1',
    platform: 'posix',
    device: stat.device,
    fileIndex: stat.ino,
    birthIdentity: birth,
  };
}

export interface LaunchIntent {
  readonly pipeline: string;
  readonly engine: 'reconciler';
  readonly inputs: Readonly<Record<string, unknown>>;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareStrings(left, right))
        .map(([key, nested]) => [key, normalizeJson(nested)])
    );
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  throw new ChangeRunIdentityError(
    'invalid_launch_intent',
    'Launch inputs must be canonical JSON.'
  );
}

export function normalizeLaunchIntent(value: {
  readonly pipeline: string;
  readonly engine?: 'reconciler';
  readonly inputs?: Readonly<Record<string, unknown>>;
}): LaunchIntent {
  if (
    value.pipeline.length === 0 ||
    value.pipeline.length > 128 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.pipeline)
  ) {
    throw new ChangeRunIdentityError(
      'invalid_launch_intent',
      'Pipeline name must use the bounded portable kebab-case grammar.'
    );
  }
  const inputs = normalizeJson(value.inputs ?? {}) as Record<string, unknown>;
  return deepFreeze({
    pipeline: value.pipeline,
    engine: value.engine ?? 'reconciler',
    inputs,
  });
}

export function digestLaunchIntent(
  value:
    | LaunchIntent
    | {
        readonly pipeline: string;
        readonly engine?: 'reconciler';
        readonly inputs?: Readonly<Record<string, unknown>>;
      }
): Digest {
  const normalized = normalizeLaunchIntent(value);
  return domainDigest('launch-intent/1', normalized);
}
