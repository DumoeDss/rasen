# Proposal: rasen-ui-slice1-readonly-api

## Why

Rasen has no visual surface for the thing users actually manage all day: changes and their pipeline runs. The roadmap (rasen-roadmap-research report §6) picked "kanban board over live change data" as the first vertical slice of the automation-management platform — it must be real data end to end, not a skeleton. This change delivers the low-conflict first batch: a read-only management API plus a board page, built entirely from new files so it cannot collide with the uncommitted config-page-coherence work in the main tree.

## What Changes

- New **read-only management API route group** (all-new files under `src/core/management-api/`, sibling of the existing config-api, which is not modified):
  - `GET /api/v1/status` — server identity (version, pid, launch project); every management response also carries `x-rasen-daemon: <version>` and `x-rasen-pid: <pid>` headers, the discovery contract a future adopt-or-spawn daemon mechanism will probe.
  - `GET /api/v1/changes` — active changes with schema, artifact completion, and task progress; data sourced from the same core seams as `rasen change list` / `rasen status` so the board and the CLI can never disagree.
  - `GET /api/v1/runs` — per-change pipeline run state read live from `auto-run.json` / `goal-run.json` / `portfolio-run.json` (resolved via `resolveProjectHome`, non-mutating); files are re-read on every request — no cache, no database, the filesystem stays the single source of truth.
  - Same security model as the config API: 127.0.0.1-only bind + per-session bearer token.
  - Unmatched routes delegate to the existing config-api router, so one server (and one token) serves both API groups and the static UI.
- New **kanban board page** in `packages/ui`: board components grouping changes into lifecycle columns, fed by the new endpoints through the existing single fetch seam; `app.tsx` gains one route line.
- New **hidden experimental launch command** `rasen ui` (new `src/commands/ui.ts` + one registration line in `src/cli/index.ts`) that starts the combined server and opens the board — hidden from help, existing `rasen config ui` untouched.
- **Delivery is local**: commits stay on `dev/rasen-ui-slice1`; no push, no PR (sequenced behind the config-page-coherence merge).

Explicitly out of scope (second batch / slice 3): renaming `rasen config ui`, generalizing the config-api skeleton, folding the config page into a management shell, and any daemon residency (detach, adopt-or-spawn, background scheduling).

## Capabilities

### New Capabilities

- `management-http-api`: read-only localhost management API — status endpoint with daemon identity headers, changes listing, and run-state reporting; loopback + bearer security; per-request filesystem reads.
- `board-ui`: kanban board page in the UI package showing active changes as cards in lifecycle columns with task/run status, matching CLI output.
- `management-ui-command`: hidden experimental `rasen ui` command that starts the management server (config API included via delegation) and opens the board in the browser.

### Modified Capabilities

None — existing config-api, config-ui-command, and config-ui-package requirements are unchanged; this change only adds new surfaces beside them.

## Impact

- New code: `src/core/management-api/` (server/router/handlers/wire types, mirroring config-api patterns), `src/commands/ui.ts`, board components + API client additions in `packages/ui/src`.
- Existing files touched (minimal, none on the frozen list): `src/cli/index.ts` (one import + one register call), `packages/ui/src/app.tsx` (one route), `packages/ui/src/api/client.ts` + `types.ts` (new read-only calls).
- Read-only imports (never modified): `src/core/project-home.ts`, `src/core/pipeline-registry/run-state.ts`, `src/core/pipeline-registry/portfolio-state.ts`, `src/core/config-api/*` (router delegation + static serving + UI package resolution), `src/utils/item-discovery.ts`, `src/utils/task-progress.ts`, `src/core/artifact-graph/*`.
- Tests: new `test/core/management-api/` suites + UI component tests in `packages/ui`.
- No new dependencies; no changes to existing endpoints, commands, or config behavior.
