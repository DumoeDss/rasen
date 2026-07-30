# executable-review-cycle Specification

## Purpose
Make the review→fix→re-review loop a property of the deterministic reconciler instead of
a prompt: bounded-loop ReviewCycle execution over a frozen plan and committed Record,
actor truth carried in the committed domain result, malformed results failing closed
before commit, structural fixer/verifier separation, an open Blocker or Major blocking
ship, an explicit exhausted outcome at the round cap, deterministic restart at quiescent
boundaries, one shared ReviewCycle body for every built-in pipeline that has one,
cross-plane projection parity from a single `ChangeRunView`, and a Canvas that views and
safely configures the constrained loop.

The `rasen-review-cycle` skill is a thin launcher over this capability, never a second
copy of its mechanical state.

## Requirements
### Requirement: Reconciler executes bounded-loop ReviewCycle nodes

The deterministic reconciler SHALL recognize `bounded-loop` plan nodes, project ReviewCycle progress from the frozen plan and committed Record, and emit the correct typed candidate action for the next phase. When the ReviewCycle reaches `clean`, the bounded-loop node SHALL contribute to the succeeded set so downstream dependencies may proceed. When the ReviewCycle reaches `exhausted`, the reconciler SHALL emit an escalate candidate with the loop's exhausted outcome. The reconciler SHALL guard `finishCandidate` so a bounded-loop with remaining work never allows the Run to premature-finish.

#### Scenario: First phase admitted on start

- **WHEN** a Run with one bounded-loop node (no root atomic dependencies) is started
- **THEN** the reconciler SHALL emit exactly one `admit` candidate for the round-1 review phase nodeId
- **AND** the admit SHALL carry the review phase's admissionKind and workspace access
- **AND** the finish candidate SHALL NOT fire (the bounded-loop has remaining work)

#### Scenario: Clean exit contributes to succeeded set

- **WHEN** the ReviewCycle reaches `clean` (no open Blocker/Major findings)
- **THEN** the reconciler SHALL add the bounded-loop nodeId to the succeeded set
- **AND** SHALL NOT emit a new admit candidate for the bounded-loop
- **AND** a downstream finish node or implicit finish SHALL become eligible

#### Scenario: Exhausted maps to escalate

- **WHEN** the ReviewCycle reaches `exhausted` (round cap hit with open Blocker/Major)
- **THEN** the reconciler SHALL emit an `escalate` candidate with the bounded-loop's `outcomes.exhausted` code
- **AND** the Run SHALL NOT finish as completed

#### Scenario: Waiting phase produces no fresh candidate

- **WHEN** the current ReviewCycle phase has an active (admitted but not completed) action
- **THEN** the reconciler SHALL NOT emit a new admit candidate for the same nodeId
- **AND** the Run classification SHALL be `running` or `waiting`

### Requirement: Committed domain result carries actor truth

Every committed domain result SHALL carry the `actor` (ActorRef) and `actorAttestation` (EvidenceRef) that produced it, so that round, phase, finding, actor, and evidence are reconstructable from the immutable plan and canonical Record alone.

#### Scenario: ReviewCycle result includes actor and attestation

- **WHEN** a ReviewCycle phase action completes with a domain-action-result
- **THEN** the committed `CommittedDomainResult` SHALL include the `actor` field (ActorRef of the agent that produced the result)
- **AND** SHALL include the `actorAttestation` field (EvidenceRef binding the actor to the action)
- **AND** both fields SHALL be reconstructable by decoding the canonical Record

#### Scenario: Non-ReviewCycle results remain valid without actor

- **WHEN** a non-ReviewCycle atomic action completes with a domain-action-result
- **THEN** the committed result MAY omit `actor` and `actorAttestation`
- **AND** the Record SHALL remain valid

### Requirement: Malformed ReviewCycle results fail closed before commit

The runtime SHALL validate every ReviewCycle phase completion against the expected phase contract BEFORE committing the result to the canonical Record. A malformed review, triage, fix, or re-review result SHALL be rejected without mutating the Record.

#### Scenario: Malformed review result rejected

- **WHEN** a review-phase completion carries a result that does not match `review-cycle/review-result/1`
- **THEN** the completion SHALL be rejected with code `malformed_review_cycle_result`
- **AND** the Record SHALL remain at its pre-completion state

#### Scenario: Completion for wrong phase rejected

- **WHEN** a completion is submitted for a nodeId that does not match the currently expected ReviewCycle phase
- **THEN** the completion SHALL be rejected with code `invalid_review_cycle_transition`
- **AND** the Record SHALL remain unchanged

### Requirement: Same-actor fixer and verifier separation

The system SHALL reject a re-review completion whose actor identity matches the fixer that produced the preceding fix result. The actor-separation invariant SHALL be enforced before commit, not after.

#### Scenario: Fixer cannot self-verify

- **WHEN** the same actor (by `identityDigest`) submits both the fix-phase result and the re-review-phase result in the same round
- **THEN** the re-review completion SHALL be rejected with code `review_cycle_actor_separation`
- **AND** the Record SHALL remain at the post-fix state

### Requirement: Open Blocker or Major blocks ship

The presence of any open Blocker or Major finding SHALL prevent the Run from reaching a completed terminal state through any normal progression path. The ship guard SHALL be enforced by the domain reducer's `assertReviewCycleMayShip` and by the reconciler's clean-exit logic.

#### Scenario: Open Major prevents clean exit

- **WHEN** a review or re-review result resolves some findings but at least one Blocker or Major finding remains open
- **THEN** the ReviewCycle SHALL NOT reach `clean`
- **AND** the bounded-loop SHALL NOT contribute to the succeeded set
- **AND** the Run SHALL NOT finish as completed

### Requirement: Round cap produces explicit exhausted outcome

When the ReviewCycle reaches its max-iterations limit with open Blocker/Major findings, the system SHALL produce an explicit `exhausted` outcome mapped to a terminal escalated state. The Run SHALL NOT silently loop, stall, or finish as completed.

#### Scenario: Max rounds reached with open Major

- **WHEN** the re-review phase completes in the final round with a still-open Major finding
- **THEN** the ReviewCycle SHALL reach `exhausted`
- **AND** the reconciler SHALL emit an escalate candidate
- **AND** the Record terminal SHALL be `{ kind: 'escalated', code: 'review_cycle_exhausted' }`

### Requirement: Restart at quiescent boundaries is deterministic

After a process restart at any ReviewCycle quiescent boundary (after review commit, after fix commit, after re-review commit), the system SHALL reconstruct the exact same ReviewCycle state and next-ready action from the frozen plan and committed Record. Completed actions SHALL NOT be re-admitted, and open findings plus the next ready action SHALL remain deterministic.

#### Scenario: Restart after review commit

- **WHEN** a process restarts after the review-phase result was committed but before the triage phase was admitted
- **THEN** resume SHALL project the ReviewCycle at round 1, phase triage
- **AND** SHALL admit the triage-phase action
- **AND** SHALL NOT re-admit the review-phase action (it has a committed result)

#### Scenario: Restart after fix commit

- **WHEN** a process restarts after the fix-phase result was committed but before the re-review phase was admitted
- **THEN** resume SHALL project the ReviewCycle at the current round, phase re-review
- **AND** SHALL admit the re-review-phase action with the correct nodeId

#### Scenario: Crash before commit leaves action active

- **WHEN** a crash occurs after an action was admitted but before its completion was committed
- **THEN** the action SHALL remain in `active` state in the Record
- **AND** resume SHALL detect the active action and surface a wait (not re-admit)

### Requirement: Built-in pipelines route through the same ReviewCycle body

The `bug-fix` pipeline (complex branch) and the `small-feature` pipeline SHALL normalize to v2 definitions that include a BoundedLoop with the same 4-phase ReviewCycle body (review, triage, fix, re-review). Both SHALL execute through the canonical reconciler, not through prompt-owned mechanical loops.

#### Scenario: bug-fix routes through ReviewCycle

- **WHEN** a Run is started for the `bug-fix` pipeline targeting the reconciler engine
- **THEN** the lowered plan SHALL include a bounded-loop node with the ReviewCycle body
- **AND** the review phase SHALL replace the legacy adaptive verify stage
- **AND** the plan SHALL no longer produce `ecp_v2_runtime_unavailable`

#### Scenario: small-feature routes through ReviewCycle

- **WHEN** a Run is started for the `small-feature` pipeline targeting the reconciler engine
- **THEN** the lowered plan SHALL include a bounded-loop node with the same ReviewCycle body declaration shape
- **AND** the review-loop stage SHALL be replaced by the bounded-loop

#### Scenario: Both share the same body shape

- **WHEN** the bug-fix and small-feature ReviewCycle bodies are compared
- **THEN** both SHALL declare the same 4 phases in the same order (review, triage, fix, re-review)
- **AND** both SHALL use the same capability contract IDs for corresponding phases

### Requirement: Cross-plane projection parity from one ChangeRunView

CLI, Management API, and Operations SHALL consume the same `ChangeRunView` (including its `review-cycle` section) for composite path, round, phase, findings, actor, evidence, wait reason, and terminal state. No plane SHALL maintain a separate projection or progress tracker.

#### Scenario: CLI status shows ReviewCycle progress

- **WHEN** `rasen pipeline status` is run for a Run with an active ReviewCycle
- **THEN** the output SHALL show the current round, phase, open findings, and actors
- **AND** the data SHALL come from the same `ChangeRunView` sections array

#### Scenario: Management API returns the same view

- **WHEN** `GET /api/v1/runs/<changeId>/<runId>` is called for a Run with an active ReviewCycle
- **THEN** the response SHALL include the same review-cycle section data
- **AND** SHALL NOT compute ReviewCycle progress independently

### Requirement: Canvas views and safely configures the constrained ReviewCycle

Canvas SHALL display the ReviewCycle BoundedLoop body (phases, max rounds, exits) and reflect whether the definition is executable via the reconciler. Canvas SHALL NOT mark an unexecutable shape as runnable. The max-rounds scalar SHALL be safely configurable without editing the body shape.

#### Scenario: BoundedLoop card displays body details

- **WHEN** a BoundedLoop node is selected in the Canvas
- **THEN** the detail panel SHALL show the 4 phases, max rounds, and exit outcomes
- **AND** SHALL NOT offer to add, remove, or reorder phases

#### Scenario: Unexecutable definition not marked as runnable

- **WHEN** a definition contains a BoundedLoop but lacks the required capability bindings
- **THEN** the Canvas SHALL show the execution support status as not supported
- **AND** SHALL NOT present a "Run" action for the definition

### Requirement: Real finding completes the full review cycle

A real ReviewCycle Run SHALL complete the full loop: an initial review produces at least one structured finding, the system triages and fixes it, an independent (non-author) verifier re-reviews the delta, and the cycle reaches clean. The evidence (revision, RunId, ActionId, actor, evidence refs) SHALL be recorded.

#### Scenario: One finding through the full cycle

- **WHEN** a real change is run through the ReviewCycle
- **AND** the initial review produces a Major finding
- **THEN** the system SHALL triage, fix, and independently re-review the finding
- **AND** the Run SHALL reach `completed` terminal state
- **AND** the finding SHALL be `resolved` in the final projection

