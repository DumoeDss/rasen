## Why

The management UI's project switcher "does nothing" because the selected space lives in an in-memory pub-sub store (`packages/ui/src/store/project-store.ts`) while every data call ignores it — the board and sessions always read the daemon's launch project. Child 1 (`ui-space-redesign-api-scope`, shipped at 8ba4dcf) made every management endpoint addressable by an explicit planning space and taught `rasen ui` to emit a `?space=project:<id>` / `?space=store:<id>` URL. This child is the UI shell that consumes that contract: it makes the URL the single source of truth for the selected space, replaces the project dropdown with a dual-namespace space switcher, restructures navigation, and moves the session surface off its own top-level page — so switching a space actually re-scopes every page, and deep links / refreshes / multiple tabs each hold their own space independently.

## What Changes

- **URL is the source of truth.** Canonical routes `/p/:projectId/...` and `/s/:storeId/...` carry the selected space; the space no longer lives in module memory. On boot the shell reads the `?space=<selector>` query that `rasen ui` emits (which survives token scrubbing, since `token.ts` preserves `location.search`), translates it to the canonical route, and navigates. The `project-store.ts` pub-sub store and its `use-project-state.ts` subscriber are retired; the current space is derived from the route via a new `useSpace()` hook.
- **Dual-namespace space switcher** replaces the project dropdown. It fetches `GET /api/v1/spaces` (child 1) and renders two type-tagged groups — Projects and Stores — with the current route's space selected. **The "No project (global only)" option is removed**; the switcher always points at a real space. Choosing an entry navigates (writes the URL), which re-scopes every page. When no space is registered it shows an explicit hint rather than a dead control.
- **Navigation becomes Board · Archive · Config; the top-level Sessions page is deleted.** The `/sessions` route and its `SessionsPage` top-level mount are removed. The Archive nav slot is wired but routes to a placeholder (the Archive page is child 5). Session-rendering components (`SessionRow`, `LaunchSessionDialog`) are retained for reuse by Task detail (child 4).
- **Header `⦿ N running` dropdown** replaces the board's lone "N live sessions" corner link. It reads the current space's live runs via `GET /api/v1/sessions?space=<selector>`, shows each running task's name, stage, and duration, and links each entry to its Task detail route (`/p/:id/task/:changeName`; the page is child 4 — a placeholder route until then). It re-polls only while at least one run is live and re-fetches when the route space changes.
- **Space plumbing through the single client seam.** `api/client.ts`'s `projectQuery()` is generalized to `spaceQuery()`, and the space-scoped calls (`listChanges`, `listRuns`, `listSessions`, `launchSession`) thread the current route's selector. The board reads its space from the route and passes it through; no other board behavior changes.
- **BREAKING (client-facing routes):** the platform home moves from `/` (implicit launch project) to a space-scoped route; `/` becomes a bootstrap that redirects to a resolved space route, and `/sessions` no longer exists.

**Not in scope (later children, do not build here):** Task grouping / four-column Task cards / store member chips (child 3); the Task detail page (child 4); the Archive page and its listing (child 5); Config-page scope tabs and store-scoped config (a later Config concern — this child keeps `ConfigPage` thin, passing the project id for a project space and deferring store config).

**Ship note:** this child's ship is **local-only (commit only)**; archive is deferred to the portfolio level (planning-context §Delivery). No version bump — child 1 already set the UI package to 0.1.5.

**Archive-order note:** the current top-level Sessions nav entry is owned by the `sessions-ui` capability delta of the unarchived `slice3-sessions-ui` change; `board-ui`/`config-ui-package` main specs still describe the pre-Sessions shell (config-ui-package's "Platform shell" requirement already says nav offers board + config with *no* session module). This child's `config-ui-package` MODIFY reconciles that drift by asserting the Board · Archive · Config nav explicitly. Reconcile at archive time by archiving the `slice3-sessions-ui` / slice2 leftovers alongside this portfolio so the retired top-level-Sessions requirement doesn't resurrect a nav entry this child removed.

## Capabilities

### New Capabilities
- `management-ui-shell`: the UI's global space framework — URL as the source of truth for the selected planning space (`?space=` bootstrap → canonical `/p/:id` / `/s/:id` routes with per-space sub-routes; refresh / deep-link / multi-tab each hold their own space), the dual-namespace space switcher fed by `GET /api/v1/spaces`, the header running-run summary dropdown scoped to the current space, and the space-selector plumbing that threads every space-scoped API call from the route (retiring the in-memory pub-sub project store). Includes the absence of a top-level Sessions page.

### Modified Capabilities
- `board-ui`: the board is no longer the implicit-launch-project home at `/`; it renders at the space-scoped route `/p/:id/board` (and `/s/:id/board`), reachable from the space-aware navigation, and its data fetch threads the current space selector. `/` becomes a bootstrap that resolves and redirects to a space route.
- `config-ui-package`: the platform shell's navigation offers Board · Archive · Config (not Sessions), and its space control is the dual-namespace space switcher — which always addresses a real space (the "no project → global only" shell state is removed); the shell derives the active space from the URL rather than an in-memory project store.

## Impact

- `packages/ui/src/app.tsx`: route table rewritten to space-scoped routes + `/` bootstrap redirect + placeholder Archive/Task-detail routes; `/sessions` route removed.
- `packages/ui/src/components/Layout.tsx`: nav restructured to Board · Archive · Config with space-prefix-relative active detection; header hosts the running dropdown; renders the space switcher.
- `packages/ui/src/components/ProjectSwitcher.tsx` → space switcher: dual-namespace grouped listing from `GET /api/v1/spaces`, navigation-on-select, no "No project" option.
- New: `packages/ui/src/store/use-space.ts` (route-derived `useSpace()` hook) and a header running-dropdown component (e.g. `RunningSessionsMenu.tsx`); new `SpaceBootstrap`/redirect for `/`.
- Removed: `packages/ui/src/store/project-store.ts`, `store/use-project-state.ts`, and the top-level `components/SessionsPage.tsx` mount (component may be deleted or parked for child 4).
- `packages/ui/src/components/BoardPage.tsx`: reads space from the route, threads it into `listChanges`/`listRuns`; the `LiveSessionsIndicator` corner link is removed (relocated to the header dropdown).
- `packages/ui/src/components/ConfigPage.tsx`: reads the space from the route instead of the project store (thin — project id for a project space; store-scoped config deferred).
- `packages/ui/src/api/client.ts`: `projectQuery()` → `spaceQuery()`; `space` param threaded into `listChanges`, `listRuns`, `listSessions`, `launchSession`.
- `packages/ui/test/`: `app.test.tsx`, board/session/config component tests, and any project-store test updated for route-derived space; new tests for the switcher, bootstrap redirect, and running dropdown.
- No server/CLI changes (child 1 owns the API); no version bump; preact + preact-iso only (no React); Windows / pnpm.
