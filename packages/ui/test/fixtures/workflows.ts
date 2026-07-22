import type { WorkflowDetailResponse, WorkflowListResponse } from '../../src/api/types.js';

/**
 * A workflow library listing (workflows-ui spec) exercising all four kinds so
 * the category sections, the driver section's internal disclosure, the unused
 * badge, the built-in lock, per-card provenance, and the invalid group all have
 * something to bite on. The driver section is intentionally mixed (built-in
 * `review-cycle` + user `plan-build`) so provenance-inside-a-section is testable
 * at the top level; `resolve-deps` is the internal-kind entry that lives behind
 * the driver disclosure. `satisfies WorkflowListResponse` is the `tsc` drift
 * tripwire over the mirrored wire types — no `as` anywhere.
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
      unused: false,
    },
    {
      id: 'plan-build',
      source: 'user',
      sourcePath: '/home/u/.rasen/workflows/plan-build',
      digest: 'facefeed00112233cc',
      kind: 'driver',
      skillName: 'rasen-plan-build',
      unused: false,
    },
    {
      id: 'team-flow',
      source: 'user',
      sourcePath: '/home/u/.rasen/workflows/team-flow',
      digest: 'deadbeefcafebabe11',
      kind: 'task',
      skillName: 'rasen-team-flow',
      unused: true,
    },
    {
      id: 'deep-research',
      source: 'built-in',
      sourcePath: null,
      digest: 'c0ffee1234567890dd',
      kind: 'expert',
      skillName: 'rasen-deep-research',
      unused: false,
    },
    {
      id: 'resolve-deps',
      source: 'built-in',
      sourcePath: null,
      digest: 'ba5eba11cafef00d99',
      kind: 'internal',
      skillName: 'rasen-resolve-deps',
      unused: false,
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
    requires: { workflows: ['dep-a'], skills: [], pipelines: [], schemas: [] },
    recommends: { workflows: [] },
    files: [
      { path: 'workflow.yaml', sha256: 'aa' },
      { path: 'SKILL.md', sha256: 'bb' },
    ],
  },
  usage: [{ kind: 'pipeline', consumer: 'user:my-pipe', hard: true }],
} satisfies WorkflowDetailResponse;
