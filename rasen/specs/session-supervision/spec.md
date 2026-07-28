# session-supervision Specification

## Purpose
Supervised launch, tracking, and termination of headless agent sessions by the management platform: spawning the agent CLI as a bounded, observable subprocess, attributing each session to its planning space, and reliably reaping process trees on kill, timeout, or owner shutdown — while the server remains a reader and launcher that never becomes a second source of truth.
## Requirements
### Requirement: Platform can launch a supervised agent session
The management server SHALL accept `POST /api/v1/sessions` with a JSON body `{ kind, task }` (plus optional `changeName`, `space`, `execution`, `timeoutMs`, `noOutputTimeoutMs`) and launch a headless agent session by spawning the `claude` CLI as a supervised subprocess in the server-resolved launch context. The spawned command SHALL be built entirely server-side from the whitelist entry for `kind` and the resolved launch context: a single prompt token composed of the entry's skill invocation followed by the task text, the non-interactive print flag, the skip-permissions flag, streaming JSON output, and any resolved attached planning-root option, using an argv array and no shell. On successful spawn the server SHALL respond 201 with the session record without waiting for the run to progress. The agent CLI binary SHALL be resolved server-side (environment override, then PATH); client input SHALL never directly provide the executable, a working directory, an attached directory, or an argv fragment.

#### Scenario: Launching a session spawns a real supervised run
- **WHEN** a client sends an authorized `POST /api/v1/sessions` with `kind: "auto"`, a valid task, and a valid launch context
- **THEN** the server responds 201 with a session record carrying a server-minted id, the kind, the task, resolved planning attribution, resolved cwd, and a live state, and a real agent CLI process is running in that cwd

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
- **WHEN** the server was launched outside any Rasen project and the request supplies no resolvable planning and execution selection
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

### Requirement: Sessions carry a planning-space attribution derived from their working directory
Each supervised session SHALL record, at launch, the planning space selected for the run independently from its execution working directory. An explicit `space` selector SHALL become the record's planning attribution; when `space` is omitted, attribution SHALL be derived from the trusted launch-project cwd by the shared cwd-to-space rule of the planning-space-addressing capability. A repo with its own planning shape attributes to that project's space, a pointer repo attributes to the Store its config names, and a working directory with no derivable space leaves the session unattributed rather than failing the compatible launch. The attribution SHALL be frozen on the record and reported on every session read (`{ type, id, root }`), so it does not mutate retroactively if registries or pointers later change.

#### Scenario: Store-attributed session runs in a member
- **WHEN** a session launch explicitly selects planning space `store:team-store` and a valid member project as execution
- **THEN** the session record reports space `store:team-store` and reports the member project or selected linked worktree as its cwd

#### Scenario: Session launched in a pointer repo attributes to the store
- **WHEN** a compatible launch omits `space` while the daemon launch cwd is inside a repo whose config externalizes planning to registered Store `team-store`
- **THEN** the session record reports space `store:team-store` while its cwd remains the pointer repo

#### Scenario: Attribution survives later pointer changes
- **WHEN** a running session's repo changes its Store pointer after the session started
- **THEN** the session's recorded space is unchanged

#### Scenario: Unattributable cwd does not block launch
- **WHEN** a compatible omitted-space launch uses a working directory that yields no derivable space
- **THEN** the session launches normally and its record carries no space attribution

### Requirement: Session listing is filterable by space and joins run state per session's own space
`GET /api/v1/sessions` SHALL accept an optional `space` selector; when present, only sessions whose recorded space is that space are returned (unattributed sessions appear only in the unfiltered listing). Each listed session's run-state join SHALL resolve against the session's own recorded space — its root and that space's machine home — not against the server's launch project, so a session launched in one space never reports another space's run files.

#### Scenario: Filtered listing returns only the space's sessions
- **WHEN** sessions exist in spaces A and B and a client sends `GET /api/v1/sessions?space=<selector for A>`
- **THEN** only the sessions recorded in space A are returned

#### Scenario: Unfiltered listing keeps today's behavior
- **WHEN** a client sends `GET /api/v1/sessions` with no space selector
- **THEN** every session the supervisor knows is returned, including unattributed ones

#### Scenario: Run-state join follows the session's space
- **WHEN** a session with a `changeName` was launched in a space other than the launch project
- **THEN** its `runState` is read from that space's change directory and machine-home work directory, not the launch project's

### Requirement: Session launch separates planning space from validated execution context
`POST /api/v1/sessions` SHALL treat `space` as planning attribution and `execution` as the runtime working-directory selection. `execution` SHALL accept `project:<selector>`, resolved through the registered-project selector contract (including a linked worktree of that project), or the explicit Store-only value `planning`. The server SHALL resolve and canonicalize all roots from current machine registry, filesystem, Git worktree, and Store-pointer facts before spawn; it SHALL NOT use an arbitrary client path as cwd. For an explicit project space, omitted execution SHALL use that resolved project/worktree root for compatibility. For an explicit Store space, omitted execution SHALL return 409 `execution_required` and spawn nothing. Unresolvable or currently invalid execution selections SHALL return a specific 4xx error and spawn nothing.

#### Scenario: Project-space launch stays compatible
- **WHEN** a client launches with `space=project:<id-or-worktree-root>` and omits `execution`
- **THEN** the subprocess starts in that resolved project or linked-worktree root and the session record reports the same project planning space

#### Scenario: Explicit Store launch requires an execution choice
- **WHEN** a client launches with `space=store:team-store` and omits `execution`
- **THEN** the response is 409 `execution_required`, neither the Store root nor any member is guessed, and no agent process is spawned

#### Scenario: Current Store member resolves to execution cwd
- **WHEN** a client launches with `space=store:team-store` and `execution=project:member-a`, where `member-a` is a live registered pointer project whose current `store:` declaration names `team-store`
- **THEN** the subprocess cwd is member A's canonical project root, the session planning attribution is `store:team-store`, and the launch succeeds

#### Scenario: Registered root disambiguates same-id Store clones
- **WHEN** two live registered Store members share a project id and `execution=project:<absolute-registered-root-b>` selects the second clone
- **THEN** the server resolves and revalidates that exact registered root, and the subprocess and Session cwd use clone B rather than the first same-id registry entry

#### Scenario: Selected member worktree resolves without becoming ownership
- **WHEN** `execution=project:<absolute-worktree-root>` names a live linked worktree of a registered member whose current pointer names the selected Store
- **THEN** the subprocess cwd is that worktree's canonical root and the Session records it as a runtime fact without creating or changing a durable project target

#### Scenario: Non-member or stale pointer is rejected
- **WHEN** the execution selector resolves to a project outside the selected Store, a project whose pointer changed, a dead root, or a worktree that no longer belongs to the registered member
- **THEN** the response is 409 `execution_unavailable` with an actionable message and no agent process is spawned

#### Scenario: Missing execution project is rejected
- **WHEN** `execution=project:<selector>` matches no registered project or linked worktree
- **THEN** the response is 404 `execution_not_found` and no agent process is spawned

#### Scenario: Planning-only Store run is explicit
- **WHEN** a client launches with `space=store:team-store` and `execution=planning`
- **THEN** the subprocess cwd is the Store's canonical planning root, the session is attributed to that Store, and no duplicate attached root is supplied

#### Scenario: Different project cannot execute for a project planning space
- **WHEN** a request selects project planning space A but its explicit execution selector resolves to project B
- **THEN** the server rejects the incompatible execution selection and spawns nothing

#### Scenario: Windows worktree paths compare canonically
- **WHEN** a project or worktree execution selector on Windows differs from its registered form only by supported path casing or separator representation
- **THEN** the server resolves the same registered project identity and uses the canonical Windows root without a false non-member rejection

### Requirement: A distinct planning root is attached to the supervised agent
When the resolved planning-space root differs from the resolved execution cwd, the server SHALL attach exactly that planning root to the headless Claude launch so the agent can read and update the selected space's Change, spec, and run-state artifacts while executing project commands from cwd. When the two roots are the same, the launch SHALL omit the redundant attachment. Attached roots SHALL be server-resolved and supplied as literal argv tokens on macOS, Linux, and Windows; the request SHALL NOT accept client-provided CLI argv or additional directories.

#### Scenario: Store planning root is attached to member execution
- **WHEN** a session is attributed to a Store and executes in one of its member projects
- **THEN** Claude starts in the member cwd with exactly the Store root supplied as its additional directory

#### Scenario: Planning-only run has no duplicate attachment
- **WHEN** the Store planning root is also the execution cwd because the user explicitly selected planning-only
- **THEN** the server supplies no redundant additional-directory option

#### Scenario: Only the planning root is attached
- **WHEN** a Store has multiple members and the session executes in member A
- **THEN** the Store planning root is attached and neither member B nor any other sibling member is added to the agent's accessible-directory argv

#### Scenario: Windows shim receives the attached root literally
- **WHEN** a Windows session launches through an npm `.cmd` or `.bat` shim and the canonical planning root contains command-interpreter metacharacters valid in a path
- **THEN** the entire root reaches Claude as the single literal value of the server-built additional-directory option and no injected command or extra argv token is executed
