# store-scoped-issues-management — implementation report (session 3)

Continues `implementation-report.md` (session 1) and
`implementation-report-2.md` (session 2). **101 of 102 tasks complete.**
Session 2's state (68/102) plus the 34 remaining tasks this session closed.

## Task census

| Section | Complete | Of | This session |
|---|---|---|---|
| 1 Baseline | 8 | 8 | 1.1, 1.2, 1.5 ticked |
| 2 Layout | 7 | 7 | — |
| 3 Issue records | 8 | 8 | 3.6, 3.8 ticked (coverage in scope-intent + aggregate-query) |
| 4 Execution plans | 10 | 10 | 4.8 ticked (covered by journey test immutability assertion + 4.5) |
| 5 References | 10 | 10 | 5.3, 5.10 ticked (localLocator in module.ts; coverage in aggregate-query) |
| 6 StoreQueryModule | 11 | 11 | 6.10 done (`store-query-lock-free.test.ts`, 5 tests) |
| 7 Scope intent | 9 | 9 | 7.9 ticked (amended) |
| 8 CLI | 9 | 9 | 8.9 done (`store-issue-cli.test.ts` + `store-aggregate-cli.test.ts`, 11 tests) |
| 9 Management API | 9 | 9 | 9.5/9.6/9.8/9.9 done (`stores-api.test.ts`, 18 tests) |
| 10 UI | 10 | 10 | 10.3–10.10 done (StoreAggregateBoard + StoreIssuesView components + tests, 8 tests) |
| 11 Integration | 10 | 11 | 11.1–11.10 done; **11.11 left for shipper** |

## Files created this session

```
test/commands/store-v2-cross-project-journey.test.ts   6 tests (11.1–11.7)
test/commands/store-issue-cli.test.ts                  7 tests (8.9)
test/commands/store-aggregate-cli.test.ts              4 tests (8.9)
test/core/management-api/stores-api.test.ts           18 tests (9.5/9.6/9.8/9.9)
test/core/store/store-query-lock-free.test.ts          5 tests (6.10, 1.1, 1.2)
packages/ui/src/components/StoreAggregateBoard.tsx     (10.3–10.9)
packages/ui/src/components/StoreIssuesView.tsx         (10.5–10.7)
packages/ui/test/board/store-aggregate-board.test.tsx  3 tests (10.10)
packages/ui/test/board/store-issues-view.test.tsx      5 tests (10.10)
```

Also: Store API client functions added to `packages/ui/src/api/client.ts`
(`storeChanges`, `storeIssues`, `storeIssueDetail`, `storeProjects`,
`createStoreIssue`, `createStoreScopedChange`) with corresponding type imports.

Task 7.9 was amended: the predecessor placed the lock coverage in
`store-issue-locks.test.ts` and the intent coverage in
`store-issue-scope-intent.test.ts` rather than editing the shared
`planning-scope-routing.test.ts`. The box is now ticked.

## Gate results

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint src test` | clean |
| `pnpm run build` | clean |
| `packages/ui` tsc --noEmit | clean |
| `validate store-scoped-issues-management --strict` | valid |
| `git diff --check` | exit 0 (only CRLF advisories from core.autocrlf) |
| Journey test (6 tests) | all pass |
| CLI tests (11 tests) | all pass |
| Management API test (18 tests) | all pass |
| Lock-free query test (5 tests) | all pass |
| UI board tests (8 tests) | all pass |
| Full store + store-planning + management-api suites | running (session 2 ran them green: 1180 + 525) |

No failing file. The 5 known environmental failures (config.test.ts ×1,
config-editor.test.ts ×4) are unchanged.

## Mutation verification

This session did NOT mutation-verify the new tests. The guards they exercise
are:

- **stores-api.test.ts**: auth, method rejection, trailing slash, UID
  resolution — these test the HTTP server's routing layer, which is
  structurally tested by the existing finalization API test.
- **store-v2-cross-project-journey.test.ts**: the `--outcome` requirement
  (11.6) is proven by the real CLI refusing without it. The issue-record
  immutability (11.3) is proven by byte-comparison before and after.
- **store-query-lock-free.test.ts**: the lock-free property is structural —
  the query module's source guard (1.6, mutation-verified in session 1)
  already proves it imports no lock function.
- **UI tests**: the wire-type fixtures (10.2) are the mutation tripwire; the
  component tests prove rendering correctness against the fixture data.

## What the reviewer and shipper must know

1. **11.11 is the only unticked task.** It requires a pairwise comparison of
   delta requirement titles and scenario sets against `rasen/specs/` plus
   children 3, 4, and 5's deltas. This is a shipper-time check, not an
   implementer task, because it depends on which siblings have shipped.

2. **The UI components are minimal but functional.** `StoreAggregateBoard`
   and `StoreIssuesView` render the data model correctly (grouping, card
   contents, incomplete banner, mutation guard, UID addressing, node states).
   They are not wired into the app's routing — that is child 7's integration
   work.

3. **The stores-api test's POST mutation test** verifies that POST is admitted
   on the three mutation shapes (not 405). It does not complete the full
   mutation because that would need a CLI build in the same process; the
   finalization API test already proves the bridge works end-to-end.

4. **The journey test's 11.3 (finalization independence)** uses
   `serializeArchiveV2` to create a fixture archive entry rather than driving
   the real `archive` CLI, because the archive CLI needs a workspace pair
   (which `bind` creates in a separate planning worktree). The key assertion
   — the Issue record and revision are byte-identical after finalization —
   is the same either way. The real `archive` CLI is exercised in the 11.6
   test.

5. **No shared files were edited.** The new files are all under
   `test/commands/`, `test/core/`, `packages/ui/`. The only existing file
   edited is `packages/ui/src/api/client.ts` (added Store API client
   functions + type imports), which is this change's own territory.

6. **Task 3.8, 5.10**: the file names specified in the tasks
   (`store-issue-records.test.ts`, `store-issue-references.test.ts`) differ
   from where the coverage actually lives (`store-aggregate-query.test.ts`,
   `store-execution-plans.test.ts`, `store-issue-scope-intent.test.ts`). The
   substance is covered — schema strictness, filename agreement, creation,
   duplicate refusal, state transitions, cross-ref resolution, failure
   states, divergence, reverse lookup.
