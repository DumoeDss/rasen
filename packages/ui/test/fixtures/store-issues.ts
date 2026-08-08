import type {
  StoreExecutionPlanResponse,
  StoreIssueDetailResponse,
  StoreIssueListResponse,
} from '../../src/api/types.js';

/**
 * The Store's Issues: one open Issue with a mixed-kind plan, one resolved, and
 * one whose records DIVERGE across two Store refs — every copy listed, none
 * presented as the record, no recency heuristic choosing one.
 *
 * `satisfies StoreIssueListResponse` is the `tsc` drift tripwire over the
 * hand-mirrored wire types — no `as` anywhere.
 */
export const storeIssueListFixture = {
  issues: [
    {
      issueId: 'cross-line-telemetry',
      record: {
        version: 1,
        id: 'cross-line-telemetry',
        title: 'Unify telemetry across the three shipped surfaces',
        state: 'open',
        reason: null,
        createdAt: '2026-08-07T00:00:00.000Z',
      },
      divergence: null,
      revisionIds: ['0001', '0002'],
      latestRevisionId: '0002',
      refs: ['refs/heads/main'],
      uncommitted: false,
    },
    {
      issueId: 'retire-legacy-uploader',
      record: {
        version: 1,
        id: 'retire-legacy-uploader',
        title: 'Retire the legacy uploader in both consumers',
        state: 'resolved',
        reason: null,
        createdAt: '2026-06-01T00:00:00.000Z',
      },
      divergence: null,
      revisionIds: ['0001'],
      latestRevisionId: '0001',
      refs: ['refs/heads/main', 'refs/heads/release/0.2'],
      uncommitted: false,
    },
    {
      issueId: 'split-event-schema',
      // Divergent: no copy is the record.
      record: null,
      divergence: {
        copies: [
          {
            storeRef: 'refs/heads/main',
            targetLineId: 'main',
            sha256: 'a'.repeat(64),
            record: {
              version: 1,
              id: 'split-event-schema',
              title: 'Split the event schema',
              state: 'open',
              reason: null,
              createdAt: '2026-08-01T00:00:00.000Z',
            },
            diagnostic: null,
          },
          {
            storeRef: 'refs/heads/release/0.2',
            targetLineId: 'line-0.2',
            sha256: 'b'.repeat(64),
            record: {
              version: 1,
              id: 'split-event-schema',
              title: 'Split the event schema for 0.2',
              state: 'dropped',
              reason: 'folded into cross-line-telemetry',
              createdAt: '2026-08-01T00:00:00.000Z',
            },
            diagnostic: null,
          },
        ],
      },
      revisionIds: [],
      latestRevisionId: null,
      refs: ['refs/heads/main', 'refs/heads/release/0.2'],
      uncommitted: false,
    },
  ],
  unsearchedRefs: [],
  complete: true,
} satisfies StoreIssueListResponse;

/**
 * One Issue's latest plan: a finalized `change` node, an `unresolved` one, and
 * an `intent` node that is declared-not-yet-created rather than a broken link.
 * The Issue is NOT ready to resolve, which is what keeps readiness derived and
 * the state operator-declared.
 */
export const storeExecutionPlanFixture = {
  issueId: 'cross-line-telemetry',
  revisionId: '0002',
  revision: {
    version: 1,
    issueId: 'cross-line-telemetry',
    revisionId: '0002',
    supersedes: '0001',
    createdAt: '2026-08-07T00:00:00.000Z',
    contentSha256: 'c'.repeat(64),
    nodes: [
      {
        nodeId: 'elftia-emit',
        kind: 'change',
        projectId: 'elftia',
        targetLineId: 'line-0.2',
        dependsOn: [],
        changeInstanceId: `ci_${'b2'.repeat(32)}`,
        changeAlias: 'telemetry-emit',
      },
      {
        nodeId: 'website-render',
        kind: 'change',
        projectId: 'elftia-website',
        targetLineId: 'main',
        dependsOn: ['elftia-emit'],
        changeInstanceId: `ci_${'d4'.repeat(32)}`,
      },
      {
        nodeId: 'rocut-consume',
        kind: 'intent',
        projectId: 'rocut',
        targetLineId: 'main',
        dependsOn: ['elftia-emit'],
        summary: 'Consume the unified event shape',
      },
    ],
  },
  diagnostic: null,
  readiness: {
    nodes: [
      {
        node: {
          nodeId: 'elftia-emit',
          kind: 'change',
          projectId: 'elftia',
          targetLineId: 'line-0.2',
          dependsOn: [],
          changeInstanceId: `ci_${'b2'.repeat(32)}`,
          changeAlias: 'telemetry-emit',
        },
        resolution: {
          status: 'resolved',
          claimants: [
            {
              changeId: 'telemetry-emit',
              projectId: 'elftia',
              targetLineId: 'line-0.2',
              foundAtRef: 'refs/heads/release/0.2',
              archived: true,
            },
          ],
          searchedRefs: ['refs/heads/main', 'refs/heads/release/0.2'],
          localLocator: null,
          outcome: 'landed',
          archived: true,
        },
        readiness: 'finalized',
        blockedBy: [],
      },
      {
        node: {
          nodeId: 'website-render',
          kind: 'change',
          projectId: 'elftia-website',
          targetLineId: 'main',
          dependsOn: ['elftia-emit'],
          changeInstanceId: `ci_${'d4'.repeat(32)}`,
        },
        resolution: {
          status: 'unresolved',
          claimants: [],
          searchedRefs: ['refs/heads/main', 'refs/heads/release/0.2'],
          localLocator: null,
          outcome: null,
          archived: false,
        },
        readiness: 'unknown',
        blockedBy: [],
      },
      {
        node: {
          nodeId: 'rocut-consume',
          kind: 'intent',
          projectId: 'rocut',
          targetLineId: 'main',
          dependsOn: ['elftia-emit'],
          summary: 'Consume the unified event shape',
        },
        resolution: {
          status: 'not-created',
          claimants: [],
          searchedRefs: ['refs/heads/main', 'refs/heads/release/0.2'],
          localLocator: null,
          outcome: null,
          archived: false,
        },
        readiness: 'not-started',
        blockedBy: [],
      },
    ],
    readyToResolve: false,
  },
  unsearchedRefs: [],
  complete: true,
} satisfies StoreExecutionPlanResponse;

/** The Issue detail the Issues view renders: summary plus the latest plan. */
export const storeIssueDetailFixture = {
  issue: storeIssueListFixture.issues[0],
  plan: storeExecutionPlanFixture,
  unsearchedRefs: [],
  complete: true,
} satisfies StoreIssueDetailResponse;
