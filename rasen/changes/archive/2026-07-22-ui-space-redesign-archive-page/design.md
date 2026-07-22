## Context

Child 5 is the last child of the `ui-space-redesign` portfolio. Children 1–4 shipped the space-addressed API, the URL-as-truth shell, the Task board, and the Task detail page. The navigation already offers Board · Archive · Config (child 2), and the Archive slot resolves to `ArchivePlaceholder` — the only placeholder left in the shell. This change realizes decision #9: Archive as a first-class page (time-reverse list of archived Tasks, name search, store-space member filter), plus a bounded Done column that overflows into it.

Everything it needs already exists in shipped code:
- `getArchivedChangeIds(root)` returns the sticky-union of the in-repo archive dir and the machine-home archive as `YYYY-MM-DD-<name>` ids (de-duped, in-repo preferred; degrades to in-repo-only on any home-probe error).
- `findPortfolioContainers` / `portfolioOf` are exported from `changes.ts` (child 4 made them public) — the longest-prefix container rule the board groups by.
- `task-detail.ts` (child 4) already resolves an archived child's name (strip `YYYY-MM-DD-`) and disk location (probe in-repo archive, then `home.archiveDir`) inline; its finding 2/23 flagged this for extraction.
- The UI side has `useSpace`/`spaceHref` (opaque-token space + link building), `MemberChips` + `tasksForMember`/`isUnderRoot` (store member filter by session provenance), and `groupIntoTasks` (the board's Task grouping).

Constraints: preact + preact-iso (no React); an additive read-only server endpoint plus a behavior-preserving refactor of `task-detail.ts`; no version bump; local-only ship; Windows/pnpm. Real-source red line (decision #10): the daemon reads and spawns; it never mints or writes.

## Goals / Non-Goals

**Goals:**
- A read-only, space-wide archive-listing endpoint the Archive page consumes, resolved and secured exactly like `/changes`.
- One shared archived-name/location helper used by both `task-detail.ts` (behavior-preserving) and the new endpoint, ending the duplication child 4 flagged.
- The Archive page behind the existing `/…/archive` routes (component swap only): time-reverse Task list, name search, store member filter, links to Task detail.
- A bounded Done column on the board with a "View all in Archive →" overflow, without touching the board-ui spec.
- Retire the last placeholder.

**Non-Goals:**
- No new persisted state, no change→member durable attribution (finding 17's ceiling stands; member filter degrades to "All" for session-less archived Tasks).
- No restart/relaunch of an archived Task's specific child (finding 26c — a child-selector UI is future work).
- No move of config onto `?space=` (finding 12 — out of scope).
- No reshaping of the route table (finding 9 — swap the component only).
- No server-side search/pagination — the corpus is small; the page filters the fetched list client-side.

## Decisions

### D1. New endpoint `GET /api/v1/archive?space=<selector>`, space-wide and read-only

A new top-level management path, sibling to `/changes` and `/runs`. Response: `{ changes: ArchivedChangeSummary[] }` where each entry is `{ name, archivedAt, portfolio?, taskProgress }`.

- **Space resolution mirrors `/changes` exactly**: `resolveRequestSpace(spaceSelector)` (explicit selector → registries, omitted → `launchProjectRoot`), then `resolveHomeForRoot(root)`. No resolvable root → 400 `project_required`, the same rejection `handleChanges` returns. This is deliberate over `/runs`'s empty-list-when-no-root: the Archive page is always reached under a space route, so a selector is always present; matching the sibling read endpoint that also requires a resolvable project keeps the contract uniform. (Alternative — `/runs`'s empty-on-no-root — rejected: it would mask a genuinely unresolvable space as "no archive".)
- **Enumeration**: `getArchivedChangeIds(root)` → `parseArchivedRef` each → for each, `portfolioOf(name, containers)` for membership and `resolveArchivedChangeDir(...)` + `getTaskProgressForChange` for progress. `findPortfolioContainers(changesDir)` computed once per request (same as `handleChanges`).
- **Read-only**: every helper it calls is a reader; it mints nothing and creates no directory (decision #10). `getArchivedChangeIds` already probes home with `ensure: false`.
- **Grouping stays UI-side** (child 3 precedent — the server reports the `portfolio?` fact, the UI groups). The endpoint returns a flat archived-change list; the UI collapses it into archived Tasks. Sort order is a UI-presentation concern, so the endpoint returns the enumeration order and the page applies the time-reverse.

Alternative considered — reuse `/api/v1/tasks/:id` per Task: rejected, that needs a Task id up front, but the Archive page's whole job is to *enumerate* archived Tasks with no id in hand. The two endpoints are complementary (finding 21): `/tasks/:id` reports one Task's archived children; `/archive` reports the space's whole archived roster.

### D2. Include `taskProgress` per archived change, via the shared location helper

Each `ArchivedChangeSummary` carries `taskProgress`. Computing it needs the archived change's disk location (in-repo archive dir vs `home.archiveDir`), which is exactly the probe `task-detail.ts` does. Including it gives the archive row a real completeness signal AND makes both consumers exercise the full shared helper (the LEAD's explicit "have both use it"). `getTaskProgressForChange` never throws (swallows schema/glob failures, falls back to top-level `tasks.md`), so a stale archived schema degrades to a best-effort count, never an error. The small-corpus assumption (per-archived-change schema+glob resolution × N) holds; if a space's archive ever grows large this is the one cost worth revisiting (noted under Risks).

Alternative — a lean `{ name, archivedAt, portfolio? }` with no progress: rejected because it leaves the location-probe half of the shared helper used by only one consumer, weakly fulfilling the extraction mandate, and gives the archive row nothing beyond a name and a date.

### D3. Shared helper in `src/utils/item-discovery.ts` (behavior-preserving extraction)

`item-discovery.ts` already owns `getArchivedChangeIds`, so the archived-name/location logic belongs beside it. Add and export:
- `interface ArchivedRef { dated: string; date: string; name: string }`
- `parseArchivedRef(dated: string): ArchivedRef | null` — the `^(\d{4}-\d{2}-\d{2})-(.+)$` split, moved verbatim from `task-detail.ts`.
- `resolveArchivedChangeDir(inRepoArchiveDir: string, home: ProjectHome | null, dated: string): string` — return `inRepoArchiveDir` when `<inRepoArchiveDir>/<dated>` exists or there is no home; otherwise `home.archiveDir`. This is the exact `if (!fs.existsSync(...) && home) archiveChangesDir = home.archiveDir` branch, made a named function.

`task-detail.ts` then imports both and deletes its inline `ARCHIVED_NAME_PATTERN` / `ArchivedRef` / `parseArchivedRef` / probe. The refactor is byte-for-byte behavior-preserving — the shipped, reviewed archived-child path keeps calling the same logic, only relocated — and child 4's `task-detail` tests must stay green unchanged (the parity check). The archive endpoint calls `parseArchivedRef` for the name/date split and `resolveArchivedChangeDir` for the per-change progress read.

(`item-discovery.ts` importing `ProjectHome` for the signature is fine — it already imports `resolveProjectHome` from `project-home.js`, so there is no new dependency edge.)

### D4. Archive page: component swap behind existing routes

`app.tsx` swaps `ArchivePlaceholder` → `ArchivePage` for both `/p/:projectId/archive` and `/s/:storeId/archive` (route table shape untouched, finding 9). `ArchivePage`:
- `useSpace()` for the space; `client.listArchive(space.selector)`; on `store` type also `client.listSpaces()` for member chips (same best-effort pattern as `BoardPage`).
- Groups the flat archived list into archived Tasks with a new pure `groupArchivedTasks(changes)` in `board/columns.ts` (collapse by `portfolio ?? name`, first-appearance order, carry the max archive date per Task for sorting/display), then sorts time-reverse by that date.
- Name search: a controlled input; filter the grouped list by `task.name.includes(query)` client-side (corpus small — finding, and the LEAD's steer).
- Store member filter: render `MemberChips`; reuse `tasksForMember(tasks, sessions, memberRoot)` — but archived Tasks map to Tasks whose `children` are `ArchivedChangeSummary`, and `tasksForMember` keys on `task.children[].name` + live `sessions`. Archived Tasks generally have no live session, so this degrades to "All" (finding 17 ceiling — documented, not a bug). To reuse `tasksForMember` unchanged, `groupArchivedTasks` produces a shape carrying `children` with `name`, and the page fetches `listSessions(selector)` so the provenance test has sessions to match against.
- Each archived Task row is a link via `spaceHref(space, 'task', task.id)` (opaque-token round-trip, finding 10) — child 4's `/tasks/:id` already serves a portfolio/single Task whose children are all archived.
- Loading / error / empty are distinct explicit states, mirroring `BoardPage`/`TaskDetailPage`.

### D5. Done-column truncation in `archive-ui`, not `board-ui`

The board's Done rendering edit (recent-N slice + "View all in Archive →" footer) lives in `BoardPage.tsx`. Its requirement is placed in the new `archive-ui` capability, NOT board-ui — child 2 MODIFIED board-ui's "Board is the platform home" and child 3 MODIFIED "Board-embedded change submission" + ADDED Task requirements; adding a fourth hand into board-ui across two still-unarchived deltas risks a spec-merge collision (findings 4/13/18). Framing it as "the board overflows its Done history into the Archive page" makes it a natural archive-ui concern. Implementation: after `grouped` is built in `BoardPage`, slice the Done column's entries to the most recent N and, when truncated, render a footer `<a href={spaceHref(space,'archive')}>`. N is a small module constant (e.g. 5). The most-recent ordering within Done reuses the existing entry order; no new sort of live data is required beyond taking the tail.

Alternative — put it in board-ui as a fourth delta: rejected for the collision hazard above.

### D6. Wire mirror discipline

`ArchivedChangeSummary` / `ArchiveResponse` added to server `management-api/wire-types.ts` AND hand-mirrored in `packages/ui/src/api/types.ts`, pinned by a new `satisfies ArchiveResponse` fixture under `test/fixtures/` (no `as`, the standing tripwire). `client.listArchive(space?)` joins the file beside `listChanges`/`listRuns`, using the same `spaceQuery(selector)` seam.

## Risks / Trade-offs

- **Per-archived-change progress cost** → For each archived change the endpoint resolves a schema + glob to count tasks. On a small archive this is negligible; on a very large machine-home archive it is O(N) filesystem work per request. Mitigation: the page is not on a hot path (opened deliberately, not polled like the board), and if it ever matters the progress field can be dropped to a lazy per-Task detail fetch. Noted, not pre-optimized.
- **Behavior-preserving refactor regressing `task-detail`** → The extraction must not change child 4's shipped, reviewed archived-child behavior. Mitigation: keep child 4's `task-detail` tests unchanged as the parity check; the extracted functions are literal moves, and the refactor is done in the same task group as its verification.
- **Member filter is near-inert for archives** → Archived Tasks rarely have a live session, so the store member chip mostly collapses to "All" (finding 17). Mitigation: this is the already-documented data-layer ceiling, spec'd as expected behavior rather than hidden; the chip still works for any archived Task that does happen to retain a live session, and the search box is the primary filter.
- **Archive-order hazard at portfolio archive** → See Migration Plan; this is the portfolio-wrap-up concern, not a child-5 code risk.

## Migration Plan

Child 5 ships local-only (commit); the portfolio is delivered as one unit later. For the portfolio wrap-up (this being the last child):

1. **Archive the pre-existing slice2/slice3 leftovers FIRST** (findings 4/13): the unarchived `slice2`/`slice3-sessions-ui` changes carry stale deltas against `change-submission` / `management-http-api` / `management-ui-command` / `session-supervision` / `sessions-ui` (content already in main specs). Archiving the `ui-space-redesign` portfolio before them risks the spec-merge guard rejecting, or the `sessions-ui` delta resurrecting the deleted top-level Sessions nav.
2. **Archive the portfolio children in dependency order 1 → 2 → 3 → 4 → 5** so each `management-http-api` ADDED lands on a spec already carrying the prior ADDs: child 1 MODIFY "Changes listing…", child 3 ADDED "portfolio-container membership", child 4 ADDED "Task roster endpoint", child 5 ADDED "Archive listing endpoint" — four distinct requirements, no mutual overlap, but order-sensitive if applied as sequential deltas.
3. `archive-ui` and `task-detail-ui` are brand-new capabilities (no main spec) — pure ADDED, no merge conflict. board-ui is touched only by child 2 (MODIFY) and child 3 (MODIFY + ADDED); **child 5 deliberately does not touch board-ui** (Done truncation lives in archive-ui), so it adds no new board-ui collision surface.

## Open Questions

- **Done column N** — 5 is a reasonable default; the exact bound is a UI tuning knob, not a contract (the spec says "a bounded number", not a specific N). Left to the implementer.
- **Restarting an archived Task's child** — out of scope (finding 26c); the archive row links to read-only Task detail, which itself leaves the portfolio-Task Launch target blank.
