import type {
  PreparedDefinition,
} from '../../pipeline-registry/definition.js';
import type { RuntimeExecutionProfile } from '../../pipeline-registry/execution-plan-internal.js';
import type {
  ChangeInstanceId,
  Digest,
  PlanningSpaceId,
  RunId,
  WorkspaceInstanceId,
} from '../contracts.js';
import type { CanonicalRecordLimits, CanonicalRunRecord } from './record.js';
import { createCanonicalRunRecord } from './record.js';
import { createFilesystemRunStore } from './run-store-fs.js';
import type { RunStore } from './run-store.js';
import { lowerRuntimePlan } from './lowerer.js';
import type { RuntimePlan } from './runtime-plan.js';
import { buildAgentAction } from './actions.js';
import { observeGitWorkspace } from './workspace-git.js';
import { deriveWorkspaceRevision } from './workspace.js';
import { createChangePipelineRuntime } from './facade-runtime.js';
import type { ChangePipelineRuntime } from '../facade.js';
import type { JsonValue, NodeId, RunAction } from '../contracts.js';

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
  readonly limits?: CanonicalRecordLimits;
  readonly inputs?: Readonly<Record<string, unknown>>;
  /**
   * Optional callback that resolves the association registry's source state
   * for a Run's ChangeInstance (M2). When provided, `pipeline status` on an
   * archived Run reports `sourceState: 'archived'`.
   */
  readonly resolveSourceState?: (record: CanonicalRunRecord) => 'active' | 'archived' | 'missing';
}

export interface RuntimeContext {
  readonly plan: RuntimePlan;
  readonly facade: ChangePipelineRuntime;
  readonly store: RunStore;
  readonly initialRecord: CanonicalRunRecord;
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
 * Assemble the runtime context the CLI/management entry points drive (task
 * 10.2 launch wiring). Lowers the prepared Definition+Profile into the
 * reconciler's RuntimePlan, observes the live workspace, constructs the
 * initial canonical Record, opens the immutable filesystem RunStore, and
 * wires the facade with an action builder bound to the frozen capability
 * bindings. Everything after this goes through the public
 * {@link ChangePipelineRuntime} interface.
 */
export function prepareRuntimeContext(input: RuntimeContextInput): RuntimeContext {
  const plan = lowerRuntimePlan(input.prepared, input.profile, input.runId);
  const workspaceRevision = deriveWorkspaceRevision(
    observeGitWorkspace(input.projectRoot)
  );
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
    limits: input.limits ?? DEFAULT_LIMITS,
  });

  const store = createFilesystemRunStore(input.storeRoot);
  const capabilityByPath = new Map(
    input.profile.capabilities.map((binding) => [binding.nodeId, binding] as const)
  );
  const stageByPath = new Map(
    input.profile.policy.stages.map((stage) => [stage.nodeId, stage] as const)
  );

  const buildAction = (descriptor: {
    nodeId: string;
    occurrence: number;
    admissionKind: 'agent' | 'command' | 'host';
  }): RunAction => {
    const node = plan.nodes.find((entry) => entry.nodeId === descriptor.nodeId);
    if (node === undefined || node.kind !== 'atomic') {
      throw new Error(`No atomic plan node for ${descriptor.nodeId}`);
    }
    const capability = capabilityByPath.get(node.hierarchicalPath);
    const stage = stageByPath.get(node.hierarchicalPath);
    if (capability === undefined || stage === undefined) {
      throw new Error(`No capability/policy binding for ${node.hierarchicalPath}`);
    }
    return buildAgentAction(
      {
        capability,
        stage: stage as never,
        executionProfileDigest: input.profile.profileDigest,
        policyDigest: input.profile.policyDigest,
      },
      {
        runId: plan.runId,
        nodeId: descriptor.nodeId as NodeId,
        occurrence: descriptor.occurrence,
        attemptOrdinal: 0,
        expectedBeforeWorkspace: workspaceRevision,
      },
      { input: { change: input.changeId } as never }
    );
  };

  const facade = createChangePipelineRuntime({
    store,
    plan,
    initialRecord,
    buildAction,
    resolveSourceState: input.resolveSourceState,
  });

  return Object.freeze({ plan, facade, store, initialRecord });
}
