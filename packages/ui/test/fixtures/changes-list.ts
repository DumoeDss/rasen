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
} satisfies ChangesResponse;
