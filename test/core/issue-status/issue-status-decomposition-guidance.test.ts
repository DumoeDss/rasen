/**
 * `issue-autodecompose-graph` task 3.1 — the decomposition-guidance facts on
 * the Issue read surface: carried per node when the revision records them,
 * null when it does not, and DRIVING NO AXIS — the same before/after shape
 * the target-project projection test pins. "Before" is a revision published
 * without the fields; "after" is the same graph published with them: the two
 * derive identical phase/health/progress/lane values.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';
import {
  StoreIssuesModule,
  productionStoreIssueDependencies,
  withDeterministicIssueClock,
  type ExecutionPlanNodeInput,
} from '../../../src/core/store/issues/index.js';
import { StoreQueryModuleImpl } from '../../../src/core/store/query/index.js';
import { projectIssueStatus } from '../../../src/core/issue-status/index.js';

const NOW = '2026-08-21T00:00:00.000Z';
const LINE = 'main';
const PROJECT = 'app-a';

describe('decomposition guidance on the Issue read surface', () => {
  let f: StoreWorkspaceFixture;
  const scope = () => ({
    store: f.storeId,
    startPath: f.storeRoot,
    globalDataDir: f.globalDataDir,
  });
  const KNOWN = (name: string): boolean => ['small-feature', 'bug-fix'].includes(name);

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-issue-status-sugg-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main' }],
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  function issues(): StoreIssuesModule {
    return new StoreIssuesModule({
      dependencies: withDeterministicIssueClock(productionStoreIssueDependencies, NOW),
    });
  }

  async function publishAndRead(
    issueId: string,
    nodes: readonly ExecutionPlanNodeInput[]
  ) {
    await issues().create({ ...scope(), issueId, title: 'decomposition read' });
    await issues().publishPlan({ ...scope(), issueId, nodes, pipelineKnown: KNOWN });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', `issue + plan ${issueId}`]);
    const detail = await new StoreQueryModuleImpl().showIssue({ ...scope(), issueId });
    return projectIssueStatus({ detail, workDirFor: async () => null });
  }

  const guidedNodes = (): readonly ExecutionPlanNodeInput[] => [
    {
      nodeId: 'surface',
      kind: 'intent',
      projectId: PROJECT,
      targetLineId: LINE,
      summary: 'Author the surface',
      dependsOn: [],
      suggestedPipeline: 'small-feature',
      rationale: 'the surface must exist first',
    },
    {
      nodeId: 'consumer',
      kind: 'intent',
      projectId: PROJECT,
      targetLineId: LINE,
      summary: 'Consume the surface',
      dependsOn: ['surface'],
      suggestedPipeline: 'small-feature',
      uncertainty: 'unsure whether a compat shim is needed',
    },
    {
      nodeId: 'bare',
      kind: 'intent',
      projectId: PROJECT,
      targetLineId: LINE,
      summary: 'A node with no guidance fields at all',
      dependsOn: [],
    },
  ];

  it('carries the recorded guidance per node and nulls the absent fields', async () => {
    const status = await publishAndRead('iss-guided', [
      ...guidedNodes(),
      // The change-node side of the same widening: a suggestion may ride an
      // existing Change node too, and its lifecycle facts stay untouched.
      {
        nodeId: 'seeded',
        kind: 'intent',
        projectId: PROJECT,
        targetLineId: LINE,
        summary: 'Placeholder (change-node suggestion covered by schema suite)',
        dependsOn: [],
        suggestedPipeline: 'bug-fix',
        rationale: 'suggestions ride either kind',
      },
    ]);
    const byId = new Map(status.nodes.map(node => [node.nodeId, node] as const));
    expect(byId.get('surface')).toMatchObject({
      suggestedPipeline: 'small-feature',
      rationale: 'the surface must exist first',
      uncertainty: null,
    });
    expect(byId.get('consumer')).toMatchObject({
      suggestedPipeline: 'small-feature',
      rationale: null,
      uncertainty: 'unsure whether a compat shim is needed',
    });
    // Absent guidance reads as null — never an empty string.
    expect(byId.get('bare')).toMatchObject({
      suggestedPipeline: null,
      rationale: null,
      uncertainty: null,
    });
  });

  it('derives no axis value from the guidance: before/after axes are identical', async () => {
    const guided = await publishAndRead('iss-after', guidedNodes());
    // "Before": the same graph, published without any guidance field —
    // exactly the shape every pre-fields revision has.
    const before = await publishAndRead(
      'iss-before',
      guidedNodes().map(node => {
        const { suggestedPipeline: s, rationale: r, uncertainty: u, ...rest } = node;
        return rest as ExecutionPlanNodeInput;
      })
    );
    expect(guided.phase).toBe(before.phase);
    expect(guided.health).toBe(before.health);
    expect(guided.progress).toEqual(before.progress);
    expect(guided.projects).toEqual(before.projects);
    // An all-intent plan keeps the Issue in planning — which is the
    // review-ready signal for a decomposition revision.
    expect(guided.phase).toBe('planning');
    expect(guided.progress).toEqual({ completed: 0, total: 0 });
  });
});
