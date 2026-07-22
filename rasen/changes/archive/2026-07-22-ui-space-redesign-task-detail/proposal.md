## Why

The redesign gives every Task a board card, but clicking one lands on a placeholder. A Task is the unit of intent, yet there is nowhere to see its whole shape: which child changes it is made of, how far each has progressed, what depends on what, and which supervised runs are (or were) working on it. Child 3 deliberately left this to the detail page, because the board card can only show a Task's *active* children — the true roster (active **and** archived) and the dependency DAG live in files the board's flat `/changes` listing never reaches. This change turns the Task detail placeholder into the real page (decision #8 of the portfolio).

## What Changes

- **Task detail page replaces the placeholder** at the existing `/p|s/:id/task/:changeName` route (component swap only — the route table's shape is child 2's and stays untouched). The `:changeName` param is polymorphic: a **portfolio container** name or a **bare single-change** name, both handled.
- **New read-only management endpoint `GET /api/v1/tasks/:id?space=<selector>`** assembles a Task's full roster — something no existing endpoint can do, because a portfolio's parent container has no `proposal.md` (invisible to `/changes` and `/runs`), archived children have left `/changes` entirely, and the dependency DAG lives only in the parent's `portfolio-run.json`. The endpoint reuses existing discovery helpers (`getActiveChangeIds`, `getArchivedChangeIds`, `readPortfolioState`, `getTaskProgressForChange`, `buildChangeRunEntry`), mints nothing, and writes nothing.
- **Left column — children**: each child change with its derived lifecycle state, task-checkbox progress, dependency hints (from `portfolio-run.json` `dependsOn`, when present), and — for a single-item Task — that one change's task checklist. Portfolio progress ("N/M changes") counts the true active+archived roster, correcting the board card's active-only count.
- **Right column — sessions**: the Task's supervised sessions (mapped session→child by `changeName`, reusing the board's provenance logic), live sessions on top, an expandable per-session output tail, a confirm-first **Kill**, and a **Launch run** action carrying the current space selector and the Task's change context.
- **`LaunchSessionDialog` gains an optional space + prefilled change-name** so a launch from the detail page is attributed to the page's space and Task (additive props; the dialog is retained-but-unmounted since child 2, mounted for the first time here).
- **`board/columns.ts` exports two existing helpers** (`LIVE_SESSION_STATES`, `sessionStage`) and adds a pure `sessionsForTask` splitter, so session→Task mapping stays in the tested pure-logic module rather than being reinvented in the component.

## Capabilities

### New Capabilities
- `task-detail-ui`: The Task detail route page — polymorphic Task resolution, the children column (lifecycle, progress, deps, single-item checklist), the sessions column (live-on-top, tail, kill, Launch run), and space-scoped data access via `useSpace()`/`spaceHref`.

### Modified Capabilities
- `management-http-api`: adds one requirement for the read-only `GET /api/v1/tasks/:id` Task-roster endpoint (active + archived children, portfolio dependency hints). Additive ADDED requirement — does not touch the requirements child 1/child 3's unarchived deltas already modify.

## Impact

- **New server**: `src/core/management-api/task-detail.ts` (roster handler) + `TaskDetailResponse`/`TaskChildDetail` wire types; router wiring for `/api/v1/tasks/:id` (new path matcher, GET-only, space-resolved like `/changes`). Two private helpers in `changes.ts` (`findPortfolioContainers`, `portfolioOf`) become exported for reuse.
- **New UI**: `packages/ui/src/components/TaskDetailPage.tsx`; `app.tsx` swaps the two task routes' component from `TaskDetailPlaceholder` to it (`TaskDetailPlaceholder` retired; `ArchivePlaceholder` stays for child 5). New `client.getTaskDetail(id, space)`; hand-mirrored wire types in `api/types.ts` pinned by a `satisfies` fixture. Additions to `board/columns.ts` and props on `LaunchSessionDialog.tsx`.
- **Reused unchanged**: `SessionRow.tsx` (kill + tail), `deriveColumn`/`groupIntoTasks` inputs, `useSpace`/`spaceHref`, `killSession`/`launchSession`/`listSessions`.
- **No version bump; local-only ship; archive deferred to portfolio level.** No writes/mints on any new path (real source red line, decision #10). Windows/pnpm; preact + preact-iso (no React).
