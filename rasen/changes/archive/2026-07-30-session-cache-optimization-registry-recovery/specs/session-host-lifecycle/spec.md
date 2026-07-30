## ADDED Requirements

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
