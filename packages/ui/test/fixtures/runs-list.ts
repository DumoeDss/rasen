import type { RunsResponse } from '../../src/api/types.js';

export const runsListFixture = {
  runs: [
    {
      name: 'in-progress-change',
      kind: 'ok',
      autoRun: {
        kind: 'ok',
        state: { pipeline: 'full-feature', stages: { review: { status: 'escalated' } } },
      },
      portfolio: { kind: 'absent' },
      goalRun: { kind: 'absent' },
    },
    {
      name: 'done-change',
      kind: 'ok',
      autoRun: { kind: 'ok', state: { pipeline: 'full-feature', stages: { review: { status: 'done' } } } },
      portfolio: { kind: 'absent' },
      goalRun: { kind: 'absent' },
    },
  ],
} satisfies RunsResponse;
