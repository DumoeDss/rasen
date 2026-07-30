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
