# review-cycle-workflow Specification

## Purpose
Provide an iterative review → triage → fix → re-review loop (the `/rasen:review-cycle` skill and command) that delegates each pass to the review engine, enforces the author≠verifier invariant, escalates unresolved Blocker/Major findings instead of silently passing, runs tool-agnostically with an optional Claude acceleration path, ships opt-in, and shares the orchestration playbook.
## Requirements
### Requirement: Review-Cycle Skill and Command Templates

The system SHALL provide a SkillTemplate and a CommandTemplate for the review-cycle workflow in `src/core/templates/workflows/review-cycle.ts`, registered through the existing skill/command generation pipeline so that `rasen init` installs them when the workflow is selected.

#### Scenario: Template file exports

- **WHEN** the template file is loaded
- **THEN** it SHALL export `getReviewCycleSkillTemplate()` returning a SkillTemplate named `rasen-review-cycle`
- **AND** it SHALL export `getOpsxReviewCycleCommandTemplate()` returning a CommandTemplate for `/rasen:review-cycle`
- **AND** both templates SHALL follow the same pattern as existing workflow templates (e.g. `ship.ts`, `verify-enhanced.ts`)

#### Scenario: Delegates to the review engine, does not fork it

- **WHEN** the review-cycle instructions describe how to run a review pass
- **THEN** they SHALL invoke the existing `rasen-review` skill as the review engine
- **AND** they SHALL NOT reimplement the review heuristics inline

### Requirement: Iterative Review-Fix-Re-Review Loop

The workflow SHALL run an iterative loop that reviews the diff, triages findings, applies fixes, and re-reviews the delta, repeating until the change is clean or the round cap is reached.

#### Scenario: Loop continues while resolvable findings remain

- **WHEN** a review pass produces findings that are resolved by fixes in the current round
- **AND** the round cap has not been reached
- **THEN** the workflow SHALL re-review the delta produced by those fixes
- **AND** SHALL continue the loop until a review pass returns no Blocker or Major findings

#### Scenario: Loop ends clean

- **WHEN** a review pass returns no unresolved Blocker or Major findings
- **THEN** the workflow SHALL terminate the loop and report a clean pass
- **AND** SHALL record the round history and which non-author check confirmed each previously open finding

### Requirement: Fix-Size Triage Routes Each Finding

Each finding SHALL be triaged by fix size and routed to the appropriate actor before a fix is applied.

#### Scenario: Trivial finding handled inline by the orchestrator

- **WHEN** a finding is triaged as trivial
- **THEN** the orchestrator MAY fix it inline
- **AND** the fix MUST still be confirmed by the trivial-fix non-author check (an independent gate-run plus a diff-read of the change)

#### Scenario: Non-trivial finding handled by the implementing agent

- **WHEN** a finding is triaged as non-trivial
- **THEN** the workflow SHALL route the fix to the implementing agent that wrote the affected code
- **AND** the fix MUST be re-reviewed by a non-author before it is marked resolved

#### Scenario: Design-level finding handled by a separate fix agent

- **WHEN** a finding is triaged as design-level
- **THEN** the workflow SHALL route the fix to a separate fix agent rather than the original author
- **AND** the resulting change MUST be re-reviewed by a non-author before it is marked resolved

### Requirement: Fix Is Independently Re-Reviewed (Author ≠ Verifier)

A finding SHALL be marked resolved only when a non-author confirms the fix against the original finding; under the multi-agent path this SHALL be enforced structurally by role isolation, not merely by convention.

#### Scenario: Structural non-author confirmation

- **WHEN** running under the multi-agent path
- **THEN** the worker that re-reviews a fix SHALL be a different worker (different context) than the one that authored the fix
- **AND** the finding SHALL be marked resolved only after that distinct worker confirms it against the original finding text

#### Scenario: Trivial inline fix uses the equivalent non-author check

- **WHEN** a trivial fix is applied inline by the LEAD
- **THEN** an independent gate-run (tests/lint/build) plus a diff-read of the exact change SHALL serve as the equivalent non-author check
- **AND** that check MUST be recorded in the cycle report / run-state

### Requirement: Tool-Agnostic Loop with Optional Claude Acceleration

The loop SHALL be driven by the `opsx-orchestration` playbook, whose PRIMARY path uses role-isolated subagents (Tier A resumes the original reviewer via `SendMessage` for a delta-only re-review). Single-context execution SHALL be the explicit fallback for tools without subagent capability, NOT the baseline.

#### Scenario: Multi-agent path is primary

- **WHEN** the host supports subagents (Tier A or B per `opsx-orchestration`)
- **THEN** the review pass, the fix, and the re-review SHALL run as distinct role-isolated workers
- **AND** on Tier A the LEAD SHALL resume the original reviewer via `SendMessage` to re-review only the fix delta
- **AND** only the LEAD SHALL originate `SendMessage`

#### Scenario: Single-context is the explicit fallback

- **WHEN** the host has no subagent capability (Tier C)
- **THEN** the loop SHALL fall back to a single-context fresh delta review with prior findings passed through a shared file
- **AND** this SHALL be treated as the fallback path, not the primary one

### Requirement: Unresolved Findings Escalate, Never Silently Pass

The loop SHALL terminate at a max-rounds cap (default 3), and on reaching the cap with unresolved Blocker or Major findings the workflow SHALL escalate to the human rather than report a clean pass.

#### Scenario: Round cap reached with unresolved blockers

- **WHEN** the loop reaches the max-rounds cap
- **AND** one or more Blocker or Major findings remain unresolved
- **THEN** the workflow SHALL STOP and escalate to the human
- **AND** SHALL surface the open findings and the round history
- **AND** SHALL NOT report a clean pass

#### Scenario: Never silently pass on open blockers

- **WHEN** any Blocker or Major finding remains unresolved
- **THEN** the workflow SHALL NOT report the change as clean or passed under any condition
- **AND** SHALL require either resolution-with-non-author-confirmation or human escalation

### Requirement: Ships Opt-In, Not Core

The review-cycle workflow SHALL ship in the expanded/opt-in workflow set and SHALL NOT be part of the `core` profile.

#### Scenario: Present in the expanded set

- **WHEN** the workflow registry is enumerated
- **THEN** `'review-cycle'` SHALL appear in `ALL_WORKFLOWS`
- **AND** the corresponding skill and command templates SHALL be registered in `getSkillTemplates()` and `getCommandTemplates()`

#### Scenario: Absent under the core profile

- **WHEN** workflows are generated under the `core` profile
- **THEN** `'review-cycle'` SHALL NOT be present in `CORE_WORKFLOWS`
- **AND** the review-cycle skill and command SHALL NOT be generated for the `core` profile

### Requirement: Shares the Orchestration Playbook

The review-cycle workflow SHALL consume the shared `opsx-orchestration` playbook as its inner loop rather than embedding its own orchestration mechanics.

#### Scenario: Reuses the playbook

- **WHEN** the review-cycle instructions describe how the loop is driven
- **THEN** they SHALL reference the `opsx-orchestration` playbook for tier detection, role-isolated dispatch, run-state, and escalation
- **AND** SHALL continue to delegate each review pass to the `rasen-review` engine without forking it

### Requirement: Gate-Run Test Evidence Is Recorded for Ship

The cycle report SHALL record test evidence consumable by the ship stage's evidence-based test gate: for the final clean round (and for every Tier C gate-run), the exact test/gate command(s) executed, their result, and the content tree fingerprint (`git rev-parse HEAD^{tree}`) of the git code state they ran against.

#### Scenario: Final clean round records test evidence

- **WHEN** a review cycle ends clean
- **THEN** `review-cycle-report.md` SHALL record the test/gate command(s) of the final round, their passing result, and the content tree fingerprint (`git rev-parse HEAD^{tree}`) of the git state they ran against

#### Scenario: Ship consumes the evidence

- **WHEN** a later ship stage evaluates its evidence-based test gate
- **THEN** the recorded content tree fingerprint SHALL be sufficient to decide whether the code state is unchanged since the last green run, by direct comparison against the ship-time tree fingerprint

