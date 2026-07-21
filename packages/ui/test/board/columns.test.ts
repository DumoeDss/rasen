import { describe, expect, it } from 'vitest';
import { deriveColumn, deriveTaskColumn, groupIntoTasks } from '../../src/board/columns.js';
import type {
  ChangeRunEntry,
  ChangeSummary,
  SessionListEntry,
  SessionRecordWire,
} from '../../src/api/types.js';

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

/** A change already placed in a given column by `deriveColumn`, for aggregation tests. */
function changeInColumn(
  name: string,
  column: 'planning' | 'ready' | 'in-progress' | 'done',
  extra: Partial<ChangeSummary> = {}
): ChangeSummary {
  switch (column) {
    case 'planning':
      return change({ name, applyReady: false, ...extra });
    case 'ready':
      return change({ name, applyReady: true, taskProgress: { total: 2, completed: 0 }, ...extra });
    case 'in-progress':
      return change({ name, applyReady: true, taskProgress: { total: 4, completed: 2 }, ...extra });
    case 'done':
      return change({ name, applyReady: true, taskProgress: { total: 3, completed: 3 }, ...extra });
  }
}

const NO_RUNS = new Map<string, ChangeRunEntry>();

function liveSession(changeName: string, overrides: Partial<SessionRecordWire> = {}): SessionListEntry {
  return {
    session: {
      id: `sess-${changeName}`,
      kind: 'auto',
      task: `Working on ${changeName}`,
      cwd: '/proj',
      state: 'running',
      startedAt: 0,
      lastOutputAt: 0,
      changeName,
      ...overrides,
    },
    runState: { kind: 'absent' },
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

describe('deriveTaskColumn (portfolio child aggregation, design D2)', () => {
  it('is In Progress when any child is in progress, spanning planning/ready/in-progress', () => {
    const children = [
      changeInColumn('a', 'planning'),
      changeInColumn('b', 'ready'),
      changeInColumn('c', 'in-progress'),
    ];
    expect(deriveTaskColumn(children, NO_RUNS).column).toBe('in-progress');
  });

  it('is Planning when a child is still planning and none is ready/in-progress (done + planning)', () => {
    const children = [changeInColumn('a', 'done'), changeInColumn('b', 'planning')];
    expect(deriveTaskColumn(children, NO_RUNS).column).toBe('planning');
  });

  it('is Ready when a child is ready and none is in-progress (done + ready)', () => {
    const children = [changeInColumn('a', 'done'), changeInColumn('b', 'ready')];
    expect(deriveTaskColumn(children, NO_RUNS).column).toBe('ready');
  });

  it('is Done only when every child is Done', () => {
    const children = [changeInColumn('a', 'done'), changeInColumn('b', 'done')];
    expect(deriveTaskColumn(children, NO_RUNS).column).toBe('done');
  });

  it('degenerates to the single change column for a one-child Task', () => {
    expect(deriveTaskColumn([changeInColumn('a', 'ready')], NO_RUNS).column).toBe('ready');
  });

  it('ORs escalation across children', () => {
    const runs = new Map<string, ChangeRunEntry>([
      [
        'b',
        {
          name: 'b',
          kind: 'ok',
          autoRun: { kind: 'ok', state: { pipeline: 'full-feature', stages: { review: { status: 'escalated' } } } },
          portfolio: { kind: 'absent' },
          goalRun: { kind: 'absent' },
        },
      ],
    ]);
    const children = [changeInColumn('a', 'done'), changeInColumn('b', 'in-progress')];
    expect(deriveTaskColumn(children, runs).escalated).toBe(true);
  });
});

describe('groupIntoTasks (design D1/D3)', () => {
  it('collapses changes sharing a portfolio into one Task with those children', () => {
    const changes = [
      change({ name: 'redesign-api', portfolio: 'redesign', taskProgress: { total: 3, completed: 3 } }),
      change({ name: 'redesign-shell', portfolio: 'redesign', applyReady: false }),
    ];
    const tasks = groupIntoTasks(changes, NO_RUNS, []);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.id).toBe('redesign');
    expect(tasks[0]!.label).toBe('redesign');
    expect(tasks[0]!.kind).toBe('portfolio');
    expect(tasks[0]!.children.map((c) => c.name)).toEqual(['redesign-api', 'redesign-shell']);
    // one child planning → the portfolio is Planning
    expect(tasks[0]!.column).toBe('planning');
  });

  it('maps a change with no portfolio to a single-item Task', () => {
    const tasks = groupIntoTasks([changeInColumn('fix-login', 'ready')], NO_RUNS, []);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.kind).toBe('single');
    expect(tasks[0]!.id).toBe('fix-login');
    expect(tasks[0]!.column).toBe('ready');
  });

  it('counts portfolio progress as done-children over on-board children ("N/M changes")', () => {
    const changes = [
      changeInColumn('p-a', 'done', { portfolio: 'p' }),
      changeInColumn('p-b', 'done', { portfolio: 'p' }),
      changeInColumn('p-c', 'planning', { portfolio: 'p' }),
    ];
    const task = groupIntoTasks(changes, NO_RUNS, [])[0]!;
    expect(task.progress).toEqual({ done: 2, total: 3 });
  });

  it('counts single-item progress as the change task-checkbox counts ("N/M tasks")', () => {
    const changes = [change({ name: 'solo', taskProgress: { total: 6, completed: 4 } })];
    const task = groupIntoTasks(changes, NO_RUNS, [])[0]!;
    expect(task.progress).toEqual({ done: 4, total: 6 });
  });

  it('sets liveStage from a live session targeting a child, and leaves it unset otherwise', () => {
    const changes = [
      change({ name: 'redesign-api', portfolio: 'redesign' }),
      change({ name: 'lonely' }),
    ];
    const withStage: SessionListEntry = {
      session: {
        id: 'sess-1',
        kind: 'auto',
        task: 'raw task text',
        cwd: '/proj',
        state: 'running',
        startedAt: 0,
        lastOutputAt: 0,
        changeName: 'redesign-api',
      },
      runState: {
        name: 'redesign-api',
        kind: 'ok',
        autoRun: { kind: 'ok', state: { pipeline: 'full-feature', stages: { apply: { status: 'in_progress' } } } },
        portfolio: { kind: 'absent' },
        goalRun: { kind: 'absent' },
      },
    };
    const tasks = groupIntoTasks(changes, NO_RUNS, [withStage]);
    const portfolio = tasks.find((t) => t.id === 'redesign')!;
    const lonely = tasks.find((t) => t.id === 'lonely')!;
    expect(portfolio.liveStage).toBe('full-feature · apply');
    expect(lonely.liveStage).toBeUndefined();
  });

  it('falls back to the raw session task when the live session has no ok run-state', () => {
    const tasks = groupIntoTasks([change({ name: 'solo' })], NO_RUNS, [liveSession('solo', { task: 'raw work' })]);
    expect(tasks[0]!.liveStage).toBe('raw work');
  });

  it('ignores a changeName-less session and non-live sessions', () => {
    const noChange = liveSession('solo');
    delete noChange.session.changeName;
    const exited = liveSession('solo', { state: 'exited' });
    const tasks = groupIntoTasks([change({ name: 'solo' })], NO_RUNS, [noChange, exited]);
    expect(tasks[0]!.liveStage).toBeUndefined();
  });
});
