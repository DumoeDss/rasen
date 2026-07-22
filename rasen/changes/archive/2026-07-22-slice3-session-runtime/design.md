## Context

Slice 1 gave the management server read endpoints (`/api/v1/status|changes|runs`); slice 2 gave it one CLI-backed write path (`POST /api/v1/changes`) with a hardened subprocess bridge (`src/core/management-api/submit.ts`: own-installation entry, `shell: false`, argv whitelist, cwd lock, cap-1 concurrency, SIGTERM→SIGKILL keyed off child close). This change adds the third kind of process the server manages: a **supervised long-runner** — a headless `claude` CLI session driving a Rasen pipeline for minutes-to-hours, observable and killable while it runs.

Reference templates (read, adapted, not imported): omnicross `packages/cli-launcher/src/{supervisor,run-registry,kill-tree}.ts` (dual timeouts, in-memory registry with exited-record pruning, negative-pgid/taskkill tree kill) and slice 2's `submit.ts` (responded/childClosed dual state, release-on-close discipline).

Portfolio red lines (planning-context.md of `platform-slice3-session-supervision`): the server is a reader + launcher, never a second source of truth; the CLI/agent side is the only writer of workspace files and run-state; spawn code passes the three-point checklist (SIGKILL escalation keyed off child close, resource release keyed off child close, tests carry a SIGTERM-resistant fixture); identity-header and config contracts see zero regression; delivery is local-only.

## Goals / Non-Goals

**Goals:**
- A supervisor that can spawn, track, time-bound, and tree-kill a headless agent session, with exit cleanup that never leaks registry entries or timers.
- A sessions HTTP route group (`POST/GET /api/v1/sessions`, `GET/DELETE /api/v1/sessions/:id`) on the existing server, same auth posture as every other endpoint.
- A whitelist tier extension that admits exactly `auto` and `goal`, as the slice-2 spec explicitly reserved for slice 3.
- Interfaces the two siblings can build on unchanged: the registry module is constructible outside the foreground server (daemon residency, child 2) and the wire types are the UI's contract (child 3).

**Non-Goals:**
- Daemon residency, adopt-or-spawn, and any `rasen daemon` command family (child 2). In this child the server is still the foreground `rasen ui` process.
- Sessions UI (child 3). This change is API-complete but renders nothing.
- Streaming session output over HTTP (SSE/WebSocket). The board polls; a bounded output tail on the detail endpoint is enough for this child.
- Multi-project session targeting. Sessions run in the launch project only, like slice 2 submissions.
- Parsing/interpreting pipeline semantics from the stream. The stream feeds the watchdog and the tail buffer; pipeline truth stays in run-state files read by the existing `/runs` machinery.

## Decisions

### D1. Spawn shape — live-verified, not guessed

Probed on this machine (2026-07-20, claude 2.1.215):
- `which claude` resolves to a **zsh function** wrapping `command claude --dangerously-skip-permissions`; the real binary is `~/.local/bin/claude` → `~/.local/share/claude/versions/2.1.215`. Shell functions do not exist for `spawn`, so the permissions flag MUST be explicit in argv.
- `claude -p '<prompt>' --model haiku --dangerously-skip-permissions --output-format json` → exit 0, single JSON result object on stdout (`result`, `session_id`, `total_cost_usd`, …), empty stderr.
- `--output-format stream-json --verbose` → NDJSON: first event `{"type":"system","subtype":"init", "session_id", "permissionMode":"bypassPermissions", …}`, then continuous events including `system/thinking_tokens` deltas every few seconds during generation, tool events, and a final `result` event. This is the watchdog feed.

**Chosen shape** (argv array, `shell: false`):

```
<claudeBin> -p "<skill> <task>" --dangerously-skip-permissions --output-format stream-json --verbose
```

- `claudeBin` discovery: `RASEN_CLAUDE_BIN` env override first, else a PATH scan for `claude` (`claude.exe`/`claude.cmd` considered on Windows), resolved once per server and cached. Never influenced by client input. Absence → 503 `agent_cli_unavailable` at POST time, spawn nothing.
- `<skill>` comes from the whitelist entry (`/rasen:auto` or `/rasen:goal`), server-side constant. `<task>` is the client's task text embedded in the same single argv token after the skill name, so option-like task text can never parse as a flag (same injection posture as slice 2's `--proposal=<text>`).
- `--dangerously-skip-permissions` is the established three-platform headless convention for this project; in `-p` mode there is no human to answer permission prompts, so the alternative (`--permission-mode` presets) either blocks or amounts to the same posture with more knobs.
- `stream-json` over plain `json`: plain `json` is silent until the end, which would blind the no-output watchdog for the entire run.
- `cwd`: the server's `launchProjectRoot`, locked (client input never touches cwd or executable). `env`: inherited unmodified (claude needs HOME/keychain auth). `stdio`: `['ignore', 'pipe', 'pipe']`.
- POSIX: `detached: true` so the child leads its own process group and `process.kill(-pid, sig)` reaches the whole tree (claude spawns its own children); the parent does NOT `unref()` — in child-1 the foreground server owns the lifetime. Windows: `windowsHide: true`, tree kill via `taskkill /T` (D5).

Alternative considered: spawning `rasen` pipelines directly (no claude). Rejected — pipelines are driven by agent skills, not by a CLI command; the roadmap names claudecode sessions as the thing being supervised.

### D2. Session identity and registry record

Server-minted `randomUUID()` is the session id and the registry key. The claude-side `session_id` (parsed from the stream-json `init` event) is recorded as `agentSessionId` — observability and a future resume handle, never the key (it arrives asynchronously after spawn, and a spawn that dies pre-init would otherwise have no identity).

Registry record (in-memory `Map<string, SessionRecord>`):

```
{ id, kind: 'auto'|'goal', task, cwd, pid?, agentSessionId?,
  state: 'starting'|'running'|'exiting'|'exited',
  startedAt, lastOutputAt, endedAt?,
  exitCode?, exitSignal?, terminationReason?: 'exit'|'signal'|'overall-timeout'|'no-output-timeout'|'killed'|'server-shutdown'|'spawn-error',
  changeName? }
```

Exited records are retained (board needs to show terminal state after a kill) and pruned oldest-first beyond a cap of 50 — omnicross's pattern with a smaller cap since each record carries an output tail. Getters return copies. The registry module takes no server dependencies, so child 2's daemon can construct and own the same registry.

### D3. Dual timeouts and the watchdog threshold

- Overall timeout: default **4 hours** (long auto runs are legitimately hours; unbounded is not acceptable for an unattended supervisor).
- No-output watchdog: default **10 minutes**, reset on any stdout/stderr data. Rationale: during model activity the stream emits events every few seconds, but while a spawned subagent grinds inside a long tool call the parent stream can be quiet for minutes — 10 minutes tolerates that while still catching a truly hung session.
- Both configurable per POST body (`timeoutMs`, `noOutputTimeoutMs`) within server-enforced caps (≤ 12h / ≤ 30min); both fire the same cancellation path with a distinct `terminationReason`. Timers are `unref()`'d and cleared on settle.

### D4. Sessions API semantics

- `POST /api/v1/sessions` `{ kind, task, changeName?, timeoutMs?, noOutputTimeoutMs? }` → validate (kind ∈ whitelist; task non-empty, length-capped, control-chars-free except tab/newline — slice 2's rule; `changeName` if present must pass change-name validation), enforce the concurrency cap, spawn, respond **201** with the session record immediately (state `starting`/`running`). No waiting for the run to do anything.
- `GET /api/v1/sessions` → all registry records (live + retained exited), no disk reads by default. When a record carries `changeName`, the response entry additionally joins that change's run-state via the existing slice-1 readers (read-only, non-mutating) — this is the "registry + run-state synthesis": process facts from memory, pipeline facts from disk, never merged into one store. Sessions without `changeName` (an auto run that will create its own change) report `runState: absent`; the board's existing `/runs` polling still covers them once the change exists.
- `GET /api/v1/sessions/:id` → the record plus bounded stdout/stderr tails (last 64 KiB each, ring-buffer) for diagnostics. 404 unknown id.
- `DELETE /api/v1/sessions/:id` → initiate tree-kill; respond **202** with the record in state `exiting` immediately. The SIGKILL escalation (after a 5s grace) and the registry finalization are keyed off the child's `close` event, never off the HTTP response (three-point checklist). Idempotent: DELETE on an already-exited session → 200 with the terminal record; unknown → 404. Termination via DELETE records `terminationReason: 'killed'`.
- Routing: `MANAGEMENT_PATHS` exact-set matching gains a prefix rule for `/api/v1/sessions/<id>` (one path segment, validated as UUID format before lookup). Same bearer auth, same no-CORS posture, same identity headers (they are applied server-wide already — zero regression required).

Concurrency cap: default **3** concurrent live sessions per server (board demo needs a handful; each is an expensive model-driven run), overlapping POST beyond the cap → 409 `busy`. Distinct from slice 2's cap-1 submission slot, which stays as-is (different resource class: bounded CLI call vs supervised long-runner).

### D5. Cross-platform tree kill

Adapted from omnicross `kill-tree.ts`: POSIX sends `SIGTERM` to `-pid` (process group; enabled by `detached: true`), then `SIGKILL` to the group after grace if the direct child hasn't closed; Windows runs `taskkill /T /PID` then `taskkill /F /T /PID` after grace. `ESRCH`/already-dead is silent success. Escalation timers are keyed off the supervised child's `close` (childClosed flag), cleared when it fires, and `unref()`'d. Tests include a SIGTERM-ignoring fixture child proving escalation actually fires (three-point checklist, point 3).

### D6. Foreground-server exit posture (honest child-1 answer)

**Kill-on-exit.** On clean shutdown (server `close()`, SIGINT/SIGTERM of the `rasen ui` process) the supervisor tree-kills every live session with `terminationReason: 'server-shutdown'` before the process exits. Rationale: in the child-1 world the registry is in-memory and nothing can re-adopt an orphan — an orphaned claude run would keep spending tokens with no observer and no kill switch, which is worse than a killed run (run-state files persist, so `/rasen:auto` resume paths remain available to a human). A hard-killed server (SIGKILL) still orphans sessions — documented limitation, not silently papered over; child 2's daemon residency (durable process + adopt-or-spawn) is the real fix. The supervisor exposes `shutdownAll()` precisely so child 2 can re-decide when residency changes the calculus.

### D7. Whitelist tier as data

Slice 2's admission table gains a `tier` axis: `bounded-cli` (create-change, unchanged semantics) and `supervised-long-runner` (`auto` → `/rasen:auto`, `goal` → `/rasen:goal`). A supervised entry carries its skill string and default timeouts; the sessions endpoint admits only supervised entries, the submission endpoint only bounded ones. Adding a future operation is a table row, not new plumbing — the same extension contract slice 2 promised.

## Risks / Trade-offs

- [Watchdog false positives on legitimately quiet runs (long silent subagent tool calls)] → 10min default measured against observed stream cadence; per-request override up to 30min; termination reason distinguishes watchdog kills so the board can show *why* a session died.
- [An `auto` session without `changeName` is invisible to run-state joining until its change appears] → accepted; `/runs` already lists every active change's run-state, and child 3's UI joins on the board side. Callers that target an existing change pass `changeName` and get the join immediately.
- [Server crash (SIGKILL) orphans live claude processes] → documented (D6); grace-kill on all clean-exit paths; child 2 removes the window. The orphan is discoverable by a human (`ps`, claude's own session persistence) and its run-state files remain valid.
- [PATH-discovered `claude` could be an unexpected binary] → discovery is server-side only (env override + PATH), never client input; the spawn uses an absolute resolved path with `shell: false`; this matches how the user actually invokes claude on every platform we support.
- [stream-json contract drift across claude versions] → the supervisor treats the stream as opaque bytes for the watchdog and tail; only the best-effort `init` parse (for `agentSessionId`) touches structure, and its failure degrades to a missing optional field, never a session failure.
- [Retained exited records with 2×64KiB tails grow memory] → cap 50 exited records (~6MiB worst case), oldest pruned; tails are ring-buffers, not unbounded accumulation.
- [Tests spawning real claude would be slow, costly, nondeterministic] → unit/integration tests use fixture child processes (node scripts: signal-resistant, slow-output, fast-exit); the real-claude spawn shape is encoded as data and verified by the portfolio's acceptance run (kill a real session, board reflects it), not by CI.

## Open Questions

- None blocking. Sibling-facing interface notes (registry constructibility, wire types, `shutdownAll()`) are recorded in the portfolio planning-context so children 2 and 3 stay consistent.
