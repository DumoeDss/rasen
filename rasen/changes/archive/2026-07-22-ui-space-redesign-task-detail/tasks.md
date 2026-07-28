## 1. Server — roster helpers (reuse, don't reinvent)

- [x] 1.1 Export `findPortfolioContainers` and `portfolioOf` from `src/core/management-api/changes.ts` (make the two private helpers public) so the task-detail handler shares child 3's container/longest-prefix rule verbatim.
- [x] 1.2 Add `listTaskItemsForChange(changesDir, changeName, projectRoot)` to `src/utils/task-progress.ts` returning `{ text: string; done: boolean }[]`, reusing the same tracked-tasks file resolution (`resolveTrackedTasksGlob` + `resolveArtifactOutputs`, single-`tasks.md` fallback) that `getTaskProgressForChange` uses; never throws (missing/unreadable → `[]`).

## 2. Server — Task roster wire types

- [x] 2.1 Add `TaskChildDetail` and `TaskDetailResponse` to `src/core/management-api/wire-types.ts` per design D2 (reusing `ChangeSummary`, `ChangeRunEntry`, `StageStatus`, `ChangeLoadError`; `taskProgress` and `tasks` at child level; `summary`/`run` nullable; `dependsOn`/`portfolioStatus`/`archivedAt`/`loadError`).

## 3. Server — Task roster handler

- [x] 3.1 Create `src/core/management-api/task-detail.ts` with `handleTaskDetail(root, home, id): Promise<TaskDetailResult>` (result union mirroring `ChangesResult`: `ok` | `{status,code,message}`).
- [x] 3.2 Validate `id` with `validateChangeName` (junk → 400 `invalid_input`); require a resolvable `root` (absent → 400 `project_required`, matching `/changes`).
- [x] 3.3 Resolve kind: `planning-context.md` in `changes/<id>/` → portfolio; else `id` in `getActiveChangeIds` or (date-stripped) `getArchivedChangeIds` → single; else 404 `task_not_found`. Guard the both-files self-referencing edge by preferring portfolio (design D1/Risks).
- [x] 3.4 Assemble active children: `getActiveChangeIds`, keep `portfolioOf(name, allContainers) === id` (single Task → `[id]`); build each child's `ChangeSummary` via the same `loadChangeContext`/`formatChangeStatus`/`isApplyReady`/`getTaskProgressForChange` path as `changes.ts`, plus a `buildChangeRunEntry` run join and `listTaskItemsForChange`; degrade an unloadable active child into `loadError` + task-level `errors` (mirror `changes.ts`).
- [x] 3.5 Assemble archived children: `getArchivedChangeIds(root)`, strip the `YYYY-MM-DD-` prefix, keep matches under `portfolioOf`; set `archived: true`, `archivedAt`, `summary: null`, `run: null`, best-effort `taskProgress`/`tasks` (probe in-repo archive dir then `home.archiveDir`; missing → `{0,0}`/`[]`).
- [x] 3.6 Attach deps: for a portfolio, `resolvePortfolioStateLocation(containerDir, home?.workDir(id))` + `readPortfolioState`; index `children[]` by id → each roster child's `dependsOn` + `portfolioStatus`; absent file → empty deps (no error). Single Task → no deps.
- [x] 3.7 Return `{ task: { id, kind, label: id }, children, errors }` with children in a stable order (active first in `getActiveChangeIds` order, then archived).

## 4. Server — router wiring

- [x] 4.1 Add `matchTaskIdPath(pathname)` to `src/core/management-api/router.ts` (mirrors `matchSessionIdPath`: prefix `/api/v1/tasks/`, exactly one segment, decoded; no UUID constraint — a change name); admit GET only in `isMethodAdmitted`; include it in `isManagementPath`.
- [x] 4.2 In `handle()`, dispatch a matched task-id GET: resolve space via the existing `resolveRequestSpace` (400/404/409 as `/changes`), `resolveHomeForRoot`, call `handleTaskDetail`, send 200 or the error envelope. No POST/DELETE/other method on this path.

## 5. UI — client + mirrored types

- [x] 5.1 Mirror `TaskChildDetail`/`TaskDetailResponse` into `packages/ui/src/api/types.ts` field-for-field (hand-mirror discipline); add a `satisfies TaskDetailResponse` fixture under `packages/ui/test/fixtures/` (no `as`).
- [x] 5.2 Add `getTaskDetail(id, space?)` to `packages/ui/src/api/client.ts` → `GET /api/v1/tasks/${encodeURIComponent(id)}${spaceQuery(space)}` through the single `request()` seam.

## 6. UI — columns.ts reuse surface

- [x] 6.1 In `packages/ui/src/board/columns.ts` export `LIVE_SESSION_STATES` and `sessionStage` (currently private); add pure `sessionsForTask(sessions, childNames: Set<string>): { live: SessionListEntry[]; ended: SessionListEntry[] }` with live ordered first. No change to `deriveColumn`/`groupIntoTasks`.

## 7. UI — Task detail page

- [x] 7.1 Create `packages/ui/src/components/TaskDetailPage.tsx`: `useSpace()` for the selector, `useRoute().params.changeName` for the Task id; fetch `getTaskDetail(id, selector)` + `listSessions(selector)` with polling and loading/error/not-found states (401 handled by the token seam).
- [x] 7.2 Left column (children): each child row shows lifecycle column (`archived ? 'done' : summary ? deriveColumn(summary, run ?? undefined).column : 'planning'`), task-checkbox progress, and dependency hints (`dependsOn`); portfolio header shows "N/M changes" over the true roster (`done = active-done + archived`, `total = all`). For a single-item Task, render the sole child's `tasks[]` as a checklist.
- [x] 7.3 Right column (sessions): `sessionsForTask(sessions, childNames)` → map `SessionRow` over `[...live, ...ended]` (reusing its expandable tail + confirm-first kill); on `KillOutcome` drop any local override and refetch; a live ⦿/stage in the header via `sessionStage` on the first live session.
- [x] 7.4 Launch run: mount `LaunchSessionDialog`, passing the space selector and a prefilled `changeName` (single Task → its change; portfolio → blank); on launch success, refetch sessions.

## 8. UI — dialog props + route swap

- [x] 8.1 Extend `packages/ui/src/components/LaunchSessionDialog.tsx` with additive optional props `space?: string` and a `changeName` prefill; thread `space` into the `client.launchSession` body (wire already accepts `space`). Existing (unmounted) usage unaffected.
- [x] 8.2 In `packages/ui/src/app.tsx` swap both task routes' `component={TaskDetailPlaceholder}` → `component={TaskDetailPage}` (component swap only — route table shape unchanged, finding 9); remove `TaskDetailPlaceholder` from `Placeholders.tsx` and its import, keeping `ArchivePlaceholder` for child 5.

## 9. Tests

- [x] 9.1 Server: `handleTaskDetail` — portfolio roster (active+archived, deps present and absent), single-item Task, all-children-archived portfolio, unknown id 404, self-referencing edge, invalid id 400, and a read-only assertion (no files created).
- [x] 9.2 Server: router — `matchTaskIdPath` accepts one decoded segment, GET-only (405 on POST/DELETE), space resolution parity with `/changes`; `isManagementPath` includes it.
- [x] 9.3 UI pure: `sessionsForTask` (live-first ordering, changeName filter), and `listTaskItemsForChange` item/`done` parsing.
- [x] 9.4 UI component/fixture: `TaskDetailPage` renders portfolio vs single vs not-found; the `satisfies TaskDetailResponse` fixture compiles; sessions column live-on-top + kill refetch; Launch run submits space + changeName.

## 10. Verify

- [x] 10.1 `pnpm test` (root + `packages/ui`) green; typecheck clean (no `as` on the new fixture); `rasen validate ui-space-redesign-task-detail --strict` passes.
