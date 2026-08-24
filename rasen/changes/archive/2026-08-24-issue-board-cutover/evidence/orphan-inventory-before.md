# Orphan inventory before deletion

Recorded on 2026-08-24 in the `feat/issue-phase7` worktree before task 6.2.
The sweep covered production source, component tests, fixtures, `style.css`, and
all three UI locale catalogs. Generated `dist/`, `node_modules/`, change
artifacts, and unrelated `.rasen/` debris were excluded.

## Component ownership

| Candidate | Production references | Test references | Disposition |
| --- | --- | --- | --- |
| `StoreIssuesView` | Its own declaration and a self-reference in `StoreAggregateBoard` documentation only; no route, import, or production caller | `store-issues-view.test.tsx` only | Delete source and exclusive test |
| `StoreAggregateBoard` | Its own declaration only; no route, import, or production caller | `store-aggregate-board.test.tsx` only | Delete source and exclusive test |
| `RunningSessionsMenu` | Its own declaration only; `Layout` no longer imports or renders it | `running-sessions-menu.test.tsx` only | Delete source and exclusive test |

`packages/ui/test/fixtures/store-aggregate.ts` is imported only by the two
retired Store component suites. It has no remaining consumer and is deleted
with them.

The current `BoardPage.tsx` has already been narrowed to the project contract:
there is no `SpaceMember`/`MemberChips` import, Store roster fetch,
`selectedMember` state, `tasksForMember` call, or Store-only render branch.
The only remaining word “store” is a historical comment describing when a
worktree response is absent; it is not a branch or navigation surface.

## Exclusive presentation assets

- `style.css` lines 391–415 contain the only
  `.running-sessions-menu*` rules. The sole non-component reference is the
  token assertion in `test/theme/runtime.test.ts`; the block and that retired
  selector assertion are deleted together.
- No `.store-board*` or `.store-issues*` rule exists in `style.css`.
- Each of `en.json`, `ja.json`, and `zh-cn.json` contains six
  `store_board.*` keys (lines 537–542), thirty-two `store_issues.*` keys
  (lines 543–574), and three `running.*` keys (lines 167–169). Exact-key
  searches found those keys only in the three retired components, so all
  forty-one keys per locale are exclusive.

## Retained raw/public Store contracts

Component retirement does **not** retire Store management contracts:

- `getStoreProjects` remains actively consumed by `IssueBoardPage` and
  `OperationsPage`.
- `createStoreIssue` and `publishStoreExecutionPlan` remain actively consumed
  by `LinkChangeDialog` on the Unlinked Changes surface.
- `listSessions` remains consumed by the project Board and Store Operations.
- `getStoreTargetLines`, `getStoreChanges`, `getStoreIssues`, `getStoreIssue`,
  and `setStoreIssueState` currently lose their old component caller, but
  remain public `/api/v1/stores/*` client contracts backed by
  `src/core/management-api/router.ts`, `stores.ts`, `stores-routes.ts`, and
  `wire-types.ts`. Their server and wire-contract suites remain in place.
- The g-001 projection reads, g-002 Change-link reads and Issue/plan mutations,
  Operations, Unlinked Changes, project Board, and Task Detail remain outside
  this deletion.

## Sweep commands

The inventory was produced with scoped `rg` searches for the three component
names, their test/fixture imports, `.running-sessions-menu`, `.store-board`,
`.store-issues`, `store_board.*`, `store_issues.*`, `running.*`, and the Store
client method names across `packages/ui/src`, `packages/ui/test`,
`src/core/management-api`, and `test/core/management-api`.
