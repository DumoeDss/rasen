## Context

Child 4 of the `ui-space-redesign` portfolio. Children 1-3 shipped: the API is space-parameterized (`?space=project:<id>|store:<id>`), the UI shell routes under `/p|s/:id/…` with `useSpace()`/`spaceHref` and an opaque-token id rule, and the board groups changes into Tasks (portfolio containers + implicit single-item changes) with a `ChangeSummary.portfolio` tag reported by the server. The board card for a Task links to `/p|s/:id/task/:changeName` (via `spaceHref(space, 'task', task.id)`), which today renders `TaskDetailPlaceholder`.

Decision #8 (locked): Task detail is an independent route page — left column children (change lifecycle + task progress + deps), right column sessions (live-on-top, log tail, kill, Launch run). A single-item Task uses the same page; its children column degrades to that one change's task checklist.

The load-bearing constraint child 3 surfaced (finding 20): the board card can only see a Task's **active** children. A portfolio's parent container (`rasen/changes/<P>/`) holds `planning-context.md` but **no `proposal.md`**, so `getActiveChangeIds` excludes it — it appears in neither `/changes` nor `/runs`. Archived children have left `/changes` for `rasen/changes/archive/<date>-<name>/`. The dependency DAG lives only in the parent's `portfolio-run.json` (`children[].dependsOn`). None of these three are reachable from existing endpoints. On-disk state today: the 5 `ui-space-redesign-*` children are all active, there is **no** `portfolio-run.json` and **no** archived child yet — so the deps and archive paths must be built but must degrade cleanly to empty.

Constraints: preact + preact-iso (no React); packages/ui has no build-time import path to the root package, so wire types are hand-mirrored and pinned by `satisfies` fixtures. Real-source red line (decision #10): the daemon only reads and spawns; no new path writes or mints. Windows; pnpm. No version bump. Local-only ship.

## Goals / Non-Goals

**Goals:**
- Replace `TaskDetailPlaceholder` with a real route page at the existing route, swapping the component only (route table is child 2's — finding 9).
- Resolve the polymorphic `:changeName` (portfolio container OR bare change) authoritatively, including a container whose children are *all* archived (invisible to `/changes`).
- Left column: children with lifecycle column, task-checkbox progress, dependency hints; single-item Task shows that change's checklist. Portfolio "N/M changes" reflects the true active+archived roster (corrects finding 20b).
- Right column: the Task's sessions, live on top, expandable output tail, confirm-first kill, and a Launch run carrying the space + Task change context — by mounting the retained `SessionRow`/`LaunchSessionDialog`.
- Everything space-scoped through `useSpace()`/`spaceQuery`/`spaceHref` with the opaque-token rule intact.

**Non-Goals:**
- The Archive **page** (the global list of every archived Task) — that is child 5. This page reads only the archived *children of the current Task*.
- Store-scoped config, durable change→member attribution, kanban drag, any new persisted status field.
- Machine-home archive destination reconciliation for archived children (see Risks) — best-effort in-repo + home union via the existing `getArchivedChangeIds`, no new location logic.

## Decisions

### D1 — Roster assembly: one new read-only endpoint `GET /api/v1/tasks/:id`, not client-side composition

The page needs four things existing endpoints cannot supply: (a) archived children of a Task (no archive endpoint exists — child 5 has not shipped), (b) the parent container's `portfolio-run.json` deps (the container is not an active change, absent from `/runs`), (c) authoritative Task existence/kind when a container has zero active children, (d) task **checklist items** for the single-Task degenerate case (existing helpers report only counts). All four require server-side reads. Composing "active from `/changes` + archived from elsewhere" would also leave a reconciliation seam during the archive transition (a child briefly in both lists). So a single additive endpoint owns roster assembly.

`GET /api/v1/tasks/:id?space=<selector>` resolves the space exactly like `/changes` (explicit selector through the machine registries, omitted → launch-project fallback; no root → 400 `project_required`), then `handleTaskDetail(root, home, id)`:

1. **Kind resolution.** `id` is a **portfolio** when `rasen/changes/<id>/planning-context.md` exists (reusing child 3's `findPortfolioContainers` rule). Otherwise `id` must be an active change (`getActiveChangeIds`) or an archived change → **single**. Neither → 404 `task_not_found`. `id` is validated by `validateChangeName` first; junk → 400 `invalid_input`.
2. **Active children.** `getActiveChangeIds(root)`, keep those whose `portfolioOf(name, allContainers) === id` (longest-prefix, so a nested container's grandchild is not mis-claimed). For a single Task, the sole child is `id` itself. Each active child gets its `ChangeSummary` (same `loadChangeContext`/`formatChangeStatus`/`isApplyReady`/`getTaskProgressForChange` path `/changes` uses) plus a `buildChangeRunEntry` run join (the same helper `/runs` and `sessions.ts` use), plus parsed task items.
3. **Archived children.** `getArchivedChangeIds(root)` returns dated dir names (`YYYY-MM-DD-<name>`, sticky-union of in-repo + machine-home archive). Strip the date prefix, keep those whose stripped name matches this Task under `portfolioOf` (containers ∪ `[id]`). Each archived child reports `archived: true`, `archivedAt` (the date), and best-effort task progress/items; its lifecycle is **`done` by definition** (archived ⇒ shipped) — the UI never runs `deriveColumn` on an archived child.
4. **Dependency DAG + portfolio status.** For a portfolio, `resolvePortfolioStateLocation(containerDir, home.workDir(id))` + `readPortfolioState`; index `children[]` by `id` → each roster child's `dependsOn` and `portfolioStatus`. Absent file → empty deps, no status (today's actual state). Single Task → no deps.

**Alternative rejected:** extend `/changes` to include archived + portfolio-run data. Rejected — it would bloat the board's hot listing with data only the detail page needs and blur the "facts only, column is UI policy" contract `/changes` holds.

### D2 — Response shape: reuse `ChangeSummary`/`ChangeRunEntry`, add `TaskChildDetail`/`TaskDetailResponse`

```
TaskChildDetail = {
  name: string;                    // un-dated change name
  archived: boolean;
  archivedAt?: string;             // 'YYYY-MM-DD' when archived
  taskProgress: { total: number; completed: number };
  tasks: { text: string; done: boolean }[];   // best-effort checklist items
  summary: ChangeSummary | null;   // active: real; archived: null (column forced 'done')
  run: ChangeRunEntry | null;      // active with changeName run join; else null
  dependsOn: string[];             // from portfolio-run.json; empty when absent
  portfolioStatus?: StageStatus;   // portfolio-run.json child.status, when present
  loadError?: string;              // active child whose context failed to load (mirrors /changes' errors)
}
TaskDetailResponse = {
  task: { id: string; kind: 'portfolio' | 'single'; label: string };
  children: TaskChildDetail[];
  errors: ChangeLoadError[];       // task-level degradation, same envelope as /changes
}
```

`taskProgress` sits at child level (not only inside `summary`) so archived children — which have no `summary` — still carry counts. `summary: null` + `archived` flag keeps the UI from fabricating artifact facts for a shipped change: the UI computes each child's column as `archived ? 'done' : (summary ? deriveColumn(summary, run ?? undefined).column : 'planning')`. Portfolio progress = `{ done: children.filter(done-or-archived).length, total: children.length }` — the true roster (fixes finding 20b). `tasks[]` is included uniformly for every child (cheap on a localhost single-user tool); the UI renders it as a checklist for the single Task and as a progress bar (with optional expand) for portfolio children. New task-item parsing reuses the exact tracked-tasks file resolution `getTaskProgressForChange` uses, capturing item text alongside the checkbox — a small `listTaskItemsForChange` sibling in `task-progress.ts`.

Both `TaskChildDetail` and `TaskDetailResponse` are added to `src/core/management-api/wire-types.ts` (source of truth) and hand-mirrored into `packages/ui/src/api/types.ts`, pinned by a new `satisfies TaskDetailResponse` fixture — the same drift discipline every other management type follows.

### D3 — Route wiring: swap the component, add a GET-only path matcher

`app.tsx` changes only the two task routes' `component={TaskDetailPlaceholder}` → `component={TaskDetailPage}` (finding 9 permits swapping the component behind an existing route; it forbids reshaping the table). `TaskDetailPlaceholder` is retired from `Placeholders.tsx`; `ArchivePlaceholder` stays for child 5. Server router adds `matchTaskIdPath` (mirrors `matchSessionIdPath`: `/api/v1/tasks/<single-segment>`, decoded, GET-only) alongside `isManagementPath`/`isMethodAdmitted`, resolving space via the existing `resolveRequestSpace` and dispatching to `handleTaskDetail`. Additive — no existing route or method changes.

### D4 — Sessions column: mount `SessionRow`/`LaunchSessionDialog`, keep mapping in `columns.ts`

The page fetches `listSessions(space)` and filters to entries whose `session.changeName` ∈ the Task's child names, reusing the mapping idea already in `groupIntoTasks`. To keep that logic in the tested pure module, `board/columns.ts` exports `LIVE_SESSION_STATES` and `sessionStage` (currently private) and adds `sessionsForTask(sessions, childNames): { live, ended }` (live sorted first). The component maps `SessionRow` over `[...live, ...ended]` — `SessionRow` already owns the expandable output tail (its "log tail") and the confirm-first kill via `killSession`, so nothing is reimplemented. On kill, the page drops the local override and refetches (`SessionRow`'s existing `KillOutcome` contract). **Launch run** mounts `LaunchSessionDialog`, extended with additive `space?: string` (passed into `launchSession` body — the wire already accepts `space`) and a prefilled `changeName` (the single Task's change; blank for a portfolio, since a container is not a change — the user names the target). Live ⦿ / stage on the page header reuses `sessionStage` on the first live session.

### D5 — Space-scoping and the opaque-token rule

`useSpace()` gives `{ type, id, selector }`; `:changeName` comes from `useRoute().params`. Every read passes `useSpace().selector` through `client.getTaskDetail`/`listSessions` → `spaceQuery`. Links (e.g. back to board) use `spaceHref(space, 'board')`. The id after the namespace prefix is never normalized/re-cased/path-canonicalized (design D5 of child 2); `:changeName` is likewise used verbatim as the Task id, only `encodeURIComponent`-guarded where a route/query segment requires it.

## Risks / Trade-offs

- **Machine-home archived children location** → `getArchivedChangeIds` unions in-repo + `home.archiveDir` dated names but does not say which dir holds each. For per-archived-child task progress the handler probes in-repo first, then `home.archiveDir` (a few lines, no shared-util change). If neither read succeeds, `getTaskProgressForChange` already degrades to `{0,0}` and the child still renders as done. No correctness loss, only a possibly-empty archived task bar.
- **Container with both `planning-context.md` and `proposal.md`** (the self-referencing edge child 3 flagged) → `planning-context.md` wins: kind = portfolio, and the self-named change is included as one of its own children (it also carries `portfolio === id` from child 3). Renders coherently; no loop.
- **Portfolio child not directly reachable from the board** → the board groups a change with a `portfolio` tag under the portfolio card, so its bare `:changeName` is not normally navigated to. A deep-link to a portfolio child's own name resolves as a single Task (that one change alone) — graceful, not an error.
- **Endpoint payload size** → uniform `tasks[]` per child is wasteful for large portfolios, but this is a localhost single-user daemon; a few hundred task lines is negligible. Not optimizing.
- **Deps absent today** → `portfolio-run.json` does not exist for `ui-space-redesign`; the deps section must render "no declared dependencies" without error, which is the common case until a decomposed run writes one.

## Migration Plan

Additive only. New endpoint + new UI component + component swap on an existing route. No schema, no persisted state, no version bump. Rollback = revert the component swap (route falls back to the placeholder) and drop the endpoint; nothing else references either. Ships local (commit only); archived at portfolio level alongside the unarchived slice2/slice3 deltas (finding 4/13).

## Open Questions

- **Launch run target for a portfolio Task** — prefilled change-name is blank (a container is not a change). Whether the dialog should instead offer a child picker is deferred; the text field suffices for now. Flagged to child 5 / future.
- **Durable change→member attribution** — unchanged data-layer gap (child 3 finding 17); the sessions column inherits the same session-provenance ceiling. Out of scope here.
