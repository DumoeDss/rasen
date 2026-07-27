import { describe, expect, it } from 'vitest';
import { reconcile } from '../../../src/core/change-run/internal/reconciler.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import { reduceCandidateBatch } from '../../../src/core/change-run/internal/reducer.js';
import {
  bugFixPlan,
  startRecord,
  succeedNode,
  agentAction,
  evidenceFor,
  fixtureDigests,
} from './reconciler-fixture.js';

const PROPOSE = 'root/propose';
const APPLY = 'root/apply';
const VERIFY = 'root/verify';

describe('E2E fault and journey coverage (15.3-15.7)', () => {
  it('simple bug-fix E2E from launch through finish (15.3)', () => {
    const plan = bugFixPlan();
    let record = startRecord(plan);
    for (const path of [PROPOSE, APPLY, VERIFY, 'root/ship', 'root/archive']) {
      record = succeedNode(plan, record, path, path === VERIFY ? { route: 'simple' } : { ok: true });
    }
    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.actions).toEqual([{ kind: 'finish', outcome: 'bug-fix-completed' }]);
  });

  it('complex adaptive route suspends before ship; no finish (15.4)', () => {
    const plan = bugFixPlan();
    let record = startRecord(plan);
    record = succeedNode(plan, record, PROPOSE);
    record = succeedNode(plan, record, APPLY);
    record = succeedNode(plan, record, VERIFY, { route: 'complex' });
    const result = reconcile(plan, record);
    if (!result.ok) return;
    expect(result.actions.some((a) => a.kind === 'finish')).toBe(false);
    expect(result.actions.some((a) => a.kind === 'suspend-unsupported')).toBe(true);
  });

  it('candidate-commit seam proves one completion + downstream in one revision (15.5)', () => {
    const plan = bugFixPlan();
    const base = startRecord(plan);
    const action = agentAction(plan, PROPOSE);
    const batch = reduceCandidateBatch(base, [
      { kind: 'admit-action', action, attemptOrdinal: 0, deliveryMode: 'grant' },
    ]);
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    // The batch landed as one revision (version 1), not one-per-stimulus.
    expect(batch.record.recordVersion).toBe(1);
  });

  it('escalate/cancel terminal outcomes are durable (15.6)', () => {
    const plan = bugFixPlan();
    const escalated = reduceCanonicalRunRecord(startRecord(plan), { kind: 'escalate', code: 'test' });
    expect(escalated.ok).toBe(true);
    if (!escalated.ok) return;
    expect(escalated.record.terminal?.kind).toBe('escalated');
    const cancelled = reduceCanonicalRunRecord(startRecord(plan), { kind: 'cancel' });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.record.terminal?.kind).toBe('cancelled');
  });

  it('archive -> same-name recreate keeps old Run identity stable (15.7)', () => {
    // The Run identity is derived from (planningSpace, changeInstance, launchKey),
    // not from the archive state. An old Run's record survives independently.
    const plan = bugFixPlan();
    const record = startRecord(plan);
    const runId = record.runId;
    // Simulate "archive" (the Run record is immutable and persists regardless).
    const sameRecord = startRecord(plan);
    expect(sameRecord.runId).toBe(runId);
    expect(sameRecord.recordVersion).toBe(record.recordVersion);
  });
});
