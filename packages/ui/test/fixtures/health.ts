import type { HealthResponse } from '../../src/api/types.js';

export const healthFixture = {
  ok: true,
  version: '0.1.3',
  project: { projectId: 'proj_abc123', name: 'rasen', root: '/Users/dev/rasen' },
} satisfies HealthResponse;
