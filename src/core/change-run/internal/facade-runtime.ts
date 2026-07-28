import type {
  ActionId,
  AttemptId,
  ChangeRunControlRequest,
  ChangeRunReceipt,
  ChangeRunView,
  CompleteRunAction,
  ExactChangeRunRef,
  RunAction,
} from '../contracts.js';
import type { ChangePipelineRuntime, RuntimeMutationContext } from '../facade.js';
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
import { verifyCompletion } from './completion.js';
import { createCanonicalWait, type CanonicalWait } from './waits.js';
import { deriveInvocationId } from './identity.js';
import type { WorkspaceReservationRegistry } from './reservations.js';
import { validateReviewCycleCompletion } from './review-cycle-runtime.js';

export interface RuntimeDeps {
  readonly store: RunStore;
  readonly plan: RuntimePlan;
  readonly initialRecord: CanonicalRunRecord;
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
   * Optional callback that resolves the association registry's authoritative
   * source state for a Run's ChangeInstance (M2). When provided, the facade
   * passes the resolved state to `projectRunView`, so `pipeline status` on an
   * archived Run reports `sourceState: 'archived'` instead of the default
   * `'active'`. When omitted, the projector defaults to `'active'` (the safe
   * default for pre-registry Runs and test fixtures).
   */
  readonly resolveSourceState?: (record: CanonicalRunRecord) => 'active' | 'archived' | 'missing';
}

function asPromise<T>(value: T): Promise<T> {
  return Promise.resolve(value);
}

function receipt(
  record: CanonicalRunRecord,
  disposition: ChangeRunReceipt['disposition'],
  actions: readonly RunAction[],
  resolveSourceState?: (record: CanonicalRunRecord) => 'active' | 'archived' | 'missing'
): ChangeRunReceipt {
  const sourceState = resolveSourceState?.(record) ?? 'active';
  return Object.freeze({
    format: 'change-run-receipt/1',
    disposition,
    view: projectRunView(record, sourceState),
    actions: Object.freeze([...actions]),
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
    deliveryMode: 'grant' | 'defer',
    incomingResumingWaitIds: ReadonlySet<string> = new Set()
  ): { readonly stimuli: readonly RunStimulus[]; readonly granted: readonly RunAction[] } => {
    const stimuli: RunStimulus[] = [];
    const grantedActions: RunAction[] = [];
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
          const action = deps.buildAction({
            nodeId: candidate.nodeId,
            occurrence: candidate.occurrence,
            admissionKind: candidate.admissionKind,
            ...(candidate.profilePath !== undefined
              ? { profilePath: candidate.profilePath }
              : {}),
            ...(candidate.input !== undefined
              ? { input: candidate.input as import('../contracts.js').JsonValue }
              : {}),
          });
          // Cross-Run reservation check. The reconciler has already decided
          // this candidate is admissible within THIS Run; the registry is the
          // only signal that another Run holds the workspace lease.
          if (
            deps.reservationRegistry !== undefined &&
            (candidate.access === 'read' || candidate.access === 'write')
          ) {
            const conflict = deps.reservationRegistry.reserve({
              workspaceInstanceId: workingRecord.workspaceInstanceId,
              runId: deps.plan.runId,
              actionId: action.actionId as ActionId,
              attemptId: action.attemptId as AttemptId,
              access: candidate.access,
              recordDigest: digestCanonicalRunRecord(workingRecord),
              recordVersion: workingRecord.recordVersion,
              state: 'pending',
            });
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
                access: candidate.access,
              });
              break;
            }
          }
          stimuli.push({
            kind: 'admit-action',
            action,
            attemptOrdinal: 0,
            deliveryMode,
          });
          if (deliveryMode === 'grant') {
            grantedActions.push(action);
          }
          break;
        }
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

    return { stimuli, granted: grantedActions };
  };

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
   * deliveryMode semantics (��5.6): `grant` commits admits as `granted` and
   * returns them; `defer` commits admits as `admitted_undelivered` (the
   * management/browser path) and returns `actions: []`. Both modes commit
   * all durable waits and terminal transitions.
   */
  const settleCandidates = (
    record: CanonicalRunRecord,
    candidates: readonly ReconcilerNextAction[],
    deliveryMode: 'grant' | 'defer'
  ): { record: CanonicalRunRecord; granted: readonly RunAction[] } => {
    const collected = collectSettleStimuli(record, candidates, deliveryMode);
    if (collected.stimuli.length === 0) {
      return { record, granted: [] };
    }
    const result = reduceCandidateBatch(record, collected.stimuli);
    if (!result.ok) {
      throw new Error(`facade settle failed: ${result.failure.message}`);
    }
    return { record: result.record, granted: collected.granted };
  };

  return {
    start(_request, context: RuntimeMutationContext) {
      if (deps.store.has(deps.plan.runId)) {
        const record = deps.store.load(deps.plan.runId);
        return asPromise(receipt(record, 'reused', [], deps.resolveSourceState));
      }
      const reconciled = reconcile(deps.plan, deps.initialRecord);
      if (!reconciled.ok) {
        throw new Error(`facade reconcile failed: ${reconciled.failure.message}`);
      }
      const settled = settleCandidates(
        deps.initialRecord,
        reconciled.actions,
        context.deliveryMode
      );
      deps.store.create(deps.plan.runId, settled.record);
      return asPromise(receipt(settled.record, 'created', settled.granted, deps.resolveSourceState));
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
        context.deliveryMode
      );
      if (settled.record !== record) {
        deps.store.commit(deps.plan.runId, settled.record);
      }
      const disposition: ChangeRunReceipt['disposition'] =
        settled.record.terminal !== undefined
          ? 'terminal'
          : settled.granted.length > 0
            ? 'advanced'
            : settled.record.waits.length > 0
              ? 'waiting'
              : 'advanced';
      return asPromise(
        receipt(settled.record, disposition, settled.granted, deps.resolveSourceState)
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
      if (request.kind !== 'domain-action-result') {
        throw new Error(
          'facade complete failed: only domain-action-result completions are supported by this facade path.'
        );
      }
      // Pre-commit ReviewCycle validation (D3): validate the completion against
      // the exact mechanically expected phase BEFORE committing. Malformed
      // results, same-actor fixer+verifier, and open Blocker/Major findings
      // fail closed without Record mutation.
      validateReviewCycleCompletion(deps.plan, record, request);
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
      // Apply the commit to an intermediate Record purely to discover the
      // candidate batch the completion unblocks; the final write folds the
      // commit stimulus and the settle stimuli into ONE reduceCandidateBatch
      // over the original Record so the store's head+1 invariant holds (the
      // whole completion + settle is one Record revision, per design §5.6).
      const intermediate = reduceCanonicalRunRecord(record, commitStimulus);
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
        context.deliveryMode
      );
      // Fold the commit + settle into one batch over the ORIGINAL Record.
      const batchStimuli =
        collected.stimuli.length === 0
          ? [commitStimulus]
          : [commitStimulus, ...collected.stimuli];
      const result = reduceCandidateBatch(record, batchStimuli);
      if (!result.ok) {
        // If the combined batch fails (a typed invariant the separate steps
        // did not catch), fall back to committing the intermediate
        // commit-action-result alone so the completion is not lost, then
        // surface the settle failure.
        deps.store.commit(deps.plan.runId, intermediate.record);
        throw new Error(`facade complete settle failed: ${result.failure.message}`);
      }
      const finalRecord = result.record;
      deps.store.commit(deps.plan.runId, finalRecord);
      const disposition: ChangeRunReceipt['disposition'] =
        finalRecord.terminal !== undefined
          ? 'terminal'
          : collected.granted.length > 0
            ? 'advanced'
            : finalRecord.waits.length > 0
              ? 'waiting'
              : 'advanced';
      return asPromise(receipt(finalRecord, disposition, collected.granted, deps.resolveSourceState));
    },
    inspect(_ref: ExactChangeRunRef) {
      const record = deps.store.load(deps.plan.runId);
      const sourceState = deps.resolveSourceState?.(record) ?? 'active';
      return asPromise(projectRunView(record, sourceState));
    },
    control(request: ChangeRunControlRequest, _context: RuntimeMutationContext) {
      const record = deps.store.load(deps.plan.runId);
      deps.assertMutationAllowed?.(record);
      const result = reduceCanonicalRunRecord(record, request as unknown as RunStimulus);
      if (!result.ok) {
        throw new Error(`facade control failed: ${result.failure.message}`);
      }
      deps.store.commit(deps.plan.runId, result.record);
      return asPromise(receipt(result.record, 'advanced', [], deps.resolveSourceState));
    },
  };
}

export { asPromise };
export type { ChangeRunView };
