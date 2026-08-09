# executable-review-cycle Specification Delta

## MODIFIED Requirements

### Requirement: Reconciler executes bounded-loop ReviewCycle nodes

The deterministic reconciler SHALL recognize `bounded-loop` plan nodes, project ReviewCycle domain progress from the frozen plan and committed Record, and pass that snapshot to the shared bounded-loop lifecycle reducer. The ReviewCycle reducer SHALL continue to own review, triage, fix, re-review, findings, and `clean` domain semantics; it SHALL NOT own lifecycle counters or mechanical terminal policy. The reconciler SHALL emit only the typed candidate selected by the lifecycle decision. A clean domain result SHALL make the bounded-loop node succeed, while a lifecycle exit, escalation, failure, wait, or strategy SHALL follow the sealed policy without claiming clean. The reconciler SHALL guard `finishCandidate` while the lifecycle has remaining work.

#### Scenario: First phase admitted on start

- **WHEN** a Run with one bounded-loop node (no root atomic dependencies) is started
- **THEN** the lifecycle reducer selects exactly one `admit` candidate for the round-1 review phase nodeId
- **AND** the admit carries the review phase's admissionKind and workspace access
- **AND** the finish candidate does not fire

#### Scenario: Clean exit contributes to succeeded set

- **WHEN** the ReviewCycle reaches `clean` with no open Blocker or Major findings
- **THEN** the reconciler adds the bounded-loop nodeId to the succeeded set
- **AND** no new loop action is admitted
- **AND** a downstream finish node or implicit finish becomes eligible

#### Scenario: Mechanical trigger follows sealed lifecycle policy

- **WHEN** the ReviewCycle reaches an iteration, action, budget, stall, blocked, or strategy-exhausted trigger
- **THEN** the reconciler emits the ready, strategy, wait, exit, escalate, or fail candidate declared by the frozen lifecycle policy
- **AND** it does not hard-code that trigger to `review_cycle_exhausted`

#### Scenario: Waiting phase produces no duplicate candidate

- **WHEN** the latest ReviewCycle phase attempt is active or has an unresolved lifecycle wait
- **THEN** the reconciler does not emit another admit for that attempt
- **AND** the Run classification is `running` or `waiting`

### Requirement: Round cap produces explicit exhausted outcome

When the ReviewCycle reaches its max-iterations limit with open Blocker or Major findings, the shared lifecycle reducer SHALL produce an explicit iteration-limit decision using the sealed `iterationLimit` disposition. The Run SHALL NOT silently loop, stall, or finish as clean. A strategy disposition SHALL use the separate strategy budget; an exit, escalation, or failure SHALL preserve the declared typed outcome in the canonical lifecycle projection.

#### Scenario: Max rounds can request a bounded strategy

- **WHEN** re-review completes in the final normal round with an open Major and `iterationLimit` maps to `strategy`
- **THEN** the loop does not enter the clean succeeded set
- **AND** the next candidate is the next bounded strategy attempt when one remains

#### Scenario: Max rounds can terminate with an explicit outcome

- **WHEN** re-review completes in the final normal round with an open Major and `iterationLimit` maps to `escalate`
- **THEN** the reconciler emits an escalate candidate with the declared lifecycle outcome
- **AND** the lifecycle section records `iteration-limit` rather than clean completion

### Requirement: Cross-plane projection parity from one ChangeRunView

CLI, Management API, and Operations SHALL consume the same `ChangeRunView`, including the shared `bounded-loop-lifecycle/1` section and the separate `review-cycle/1` section. The lifecycle section SHALL own loop path, iteration, phase, limits, progress and blocker fingerprints, stall and blocked streaks, strategy state, wait, and lifecycle outcome. The review section SHALL own findings, actor, attestation, and clean domain outcome. No plane SHALL maintain a separate projection or progress tracker.

#### Scenario: CLI status composes lifecycle and review detail

- **WHEN** `rasen pipeline status` is run for a Run with an active ReviewCycle
- **THEN** the output shows lifecycle counters and wait state from the lifecycle section plus open findings and actors from the review section
- **AND** both sections come from the same `ChangeRunView`

#### Scenario: Management API returns the same view

- **WHEN** `GET /api/v1/runs/<changeId>/<runId>` is called for a Run with an active ReviewCycle
- **THEN** the response includes the same lifecycle and review section data
- **AND** it does not compute ReviewCycle lifecycle progress independently

## ADDED Requirements

### Requirement: ReviewCycle supplies domain facts without owning shared mechanics

The ReviewCycle adapter SHALL expose a deterministic domain snapshot containing current iteration and phase, clean or continue intent, the next domain invocation, and structured progress material derived from unresolved Blocker and Major findings plus accepted-known findings. Actor identity, evidence text, and prose SHALL NOT change progress identity. ReviewCycle code SHALL NOT count stalls, repeated blockers, strategy attempts, action use, or budget use after the shared lifecycle is installed.

#### Scenario: Finding state determines review progress identity

- **WHEN** two review results differ only in actor or prose while their stable unresolved and accepted-known finding sets are equal
- **THEN** the adapter supplies equivalent progress material
- **AND** the shared lifecycle computes the same fingerprint

#### Scenario: Review domain state remains distinct

- **WHEN** a review iteration contains findings, triage decisions, fixes, and re-review evidence
- **THEN** those values remain validated and reduced by the ReviewCycle contracts
- **AND** no GoalLoop score or gap schema is introduced into the ReviewCycle reducer

### Requirement: Review blocked recovery always reads the latest attempt

ReviewCycle phase lookup SHALL select the latest attempt by committed attempt ordinal with ActionId as a stable tie-breaker. A blocked completion SHALL use the typed bounded-loop blocked envelope. Resuming its wait SHALL admit a fresh phase attempt, and a later successful completion SHALL supersede the obsolete blocked attempt for reconciliation and projection.

#### Scenario: Review retry escapes an earlier blocked attempt

- **WHEN** review round 1 blocks, its wait is resumed, and attempt 2 completes successfully
- **THEN** ReviewCycle advances from attempt 2
- **AND** restart projects the same next phase without recreating the old wait

#### Scenario: Repeated review blocker enters declared lifecycle branch

- **WHEN** successive latest attempts report the same semantic review blocker until the configured threshold
- **THEN** the shared lifecycle applies the declared blocked strategy, human-required, or terminal disposition
- **AND** ReviewCycle does not invent its own escalation rule
