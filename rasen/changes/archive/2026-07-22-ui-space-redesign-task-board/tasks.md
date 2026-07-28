## 1. Server: portfolio-membership fact (additive, read-only)

- [x] 1.1 Add optional `portfolio?: string` to `ChangeSummary` in `src/core/management-api/wire-types.ts` (comment: filesystem-derived membership, like `hasRunFiles`).
- [x] 1.2 In `src/core/management-api/changes.ts`, after enumerating `changeIds`, enumerate sibling directories under `changesDir` that contain a `planning-context.md` (portfolio containers). Use `fs`/`path` cross-platform (no hardcoded separators); read-only, mint nothing.
- [x] 1.3 For each active change, attach `portfolio: P` where `P` is the LONGEST container name such that the change name equals `P` or starts with `P + '-'`; omit the field when no container matches. Compute the container set once per request, not per change.
- [x] 1.4 Confirm the portfolio parent (no `proposal.md`) stays excluded from the listing — `getActiveChangeIds` already enforces this; add a test asserting the container is absent while its children each carry `portfolio`.
- [x] 1.5 Tests in `test/` (server): child changes report the longest container; a bare change reports none; coincidental prefix with no `planning-context.md` container reports none; derivation creates/modifies no registry, identity, or directory.

## 2. UI wire mirror

- [x] 2.1 Mirror `portfolio?: string` on `ChangeSummary` in `packages/ui/src/api/types.ts`, matching the server field and its comment discipline.
- [x] 2.2 Update the `satisfies ChangesResponse` fixture(s) in `packages/ui/test/fixtures/*.ts` to include changes with and without `portfolio` (no `as` casts — keep the `tsc` drift tripwire intact).

## 3. Task model, grouping, and column aggregation (`columns.ts`)

- [x] 3.1 In `packages/ui/src/board/columns.ts`, add the `Task` interface (`id`, `label`, `kind: 'portfolio' | 'single'`, `children: ChangeSummary[]`, `column`, `escalated`, `progress: {done,total}`, `liveStage?`). Keep the module pure (no DOM, no fetch).
- [x] 3.2 Add `deriveTaskColumn(children, runsByName)`: run the existing `deriveColumn` per child, aggregate by precedence In Progress > Ready > Planning > Done (terminal only when every child is Done); `escalated` = OR of children's `deriveColumn().escalated`. Leave `deriveColumn` unchanged.
- [x] 3.3 Add `groupIntoTasks(changes, runsByName, sessions)`: group changes by `portfolio` into portfolio Tasks (id/label = container name) and map each change without `portfolio` to a single-item Task (id/label = change name); compute each Task's `column`, `escalated`, and `progress` (portfolio: done-children/board-children as "N/M changes"; single: the change's own `taskProgress`).
- [x] 3.4 Compute `liveStage` and the `⦿` flag from live sessions: a Task is live when a session in `LIVE_SESSION_STATES` targets one of its children (`session.changeName` → child); `liveStage` from the session's joined `runState` when `ok`, else `session.task`.
- [x] 3.5 Tests: portfolio grouping from `portfolio` field; single-item fallback; aggregation precedence cases ([in-progress,planning]→In Progress; [done,planning]→Planning; [done,ready]→Ready; [done,done]→Done); escalation OR; progress counts; live-session→Task mapping and `liveStage`.

## 4. Task card and member chips (components)

- [x] 4.1 Add `packages/ui/src/components/TaskCard.tsx`: renders label, progress ("N/M changes" | "N/M tasks"), escalation badge, `⦿ liveStage` when live, wrapped in a link to `spaceHref(space, 'task', task.id)` (opaque-token discipline — no id re-derivation).
- [x] 4.2 Update `BoardColumn`/`BoardColumnEntry` (`components/BoardColumn.tsx`) to carry a `Task` (or a thin `TaskColumnEntry`) and render `TaskCard`; keep the broken-change (`errors[]`) list on the raw `BoardCard`/its own path (a load error is not a Task).
- [x] 4.3 Add `packages/ui/src/components/MemberChips.tsx`: renders "All" + one chip per `members[]` entry; controlled selection (selected member id | null); no chip row for a project space.
- [x] 4.4 Tests: TaskCard portfolio vs single rendering, live indicator presence/absence, detail link href round-trips an opaque id; MemberChips render + selection + project-space suppression.

## 5. BoardPage integration

- [x] 5.1 In `packages/ui/src/components/BoardPage.tsx`, add `listSessions(selector)` to the parallel fetch alongside `listChanges`/`listRuns`; keep `selector` as the effect dep so all three re-fetch on space change.
- [x] 5.2 Replace the flat per-change grouping with `groupIntoTasks(...)`; place each Task via its aggregated `column`; render Task columns. Preserve the existing loading / error / empty / broken-change states.
- [x] 5.3 In a store space, fetch the store's `members[]` (from `listSpaces()`, matched to `useSpace()`), render `MemberChips`, and filter Tasks by session-provenance attribution (a Task's session `cwd` under the selected member's `root`, canonical path prefix); "All" shows every Task; unattributed Tasks appear only under "All". Project spaces: no chips, no filter.
- [x] 5.4 Thread `useSpace().selector` into `NewChangeDialog` (see group 6) and confirm the highlighted-new-change flow still matches the real card read back from disk.
- [x] 5.5 Tests (`app.test.tsx` / board component test): store board shows chips and filters by member; project board shows none; live `⦿` appears for a Task with a live session; grouping renders portfolio + single Tasks in the right columns.

## 6. Space-scoped new-change submission (carryover fix)

- [x] 6.1 Add a `space?: string` prop to `packages/ui/src/components/NewChangeDialog.tsx`; include it in `client.createChange({ name, description, space })`.
- [x] 6.2 Pass `useSpace().selector` from `BoardPage` into `NewChangeDialog`.
- [x] 6.3 Test: submitting from a non-launch/store space sends the selector in the request body; the launch-project fallback (no space) is preserved.

## 7. Validation

- [x] 7.1 `rasen validate "ui-space-redesign-task-board"` passes.
- [x] 7.2 `pnpm --filter @atelierai/rasen-ui test` and the root package's management-api tests pass on Windows (rerun once if a known CLI-spawning EBUSY/timeout flake trips — see `[[windows-test-flakiness]]`).
- [x] 7.3 `pnpm --filter @atelierai/rasen-ui build` / `tsc` clean (no wire-mirror drift; fixtures use `satisfies`, not `as`).
