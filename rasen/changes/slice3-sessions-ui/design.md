## Context

`packages/ui` is a preact + vite app: `Layout.tsx` (nav: Board `/`, Config `/config`), `BoardPage.tsx` (nonce-based manual refresh, columns from `board/columns.ts`), one fetch seam (`api/client.ts` — every call goes through `request()` with bearer auth and `ApiError` narrowing), and `api/types.ts` as a hand-maintained mirror of the server's wire types (the two route groups stay independently deployable; the UI package never imports server code). The sessions wire contract was settled by child 1 and is frozen for this change: list = `{sessions: [{session, runState}]}`, detail = `{session, tails}`, POST/DELETE = `{session}`.

The roadmap acceptance this change carries: killing a real session from the UI is reflected correctly on the board.

Hard boundary: every edit in this change lives under `packages/ui/` — the daemon-residency sibling owns `src/commands` + server files, and file-disjointness is what lets the two run in parallel.

## Goals / Non-Goals

**Goals:**
- A Sessions view: list with live polling, per-session pipeline progress from the run-state join, expandable detail with output tails.
- Confirmed kill flow and a launch flow (auto/goal), both exclusively through the sessions API.
- Running-sessions visibility on the board itself (the acceptance surface).

**Non-Goals:**
- Any file outside `packages/ui` (no server, CLI, locale, or completions edits — the UI has its own strings).
- Streaming transports (SSE/WebSocket) — polling matches the app's existing model and the server offers none.
- Rendering goal-run internals — `goalRun` is raw/untyped by design (slice-1 precedent); sessions of kind `goal` show process facts and a raw-presence note, not a parsed pipeline.
- Session timeout controls in the launch form (`timeoutMs`/`noOutputTimeoutMs` stay server-defaulted; the wire fields exist but the form doesn't expose them — fewer knobs on v1).
- UI package publish/version bump (user-owned).

## Decisions

### D1. Placement: dedicated Sessions page + board indicator (not board-embedded rows)

A third nav destination `/sessions` ("Sessions"), rendered by `SessionsPage.tsx`, following the Board/Config page pattern (same Layout, same aria-current active check). The board itself gains only a compact running-sessions indicator (count of sessions in `starting|running|exiting`, linking to `/sessions`), fed by the same list call. Rationale: sessions are process-lifecycle objects, not lifecycle-column objects — forcing them into kanban columns would conflate two state machines; but the acceptance rule names the board, so the board must visibly change when a session dies — the indicator (and its disappearance) is that reflection, with the full truth one click away. Alternative (a sessions strip embedded on the board) considered and rejected: it duplicates the whole list UI in cramped form and still needs a full page for tails/launch.

### D2. Polling cadence: fixed 3s on the Sessions page, indicator piggybacks

`SessionsPage` polls `GET /api/v1/sessions` every 3 seconds while mounted (setInterval in a `useEffect`, cleared on unmount), merged with the existing manual-refresh button pattern (nonce). 3s makes a kill's `exiting → exited` transition feel live without hammering a local loopback server (the endpoint is registry-memory + a few file reads). The board's indicator uses the same client call on the board's existing load path plus the same 3s interval only when at least one session was live in the last response (idle boards don't poll sessions). Detail tails refresh only while a row is expanded, same cadence. No visibilitychange sophistication — out of proportion for a local tool.

### D3. Kill flow semantics mirror the wire contract exactly

Kill button on rows in `starting|running` state → inline confirmation (the app's existing confirm pattern; no browser `confirm()`) → `DELETE`. On 202, patch the row from the response body (`state: 'exiting'`, kill button disabled) immediately; polling carries it to `exited`/`killed`. On 404 (session pruned between poll and click) treat as already-gone and refresh. `exiting` rows show a spinner-ish state, `exited` rows show reason + exit code/signal, color-coded by termination reason (normal exit vs killed vs timeouts vs spawn-error). Rows never disappear on kill — the retained-exited contract exists precisely so the UI can show terminal states.

### D4. Launch dialog: three fields, server is the validator

`LaunchSessionDialog` (sibling of `NewChangeDialog`, same dialog/styling conventions): kind as a two-option choice (`auto` preselected, `goal`), task as a textarea, change name as an optional text input explained as "attach this run to an existing change (enables live pipeline progress)". Client-side validation is minimal (non-empty task); the server is authoritative and its 400/409/503 envelopes surface verbatim via `ApiError` (the `agent_cli_unavailable` and `busy` messages are user-meaningful as-is). On 201 the new session is prepended optimistically from the response and polling takes over. The board's new-change dialog is not extended — creating a change and launching a supervised run are different speech acts with different admission tiers, and the settled API keeps them on different endpoints.

### D5. Run-state progress rendering reuses slice-1 typed shapes

For a list entry whose `runState` is a `ChangeRunEntry` with a parsed `autoRun`, render the pipeline progress: stage list with per-stage status glyphs (the same `RunFileResult`/`RunState` mirror types the board already has), current stage highlighted, plus round/handoff counts when present. `runState.kind === 'absent'` (no `changeName`, or change not yet created by the run) renders an honest "no linked change" note — the mirror comment in wire-types explains this window; the board's own `/runs` view covers the change once it exists. `invalid` run-state renders the reason string. No new derivation logic: column-assignment stays a board concern; sessions render facts.

### D6. Mirror discipline for the API seam

`api/types.ts` gains the session types copied field-for-field from `src/core/management-api/wire-types.ts` (the settled contract), with a comment naming the source file — same convention the file already uses for management types. `api/client.ts` gains `listSessions()`, `getSession(id)`, `launchSession(body)`, `killSession(id)`, all through the single `request()` wrapper so auth/error handling stays in one place. No shared package, no imports across the boundary — mirror drift is caught by the integration test asserting against a real server response shape in CI-less local runs (fixture JSON captured from the settled contract).

## Risks / Trade-offs

- [3s polling races a fast kill (row flickers exiting→exited within one tick)] → the 202 body patch makes `exiting` appear instantly; polling only ever moves state forward (exited is terminal), so no flicker-back is possible.
- [Mirror types drift if a later server change touches the wire contract] → the contract is explicitly settled for this portfolio; the mirror header names the source file; fixture-based client tests fail loudly on shape drift.
- [Optimistic prepend on launch can double-show the session when the next poll lands] → merge by session id, not append.
- [An `auto` run without `changeName` shows no progress, which users may read as "stuck"] → the "no linked change" note explains it and the launch dialog's changeName hint teaches the linkage; tails in the detail row prove liveness.
- [Board indicator polling adds load when sessions are live] → one extra loopback GET per 3s against an in-memory registry; negligible, and idle boards skip it.
- [Preact-specific pitfalls (this is not React)] → follow existing components' idioms only (hooks from `preact/hooks`, `class` not `className` where the codebase does); no new dependencies.

## Open Questions

- None blocking. If the acceptance run shows 3s feels laggy for the kill demo, the cadence is a single constant to tune.
