## ADDED Requirements

### Requirement: Public reusable-session command surface
Rasen SHALL provide `session exec`, `session list`, and `session retire` commands with complete help and presentation content in English, Japanese, and Simplified Chinese. The structural command registry SHALL expose enum-like option choices as completion values while keeping all user-facing descriptions in the locale catalogs.

#### Scenario: Localized help is complete
- **WHEN** a user requests help for the session group or any session subcommand in each supported locale
- **THEN** Rasen presents non-empty localized command, option, argument, and example text without a code-authored description leaking into the output

#### Scenario: Shell completion describes the exact command shape
- **WHEN** a supported shell asks for completion metadata for session commands
- **THEN** Rasen offers `exec`, `list`, and `retire` plus the documented `auto|never` and `stop|retire-silent` values

### Requirement: Trusted run, session, action, and workspace selection
Rasen SHALL execute session operations only after the requested run ID resolves to a decoded canonical head Record whose exact identity matches the request. `session exec` SHALL require an action that exactly equals the frozen committed agent action under that Record's action ID, an exact session key, and an explicit execution directory. New dispatch SHALL require that committed action to remain active and granted, and registration SHALL persist the complete trusted planning/execution binding for exact comparison on later wakes.

#### Scenario: Exact canonical Run and agent action are accepted
- **WHEN** the requested run's decoded head Record has the same run ID, contains the exact frozen requested agent action in active granted state, and the complete session execution facts match
- **THEN** Rasen selects that run's durable coordinator and registers or wakes only the named session

#### Scenario: Sanitized directory collision fails closed
- **WHEN** a requested run ID maps to an existing filesystem directory whose decoded head Record contains a different exact run ID
- **THEN** Rasen rejects the selection without reading or mutating that directory's session registry

#### Scenario: Cross-platform cwd validation is stable
- **WHEN** equivalent or different execution paths are supplied on Windows, macOS, or Linux
- **THEN** Rasen compares canonical paths with the platform-aware durable path rules and never relies on a hardcoded path separator

#### Scenario: Action or immutable facts disagree
- **WHEN** the action is absent from the head Record, differs from the same-ID frozen action, or its role, complete execution binding, session key, or canonical cwd conflicts with the selected run or existing session
- **THEN** Rasen returns a typed selection error before any message reaches a host

#### Scenario: Closed action permits duplicate lookup but not new dispatch
- **WHEN** the exact frozen action is closed or otherwise non-deliverable
- **THEN** Rasen may return an existing terminal disposition for the same durable message ID, but rejects any message ID that would create a new register, recovery, or wake dispatch

#### Scenario: Action source is bounded while reading
- **WHEN** an action file or stdin stream exceeds the 1 MiB action limit
- **THEN** Rasen rejects it as invalid input after reading at most one byte beyond the limit, while a document exactly at the limit remains eligible for decoding

### Requirement: Stable idempotent session execution
`session exec` SHALL use the admitted action ID as its default message ID or an explicit stable caller-provided message ID. Every register or wake SHALL pass through the durable coordinator's idempotency fence and per-session single-flight lease, and Rasen SHALL never regenerate a random message ID during retry. A touch-policy mutation SHALL accept an optional observed `expectedLastWakeAt`; when supplied, the coordinator SHALL compare it after lease-protected reconciliation and return `conditional_wake_stale` before mutation on mismatch.

#### Scenario: First execution completes
- **WHEN** a new stable message ID is admitted and the reusable host completes the turn
- **THEN** Rasen returns a completed outcome and the durable registry records the terminal digest without persisting the raw message ID

#### Scenario: Completed retry is deduplicated
- **WHEN** the caller repeats the same action with the same message ID after completion
- **THEN** Rasen returns the recorded duplicate-completed outcome without dispatching a second turn

#### Scenario: Initial registration response is lost
- **WHEN** the first bootstrap action settles but its response is lost before the caller observes it
- **THEN** a retry with the same message ID returns the bootstrap terminal disposition and never executes that action again as a later wake

#### Scenario: Concurrent execution is single-flight
- **WHEN** two owners concurrently target the same run, session, and distinct messages
- **THEN** the shared durable wake lease admits at most one dispatch and reports contention for the other instead of silently serializing two model turns

#### Scenario: Uncertain terminal outcome is not replayed
- **WHEN** bytes may have reached the host but completion cannot be proven
- **THEN** Rasen records or reports delivery uncertainty and a retry with the same message ID returns the uncertain terminal disposition without replay

#### Scenario: Stale touch-policy snapshot cannot mutate
- **WHEN** an interactive wake changes `lastWakeAt` after a scheduler snapshot and the scheduler submits a touch-policy update with the old observation
- **THEN** the coordinator returns `conditional_wake_stale` before changing the policy

### Requirement: Resident and foreground owner modes
Rasen SHALL use a positively identified compatible daemon as the resident reusable-session owner. When no daemon exists and no request has been attempted, Rasen SHALL use the same durable coordinator in an explicit foreground-owner mode, reap its host on command exit, and preserve recoverable registry state.

#### Scenario: Compatible daemon owns the session
- **WHEN** daemon state and the live loopback response positively match this Rasen version and process identity
- **THEN** the command uses the authenticated resident coordinator and reports `ownerMode` as `daemon`

#### Scenario: Absent daemon degrades to foreground correctness
- **WHEN** every probed loopback port affirmatively refuses connection and any recorded daemon PID is proved dead or stale before request admission
- **THEN** the command uses a foreground coordinator, reports that cache residency ends with the command, and shuts the owner down without adopting a previous PID

#### Scenario: Ambiguous daemon does not trigger a competing owner
- **WHEN** the port is foreign, the daemon version or identity mismatches, the probe times out or does not respond, another network error is ambiguous, or a recorded daemon PID is still live
- **THEN** Rasen returns a typed daemon failure without sending session work or starting a foreground owner

#### Scenario: Broken response does not cross-fallback
- **WHEN** a daemon request may have been admitted and the HTTP connection then fails
- **THEN** Rasen returns transport uncertainty and does not retry the message through a foreground owner

#### Scenario: Owner shutdown failure is surfaced
- **WHEN** foreground cleanup cannot reap its owned host or settle durable lost state
- **THEN** Rasen attempts every owned coordinator, preserves the bounded public-safe per-run `failures[]` through foreground and server owner surfaces, and emits exactly one typed `owner_shutdown_failed` result with exit 1 instead of reporting the original operation as successful

### Requirement: Durable session listing and retirement
`session list` SHALL return a stable public projection of sessions from one exact canonical run, and `session retire` SHALL retire one exact session through the durable coordinator. Retired sessions SHALL remain terminal and unavailable for later execution.

#### Scenario: List returns safe durable facts
- **WHEN** a user lists an existing canonical run
- **THEN** Rasen returns each session's key, role, status, canonical cwd, lifecycle timestamps, touch policy, and safe terminal summaries without exposing bearer tokens, raw prompts, lock paths, raw message IDs, or owner secrets

#### Scenario: Retire reaps and persists terminal state
- **WHEN** a user retires an active, idle, lost, or stale session
- **THEN** the coordinator reaps any host it owns, persists the retirement reason, and returns the retired projection

#### Scenario: Retired execution is rejected
- **WHEN** `session exec` targets a retired session
- **THEN** Rasen returns the typed unavailable-session outcome without launching, recovering, adopting, or messaging a host

### Requirement: Stable human, JSON, and exit outcomes
Every session command SHALL provide equivalent human and versioned JSON results. JSON mode SHALL emit exactly one machine-readable document, while exit status SHALL distinguish success, infrastructure failure, invalid selection, contention, unavailable session, and uncertainty.

#### Scenario: JSON success is script-stable
- **WHEN** a session command succeeds with `--json`
- **THEN** stdout contains one `rasen-session-command/1` document with the command, owner mode, exact run/session identity, and typed outcome, without human notices

#### Scenario: Human output is localized
- **WHEN** the same command runs without `--json`
- **THEN** Rasen presents the equivalent facts and guidance using the selected locale

#### Scenario: Failure classes have distinct exits
- **WHEN** a command encounters malformed input, contention, an unavailable session, pre-delivery infrastructure failure, or delivery uncertainty
- **THEN** it returns the documented exit class and a stable non-localized outcome code in JSON

#### Scenario: Missing required option still honors JSON mode
- **WHEN** `session exec`, `list`, or `retire` is invoked with `--json` but lacks a required operand
- **THEN** Rasen emits exactly one `rasen-session-command/1` failure document and exits with class 2

#### Scenario: Daemon response is strict and bounded
- **WHEN** a daemon response has an unknown field, wrong operation projection, a top-level or nested run/session identity that disagrees with the request, truncation, premature close, or exceeds the 2 MiB response limit
- **THEN** Rasen settles once with a typed bounded protocol or transport outcome and forwards no mismatched, undecoded, or forbidden response projection to human or JSON output
