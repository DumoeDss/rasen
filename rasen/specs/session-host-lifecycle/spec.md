# session-host-lifecycle Specification

## Purpose
Defines the lifecycle, concurrency, recovery, retirement, and ownership guarantees for reusable multi-turn Claude session hosts managed by the existing session supervisor.
## Requirements
### Requirement: A reusable session host is created as a live multi-turn process
The session supervisor SHALL create a reusable host by starting Claude in streaming-input and streaming-output mode in the trusted working directory, delivering one bootstrap message, capturing the Claude session identity, and returning the bootstrap result with the host ready for another turn. The host SHALL retain its stdin/stdout process connection while idle and SHALL use a stable supervisor-lifetime host reference even if its process is later replaced.

#### Scenario: Bootstrap creates an idle reusable host
- **WHEN** a caller creates a host with a valid bootstrap message and trusted launch context
- **THEN** the bootstrap result is returned, the host reports an idle state with a Claude session identity and live process id, and its stdin remains open

#### Scenario: Idle time is not mistaken for a stalled turn
- **WHEN** a bootstrap turn completes and the host produces no output while waiting for a later wake
- **THEN** turn watchdogs are inactive and the host remains live until retirement, owner shutdown, or actual process loss

#### Scenario: Host creation respects supervisor capacity
- **WHEN** every supervisor process slot is occupied and a caller creates another reusable host
- **THEN** creation is rejected as busy without spawning a process or writing a message

#### Scenario: Windows launch facts and messages remain literal
- **WHEN** a reusable host starts through a Windows command shim in a canonically resolved cwd containing supported path metacharacters and receives a multi-line bootstrap message
- **THEN** the fixed launch arguments and cwd reach Claude literally, the message is delivered over stdin as data, and no command-interpreter injection or path-identity mismatch occurs

### Requirement: An idle host accepts repeated wakes with one result per accepted message
The session supervisor SHALL let callers wake an idle host repeatedly. Each accepted wake SHALL deliver exactly one stream-json user message, await that turn's complete result event, return the result envelope, and leave a healthy process idle and available for the next wake. The working directory and trusted launch facts SHALL remain those recorded at creation.

#### Scenario: Repeated wakes reuse one live host
- **WHEN** a caller creates a host and sequentially wakes it with messages A, B, and C
- **THEN** each wake returns its own result in order, all messages use the same live process and Claude session identity, and the host is idle after C

#### Scenario: Result split across output chunks still completes one wake
- **WHEN** a result event is split across stdout chunks or arrives beside multiple other NDJSON events
- **THEN** the supervisor waits for the complete result line, returns it only to the current wake, and does not complete a later wake with an earlier result

#### Scenario: Unknown stream events do not corrupt the lifecycle
- **WHEN** Claude emits valid but unrecognized events or a malformed diagnostic line before the result
- **THEN** the output remains available for diagnostics, the accepted wake continues waiting for its valid result, and the host lifecycle does not crash

### Requirement: Wake admission is single-flight per host
The session supervisor SHALL admit at most one wake at a time for each reusable host. It SHALL change the host to its busy state before awaiting process recovery, backpressure, or result collection. An overlapping wake SHALL receive a structured `host_busy` result immediately and SHALL cause no stdin write, recovery spawn, or Claude charge from the rejected message.

#### Scenario: Concurrent wake is rejected before delivery
- **WHEN** wake A is still active and wake B targets the same host
- **THEN** wake B returns `host_busy`, only A is written to Claude, and B creates no replacement process

#### Scenario: Host can be woken after the accepted turn settles
- **WHEN** wake A completes after an overlapping wake was rejected
- **THEN** a later wake C can be accepted normally and receives its own result

#### Scenario: Different hosts retain independent admission
- **WHEN** host A has an active wake and a caller wakes idle host B
- **THEN** host B's wake is admitted subject only to supervisor-wide process capacity

### Requirement: A lost host recovers by resuming the captured session
When a host is known to have lost its process before a new message is delivered, the session supervisor SHALL recover it by starting a replacement live stream-json process with the captured Claude session identity and the original working directory and trusted launch facts. The triggering wake SHALL be delivered once to the replacement, and success SHALL preserve the stable host reference while exposing the replacement pid.

#### Scenario: Idle process loss is recovered on the next wake
- **WHEN** an idle host with a captured Claude session identity loses its child process and a caller sends the next wake
- **THEN** the supervisor resumes that identity in the original cwd, delivers the message once, returns its result, and leaves the same host reference idle with a new pid

#### Scenario: Recovery never changes cwd
- **WHEN** a lost host created in one canonical working directory is recovered
- **THEN** the resume process uses that recorded directory on macOS, Linux, and Windows and no caller-supplied replacement cwd is accepted

#### Scenario: Loss before session identity is unrecoverable
- **WHEN** a host loses its process before any Claude session identity was captured
- **THEN** the next wake returns structured `host_unrecoverable` and no fresh or resumed process is spawned

#### Scenario: Ambiguous in-flight delivery is not replayed
- **WHEN** Claude's stdin accepted a wake message but the host process closes before a result event is observed
- **THEN** that wake returns structured `delivery_uncertain`, the message is not automatically replayed, and the host remains eligible for a later explicit recovery wake

### Requirement: Retirement cleanly and terminally ends a reusable host
The session supervisor SHALL make retirement terminal and idempotent. Retirement SHALL block new wakes immediately, allow an already accepted turn to settle within its bounds, close the live host's stdin, and wait for actual process closure, escalating through the existing process-tree termination path when graceful closure exceeds its grace period. Retiring a host already known lost SHALL not resume it.

#### Scenario: Idle host retires cleanly
- **WHEN** a caller retires an idle live host
- **THEN** the supervisor closes stdin, observes or forces process-tree closure, releases capacity, and reports the host retired

#### Scenario: Retirement does not discard an accepted wake
- **WHEN** retirement begins while a wake is active
- **THEN** new wakes are rejected, the accepted wake is allowed to return its result or bounded failure, and process closure follows

#### Scenario: Lost host retires without recovery cost
- **WHEN** a caller retires a host whose process is already lost
- **THEN** the host becomes retired without spawning a resume process or sending a message

#### Scenario: Repeated retirement is idempotent
- **WHEN** a caller retires an already retired host
- **THEN** the operation succeeds with the same terminal state and sends no process signal or stdin data

#### Scenario: Retired host rejects wake
- **WHEN** a caller wakes a retired host
- **THEN** the wake returns structured `host_retired` and performs no stdin write or process spawn

### Requirement: Reusable hosts preserve supervisor ownership guarantees
Reusable hosts SHALL use the supervisor's existing trusted binary resolution, runtime-context injection, bounded diagnostics, process capacity, process-tree termination, and clean owner-shutdown discipline. Adding reusable hosts SHALL leave the existing one-shot launch, observation, timeout, kill, and HTTP behavior compatible.

#### Scenario: Owner shutdown reaps reusable and one-shot processes
- **WHEN** the supervisor owner shuts down while reusable hosts and one-shot sessions are live
- **THEN** every owned process tree is reaped before shutdown completes and no reusable host bypasses the drain gate

#### Scenario: Lost host releases and recovery reacquires capacity
- **WHEN** a reusable host process is lost and later recovered
- **THEN** its old process slot is released exactly once and the replacement reserves a slot before spawning

#### Scenario: Existing one-shot launch remains compatible
- **WHEN** a caller uses the pre-existing one-shot session API after reusable-host support is added
- **THEN** its argv shape, stdin behavior, registry lifecycle, timeouts, output tails, kill behavior, and HTTP responses remain unchanged

### Requirement: Reusable session identity is durable within its canonical run
The system SHALL persist a reusable session under a stable logical session key beside the canonical run state. The record SHALL retain the exact run identity, immutable canonical working directory, Claude session identity when known, trusted launch facts, lifecycle status and timestamps, owner binding, touch policy, the newest 64 digest-only presentation wake outcomes, and at most 4096 non-evicting digest tombstones needed by later session callers.

#### Scenario: A created host becomes a durable logical session
- **WHEN** a reusable host finishes bootstrap with both a result and Claude session identity
- **THEN** its logical session key resolves to an idle durable record with the canonical cwd and captured Claude identity even after the creating owner exits

#### Scenario: Bootstrap init and result arrive in either order
- **WHEN** bootstrap emits its complete result before init identity or init identity before its complete result
- **THEN** registration waits for both facts and commits one recoverable idle record without losing either event

#### Scenario: Registry is scoped to the canonical run
- **WHEN** two runs use the same logical session key
- **THEN** each run resolves only its own session record from state beside that run's canonical state

#### Scenario: Presentation history is bounded and excludes caller content
- **WHEN** a session completes more wake attempts than the retained history limit
- **THEN** the oldest terminal presentation summaries are pruned to 64 while unresolved delivery state and bounded replay tombstones remain, and no raw message id, prompt, result body, protocol buffer, or diagnostic tail is persisted

### Requirement: Message idempotency uses a bounded non-evicting digest index
Before any durable admission state is written, the system SHALL convert the caller-supplied message id to a domain-separated SHA-256 or equivalently strong fixed digest. Each session SHALL keep a strict, deterministically ordered index of no more than 4096 tombstones containing only the digest and necessary terminal disposition. A v1 tombstone SHALL never be evicted, and terminal insertion SHALL be part of the same atomic registry mutation that settles the wake.

#### Scenario: Pruned presentation duplicate still matches
- **WHEN** a completed or delivery-uncertain wake has been pruned from the 64-entry presentation history and the caller submits the same message id again
- **THEN** its digest matches the retained tombstone, the original terminal disposition is returned, and no recovery spawn or stdin write occurs

#### Scenario: Full capacity rejects a new message identity
- **WHEN** a session already contains 4096 tombstones and a caller submits a message id whose digest is not present
- **THEN** admission returns typed `idempotency_capacity_exhausted` before durable admission, recovery, spawn, or stdin delivery and no old tombstone is evicted

#### Scenario: Raw message identifiers are never persisted
- **WHEN** a message is admitted, fenced, presented in recent wake history, or recorded as terminal
- **THEN** every durable message-identity field contains only the fixed digest and the registry contains no raw message id, prompt, or result body

#### Scenario: Existing digest remains idempotent at capacity
- **WHEN** a session already contains 4096 tombstones and the caller submits a message id whose digest is already present
- **THEN** the system returns that tombstone's original terminal disposition without reporting capacity exhaustion, mutating the registry, spawning a process, or writing stdin

### Requirement: Durable registry updates are atomic and cross-process consistent
The system SHALL validate the complete versioned registry before use, serialize read-modify-write transitions across processes, and replace registry state atomically. A reader SHALL observe one complete valid revision, and a failed update SHALL preserve the last complete revision.

#### Scenario: Two processes mutate one run concurrently
- **WHEN** two processes attempt different valid registry transitions for the same run at the same time
- **THEN** the transitions are serialized against freshly read state and no session record or revision is silently overwritten

#### Scenario: Process stops during replacement
- **WHEN** a writer stops after creating or flushing temporary state but before registry replacement completes
- **THEN** the canonical registry remains the complete prior revision or the complete new revision and temporary residue is not read as state

#### Scenario: Windows replacement is transiently blocked
- **WHEN** Windows reports a transient sharing or access error while replacing the registry
- **THEN** replacement is retried only within a bounded interval and final failure leaves the prior complete registry available

#### Scenario: Ambiguous lock ownership fails closed
- **WHEN** a registry or wake lock exists and its owner cannot be proved dead
- **THEN** the operation returns a structured busy or lock diagnostic without stealing the lock, rewriting state, spawning a host, or sending stdin data

### Requirement: Wake admission is single-flight per durable logical session
The system SHALL admit at most one wake for a logical session across threads and OS processes. Admission SHALL become durable before process recovery or message delivery, and an overlapping caller SHALL receive a structured busy outcome without a process spawn or Claude charge for the rejected message.

#### Scenario: Concurrent owners target the same logical session
- **WHEN** wake A holds admission for a logical session and another process submits wake B for the same session
- **THEN** wake B is rejected as busy, only A can recover or write to Claude, and B creates no wake outcome that claims delivery

#### Scenario: Different logical sessions remain independent
- **WHEN** session A has an admitted wake and a caller wakes session B in the same run
- **THEN** session B can be admitted independently, subject to the existing supervisor-wide process capacity

#### Scenario: Duplicate message identity is not dispatched
- **WHEN** a caller submits a message id already recorded as completed or delivery-uncertain for that session
- **THEN** the system returns the recorded terminal disposition and performs no stdin write or recovery spawn

### Requirement: Interrupted delivery never causes automatic replay
Before invoking an operation that can write an admitted message, the system SHALL durably record a dispatch fence. If ownership is lost after that fence without a complete result, the wake SHALL become `delivery_uncertain` and the same message id SHALL never be dispatched automatically.

#### Scenario: stdin accepted but the process closes before result
- **WHEN** Claude's stdin accepts an admitted wake and the host closes before a complete result is observed
- **THEN** the wake is durably recorded as `delivery_uncertain`, the host becomes lost, and that message is not replayed

#### Scenario: Owner stops after the dispatch fence
- **WHEN** the owner stops after committing the dispatch fence but before committing a terminal wake outcome
- **THEN** the next reconciliation records `delivery_uncertain` even when transcript timing cannot prove whether Claude consumed the message

#### Scenario: Owner stops before the dispatch fence
- **WHEN** the owner stops after durable admission but before committing the dispatch fence
- **THEN** reconciliation records a pre-delivery failure and no message is assumed to have reached Claude

#### Scenario: Later explicit wake remains possible
- **WHEN** a session has a prior delivery-uncertain wake and a caller submits a new message with a new message id
- **THEN** the system may recover the lost session and deliver only the new message while preserving the earlier uncertainty

### Requirement: Durable sessions reconcile safely after process or owner loss
Before acting on durable state, the system SHALL reconcile it against the current owner's in-memory supervisor host, the immutable canonical cwd, and the exact Claude transcript for the recorded session identity. It SHALL resume an eligible lost session through the existing supervisor and SHALL not adopt a process from a previous owner based only on PID liveness.

#### Scenario: Daemon or foreground owner restarts
- **WHEN** a new owner loads a record that was idle or waking under a previous owner
- **THEN** it treats the old process binding as lost, does not adopt or signal the recorded PID, and evaluates resume eligibility from canonical cwd and exact transcript facts

#### Scenario: Eligible lost session resumes
- **WHEN** a lost session has its captured Claude identity, unchanged canonical cwd, and exact regular transcript file and receives a new wake
- **THEN** the existing supervisor resumes that identity in the recorded cwd, reserves shared capacity before spawn, and binds the replacement host and pid to the same logical session

#### Scenario: Idle loss releases shared capacity
- **WHEN** an idle reusable process exits and is later recovered
- **THEN** its old supervisor slot is released exactly once and recovery competes with live one-shot and reusable processes for the same capacity

#### Scenario: Transcript lookup is exact
- **WHEN** newer transcripts or sessions with similar id prefixes exist beside the recorded session
- **THEN** reconciliation considers only the regular non-symlink transcript named by the exact Claude session id under the recorded canonical cwd

#### Scenario: Owner shutdown is not user retirement
- **WHEN** an owner shuts down and reaps a reusable process that the user did not retire
- **THEN** the durable logical session becomes lost and recoverable rather than terminally retired

### Requirement: Stale or corrupt recovery state fails closed
The system SHALL refuse wake, recovery, and mutation when durable state is corrupt, uses an unsupported schema, conflicts with the requested run, or cannot prove the recorded recovery identity. The failure SHALL preserve the evidence and return a structured diagnostic without resetting the registry or starting a fresh session.

#### Scenario: Registry JSON or schema is corrupt
- **WHEN** `sessions.json` is malformed, contains an unsupported schema, duplicate identities, or an invalid lifecycle transition
- **THEN** the operation reports registry corruption and performs no rewrite, host spawn, stdin write, or implicit empty-registry fallback

#### Scenario: Canonical cwd no longer matches
- **WHEN** the recorded cwd is missing, resolves through a retargeted symlink or junction, or no longer has the recorded canonical identity
- **THEN** the session becomes stale and recovery is refused without accepting a replacement cwd

#### Scenario: Session identity or transcript is unavailable
- **WHEN** a lost session has no captured Claude identity or its exact transcript cannot be validated
- **THEN** the session becomes stale or unrecoverable and no fresh or resumed host is spawned

#### Scenario: Windows path presentation preserves physical identity
- **WHEN** a recorded Windows cwd is encountered through a drive-letter or case presentation that resolves to the same canonical directory
- **THEN** reconciliation recognizes the same physical identity while continuing to spawn from the stored canonical path

### Requirement: CLI and scheduler callers share one recovery and admission contract
The system SHALL expose one internal registry/recovery coordinator for later interactive commands and automatic touch scheduling. Every caller SHALL receive the same durable lookup, single-flight, recovery, retirement, uncertainty, and corruption outcomes, independent of whether a daemon is already running.

#### Scenario: Interactive and scheduled wakes race
- **WHEN** a later interactive command and touch scheduler target the same logical session concurrently
- **THEN** both use the same admission seam and exactly one wake is admitted

#### Scenario: Daemon is unavailable
- **WHEN** a valid foreground owner performs a registry operation while no daemon is running
- **THEN** the same on-disk locking, reconciliation, and delivery-fence rules apply

#### Scenario: Policy is stored but not interpreted by the registry
- **WHEN** a caller records a touch mode, deadline, limit, or deadline action
- **THEN** the registry preserves the validated policy while scheduling cadence and message content remain decisions of the scheduler caller

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

### Requirement: Policy-bounded daemon touch eligibility
The resident daemon SHALL evaluate reusable sessions against named refresh and cold-gap timing values and SHALL request a touch only for an idle session whose auto policy has a future deadline, remaining touch budget, and activity gap within the eligible window.

#### Scenario: Eligible idle session reaches the refresh cadence
- **WHEN** an idle auto-policy session has a valid future deadline, `touchesUsed < maxTouches`, and its last successful activity is at least the configured approximately 50-minute cadence but no more than the cold-gap limit ago
- **THEN** the daemon requests one conditional touch through the resident reusable-session coordinator

#### Scenario: Recent or active session is skipped
- **WHEN** a session is active, waking, retiring, retired, or was successfully active less than the touch cadence ago
- **THEN** the daemon spends no touch and leaves the session's durable policy unchanged

#### Scenario: Incomplete policy fails closed
- **WHEN** auto policy lacks a valid future deadline or contains state that cannot be safely evaluated
- **THEN** the daemon reports the policy diagnostic and does not dispatch a touch

### Requirement: Touches share durable single-flight admission
Every scheduler touch SHALL use the same durable coordinator and per-session wake lease as interactive execution. The coordinator SHALL recheck the scheduler's observed activity fact after lease acquisition so a stale candidate cannot be touched.

#### Scenario: Interactive wake wins the race
- **WHEN** an interactive wake refreshes or holds the session after the scheduler snapshot but before touch admission
- **THEN** the touch is rejected as stale or contended without a second model turn

#### Scenario: Touch wins the race
- **WHEN** the conditional touch acquires the durable wake lease before a competing interactive wake
- **THEN** the touch is the sole admitted turn and the interactive wake observes normal single-flight contention

#### Scenario: No alternate owner is created
- **WHEN** the scheduler evaluates or touches a session
- **THEN** it uses the daemon's authenticated resident coordinator and never creates a second supervisor, writes the registry directly, or adopts a previous PID

### Requirement: Stable touch identity and durable accounting
Each logical touch attempt SHALL have a deterministic message ID derived from exact run, session, touch ordinal, and attempt facts. Completed and delivery-uncertain touches SHALL consume one touch ordinal; pre-delivery failures SHALL remain safely retryable with a new deterministic attempt after backoff.

#### Scenario: Completed response is accounted once
- **WHEN** a touch completes normally
- **THEN** its durable terminal metadata and `touchesUsed` advance exactly once even if the same request is received again

#### Scenario: Daemon crashes between wake and accounting
- **WHEN** the host settles a touch but the daemon exits before the caller observes or accounts for the result
- **THEN** the restarted scheduler derives the durable terminal touch, reconciles the same ordinal, and does not replay the message

#### Scenario: Delivery is uncertain
- **WHEN** bytes may have reached the host but completion cannot be proven
- **THEN** the touch consumes its ordinal, the exact message is never replayed, and later handling follows the coordinator's lost-session recovery contract

#### Scenario: Failure is proven pre-delivery
- **WHEN** the coordinator proves that no touch bytes reached the host
- **THEN** the touch ordinal remains available and a later backoff attempt uses a new stable attempt identity

### Requirement: Deadline, exhaustion, and cold-gap actions
The daemon SHALL apply persisted touch-policy bounds before dispatch. At or beyond the deadline it SHALL perform the configured stop or silent-retirement action; at maximum touches it SHALL stop refreshing; beyond the cold-gap limit it SHALL spend no catch-up touch and SHALL disable automatic touching pending a real execution decision.

#### Scenario: Stop deadline expires
- **WHEN** `now >= deadlineAt` and `deadlineAction` is `stop`
- **THEN** the daemon updates the policy through the coordinator to stop automatic touches without sending a model turn

#### Scenario: Silent-retire deadline expires
- **WHEN** `now >= deadlineAt` and `deadlineAction` is `retire-silent`
- **THEN** the daemon retires the session through the coordinator without a final model turn

#### Scenario: Maximum touch count is exhausted
- **WHEN** `touchesUsed >= maxTouches`
- **THEN** the daemon sends no further touch across later scans or restarts

#### Scenario: Machine sleep crosses the cold boundary
- **WHEN** the session's activity gap is greater than the configured 60-minute cold limit
- **THEN** the daemon sends no catch-up touch and requests policy disablement through the coordinator with the snapshot's exact `expectedLastWakeAt`

#### Scenario: Interactive activity invalidates cold-policy mutation
- **WHEN** an interactive wake changes `lastWakeAt` after the scheduler classifies a session as cold but before its conditional policy update is admitted
- **THEN** the coordinator returns `conditional_wake_stale`, the scheduler treats it as a benign skip, and automatic touching remains unchanged

#### Scenario: Deadline and cold gap are crossed together
- **WHEN** a forward time gap crosses both the deadline and cold boundary
- **THEN** the daemon applies the configured deadline action before cold-gap handling

### Requirement: Per-session failure backoff
The daemon SHALL isolate scheduler failures by session and apply a deterministic capped exponential backoff to pre-delivery, service, and protocol failures. Contention or a stale candidate SHALL be a benign skip, and one failed session SHALL not delay other eligible sessions.

#### Scenario: Repeated pre-delivery failures back off
- **WHEN** one session repeatedly fails before dispatch
- **THEN** its retry delay grows from the named base to the named cap while other eligible sessions continue to be evaluated

#### Scenario: Interactive activity clears scheduler failure state
- **WHEN** a later scan observes newer successful session activity
- **THEN** the scheduler clears that session's volatile failure count and evaluates the new durable state

#### Scenario: Uncertain transport keeps the exact attempt
- **WHEN** the loopback connection fails or a headers-plus-partial response aborts after request bytes may have been committed
- **THEN** the scheduler settles the operation exactly once within its bound, backs off, and retries only the exact same message ID until durable disposition is known

### Requirement: Daemon lifecycle and clock semantics
The touch scheduler SHALL run only with the resident daemon, scan durable state immediately on startup, prevent new work before daemon shutdown, and behave conservatively under backward jumps, forward jumps, and repeated ticks. Session correctness SHALL remain available when no daemon is running.

#### Scenario: Daemon restart reconstructs work
- **WHEN** a daemon starts with existing durable sessions and terminal touch metadata
- **THEN** it performs an immediate scan, reconstructs ordinal and attempt state, and neither adopts a previous owner PID nor replays an uncertain message

#### Scenario: Clean daemon shutdown drains scheduler first
- **WHEN** the daemon receives a shutdown signal
- **THEN** it prevents new scans and every post-list side effect, settles or classifies an already committed loopback request within the 4-second operation and 5-second drain bounds, and only then shuts down the resident coordinator

#### Scenario: Composed shutdown budgets preserve graceful cleanup
- **WHEN** production shutdown constants are verified
- **THEN** the 20-second identified-daemon kill grace is strictly greater than the 5-second scheduler drain plus the existing 8-second coordinator guard, 2-second server-close guard, and 1-second declared overhead, and an uncertain committed message keeps its exact ID without replay

#### Scenario: Daemon is absent
- **WHEN** no daemon is running
- **THEN** no automatic touch occurs and later foreground or resident session execution remains correct, with only cache efficiency potentially reduced

#### Scenario: Clock moves backward
- **WHEN** wall time moves backward relative to the persisted last activity
- **THEN** the scheduler does not treat the negative or shortened gap as touch eligibility

#### Scenario: Clock moves forward within or beyond limits
- **WHEN** wall time moves forward
- **THEN** the scheduler performs at most one due action within the eligible window, uses cold handling beyond the cold limit, and applies deadline action first when the deadline was crossed

#### Scenario: Timer fires during a scan
- **WHEN** another timer tick occurs before the current scan finishes
- **THEN** the scheduler coalesces it into at most one follow-up evaluation and does not overlap scans
