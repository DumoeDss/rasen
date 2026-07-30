## MODIFIED Requirements

### Requirement: Iterative Review-Fix-Re-Review Loop

The `rasen-review-cycle` skill SHALL act as a thin launcher of the canonical ReviewCycle Run. It SHALL select a change, start or resume the canonical Change Run through the reconciler engine, and project progress from the Run's `ChangeRunView`. The skill SHALL NOT own a second copy of the mechanical loop state (round counter, phase sequencing, max-rounds enforcement, or ship guard). Mechanical progression SHALL be owned by the deterministic reconciler acting on the frozen plan and canonical Record.

#### Scenario: Skill launches the canonical Run

- **WHEN** the `rasen-review-cycle` skill is invoked for a change
- **THEN** it SHALL start or resume the canonical ReviewCycle Run via `rasen pipeline start` / `rasen pipeline resume`
- **AND** SHALL project the current round, phase, findings, and actors from the `ChangeRunView` review-cycle section
- **AND** SHALL NOT maintain its own round counter or phase state

#### Scenario: Loop continues while resolvable findings remain

- **WHEN** a review pass produces findings that are resolved by fixes in the current round
- **AND** the round cap has not been reached
- **THEN** the canonical reconciler SHALL advance to the next round's review phase
- **AND** the skill SHALL project the new round and phase from the `ChangeRunView`
- **AND** the skill SHALL NOT compute the next round itself

#### Scenario: Loop ends clean

- **WHEN** a review pass returns no unresolved Blocker or Major findings
- **THEN** the canonical reconciler SHALL mark the bounded-loop as clean
- **AND** the Run SHALL proceed toward completion
- **AND** the skill SHALL report the clean outcome from the canonical Record

### Requirement: Fix Is Independently Re-Reviewed (Author ≠ Verifier)

A finding SHALL be marked resolved only when a non-author confirms the fix against the original finding. The actor-separation invariant SHALL be enforced structurally by the canonical reducer before commit, not by prompt convention. The reducer SHALL reject a re-review completion whose actor identity matches the fixer's actor identity.

#### Scenario: Structural non-author confirmation

- **WHEN** the same actor (by `identityDigest`) submits both the fix-phase result and the re-review-phase result
- **THEN** the canonical reducer SHALL reject the re-review completion with code `review_cycle_actor_separation`
- **AND** the rejection SHALL occur before the result is committed to the Record
- **AND** under the multi-agent path the worker that re-reviews a fix SHALL still be a different worker (different context) than the one that authored the fix

#### Scenario: Trivial inline fix uses the equivalent non-author check

- **WHEN** a trivial fix is applied inline by the LEAD
- **THEN** an independent gate-run (tests/lint/build) plus a diff-read of the exact change SHALL serve as the equivalent non-author check
- **AND** that check MUST be recorded in the cycle report / run-state

#### Scenario: Skill projects actor information from the Record

- **WHEN** the skill reports on a ReviewCycle Run
- **THEN** it SHALL surface the fixer and verifier actor identities from the committed `CommittedDomainResult.actor` fields
- **AND** SHALL NOT track actor identity in a separate prompt-owned structure

### Requirement: Unresolved Findings Escalate, Never Silently Pass

The canonical reconciler SHALL enforce a max-rounds cap on the ReviewCycle bounded-loop. On reaching the cap with unresolved Blocker or Major findings, the reconciler SHALL emit an escalated terminal state. The skill SHALL project this state from the `ChangeRunView` and SHALL NOT implement its own escalation logic.

#### Scenario: Round cap reached with unresolved blockers

- **WHEN** the reconciler detects that the bounded-loop has reached its max-iterations with open Blocker or Major findings
- **THEN** the reconciler SHALL emit an escalate candidate
- **AND** the Record terminal SHALL be `{ kind: 'escalated', code: 'review_cycle_exhausted' }`
- **AND** the skill SHALL surface this terminal state from the `ChangeRunView`

#### Scenario: Never silently pass on open blockers

- **WHEN** any Blocker or Major finding remains unresolved in the committed Record
- **THEN** the canonical domain reducer SHALL NOT reach `clean`
- **AND** the bounded-loop SHALL NOT contribute to the succeeded set
- **AND** the Run SHALL NOT reach a completed terminal state

### Requirement: Gate-Run Test Evidence Is Recorded for Ship

The canonical Record SHALL carry all ReviewCycle evidence (findings, fix deltas, verification results, actor attestations) in the committed `CommittedDomainResult` fields. The skill's cycle report SHALL be a projection of the canonical Record, not an independent evidence store. The ship stage SHALL consume evidence from the same Record.

#### Scenario: Final clean round records test evidence

- **WHEN** a ReviewCycle Run completes
- **THEN** every finding, fix delta, verification result, and actor attestation SHALL be reconstructable from the committed actions in the canonical Record
- **AND** the selected verification scope, its rationale, the exact test/gate command(s) of the final round, their result, and the content tree fingerprint (`git rev-parse HEAD^{tree}`) they ran against SHALL be among that committed evidence
- **AND** the skill's cycle report SHALL derive its content from the Record via the `ChangeRunView` projection

#### Scenario: Ship consumes the evidence

- **WHEN** a later ship stage evaluates its evidence-based test gate
- **THEN** ship SHALL read the ReviewCycle evidence from the canonical Record's committed domain results
- **AND** SHALL compare the recorded scope against its required verification scope and the recorded tree against the ship-time tree, reusing only the checks whose scope and tree both match
- **AND** SHALL NOT depend on a separate `review-cycle-report.md` file for mechanical state

## ADDED Requirements

### Requirement: Skill Delegates Mechanical State to the Canonical Run

The `rasen-review-cycle` skill SHALL own no second mechanical state. Round advancement, phase sequencing, finding lifecycle, max-rounds enforcement, ship readiness, and actor separation SHALL all be owned by the deterministic reconciler acting on the frozen plan and canonical Record. The skill's role SHALL be limited to: selecting the change, starting or resuming the canonical Run, composing per-phase agent briefs, delegating each review pass to `rasen-review`, and projecting progress from the `ChangeRunView`.

#### Scenario: Skill does not own round or phase state

- **WHEN** the `rasen-review-cycle` skill instructions are inspected
- **THEN** they SHALL NOT contain prompt-owned round counters, phase transition logic, or max-rounds checking
- **AND** they SHALL reference `rasen pipeline status` / `rasen pipeline resume` as the source of truth for Run progress

#### Scenario: Skill composes briefs from canonical state

- **WHEN** the skill prepares an agent brief for a review or fix phase
- **THEN** it SHALL read the current round, phase, and open findings from the `ChangeRunView` review-cycle section
- **AND** SHALL compose the brief from that canonical state
- **AND** SHALL NOT pass round or phase state through prompt-owned variables
