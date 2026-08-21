/**
 * `issue-autodecompose-review-flow` task 3.1 — the confirm composition over
 * purely SYNTHETIC `IssueDetail` + `IssueStatus` + injected launch contexts,
 * mirroring the binding suite's fixture style. The contracts are resolved by
 * the SAME `resolveIssueLaunchBinding`, so what these units pin is the
 * plan-scope composition: the launchable set, the pending-Change report, the
 * waiting partition, the unprepared report, and the two refusals.
 */
import { describe, expect, it } from 'vitest';

import { composeIssueConfirm } from '../../../src/core/issue-execution/index.js';
import type {
  IssueLaunchContextFor,
} from '../../../src/core/issue-execution/index.js';
import type { IssueStatus, IssueNodeStatus } from '../../../src/core/issue-status/index.js';
import type { IssueDetail, ResolvedPlanNode } from '../../../src/core/store/query/index.js';
import type { ExecutionPlanNode } from '../../../src/core/store/issues/index.js';

const NOW = '2026-08-17T00:00:00.000Z';
const ISSUE = 'iss-confirm';
const PROJECT = 'app-a';
const LINE = 'main';

function resolvedNode(node: ExecutionPlanNode): ResolvedPlanNode {
  return {
    node,
    resolution: {
      status: node.kind === 'change' ? 'resolved' : 'not-created',
      claimants:
        node.kind === 'change'
          ? [
              {
                changeId: node.changeAlias ?? node.nodeId,
                projectId: node.projectId,
                targetLineId: node.targetLineId,
                foundAtRef: 'refs/heads/main',
                archived: false,
              },
            ]
          : [],
      searchedRefs: ['refs/heads/main'],
      localLocator: null,
      outcome: null,
      archived: false,
    },
    readiness: 'not-started',
    blockedBy: [],
  };
}

function detailFor(
  nodes: readonly ExecutionPlanNode[],
  overrides: {
    resolutions?: Partial<Record<string, ResolvedPlanNode['resolution']>>;
  } = {}
): IssueDetail {
  return {
    issue: {
      issueId: ISSUE,
      record: { version: 1, id: ISSUE, title: 'Confirm unit', state: 'open', reason: null, createdAt: NOW },
      diagnostic: null,
      divergence: null,
      revisionIds: ['0001'],
      latestRevisionId: '0001',
      refs: [],
      uncommitted: false,
    },
    plan: {
      issueId: ISSUE,
      revisionId: '0001',
      revision: {
        version: 1,
        issueId: ISSUE,
        revisionId: '0001',
        supersedes: null,
        createdAt: NOW,
        contentSha256: 'a'.repeat(64),
        nodes,
      },
      diagnostic: null,
      readiness: {
        nodes: nodes.map(node => {
          const override = overrides.resolutions?.[node.nodeId];
          return { ...resolvedNode(node), ...(override === undefined ? {} : { resolution: override }) };
        }),
        readyToResolve: false,
      },
      unsearchedRefs: [],
      problems: [],
      complete: true,
    },
    unsearchedRefs: [],
    problems: [],
    complete: true,
  };
}

function nodeStatus(
  nodeId: string,
  observation: IssueNodeStatus['observation'],
  extra: Partial<Pick<IssueNodeStatus, 'kind' | 'projectId' | 'lifecycle' | 'blockedBy'>> = {}
): IssueNodeStatus {
  return {
    nodeId,
    kind: extra.kind ?? 'change',
    projectId: extra.projectId ?? PROJECT,
    targetLineId: LINE,
    lifecycle: extra.lifecycle ?? 'required',
    reason: null,
    suggestedPipeline: null,
    rationale: null,
    uncertainty: null,
    alias: null,
    observation,
    blockedBy: extra.blockedBy ?? [],
    diagnostic: null,
    runStatePath: null,
    locatedBy: null,
    attribution: { pipeline: null, sessions: [], evidenceLocator: null },
  };
}

function statusFor(nodes: readonly IssueNodeStatus[]): IssueStatus {
  return {
    phase: 'ready',
    health: 'healthy',
    progress: { completed: 0, total: 0 },
    nodes,
    delta: null,
    projects: [],
    problems: [],
    runStateVisibility: { kind: 'none' },
    complete: true,
    acceptance: null,
  };
}

const LAUNCH_OK: IssueLaunchContextFor = async projectId => ({
  ok: true,
  context: {
    cwd: `C:\\checkout-${projectId}`,
    attachedRoots: ['C:\\store-root'],
    execution: { kind: 'project', projectId, root: `C:\\checkout-${projectId}` },
  },
});

const LAUNCH_NOT_FOUND: IssueLaunchContextFor = async () => ({
  ok: false,
  status: 404,
  code: 'execution_not_found',
  message: `No registered project or linked worktree matches "${PROJECT}".`,
});

const UNRESOLVED = {
  status: 'unresolved' as const,
  claimants: [],
  searchedRefs: ['refs/heads/main'],
  localLocator: null,
  outcome: null,
  archived: false,
};

describe('composeIssueConfirm', () => {
  it('reports the launchable contract set and the pending intent work', async () => {
    const nodes: readonly ExecutionPlanNode[] = [
      {
        nodeId: 'g-001',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: 'ci:aaa',
        changeAlias: 'child-a',
        dependsOn: [],
        suggestedPipeline: 'small-feature',
      },
      {
        nodeId: 'i-001',
        kind: 'intent',
        projectId: PROJECT,
        targetLineId: LINE,
        summary: 'docs for the widget',
        dependsOn: [],
        suggestedPipeline: 'small-feature',
        rationale: 'docs follow the code',
      },
    ];
    const result = await composeIssueConfirm({
      detail: detailFor(nodes),
      status: statusFor([
        nodeStatus('g-001', 'not-started'),
        nodeStatus('i-001', 'not-started', { kind: 'intent' }),
      ]),
      workspaceEntries: [],
      launchContextFor: LAUNCH_OK,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.revisionId).toBe('0001');
    expect(result.report.contracts).toHaveLength(1);
    expect(result.report.contracts[0]).toMatchObject({
      nodeId: 'g-001',
      mode: 'fresh',
      pipeline: 'small-feature',
      pipelineSource: 'suggestion',
    });
    expect(result.report.pendingChanges).toEqual([
      {
        nodeId: 'i-001',
        projectId: PROJECT,
        targetLineId: LINE,
        summary: 'docs for the widget',
        suggestedPipeline: 'small-feature',
        lifecycle: 'required',
      },
    ]);
    expect(result.report.waiting).toEqual([]);
    expect(result.report.unprepared).toEqual([]);
  });

  it('reports a wanted node waiting on dependency work instead of a contract', async () => {
    const nodes: readonly ExecutionPlanNode[] = [
      {
        nodeId: 'g-001',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: 'ci:aaa',
        changeAlias: 'child-a',
        dependsOn: [],
      },
      {
        nodeId: 'g-002',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: 'ci:bbb',
        changeAlias: 'child-b',
        dependsOn: ['g-001'],
      },
    ];
    const result = await composeIssueConfirm({
      detail: detailFor(nodes),
      status: statusFor([
        nodeStatus('g-001', 'in-flight'),
        // The dependency facts in the shape the projection derives — the
        // in-flight dependency is listed, so g-002 sits outside the ready set.
        nodeStatus('g-002', 'not-started', {
          blockedBy: [{ nodeId: 'g-001', projectId: PROJECT, observation: 'in-flight' }],
        }),
      ]),
      workspaceEntries: [],
      launchContextFor: LAUNCH_OK,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // g-001 is already running: its resume-oriented contract is part of the
    // launchable set; g-002 waits and says on what.
    expect(result.report.contracts.map(binding => binding.nodeId)).toEqual(['g-001']);
    expect(result.report.waiting).toHaveLength(1);
    expect(result.report.waiting[0]?.nodeId).toBe('g-002');
    expect(result.report.waiting[0]?.reason).toContain('g-001@app-a (in-flight)');
  });

  it('reports an unprepared frontier node with its preparation instead of refusing', async () => {
    const nodes: readonly ExecutionPlanNode[] = [
      {
        nodeId: 'g-001',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: 'ci:aaa',
        changeAlias: 'child-a',
        dependsOn: [],
      },
    ];
    const result = await composeIssueConfirm({
      detail: detailFor(nodes),
      status: statusFor([nodeStatus('g-001', 'not-started')]),
      workspaceEntries: [],
      launchContextFor: LAUNCH_NOT_FOUND,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.contracts).toEqual([]);
    expect(result.report.unprepared).toHaveLength(1);
    expect(result.report.unprepared[0]?.nodeId).toBe('g-001');
    expect(result.report.unprepared[0]?.preparation).toContain(
      'rasen store workspace plan --existing-change'
    );
  });

  it('never reports cancelled or superseded work in any category', async () => {
    const nodes: readonly ExecutionPlanNode[] = [
      {
        nodeId: 'g-live',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: 'ci:aaa',
        changeAlias: 'child-a',
        dependsOn: [],
      },
      {
        nodeId: 'g-cut',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: 'ci:ddd',
        changeAlias: 'child-cut',
        lifecycle: 'cancelled',
        reason: 'descoped',
        dependsOn: [],
      },
    ];
    const result = await composeIssueConfirm({
      detail: detailFor(nodes),
      status: statusFor([
        nodeStatus('g-live', 'not-started'),
        nodeStatus('g-cut', 'not-started', { lifecycle: 'cancelled' }),
      ]),
      workspaceEntries: [],
      launchContextFor: LAUNCH_OK,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const named = [
      ...result.report.contracts.map(binding => binding.nodeId),
      ...result.report.pendingChanges.map(pending => pending.nodeId),
      ...result.report.waiting.map(waiting => waiting.nodeId),
      ...result.report.unprepared.map(entry => entry.nodeId),
    ];
    expect(named).toEqual(['g-live']);
  });

  it('refuses an Issue with no readable revision toward planning', async () => {
    const detail = detailFor([]);
    const result = await composeIssueConfirm({
      detail: { ...detail, plan: null },
      status: statusFor([]),
      workspaceEntries: [],
      launchContextFor: LAUNCH_OK,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('issue_confirm_requires_plan');
    expect(result.refusal.message).toContain('planning');
  });

  it('refuses a named revision that does not read back, naming it and the readable range', async () => {
    // The degraded resolveExecutionPlan shape for an unknown ordinal: the
    // requested id is echoed, the revision is null, and the Issue summary
    // still reports its published revisions (review round-1 Minor-1).
    const detail = detailFor([]);
    const result = await composeIssueConfirm({
      detail: {
        issue: {
          ...detail.issue,
          revisionIds: ['0001', '0002', '0003'],
          latestRevisionId: '0003',
        },
        plan: {
          issueId: detail.issue.issueId,
          revisionId: '9999',
          revision: null,
          diagnostic: 'no readable copy',
          readiness: { nodes: [], readyToResolve: false },
          unsearchedRefs: [],
          problems: [],
          complete: true,
        },
        unsearchedRefs: [],
        problems: [],
        complete: true,
      },
      status: statusFor([]),
      workspaceEntries: [],
      launchContextFor: LAUNCH_OK,
      requestedRevisionId: '9999',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('issue_confirm_revision_unreadable');
    expect(result.refusal.message).toContain("'9999'");
    expect(result.refusal.message).toContain('0001–0003');
    expect(result.refusal.message).toContain('latest 0003');
    // The advice points at the ordinals, never at publishing.
    expect(result.refusal.message).not.toContain('planning phase');
  });

  it('keeps the requires-plan refusal when a named revision misses an Issue with no revisions', async () => {
    const detail = detailFor([]);
    const result = await composeIssueConfirm({
      detail: {
        ...detail,
        issue: { ...detail.issue, revisionIds: [], latestRevisionId: null },
        plan: null,
      },
      status: statusFor([]),
      workspaceEntries: [],
      launchContextFor: LAUNCH_OK,
      requestedRevisionId: '9999',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('issue_confirm_requires_plan');
    expect(result.refusal.message).toContain('planning');
  });

  it('refuses a revision whose Change reference did not verify, naming the node', async () => {
    const nodes: readonly ExecutionPlanNode[] = [
      {
        nodeId: 'g-broken',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: 'ci:missing',
        changeAlias: 'child-broken',
        dependsOn: [],
      },
    ];
    const result = await composeIssueConfirm({
      detail: detailFor(nodes, { resolutions: { 'g-broken': UNRESOLVED } }),
      status: statusFor([nodeStatus('g-broken', 'unknown', { })]),
      workspaceEntries: [],
      launchContextFor: LAUNCH_OK,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('issue_confirm_reference_unresolved');
    expect(result.refusal.message).toContain('g-broken');
    expect(result.refusal.message).toContain('ci:missing');
  });

  it('carries an optional intent node in the pending report with its lifecycle', async () => {
    const nodes: readonly ExecutionPlanNode[] = [
      {
        nodeId: 'i-opt',
        kind: 'intent',
        projectId: PROJECT,
        targetLineId: LINE,
        summary: 'optional polish',
        lifecycle: 'optional',
        dependsOn: [],
        suggestedPipeline: 'small-feature',
        rationale: 'nice to have',
      },
    ];
    const result = await composeIssueConfirm({
      detail: detailFor(nodes),
      status: statusFor([nodeStatus('i-opt', 'not-started', { kind: 'intent' })]),
      workspaceEntries: [],
      launchContextFor: LAUNCH_OK,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.pendingChanges).toEqual([
      {
        nodeId: 'i-opt',
        projectId: PROJECT,
        targetLineId: LINE,
        summary: 'optional polish',
        suggestedPipeline: 'small-feature',
        lifecycle: 'optional',
      },
    ]);
  });
});
