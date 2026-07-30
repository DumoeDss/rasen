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
