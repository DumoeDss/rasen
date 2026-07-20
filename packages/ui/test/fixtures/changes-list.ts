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
