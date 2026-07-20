# Tasks: rasen-ui-slice1-readonly-api

## 1. Management API core (`src/core/management-api/`)

- [x] 1.1 Create `wire-types.ts`: response shapes for status, changes listing (per-change name / schemaName / artifact statuses / applyReady / task counts / run-file presence), and runs reporting (per-file `ok | invalid | absent` tagged results), plus the shared error envelope re-use
- [x] 1.2 Create `changes.ts` handler: enumerate via `getActiveChangeIds`, load per-change status via `loadChangeContext` + artifact-graph completion, task counts via `countTasksFromContent`; error envelope (not empty success) when no project resolves (spec: changes listing matches CLI)
- [x] 1.3 Create `runs.ts` handler: per active change resolve home via `resolveProjectHome(root, { ensure: false })`, locate `auto-run.json` via `resolveRunStateLocation` (workDir first, changeDir legacy fallback); parse auto-run with detailed ok/invalid/absent semantics, portfolio via `readPortfolioState`, goal-run as raw JSON with validity flag; per-change failures degrade to error entries (design D5)
- [x] 1.4 Create `router.ts`: bearer auth + `GET /api/v1/status` (version, pid, launch project) + dispatch to changes/runs handlers; 405 for non-GET on management paths; delegate all unmatched requests to config-api `createRouter` with the same token/context (design D2)
- [x] 1.5 Create `server.ts`: copy config-api lifecycle pattern (loopback bind, socket tracking, 2s shutdown guard); stamp `x-rasen-daemon` / `x-rasen-pid` on every response before routing, including delegated and 401 responses (design D3)

## 2. Launch command

- [x] 2.1 Create `src/commands/ui.ts`: hidden `rasen ui` command with `--no-open` / `--port` (port validation matching `config ui`), token mint, launch-project + UI assets resolution, start management server, print `http://127.0.0.1:<port>/board#token=<token>`, browser open, SIGINT/SIGTERM shutdown, UI-package install hint when assets missing
- [x] 2.2 Register it in `src/cli/index.ts` (one import + one `registerUiCommand(program)` line); verify `rasen --help` does not list `ui`

## 3. Management API tests (`test/core/management-api/`)

- [x] 3.1 Router/auth tests: 401 without token, 405 on non-GET management paths, identity headers present on 200 / 401 / delegated / static responses
- [x] 3.2 Changes endpoint tests against a fixture project: listing matches `getActiveChangeIds` + status seams (active only, archived excluded; artifact statuses and task counts correct; no-project error envelope)
- [x] 3.3 Runs endpoint tests: valid auto-run reported with stages; corrupt auto-run surfaces `invalid` with reason while request succeeds; absent files reported `absent`; portfolio and goal-run files read from resolved dir; unregistered project (`ensure: false` → null) falls back to changeDir and provably creates no registry entry / home dir
- [x] 3.4 Delegation test: config endpoints (`/api/v1/health`, `/api/v1/config`) answer correctly through the management server with the same token; freshness test: on-disk change mutated between two requests is reflected in the second

## 4. Board UI (`packages/ui`)

- [x] 4.1 Add wire types to `src/api/types.ts` and `getStatus()` / `listChanges()` / `listRuns()` to `src/api/client.ts` (single-seam, no direct fetch)
- [x] 4.2 Create `src/board/columns.ts`: pure `deriveColumn(change, run)` per design D8 (Planning / Ready / In Progress / Done; escalation as badge flag) with unit tests
- [x] 4.3 Create `BoardCard.tsx` (name, schema, task progress, run indicator, escalation badge) and `BoardColumn.tsx` using the existing warm editorial design tokens
- [x] 4.4 Create `BoardPage.tsx`: fetch changes + runs on mount, loading / error / empty states, manual refresh; add the single `<Route path="/board" component={BoardPage} />` line to `app.tsx`
- [x] 4.5 Component tests: column grouping renders per fixture data, empty state, error state, 401 triggers the re-launch notice path

## 5. Runtime verification and wrap-up

- [x] 5.1 Build the UI package and run `rasen ui` in this worktree: confirm board renders real changes for this project, identity headers visible via `curl -i`, and board content matches `rasen change list` output (roadmap acceptance)
  - **Correction (review round 1 M3b)**: `resolveUiPackageDir()` (`src/core/config-api/ui-package.ts`, unmodified) does not resolve `packages/ui` as a workspace member — this repo has no `pnpm-workspace.yaml`. A bare `rasen ui` in this worktree therefore prints the install-hint page, exactly as `rasen config ui` does under the same condition (a pre-existing limitation of the shared resolver, not something this change introduces or fixes). To actually exercise the built board, the verification below used a temporary sibling-directory symlink matching the resolver's own fallback probe (`<cliPackageRoot>/../@atelierai/rasen-ui` → `packages/ui`, after `vite build`) — not part of delivery, removed afterward. With that symlink in place: `rasen ui --no-open --port 8936` served the real board bundle at `/board` (verified the served JS contains this session's board-specific strings — `board-card--broken`, `board-page__loading`, `No active changes`), `curl -i` showed `x-rasen-daemon`/`x-rasen-pid` on `/board`, `/api/v1/status`, and `/api/v1/changes`, and `/api/v1/changes` returned the same 6 change names `rasen list` shows minus the 4 excluded by the `getActiveChangeIds`/`proposal.md` gap tracked as M1 (routed separately, not fixed here).
- [x] 5.2 Verify `rasen config ui` still works unchanged and its responses carry no identity headers
- [x] 5.3 Run full `pnpm test` + lint; confirm zero edits to `src/core/config-api/*`, `src/core/project-home.ts`, `src/core/pipeline-registry/run-state.ts` (`git diff --stat` audit)
- [x] 5.4 Commit on `dev/rasen-ui-slice1` (local delivery — no push, no PR)
