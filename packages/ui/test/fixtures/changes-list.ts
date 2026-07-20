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
      // apply-required artifacts (proposal/design/specs) are done, but the
      // schema's `tasks` artifact — outside `apply.requires` — is not yet
      // written: applyReady but not isComplete, with zero tasks counted.
      // Distinct from `done-change`/the m1 zero-task-Done case below, which
      // requires isComplete: true.
      name: 'ready-change',
      schemaName: 'spec-driven',
      artifacts: [
        { id: 'proposal', status: 'done' },
        { id: 'design', status: 'done' },
        { id: 'specs', status: 'done' },
        { id: 'tasks', status: 'ready' },
      ],
      applyReady: true,
      isComplete: false,
      taskProgress: { total: 0, completed: 0 },
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
