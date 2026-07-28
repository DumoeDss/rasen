import type {
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
}

function asPromise<T>(value: T): Promise<T> {
  return Promise.resolve(value);
}

function receipt(
  record: CanonicalRunRecord,
  disposition: ChangeRunReceipt['disposition'],
  actions: readonly RunAction[]
): ChangeRunReceipt {
  return Object.freeze({
    format: 'change-run-receipt/1',
    disposition,
    view: projectRunView(record),
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
    deliveryMode: 'grant' | 'defer'
  ): { record: CanonicalRunRecord; granted: readonly RunAction[] } => {
    const stimuli: RunStimulus[] = [];
    const grantedActions: RunAction[] = [];

    for (const candidate of candidates) {
      switch (candidate.kind) {
        case 'admit': {
          const action = deps.buildAction({
            nodeId: candidate.nodeId,
            occurrence: candidate.occurrence,
            admissionKind: candidate.admissionKind,
          });
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
            record,
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
        case 'await-workspace':
          // Workspace-reservation waits require attemptId/actionId for each
          // blocked intent, which don't exist until the action is admitted.
          // The blocked admits are simply not emitted; the Run stays running
          // until the contention resolves. This is a known remaining gap.
          break;
      }
    }

    if (stimuli.length === 0) {
      return { record, granted: [] };
    }
    const result = reduceCandidateBatch(record, stimuli);
    if (!result.ok) {
      throw new Error(`facade settle failed: ${result.failure.message}`);
    }
    return { record: result.record, granted: grantedActions };
  };

  return {
    start(_request, context: RuntimeMutationContext) {
      if (deps.store.has(deps.plan.runId)) {
        const record = deps.store.load(deps.plan.runId);
        return asPromise(receipt(record, 'reused', []));
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
      return asPromise(receipt(settled.record, 'created', settled.granted));
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
        receipt(settled.record, disposition, settled.granted)
      );
    },
    complete(request: CompleteRunAction, _context: RuntimeMutationContext) {
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
      const stimulus: RunStimulus = {
        kind: 'commit-action-result',
        actionId: request.actionId,
        status: request.status,
        receiptDigest: request.receiptDigest as never,
        result: request.result,
        evidence: request.evidence,
      };
      const result = reduceCanonicalRunRecord(record, stimulus);
      if (!result.ok) {
        throw new Error(`facade complete failed: ${result.failure.message}`);
      }
      deps.store.commit(deps.plan.runId, result.record);
      return asPromise(receipt(result.record, 'advanced', []));
    },
    inspect(_ref: ExactChangeRunRef) {
      const record = deps.store.load(deps.plan.runId);
      return asPromise(projectRunView(record));
    },
    control(request: ChangeRunControlRequest, _context: RuntimeMutationContext) {
      const record = deps.store.load(deps.plan.runId);
      deps.assertMutationAllowed?.(record);
      const result = reduceCanonicalRunRecord(record, request as unknown as RunStimulus);
      if (!result.ok) {
        throw new Error(`facade control failed: ${result.failure.message}`);
      }
      deps.store.commit(deps.plan.runId, result.record);
      return asPromise(receipt(result.record, 'advanced', []));
    },
  };
}

export { asPromise };
export type { ChangeRunView };
