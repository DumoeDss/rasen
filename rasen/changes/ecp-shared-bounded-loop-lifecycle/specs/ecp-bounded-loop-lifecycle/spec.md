# ecp-bounded-loop-lifecycle Specification

## ADDED Requirements

### Requirement: Every bounded loop has one complete lifecycle policy

Every executable Definition v2 `BoundedLoop` SHALL declare a versioned lifecycle policy covering stall and same-blocker thresholds, a separately bounded strategy policy, and explicit dispositions for iteration, action, budget, stall, blocked, and strategy-exhausted triggers. Preparation SHALL reject a missing, incomplete, contradictory, or impossible policy with deterministic JSON Pointer diagnostics. The complete policy SHALL survive canonicalization and lowering into the immutable runtime plan.

#### Scenario: Complete lifecycle policy is sealed into the plan

- **WHEN** an authored v2 bounded loop declares valid thresholds, strategy bounds, lifecycle exits, and loop-local limits
- **THEN** preparation returns an executable plan containing the exact normalized lifecycle policy
- **AND** changing any lifecycle field changes the semantic source and plan digests

#### Scenario: Strategy trigger without a strategy capability fails closed

- **WHEN** any lifecycle trigger maps to `strategy` but the policy has no frozen strategy capability or has zero strategy attempts
- **THEN** preparation fails at the offending lifecycle path
- **AND** no executable plan is returned

### Requirement: Loop-local limits are independent admission boundaries

The lifecycle reducer SHALL enforce `maxIterations`, `maxActions`, and `budget` independently before admitting an action under the loop path. Normal domain actions, blocked retries, strategy actions, and strategy recovery actions SHALL consume the declared action and budget allowances. A rejected admission SHALL apply the matching lifecycle disposition without committing the disallowed action. Record-global limits SHALL remain an outer safety ceiling and SHALL NOT be mislabeled as loop-local outcomes.

#### Scenario: Action limit can fire before iteration limit

- **WHEN** retries and phase actions consume `maxActions` while unused normal iterations remain
- **THEN** the next action is not admitted
- **AND** the reducer applies the declared `actionLimit` disposition exactly once

#### Scenario: Strategy recovery consumes loop budget

- **WHEN** a strategy action and its recovery action would exceed the loop budget
- **THEN** the over-budget action is not admitted
- **AND** the declared `budgetLimit` outcome is projected from the canonical Record

### Requirement: Progress and stall identity are program-derived

Each supported bounded-loop body SHALL provide structured domain progress material to the shared lifecycle reducer. Rasen SHALL canonicalize that material into a stable progress fingerprint, excluding actor identity and prose. The first completed iteration SHALL establish the baseline, equal subsequent fingerprints SHALL increment the stall streak, and a materially different fingerprint SHALL reset it. An agent-provided fingerprint or progress claim SHALL NOT override this computation.

#### Scenario: Unchanged findings increment the stall streak

- **WHEN** two completed ReviewCycle iterations have the same stable set of unresolved Blocker and Major findings
- **THEN** their progress fingerprints are equal
- **AND** the second completion increments the lifecycle stall streak

#### Scenario: Material progress resets the stall streak

- **WHEN** a later goal judge result changes the normalized score or stable gap set used by its variant
- **THEN** the progress fingerprint changes
- **AND** the lifecycle stall streak resets to zero

### Requirement: Repeated blockers have stable identity and fresh attempts

A loop phase that blocks SHALL commit a typed bounded-loop blocked result with a closed reason code and semantic blocker key. The lifecycle SHALL derive blocker identity from loop, phase, reason code, and blocker key; free text and evidence SHALL NOT create a new blocker. Same-blocker attempts SHALL increment a streak, a distinct blocker SHALL reset the streak to one, and a resumed phase SHALL use a new attempt identity. Lifecycle readers SHALL select the latest committed attempt rather than the first action for a node.

#### Scenario: Blocked retry can later succeed

- **WHEN** a phase's first attempt blocks, its wait is resumed, and a later attempt succeeds
- **THEN** projection and reconciliation use the later successful attempt
- **AND** the obsolete blocked attempt does not keep the loop waiting

#### Scenario: Rewording does not reset blocker identity

- **WHEN** two blocked attempts use the same reason code and blocker key but different detail or evidence text
- **THEN** they increment one same-blocker streak
- **AND** the configured blocked threshold is applied deterministically

### Requirement: Strategy attempts are separate, bounded, and verified by recovery

When a lifecycle trigger maps to `strategy`, the reconciler SHALL admit the frozen strategy capability under a stable strategy-attempt path distinct from normal iterations. A successful strategy action SHALL authorize one domain recovery iteration associated with that strategy attempt. Rasen SHALL compare program-derived progress before and after recovery; the strategy result SHALL NOT self-certify material progress. Strategy attempts SHALL have their own counter and SHALL apply `strategyExhausted` exactly once when no attempt remains.

#### Scenario: Material strategy recovery returns to normal progression

- **WHEN** a strategy action succeeds and its recovery iteration produces a different progress fingerprint
- **THEN** the strategy is recorded as materially effective
- **AND** the loop continues according to its remaining domain and lifecycle bounds

#### Scenario: Unchanged recovery consumes a strategy attempt

- **WHEN** strategy recovery leaves the progress fingerprint unchanged
- **THEN** the completed strategy attempt remains consumed
- **AND** the next strategy attempt or declared `strategyExhausted` disposition is selected deterministically

### Requirement: Human-required is a durable lifecycle wait

When the blocked policy maps to `human-required`, Rasen SHALL commit a canonical `human-required` wait containing the loop path, phase, blocker fingerprint, reason code, evidence, and declared outcome. The wait SHALL expose versioned retry or escalate decisions plus run-global cancel. A decision SHALL commit its WaitId, selected decision, and evidence before the wait is cleared; retry SHALL create a fresh attempt and escalate SHALL apply the frozen blocked outcome.

#### Scenario: Human retry creates a fresh phase attempt

- **WHEN** the expected human-required WaitId receives a `retry` decision with evidence
- **THEN** the decision transition is committed and the wait is cleared
- **AND** reconciliation admits a new occurrence of the blocked phase

#### Scenario: Stale human decision fails closed

- **WHEN** a retry or escalate decision names a stale or different WaitId
- **THEN** the command is rejected without changing the Record
- **AND** the current human-required wait remains active

### Requirement: Lifecycle decisions and terminal reasons are typed and replayable

The shared reducer SHALL return a closed decision union for ready, waiting, strategy-ready, human-required, completed, escalated, failed, and cancelled states. Every non-domain completion SHALL preserve its lifecycle trigger, disposition, and declared outcome. An `exit` disposition MAY make the loop node complete and allow its authored tail, but SHALL NOT be projected as domain success. Reconciliation from the same immutable plan and canonical Record SHALL always return the same decision.

#### Scenario: Research exhaustion can continue to a truthful report tail

- **WHEN** a research GoalLoop reaches an iteration limit mapped to `exit` with a non-success outcome
- **THEN** the bounded-loop node becomes complete and its report tail becomes eligible
- **AND** the lifecycle projection preserves the iteration-limit reason without claiming the goal was satisfied

#### Scenario: Replay does not spend a trigger twice

- **WHEN** a process restarts after a lifecycle decision was committed but before the next action was admitted
- **THEN** reconciliation derives the same next boundary from the Record
- **AND** no limit, strategy attempt, wait decision, or terminal disposition is applied twice

### Requirement: One lifecycle projection serves every product plane

The canonical projector SHALL emit a versioned `bounded-loop-lifecycle/1` section for each bounded loop. It SHALL include loop path and body kind, state, iteration and phase, used/max limits, progress and blocker fingerprints, stall and blocked streaks, strategy state, current wait, and typed lifecycle outcome. CLI, Management API, Operations, reports, and compatibility files SHALL consume or derive from that section and SHALL NOT maintain writable lifecycle counters.

#### Scenario: Product planes observe identical lifecycle state

- **WHEN** a loop is waiting for human guidance after repeated blockers
- **THEN** CLI, API, and Operations expose the same loop path, streaks, strategy count, WaitId, reason, and outcome policy from `ChangeRunView`
- **AND** none of those planes recomputes the lifecycle from local state

#### Scenario: Cancellation remains globally truthful

- **WHEN** a bounded-loop Run is cancelled while running, strategizing, or waiting
- **THEN** its lifecycle section projects `cancelled` from the canonical terminal transition
- **AND** no domain section or compatibility projection may report the loop as completed or satisfied
