## 1. Shared archived-name/location helper (behavior-preserving extraction)

- [x] 1.1 In `src/utils/item-discovery.ts`, add and export `interface ArchivedRef { dated; date; name }` and `parseArchivedRef(dated): ArchivedRef | null` — the `^(\d{4}-\d{2}-\d{2})-(.+)$` split moved verbatim from `task-detail.ts` (D3).
- [x] 1.2 In `src/utils/item-discovery.ts`, add and export `resolveArchivedChangeDir(inRepoArchiveDir, home, dated): string` — return the in-repo archive dir when `<inRepoArchiveDir>/<dated>` exists or `home` is null, else `home.archiveDir` (the exact probe branch from `task-detail.ts`). Import `ProjectHome` from `project-home.js`.
- [x] 1.3 Refactor `src/core/management-api/task-detail.ts` to import `parseArchivedRef`/`resolveArchivedChangeDir`/`ArchivedRef` from `item-discovery.ts` and delete its inline `ARCHIVED_NAME_PATTERN`, `ArchivedRef`, `parseArchivedRef`, and the in-repo-then-home probe. Behavior byte-identical (D3).
- [x] 1.4 Confirm child 4's existing `task-detail` tests (`test/core/management-api/task-detail.test.ts`, `task-detail-api.test.ts`) pass unchanged — the extraction's parity check.

## 2. Archive-listing endpoint (server)

- [x] 2.1 Add `ArchivedChangeSummary { name; archivedAt; portfolio?; taskProgress }` and `ArchiveResponse { changes: ArchivedChangeSummary[] }` to `src/core/management-api/wire-types.ts`.
- [x] 2.2 Create `src/core/management-api/archive.ts` with `handleArchive(root, home)`: enumerate `getArchivedChangeIds(root)` → `parseArchivedRef` → for each, `portfolioOf(name, findPortfolioContainers(changesDir))` for membership and `resolveArchivedChangeDir(archiveDir, home, dated)` + `getTaskProgressForChange` for progress. Read-only; 400 `project_required` on no root, mirroring `handleChanges` (D1/D2).
- [x] 2.3 Wire `/api/v1/archive` into `src/core/management-api/router.ts`: add to `MANAGEMENT_PATHS`, GET-only (covered by the generic GET admit), and a handler branch resolving space via `resolveRequestSpace` + `resolveHomeForRoot` exactly like the `/changes` branch (D1).
- [x] 2.4 Add server tests for `handleArchive` / the route: date + portfolio membership + progress reported; in-repo ∪ home union; empty archive → empty listing; explicit-selector vs launch-fallback vs unresolvable-space parity with `/changes`; strictly no writes.

## 3. UI wire mirror + client

- [x] 3.1 Mirror `ArchivedChangeSummary`/`ArchiveResponse` in `packages/ui/src/api/types.ts` (hand-maintained, field-for-field).
- [x] 3.2 Add a `satisfies ArchiveResponse` fixture under `packages/ui/test/fixtures/` (no `as`) and reference it from the fixtures test.
- [x] 3.3 Add `client.listArchive(space?)` in `packages/ui/src/api/client.ts` using the `spaceQuery(selector)` seam, beside `listChanges`/`listRuns`.

## 4. Archived-Task grouping (pure)

- [x] 4.1 Add `groupArchivedTasks(changes: ArchivedChangeSummary[])` to `packages/ui/src/board/columns.ts`: collapse by `portfolio ?? name` in first-appearance order, carry each Task's `name`, `kind`, `children` (name-bearing), and the max archive date for sort/display (D4).
- [x] 4.2 Add tests for `groupArchivedTasks`: portfolio collapse, single-item passthrough, max-date carry, order.

## 5. Archive page (replaces the placeholder)

- [x] 5.1 Create `packages/ui/src/components/ArchivePage.tsx`: `useSpace()`, fetch `listArchive(selector)` (+ `listSpaces()`/`listSessions(selector)` for store member chips), group via `groupArchivedTasks`, sort time-reverse by archive date; distinct loading/error/empty states (D4).
- [x] 5.2 Add the name-search control filtering the grouped list client-side by `task.name`.
- [x] 5.3 In a store space, render `MemberChips` and apply `tasksForMember(tasks, sessions, memberRoot)`; document the session-provenance "All" ceiling in a comment; no chips in a project space (D4).
- [x] 5.4 Link each archived Task row to `spaceHref(space, 'task', task.id)` (opaque-token round-trip).
- [x] 5.5 In `packages/ui/src/app.tsx`, swap `ArchivePlaceholder` → `ArchivePage` for both `/p/:projectId/archive` and `/s/:storeId/archive` (route shape untouched); delete `packages/ui/src/components/Placeholders.tsx` and its import (last placeholder retired).
- [x] 5.6 Add component tests: renders grouped archived Tasks most-recent-first, search filters, store member chips filter, empty state, links to detail.

## 6. Done-column truncation (board)

- [x] 6.1 In `packages/ui/src/components/BoardPage.tsx`, cap the Done column to the most recent N Task entries (module constant, e.g. 5) and render a "View all in Archive →" footer linking to `spaceHref(space, 'archive')` only when truncated; other columns unchanged (D5).
- [x] 6.2 Add tests: Done truncates + footer appears past the bound; under the bound shows all and no footer; other columns unaffected.

## 7. Verification

- [x] 7.1 Run the UI package tests and the root management-api tests; confirm green (including the unchanged child-4 task-detail parity tests).
- [x] 7.2 `rasen validate ui-space-redesign-archive-page` clean; typecheck both packages (no `as` in the new wire mirror).
