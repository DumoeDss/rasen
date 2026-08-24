import type {
  StoreChangesResponse,
  StoreChangeIssueLinksResponse,
  StoreIssueDetailResponse,
  StoreIssuesResponse,
  StoreProjectsResponse,
  StoreTargetLinesResponse,
} from '../../src/api/types.js';

/**
 * Store aggregate fixtures (`store-issue-resources` board-ui spec). `satisfies`
 * against the mirrored wire response types is the `tsc` drift tripwire, same
 * convention as every other fixture in this directory.
 */

/**
 * Grouped Changes: the SAME Change alias (`add-thing`) under two different
 * projects (board-ui requirement 1's exact scenario — two board entries, not
 * one), plus a third group (`proj_a`/`release-1`) with zero Changes, to prove
 * an empty group is rendered rather than hidden.
 */
export const storeChangesFixture = {
  unsearchedRefs: [],
  problems: [],
  complete: true,
  groups: [
    {
      projectId: 'proj_a',
      targetLineId: 'main',
      active: [
        {
          changeId: 'add-thing',
          changeInstanceId: 'chg_1',
          projectId: 'proj_a',
          targetLineId: 'main',
          foundAtRef: 'refs/heads/main',
          localLocator: null,
        },
      ],
      archived: [],
    },
    {
      projectId: 'proj_b',
      targetLineId: 'main',
      active: [
        {
          changeId: 'add-thing',
          changeInstanceId: 'chg_2',
          projectId: 'proj_b',
          targetLineId: 'main',
          foundAtRef: 'refs/heads/main',
          localLocator: null,
        },
      ],
      archived: [],
    },
    {
      projectId: 'proj_a',
      targetLineId: 'release-1',
      active: [],
      archived: [],
    },
  ],
} satisfies StoreChangesResponse;

export const storeIssuesFixture = {
  unsearchedRefs: [],
  problems: [],
  complete: true,
  issues: [
    {
      issueId: 'iss_1',
      record: {
        version: 1,
        id: 'iss_1',
        title: 'Cross-project rollout',
        state: 'open',
        reason: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      diagnostic: null,
      divergence: null,
      revisionIds: ['0001'],
      latestRevisionId: '0001',
      refs: ['refs/heads/main'],
      uncommitted: false,
    },
  ],
} satisfies StoreIssuesResponse;

/**
 * One Issue's detail: its resolved current plan carries one RESOLVED node
 * (`proj_a`) and one UNRESOLVED node (`proj_b`) — board-ui requirement 2's
 * "a referenced Change the Store cannot read is shown as unreadable with the
 * reason, never omitted."
 */
export const storeIssueDetailFixture = {
  unsearchedRefs: [],
  problems: [],
  complete: true,
  issue: storeIssuesFixture.issues[0],
  plan: {
    unsearchedRefs: [],
    problems: [],
    complete: true,
    issueId: 'iss_1',
    revisionId: '0001',
    revision: {
      version: 1,
      issueId: 'iss_1',
      revisionId: '0001',
      supersedes: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      contentSha256: 'a'.repeat(64),
      nodes: [
        {
          nodeId: 'n1',
          kind: 'change',
          projectId: 'proj_a',
          targetLineId: 'main',
          dependsOn: [],
          changeInstanceId: 'chg_1',
          changeAlias: 'add-thing',
          lifecycle: 'deferred',
          reason: 'scheduled later',
          suggestedPipeline: 'small-feature',
          rationale: 'keep this rationale',
          uncertainty: 'keep this uncertainty',
        },
        {
          nodeId: 'n2',
          kind: 'change',
          projectId: 'proj_b',
          targetLineId: 'main',
          dependsOn: [],
          changeInstanceId: 'chg_missing',
        },
      ],
    },
    diagnostic: null,
    readiness: {
      nodes: [
        {
          node: {
            nodeId: 'n1',
            kind: 'change',
            projectId: 'proj_a',
            targetLineId: 'main',
            dependsOn: [],
            changeInstanceId: 'chg_1',
            changeAlias: 'add-thing',
          },
          resolution: {
            status: 'resolved',
            claimants: [
              { changeId: 'add-thing', projectId: 'proj_a', targetLineId: 'main', foundAtRef: 'refs/heads/main', archived: false },
            ],
            searchedRefs: ['refs/heads/main'],
            localLocator: null,
            outcome: null,
            archived: false,
          },
          readiness: 'in-progress',
          blockedBy: [],
        },
        {
          node: {
            nodeId: 'n2',
            kind: 'change',
            projectId: 'proj_b',
            targetLineId: 'main',
            dependsOn: [],
            changeInstanceId: 'chg_missing',
          },
          resolution: {
            status: 'unresolved',
            claimants: [],
            searchedRefs: ['refs/heads/main'],
            localLocator: null,
            outcome: null,
            archived: false,
          },
          readiness: 'unknown',
          blockedBy: [],
        },
      ],
      readyToResolve: false,
    },
  },
} satisfies StoreIssueDetailResponse;

/** Exactly one project — the "sole candidate is not adopted as scope" fixture. */
export const storeProjectsFixture = {
  unsearchedRefs: [],
  problems: [],
  complete: true,
  storeId: 'store_x',
  storeUid: 'uid_x',
  projects: [
    {
      projectId: 'proj_a',
      roles: { planning: true, knowledge: false },
      diagnostic: null,
      targetLines: ['main'],
      activeChangeCount: 1,
      archivedChangeCount: 0,
    },
  ],
} satisfies StoreProjectsResponse;

/** Exactly one target line — the "sole candidate is not adopted as scope" fixture. */
export const storeTargetLinesFixture = {
  unsearchedRefs: [],
  problems: [],
  complete: true,
  storeId: 'store_x',
  storeUid: 'uid_x',
  targetLines: [
    {
      targetLineId: 'main',
      storeRef: 'refs/heads/main',
      diagnostic: null,
      projects: ['proj_a'],
      activeChangeCount: 1,
      archivedChangeCount: 0,
    },
  ],
} satisfies StoreTargetLinesResponse;

/** Full D1 payload fixture, including an active link and an archived attachable Change. */
export const storeChangeIssueLinksFixture = {
  unsearchedRefs: [],
  problems: [],
  complete: true,
  entries: [
    {
      occurrence: { kind: 'active', change: storeChangesFixture.groups[0]!.active[0]! },
      association: 'linked',
      eligibility: 'already-linked',
      issues: [
        {
          issueId: 'iss_1',
          title: 'Cross-project rollout',
          state: 'open',
          revisionId: '0001',
          nodeIds: ['n1'],
        },
      ],
    },
    {
      occurrence: {
        kind: 'archived',
        change: {
          changeId: 'historical-change',
          changeInstanceId: 'chg_history',
          projectId: 'proj_a',
          targetLineId: 'main',
          entryName: '2026-08-24-historical-change--abcdef123456',
          archiveDate: '2026-08-24',
          outcome: 'landed',
          legacyRecord: false,
          foundAtRef: 'refs/heads/main',
        },
      },
      association: 'unlinked',
      eligibility: 'attachable',
      issues: [],
    },
  ],
} satisfies StoreChangeIssueLinksResponse;
