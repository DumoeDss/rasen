import { describe, expect, it } from 'vitest';

import {
  RunStoreError,
  createInMemoryRunStore,
} from '../../../src/core/change-run/internal/run-store.js';
import {
  decodeCanonicalRunRecord,
  digestCanonicalRunRecord,
} from '../../../src/core/change-run/internal/record.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import {
  agentAction,
  bugFixPlan,
  startRecord,
} from './reconciler-fixture.js';

function nextRecord(plan: ReturnType<typeof bugFixPlan>) {
  const base = startRecord(plan);
  const action = agentAction(plan, 'root/propose');
  // Advance past the propose gate so the action is admittable.
  const result = reduceCanonicalRunRecord(base, {
    kind: 'admit-action',
    action,
    attemptOrdinal: 0,
    deliveryMode: 'grant',
  });
  if (!result.ok) throw new Error(result.failure.message);
  return { base, head: result.record };
}

describe('in-memory RunStore (9.1/9.2)', () => {
  it('creates and loads the initial Record (no earlier-revision fallback)', () => {
    const store = createInMemoryRunStore();
    const plan = bugFixPlan();
    const record = startRecord(plan);
    store.create(plan.runId, record);
    expect(store.has(plan.runId)).toBe(true);
    expect(store.load(plan.runId).recordVersion).toBe(0);
  });

  it('rejects creating the same Run twice and loading an absent Run', () => {
    const store = createInMemoryRunStore();
    const plan = bugFixPlan();
    store.create(plan.runId, startRecord(plan));
    expect(() => store.create(plan.runId, startRecord(plan))).toThrowError(RunStoreError);
    expect(() => store.load('run:missing' as never)).toThrowError(RunStoreError);
  });

  it('commits a valid next Record and advances the head', () => {
    const store = createInMemoryRunStore();
    const plan = bugFixPlan();
    const { base, head } = nextRecord(plan);
    store.create(plan.runId, base);
    store.commit(plan.runId, head);
    expect(store.load(plan.runId).recordVersion).toBe(1);
    expect(store.load(plan.runId).previousRecordDigest).toBe(
      digestCanonicalRunRecord(base)
    );
  });

  it('rejects a Record whose predecessor digest does not match the head', () => {
    const store = createInMemoryRunStore();
    const plan = bugFixPlan();
    const { base, head } = nextRecord(plan);
    store.create(plan.runId, base);
    const tampered = decodeCanonicalRunRecord({
      ...head,
      previousRecordDigest: 'sha256:' + '0'.repeat(64),
    });
    expect(() => store.commit(plan.runId, tampered)).toThrowError(RunStoreError);
  });

  it('rejects a version gap (commit must be exactly head + 1)', () => {
    const store = createInMemoryRunStore();
    const plan = bugFixPlan();
    const { base, head } = nextRecord(plan);
    store.create(plan.runId, base);
    const skipped = decodeCanonicalRunRecord({
      ...head,
      recordVersion: 2,
    });
    expect(() => store.commit(plan.runId, skipped)).toThrowError(RunStoreError);
  });

  it('lists Run summaries from the current heads', () => {
    const store = createInMemoryRunStore();
    const plan = bugFixPlan();
    store.create(plan.runId, startRecord(plan));
    const listed = store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.runId).toBe(plan.runId);
    expect(listed[0]!.recordVersion).toBe(0);
    expect(listed[0]!.status).toBe('running');
  });
});
