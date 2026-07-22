# session-supervision Specification

## Purpose
TBD - created by archiving change slice3-session-runtime. Update Purpose after archive.
## Requirements
### Requirement: Platform can launch a supervised agent session
The management server SHALL accept `POST /api/v1/sessions` with a JSON body `{ kind, task }` (plus optional `changeName`, `timeoutMs`, `noOutputTimeoutMs`) and launch a headless agent session by spawning the `claude` CLI as a supervised subprocess in the server's launch project. The spawned command SHALL be built entirely server-side from the whitelist entry for `kind` — a single prompt token composed of the entry's skill invocation followed by the task text, with the non-interactive print flag, the skip-permissions flag, and streaming JSON output — using an argv array and no shell. On successful spawn the server SHALL respond 201 with the session record, without waiting for the run to progress. The agent CLI binary SHALL be resolved server-side (environment override, then PATH); client input SHALL never influence the executable, the working directory, or any argv element other than the task text embedded inside the single prompt token.

#### Scenario: Launching a session spawns a real supervised run
- **WHEN** a client sends an authorized `POST /api/v1/sessions` with `kind: "auto"` and a valid task
- **THEN** the server responds 201 with a session record carrying a server-minted id, the kind, the task, and a live state, and a real agent CLI process is running in the launch project

#### Scenario: Option-like task text cannot inject flags
- **WHEN** a client submits a task that begins with `--` or contains shell metacharacters
- **THEN** the task is bound verbatim inside the single prompt token, no additional CLI option is parsed, and no shell interpretation occurs

#### Scenario: Task text is validated before spawning
- **WHEN** a client submits an empty task, a task exceeding the length cap, or a task containing control characters other than tab or newline
- **THEN** the server responds 400 with a validation error and spawns nothing

#### Scenario: Missing agent CLI degrades clearly
- **WHEN** no agent CLI binary can be resolved on the server machine
- **THEN** `POST /api/v1/sessions` responds 503 with error code `agent_cli_unavailable` and spawns nothing, while read endpoints continue to work

#### Scenario: Launching outside a project is rejected
- **WHEN** the server was launched outside any Rasen project
- **THEN** `POST /api/v1/sessions` responds 409 with error code `no_project` and no subprocess is spawned

### Requirement: Sessions are observable while they run and after they end
The server SHALL maintain an in-memory session registry holding, per session: the server-minted session id, kind, task, process id, lifecycle state (starting, running, exiting, exited), start time, last-output time, and — once ended — exit code or signal and a termination reason distinguishing normal exit, kill, overall timeout, no-output timeout, spawn error, and server shutdown. The agent CLI's own session id SHALL be captured from its stream output when available, as observability data only. `GET /api/v1/sessions` SHALL list all registry records; for a session launched with a `changeName`, the listing SHALL additionally join that change's on-disk run-state read-only, so process facts (from memory) and pipeline facts (from disk) are reported together without the server ever persisting pipeline state itself. `GET /api/v1/sessions/:id` SHALL return the record plus a bounded tail of the session's recent output for diagnostics. Ended sessions SHALL remain listed (bounded retention, oldest pruned) so a consumer observes terminal states without racing the exit.

#### Scenario: Live session appears in the listing
- **WHEN** a session is running and a client sends `GET /api/v1/sessions`
- **THEN** the response includes that session with its id, kind, state, process id, start time, and last-output time

#### Scenario: Run-state joined for a targeted change
- **WHEN** a session was launched with a `changeName` whose change has an `auto-run.json` on disk
- **THEN** the sessions listing reports that session together with the change's run-state, read fresh from disk without any write side effects

#### Scenario: Ended session remains observable
- **WHEN** a session ends for any reason and a client lists sessions afterwards
- **THEN** the session appears with state `exited`, its exit code or signal, and its termination reason

#### Scenario: Unknown session id
- **WHEN** a client requests `GET /api/v1/sessions/:id` or `DELETE /api/v1/sessions/:id` with an id not in the registry
- **THEN** the server responds 404

### Requirement: Sessions terminate reliably — kill endpoint and supervision bounds
`DELETE /api/v1/sessions/:id` SHALL terminate the session's entire process tree: a graceful termination first, then a forced kill after a grace period if the supervised child has not closed — with the escalation and all registry finalization keyed off the child's actual close event, never off the HTTP response. The DELETE response SHALL return promptly (202 with the record in state `exiting` for a live session); the terminal state becomes visible through subsequent listings. Deleting an already-ended session SHALL succeed idempotently (200 with the terminal record). Independent of client action, every session SHALL be bounded by two supervision timers — an overall duration cap and a no-output watchdog reset by any output activity — each terminating the session through the same tree-kill path with its own termination reason. Tree termination SHALL work on macOS, Linux, and Windows.

#### Scenario: Kill a live session and observe the terminal state
- **WHEN** a client sends `DELETE /api/v1/sessions/:id` for a running session
- **THEN** the server responds 202 with the session in state `exiting`, the process tree is terminated, and a subsequent `GET /api/v1/sessions` shows the session `exited` with termination reason `killed`

#### Scenario: Termination-resistant process is forcibly killed
- **WHEN** a killed session's process ignores the graceful termination signal beyond the grace period
- **THEN** the forced kill fires — triggered by the child still not having closed, not by response timing — and the session still reaches state `exited`

#### Scenario: Silent session is reaped by the watchdog
- **WHEN** a session produces no output for longer than its no-output threshold
- **THEN** the supervisor terminates its process tree and records termination reason `no-output-timeout`

#### Scenario: Overlong session is reaped by the overall cap
- **WHEN** a session exceeds its overall duration cap
- **THEN** the supervisor terminates its process tree and records termination reason `overall-timeout`

#### Scenario: Kill of an ended session is idempotent
- **WHEN** a client sends DELETE for a session that already exited
- **THEN** the server responds 200 with the terminal record and sends no signals

### Requirement: The server remains a reader and launcher — never a second source of truth
All durable pipeline and workspace state produced by a supervised session SHALL be written by the spawned agent side only (run-state files, change artifacts, workspace files). The session registry SHALL hold only live process facts and bounded diagnostics; the server SHALL NOT write workspace files, run-state files, or any persistent record of sessions. Restarting the server SHALL lose only process supervision, never pipeline truth: on-disk run-state written by past sessions remains fully readable through the existing run-state endpoints.

#### Scenario: Session activity writes no server-side persistent state
- **WHEN** a session is launched, runs, and is killed
- **THEN** the only durable artifacts on disk are those written by the spawned agent side, and the server has created no session files of its own

#### Scenario: Pipeline truth survives the registry
- **WHEN** the server restarts after a session had written run-state to disk
- **THEN** `GET /api/v1/runs` still reports that run-state, while the sessions listing no longer knows the dead process

### Requirement: Foreground server shutdown reaps its sessions
Session reaping SHALL be bound to the process that owns the supervisor. The resident daemon owns supervision by default: its clean shutdown (stop command, interrupt, or termination signal) SHALL terminate all live supervised sessions via the tree-kill path with termination reason `server-shutdown` before exiting — while the exit of any consumer (such as `rasen ui` or its terminal) SHALL NOT reap the daemon's sessions. When supervision runs in a self-hosted foreground server (`rasen ui --no-daemon`), that process is the owner and SHALL reap its live sessions on clean exit exactly as the pre-residency behavior did. A force-killed owner can still orphan sessions; this SHALL remain documented rather than masked, with agent-written run-state files persisting for manual resume.

#### Scenario: Clean shutdown leaves no orphaned session processes
- **WHEN** the process owning the supervisor shuts down cleanly while sessions are running
- **THEN** each live session's process tree is terminated before the owner exits, with termination reason `server-shutdown`

#### Scenario: Consumer exit does not reap daemon sessions
- **WHEN** sessions run under the resident daemon and a consumer that adopted or spawned it exits
- **THEN** the sessions continue running and remain visible in the sessions listing

### Requirement: Concurrent supervised sessions are capped
The server SHALL enforce a maximum number of concurrently live supervised sessions (default 3). A launch request beyond the cap SHALL be rejected with 409 `busy` without spawning; the slot SHALL be released only when a session's child process has actually closed, never merely when a response was sent. This cap SHALL be independent of the change-submission subprocess slot.

#### Scenario: Launch beyond the cap rejected
- **WHEN** the maximum number of sessions are live and a client sends another `POST /api/v1/sessions`
- **THEN** the server responds 409 with error code `busy` and spawns nothing

#### Scenario: Slot released only on true exit
- **WHEN** a session was killed but its process lingers through the grace period
- **THEN** its capacity slot is not released until the process has actually closed

