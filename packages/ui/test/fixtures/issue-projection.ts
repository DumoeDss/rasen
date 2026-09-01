import type {
  StoreIssueAttentionResponse,
  StoreIssueProjectionResponse,
  StoreIssueProjectionsResponse,
} from '../../src/api/types.js';

/**
 * Issue projection fixtures (issue-read-surface). `satisfies` against the
 * mirrored wire response types is the `tsc` drift tripwire, same convention as
 * every other fixture in this directory.
 *
 * `realIssueProjectionFixture` is DISTILLED FROM A REAL PAYLOAD — the
 * `issue-registry` Store's `issue-autodecompose-uplift`, captured over the real
 * `/api/v1/stores/issue-projection` path and filed under the change's
 * `evidence/dogfood-real-issue-projection.json`. Its long evidence inventories
 * and prose are trimmed; every field that remains is the value the real read
 * reported, so this fixture is a truthful crossing from the running system into
 * typed test data rather than a shape invented to make a test pass.
 *
 * The board fixture adds the shapes the real Store (five accepted Issues, zero
 * attention) cannot show: an Issue in every one of the five phase lanes, a
 * second member project, an unreadable record, a divergence, an uncommitted
 * record, and a payload reporting problems and unsearched refs.
 */

const PROJECT_A = 'e2ee72ed-04a1-4395-86aa-7e77d2b83ec7';
const PROJECT_B = '11111111-2222-3333-4444-555555555555';

function legacyIdentity(uid: string, key: string, legacyId: string) {
  return {
    uid,
    key,
    slug: legacyId,
    aliases: [{ kind: 'legacy-id' as const, value: legacyId }],
  };
}

export const ISSUE_IDENTITIES = {
  ready: legacyIdentity('10000000-0000-4000-8000-000000000001', 'ISS-0000000000000001', 'issue-ready'),
  active: legacyIdentity('10000000-0000-4000-8000-000000000002', 'ISS-0000000000000002', 'issue-active'),
  review: legacyIdentity('10000000-0000-4000-8000-000000000003', 'ISS-0000000000000003', 'issue-review'),
  auto: legacyIdentity('10000000-0000-4000-8000-000000000004', 'ISS-0000000000000004', 'issue-autodecompose-uplift'),
  broken: legacyIdentity('10000000-0000-4000-8000-000000000005', 'ISS-0000000000000005', 'broken-issue'),
} as const;

/** The one distilled real read — an accepted Issue, Done, with a revision delta. */
export const realIssueProjectionFixture = {
  issue: {
    identity: ISSUE_IDENTITIES.auto,
    issueId: ISSUE_IDENTITIES.auto.uid,
    record: {
      version: 1,
      id: 'issue-autodecompose-uplift',
      title: 'Issue layer Phase 4: auto-decompose uplift (reviewable decomposition dispatch)',
      state: 'resolved',
      reason: null,
      createdAt: '2026-08-21T08:10:49.108Z',
    },
    diagnostic: null,
    divergence: null,
    revisionIds: ['0001', '0002', '0003', '0004'],
    latestRevisionId: '0004',
    refs: ['refs/heads/main'],
    uncommitted: false,
  },
  plan: {
    unsearchedRefs: [],
    problems: [],
    complete: true,
    issueId: ISSUE_IDENTITIES.auto.uid,
    revisionId: '0004',
    revision: {
      version: 1,
      issueId: 'issue-autodecompose-uplift',
      revisionId: '0004',
      supersedes: '0003',
      createdAt: '2026-08-21T19:02:11.000Z',
      contentSha256: '0'.repeat(64),
      nodes: [
        {
          nodeId: 'issue-autodecompose-graph',
          kind: 'change',
          projectId: PROJECT_A,
          targetLineId: 'line-0.2',
          dependsOn: [],
          changeInstanceId: 'ci_1',
        },
        {
          nodeId: 'issue-autodecompose-review-flow',
          kind: 'change',
          projectId: PROJECT_A,
          targetLineId: 'line-0.2',
          dependsOn: ['issue-autodecompose-graph'],
          changeInstanceId: 'ci_2',
        },
      ],
    },
    diagnostic: null,
    readiness: { nodes: [], readyToResolve: true },
  },
  status: {
    phase: 'done',
    health: 'healthy',
    progress: { completed: 2, total: 2 },
    nodes: [
      {
        nodeId: 'issue-autodecompose-graph',
        kind: 'change',
        alias: '2026-08-21-issue-autodecompose-graph',
        observation: 'finalized',
        diagnostic: 'finalized on a legacy archive record (no v2 outcome was ever recorded)',
        runStatePath: null,
        locatedBy: null,
        attribution: { pipeline: null, sessions: [], evidenceLocator: null },
        projectId: PROJECT_A,
        targetLineId: 'line-0.2',
        lifecycle: 'required',
        reason: null,
        suggestedPipeline: 'small-feature',
        rationale: "promoted from intent to Change now that the child's committed Store instance exists",
        uncertainty: null,
        blockedBy: [],
        delivery: {
          state: 'record',
          basis: 'legacy',
          archivedAt: '2026-08-21T12:13:49.958Z',
          codeCommit: '6b00f24da260b510d43ff0ceeef03aa7c895bc35',
          planningBranch: 'feat/issue-phase4',
          outcome: null,
          evidence: [
            {
              path: 'evidence/dogfood-issue3-create.json',
              sha256: '982c2a720a34fcc27dfc82f6497435537d63a8d501b08a1764c3b36782dccde8',
            },
          ],
          missing: ['verification-report'],
          entryName: '2026-08-21-issue-autodecompose-graph',
          foundAtRef: 'refs/heads/main',
          blobPath: 'rasen/projects/rasen/archive/2026-08-21-issue-autodecompose-graph',
        },
      },
      {
        nodeId: 'issue-autodecompose-review-flow',
        kind: 'change',
        alias: '2026-08-21-issue-autodecompose-review-flow',
        observation: 'finalized',
        diagnostic: null,
        runStatePath: null,
        locatedBy: null,
        attribution: {
          pipeline: 'small-feature',
          sessions: [
            { stageId: 'apply', role: 'implementer', runtime: 'claude', sessionId: 'sess_1' },
          ],
          evidenceLocator: 'rasen/changes/issue-autodecompose-review-flow/evidence',
        },
        projectId: PROJECT_A,
        targetLineId: 'line-0.2',
        lifecycle: 'required',
        reason: null,
        suggestedPipeline: null,
        rationale: null,
        uncertainty: null,
        blockedBy: [],
        delivery: { state: 'not-archived' },
      },
    ],
    delta: {
      revisionId: '0004',
      supersedes: '0003',
      added: [],
      removed: [],
      retargeted: [],
      edgeChanges: [],
      lifecycleChanges: [],
      suggestionChanges: [],
    },
    projects: [
      {
        projectId: PROJECT_A,
        alias: 'rasen',
        nodeIds: ['issue-autodecompose-graph', 'issue-autodecompose-review-flow'],
        progress: { completed: 2, total: 2 },
      },
    ],
    problems: [],
    runStateVisibility: {
      kind: 'execution-root',
      executionRoot: 'E:\\repos\\rasen',
    },
    complete: true,
    acceptance: {
      conditions: {
        revision: {
          version: 1,
          issueId: 'issue-autodecompose-uplift',
          revisionId: '0001',
          supersedes: null,
          createdAt: '2026-08-21T20:51:27.025Z',
          contentSha256: '4d5fb462b904318820b4c4809a688d575eee6933e1c37d14136b7977f29b431a',
          conditions: [
            {
              id: 'boundary-crossed-truthfully',
              requirement: 'The auto-decompose fail-close resolved as a truthful verdict, not faked support.',
              verification: 'reviewer confirmed the registry diff byte-identical',
            },
          ],
        },
        revisionId: '0001',
        diagnostic: null,
        path: null,
      },
      gate: {
        eligible: false,
        refusalCode: 'issue_accept_already_accepted',
        blockers: [],
        message: 'the Issue already carries an acceptance record; an acceptance is never rewritten.',
        exclusions: [],
        optionalNodes: [],
      },
      record: {
        version: 1,
        issueId: 'issue-autodecompose-uplift',
        acceptedAt: '2026-08-21T20:51:33.888Z',
        conditionsRevisionId: '0001',
        conditionsSha256: '4d5fb462b904318820b4c4809a688d575eee6933e1c37d14136b7977f29b431a',
        gate: { completed: 2, total: 2, health: 'waiting-human', problemsStanding: 0 },
        note: 'Phase 4 auto-decompose uplift verified.',
        contentSha256: '1'.repeat(64),
      },
    },
  },
  delivery: {
    revisionId: '0004',
    entries: [
      {
        nodeId: 'issue-autodecompose-graph',
        alias: '2026-08-21-issue-autodecompose-graph',
        projectId: PROJECT_A,
        lifecycle: 'required',
        observation: 'finalized',
        delivery: { state: 'not-archived' },
      },
    ],
    counts: { record: 2, 'no-record': 0, 'not-archived': 0, unreadable: 0, unattributed: 0 },
  },
  review: {
    issueId: ISSUE_IDENTITIES.auto.uid,
    revisionId: '0004',
    determination: {
      kind: 'accepted',
      acceptedAt: '2026-08-21T20:51:33.888Z',
      conditionsRevisionId: '0001',
    },
    threads: [
      {
        kind: 'evidence-missing',
        nodeId: 'issue-autodecompose-graph',
        names: ['verification-report'],
      },
    ],
    verification: {
      progress: { completed: 2, total: 2 },
      delivery: { record: 2, 'no-record': 0, 'not-archived': 0, unreadable: 0, unattributed: 0 },
    },
  },
  complete: true,
  unsearchedRefs: [],
  problems: [],
} satisfies StoreIssueProjectionResponse;

/** A dual-reader projection whose Issue-owned durable resources use version 2. */
export const v2IssueProjectionFixture = {
  ...realIssueProjectionFixture,
  issue: {
    ...realIssueProjectionFixture.issue,
    record: {
      version: 2,
      identity: ISSUE_IDENTITIES.auto,
      title: realIssueProjectionFixture.issue.record.title,
      state: realIssueProjectionFixture.issue.record.state,
      reason: realIssueProjectionFixture.issue.record.reason,
      createdAt: realIssueProjectionFixture.issue.record.createdAt,
    },
  },
  plan: {
    ...realIssueProjectionFixture.plan!,
    revision: {
      version: 2,
      issueUid: ISSUE_IDENTITIES.auto.uid,
      revisionId: realIssueProjectionFixture.plan!.revision!.revisionId,
      supersedes: realIssueProjectionFixture.plan!.revision!.supersedes,
      createdAt: realIssueProjectionFixture.plan!.revision!.createdAt,
      contentSha256: realIssueProjectionFixture.plan!.revision!.contentSha256,
      nodes: realIssueProjectionFixture.plan!.revision!.nodes,
    },
  },
  status: {
    ...realIssueProjectionFixture.status,
    acceptance: {
      ...realIssueProjectionFixture.status.acceptance!,
      conditions: {
        ...realIssueProjectionFixture.status.acceptance!.conditions,
        revision: {
          version: 2,
          issueUid: ISSUE_IDENTITIES.auto.uid,
          revisionId: realIssueProjectionFixture.status.acceptance!.conditions.revision!.revisionId,
          supersedes: realIssueProjectionFixture.status.acceptance!.conditions.revision!.supersedes,
          createdAt: realIssueProjectionFixture.status.acceptance!.conditions.revision!.createdAt,
          contentSha256: realIssueProjectionFixture.status.acceptance!.conditions.revision!.contentSha256,
          conditions: realIssueProjectionFixture.status.acceptance!.conditions.revision!.conditions,
        },
      },
      record: {
        version: 2,
        issueUid: ISSUE_IDENTITIES.auto.uid,
        acceptedAt: realIssueProjectionFixture.status.acceptance!.record!.acceptedAt,
        conditionsRevisionId: realIssueProjectionFixture.status.acceptance!.record!.conditionsRevisionId,
        conditionsSha256: realIssueProjectionFixture.status.acceptance!.record!.conditionsSha256,
        gate: realIssueProjectionFixture.status.acceptance!.record!.gate,
        note: realIssueProjectionFixture.status.acceptance!.record!.note,
        contentSha256: realIssueProjectionFixture.status.acceptance!.record!.contentSha256,
      },
    },
  },
} satisfies StoreIssueProjectionResponse;

/**
 * A second detail read: an Issue whose plan did not read back. The Detail must
 * still render what derived and present the problem beside it.
 */
export const unreadableIssueProjectionFixture = {
  issue: {
    identity: ISSUE_IDENTITIES.broken,
    issueId: ISSUE_IDENTITIES.broken.uid,
    record: {
      version: 1,
      id: 'broken-issue',
      title: 'Broken Issue',
      state: 'open',
      reason: null,
      createdAt: '2026-08-22T00:00:00.000Z',
    },
    diagnostic: null,
    divergence: null,
    revisionIds: ['0001'],
    latestRevisionId: '0001',
    refs: ['refs/heads/main'],
    uncommitted: false,
  },
  plan: {
    unsearchedRefs: [],
    problems: [],
    complete: false,
    issueId: ISSUE_IDENTITIES.broken.uid,
    revisionId: '0001',
    revision: null,
    diagnostic: "revision '0001' does not parse: contentSha256 is required",
    readiness: { nodes: [], readyToResolve: false },
  },
  status: {
    phase: 'planning',
    health: 'healthy',
    progress: null,
    nodes: [],
    delta: null,
    projects: [],
    problems: [
      {
        kind: 'unreadable-plan',
        node: null,
        ref: '0001',
        reason: "revision '0001' does not parse: contentSha256 is required",
      },
    ],
    runStateVisibility: { kind: 'none' },
    complete: false,
    acceptance: null,
  },
  delivery: null,
  review: {
    issueId: ISSUE_IDENTITIES.broken.uid,
    revisionId: '0001',
    determination: { kind: 'no-plan' },
    threads: [],
    verification: { progress: null, delivery: null },
  },
  complete: false,
  unsearchedRefs: [],
  problems: [],
} satisfies StoreIssueProjectionResponse;

/**
 * The Board's list read: one Issue in each of the five phase lanes, plus the
 * incompleteness shapes the spec insists stay visible.
 */
export const issueProjectionsFixture = {
  unsearchedRefs: [
    { targetLineId: 'line-0.1', storeRef: 'refs/heads/legacy', reason: 'ref not found' },
  ],
  problems: [
    {
      kind: 'issue',
      itemId: 'issue-planning',
      storeRef: 'refs/heads/main',
      path: 'rasen/issues/issue-planning/issue.yaml',
      reason: 'record does not parse',
    },
  ],
  complete: false,
  issues: [
    {
      identity: null,
      issueId: 'issue-planning',
      record: null,
      diagnostic: 'record does not parse',
      divergence: null,
      revisionIds: [],
      latestRevisionId: null,
      refs: ['refs/heads/main'],
      uncommitted: false,
      status: {
        phase: 'planning',
        health: 'healthy',
        progress: null,
        nodes: [],
        delta: null,
        projects: [],
        problems: [],
        runStateVisibility: { kind: 'none' },
        complete: false,
        acceptance: null,
      },
    },
    {
      identity: ISSUE_IDENTITIES.ready,
      issueId: ISSUE_IDENTITIES.ready.uid,
      record: {
        version: 1,
        id: 'issue-ready',
        title: 'Ready Issue',
        state: 'open',
        reason: null,
        createdAt: '2026-08-20T00:00:00.000Z',
      },
      diagnostic: null,
      divergence: null,
      revisionIds: ['0001'],
      latestRevisionId: '0001',
      refs: ['refs/heads/main'],
      uncommitted: true,
      status: {
        phase: 'ready',
        health: 'healthy',
        progress: { completed: 0, total: 3 },
        nodes: [],
        delta: null,
        projects: [
          { projectId: PROJECT_A, alias: 'rasen', nodeIds: ['n1'], progress: { completed: 0, total: 3 } },
        ],
        problems: [],
        runStateVisibility: { kind: 'execution-root', executionRoot: 'E:\\repos\\rasen' },
        complete: true,
        acceptance: null,
      },
    },
    {
      identity: ISSUE_IDENTITIES.active,
      issueId: ISSUE_IDENTITIES.active.uid,
      record: {
        version: 1,
        id: 'issue-active',
        title: 'Active Issue',
        state: 'open',
        reason: null,
        createdAt: '2026-08-20T00:00:00.000Z',
      },
      diagnostic: null,
      divergence: null,
      revisionIds: ['0001'],
      latestRevisionId: '0001',
      refs: ['refs/heads/main'],
      uncommitted: false,
      status: {
        phase: 'active',
        health: 'failed',
        progress: { completed: 1, total: 4 },
        nodes: [],
        delta: null,
        projects: [
          { projectId: PROJECT_B, alias: null, nodeIds: ['n2'], progress: { completed: 1, total: 4 } },
        ],
        problems: [],
        runStateVisibility: { kind: 'execution-root', executionRoot: 'E:\\repos\\rasen' },
        complete: true,
        acceptance: null,
      },
    },
    {
      identity: null,
      issueId: ISSUE_IDENTITIES.review.uid,
      record: {
        version: 1,
        id: 'issue-review',
        title: 'Review Issue',
        state: 'open',
        reason: null,
        createdAt: '2026-08-20T00:00:00.000Z',
      },
      diagnostic: null,
      divergence: { copies: [] },
      revisionIds: ['0001'],
      latestRevisionId: '0001',
      refs: ['refs/heads/main', 'refs/heads/release'],
      uncommitted: false,
      status: {
        phase: 'review',
        health: 'waiting-human',
        progress: { completed: 2, total: 2 },
        nodes: [],
        delta: null,
        projects: [
          { projectId: PROJECT_A, alias: 'rasen', nodeIds: ['n3'], progress: { completed: 2, total: 2 } },
        ],
        problems: [],
        runStateVisibility: { kind: 'execution-root', executionRoot: 'E:\\repos\\rasen' },
        complete: true,
        acceptance: null,
      },
    },
    {
      identity: ISSUE_IDENTITIES.auto,
      issueId: ISSUE_IDENTITIES.auto.uid,
      record: realIssueProjectionFixture.issue.record,
      diagnostic: null,
      divergence: null,
      revisionIds: ['0001', '0002', '0003', '0004'],
      latestRevisionId: '0004',
      refs: ['refs/heads/main'],
      uncommitted: false,
      status: realIssueProjectionFixture.status,
    },
  ],
} satisfies StoreIssueProjectionsResponse;

/** The fleet scan: fail-first order across Issues, exactly as the server sends it. */
export const issueAttentionFixture = {
  narrowed: false,
  issueId: null,
  scannedCount: 5,
  scanned: [
    { issueId: 'issue-planning', phase: 'planning', health: 'healthy', itemCount: 0, runStateVisibility: { kind: 'none' } },
    { issueId: ISSUE_IDENTITIES.ready.uid, phase: 'ready', health: 'healthy', itemCount: 0, runStateVisibility: { kind: 'execution-root', executionRoot: 'E:\\repos\\rasen' } },
    { issueId: ISSUE_IDENTITIES.active.uid, phase: 'active', health: 'failed', itemCount: 2, runStateVisibility: { kind: 'execution-root', executionRoot: 'E:\\repos\\rasen' } },
    { issueId: ISSUE_IDENTITIES.review.uid, phase: 'review', health: 'waiting-human', itemCount: 1, runStateVisibility: { kind: 'execution-root', executionRoot: 'E:\\repos\\rasen' } },
    { issueId: ISSUE_IDENTITIES.auto.uid, phase: 'done', health: 'healthy', itemCount: 0, runStateVisibility: { kind: 'execution-root', executionRoot: 'E:\\repos\\rasen' } },
  ],
  items: [
    {
      issueId: ISSUE_IDENTITIES.active.uid,
      phase: 'active',
      health: 'failed',
      nodeId: 'n2',
      alias: 'boom',
      kind: 'failure',
      diagnostic: 'stage apply escalated',
    },
    {
      issueId: ISSUE_IDENTITIES.active.uid,
      phase: 'active',
      health: 'failed',
      nodeId: 'n2b',
      alias: null,
      kind: 'blocked-behind',
      blockers: [{ nodeId: 'n2', projectId: PROJECT_B, state: 'failed' }],
    },
    {
      issueId: ISSUE_IDENTITIES.review.uid,
      phase: 'review',
      health: 'waiting-human',
      nodeId: null,
      alias: null,
      kind: 'acceptance-awaiting',
      gate: null,
    },
  ],
  counts: { failure: 1, 'blocked-behind': 1, 'waiting-human': 0, 'acceptance-awaiting': 1, problem: 0 },
  total: 3,
  unsearchedRefs: [],
  complete: true,
} satisfies StoreIssueAttentionResponse;

/** The narrowed scan the Detail fetches for one Issue. */
export const issueAttentionNarrowedFixture = {
  narrowed: true,
  issueId: ISSUE_IDENTITIES.auto.uid,
  scannedCount: 1,
  scanned: [
    {
      issueId: ISSUE_IDENTITIES.auto.uid,
      phase: 'done',
      health: 'healthy',
      itemCount: 0,
      runStateVisibility: { kind: 'execution-root', executionRoot: 'E:\\repos\\rasen' },
    },
  ],
  items: [],
  counts: { failure: 0, 'blocked-behind': 0, 'waiting-human': 0, 'acceptance-awaiting': 0, problem: 0 },
  total: 0,
  unsearchedRefs: [],
  complete: true,
} satisfies StoreIssueAttentionResponse;

/** The narrowed scan for the Issue whose plan did not read back. */
export const issueAttentionUnreadableFixture = {
  narrowed: true,
  issueId: ISSUE_IDENTITIES.broken.uid,
  scannedCount: 1,
  scanned: [
    {
      issueId: ISSUE_IDENTITIES.broken.uid,
      phase: 'planning',
      health: 'healthy',
      itemCount: 1,
      runStateVisibility: { kind: 'none' },
    },
  ],
  items: [
    {
      issueId: ISSUE_IDENTITIES.broken.uid,
      phase: 'planning',
      health: 'healthy',
      nodeId: null,
      alias: null,
      kind: 'problem',
      problem: {
        kind: 'unreadable-plan',
        node: null,
        ref: '0001',
        reason: "revision '0001' does not parse: contentSha256 is required",
      },
    },
  ],
  counts: { failure: 0, 'blocked-behind': 0, 'waiting-human': 0, 'acceptance-awaiting': 0, problem: 1 },
  total: 1,
  unsearchedRefs: [],
  complete: false,
} satisfies StoreIssueAttentionResponse;
