import type { ChangesResponse } from '../../src/api/types.js';

export const changesListFixture = {
  changes: [
    {
      name: 'planning-change',
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
    },
    {
      // spec-driven's `apply.requires` is `[tasks]` (schemas/spec-driven/
      // schema.yaml:149), so `applyReady: true` REQUIRES the `tasks`
      // artifact itself to be 'done' — i.e. tasks.md exists. This is the
      // real Ready state: tasks.md exists with unchecked items (total > 0,
      // completed: 0) and no run has started yet. All four artifacts done
      // also makes isComplete: true, but that alone doesn't move the
      // column — only `taskProgress` and run state do (review round 2 N1:
      // the previous fixture had `tasks: 'ready'` alongside
      // `applyReady: true`, a combination `isApplyReady` can never produce
      // for this schema).
      name: 'ready-change',
      schemaName: 'spec-driven',
      artifacts: [
        { id: 'proposal', status: 'done' },
        { id: 'design', status: 'done' },
        { id: 'specs', status: 'done' },
        { id: 'tasks', status: 'done' },
      ],
      applyReady: true,
      isComplete: true,
      taskProgress: { total: 3, completed: 0 },
      hasRunFiles: false,
    },
    {
      name: 'in-progress-change',
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
    },
    {
      name: 'done-change',
      schemaName: 'spec-driven',
      artifacts: [
        { id: 'proposal', status: 'done' },
        { id: 'design', status: 'done' },
        { id: 'specs', status: 'done' },
        { id: 'tasks', status: 'done' },
      ],
      applyReady: true,
      isComplete: true,
      taskProgress: { total: 3, completed: 3 },
      hasRunFiles: true,
    },
  ],
  errors: [],
} satisfies ChangesResponse;

/**
 * A space whose changes carry the additive `portfolio` membership field
 * (ui-space-redesign-task-board): three children of the `ui-redesign`
 * container spanning done/in-progress/planning, plus a bare change with no
 * portfolio. `satisfies ChangesResponse` keeps the `tsc` drift tripwire over
 * the new field. Grouping/column-aggregation tests read this; the existing
 * `changesListFixture` above stays portfolio-free so its four changes remain
 * four single-item Tasks, one per column.
 */
export const portfolioChangesFixture = {
  changes: [
    {
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
      taskProgress: { total: 3, completed: 3 },
      hasRunFiles: true,
      portfolio: 'ui-redesign',
    },
    {
      name: 'ui-redesign-shell',
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
    {
      name: 'ui-redesign-board',
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
    {
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
      taskProgress: { total: 3, completed: 0 },
      hasRunFiles: false,
    },
  ],
  errors: [],
} satisfies ChangesResponse;
