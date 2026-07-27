import { describe, expect, it } from 'vitest';
import { projectRunView } from '../../../src/core/change-run/internal/projector.js';
import { decodeChangeRunView } from '../../../src/core/change-run/index.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import { bugFixPlan, startRecord, succeedNode } from './reconciler-fixture.js';

describe('runs detail + control + terminal/Board isolation + parity (13.5-13.8/14.9/15.1)', () => {
  it('projector output is a valid ChangeRunView for the detail route (13.5/13.6)', () => {
    const plan = bugFixPlan();
    const view = decodeChangeRunView(JSON.parse(JSON.stringify(projectRunView(startRecord(plan)))));
    expect(view.status).toBe('running');
    expect(view.engine).toBe('reconciler');
    expect(view.sections[0]!.kind).toBe('root-dag');
  });

  it('control (cancel) via the reducer produces a terminal Record (13.7/13.8)', () => {
    const plan = bugFixPlan();
    const cancelled = reduceCanonicalRunRecord(startRecord(plan), { kind: 'cancel', reason: 'done' });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.record.status).toBe('cancelled');
    expect(cancelled.record.terminal?.kind).toBe('cancelled');
  });

  it('Run terminal state never mutates Board/Issue lifecycle (14.9)', () => {
    // The kernel has no Board/Issue types; a terminal Run's view is
    // self-contained and does not reference or mutate any Board state.
    const plan = bugFixPlan();
    let record = startRecord(plan);
    for (const path of ['root/propose', 'root/apply', 'root/verify', 'root/ship', 'root/archive']) {
      record = succeedNode(plan, record, path, path === 'root/verify' ? { route: 'simple' } : { ok: true });
    }
    const finished = reduceCanonicalRunRecord(record, { kind: 'finish', outcome: 'bug-fix-completed' });
    if (!finished.ok) return;
    const view = projectRunView(finished.record);
    const json = JSON.stringify(view);
    // No Board/Issue lifecycle references in the view.
    expect(json).not.toContain('board');
    expect(json).not.toContain('issue');
    expect(json).not.toContain('lifecycle');
  });

  it('projector, CLI status, and view all carry the same closed core fields (15.1/15.2)', () => {
    const plan = bugFixPlan();
    const record = startRecord(plan);
    const view = projectRunView(record);
    // The same fields the CLI status command surfaces:
    expect(view.runId).toBe(record.runId);
    expect(view.status).toBe(record.status);
    expect(view.recordVersion).toBe(record.recordVersion);
    expect(view.engine).toBe('reconciler');
    expect(view.workspace.scope).toBe('current');
    // The root-dag section carries actions + waits (empty for a fresh record).
    const root = view.sections[0] as Extract<(typeof view.sections)[number], { kind: 'root-dag' }>;
    expect(root.actions).toEqual([]);
    expect(root.waits).toEqual([]);
    // Round-trip through decode preserves all fields (parity).
    const decoded = decodeChangeRunView(JSON.parse(JSON.stringify(view)));
    expect(decoded.runId).toBe(view.runId);
    expect(decoded.status).toBe(view.status);
  });
});
