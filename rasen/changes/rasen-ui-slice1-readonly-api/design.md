# Design: rasen-ui-slice1-readonly-api

## Context

The config API (`src/core/config-api/`, ~1050 LOC) already solved the hard localhost-server problems for this codebase: loopback-only bind, per-session bearer token, socket-tracked shutdown (undici keep-alive once hung CLI exit ~10 s), hand-rolled `/api/v1/*` dispatch with clean 401/400 semantics, static serving of the optional UI package with an install-hint fallback. This change adds a second, read-only route group beside it for management data (changes, runs, server identity), plus the first board page in `packages/ui`.

Hard constraints inherited from planning (see `planning-context.md`):

- `src/core/config-api/*`, `src/core/project-home.ts`, and `src/core/pipeline-registry/run-state.ts` are import-only — the latter two have uncommitted edits in the main working tree, so touching them guarantees a merge conflict.
- The API is strictly read-only and per-request: every response is computed from a fresh filesystem read. The daemon is never a source of truth.
- Security model is identical to the config API: `127.0.0.1` bind + bearer token minted at startup.
- Delivery mode is local (branch `dev/rasen-ui-slice1`, no push/PR).

Reference pattern: omnicross's AdminServer stamps `x-omnicross-daemon`/`x-omnicross-pid` on every response so consumers can classify what answered a probe; this slice adopts the same discovery contract under `x-rasen-*` to prepare for adopt-or-spawn in slice 3.

## Goals / Non-Goals

**Goals:**

- Read-only management endpoints (`status`, `changes`, `runs`) whose data provably matches the workflow's active-change definition (`getActiveChangeIds`, the `rasen status` source of truth), because they call the same core functions those commands call. Deliberately not parity with `rasen list` — see D4.
- Daemon identity headers on every management response, establishing the discovery contract early.
- A kanban board page rendering real change data, reachable through a launch entry that does not disturb `rasen config ui`.
- Zero edits to the frozen files; minimal deltas to `src/cli/index.ts`, `app.tsx`, and the UI API client.

**Non-Goals:**

- No writes of any kind through the API (no change mutation, no run control).
- No daemon residency: the server lives and dies with the CLI process, exactly like `rasen config ui`.
- No package extraction (`packages/daemon`), no config-api refactor, no `rasen config ui` rename — all second-batch/slice-3 work.
- No polling/websocket live updates; the board reads on load and on manual refresh.

## Decisions

### D1 — Management API lives in `src/core/management-api/` (open question 1)

**Decision:** New directory `src/core/management-api/`, a sibling of `src/core/config-api/`, compiled into the CLI like every other core module. Not a new `packages/daemon` package.

**Rationale:** The handlers' entire value is direct access to core seams (`resolveProjectHome`, run-state readers, artifact-graph status) — inside `src/core` those are plain relative imports; a separate package would need the CLI published as a dependency or a build-graph rework, i.e. a new publish surface for a batch whose delivery mode is local-only. The config-api precedent already established that a localhost HTTP surface is a core module. Package extraction remains cheap later: the directory boundary is the future package boundary, and nothing outside it may import its internals except the launch command. **Alternative considered:** `packages/daemon` now — rejected as premature; it buys nothing this batch and costs workspace/publish churn that second-batch consolidation would immediately redo.

### D2 — One server, composed routing: management router first, config router as fallback

**Decision:** The management server (new `management-api/server.ts`, copying config-api's socket-tracking/shutdown-guard pattern) installs a router that handles `GET /api/v1/status|changes|runs` itself and delegates every other request — config endpoints and static assets alike — to the existing `createRouter(context)` imported from `config-api/router.js`, called with the same session token and launch-project context.

**Rationale:** The board page and config page must share one origin and one token or the UI package would need dual-server discovery. Delegation composes without modifying config-api: `createRouter` is a public export returning a plain request handler. The alternatives — mounting management routes inside config-api's router (edits a frozen file) or running two servers on two ports (two tokens, CORS, worse UX) — both violate constraints or add complexity. Method guard: non-GET on management paths returns `405 method_not_allowed`, same envelope as config-api.

### D3 — Identity headers stamped at the server layer, on every response

**Decision:** `x-rasen-daemon: <version>` and `x-rasen-pid: <pid>` are set via `res.setHeader` in the management server's request callback before any routing (management-handled and delegated responses alike).

**Rationale:** The omnicross discovery pattern works because the headers are unconditional — a prober hitting any path (even a 401 or a static asset) can classify the listener. Stamping in the handler wrapper rather than per-route makes it impossible for a future route to forget them. Responses from a plain `rasen config ui` server carry no such headers, which is correct: that server is not the management surface.

### D4 — `GET /changes` reuses the CLI's exact seams; the API reports facts, the UI derives columns

**Decision:** The changes handler enumerates via `getActiveChangeIds(root)` (`src/utils/item-discovery.ts`), loads per-change state via `loadChangeContext` (`src/core/artifact-graph/instruction-loader.ts`) for schema + artifact completion, and computes task progress via `countTasksFromContent` (`src/utils/task-progress.ts`). The wire shape carries raw facts per change: `name`, `schemaName`, per-artifact `status` (`done|ready|blocked`), `isComplete`, task counts (`total`/`completed`), and whether run-state files exist. Kanban column assignment (planning / ready / in-progress / done) is a pure function in the UI, not an API field.

**Rationale:** The board must agree with the workflow's real notion of an active change — the `getActiveChangeIds` definition that `rasen status`, `validate`, `archive`, and the instruction loader all share — and calling the same functions is the only way that holds by construction rather than by testing luck. Note that this is deliberately *not* parity with `rasen list`, which does a bare `readdir` of `rasen/changes/` and so advertises directories lacking a `proposal.md` that no other command can act on; on this repo that gap is four directories out of ten. The API takes the narrower, actionable definition; widening a brand-new wire contract to mimic `list.ts` would propagate the looser definition into a surface that is hard to narrow later. Keeping column derivation client-side keeps the API stable while board semantics iterate. **Alternative:** a server-computed `column` field — rejected; it bakes UI policy into a wire contract this early.

### D5 — `GET /runs` resolves run-state read-only via `resolveProjectHome(root, { ensure: false })`

**Decision:** For each active change, the runs handler resolves the machine home with `ensure: false` (the documented non-mutating probe), locates `auto-run.json` via `resolveRunStateLocation(changeDir, home?.workDir(name))` (workDir-first, changeDir legacy fallback), and reads `goal-run.json`/`portfolio-run.json` from the same resolved directory. `auto-run.json` is parsed with `readRunStateDetailed` semantics so the wire distinguishes `ok` / `invalid` (with reason) / `absent`; `portfolio-run.json` uses `readPortfolioState`; `goal-run.json` — which has no typed reader module — is read as raw JSON, surfaced as `{ raw }` with a parse-failure marker on malformed content. Handler failures per change degrade to an `error` entry for that change, never a 500 for the whole listing.

**Rationale:** A read-only API must not mint project identity or create home directories as a side effect of a GET — `ensure: false` is exactly the contract `project-home.ts` documents for this. Surfacing invalid files (instead of null-swallowing) matches the `readRunStateDetailed` design intent: a broken `auto-run.json` is a fact worth showing on a dashboard. When `ensure: false` returns null (project never registered), runs are reported `absent` — correct, since no run could have written state without the home existing.

### D6 — Launch entry is a hidden top-level `rasen ui` command (open question 2)

**Decision:** New file `src/commands/ui.ts` registering a **hidden** top-level `rasen ui` command (Commander `hidden: true`), plus one import + one `registerUiCommand(program)` line in `src/cli/index.ts`. It mirrors `config ui`'s flow — mint token, resolve launch project + UI assets dir, start the **management** server, print `http://127.0.0.1:<port>/board#token=<token>`, open browser, SIGINT/SIGTERM shutdown — with `--no-open`/`--port` flags.

**Rationale:** The slice's acceptance bar is "really runs", so a launch entry is mandatory. `rasen config ui` and its file are untouched, honoring the constraint. Claiming `rasen ui` now is deliberate forward-compatibility, not squatting: the second batch plans to make `rasen ui` the unified entry, and this hidden command is precisely the surface that batch will unhide and flesh out — no throwaway name (`rasen dashboard`, `rasen management-ui`) to retire later. Hidden means it appears in no help text, so nothing is advertised before the second batch formalizes it. **Alternative considered:** a `--experimental` flag on a visible command — rejected; visibility is the thing to avoid, not flag spelling.

### D7 — UI: one new route, board components beside existing ones, client additions only

**Decision:** `app.tsx` gains exactly one line: `<Route path="/board" component={BoardPage} />` (`/` keeps resolving to ConfigPage; the launch command's printed URL targets `/board` directly, and `static.ts`'s existing index-fallback already serves SPA routes). New components `BoardPage.tsx`, `BoardColumn.tsx`, `BoardCard.tsx` under `packages/ui/src/components/`; column derivation as a pure function in `packages/ui/src/board/columns.ts` (unit-testable without DOM). `client.ts` gains `getStatus()`, `listChanges()`, `listRuns()`; `types.ts` gains the corresponding wire types. All fetches stay inside the single seam; token/401 handling is inherited unchanged.

**Rationale:** Minimal app.tsx delta was an explicit planning requirement. A separate `board/` module for derivation logic follows the existing `config/` (grouping/controls) precedent in the package. The warm editorial design system shipped in 0.1.1 is reused as-is — no new design tokens.

### D8 — Column derivation policy (initial)

**Decision:** `deriveColumn(change, run)` maps: all `applyRequires` artifacts not yet done → **Planning**; artifacts done, zero tasks completed and no active run → **Ready**; some tasks completed or run-state reports an `in_progress`/`escalated` stage → **In Progress** (escalated changes get a badge, not a column); all tasks completed → **Done**.

**Rationale:** Pure function over facts D4 already ships; trivially adjustable in batch 2 without wire changes. Escalation-as-badge avoids inventing a fifth column before real usage data exists.

## Risks / Trade-offs

- [Delegation couples the management server to `createRouter`'s exported signature] → It is a stable public export already exercised by `config ui`; the composition test locks the contract, and any future config-api change that breaks it fails compile, not runtime.
- [`goal-run.json` read as raw JSON has no schema guarantee] → Presented as opaque `raw` payload with a validity flag; a typed reader can be added in a later slice without a wire break (additive field).
- [Hidden `rasen ui` may be discovered and relied on before batch 2 stabilizes it] → Hidden from help, marked experimental in its own description, and read-only end to end — worst case a user sees a board early; nothing mutates.
- [Per-request full re-scan of changes could be slow on projects with many changes] → Active-change counts are small in practice (tens); acceptance is a local single-user dashboard. No caching by constraint; revisit only with evidence.
- [`ensure: false` returns null for never-registered projects, so runs show `absent` even if someone hand-placed run files in the repo-local change dir] → `resolveRunStateLocation`'s changeDir legacy fallback still finds those; only the machine-home path depends on registration.

## Migration Plan

None required — all-new surfaces, no existing behavior changes, no data migration. Rollback is deleting new files and the two one-line registrations. Local delivery only; the branch merges after config-page-coherence lands.

## Open Questions

- Should `/api/v1/status` also report registered-projects count or store ids for the future multi-project board? Deferred to batch 2 (additive).
- Board auto-refresh (polling interval) — deferred until the daemon-residency slice defines liveness semantics.

## Follow-ups

- **Converge `src/core/list.ts` onto `getActiveChangeIds`.** `ListCommand` (`src/core/list.ts:113-115`) enumerates changes with a bare `readdir` filtered only on `entry.name !== 'archive'`, so `rasen list` advertises change directories that have no `proposal.md` and that `status`, `validate`, `archive`, and the instruction loader cannot act on. That is the divergence behind the board showing 6 changes where `rasen list` shows 10 on this repo. The fix belongs to `list.ts`, not to this slice: this change deliberately does not touch `src/core/list.ts`. A later change should switch `ListCommand` to `getActiveChangeIds` (deciding whether non-actionable directories are dropped silently or surfaced as a distinct warning), after which `rasen list` and the board agree row for row.
