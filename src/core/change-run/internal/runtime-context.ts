import type {
  PreparedDefinition,
} from '../../pipeline-registry/definition.js';
import {
  openRuntimeExecutionProfile,
  type RuntimeExecutionProfile,
} from '../../pipeline-registry/execution-plan-internal.js';
import type {
  ChangeInstanceId,
  Digest,
  PlanningSpaceId,
  RunId,
  WorkspaceInstanceId,
  WorkspaceRevision,
} from '../contracts.js';
import type { CanonicalRecordLimits, CanonicalRunRecord } from './record.js';
import { createCanonicalRunRecord } from './record.js';
import { createFilesystemRunStore } from './run-store-fs.js';
import { createFilesystemEvidenceStore } from './evidence-store-fs.js';
import type { BoundedEvidenceStore } from './evidence.js';
import {
  createHostEvidenceWriter,
  type HostEvidenceWriter,
} from './host-evidence-writer.js';
import type { RunStore } from './run-store.js';
import { lowerRuntimePlan } from './lowerer.js';
import { openRuntimePlan, type RuntimePlan } from './runtime-plan.js';
import { buildAgentAction } from './actions.js';
import { observeGitWorkspace } from './workspace-git.js';
import type { WorkspaceManifest } from './workspace.js';
import { deriveWorkspaceRevision } from './workspace.js';
import { createChangePipelineRuntime } from './facade-runtime.js';
import type { ChangePipelineRuntime } from '../facade.js';
import type { JsonValue, NodeId, RunAction } from '../contracts.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WORKSPACE_DIR_NAME } from '../../config.js';
import {
  createFilesystemWorkspaceReservationRegistry,
  createWorkspaceReservationRegistry,
  type WorkspaceReservationRegistry,
} from './reservations.js';
import type {
  HostedTurnReceipt,
  SessionHost,
  SessionHostView,
} from '../../session-host/contracts.js';
import { digestSessionHostText } from '../../session-host/registry.js';

const SERVICE_RESERVATIONS = new Map<string, WorkspaceReservationRegistry>();

/** Daemon/runtime-service scoped registry shared by every RunStore instance. */
export function runtimeServiceReservationRegistry(
  storeRoot: string
): WorkspaceReservationRegistry {
  const resolved = path.resolve(storeRoot);
  const key = process.platform === 'win32'
    ? resolved.toLocaleLowerCase('en-US')
    : resolved;
  let registry = SERVICE_RESERVATIONS.get(key);
  if (registry === undefined) {
    const store = createFilesystemRunStore(resolved);
    registry = createFilesystemWorkspaceReservationRegistry({
      storeRoot: resolved,
      loadRecords: () =>
        store
          .list()
          .map((summary) => store.load(summary.runId)),
    });
    SERVICE_RESERVATIONS.set(key, registry);
  }
  return registry;
}

export class StoredRuntimeContextError extends Error {
  constructor(
    readonly code:
      | 'task_loop_workspace_authority_unavailable'
      | 'task_loop_workspace_authority_mismatch',
    message: string
  ) {
    super(message);
    this.name = 'StoredRuntimeContextError';
  }
}

export interface RuntimeContextInput {
  readonly projectRoot: string;
  readonly prepared: PreparedDefinition;
  readonly profile: RuntimeExecutionProfile;
  readonly runId: RunId;
  readonly planningSpaceId: PlanningSpaceId;
  readonly workspaceInstanceId: WorkspaceInstanceId;
  readonly changeInstanceId: ChangeInstanceId;
  readonly changeId: string;
  readonly projectId: string;
  readonly launchRequestDigest: Digest;
  readonly storeRoot: string;
  /** Persisted RuntimePlan for an existing Run; decoded and verified here. */
  readonly frozenPlan?: unknown;
  readonly limits?: CanonicalRecordLimits;
  readonly inputs?: Readonly<Record<string, unknown>>;
  /**
   * Optional callback that resolves the association registry's source state
   * for a Run's ChangeInstance (M2). When provided, `pipeline status` on an
   * archived Run reports `sourceState: 'archived'`.
   */
  readonly resolveSourceState?: (record: CanonicalRunRecord) => 'active' | 'archived' | 'missing';
  /** Override only for tests or an explicitly wider runtime-service scope. */
  readonly reservationRegistry?: WorkspaceReservationRegistry;
  readonly verifyHostedTurnReceipt?: (receipt: HostedTurnReceipt) => boolean;
}

export interface RuntimeContext {
  readonly plan: RuntimePlan;
  readonly facade: ChangePipelineRuntime;
  readonly store: RunStore;
  readonly initialRecord: CanonicalRunRecord;
  readonly evidenceStore: BoundedEvidenceStore;
  readonly hostEvidenceWriter: HostEvidenceWriter;
}

export interface StoredRuntimeContextInput {
  readonly storeRoot: string;
  readonly runId: RunId;
  readonly reservationRegistry?: WorkspaceReservationRegistry;
  readonly verifyHostedTurnReceipt?: (receipt: HostedTurnReceipt) => boolean;
  /** Daemon-owned ordinary/source host; never reconstructed from a request. */
  readonly sourceSessionHost?: Pick<SessionHost, 'inspect' | 'list'>;
}

const DEFAULT_LIMITS: CanonicalRecordLimits = Object.freeze({
  maxAttempts: 12,
  maxActions: 64,
  maxRecordRevisions: 256,
  maxTransitions: 4096,
  maxEvidenceRefsPerAction: 16,
  limitOutcome: 'escalated',
});

/**
 * The number of Actions a plan needs to reach its terminal outcome, in the
 * worst case: one per admittable node, plus `maxIterations x phases` for each
 * bounded loop. Join nodes are never admitted (the Join pass derives its state
 * from committed member results) and Finish is not an Action.
 */
function expectedActionCount(plan: RuntimePlan): number {
  let expected = 0;
  for (const node of plan.nodes) {
    if (node.kind === 'join' || node.kind === 'finish') continue;
    if (node.kind !== 'bounded-loop') {
      expected += 1;
      continue;
    }
    const bodySize =
      node.body.kind === 'composite'
        ? node.body.stages.length
        : node.body.phases.length;
    expected += node.limits.maxIterations * Math.max(1, bodySize);
  }
  return expected;
}

/**
 * Size the sealed Record limits to the plan.
 *
 * `counters.attempts` is a RUN-WIDE count of distinct attemptIds, so a fixed
 * `maxAttempts: 12` caps the whole Run at 12 Actions regardless of
 * `maxActions`. `full-feature` needs 17 (3 lead-in + fan-out condition + 6
 * members + 4 review-cycle phases + ship/retain/archive), so under the flat
 * default it escalated with `execution_budget_exhausted` mid review-cycle —
 * a Run that can never complete. Deriving the ceiling from the plan (with 2x
 * headroom for retries) keeps the guardrail meaningful for small pipelines
 * while letting large ones finish. Limits only ever grow relative to the
 * flat defaults; they are never lowered.
 */
function deriveLimits(plan: RuntimePlan): CanonicalRecordLimits {
  const headroom = expectedActionCount(plan) * 2;
  return Object.freeze({
    ...DEFAULT_LIMITS,
    maxAttempts: Math.max(DEFAULT_LIMITS.maxAttempts, headroom),
    maxActions: Math.max(DEFAULT_LIMITS.maxActions, headroom),
  });
}

interface TaskLoopWorkspaceProjection {
  readonly evidenceDir: string;
  readonly observeWorkspace: () => WorkspaceRevision;
}

function platformPathIdentity(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32'
    ? resolved.toLocaleLowerCase('en-US')
    : resolved;
}

function canonicalProjectRoot(value: string): string {
  if (!path.isAbsolute(value)) {
    throw new StoredRuntimeContextError(
      'task_loop_workspace_authority_mismatch',
      'The daemon-owned source Session cwd is not absolute.'
    );
  }
  let canonical: string;
  try {
    if (!fs.statSync(value).isDirectory()) throw new Error('not-directory');
    canonical = fs.realpathSync.native(value);
  } catch {
    throw new StoredRuntimeContextError(
      'task_loop_workspace_authority_unavailable',
      'The daemon-owned source Session cwd is unavailable.'
    );
  }
  if (platformPathIdentity(canonical) !== platformPathIdentity(value)) {
    throw new StoredRuntimeContextError(
      'task_loop_workspace_authority_mismatch',
      'The daemon-owned source Session cwd is not canonical.'
    );
  }
  return canonical;
}

function createTaskLoopWorkspaceProjection(input: Readonly<{
  projectRoot: string;
  changeId: string;
  plan: RuntimePlan;
}>): TaskLoopWorkspaceProjection {
  const projectRoot = canonicalProjectRoot(input.projectRoot);
  const evidenceDir = path.join(
    projectRoot,
    WORKSPACE_DIR_NAME,
    'changes',
    input.changeId,
    'evidence'
  );
  const reportPath = path
    .relative(projectRoot, path.join(evidenceDir, 'task-loop-report.md'))
    .split(path.sep)
    .join('/');
  const ephemeraPrefix = `.rasen/changes/${input.changeId}/ephemera/`;
  const omitRuntimeProjection = (manifest: WorkspaceManifest): WorkspaceManifest => {
    if (input.plan.pipeline !== 'task-loop') return manifest;
    const keep = (entry: { readonly path: string }) => {
      const normalized = entry.path.split('\\').join('/');
      return normalized !== reportPath && !normalized.startsWith(ephemeraPrefix);
    };
    return Object.freeze({
      ...manifest,
      headTree: manifest.headTree.filter(keep),
      index: manifest.index.filter(keep),
      trackedWorking: manifest.trackedWorking.filter(keep),
      untracked: manifest.untracked.filter(keep),
      symlinks: manifest.symlinks.filter(keep),
    });
  };
  return Object.freeze({
    evidenceDir,
    observeWorkspace: () =>
      deriveWorkspaceRevision(
        omitRuntimeProjection(observeGitWorkspace(projectRoot))
      ),
  });
}

function taskLoopSourceSession(
  record: CanonicalRunRecord,
  host: Pick<SessionHost, 'inspect' | 'list'>
): Readonly<{ action: RunAction; session: SessionHostView }> {
  const liveConsultations = Object.values(record.consultations ?? {}).filter(
    (consultation) =>
      consultation.state !== 'continued' && consultation.state !== 'closed'
  );
  if (liveConsultations.length > 1) {
    throw new StoredRuntimeContextError(
      'task_loop_workspace_authority_mismatch',
      'The canonical Run has ambiguous live consultation source authority.'
    );
  }
  if (liveConsultations.length === 1) {
    const consultation = liveConsultations[0]!;
    const committed = record.actions[consultation.source.actionId];
    const session = host.inspect(consultation.source.stableSessionId);
    if (committed?.action.kind !== 'agent' || session === undefined) {
      throw new StoredRuntimeContextError(
        'task_loop_workspace_authority_unavailable',
        'The canonical consultation source Session is unavailable.'
      );
    }
    return Object.freeze({ action: committed.action, session });
  }

  const candidates = Object.values(record.actions).flatMap((source) => {
    if (
      source.state !== 'active' ||
      source.action.kind !== 'agent' ||
      source.action.agent.consultation?.eligible !== true
    ) {
      return [];
    }
    const action = source.action;
    return host.list().filter(
      (session) =>
        session.authority?.invocationId === action.invocationId &&
        session.authority.role === action.agent.role &&
        session.authority.workspaceInstanceId === record.workspaceInstanceId &&
        session.authority.backend === 'hosted'
    ).map((session) => ({ action, session }));
  });
  if (candidates.length !== 1) {
    throw new StoredRuntimeContextError(
      candidates.length === 0
        ? 'task_loop_workspace_authority_unavailable'
        : 'task_loop_workspace_authority_mismatch',
      candidates.length === 0
        ? 'The task-loop source Session authority is unavailable.'
        : 'The task-loop source Session authority is ambiguous.'
    );
  }
  return Object.freeze(candidates[0]!);
}

function trustedTaskLoopProjectRoot(
  record: CanonicalRunRecord,
  host: Pick<SessionHost, 'inspect' | 'list'> | undefined
): string {
  if (host === undefined) {
    throw new StoredRuntimeContextError(
      'task_loop_workspace_authority_unavailable',
      'Stored task-loop recovery requires the daemon-owned ordinary SessionHost.'
    );
  }
  const { action, session } = taskLoopSourceSession(record, host);
  if (
    action.kind !== 'agent' ||
    session.sessionId.length === 0 ||
    session.authority?.invocationId !== action.invocationId ||
    session.authority.role !== action.agent.role ||
    session.authority.workspaceInstanceId !== record.workspaceInstanceId ||
    session.authority.backend !== 'hosted' ||
    session.backend !== action.agent.runtime ||
    session.cwdDigest !== digestSessionHostText(session.cwd)
  ) {
    throw new StoredRuntimeContextError(
      'task_loop_workspace_authority_mismatch',
      'The daemon-owned source Session disagrees with canonical Action, Invocation, role, workspace, backend, cwd, or cwd digest authority.'
    );
  }
  const liveConsultation = Object.values(record.consultations ?? {}).find(
    (consultation) =>
      consultation.state !== 'continued' && consultation.state !== 'closed'
  );
  if (
    liveConsultation !== undefined &&
    (liveConsultation.source.actionId !== action.actionId ||
      liveConsultation.source.invocationId !== action.invocationId ||
      liveConsultation.source.stableSessionId !== session.sessionId)
  ) {
    throw new StoredRuntimeContextError(
      'task_loop_workspace_authority_mismatch',
      'The canonical consultation and daemon-owned source Session identities disagree.'
    );
  }
  return canonicalProjectRoot(session.cwd);
}

/**
 * Assemble the runtime context the CLI/management entry points drive (task
 * 10.2 launch wiring). Lowers the prepared Definition+Profile into the
 * reconciler's RuntimePlan, observes the live workspace, constructs the
 * initial canonical Record, opens the immutable filesystem RunStore, and
 * wires the facade with an action builder bound to the frozen capability
 * bindings. Everything after this goes through the public
 * {@link ChangePipelineRuntime} interface.
 */
export function prepareRuntimeContext(input: RuntimeContextInput): RuntimeContext {
  const currentPlan = lowerRuntimePlan(input.prepared, input.profile, input.runId);
  const plan =
    input.frozenPlan === undefined
      ? currentPlan
      : openRuntimePlan(input.frozenPlan);
  if (plan.runId !== input.runId) {
    throw new Error('Persisted RuntimePlan RunId does not match the requested Run.');
  }
  const profile =
    plan.executionProfile === undefined
      ? input.profile
      : openRuntimeExecutionProfile(plan.executionProfile);
  if (
    profile.profileDigest !== plan.profileDigest ||
    profile.sourceRevision.semanticDigest !== plan.sourceRevisionDigest ||
    profile.capabilityProfileDigest !== plan.capabilityDigest ||
    profile.policyDigest !== plan.policyDigest
  ) {
    throw new Error(
      'Persisted RuntimePlan has no usable frozen execution profile for this Run.'
    );
  }
  const taskLoopProjection = plan.pipeline === 'task-loop'
    ? createTaskLoopWorkspaceProjection({
        projectRoot: input.projectRoot,
        changeId: input.changeId,
        plan,
      })
    : undefined;
  const observeWorkspace = taskLoopProjection?.observeWorkspace ?? (() =>
    deriveWorkspaceRevision(observeGitWorkspace(input.projectRoot))
  );
  const workspaceRevision = observeWorkspace();
  const initialRecord = createCanonicalRunRecord({
    runId: plan.runId,
    runOrdinal: 1,
    change: {
      planningSpaceId: input.planningSpaceId,
      projectId: input.projectId,
      changeId: input.changeId,
      instanceId: input.changeInstanceId,
    },
    workspaceInstanceId: input.workspaceInstanceId,
    pipeline: plan.pipeline,
    launchRequestDigest: input.launchRequestDigest,
    planDigest: plan.planDigest,
    sourceRevisionDigest: plan.sourceRevisionDigest,
    capabilityDigest: plan.capabilityDigest,
    policyDigest: plan.policyDigest,
    executionProfileDigest: plan.profileDigest,
    initialWorkspaceRevision: workspaceRevision,
    inputs: (input.inputs ?? {}) as Readonly<Record<string, JsonValue>>,
    limits: input.limits ?? deriveLimits(plan),
  });

  const store = createFilesystemRunStore(input.storeRoot);
  const evidenceStore = createFilesystemEvidenceStore(input.storeRoot, plan.runId, {
    maxRunBytes: 64 * 1024 * 1024,
    maxEntries: 64,
  });
  const capabilityByPath = new Map(
    profile.capabilities.map((binding) => [binding.nodeId, binding] as const)
  );
  const stageByPath = new Map(
    profile.policy.stages.map((stage) => [stage.nodeId, stage] as const)
  );

  const buildAction = (descriptor: {
    nodeId: string;
    occurrence: number;
    admissionKind: 'agent' | 'command' | 'host';
    profilePath?: string;
    input?: JsonValue;
  }): RunAction => {
    // Bounded-loop phase admits (review-cycle) carry a profilePath to look
    // up the capability/stage binding directly — no plan-node lookup needed.
    // Atomic admits look up the plan node by nodeId to get hierarchicalPath.
    const hierarchicalPath =
      descriptor.profilePath ??
      plan.nodes.find((entry) => entry.nodeId === descriptor.nodeId)
        ?.hierarchicalPath;
    if (hierarchicalPath === undefined) {
      throw new Error(`No plan node or profile path for ${descriptor.nodeId}`);
    }
    const capability = capabilityByPath.get(hierarchicalPath);
    const stage = stageByPath.get(hierarchicalPath);
    const consultationBinding = profile.consultations?.find(
      (binding) => binding.sourceProfilePath === hierarchicalPath
    );
    if (capability === undefined || stage === undefined) {
      throw new Error(`No capability/policy binding for ${hierarchicalPath}`);
    }
    return buildAgentAction(
      {
        capability,
        stage: stage as never,
        executionProfileDigest: profile.profileDigest,
        policyDigest: profile.policyDigest,
        ...(consultationBinding === undefined
          ? {}
          : { consultationBinding }),
      },
      {
        runId: plan.runId,
        nodeId: descriptor.nodeId as NodeId,
        occurrence: descriptor.occurrence,
        attemptOrdinal: 0,
        expectedBeforeWorkspace:
          plan.pipeline === 'task-loop' ? observeWorkspace() : workspaceRevision,
      },
      {
        input: (descriptor.input ?? {
          change: input.changeId,
        }) as never,
      }
    );
  };

  const facade = createChangePipelineRuntime({
    store,
    plan,
    initialRecord,
    executionProfile: profile,
    evidenceStore,
    buildAction,
    reservationRegistry:
      input.reservationRegistry ?? runtimeServiceReservationRegistry(input.storeRoot),
    verifyHostedTurnReceipt: input.verifyHostedTurnReceipt,
    resolveSourceState: input.resolveSourceState,
    taskLoopEvidenceDir:
      taskLoopProjection?.evidenceDir,
    observeWorkspace: plan.pipeline === 'task-loop' ? observeWorkspace : undefined,
  });

  const hostEvidenceWriter = createHostEvidenceWriter({
    runId: plan.runId,
    runStore: store,
    evidenceStore,
  });

  return Object.freeze({
    plan,
    facade,
    store,
    initialRecord,
    evidenceStore,
    hostEvidenceWriter,
  });
}

/**
 * Reopen the exact persisted RuntimePlan/Profile/Record for daemon-owned
 * execution. This is the production restart path used by the consultation
 * driver; it never reconstructs authority from an HTTP body.
 */
export function openStoredRuntimeContext(
  input: StoredRuntimeContextInput
): RuntimeContext {
  const store = createFilesystemRunStore(input.storeRoot);
  const initialRecord = store.load(input.runId);
  const frozenPlan = store.loadPlan?.(input.runId);
  if (frozenPlan === null || frozenPlan === undefined) {
    throw new Error('Persisted Run has no frozen RuntimePlan.');
  }
  const plan = openRuntimePlan(frozenPlan);
  if (plan.runId !== input.runId || plan.executionProfile === undefined) {
    throw new Error('Persisted RuntimePlan does not match the requested Run.');
  }
  const profile = openRuntimeExecutionProfile(plan.executionProfile);
  const capabilityByPath = new Map(
    profile.capabilities.map((binding) => [binding.nodeId, binding] as const)
  );
  const stageByPath = new Map(
    profile.policy.stages.map((stage) => [stage.nodeId, stage] as const)
  );
  const buildAction = (descriptor: {
    nodeId: string;
    occurrence: number;
    admissionKind: 'agent' | 'command' | 'host';
    profilePath?: string;
    input?: JsonValue;
  }): RunAction => {
    const hierarchicalPath =
      descriptor.profilePath ??
      plan.nodes.find((entry) => entry.nodeId === descriptor.nodeId)?.hierarchicalPath;
    if (hierarchicalPath === undefined) {
      throw new Error(`No persisted plan path for ${descriptor.nodeId}.`);
    }
    const capability = capabilityByPath.get(hierarchicalPath);
    const stage = stageByPath.get(hierarchicalPath);
    const consultationBinding = profile.consultations?.find(
      (binding) => binding.sourceProfilePath === hierarchicalPath
    );
    if (capability === undefined || stage === undefined) {
      throw new Error(`No persisted capability/policy binding for ${hierarchicalPath}.`);
    }
    const head = store.load(input.runId);
    return buildAgentAction(
      {
        capability,
        stage: stage as never,
        executionProfileDigest: profile.profileDigest,
        policyDigest: profile.policyDigest,
        ...(consultationBinding === undefined ? {} : { consultationBinding }),
      },
      {
        runId: plan.runId,
        nodeId: descriptor.nodeId as NodeId,
        occurrence: descriptor.occurrence,
        attemptOrdinal: 0,
        expectedBeforeWorkspace: head.currentWorkspaceRevision,
      },
      { input: (descriptor.input ?? {}) as never }
    );
  };
  const evidenceStore = createFilesystemEvidenceStore(input.storeRoot, plan.runId, {
    maxRunBytes: 64 * 1024 * 1024,
    maxEntries: 64,
  });
  const storedTaskLoopProjection = (): TaskLoopWorkspaceProjection => {
    const head = store.load(input.runId);
    const projectRoot = trustedTaskLoopProjectRoot(
      head,
      input.sourceSessionHost
    );
    return createTaskLoopWorkspaceProjection({
      projectRoot,
      changeId: head.change.changeId,
      plan,
    });
  };
  const facade = createChangePipelineRuntime({
    store,
    plan,
    initialRecord,
    executionProfile: profile,
    evidenceStore,
    buildAction,
    reservationRegistry:
      input.reservationRegistry ?? runtimeServiceReservationRegistry(input.storeRoot),
    ...(input.verifyHostedTurnReceipt === undefined
      ? {}
      : { verifyHostedTurnReceipt: input.verifyHostedTurnReceipt }),
    ...(plan.pipeline === 'task-loop'
      ? {
          taskLoopEvidenceDir: () => storedTaskLoopProjection().evidenceDir,
          observeWorkspace: () => storedTaskLoopProjection().observeWorkspace(),
        }
      : {}),
  });
  const hostEvidenceWriter = createHostEvidenceWriter({
    runId: plan.runId,
    runStore: store,
    evidenceStore,
  });
  return Object.freeze({
    plan,
    facade,
    store,
    initialRecord,
    evidenceStore,
    hostEvidenceWriter,
  });
}
