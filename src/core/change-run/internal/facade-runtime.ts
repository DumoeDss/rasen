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
 * The runtime facade factory (task 10.2). Wires the lowerer's RuntimePlan, the
 * pure reconciler, the reducer + candidate-commit seam, the immutable RunStore,
 * and the read-only projector behind the public {@link ChangePipelineRuntime}.
 * Internal plan/Record/store/path are never exposed; every mutation funnels
 * through the canonical commit path.
 */
export function createChangePipelineRuntime(deps: RuntimeDeps): ChangePipelineRuntime {
  const grantAdmits = (
    record: CanonicalRunRecord,
    candidates: readonly ReconcilerNextAction[]
  ): { record: CanonicalRunRecord; granted: readonly RunAction[] } => {
    const admits = candidates.filter(
      (action): action is Extract<ReconcilerNextAction, { kind: 'admit' }> =>
        action.kind === 'admit'
    );
    if (admits.length === 0) {
      return { record, granted: [] };
    }
    const actions = admits.map((candidate) => deps.buildAction(candidate));
    const stimuli: RunStimulus[] = actions.map((action) => ({
      kind: 'admit-action',
      action,
      attemptOrdinal: 0,
      deliveryMode: 'grant',
    }));
    const result = reduceCandidateBatch(record, stimuli);
    if (!result.ok) {
      throw new Error(`facade grant failed: ${result.failure.message}`);
    }
    return { record: result.record, granted: actions };
  };

  return {
    start(_request, context: RuntimeMutationContext) {
      if (deps.store.has(deps.plan.runId)) {
        const record = deps.store.load(deps.plan.runId);
        return asPromise(receipt(record, 'reused', []));
      }
      let record = deps.initialRecord;
      const reconciled = reconcile(deps.plan, record);
      if (!reconciled.ok) {
        throw new Error(`facade reconcile failed: ${reconciled.failure.message}`);
      }
      const candidates = reconciled.actions;
      // Only auto-grant when the caller asked for grant mode; defer leaves
      // actions undelivered (the management/browser path).
      if (context.deliveryMode === 'grant') {
        const settled = grantAdmits(record, candidates);
        record = settled.record;
        deps.store.create(deps.plan.runId, record);
        return asPromise(receipt(record, 'created', settled.granted));
      }
      deps.store.create(deps.plan.runId, record);
      return asPromise(receipt(record, 'created', []));
    },
    resume(_request, context: RuntimeMutationContext) {
      const record = deps.store.load(deps.plan.runId);
      if (context.deliveryMode !== 'grant') {
        return asPromise(receipt(record, 'advanced', []));
      }
      const reconciled = reconcile(deps.plan, record);
      if (!reconciled.ok) {
        throw new Error(`facade reconcile failed: ${reconciled.failure.message}`);
      }
      const candidates = reconciled.actions;
      const admits = candidates.filter(
        (candidate): candidate is Extract<ReconcilerNextAction, { kind: 'admit' }> =>
          candidate.kind === 'admit'
      );
      if (admits.length === 0) {
        const disposition: ChangeRunReceipt['disposition'] =
          record.terminal !== undefined ? 'terminal' : 'waiting';
        return asPromise(receipt(record, disposition, []));
      }
      const settled = grantAdmits(record, candidates);
      deps.store.commit(deps.plan.runId, settled.record);
      return asPromise(receipt(settled.record, 'advanced', settled.granted));
    },
    complete(request: CompleteRunAction, _context: RuntimeMutationContext) {
      const record = deps.store.load(deps.plan.runId);
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
