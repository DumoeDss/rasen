import { describe, expect, it } from 'vitest';

import { projectRunView } from '../../../src/core/change-run/internal/projector.js';
import { decodeChangeRunView } from '../../../src/core/change-run/index.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import {
  agentAction,
  awaitGate,
  bugFixPlan,
  startRecord,
  succeedNode,
} from './reconciler-fixture.js';

function decode(record: ReturnType<typeof startRecord>) {
  return decodeChangeRunView(
    JSON.parse(JSON.stringify(projectRunView(record)))
  );
}

describe('ChangeRunProjector (11.1/11.2)', () => {
  it('projects a fresh running Record to a valid view with escalate/cancel controls', () => {
    const plan = bugFixPlan();
    const view = decode(startRecord(plan));
    expect(view.status).toBe('running');
    expect(view.sections[0]!.kind).toBe('root-dag');
    const root = view.sections[0] as Extract<typeof view.sections[number], { kind: 'root-dag' }>;
    expect(root.actions).toEqual([]);
    expect(root.waits).toEqual([]);
    expect(root.allowedControls.map((c) => c.kind).sort()).toEqual(['cancel', 'escalate']);
  });

  it('projects an admitted action and an awaited gate', () => {
    const plan = bugFixPlan();
    let record = awaitGate(plan, startRecord(plan), 'root/propose');
    const view = decode(record);
    const root = view.sections[0] as Extract<typeof view.sections[number], { kind: 'root-dag' }>;
    expect(root.waits).toHaveLength(1);
    expect(root.waits[0]!.kind).toBe('gate');
    // A gate offers one decision control per declared decision id.
    expect(root.allowedControls.some((c) => c.kind === 'decision')).toBe(true);
  });

  it('projects an active action as a running view', () => {
    const plan = bugFixPlan();
    // Bypass the gate to admit an action directly via the reducer.
    const recordAfterGate = (() => {
      let r = awaitGate(plan, startRecord(plan), 'root/propose');
      const wait = r.waits.find((w) => w.kind === 'gate');
      if (!wait) throw new Error('no gate wait');
      const decided = reduceCanonicalRunRecord(r, {
        kind: 'decide-gate',
        waitId: wait.waitId,
        decisionId: 'approve',
        outcome: 'approve',
      });
      if (!decided.ok) throw new Error(decided.failure.message);
      return decided.record;
    })();
    const action = agentAction(plan, 'root/propose');
    const admitted = reduceCanonicalRunRecord(recordAfterGate, {
      kind: 'admit-action',
      action,
      attemptOrdinal: 0,
      deliveryMode: 'grant',
    });
    if (!admitted.ok) throw new Error(admitted.failure.message);
    const view = decode(admitted.record);
    expect(view.status).toBe('running');
    const root = view.sections[0] as Extract<typeof view.sections[number], { kind: 'root-dag' }>;
    expect(root.actions).toHaveLength(1);
    expect(root.actions[0]!.deliveryState).toBe('granted');
  });

  it('projects a terminal Record with no actions/waits/controls', () => {
    const plan = bugFixPlan();
    let record = startRecord(plan);
    for (const path of ['root/propose', 'root/apply', 'root/verify', 'root/ship', 'root/archive']) {
      record = succeedNode(
        plan,
        record,
        path,
        path === 'root/verify' ? { route: 'simple' } : { ok: true }
      );
    }
    const finished = reduceCanonicalRunRecord(record, {
      kind: 'finish',
      outcome: 'bug-fix-completed',
    });
    if (!finished.ok) throw new Error(finished.failure.message);
    const view = decode(finished.record);
    expect(view.status).toBe('completed');
    const root = view.sections[0] as Extract<typeof view.sections[number], { kind: 'root-dag' }>;
    expect(root.actions).toEqual([]);
    expect(root.waits).toEqual([]);
    expect(root.allowedControls).toEqual([]);
    expect(root.terminal).toEqual({ kind: 'completed', outcome: 'bug-fix-completed' });
  });
});
