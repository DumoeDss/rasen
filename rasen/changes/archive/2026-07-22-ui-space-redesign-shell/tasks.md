## 1. Space model: route-derived space + client seam (D2, D5, D6)

- [x] 1.1 Add `store/use-space.ts` exporting `useSpace()`: read preact-iso `useRoute()` params and return `{ type: 'project' | 'store', id, selector }` (`selector = \`${type}:${id}\``) or `null` when not on a space route. `id` is the decoded route param, used verbatim (no normalization — opaque token, D5). [Derives from `useLocation().path` rather than `useRoute()` params: the header controls that call `useSpace()` mount OUTSIDE `<Router>`, where `useRoute()` params are unavailable; a pure `parseSpacePath` helper keeps the opaque-token round-trip unit-testable.]
- [x] 1.2 In `api/client.ts`, replace `projectQuery(project)` with `spaceQuery(selector?)` → `selector ? \`?space=${encodeURIComponent(selector)}\` : ''`. [Added `spaceQuery` for the space-scoped calls; kept `projectQuery` for the config calls per task 1.4.]
- [x] 1.3 Thread an optional `space?: string` selector into `listChanges`, `listRuns`, and `listSessions` (query via `spaceQuery`), and into `launchSession` (as a body field `space`). Omitting it must send no `space` (preserving the launch-project fallback).
- [x] 1.4 Keep the config calls (`listConfig`/`getKey`/`putKey`/`deleteKey`) on the config-api `?project=` param unchanged — they are NOT moved onto `?space=` in this child.

## 2. Boot + routing: URL as source of truth (D1)

- [x] 2.1 Add a `SpaceBootstrap` component (e.g. `components/SpaceBootstrap.tsx`) that, on mount: parses `?space=<selector>` from `location.search`; on `project:<rest>` navigates `route('/p/' + encodeURIComponent(rest) + '/board', true)`, on `store:<rest>` navigates `/s/…` (replace-history so the query is dropped and no back-entry is left).
- [x] 2.2 In `SpaceBootstrap`, when no `?space=` is present: `GET /api/v1/health` → redirect to the launch project's `/p/<id>/board`; else `GET /api/v1/spaces` → redirect to the first space by `type`; else render an explicit empty state ("No planning space registered — run `rasen ui` inside a Rasen project"). Guard against redirect re-entry (use `route(replace)`; do not loop).
- [x] 2.3 Rewrite `app.tsx` route table: `/` and `default` → `SpaceBootstrap`; `/p/:projectId` and `/s/:storeId` → redirect to `…/board`; `/p/:projectId/board` and `/s/:storeId/board` → `BoardPage`; `/p/:projectId/config` and `/s/:storeId/config` → `ConfigPage`; `/p/:projectId/archive` and `/s/:storeId/archive` → an Archive placeholder; `/p/:projectId/task/:changeName` and `/s/:storeId/task/:changeName` → a Task-detail placeholder. Remove the `/sessions` route and the `SessionsPage` import.
- [x] 2.4 Add minimal placeholder components for the Archive route (child 5) and the Task-detail route (child 4) — a labeled "coming soon" panel, not a spinner or blank — so nav slots and running-dropdown links resolve.

## 3. Layout, switcher, running dropdown (D3, D4, D7)

- [x] 3.1 Rewrite `ProjectSwitcher.tsx` into the dual-namespace space switcher: fetch `GET /api/v1/spaces` once, render two type-tagged groups (Projects, Stores) labeled by `name`, select the current `useSpace()` entry, and on change `route()` to `/p/<id>/<section>` or `/s/<id>/<section>` where `<section>` is the current section from the route (default `board`). No "No project (global only)" option; empty spaces list → a static hint. It ignores `members`. [Renamed the file to `SpaceSwitcher.tsx` per design D3's implementer's-call.]
- [x] 3.2 Add a header running-dropdown component (e.g. `RunningSessionsMenu.tsx`): poll `listSessions(useSpace().selector)`, filter to live states (`starting`/`running`/`exiting`), show `⦿ N running` (hidden when N=0); the open menu lists each live run's task, stage (from `changeName` + `ok` run-state), and ticking duration (`now − startedAt`); each change-associated entry links to `/p|s/<id>/task/<encodeURIComponent(changeName)>`. Re-poll only while ≥1 live; re-subscribe when the selector changes.
- [x] 3.3 Update `Layout.tsx`: nav offers Board · Archive · Config built from the current space prefix (`useSpace()`), with active detection relative to that prefix; remove the Sessions nav entry; mount the space switcher and the running-dropdown in the header. When `useSpace()` is null (bootstrap/empty state), render the header without space-scoped controls.
- [x] 3.4 Remove the top-level Sessions surface: delete `components/SessionsPage.tsx` from routing (delete the file or park it unused). Keep `SessionRow.tsx` and `LaunchSessionDialog.tsx` for child 4's Task detail.

## 4. Consumers: board + config read the route space (D6)

- [x] 4.1 In `BoardPage.tsx`, read `useSpace().selector` and pass it to `listChanges`/`listRuns`; add the selector to the load effect's dependency list so switching space re-fetches. Remove the `LiveSessionsIndicator` component and its usages (relocated to the header running-dropdown).
- [x] 4.2 In `ConfigPage.tsx`, replace `useProjectState()` with `useSpace()`: for a project space, pass the project id to `listConfig`/`ConfigEntryRow` as today; for a store space, render an explicit "store configuration arrives with the Config redesign" notice instead of mis-addressing the store root. Remove the "No project selected — showing global configuration" hint.

## 5. Retire the pub-sub store (D2)

- [x] 5.1 Delete `store/project-store.ts` and `store/use-project-state.ts`. Confirm no remaining imports (`ProjectSwitcher`, `ConfigPage`, tests) reference them.

## 6. Tests + build

- [x] 6.1 Update `test/app.test.tsx` for the new route table: `/p/:id/board` renders the board, `/` bootstraps/redirects, `/sessions` no longer routes. Add a test that a launch URL carrying both `?space=project:<id>` and `#token=<t>` lands on `/p/<id>/board` with the token retained in memory (pins the token-scrub / bootstrap ordering). [Token-ordering test lives in `space-bootstrap.test.tsx` with the REAL token.js — app.test mocks token.js, so the ordering assertion needs its own file.]
- [x] 6.2 Add tests for the space switcher (two grouped namespaces from `/api/v1/spaces`, select → navigate, no "No project" option, empty-list hint), the `SpaceBootstrap` fallback chain (query → health → spaces → empty state), and the running-dropdown (space-scoped count, hidden at 0, entry links to task detail).
- [x] 6.3 Add a `useSpace()`/`spaceQuery()` round-trip test: an id with mixed case / separators survives route → selector → API query unchanged (opaque-token discipline, D5). [Pure-helper round-trip in `test/store/use-space.test.ts`; query-encoding half in `client.test.ts`.]
- [x] 6.4 Update board/config/session component tests and fixtures for the route-derived space (replace project-store usage); remove or migrate any `project-store` test. [No project-store test existed; removed the deleted-page `sessions-page.test.tsx` and the board's live-sessions-indicator tests.]
- [x] 6.5 Run `pnpm -C packages/ui typecheck` (or `tsc`), `pnpm -C packages/ui test`, and `pnpm -C packages/ui build`; confirm `dist/index.html` is produced and no version was bumped. [tsc clean; 136/136 tests pass; build emits dist/index.html; version unchanged at 0.1.1.]
