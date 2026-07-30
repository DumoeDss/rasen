import {
  ChangeRunContractError,
  decodeRunAction,
  type ActionId,
  type AttemptId,
  type Digest,
  type EffectId,
  type InvocationId,
  type JsonValue,
  type NodeId,
  type RunAction,
  type RunId,
  type WorkspaceInstanceId,
  type WorkspaceRevision,
} from '../contracts.js';
import type {
  RuntimeCapabilityBinding,
  EffectiveRunPolicy,
} from '../../pipeline-registry/execution-plan-internal.js';
import {
  deriveActionId,
  deriveAttemptId,
  deriveEffectId,
  deriveInvocationId,
} from './identity.js';

export type ActionBuildErrorCode =
  | 'action_kind_mismatch'
  | 'invalid_action_input'
  | 'invalid_effect_binding';

export class ActionBuildError extends Error {
  constructor(
    readonly code: ActionBuildErrorCode,
    message: string,
    readonly issues: readonly string[] = []
  ) {
    super(message);
    this.name = 'ActionBuildError';
  }
}

/**
 * The trusted capability + policy context a closed Action is built from. These
 * originate from a frozen `RuntimeExecutionProfile`; the constructor never
 * accepts caller-supplied contract/digest/policy data, so a Definition cannot
 * inject executable code, argv, Adapter paths, or validators.
 */
export interface ActionBuildContext {
  readonly capability: RuntimeCapabilityBinding;
  readonly stage: Extract<EffectiveRunPolicy['stages'][number], unknown>;
  readonly executionProfileDigest: Digest;
  readonly policyDigest: Digest;
}

export interface ActionIdentity {
  readonly runId: RunId;
  readonly nodeId: NodeId;
  readonly occurrence: number;
  readonly attemptOrdinal: number;
  readonly expectedBeforeWorkspace: WorkspaceRevision;
}

export interface AgentActionInput {
  readonly input: JsonValue;
}

export interface CommandActionInput {
  readonly executable: Readonly<{ identity: string; contentDigest: Digest }>;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly workspaceInstanceId: WorkspaceInstanceId;
  readonly workingDirectory: string;
  readonly timeoutMs: number;
}

export interface HostActionInput {
  readonly operation: 'workspace-apply' | 'verify' | 'ship' | 'archive';
  readonly input: JsonValue;
}

const HEX = '[0-9a-f]{64}';
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ARGV_MAX = 64 * 1024;
const ENV_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertKind(
  capability: RuntimeCapabilityBinding,
  expected: 'agent' | 'command' | 'host'
): void {
  if (capability.actionKind !== expected) {
    throw new ActionBuildError(
      'action_kind_mismatch',
      `Capability is bound to action kind ${capability.actionKind}, not ${expected}.`
    );
  }
}

function effectOperation(
  capability: RuntimeCapabilityBinding,
  slot: string
): Readonly<{
  operationKey: string;
  ownershipMarkerContract: string;
  conflictPolicy: 'fail' | 'uncertain';
}> {
  return {
    operationKey: `${capability.contract.id}:${slot}`,
    ownershipMarkerContract: 'effect-owner/1',
    conflictPolicy:
      capability.effects.find((effect) => effect.slot === slot)?.recovery ===
      'suspend-if-ambiguous'
        ? 'uncertain'
        : 'fail',
  };
}

function buildEffects(
  capability: RuntimeCapabilityBinding,
  invocationId: InvocationId
): readonly RunAction['effects'][number][] {
  return capability.effects.map((effect) => ({
    slot: effect.slot,
    effectId: deriveEffectId(invocationId, effect.slot),
    kind: effect.kind,
    resource: effect.resource,
    recovery: effect.recovery,
    operation: effectOperation(capability, effect.slot),
  }));
}

function commonActionFields(
  ctx: ActionBuildContext,
  identity: ActionIdentity,
  kind: 'agent' | 'command' | 'host'
) {
  const invocationId = deriveInvocationId(
    identity.runId,
    identity.nodeId,
    identity.occurrence
  );
  const attemptId = deriveAttemptId(invocationId, identity.attemptOrdinal);
  const effects = buildEffects(ctx.capability, invocationId);
  const actionId = deriveActionId(attemptId, kind, effects.map((effect) => ({
    slot: effect.slot,
    effectId: effect.effectId as EffectId,
  })));
  return {
    format: 'change-run-action/1' as const,
    kind,
    runId: identity.runId,
    nodeId: identity.nodeId,
    invocationId,
    attemptId,
    actionId,
    effects,
    executionProfileDigest: ctx.executionProfileDigest,
    capability: {
      id: ctx.capability.authoredCapability.id,
      authoredVersion: ctx.capability.authoredCapability.version,
      contractId: ctx.capability.contract.id,
      contractVersion: ctx.capability.contract.version,
      contractDigest: ctx.capability.contract.digest,
      artifact: ctx.capability.adapter,
    },
    resultContractDigest: ctx.capability.resultContract.digest,
    evidenceContractDigest: ctx.capability.evidenceContract.digest,
    policyDigest: ctx.policyDigest,
    workspace: ctx.capability.workspace,
    expectedBeforeWorkspace: identity.expectedBeforeWorkspace,
  };
}

function finish(value: unknown): RunAction {
  try {
    return decodeRunAction(value);
  } catch (error) {
    if (error instanceof ChangeRunContractError) {
      throw new ActionBuildError(
        'invalid_action_input',
        error.message,
        error.issues
      );
    }
    throw error;
  }
}

export function buildAgentAction(
  ctx: ActionBuildContext,
  identity: ActionIdentity,
  input: AgentActionInput
): RunAction {
  assertKind(ctx.capability, 'agent');
  const stage = ctx.stage as Extract<EffectiveRunPolicy['stages'][number], unknown>;
  return finish({
    ...commonActionFields(ctx, identity, 'agent'),
    agent: {
      role: stage.role,
      model: stage.model,
      reasoningEffort: stage.effort,
      runtime: stage.runtime,
      sandbox: stage.sandbox,
      input: input.input,
      session: {
        reuse: stage.sessionReuse,
        // ECP-5 (D9): carry the authored scope through verbatim. Spread so an
        // unauthored / synthesized stage OMITS the key entirely rather than
        // recording `undefined` — that is what keeps every existing action
        // digest byte-identical.
        ...(stage.sessionReuseAuthored !== undefined
          ? { sessionReuseAuthored: stage.sessionReuseAuthored }
          : {}),
        // PLACEHOLDER values, per the `ecp-change-run-runtime` requirement
        // "Recorded session guidance is placeholder until a slice defines its
        // authoritative source". They are persisted into every committed
        // action, so they become historical fact — but 0.1.6 defines no
        // authoritative source for either, and nothing reads them. Do NOT
        // re-set the constants here; the real values are the Session execution
        // layer's design output (they depend on the model window).
        handoffTokenLimit: stage.handoffTokenLimit,
        reuseRoundLimit: stage.reuseRoundLimit,
      },
    },
  });
}

export function buildCommandAction(
  ctx: ActionBuildContext,
  identity: ActionIdentity,
  command: CommandActionInput
): RunAction {
  assertKind(ctx.capability, 'command');
  if (command.argv.length > 256) {
    throw new ActionBuildError(
      'invalid_action_input',
      'Command argv exceeds the sealed bound.'
    );
  }
  for (const arg of command.argv) {
    if (arg.length > ARGV_MAX) {
      throw new ActionBuildError(
        'invalid_action_input',
        'Command argv entry exceeds the sealed byte bound.'
      );
    }
  }
  for (const name of Object.keys(command.env)) {
    if (!ENV_NAME_PATTERN.test(name) || name.length > 128) {
      throw new ActionBuildError(
        'invalid_action_input',
        `Command env name ${JSON.stringify(name)} is not allowed.`
      );
    }
    if (command.env[name]!.length > ARGV_MAX) {
      throw new ActionBuildError(
        'invalid_action_input',
        'Command env value exceeds the sealed byte bound.'
      );
    }
  }
  if (
    !Number.isSafeInteger(command.timeoutMs) ||
    command.timeoutMs <= 0
  ) {
    throw new ActionBuildError(
      'invalid_action_input',
      'Command timeoutMs must be a positive safe integer.'
    );
  }
  if (
    command.workingDirectory.length === 0 ||
    command.workingDirectory.length > 1024 ||
    command.workingDirectory.startsWith('/') ||
    command.workingDirectory.includes('\\')
  ) {
    throw new ActionBuildError(
      'invalid_action_input',
      'Command workingDirectory must be a relative slash path.'
    );
  }
  return finish({
    ...commonActionFields(ctx, identity, 'command'),
    command: {
      artifact: ctx.capability.adapter,
      executable: command.executable,
      argv: [...command.argv],
      env: { ...command.env },
      workspaceInstanceId: command.workspaceInstanceId,
      workingDirectory: command.workingDirectory,
      timeoutMs: command.timeoutMs,
      shell: false as const,
    },
  });
}

export function buildHostAction(
  ctx: ActionBuildContext,
  identity: ActionIdentity,
  host: HostActionInput
): RunAction {
  assertKind(ctx.capability, 'host');
  return finish({
    ...commonActionFields(ctx, identity, 'host'),
    host: {
      operation: host.operation,
      input: host.input,
    },
  });
}

export {
  HEX,
  ID_PATTERN,
};
