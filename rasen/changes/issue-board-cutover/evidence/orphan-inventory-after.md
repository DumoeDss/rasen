# Orphan inventory after deletion

Recorded on 2026-08-24 after task 6.2.

## Removed

- `packages/ui/src/components/StoreIssuesView.tsx`
- `packages/ui/src/components/StoreAggregateBoard.tsx`
- `packages/ui/src/components/RunningSessionsMenu.tsx`
- Their three exclusive component suites
- `packages/ui/test/fixtures/store-aggregate.ts`, which only those suites imported
- The exclusive `.running-sessions-menu*` CSS block and its retired theme-selector assertion
- The exclusive `running.*`, `store_board.*`, and `store_issues.*` keys from en, ja, and zh-cn

## Post-deletion sweep

- Exact symbol search for `StoreIssuesView|StoreAggregateBoard|RunningSessionsMenu` across UI
  source/tests: **zero matches**.
- Exact locale-key search for `store_board.|store_issues.|running.`: **zero matches**.
- Old CSS/test-id search has no implementation match. The two intentional string matches are
  `legacy-store-board-redirect` in `app.tsx` and the app test asserting that
  `[data-testid="running-sessions-menu"]` is absent.
- App routes retain project Board and Task Detail; legacy Store Board and Task paths are explicit
  replace-redirect components and do not import either renderer.
- `BoardPage.tsx` contains no Store roster/member-filter branch.

## Retained contract owners

- Active UI consumers: `getStoreProjects` → `IssueBoardPage` and `OperationsPage`;
  `createStoreIssue`/`publishStoreExecutionPlan` → `LinkChangeDialog`;
  `listSessions` → project Board, Task Detail, Archive, and Store Operations.
- Retained public Store clients without a current direct page consumer:
  `getStoreTargetLines`, `getStoreChanges`, `getStoreIssues`, `getStoreIssue`, and
  `setStoreIssueState`. They remain part of the public management HTTP surface owned by
  `src/core/management-api/router.ts`, `stores.ts`, `stores-routes.ts`, and `wire-types.ts`, with
  server/wire-contract coverage. No g-001/g-002 endpoint, type, or mutation was removed.

## Verification

`pnpm --filter @atelierai/rasen-ui test test/app.test.tsx test/i18n/catalog.test.ts
test/theme/runtime.test.ts` passed: **3 files, 45 tests**. The emitted jsdom `window.scrollTo`
messages are the known non-failing router diagnostic.

All three edited locale files parse as JSON after deletion.
