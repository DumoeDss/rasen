## Why

The board today renders one card per active change, flat, with no notion of a Task. But the redesign's unit of intent is the **Task**: a portfolio (a change directory with `planning-context.md` whose children exist as `<parent>-<slice>` siblings) is one Task with several child changes, and a bare change with no children is an implicit single-item Task (planning-context §Decision 6/7, user-ratified). A user looking at the board of the `ui-space-redesign` portfolio sees six sibling cards (`-api-scope`, `-shell`, `-task-board`, `-task-detail`, `-archive-page`) and no indication they are one piece of work — the portfolio parent is invisible to `/api/v1/changes` because it has no `proposal.md`. This child makes the board group changes into Tasks, place each Task in a lifecycle column by deriving from its children, and (in a store space) filter by member. It also fixes a carried-over defect from child 2: the board's "New change" dialog submits with no space, so a new change from a store or non-launch-project board lands in the daemon's launch project rather than the space the user is viewing.

Child 1 (`ui-space-redesign-api-scope`, shipped 8ba4dcf) made `/api/v1/changes|runs|sessions` space-addressable and populated `GET /api/v1/spaces` with each store's `members[]`. Child 2 (`ui-space-redesign-shell`, shipped c1e4753) made the URL the source of truth (`useSpace()`), threaded the selector through the client seam, and placeholder-wired the `…/task/:changeName` route. This child builds the Task board on top of both; child 2's space switcher deliberately ignored `members[]` and left it for this child.

## What Changes

- **Server reports portfolio membership as a fact.** `GET /api/v1/changes` tags each active change with an optional `portfolio` field naming its portfolio container — the longest sibling directory prefix `P` such that `P/planning-context.md` exists and the change name is `P` or starts with `P-`. This is the one fact the UI cannot derive from the flat change list (it requires reading the filesystem for `planning-context.md`), so it is computed server-side and reported like `hasRunFiles`. Read-only, additive; no new persistent state, no writes (red-line §Decision 10). All grouping, column placement, and rendering stay UI-side (column derivation is UI policy — the existing `deriveColumn` precedent).
- **The board groups changes into Tasks.** Changes sharing a `portfolio` value form one portfolio Task (its id and label = the parent container name); a change with no `portfolio` is an implicit single-item Task (its id and label = the change name — zero ceremony). Cards are Tasks, not changes, and are **not draggable** — this is a read-only status-grouped view, not a kanban (Decision 6).
- **Task placement derives from children.** A portfolio Task's lifecycle column aggregates its children's per-change columns (via the existing `deriveColumn`): any child In Progress → In Progress; else any child Ready → Ready; else any child Planning → Planning; else (every child Done or archived-out) → Done. A single-item Task takes its one change's column directly. Task status is purely derived — no new persisted status field (Decision 7).
- **Task card content.** A portfolio card shows aggregate child progress ("N/M changes" — done children of those on the board), a single-item card shows its own task-checkbox progress ("N/M tasks"). Both show a `⦿` live-run indicator with the current stage when a live session targets one of the Task's changes, and an escalation badge when any child's run is escalated. The card links to the Task detail route (child 4's page; the route is a placeholder today) built via `spaceHref(space, 'task', task.id)`.
- **Store member chips.** In a store space the board carries a chip row built from `members[]` (`GET /api/v1/spaces`): `All` (the full rollup, default) plus one chip per member. Selecting a member narrows the board to Tasks with a session whose cwd is under that member's root (session-provenance attribution — the only file-derived link between a central store change and a member, requiring no new server state). Project spaces render no chip row.
- **New-change submission is space-scoped (carryover fix from child 2).** The board's `NewChangeDialog` threads `useSpace().selector` into `client.createChange`'s `space` field, so a change created from a store or non-launch-project board lands in the currently viewed space, not the daemon's launch project. Child 1 already gave `SubmitChangeRequest` an optional `space` field and the server already resolves it.
- **The board fetches live sessions.** In addition to `listChanges` + `listRuns`, `BoardPage` now fetches `listSessions(selector)` (space-scoped, the same data child 2's header dropdown reads) to drive the `⦿` indicator and member-chip attribution; all three re-fetch on space change.

**Not in scope (later children):** the Task detail page itself (child 4 — this child only links to its route); the Archive page and its Done-column truncation (child 5). Both routes are already placeholder-wired by child 2; this child does not touch the route table's shape.

**Ship note:** local-only (commit only); archive deferred to the portfolio level (planning-context §Delivery). No version bump — the UI package is already at 0.1.5.

**Archive-order note:** this child adds a new requirement to `board-ui` for Task grouping/cards/chips and modifies `board-ui`'s change-submission requirement (which child 2 did not touch — child 2 modified only "Board is the platform home"), plus a new `management-http-api` requirement for the portfolio field (child 1 modified "Changes listing"; this child ADDs rather than re-modifying it, avoiding a spec-merge collision). Reconcile at archive time alongside child 1/child 2 and the unarchived slice2/slice3 leftovers (planning-context §findings 4/13).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `board-ui`: adds Task grouping (portfolio containers as one Task with nested children, bare changes as implicit single-item Tasks), Task-based lifecycle-column placement derived from children (cards not draggable), Task-card content (child progress, `⦿` live-run indicator + current stage, escalation badge, link to the Task detail route), and a store-space member chip filter (All rollup + per-member, session-provenance attribution); modifies the existing board-embedded change-submission requirement to scope a new change to the currently viewed planning space.
- `management-http-api`: adds a requirement that `GET /api/v1/changes` reports each change's portfolio-container membership as an additive, read-only, filesystem-derived fact (does not modify child 1's "Changes listing" requirement).

## Impact

- `src/core/management-api/changes.ts`: additive portfolio-membership detection (enumerate sibling directories carrying `planning-context.md`, attach the longest matching container prefix to each change summary). Read-only.
- `src/core/management-api/wire-types.ts`: optional `portfolio?: string` on `ChangeSummary`.
- `packages/ui/src/api/types.ts`: mirror `portfolio?: string` on `ChangeSummary` (hand-maintained wire mirror + `satisfies` fixture).
- `packages/ui/src/board/columns.ts`: add the Task model, `groupIntoTasks(changes, runs, sessions)`, and `deriveTaskColumn` (the child-aggregation precedence); `deriveColumn` unchanged.
- `packages/ui/src/components/BoardPage.tsx`: fetch `listSessions` alongside changes/runs; group into Tasks; render Task cards and (store spaces) the member chip row; pass the space selector into `createChange`.
- New: `packages/ui/src/components/TaskCard.tsx` (replaces per-change `BoardCard` on the board; `BoardCard` retained or folded), `packages/ui/src/components/MemberChips.tsx`.
- `packages/ui/src/components/NewChangeDialog.tsx`: accept and forward the space selector.
- `packages/ui/test/`: board grouping/column-aggregation tests, member-chip filter tests, space-scoped submission test; `src/core/management-api` change tests for portfolio detection; fixtures updated for the new field.
- No version bump; preact + preact-iso only (no React); Windows / pnpm.
