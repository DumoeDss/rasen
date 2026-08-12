import type {
  ActionId,
  AgentTurnInputCandidate,
  AttemptId,
  ChangeRunControlRequest,
  ChangeRunReceipt,
  ChangeRunView,
  CompleteRunAction,
  Digest,
  ExactChangeRunRef,
  RunAction,
  WorkspaceRevision,
} from '../contracts.js';
import {
  decodeConsultationContinuationSettlement,
  decodeConsultationTeacherFailureSettlement,
  deriveFreshStepRequestId,
  type AgentContinuationGrant,
  type ConsultationContinuationSettlement,
  type ConsultationStepSubmission,
  type ConsultationTeacherFailureSettlement,
} from '../consultation-contracts.js';
import {
  ChangeRunRuntimeError,
  type AdmitAgentCandidatesContext,
  type ChangePipelineRuntime,
  type RuntimeMutationContext,
} from '../facade.js';
import type { RuntimePlan } from './runtime-plan.js';
import type { CanonicalRunRecord } from './record.js';
import { digestCanonicalRunRecord } from './record.js';
import type { RunStore } from './run-store.js';
import {
  reduceCanonicalRunRecord,
  reduceCandidateBatch,
  type RunStimulus,
} from './reducer.js';
import { reconcile, type ReconcilerNextAction } from './reconciler.js';
import { projectRunView } from './projector.js';
import {
  classifyCompletionSlot,
  verifyCompletion,
} from './completion.js';
import { type EvidenceStore } from './evidence.js';
import {
  verifyAttestedCompletion,
  verifyAttestedConsultationSubmission,
} from './attestation.js';
import { createCanonicalWait, type CanonicalWait } from './waits.js';
import {
  canonicalJson,
  deriveInvocationId,
  digestLaunchIntent,
  domainDigest,
} from './identity.js';
import type { WorkspaceReservationRegistry } from './reservations.js';
import type { HostedTurnReceipt } from '../../session-host/contracts.js';
import { validateReviewCycleCompletion, projectReviewCycleProgress } from './review-cycle-runtime.js';
import {
  projectGoalCycleDomainSnapshot,
  locateGoalCycleInvocation,
  validateGoalCycleCompletion,
  projectGoalCycleProgress,
} from './goal-cycle-runtime.js';
import { assertReviewCycleMayShip } from './review-cycle.js';
import { assertGoalCycleMayShip } from './goal-cycle.js';
import { projectCompositeBodyProgress } from './composite-runtime.js';
import {
  decodeBoundedLoopStrategyResult,
  reduceBoundedLoopLifecycle,
  strategyTriggerForAction,
} from './bounded-loop-lifecycle.js';
import {
  classifyConsultationRequest,
  commitTeacherAdvice,
  continuationGrantFromCommitted,
} from './consultation-lifecycle.js';
import type { RuntimeExecutionProfile } from '../../pipeline-registry/execution-plan-internal.js';
import {
  assertTaskLoopMayDeliver,
  isTaskLoopRun,
  validateTaskLoopCompletion,
  writeTaskLoopReport,
} from './task-loop.js';

export interface RuntimeDeps {
  readonly store: RunStore;
  readonly plan: RuntimePlan;
  readonly initialRecord: CanonicalRunRecord;
  readonly executionProfile?: RuntimeExecutionProfile;
  /**
   * Run-scoped immutable evidence bytes. Observation mutation requires this
   * verifier seam; omitting it keeps legacy/domain-only fixtures inspectable
   * but fails every observation closed.
   */
  readonly evidenceStore?: EvidenceStore;
  /**
   * Build a full RunAction for a reconciler admit candidate. The caller binds
   * the frozen capability + policy; the facade never invents action identity.
   */
  readonly buildAction: (descriptor: {
    readonly nodeId: string;
    readonly occurrence: number;
    readonly admissionKind: 'agent' | 'command' | 'host';
    readonly profilePath?: string;
    readonly input?: import('../contracts.js').JsonValue;
    /** Exact trusted driver-rendered bytes, required for every admitted agent Action. */
    readonly renderedTurnInput?: string;
  }) => RunAction;
  /**
   * Optional mutation guard invoked before every mutating operation
   * (`complete`, `control`). The guard receives the current head Record and
   * may throw a {@link ChangeRunRuntimeError} (e.g. code
   * `change_instance_inactive`) to reject the mutation. `start`, `resume`, and
   * `inspect` are NOT guarded — a Run remains exactly inspectable and resumable
   * even after its source Change is archived (design §10/§15).
   *
   * When omitted (e.g. the frozen `runtime-context.ts` wiring path), the facade
   * performs no archive check itself; callers that need the guard must enforce
   * it before the facade call (the CLI `complete`/`control` commands do this).
   */
  readonly assertMutationAllowed?: (record: CanonicalRunRecord) => void;
  /**
   * Optional cross-Run workspace reservation registry. When wired, the facade
   * consults it before admitting any workspace-touching Action
   * (`access: 'read' | 'write'`). A reservation conflict converts the admit
   * into a blocked intent that enters a durable `workspace-reservation` wait,
   * so two Runs wanting the same WorkspaceInstanceId are serialized without
   * the pure reconciler ever seeing another Run's Record. The same registry
   * instance MUST be shared by every Run facade targeting one workspace.
   *
   * When omitted, the facade admits workspace candidates as the reconciler
   * selects them (single-Run semantics); intra-Run contention still produces
   * `await-workspace` candidates that the facade commits as
   * `workspace-reservation` waits.
   */
  readonly reservationRegistry?: WorkspaceReservationRegistry;
  /**
   * Server-owned verification of a hosted receipt against the durable
   * SessionHost registry and content-addressed result bytes.
   */
  readonly verifyHostedTurnReceipt?: (receipt: HostedTurnReceipt) => boolean;
  /**
   * Optional callback that resolves the association registry's authoritative
   * source state for a Run's ChangeInstance (M2). When provided, the facade
   * passes the resolved state to `projectRunView`, so `pipeline status` on an
   * archived Run reports `sourceState: 'archived'` instead of the default
   * `'active'`. When omitted, the projector defaults to `'active'` (the safe
   * default for pre-registry Runs and test fixtures).
   */
  readonly resolveSourceState?: (record: CanonicalRunRecord) => 'active' | 'archived' | 'missing';
  /** Derived task-loop report destination; never authoritative for replay. */
  readonly taskLoopEvidenceDir?: string | (() => string);
  /** Trusted live workspace observation used by TaskLoop evidence guards. */
  readonly observeWorkspace?: () => WorkspaceRevision;
}

/**
 * Every completion variant crosses the same trusted public boundary. Verify
 * its frozen Action authority and the actual Run-scoped stored bytes before
 * slot classification or any Record mutation. A receipt is self-consistent,
 * not self-authorizing: its caller-supplied actor and EvidenceRefs must match
 * the authority frozen when the Action was admitted.
 */
function verifyCompletionAuthority(
  request: CompleteRunAction,
  record: CanonicalRunRecord,
  action: RunAction,
  evidenceStore: EvidenceStore | undefined
): void {
  if (evidenceStore === undefined) {
    throw new Error(
      'facade complete failed: no persistent EvidenceStore is bound to this Run.'
    );
  }
  verifyAttestedCompletion(record, action, request, (ref) =>
    evidenceStore.read(ref)
  );
}

function asPromise<T>(value: T): Promise<T> {
  return Promise.resolve(value);
}

function candidateDescriptor(
  record: CanonicalRunRecord,
  candidate: Extract<ReconcilerNextAction, { kind: 'admit' }>
): AgentTurnInputCandidate {
  const descriptor = {
    nodeId: candidate.nodeId,
    occurrence: candidate.occurrence,
    ...(candidate.profilePath !== undefined
      ? { profilePath: candidate.profilePath }
      : {}),
    ...(candidate.input !== undefined
      ? { input: candidate.input }
      : {}),
  };
  return Object.freeze({
    format: 'change-run-agent-candidate/1' as const,
    candidateId: `candidate:${domainDigest(
      'change-run-agent-candidate/1',
      record.runId,
      record.recordVersion,
      digestCanonicalRunRecord(record),
      canonicalJson(descriptor)
    ).slice('sha256:'.length)}`,
    runId: record.runId,
    recordVersion: record.recordVersion,
    ...descriptor,
  });
}

function previewAgentCandidates(
  record: CanonicalRunRecord,
  plan: RuntimePlan
): readonly AgentTurnInputCandidate[] {
  const reconciled = reconcile(plan, record);
  if (!reconciled.ok) {
    throw new Error(`facade preview reconcile failed: ${reconciled.failure.message}`);
  }
  return Object.freeze(
    reconciled.actions
      .filter(
        (candidate): candidate is Extract<ReconcilerNextAction, { kind: 'admit' }> =>
          candidate.kind === 'admit' && candidate.admissionKind === 'agent'
      )
      .map((candidate) => candidateDescriptor(record, candidate))
  );
}

function receipt(
  record: CanonicalRunRecord,
  disposition: ChangeRunReceipt['disposition'],
  actions: readonly RunAction[],
  resolveSourceState?: (record: CanonicalRunRecord) => 'active' | 'archived' | 'missing',
  plan?: RuntimePlan,
  buildAction?: RuntimeDeps['buildAction'],
  candidates?: readonly AgentTurnInputCandidate[],
  continuationGrants: readonly AgentContinuationGrant[] = []
): ChangeRunReceipt {
  const sourceState = resolveSourceState?.(record) ?? 'active';
  const effectiveCandidates =
    candidates ??
    (plan !== undefined && buildAction !== undefined && record.terminal === undefined
      ? previewAgentCandidates(record, plan)
      : []);
  return Object.freeze({
    format: 'change-run-receipt/1',
    disposition,
    view: projectRunView(record, sourceState, plan),
    actions: Object.freeze([...actions]),
    candidates: Object.freeze([...effectiveCandidates]),
    ...(continuationGrants.length === 0
      ? {}
      : { continuationGrants: Object.freeze([...continuationGrants]) }),
  }) as ChangeRunReceipt;
}

/**
 * Build a `capability-unavailable` CanonicalWait for a `suspend-unsupported`
 * candidate. The wait is bound to the verify action that completed with a
 * complex adaptive route — the action is already closed (its result was
 * committed), and the wait records that the next step's required capability
 * (e.g. ReviewCycle) is not available in the installed runtime subset.
 *
 * Returns null if no committed action with a result exists for the node
 * (should not happen in normal flow — the reconciler only emits
 * suspend-unsupported after a complex-route verify result).
 */
function capabilityUnavailableWait(
  record: CanonicalRunRecord,
  nodeId: string,
  code: string
): CanonicalWait | null {
  const committed = Object.values(record.actions).find(
    (entry) =>
      entry.action.nodeId === nodeId && entry.result !== undefined
  );
  if (committed === undefined) {
    return null;
  }
  return createCanonicalWait(record.runId, {
    kind: 'capability-unavailable',
    nodeId: committed.action.nodeId,
    invocationId: committed.action.invocationId,
    occurrence: 0,
    attemptId: committed.action.attemptId,
    actionId: committed.action.actionId,
    effectIds: committed.action.effects.map((effect) => effect.effectId),
    code,
    capabilityDigest: record.capabilityDigest,
  });
}

/**
 * The runtime facade factory (task 10.2). Wires the lowerer's RuntimePlan, the
 * pure reconciler, the reducer + candidate-commit seam, the immutable RunStore,
 * and the read-only projector behind the public {@link ChangePipelineRuntime}.
 * Internal plan/Record/store/path are never exposed; every mutation funnels
 * through the canonical commit path.
 */
export function createChangePipelineRuntime(deps: RuntimeDeps): ChangePipelineRuntime {
  const releaseTerminalReservations = (record: CanonicalRunRecord): void => {
    if (record.terminal === undefined || deps.reservationRegistry === undefined) {
      return;
    }
    for (const actionId of Object.keys(record.actions)) {
      deps.reservationRegistry.release(
        deps.plan.runId,
        actionId as ActionId
      );
    }
  };
  const consultationBindingForAction = (action: RunAction) => {
    if (deps.executionProfile === undefined || action.kind !== 'agent') {
      return undefined;
    }
    return deps.executionProfile.consultations?.find((binding) => {
      const capability = deps.executionProfile!.capabilities.find(
        (candidate) => candidate.nodeId === binding.sourceProfilePath
      );
      const stage = deps.executionProfile!.policy.stages.find(
        (candidate) => candidate.nodeId === binding.sourceProfilePath
      );
      return (
        capability !== undefined &&
        stage !== undefined &&
        action.executionProfileDigest === deps.executionProfile!.profileDigest &&
        action.capability.id === capability.authoredCapability.id &&
        action.capability.authoredVersion === capability.authoredCapability.version &&
        action.capability.contractDigest === capability.contract.digest &&
        action.capability.artifact.contentDigest === capability.adapter.contentDigest &&
        action.resultContractDigest === capability.resultContract.digest &&
        action.evidenceContractDigest === capability.evidenceContract.digest &&
        action.agent.role === stage.role &&
        action.agent.model === stage.model &&
        action.agent.runtime === stage.runtime &&
        action.agent.sandbox === stage.sandbox &&
        action.agent.consultation?.sourceProfilePath ===
          binding.sourceProfilePath &&
        action.agent.consultation.teacherProfilePath ===
          binding.teacherProfilePath &&
        JSON.stringify(action.workspace) === JSON.stringify(capability.workspace)
      );
    });
  };

  const launchConflict = (record: CanonicalRunRecord): never => {
    throw new ChangeRunRuntimeError(
      'launch_request_conflict',
      'An existing Run has a different Pipeline or canonical launch input.',
      projectRunView(
        record,
        deps.resolveSourceState?.(record) ?? 'active',
        deps.plan
      )
    );
  };

  const verifyLaunchIntent = (
    request: Parameters<ChangePipelineRuntime['start']>[0],
    record: CanonicalRunRecord
  ): void => {
    const pipeline = request.pipeline ?? deps.initialRecord.pipeline;
    const engine = request.engine ?? 'reconciler';
    const inputs = request.inputs ?? Object.freeze({});
    const requestedDigest = digestLaunchIntent({ pipeline, engine, inputs });
    const initialDigest = digestLaunchIntent({
      pipeline: deps.initialRecord.pipeline,
      engine: 'reconciler',
      inputs: deps.initialRecord.inputs,
    });
    const recordDigest = digestLaunchIntent({
      pipeline: record.pipeline,
      engine: 'reconciler',
      inputs: record.inputs,
    });

    // The independently supplied digest is only a consistency assertion. It
    // never substitutes for deriving identity from the normalized request.
    if (
      request.launchRequestDigest !== undefined &&
      request.launchRequestDigest !== requestedDigest
    ) {
      launchConflict(record);
    }
    if (requestedDigest !== initialDigest || requestedDigest !== recordDigest) {
      launchConflict(record);
    }

    // Pre-launch-input Records used sha256(launchKey). Preserve only their
    // empty-input compatibility. Any non-empty canonical input must carry the
    // versioned launch-intent digest and therefore cannot use this exception.
    const legacyEmptyInput = Object.keys(record.inputs).length === 0;
    if (
      record.launchRequestDigest !== recordDigest &&
      !legacyEmptyInput
    ) {
      launchConflict(record);
    }
  };

  const observeTaskLoopWorkspace = (
    record: CanonicalRunRecord
  ): WorkspaceRevision | undefined => {
    if (!isTaskLoopRun(deps.plan, record)) return undefined;
    const observed = deps.observeWorkspace?.();
    if (observed === undefined) {
      throw new ChangeRunRuntimeError(
        'workspace-scope-mismatch',
        'Task Loop requires a trusted live workspace observer.'
      );
    }
    return observed;
  };

  const regenerateTaskLoopReport = (record: CanonicalRunRecord): void => {
    if (
      deps.taskLoopEvidenceDir === undefined ||
      !isTaskLoopRun(deps.plan, record)
    ) return;
    try {
      const evidenceDir = typeof deps.taskLoopEvidenceDir === 'function'
        ? deps.taskLoopEvidenceDir()
        : deps.taskLoopEvidenceDir;
      writeTaskLoopReport(evidenceDir, deps.plan, record);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string' &&
        error.code.startsWith('task_loop_source_authority_')
      ) {
        throw error;
      }
      throw new ChangeRunRuntimeError(
        'run_store_unavailable',
        `task_loop_report_unavailable: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
  /**
   * Collect the stimuli that settle a reconciler candidate batch against
   * `workingRecord`, WITHOUT applying them. `complete` uses this to fold the
   * settle stimuli into the SAME `reduceCandidateBatch` as its
   * `commit-action-result` stimulus, so the store's `head + 1` invariant
   * holds: the whole completion + settle is ONE Record revision.
   *
   * The `workingRecord` is the Record the caller has already advanced past
   * any pre-stimuli (for `complete`, the post-`commit-action-result` Record).
   * Pre-stimuli identity is carried in `resumingWaitIds` so the wait-creation
   * pass does not re-derive a WaitId that the same batch is about to resume.
   */
  const collectSettleStimuli = (
    workingRecord: CanonicalRunRecord,
    candidates: readonly ReconcilerNextAction[],
    context: RuntimeMutationContext | AdmitAgentCandidatesContext,
    incomingResumingWaitIds: ReadonlySet<string> = new Set()
  ): {
    readonly stimuli: readonly RunStimulus[];
    readonly granted: readonly RunAction[];
    readonly continuationIds: readonly string[];
    readonly reserved: readonly RunAction[];
  } => {
    const stimuli: RunStimulus[] = [];
    const grantedActions: RunAction[] = [];
    const continuationIds: string[] = [];
    const reservedActions: RunAction[] = [];
    const blockedIntents: Array<{
      readonly nodeId: string;
      readonly invocationId: string;
      readonly occurrence: number;
      readonly access: 'read' | 'write';
    }> = [];
    // Track which workspace-reservation waits this batch is resuming (pre-pass
    // + incoming); the wait-creation pass must not re-derive a WaitId that the
    // same batch is about to resume.
    const resumingWaitIds = new Set<string>(incomingResumingWaitIds);

    try {
      // Pre-pass: release workspace-reservation waits whose workspace is now free.
      if (deps.reservationRegistry !== undefined) {
        for (const wait of workingRecord.waits) {
          if (wait.kind !== 'workspace-reservation') continue;
          if (deps.reservationRegistry.isBusy(wait.workspaceInstanceId)) {
            continue;
          }
          stimuli.push({ kind: 'resume-wait', waitId: wait.waitId });
          resumingWaitIds.add(wait.waitId as string);
        }
      }

      for (const candidate of candidates) {
      switch (candidate.kind) {
        case 'admit': {
          const actionDescriptor = {
            nodeId: candidate.nodeId,
            occurrence: candidate.occurrence,
            ...(candidate.profilePath !== undefined
              ? { profilePath: candidate.profilePath }
              : {}),
            ...(candidate.input !== undefined
              ? { input: candidate.input }
              : {}),
          };
          if (
            candidate.admissionKind === 'agent' &&
            !('resolveAgentTurnInput' in context)
          ) {
            break;
          }
          const renderedTurnInput =
            candidate.admissionKind === 'agent' &&
            'resolveAgentTurnInput' in context
              ? context.resolveAgentTurnInput(
                  candidateDescriptor(workingRecord, candidate)
                )
              : undefined;
          const action = deps.buildAction({
            ...actionDescriptor,
            admissionKind: candidate.admissionKind,
            ...(renderedTurnInput === undefined ? {} : { renderedTurnInput }),
          });
          // Cross-Run reservation check. The reconciler has already decided
          // this candidate is admissible within THIS Run; the registry is the
          // only signal that another Run holds the workspace lease.
          if (
            deps.reservationRegistry !== undefined &&
            (action.workspace.access === 'read' ||
              action.workspace.access === 'write')
          ) {
            const reservation = {
              workspaceInstanceId: workingRecord.workspaceInstanceId,
              runId: deps.plan.runId,
              actionId: action.actionId as ActionId,
              attemptId: action.attemptId as AttemptId,
              access: action.workspace.access,
              recordDigest: digestCanonicalRunRecord(workingRecord),
              recordVersion: workingRecord.recordVersion,
              state: 'pending',
            } as const;
            const consultation =
              candidate.consultationTeacher === undefined
                ? undefined
                : workingRecord.consultations?.[
                    candidate.consultationTeacher.consultationId
                  ];
            const source =
              consultation === undefined
                ? undefined
                : workingRecord.actions[consultation.source.actionId];
            const conflict =
              consultation !== undefined &&
              source !== undefined &&
              action.workspace.access === 'read'
                ? deps.reservationRegistry.reserveConsultationRead(
                    { ...reservation, access: 'read' },
                    {
                      runId: deps.plan.runId,
                      actionId: consultation.source.actionId,
                      consultationId: consultation.consultationId,
                      canonicallyPaused:
                        source.state === 'consultation-paused',
                    }
                  )
                : deps.reservationRegistry.reserve(reservation);
            if (conflict !== null) {
              // The registry rejected the reservation; the candidate stays
              // un-admitted and enters the blocked-intent wait below. Discard
              // the built action — a fresh one (same deterministic identity)
              // is built when the workspace frees and the candidate is
              // re-emitted.
              blockedIntents.push({
                nodeId: candidate.nodeId,
                invocationId: action.invocationId,
                occurrence: candidate.occurrence,
                access: action.workspace.access,
              });
              break;
            }
            reservedActions.push(action);
          }
          if (candidate.consumesDomainBlockedWait !== undefined) {
            stimuli.push({
              kind: 'consume-domain-blocked-wait-for-strategy',
              waitId: candidate.consumesDomainBlockedWait.waitId,
              actionId: candidate.consumesDomainBlockedWait.actionId,
              strategyNodeId: candidate.nodeId,
              trigger: candidate.consumesDomainBlockedWait.trigger,
            });
          }
          stimuli.push({
            kind: 'admit-action',
            action,
            attemptOrdinal: 0,
            deliveryMode: context.deliveryMode,
          });
          if (candidate.consultationTeacher !== undefined) {
            stimuli.push({
              kind: 'link-consultation-teacher',
              consultationId:
                candidate.consultationTeacher.consultationId,
              teacherActionId: action.actionId,
            });
          }
          if (context.deliveryMode === 'grant') {
            grantedActions.push(action);
          }
          break;
        }
        case 'continue-consultation':
          if (!candidate.alreadyGranted) {
            stimuli.push({
              kind: 'grant-consultation-continuation',
              consultationId: candidate.consultationId,
            });
          }
          continuationIds.push(candidate.consultationId);
          break;
        case 'await-gate': {
          const wait = createCanonicalWait(deps.plan.runId, {
            kind: 'gate',
            nodeId: candidate.nodeId,
            invocationId: deriveInvocationId(
              deps.plan.runId,
              candidate.nodeId,
              0
            ),
            occurrence: 0,
            gateId: candidate.gateId,
            decisionIds: [...candidate.decisionIds],
          });
          // createCanonicalWait returns the CanonicalWait union; narrow to
          // the gate variant the await-gate stimulus requires.
          if (wait.kind === 'gate') {
            stimuli.push({ kind: 'await-gate', wait });
          }
          break;
        }
        case 'await-human-required':
          stimuli.push({ kind: 'await-human-required', wait: candidate.wait });
          break;
        case 'suspend-unsupported': {
          const wait = capabilityUnavailableWait(
            workingRecord,
            candidate.nodeId,
            candidate.code
          );
          if (wait !== null) {
            stimuli.push({ kind: 'suspend', wait });
          }
          break;
        }
        case 'finish':
          stimuli.push({ kind: 'finish', outcome: candidate.outcome });
          break;
        case 'escalate':
          stimuli.push({
            kind: 'escalate',
            code: candidate.code,
            ...(candidate.reason !== undefined
              ? { reason: candidate.reason }
              : {}),
          });
          break;
        case 'fail':
          stimuli.push({
            kind: 'fail',
            code: candidate.code,
            ...(candidate.reason !== undefined
              ? { reason: candidate.reason }
              : {}),
          });
          break;
        case 'cancel':
          stimuli.push({
            kind: 'cancel',
            ...(candidate.reason !== undefined
              ? { reason: candidate.reason }
              : {}),
          });
          break;
        case 'await-workspace': {
          // Intra-Run workspace contention: the reconciler's
          // selectCompatibleAdmissions blocked these ready candidates behind
          // an already-admitted writer in the same Run. Map each to the same
          // stable local candidate identity the wait records.
          for (const intent of candidate.intents) {
            blockedIntents.push({
              nodeId: intent.nodeId,
              invocationId: deriveInvocationId(
                deps.plan.runId,
                intent.nodeId,
                intent.occurrence
              ),
              occurrence: intent.occurrence,
              access: intent.access,
            });
          }
          break;
        }
      }
    }

    // Wait pass: blocked intents (cross-Run registry-denied OR intra-Run
    // await-workspace) enter one durable workspace-reservation wait. Skip
    // when an identical wait is already in the Record — the WaitId is a pure
    // function of (runId, workspaceInstanceId, sorted intents), so an
    // unchanged blocked state re-derives the same WaitId and the settle is a
    // no-op for that wait (no version churn, per the
    // "retryable and non-churning" scenario).
    if (blockedIntents.length > 0) {
      const wait = createCanonicalWait(deps.plan.runId, {
        kind: 'workspace-reservation',
        workspaceInstanceId: workingRecord.workspaceInstanceId,
        intents: blockedIntents.map((intent) => ({
          nodeId: intent.nodeId,
          invocationId: intent.invocationId,
          occurrence: intent.occurrence,
          access: intent.access,
        })),
      });
      const alreadyCommitted = workingRecord.waits.some(
        (existing) => existing.waitId === wait.waitId
      );
      const beingResumed = resumingWaitIds.has(wait.waitId as string);
      if (!alreadyCommitted && !beingResumed) {
        stimuli.push({ kind: 'suspend', wait });
      }
    }

      return {
        stimuli,
        granted: grantedActions,
        continuationIds,
        reserved: reservedActions,
      };
    } catch (error) {
      discardPendingReservations(reservedActions);
      throw error;
    }
  };

  function discardPendingReservations(actions: readonly RunAction[]): void {
    for (const action of actions) {
      deps.reservationRegistry?.release(
        deps.plan.runId,
        action.actionId as ActionId
      );
    }
  }

  function finalizePendingReservations(actions: readonly RunAction[]): void {
    for (const action of actions) {
      deps.reservationRegistry?.finalize(
        deps.plan.runId,
        action.actionId as ActionId
      );
    }
  }

  /**
   * Settle the FULL reconciler candidate batch into one Record revision.
   *
   * Per design §5.6: "start, resume, complete, and control settle the
   * candidate Record to its next quiescent point and commit once." The
   * previous implementation (grantAdmits) filtered for 'admit' candidates
   * only, dropping await-gate / suspend / finish / escalate / cancel — so a
   * Run reaching a gate or a capability-unavailable suspension could never
   * commit the durable wait, leaving the Run stuck without a WaitId for the
   * control path to target.
   *
   * This settle maps every reconciler candidate to its stimulus and commits
   * them atomically via reduceCandidateBatch. The returned `granted` list
   * carries ONLY grant-mode admit actions (await-gate / suspend commit waits,
   * they do not grant executable actions) so HTTP/CLI receipts never carry
   * non-admit actions.
   *
   * deliveryMode semantics (§5.6): `grant` commits admits as `granted` and
   * returns them; `defer` commits admits as `admitted_undelivered` (the
   * management/browser path) and returns `actions: []`. Both modes commit
   * all durable waits and terminal transitions.
   */
  const settleCandidates = (
    record: CanonicalRunRecord,
    candidates: readonly ReconcilerNextAction[],
    context: RuntimeMutationContext | AdmitAgentCandidatesContext
  ): {
    record: CanonicalRunRecord;
    granted: readonly RunAction[];
    continuationGrants: readonly AgentContinuationGrant[];
    reserved: readonly RunAction[];
  } => {
    const collected = collectSettleStimuli(record, candidates, context);
    if (collected.stimuli.length === 0) {
      const continuationGrants = collected.continuationIds.map((id) =>
        continuationGrantFromCommitted(record, record.consultations![id]!)
      );
      return {
        record,
        granted: [],
        continuationGrants,
        reserved: collected.reserved,
      };
    }
    try {
      const result = reduceCandidateBatch(record, collected.stimuli);
      if (!result.ok) {
        throw new Error(`facade settle failed: ${result.failure.message}`);
      }
      const settledGrants = collected.continuationIds.map((id) =>
        continuationGrantFromCommitted(
          result.record,
          result.record.consultations![id]!
        )
      );
      return {
        record: result.record,
        granted: collected.granted,
        continuationGrants: settledGrants,
        reserved: collected.reserved,
      };
    } catch (error) {
      discardPendingReservations(collected.reserved);
      throw error;
    }
  };

  return {
    start(request, context: RuntimeMutationContext) {
      if (deps.store.has(deps.plan.runId)) {
        const record = deps.store.load(deps.plan.runId);
        verifyLaunchIntent(request, record);
        regenerateTaskLoopReport(record);
        return asPromise(receipt(record, 'reused', [], deps.resolveSourceState, deps.plan, deps.buildAction));
      }
      verifyLaunchIntent(request, deps.initialRecord);
      const reconciled = reconcile(deps.plan, deps.initialRecord);
      if (!reconciled.ok) {
        throw new Error(`facade reconcile failed: ${reconciled.failure.message}`);
      }
      const settled = settleCandidates(
        deps.initialRecord,
        reconciled.actions,
        context
      );
      try {
        deps.store.create(deps.plan.runId, settled.record);
      } catch (error) {
        discardPendingReservations(settled.reserved);
        throw error;
      }
      finalizePendingReservations(settled.reserved);
      // Persist the sealed RuntimePlan alongside the Record so read paths
      // (management API, operations) can project the review-cycle section
      // without access to the launch context (Major-2).
      deps.store.writePlan?.(deps.plan.runId, deps.plan);
      regenerateTaskLoopReport(settled.record);
      return asPromise(receipt(
        settled.record,
        'created',
        settled.granted,
        deps.resolveSourceState,
        deps.plan,
        deps.buildAction,
        undefined,
        settled.continuationGrants
      ));
    },
    resume(_request, context: RuntimeMutationContext) {
      const record = deps.store.load(deps.plan.runId);
      const reconciled = reconcile(deps.plan, record);
      if (!reconciled.ok) {
        throw new Error(`facade reconcile failed: ${reconciled.failure.message}`);
      }
      const settled = settleCandidates(
        record,
        reconciled.actions,
        context
      );
      if (settled.record !== record) {
        try {
          deps.store.commit(deps.plan.runId, settled.record);
        } catch (error) {
          discardPendingReservations(settled.reserved);
          throw error;
        }
        finalizePendingReservations(settled.reserved);
      }
      regenerateTaskLoopReport(settled.record);
      const disposition: ChangeRunReceipt['disposition'] =
        settled.record.terminal !== undefined
          ? 'terminal'
          : settled.granted.length > 0
            ? 'advanced'
            : settled.record.waits.length > 0
              ? 'waiting'
              : 'advanced';
      return asPromise(
        receipt(
          settled.record,
          disposition,
          settled.granted,
          deps.resolveSourceState,
          deps.plan,
          deps.buildAction,
          undefined,
          settled.continuationGrants
        )
      );
    },
    admit(_request: ExactChangeRunRef, context: AdmitAgentCandidatesContext) {
      const record = deps.store.load(deps.plan.runId);
      deps.assertMutationAllowed?.(record);
      const reconciled = reconcile(deps.plan, record);
      if (!reconciled.ok) {
        throw new Error(`facade reconcile failed: ${reconciled.failure.message}`);
      }
      const agentCandidates = reconciled.actions.filter(
        (candidate): candidate is Extract<ReconcilerNextAction, { kind: 'admit' }> =>
          candidate.kind === 'admit' && candidate.admissionKind === 'agent'
      );
      if (agentCandidates.length === 0) {
        throw new ChangeRunRuntimeError(
          'candidate_stale',
          'The current Run frontier has no agent candidates to admit.'
        );
      }
      const renderedByCandidate = new Map<string, string>();
      for (const candidate of agentCandidates) {
        if (candidate.kind !== 'admit') continue;
        const preview = candidateDescriptor(record, candidate);
        renderedByCandidate.set(
          preview.candidateId,
          context.resolveAgentTurnInput(preview)
        );
      }
      context.finalizeAgentTurnInputs?.();
      const settled = settleCandidates(record, reconciled.actions, {
        deliveryMode: context.deliveryMode,
        resolveAgentTurnInput: (candidate) => {
          const rendered = renderedByCandidate.get(candidate.candidateId);
          if (rendered === undefined) {
            throw new ChangeRunRuntimeError(
              'candidate_stale',
              `Candidate ${candidate.candidateId} was not prevalidated for admission.`
            );
          }
          return rendered;
        },
      });
      if (settled.record === record) {
        discardPendingReservations(settled.reserved);
        throw new ChangeRunRuntimeError(
          'candidate_stale',
          'The supplied candidate manifest does not match the current Run frontier.'
        );
      }
      try {
        deps.store.commit(deps.plan.runId, settled.record);
      } catch (error) {
        discardPendingReservations(settled.reserved);
        throw error;
      }
      finalizePendingReservations(settled.reserved);
      regenerateTaskLoopReport(settled.record);
      const disposition: ChangeRunReceipt['disposition'] =
        settled.granted.length > 0
          ? 'advanced'
          : settled.record.waits.length > 0
            ? 'waiting'
            : 'advanced';
      return asPromise(
        receipt(
          settled.record,
          disposition,
          settled.granted,
          deps.resolveSourceState,
          deps.plan,
          deps.buildAction,
          settled.granted.length === agentCandidates.length ? [] : undefined,
          settled.continuationGrants
        )
      );
    },
    consult(
      request: ConsultationStepSubmission,
      context: RuntimeMutationContext
    ) {
      const record = deps.store.load(deps.plan.runId);
      deps.assertMutationAllowed?.(record);
      if (request.runId !== record.runId) {
        throw new ChangeRunRuntimeError(
          'invalid_run_request',
          'Consultation submission must address the exact current Run revision.',
          projectRunView(record, deps.resolveSourceState?.(record) ?? 'active', deps.plan)
        );
      }
      const source = record.actions[request.actionId];
      if (source === undefined) {
        throw new Error('facade consult failed: source Action is not admitted.');
      }
      const binding = consultationBindingForAction(source.action);
      if (binding === undefined) {
        throw new Error(
          'facade consult failed: source Action has no exact frozen consultation binding.'
        );
      }
      if (deps.evidenceStore === undefined) {
        throw new Error(
          'facade consult failed: no persistent EvidenceStore is bound to this Run.'
        );
      }
      verifyAttestedConsultationSubmission(
        record,
        source.action,
        request,
        (ref) => deps.evidenceStore!.read(ref)
      );
      const classified = classifyConsultationRequest({
        record,
        source,
        binding,
        submission: request,
      });
      if (classified.kind === 'conflict') {
        throw new Error(`facade consult failed: ${classified.message}`);
      }
      if (classified.kind === 'duplicate') {
        const linkedTeacher = classified.consultation.teacher.actionId === undefined
          ? undefined
          : record.actions[classified.consultation.teacher.actionId];
        // The consultation commit and Teacher grant are atomic, but delivery
        // acknowledgement is not. Replaying the exact signed CONSULT recovers
        // the canonical already-granted Teacher Action; its deterministic
        // Action/request identities prevent a second execution.
        if (
          context.deliveryMode === 'grant' &&
          classified.consultation.state === 'teacher-active' &&
          linkedTeacher?.state === 'active' &&
          linkedTeacher.deliveryState === 'granted'
        ) {
          return asPromise(
            receipt(
              record,
              'advanced',
              [linkedTeacher.action],
              deps.resolveSourceState,
              deps.plan
            )
          );
        }
        return asPromise(
          receipt(record, 'idempotent', [], deps.resolveSourceState, deps.plan)
        );
      }
      if (request.expectedRecordVersion !== record.recordVersion) {
        throw new ChangeRunRuntimeError(
          'record_version_conflict',
          'Consultation submission must address the exact current Run revision.',
          projectRunView(
            record,
            deps.resolveSourceState?.(record) ?? 'active',
            deps.plan
          )
        );
      }
      const requestStimulus: RunStimulus = {
        kind: 'request-consultation',
        consultation: classified.consultation,
      };
      const intermediate = reduceCanonicalRunRecord(record, requestStimulus);
      if (!intermediate.ok) {
        throw new Error(`facade consult failed: ${intermediate.failure.message}`);
      }
      const reconciled = reconcile(deps.plan, intermediate.record);
      if (!reconciled.ok) {
        throw new Error(`facade consult reconcile failed: ${reconciled.failure.message}`);
      }
      const collected = collectSettleStimuli(
        intermediate.record,
        reconciled.actions,
        context
      );
      const reduced = reduceCandidateBatch(record, [
        requestStimulus,
        ...collected.stimuli,
      ]);
      if (!reduced.ok) {
        throw new Error(`facade consult settle failed: ${reduced.failure.message}`);
      }
      deps.store.commit(deps.plan.runId, reduced.record);
      const continuationGrants = collected.continuationIds.map((id) =>
        continuationGrantFromCommitted(
          reduced.record,
          reduced.record.consultations![id]!
        )
      );
      return asPromise(
        receipt(
          reduced.record,
          'advanced',
          collected.granted,
          deps.resolveSourceState,
          deps.plan,
          deps.buildAction,
          undefined,
          continuationGrants
        )
      );
    },
    settleConsultationTeacherFailure(
      request: ConsultationTeacherFailureSettlement,
      context: RuntimeMutationContext
    ) {
      const settlement = decodeConsultationTeacherFailureSettlement(request);
      const record = deps.store.load(deps.plan.runId);
      deps.assertMutationAllowed?.(record);
      if (settlement.runId !== record.runId) {
        throw new ChangeRunRuntimeError(
          'invalid_run_request',
          'Teacher execution settlement must address the exact current Run.',
          projectRunView(record, deps.resolveSourceState?.(record) ?? 'active', deps.plan)
        );
      }
      if (
        record.transitions.some(
          (transition) =>
            transition.kind === 'ConsultationTeacherAttemptFailed' &&
            transition.consultationId === settlement.consultationId &&
            transition.teacherActionId === settlement.teacherActionId
        )
      ) {
        return asPromise(
          receipt(record, 'idempotent', [], deps.resolveSourceState, deps.plan)
        );
      }
      const consultation = record.consultations?.[settlement.consultationId];
      const teacher = record.actions[settlement.teacherActionId];
      if (
        consultation === undefined ||
        consultation.state !== 'teacher-active' ||
        consultation.teacher.actionId !== settlement.teacherActionId ||
        teacher?.state !== 'active' ||
        teacher.action.kind !== 'agent'
      ) {
        throw new Error(
          'facade Teacher failure failed: settlement does not address the exact active Teacher attempt.'
        );
      }
      if (settlement.expectedRecordVersion !== record.recordVersion) {
        throw new ChangeRunRuntimeError(
          'record_version_conflict',
          'Teacher execution settlement must address the exact current Run revision.',
          projectRunView(record, deps.resolveSourceState?.(record) ?? 'active', deps.plan)
        );
      }
      if (settlement.receipt !== undefined) {
        const authority = settlement.receipt.authority;
        if (
          deps.verifyHostedTurnReceipt?.(settlement.receipt) !== true ||
          settlement.receipt.requestId !==
            deriveFreshStepRequestId(
              record.runId,
              teacher.action.actionId as ActionId,
              teacher.action.attemptId as AttemptId
            ) ||
          settlement.receipt.sandbox !== teacher.action.agent.sandbox ||
          authority?.invocationId !== teacher.action.invocationId ||
          authority.role !== teacher.action.agent.role ||
          authority.workspaceInstanceId !== record.workspaceInstanceId
        ) {
          throw new Error(
            'facade Teacher failure failed: executor receipt is not the exact durable Teacher turn.'
          );
        }
      }
      if (settlement.recovery !== undefined) {
        verifyCompletionAuthority(
          settlement.recovery,
          record,
          teacher.action,
          deps.evidenceStore
        );
        if (
          settlement.outcome !== 'execution-lost' ||
          settlement.recovery.kind !== 'infrastructure-observation' ||
          settlement.recovery.status !== 'infrastructure_failed' ||
          settlement.recovery.error.code !== 'teacher-execution-lost' ||
          settlement.recovery.error.retryable !== true ||
          settlement.recovery.error.adapterArtifactDigest !==
            teacher.action.capability.artifact.contentDigest
        ) {
          throw new Error(
            'facade Teacher failure failed: recovery fact is not the exact active Teacher execution loss.'
          );
        }
      }
      const failureStimulus: RunStimulus = {
        kind: 'fail-consultation-teacher',
        consultationId: settlement.consultationId,
        teacherActionId: settlement.teacherActionId,
        detail: `${settlement.outcome}: ${settlement.detail}`,
      };
      const intermediate = reduceCanonicalRunRecord(record, failureStimulus);
      if (!intermediate.ok) {
        throw new Error(`facade Teacher failure failed: ${intermediate.failure.message}`);
      }
      deps.reservationRegistry?.release(
        deps.plan.runId,
        settlement.teacherActionId as ActionId
      );
      const reconciled = reconcile(deps.plan, intermediate.record);
      if (!reconciled.ok) {
        deps.store.commit(deps.plan.runId, intermediate.record);
        throw new Error(
          `facade Teacher failure reconcile failed: ${reconciled.failure.message}`
        );
      }
      const collected = collectSettleStimuli(
        intermediate.record,
        reconciled.actions,
        context
      );
      const reduced = reduceCandidateBatch(record, [
        failureStimulus,
        ...collected.stimuli,
      ]);
      if (!reduced.ok) {
        deps.store.commit(deps.plan.runId, intermediate.record);
        throw new Error(
          `facade Teacher failure settle failed: ${reduced.failure.message}`
        );
      }
      deps.store.commit(deps.plan.runId, reduced.record);
      const continuationGrants = collected.continuationIds.map((id) =>
        continuationGrantFromCommitted(
          reduced.record,
          reduced.record.consultations![id]!
        )
      );
      return asPromise(
        receipt(
          reduced.record,
          'advanced',
          collected.granted,
          deps.resolveSourceState,
          deps.plan,
          deps.buildAction,
          undefined,
          continuationGrants
        )
      );
    },
    settleConsultationContinuation(
      request: ConsultationContinuationSettlement,
      _context: RuntimeMutationContext
    ) {
      const settlement = decodeConsultationContinuationSettlement(request);
      const record = deps.store.load(deps.plan.runId);
      deps.assertMutationAllowed?.(record);
      if (settlement.runId !== record.runId) {
        throw new ChangeRunRuntimeError(
          'invalid_run_request',
          'Continuation settlement must address the exact current Run revision.',
          projectRunView(record, deps.resolveSourceState?.(record) ?? 'active', deps.plan)
        );
      }
      const consultation = record.consultations?.[settlement.consultationId];
      const sourceAction = consultation === undefined
        ? undefined
        : record.actions[consultation.source.actionId]?.action;
      if (
        consultation === undefined ||
        sourceAction?.kind !== 'agent' ||
        consultation.source.actionId !== settlement.sourceActionId ||
        consultation.continuation?.requestId !== settlement.requestId ||
        settlement.receipt.stableSessionId !== consultation.source.stableSessionId ||
        settlement.receipt.requestId !== settlement.requestId ||
        settlement.receipt.backend !== 'claude' && settlement.receipt.backend !== 'hosted' ||
        settlement.receipt.sandbox !== sourceAction.agent.sandbox ||
        settlement.receipt.authority?.invocationId !== sourceAction.invocationId ||
        settlement.receipt.authority.role !== sourceAction.agent.role ||
        settlement.receipt.authority.workspaceInstanceId !== record.workspaceInstanceId ||
        deps.verifyHostedTurnReceipt?.(settlement.receipt) !== true
      ) {
        throw new Error(
          'facade continuation failed: hosted receipt does not match durable canonical Session/Action authority.'
        );
      }
      const settledResultDigest = settlement.receipt.resultDigest === undefined
        ? undefined
        : (`sha256:${settlement.receipt.resultDigest}` as Digest);
      const ambiguousDetail =
        settlement.detail ??
        'SessionHost sent the continuation but could not prove its terminal outcome.';
      const duplicate =
        settlement.expectedRecordVersion ===
          consultation.continuation.expectedRecordVersion &&
        ((settlement.outcome === 'settled' &&
          consultation.state === 'continued' &&
          consultation.continuation?.state === 'settled' &&
          consultation.continuation.resultDigest === settledResultDigest) ||
        (settlement.outcome === 'ambiguous' &&
          consultation.state === 'continuation-outcome-unknown' &&
          consultation.continuation?.state === 'ambiguous' &&
          consultation.failure?.detail === ambiguousDetail));
      if (duplicate) {
        return asPromise(
          receipt(record, 'idempotent', [], deps.resolveSourceState, deps.plan)
        );
      }
      if (
        consultation.state === 'continued' ||
        consultation.state === 'continuation-outcome-unknown'
      ) {
        throw new Error(
          'facade continuation failed: terminal settlement replay does not exactly match the canonical settlement.'
        );
      }
      if (settlement.expectedRecordVersion !== record.recordVersion) {
        throw new ChangeRunRuntimeError(
          'record_version_conflict',
          'Continuation settlement must address the exact current Run revision.',
          projectRunView(
            record,
            deps.resolveSourceState?.(record) ?? 'active',
            deps.plan
          )
        );
      }
      const stimulus: RunStimulus =
        settlement.outcome === 'settled'
          ? {
              kind: 'settle-consultation-continuation',
              consultationId: settlement.consultationId,
              resultDigest:
                settledResultDigest ??
                (() => {
                  throw new Error(
                    'facade continuation failed: settled result requires resultDigest.'
                  );
                })(),
            }
          : {
              kind: 'mark-consultation-continuation-ambiguous',
              consultationId: settlement.consultationId,
              detail: ambiguousDetail,
            };
      const reduced = reduceCanonicalRunRecord(record, stimulus);
      if (!reduced.ok) {
        throw new Error(
          `facade continuation failed: ${reduced.failure.message}`
        );
      }
      if (reduced.record !== record) {
        deps.store.commit(deps.plan.runId, reduced.record);
      }
      return asPromise(
        receipt(
          reduced.record,
          reduced.record === record ? 'idempotent' : 'advanced',
          [],
          deps.resolveSourceState,
          deps.plan
        )
      );
    },
    complete(request: CompleteRunAction, context: RuntimeMutationContext) {
      const record = deps.store.load(deps.plan.runId);
      deps.assertMutationAllowed?.(record);
      const committed = record.actions[request.actionId];
      if (committed === undefined) {
        throw new Error(`facade complete failed: action ${request.actionId} is not admitted.`);
      }
      // Verify binding + canonical receipt before mutation, then convert to the
      // reducer's commit-action-result stimulus (the completion envelope is NOT
      // itself a RunStimulus).
      verifyCompletion(request, committed.action);
      verifyCompletionAuthority(
        request,
        record,
        committed.action,
        deps.evidenceStore
      );
      const slot = classifyCompletionSlot(request, committed);
      if (slot === 'conflict') {
        throw new Error(
          `facade complete failed: completion conflicts with the committed ${request.kind} slot.`
        );
      }
      if (slot === 'idempotent') {
        return asPromise(
          receipt(
            record,
            'reused',
            [],
            deps.resolveSourceState,
            deps.plan,
            deps.buildAction
          )
        );
      }
      if (request.kind === 'effect-observation') {
        const observed = reduceCanonicalRunRecord(record, {
          kind: 'observe-effect',
          actionId: request.actionId,
          effectId: request.effectId,
          status: request.status,
          receiptDigest: request.receiptDigest as Digest,
          observation: request.observation,
          evidence: request.evidence,
        });
        if (!observed.ok) {
          throw new Error(`facade complete failed: ${observed.failure.message}`);
        }
        deps.store.commit(deps.plan.runId, observed.record);
        return asPromise(
          receipt(
            observed.record,
            'advanced',
            [],
            deps.resolveSourceState,
            deps.plan,
            deps.buildAction
          )
        );
      }
      if (request.kind === 'infrastructure-observation') {
        const observed = reduceCanonicalRunRecord(record, {
          kind: 'observe-infrastructure',
          actionId: request.actionId,
          receiptDigest: request.receiptDigest as Digest,
          code: request.error.code,
          retryable: request.error.retryable,
          artifactDigest: request.error.adapterArtifactDigest as Digest,
          evidence: request.evidence,
        });
        if (!observed.ok) {
          throw new Error(`facade complete failed: ${observed.failure.message}`);
        }
        deps.store.commit(deps.plan.runId, observed.record);
        deps.reservationRegistry?.release(
          deps.plan.runId,
          request.actionId as ActionId
        );
        return asPromise(
          receipt(
            observed.record,
            'waiting',
            [],
            deps.resolveSourceState,
            deps.plan,
            deps.buildAction
          )
        );
      }
      if (
        request.status === 'succeeded' &&
        strategyTriggerForAction(committed) !== undefined
      ) {
        decodeBoundedLoopStrategyResult(request.result);
      }
      const activeTeacherConsultation = Object.values(
        record.consultations ?? {}
      ).find(
        (consultation) =>
          consultation.state === 'teacher-active' &&
          consultation.teacher.actionId === request.actionId
      );
      // Pre-commit ReviewCycle validation (D3): validate the completion against
      // the exact mechanically expected phase BEFORE committing. Malformed
      // results, same-actor fixer+verifier, and open Blocker/Major findings
      // fail closed without Record mutation.
      validateReviewCycleCompletion(deps.plan, record, request);
      validateGoalCycleCompletion(deps.plan, record, request);
      if (activeTeacherConsultation === undefined) {
        const observedTaskLoopWorkspace = observeTaskLoopWorkspace(record);
        validateTaskLoopCompletion(
          deps.plan,
          record,
          request,
          observedTaskLoopWorkspace ?? record.currentWorkspaceRevision
        );
        const goalDescriptor = locateGoalCycleInvocation(
          deps.plan,
          record,
          committed.action.nodeId as import('../contracts.js').NodeId
        );
        if (isTaskLoopRun(deps.plan, record) && goalDescriptor === null) {
          assertTaskLoopMayDeliver(
            deps.plan,
            record,
            observedTaskLoopWorkspace
          );
        }
      }
      // ECP-4: validate choice/fan-out condition results before committing.
      validateChoiceCompletion(deps.plan, record, request);
      validateFanOutConditionCompletion(deps.plan, record, request);
      const commitStimulus: RunStimulus = {
        kind: 'commit-action-result',
        actionId: request.actionId,
        status: request.status,
        receiptDigest: request.receiptDigest as never,
        result: request.result,
        evidence: request.evidence,
        actor: request.actor,
        actorAttestation: request.actorAttestation,
      };
      const consultationStimulus: RunStimulus | undefined =
        activeTeacherConsultation === undefined
          ? undefined
          : request.status === 'succeeded'
            ? {
                kind: 'commit-consultation-advice',
                consultation: commitTeacherAdvice({
                  consultation: activeTeacherConsultation,
                  teacherAction: committed.action,
                  result: request.result,
                  actor: request.actor,
                  actorAttestation: request.actorAttestation,
                  evidence: request.evidence,
                }),
              }
            : {
                kind: 'fail-consultation-teacher',
                consultationId: activeTeacherConsultation.consultationId,
                teacherActionId: request.actionId,
                detail: `Teacher attempt settled with domain status ${request.status}.`,
              };
      const completionStimuli: readonly RunStimulus[] =
        consultationStimulus === undefined
          ? [commitStimulus]
          : [commitStimulus, consultationStimulus];
      // Apply the commit to an intermediate Record purely to discover the
      // candidate batch the completion unblocks; the final write folds the
      // commit stimulus and the settle stimuli into ONE reduceCandidateBatch
      // over the original Record so the store's head+1 invariant holds (the
      // whole completion + settle is one Record revision, per design §5.6).
      const intermediate = reduceCandidateBatch(record, completionStimuli);
      if (!intermediate.ok) {
        throw new Error(`facade complete failed: ${intermediate.failure.message}`);
      }
      // Release the workspace reservation this Action held (if any) BEFORE
      // collecting settle stimuli, so the post-complete settle can admit a
      // blocked candidate from this or another Run against the same
      // workspace. `release` is idempotent (a no-op for Actions that were
      // never reserved: access-none admits, or Actions admitted without a
      // wired registry).
      if (deps.reservationRegistry !== undefined) {
        deps.reservationRegistry.release(
          deps.plan.runId,
          request.actionId as ActionId
        );
      }
      const reconciled = reconcile(deps.plan, intermediate.record);
      if (!reconciled.ok) {
        // Reconcile failure after a verified completion is a fatal invariant
        // breach — persist the committed result so the Run is not silently
        // rolled back, then surface the error.
        deps.store.commit(deps.plan.runId, intermediate.record);
        throw new Error(
          `facade complete reconcile failed: ${reconciled.failure.message}`
        );
      }
      const collected = collectSettleStimuli(
        intermediate.record,
        reconciled.actions,
        context
      );
      // Fold the commit + settle into one batch over the ORIGINAL Record.
      const batchStimuli =
        collected.stimuli.length === 0
          ? completionStimuli
          : [...completionStimuli, ...collected.stimuli];
      const result = reduceCandidateBatch(record, batchStimuli);
      if (!result.ok) {
        // If the combined batch fails (a typed invariant the separate steps
        // did not catch), discard every speculative reservation before
        // committing the completion alone. The completion remains durable, but
        // no uncommitted successor Action may retain workspace authority.
        discardPendingReservations(collected.reserved);
        deps.store.commit(deps.plan.runId, intermediate.record);
        throw new Error(`facade complete settle failed: ${result.failure.message}`);
      }
      const finalRecord = result.record;
      // Defense-in-depth delivery guard: domain-success delivery still
      // requires ReviewCycle clean / GoalCycle satisfied. A research loop may
      // separately complete through a sealed non-success lifecycle exit so an
      // authored report-only tail can settle truthfully. The exception below
      // is derived only from the frozen plan and canonical Record.
      if (finalRecord.terminal !== undefined && finalRecord.status === 'completed') {
        for (const boundedLoop of deps.plan.nodes) {
          if (boundedLoop.kind !== 'bounded-loop') continue;
          if (boundedLoop.body.kind === 'review-cycle') {
            const progress = projectReviewCycleProgress(
              deps.plan,
              boundedLoop,
              finalRecord
            );
            assertReviewCycleMayShip(progress.state);
          } else if (boundedLoop.body.kind === 'goal-cycle') {
            const progress = projectGoalCycleProgress(
              deps.plan,
              boundedLoop,
              finalRecord
            );
            const lifecycle = reduceBoundedLoopLifecycle(
              deps.plan,
              boundedLoop,
              finalRecord,
              projectGoalCycleDomainSnapshot(
                deps.plan,
                boundedLoop,
                finalRecord
              )
            );
            const completedResearchTail = deps.plan.nodes.some(
              (node) =>
                node.kind === 'atomic' &&
                node.requires.includes(boundedLoop.nodeId) &&
                Object.values(finalRecord.actions).some(
                  (action) =>
                    action.action.nodeId === node.nodeId &&
                    action.result?.status === 'succeeded'
                )
            );
            const truthfulResearchExit =
              boundedLoop.body.variant === 'research' &&
              lifecycle.decision.kind === 'completed' &&
              lifecycle.decision.disposition === 'exit' &&
              lifecycle.decision.reason !== 'domain-complete' &&
              completedResearchTail;
            if (!truthfulResearchExit) {
              assertGoalCycleMayShip(progress.state);
            }
            if (isTaskLoopRun(deps.plan, finalRecord)) {
              assertTaskLoopMayDeliver(
                deps.plan,
                finalRecord,
                observeTaskLoopWorkspace(finalRecord)
              );
            }
          }
        }
      }
      try {
        deps.store.commit(deps.plan.runId, finalRecord);
      } catch (error) {
        discardPendingReservations(collected.reserved);
        throw error;
      }
      finalizePendingReservations(collected.reserved);
      releaseTerminalReservations(finalRecord);
      if (
        deps.taskLoopEvidenceDir !== undefined &&
        isTaskLoopRun(deps.plan, finalRecord) &&
        activeTeacherConsultation === undefined &&
        request.status === 'succeeded'
      ) {
        regenerateTaskLoopReport(finalRecord);
      }
      const disposition: ChangeRunReceipt['disposition'] =
        finalRecord.terminal !== undefined
          ? 'terminal'
          : collected.granted.length > 0
            ? 'advanced'
            : finalRecord.waits.length > 0
              ? 'waiting'
              : 'advanced';
      const continuationGrants = collected.continuationIds.map((id) =>
        continuationGrantFromCommitted(
          finalRecord,
          finalRecord.consultations![id]!
        )
      );
      return asPromise(receipt(
        finalRecord,
        disposition,
        collected.granted,
        deps.resolveSourceState,
        deps.plan,
        deps.buildAction,
        undefined,
        continuationGrants
      ));
    },
    inspect(_ref: ExactChangeRunRef) {
      const record = deps.store.load(deps.plan.runId);
      regenerateTaskLoopReport(record);
      const sourceState = deps.resolveSourceState?.(record) ?? 'active';
      return asPromise(projectRunView(record, sourceState, deps.plan));
    },
    control(request: ChangeRunControlRequest, context: RuntimeMutationContext) {
      const record = deps.store.load(deps.plan.runId);
      deps.assertMutationAllowed?.(record);

      if (
        request.ref.runId !== record.runId ||
        request.ref.change.changeId !== record.change.changeId
      ) {
        throw new ChangeRunRuntimeError(
          'invalid_run_request',
          'Control must address the exact Run and Change identity.'
        );
      }
      if (request.expectedRecordVersion !== record.recordVersion) {
        throw new ChangeRunRuntimeError(
          'record_version_conflict',
          `expectedRecordVersion ${request.expectedRecordVersion} does not match current Record version ${record.recordVersion}.`,
          projectRunView(
            record,
            deps.resolveSourceState?.(record) ?? 'active',
            deps.plan
          )
        );
      }

      const stimulus = controlStimulus(record, request);
      const intermediate = reduceCanonicalRunRecord(record, stimulus);
      if (!intermediate.ok) {
        throw new Error(`facade control failed: ${intermediate.failure.message}`);
      }

      let collected: ReturnType<typeof collectSettleStimuli> = {
        stimuli: [],
        granted: [],
        continuationIds: [],
        reserved: [],
      };
      if (intermediate.record.terminal === undefined) {
        const reconciled = reconcile(deps.plan, intermediate.record);
        if (!reconciled.ok) {
          throw new Error(
            `facade control reconcile failed: ${reconciled.failure.message}`
          );
        }
        collected = collectSettleStimuli(
          intermediate.record,
          reconciled.actions,
          context
        );
      }

      const result = reduceCandidateBatch(record, [
        stimulus,
        ...collected.stimuli,
      ]);
      if (!result.ok) {
        throw new Error(`facade control settle failed: ${result.failure.message}`);
      }
      try {
        deps.store.commit(deps.plan.runId, result.record);
      } catch (error) {
        discardPendingReservations(collected.reserved);
        throw error;
      }
      finalizePendingReservations(collected.reserved);
      releaseTerminalReservations(result.record);
      const disposition: ChangeRunReceipt['disposition'] =
        result.record.terminal !== undefined
          ? 'terminal'
          : result.record.waits.length > 0 && collected.granted.length === 0
            ? 'waiting'
            : 'advanced';
      return asPromise(
        receipt(
          result.record,
          disposition,
          collected.granted,
          deps.resolveSourceState,
          deps.plan,
          deps.buildAction,
          undefined,
          collected.continuationIds.map((id) =>
            continuationGrantFromCommitted(
              result.record,
              result.record.consultations![id]!
            )
          )
        )
      );
    },
  };
}

function controlStimulus(
  record: CanonicalRunRecord,
  request: ChangeRunControlRequest
): RunStimulus {
  const command = request.command;
  switch (command.kind) {
    case 'resume':
      return { kind: 'resume-wait', waitId: command.waitId };
    case 'decision': {
      const wait = record.waits.find(
        (candidate) => candidate.waitId === command.waitId
      );
      if (wait?.kind === 'human-required') {
        if (
          command.decisionId !== 'retry' &&
          command.decisionId !== 'escalate'
        ) {
          throw new Error(
            'facade control failed: human-required decisions must be retry or escalate.'
          );
        }
        return {
          kind: 'decide-human',
          waitId: command.waitId,
          decisionId: command.decisionId,
          outcome: command.outcome,
          evidence: command.evidence ?? [],
        };
      }
      return {
        kind: 'decide-gate',
        waitId: command.waitId,
        decisionId: command.decisionId,
        outcome: command.outcome,
      };
    }
    case 'accept-workspace-revision':
      return {
        kind: 'accept-workspace-revision',
        waitId: command.waitId,
        revision: command.revision,
        evidence: command.evidence,
      };
    case 'escalate':
      return {
        kind: 'escalate',
        code: 'user_escalated',
        reason: command.reason,
      };
    case 'cancel':
      return {
        kind: 'cancel',
        ...(command.reason === undefined ? {} : { reason: command.reason }),
      };
  }
}

export { asPromise };
export type { ChangeRunView };

/**
 * ECP-4: a JSON object (not null, not an array). Both evaluator validators
 * previously used this shape as a PRECONDITION for validating at all, which
 * meant any non-object result bypassed validation and committed.
 */
function isPlainJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Human-readable shape name for an evaluator-result rejection message. */
function describeJsonShape(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

/**
 * ECP-4: validate a choice condition evaluator completion. The result must
 * contain a valid `outcome` string matching one of the choice's declared
 * outcomes.
 */
function validateChoiceCompletion(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  request: CompleteRunAction
): void {
  // Find choice nodes whose nodeId matches the completed action.
  const choiceNodes = plan.nodes.filter((n) => n.kind === 'choice');
  for (const node of choiceNodes) {
    if (node.kind !== 'choice') continue;
    const action = Object.values(record.actions).find(
      (a) => a.action.nodeId === node.nodeId && a.state === 'active'
    );
    if (action === undefined) continue;
    if (action.action.actionId !== request.actionId) continue;
    // This completion targets a choice node — validate the result.
    // A failed/blocked evaluator legitimately carries no selection; only a
    // SUCCEEDED completion must name a valid outcome.
    if (request.kind === 'domain-action-result' && request.status === 'succeeded') {
      if (!isPlainJsonObject(request.result)) {
        // Guarding only the object shape used to SKIP validation entirely, so
        // a string result committed and left the Run permanently stalled with
        // no branch selected and no diagnostic.
        throw new Error(
          `Choice completion for ${node.hierarchicalPath} must be an object carrying an outcome; received ${describeJsonShape(request.result)}.`
        );
      }
      const outcome = (request.result as Readonly<{ outcome?: unknown }>).outcome;
      if (typeof outcome !== 'string' || !node.outcomes.includes(outcome)) {
        throw new Error(
          `Choice completion for ${node.hierarchicalPath} has invalid outcome ${JSON.stringify(outcome)}.`
        );
      }
    }
    break;
  }
}

/**
 * ECP-4: validate a FanOut condition evaluator completion. The result must
 * contain `activeMembers` and `inactiveMembers` arrays, and all required
 * members must be in `activeMembers`.
 */
function validateFanOutConditionCompletion(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  request: CompleteRunAction
): void {
  const fanOutNodes = plan.nodes.filter((n) => n.kind === 'fan-out');
  for (const node of fanOutNodes) {
    if (node.kind !== 'fan-out') continue;
    const action = Object.values(record.actions).find(
      (a) => a.action.nodeId === node.nodeId && a.state === 'active'
    );
    if (action === undefined) continue;
    if (action.action.actionId !== request.actionId) continue;
    // This completion targets a fan-out condition — validate the result.
    // A failed/blocked evaluator legitimately carries no member selection.
    if (request.kind === 'domain-action-result' && request.status === 'succeeded') {
      if (!isPlainJsonObject(request.result)) {
        throw new Error(
          `FanOut condition completion for ${node.hierarchicalPath} must be an object carrying activeMembers; received ${describeJsonShape(request.result)}.`
        );
      }
      const result = request.result as Readonly<{ activeMembers?: unknown; inactiveMembers?: unknown }>;
      if (!Array.isArray(result.activeMembers)) {
        throw new Error(
          `FanOut condition completion for ${node.hierarchicalPath} must include activeMembers array.`
        );
      }
      // Required members must be in activeMembers.
      const activeSet = new Set(result.activeMembers as readonly unknown[]);
      for (const member of node.members) {
        if (member.required && !activeSet.has(member.hierarchicalPath)) {
          throw new Error(
            `FanOut condition for ${node.hierarchicalPath} suppressed required member ${member.hierarchicalPath}.`
          );
        }
      }
    }
    break;
  }
}
