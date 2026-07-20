import { describe, expect, it } from 'vitest';
import { deriveColumn } from '../../src/board/columns.js';
import type { ChangeRunEntry, ChangeSummary } from '../../src/api/types.js';

function change(overrides: Partial<ChangeSummary> = {}): ChangeSummary {
  return {
    name: 'test-change',
    schemaName: 'spec-driven',
    artifacts: [],
    applyReady: true,
    isComplete: false,
    taskProgress: { total: 0, completed: 0 },
    hasRunFiles: false,
    ...overrides,
  };
}

describe('deriveColumn', () => {
  it('places a change with incomplete apply-required artifacts in Planning', () => {
    const result = deriveColumn(change({ applyReady: false }));
    expect(result.column).toBe('planning');
    expect(result.escalated).toBe(false);
  });

  it('places an apply-ready, incomplete change with no tasks done and no run in Ready', () => {
    const result = deriveColumn(
      change({ applyReady: true, isComplete: false, taskProgress: { total: 0, completed: 0 } })
    );
    expect(result.column).toBe('ready');
  });

  it('places a task-less but fully-artifact-complete change in Done (review round 1 m1)', () => {
    const result = deriveColumn(
      change({ applyReady: true, isComplete: true, taskProgress: { total: 0, completed: 0 } })
    );
    expect(result.column).toBe('done');
  });

  it('places a change with some tasks completed in In Progress', () => {
    const result = deriveColumn(
      change({ applyReady: true, taskProgress: { total: 4, completed: 2 } })
    );
    expect(result.column).toBe('in-progress');
  });

  it('places a change with an in_progress run stage in In Progress even with zero tasks done', () => {
    const run: ChangeRunEntry = {
      name: 'test-change',
      kind: 'ok',
      autoRun: { kind: 'ok', state: { pipeline: 'full-feature', stages: { design: { status: 'in_progress' } } } },
      portfolio: { kind: 'absent' },
      goalRun: { kind: 'absent' },
    };
    const result = deriveColumn(
      change({ applyReady: true, taskProgress: { total: 0, completed: 0 } }),
      run
    );
    expect(result.column).toBe('in-progress');
  });

  it('places a change with all tasks completed in Done', () => {
    const result = deriveColumn(
      change({ applyReady: true, taskProgress: { total: 3, completed: 3 } })
    );
    expect(result.column).toBe('done');
  });

  it('sets escalated: true (as a badge, not a column) when a run stage is escalated', () => {
    const run: ChangeRunEntry = {
      name: 'test-change',
      kind: 'ok',
      autoRun: { kind: 'ok', state: { pipeline: 'full-feature', stages: { review: { status: 'escalated' } } } },
      portfolio: { kind: 'absent' },
      goalRun: { kind: 'absent' },
    };
    const result = deriveColumn(
      change({ applyReady: true, taskProgress: { total: 2, completed: 1 } }),
      run
    );
    expect(result.column).toBe('in-progress');
    expect(result.escalated).toBe(true);
  });

  it('ignores an errored run entry (no crash, falls back to task-progress-only derivation)', () => {
    const run: ChangeRunEntry = { name: 'test-change', kind: 'error', message: 'boom' };
    const result = deriveColumn(change({ applyReady: true }), run);
    expect(result.column).toBe('ready');
    expect(result.escalated).toBe(false);
  });
});
