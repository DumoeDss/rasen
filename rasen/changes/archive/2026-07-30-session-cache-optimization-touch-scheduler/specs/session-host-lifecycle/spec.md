## ADDED Requirements

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
