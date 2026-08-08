import type {
  StoreAggregateChangesResponse,
  StoreProjectRollupResponse,
} from '../../src/api/types.js';

/**
 * A layout v2 Store's grouped changes: three projects across two target lines,
 * two of them sharing the change alias `refresh-cache` so the "two projects
 * sharing an alias are not merged" case has something to bite on, one archived
 * entry with a real finalization outcome, and one relocated legacy record whose
 * outcome is null rather than a default.
 *
 * `satisfies StoreAggregateChangesResponse` is the `tsc` drift tripwire over
 * the hand-mirrored wire types — no `as` anywhere. The mirror in
 * `packages/ui/src/api/types.ts` has no build-time import path from
 * `src/core/management-api/wire-types.ts`, so this file is the only thing that
 * fails when the two drift.
 */
export const storeGroupedChangesFixture = {
  groups: [
    {
      projectId: 'elftia',
      targetLineId: 'line-0.2',
      active: [
        {
          changeId: 'refresh-cache',
          changeInstanceId: `ci_${'a1'.repeat(32)}`,
          projectId: 'elftia',
          targetLineId: 'line-0.2',
          foundAtRef: 'refs/heads/release/0.2',
          localLocator: {
            root: '/work/planning/elftia-refresh-cache',
            kind: 'planning-worktree',
            portable: false,
          },
        },
      ],
      archived: [
        {
          changeId: 'telemetry-emit',
          changeInstanceId: `ci_${'b2'.repeat(32)}`,
          projectId: 'elftia',
          targetLineId: 'line-0.2',
          entryName: '2026-07-01-telemetry-emit--b2b2b2b2b2b2',
          archiveDate: '2026-07-01',
          outcome: 'landed',
          legacyRecord: false,
          foundAtRef: 'refs/heads/release/0.2',
        },
      ],
    },
    {
      projectId: 'rocut',
      targetLineId: 'main',
      active: [
        {
          changeId: 'refresh-cache',
          changeInstanceId: `ci_${'c3'.repeat(32)}`,
          projectId: 'rocut',
          targetLineId: 'main',
          foundAtRef: 'refs/heads/main',
          localLocator: null,
        },
      ],
      archived: [
        {
          changeId: 'legacy-import',
          changeInstanceId: null,
          projectId: 'rocut',
          targetLineId: 'main',
          entryName: '2025-11-02-legacy-import',
          archiveDate: '2025-11-02',
          // A relocated legacy v1 record. No outcome is inferred, defaulted, or
          // upgraded; inventing `landed` here is the exact lie the four-outcome
          // model exists to prevent.
          outcome: null,
          legacyRecord: true,
          foundAtRef: 'refs/heads/main',
        },
      ],
    },
    {
      projectId: 'elftia-website',
      targetLineId: 'main',
      active: [],
      archived: [],
    },
  ],
  unsearchedRefs: [],
  complete: true,
} satisfies StoreAggregateChangesResponse;

/**
 * The same Store with one ref that could not be read. `complete` is false and
 * the ref is listed; nothing is reported as absent on that evidence.
 */
export const storeIncompleteChangesFixture = {
  groups: [storeGroupedChangesFixture.groups[1]],
  unsearchedRefs: [
    {
      targetLineId: 'line-0.2',
      storeRef: 'refs/heads/release/0.2',
      reason: 'the Store ref does not resolve to a commit in this checkout',
    },
  ],
  complete: false,
} satisfies StoreAggregateChangesResponse;

/** The project and target-line rollup, including one catalog that fails validation. */
export const storeProjectRollupFixture = {
  storeId: 'atelier',
  storeUid: '9d1d9f4b-8fd8-45d8-b5ef-f0c7a28491d0',
  projects: [
    {
      projectId: 'elftia',
      roles: { planning: true, knowledge: false },
      diagnostic: null,
      targetLines: ['line-0.2', 'main'],
      activeChangeCount: 1,
      archivedChangeCount: 1,
    },
    {
      projectId: 'rocut',
      roles: { planning: true, knowledge: true },
      diagnostic: null,
      targetLines: ['main'],
      activeChangeCount: 1,
      archivedChangeCount: 1,
    },
    {
      // Reported WITH its diagnostic rather than dropped: a silently omitted
      // project is a project whose Changes vanish from the board.
      projectId: 'elftia-website',
      roles: null,
      diagnostic: {
        code: 'invalid_project_catalog',
        message: "catalog: unrecognized key 'owner'",
        path: '/stores/atelier/.rasen-store/projects/elftia-website.yaml',
      },
      targetLines: ['main'],
      activeChangeCount: 0,
      archivedChangeCount: 0,
    },
  ],
  targetLines: [
    {
      targetLineId: 'line-0.2',
      storeRef: 'refs/heads/release/0.2',
      diagnostic: null,
      projects: ['elftia'],
      activeChangeCount: 1,
      archivedChangeCount: 1,
    },
    {
      targetLineId: 'main',
      storeRef: 'refs/heads/main',
      diagnostic: null,
      projects: ['elftia', 'elftia-website', 'rocut'],
      activeChangeCount: 1,
      archivedChangeCount: 1,
    },
  ],
  unsearchedRefs: [],
  complete: true,
} satisfies StoreProjectRollupResponse;
