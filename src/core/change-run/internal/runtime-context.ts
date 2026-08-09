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
  WorkspaceRevision,
} from '../contracts.js';
import type { CanonicalRecordLimits, CanonicalRunRecord } from './record.js';
import { createCanonicalRunRecord } from './record.js';
import { createFilesystemRunStore } from './run-store-fs.js';
import type { RunStore } from './run-store.js';
import { lowerRuntimePlan } from './lowerer.js';
import type { RuntimePlan } from './runtime-plan.js';
import { buildAgentAction } from './actions.js';
import { observeGitWorkspace } from './workspace-git.js';
import type { WorkspaceManifest } from './workspace.js';
import { deriveWorkspaceRevision } from './workspace.js';
import { createChangePipelineRuntime } from './facade-runtime.js';
import type { ChangePipelineRuntime } from '../facade.js';
import type { JsonValue, NodeId, RunAction } from '../contracts.js';
import path from 'node:path';
import { WORKSPACE_DIR_NAME } from '../../config.js';

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
    expected += node.maxIterations * Math.max(1, bodySize);
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
  const taskLoopEvidenceDir = path.join(
    input.projectRoot,
    WORKSPACE_DIR_NAME,
    'changes',
    input.changeId,
    'evidence'
  );
  const taskLoopReportPath = path
    .relative(
      input.projectRoot,
      path.join(taskLoopEvidenceDir, 'task-loop-report.md')
    )
    .split(path.sep)
    .join('/');
  const taskLoopEphemeraPrefix = `.rasen/changes/${input.changeId}/ephemera/`;
  const omitTaskLoopRuntimeProjection = (
    manifest: WorkspaceManifest
  ): WorkspaceManifest => {
    if (plan.pipeline !== 'task-loop') return manifest;
    const keep = (entry: { readonly path: string }) => {
      const normalized = entry.path.split('\\').join('/');
      return (
        normalized !== taskLoopReportPath &&
        !normalized.startsWith(taskLoopEphemeraPrefix)
      );
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
  const observeWorkspace = (): WorkspaceRevision =>
    deriveWorkspaceRevision(
      omitTaskLoopRuntimeProjection(observeGitWorkspace(input.projectRoot))
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
    if (capability === undefined || stage === undefined) {
      throw new Error(`No capability/policy binding for ${hierarchicalPath}`);
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
    buildAction,
    resolveSourceState: input.resolveSourceState,
    taskLoopEvidenceDir:
      plan.pipeline === 'task-loop'
        ? taskLoopEvidenceDir
        : undefined,
    observeWorkspace: plan.pipeline === 'task-loop' ? observeWorkspace : undefined,
  });

  return Object.freeze({ plan, facade, store, initialRecord });
}
