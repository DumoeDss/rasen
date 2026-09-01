/**
 * `store-issue-resources` — the target-project scenarios of "A plan node's
 * target project is a planning member of the Store".
 *
 * The node's `projectId` IS its target project: no new field exists, and this
 * suite is where that existing field becomes an authoritative fact. Publication
 * through the one shared verifier refuses a knowledge-only member as a target
 * (a distinct code from the no-record refusal, because the two say different
 * true things with different repairs), holds intent nodes to the same rule,
 * and accepts a plan whose nodes span two planning members. Beside the gate:
 * the one-Change-one-primary-project rule the graph checker already enforces,
 * and retargeting as a new revision with the earlier revision's bytes pinned.
 *
 * The degradation half (a read never re-checks membership) lives with the
 * projection suites; this file is the PUBLICATION authority.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';
import {
  StoreIssueError,
  StoreIssuesModule,
  checkExecutionPlanGraph,
  normalizePlanNodes,
  productionStoreIssueDependencies,
  withDeterministicIssueClock,
} from '../../../src/core/store/issues/index.js';
import {
  StorePlanningValidationError,
} from '../../../src/core/store/planning-validation.js';

const NOW = '2026-08-07T00:00:00.000Z';
const LINE = 'main';
const PLANNING_A = 'elftia';
const PLANNING_B = 'app-b';
const KNOWLEDGE_ONLY = 'docs-side';

/** The member set every test here shares: two planning members, one knowledge-only. */
const PROJECTS = [PLANNING_A, PLANNING_B, KNOWLEDGE_ONLY];
const KNOWLEDGE_ONLY_MEMBERS = [KNOWLEDGE_ONLY];

describe('a plan node targets a planning member of the Store', () => {
  let f: StoreWorkspaceFixture;
  let scope: { store: string; startPath: string; globalDataDir: string };
  let issueUid: string;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-target-project-',
      projects: PROJECTS,
      knowledgeOnlyProjects: KNOWLEDGE_ONLY_MEMBERS,
      lines: [{ id: LINE, storeRef: 'refs/heads/main' }],
    });
    scope = { store: f.storeId, startPath: f.storeRoot, globalDataDir: f.globalDataDir };
    const created = await issues().create({ ...scope, issueId: 'targeting', title: 'x' });
    issueUid = created.identity.uid;
  });

  afterEach(() => {
    f.cleanup();
  });

  function issues(): StoreIssuesModule {
    return new StoreIssuesModule({
      dependencies: withDeterministicIssueClock(productionStoreIssueDependencies, NOW),
    });
  }

  function planPath(ordinal: string): string {
    return f.at('rasen', 'issues', issueUid, 'plans', `${ordinal}.yaml`);
  }

  const intentNode = (nodeId: string, projectId: string) => ({
    nodeId,
    kind: 'intent' as const,
    projectId,
    targetLineId: LINE,
    summary: `work for ${projectId}`,
    dependsOn: [],
  });

  /** A committed Change under `projectId`, so a change node can name it. */
  function committedChange(projectId: string, changeId: string, seed: string): string {
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId,
      targetLineId: LINE,
      changeId,
      instanceSeed: seed,
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', `land ${changeId}`]);
    return seeded.instanceId;
  }

  async function refusalFor(nodes: readonly unknown[]): Promise<StoreIssueError> {
    let thrown: unknown;
    try {
      await issues().publishPlan({
        ...scope,
        issueId: 'targeting',
        // The gate runs before any evidence read for intent nodes, and for
        // change nodes after schema normalization — either way these inputs
        // reach the verifier exactly as authored.
        nodes: nodes as never,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StoreIssueError);
    return thrown as StoreIssueError;
  }

  it('refuses a knowledge-only member as a change-node target, naming everything', async () => {
    const instanceId = committedChange(PLANNING_A, 'real-change', 'a1'.repeat(16));
    // The Change is real and committed under a planning member; the node
    // re-homes it to the knowledge-only member, which is the drift shape the
    // gate exists for. The committed-identity check would also refuse this —
    // but the planning-member gate runs FIRST, so the refusal names the role
    // fact, not the scope mismatch.
    const refusal = await refusalFor([
      {
        nodeId: 'emit',
        kind: 'change',
        projectId: KNOWLEDGE_ONLY,
        targetLineId: LINE,
        changeInstanceId: instanceId,
        dependsOn: [],
      },
    ]);

    expect(refusal.issueCode).toBe('issue_reference_target_not_planning_member');
    expect(refusal.message).toContain('emit');
    expect(refusal.message).toContain(KNOWLEDGE_ONLY);
    // The project's recorded roles, stated as recorded — both of them.
    expect(refusal.message).toContain('planning=false');
    expect(refusal.message).toContain('knowledge=true');
    // The Store's planning members, so the author can see the alternatives —
    // and the knowledge-only member is not listed among them.
    expect(refusal.message).toContain(`Planning members: ${PLANNING_B}, ${PLANNING_A}`);
    expect(refusal.diagnostic.fix).toContain('rasen store add-project');
    expect(fs.existsSync(planPath('0001'))).toBe(false);
  });

  it('refuses a knowledge-only member as an intent-node target under the same rule', async () => {
    // For an intent node the roster is the only scope fact there is — no
    // committed identity exists to disagree — so this is the purest form of
    // the gate.
    const refusal = await refusalFor([intentNode('draft-later', KNOWLEDGE_ONLY)]);

    expect(refusal.issueCode).toBe('issue_reference_target_not_planning_member');
    expect(refusal.message).toContain('draft-later');
    expect(refusal.message).toContain(KNOWLEDGE_ONLY);
    expect(refusal.message).toContain('planning=false');
    expect(refusal.diagnostic.fix).toContain('rasen store add-project');
    expect(fs.existsSync(planPath('0001'))).toBe(false);
  });

  it('still refuses a project with no membership record under the existing code', async () => {
    const refusal = await refusalFor([intentNode('ghost', 'not-a-member')]);

    // Distinct code, because it says a different true thing: no record at all,
    // not a record with the wrong role. The repair differs too.
    expect(refusal.issueCode).toBe('issue_reference_scope_conflict');
    expect(refusal.message).toContain('not-a-member');
    expect(refusal.message).toContain('no project catalog');
    expect(fs.existsSync(planPath('0001'))).toBe(false);
  });

  it('publishes a plan whose nodes span two planning members, each naming its own project', async () => {
    const instanceB = committedChange(PLANNING_B, 'b-side-change', 'b2'.repeat(16));
    const published = await issues().publishPlan({
      ...scope,
      issueId: 'targeting',
      nodes: [
        intentNode('a-work', PLANNING_A),
        {
          nodeId: 'b-work',
          kind: 'change',
          projectId: PLANNING_B,
          targetLineId: LINE,
          changeInstanceId: instanceB,
          dependsOn: [],
        },
      ],
    });

    expect(published.revision.revisionId).toBe('0001');
    const byNode = new Map(published.revision.nodes.map(node => [node.nodeId, node]));
    expect(byNode.get('a-work')).toMatchObject({ projectId: PLANNING_A });
    expect(byNode.get('b-work')).toMatchObject({ projectId: PLANNING_B });
    expect(fs.existsSync(planPath('0001'))).toBe(true);
  });

  it('refuses two nodes naming one Change instance, naming both nodes', async () => {
    const instanceId = committedChange(PLANNING_A, 'claimed-once', 'c3'.repeat(16));
    const node = {
      kind: 'change' as const,
      projectId: PLANNING_A,
      targetLineId: LINE,
      changeInstanceId: instanceId,
      dependsOn: [],
    };

    // The rule itself, pinned at the graph checker over canonicalized nodes:
    // one Change instance, one node, per revision — the construction that
    // binds a Change to one primary project.
    const violations = checkExecutionPlanGraph(
      normalizePlanNodes([
        { ...node, nodeId: 'first' },
        { ...node, nodeId: 'second' },
      ])
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('execution_plan_node_duplicate');
    expect(violations[0]?.message).toContain('first');
    expect(violations[0]?.message).toContain('second');
    expect(violations[0]?.message).toContain(instanceId);

    // And through the mutation: refused, nothing published.
    let thrown: unknown;
    try {
      await issues().publishPlan({
        ...scope,
        issueId: 'targeting',
        nodes: [
          { ...node, nodeId: 'first' },
          { ...node, nodeId: 'second' },
        ],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StorePlanningValidationError);
    expect((thrown as Error).message).toContain('first');
    expect(fs.existsSync(planPath('0001'))).toBe(false);
  });

  it('retargets a node only as a new revision, leaving the earlier bytes untouched', async () => {
    await issues().publishPlan({
      ...scope,
      issueId: 'targeting',
      nodes: [intentNode('movable', PLANNING_A)],
    });
    const firstBytes = fs.readFileSync(planPath('0001'));
    const firstDigest = createHash('sha256').update(firstBytes).digest('hex');

    const second = await issues().publishPlan({
      ...scope,
      issueId: 'targeting',
      nodes: [intentNode('movable', PLANNING_B)],
    });

    expect(second.revision.revisionId).toBe('0002');
    expect(second.revision.supersedes).toBe('0001');
    expect(second.revision.nodes[0]).toMatchObject({ nodeId: 'movable', projectId: PLANNING_B });
    // The earlier revision still names the previous project, byte for byte.
    const rereadBytes = fs.readFileSync(planPath('0001'));
    expect(createHash('sha256').update(rereadBytes).digest('hex')).toBe(firstDigest);
    expect(rereadBytes.toString('utf8')).toContain(`projectId: ${PLANNING_A}`);
  });
});
