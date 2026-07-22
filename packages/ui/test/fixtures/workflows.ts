import type { WorkflowDetailResponse, WorkflowListResponse } from '../../src/api/types.js';

/**
 * A workflow library listing (workflows-ui spec): a built-in driver, an
 * unreferenced user task, and one invalid user entry — so provenance grouping,
 * the kind chip, the unused badge, the built-in lock, and the invalid group all
 * have something to bite on. `satisfies WorkflowListResponse` is the `tsc`
 * drift tripwire over the mirrored wire types — no `as` anywhere.
 */
export const workflowsListFixture = {
  workflows: [
    {
      id: 'review-cycle',
      source: 'built-in',
      sourcePath: null,
      digest: 'abcdef0123456789aa',
      kind: 'driver',
      skillName: 'rasen-review-cycle',
      commandId: 'rasen:review-cycle',
      unused: false,
    },
    {
      id: 'team-flow',
      source: 'user',
      sourcePath: '/home/u/.rasen/workflows/team-flow',
      digest: 'deadbeefcafebabe11',
      kind: 'task',
      skillName: 'rasen-team-flow',
      commandId: null,
      unused: true,
    },
  ],
  invalid: [
    {
      id: 'broken-flow',
      source: 'user',
      sourcePath: '/home/u/.rasen/workflows/broken-flow',
      valid: false,
      diagnostics: [{ code: 'workflow_id_mismatch', severity: 'error', message: 'id disagrees with directory' }],
    },
  ],
  diagnostics: [],
} satisfies WorkflowListResponse;

/** One user workflow's detail (mirrors `workflow show --json`) for the detail-panel test. */
export const workflowDetailFixture = {
  workflow: {
    id: 'team-flow',
    source: 'user',
    sourcePath: '/home/u/.rasen/workflows/team-flow',
    manifestVersion: 1,
    kind: 'task',
    digest: 'deadbeefcafebabe11',
    skill: { name: 'rasen-team-flow', dirName: 'team-flow', description: 'A team flow' },
    command: null,
    requires: { workflows: ['dep-a'], skills: [], pipelines: [], schemas: [] },
    recommends: { workflows: [] },
    files: [
      { path: 'workflow.yaml', sha256: 'aa' },
      { path: 'SKILL.md', sha256: 'bb' },
    ],
  },
  usage: [{ kind: 'pipeline', consumer: 'user:my-pipe', hard: true }],
} satisfies WorkflowDetailResponse;
