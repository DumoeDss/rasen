import type { ListProjectsResponse } from '../../src/api/types.js';

export const projectsListFixture = {
  projects: [
    { projectId: 'proj_abc123', name: 'rasen', root: '/Users/dev/rasen' },
    { projectId: 'proj_def456', name: 'other-repo', root: '/Users/dev/other-repo' },
  ],
} satisfies ListProjectsResponse;
