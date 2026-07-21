import type { TaskDetailResponse } from '../../src/api/types.js';

/**
 * A portfolio Task roster (ui-space-redesign-task-detail design D2): two active
 * children spanning in-progress/planning plus one archived child (done by
 * definition), with a recorded dependency hint on the second active child.
 * `satisfies TaskDetailResponse` is the `tsc` drift tripwire over the mirrored
 * wire types — no `as` anywhere. The component tests read this.
 */
export const portfolioTaskDetailFixture = {
  task: { id: 'ui-redesign', kind: 'portfolio', label: 'ui-redesign' },
  children: [
    {
      name: 'ui-redesign-api',
      archived: false,
      taskProgress: { total: 4, completed: 2 },
      tasks: [
        { text: 'Wire the endpoint', done: true },
        { text: 'Add the handler', done: true },
        { text: 'Thread the router', done: false },
        { text: 'Cover with tests', done: false },
      ],
      summary: {
        name: 'ui-redesign-api',
        schemaName: 'spec-driven',
        artifacts: [
          { id: 'proposal', status: 'done' },
          { id: 'design', status: 'done' },
          { id: 'specs', status: 'done' },
          { id: 'tasks', status: 'done' },
        ],
        applyReady: true,
        isComplete: true,
        taskProgress: { total: 4, completed: 2 },
        hasRunFiles: true,
        portfolio: 'ui-redesign',
      },
      run: {
        name: 'ui-redesign-api',
        kind: 'ok',
        autoRun: { kind: 'ok', state: { pipeline: 'small-feature', stages: { apply: { status: 'in_progress' } } } },
        portfolio: { kind: 'absent' },
        goalRun: { kind: 'absent' },
      },
      dependsOn: [],
      portfolioStatus: 'in_progress',
    },
    {
      name: 'ui-redesign-shell',
      archived: false,
      taskProgress: { total: 0, completed: 0 },
      tasks: [],
      summary: {
        name: 'ui-redesign-shell',
        schemaName: 'spec-driven',
        artifacts: [
          { id: 'proposal', status: 'done' },
          { id: 'design', status: 'ready' },
          { id: 'specs', status: 'blocked' },
          { id: 'tasks', status: 'blocked' },
        ],
        applyReady: false,
        isComplete: false,
        taskProgress: { total: 0, completed: 0 },
        hasRunFiles: false,
        portfolio: 'ui-redesign',
      },
      run: null,
      dependsOn: ['ui-redesign-api'],
      portfolioStatus: 'pending',
    },
    {
      name: 'ui-redesign-groundwork',
      archived: true,
      archivedAt: '2026-06-01',
      taskProgress: { total: 3, completed: 3 },
      tasks: [
        { text: 'Lay the foundation', done: true },
        { text: 'Migrate the store', done: true },
        { text: 'Delete the legacy path', done: true },
      ],
      summary: null,
      run: null,
      dependsOn: [],
    },
  ],
  errors: [],
} satisfies TaskDetailResponse;

/**
 * A single-item Task (bare change, no portfolio): one child whose children
 * column degrades to that change's own checklist.
 */
export const singleTaskDetailFixture = {
  task: { id: 'fix-login', kind: 'single', label: 'fix-login' },
  children: [
    {
      name: 'fix-login',
      archived: false,
      taskProgress: { total: 2, completed: 1 },
      tasks: [
        { text: 'Reproduce the failure', done: true },
        { text: 'Patch the redirect', done: false },
      ],
      summary: {
        name: 'fix-login',
        schemaName: 'spec-driven',
        artifacts: [
          { id: 'proposal', status: 'done' },
          { id: 'design', status: 'done' },
          { id: 'specs', status: 'done' },
          { id: 'tasks', status: 'done' },
        ],
        applyReady: true,
        isComplete: true,
        taskProgress: { total: 2, completed: 1 },
        hasRunFiles: false,
      },
      run: null,
      dependsOn: [],
    },
  ],
  errors: [],
} satisfies TaskDetailResponse;
