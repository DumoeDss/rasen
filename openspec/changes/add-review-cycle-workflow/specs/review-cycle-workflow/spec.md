# review-cycle-workflow Specification

## Purpose
Defines the `/opsx:review-cycle` runtime workflow — an iterative post-implementation loop (`review → triage → fix → re-review(Δ) → {pass | loop | escalate}`) that delegates each review pass to the `openspec-gstack-review` engine while owning the loop, fix-size triage, the author-vs-verifier invariant, deterministic termination, and human escalation.

## ADDED Requirements

### Requirement: Review-Cycle Skill and Command Templates

The system SHALL provide a SkillTemplate and a CommandTemplate for the review-cycle workflow in `src/core/templates/workflows/review-cycle.ts`, registered through the existing skill/command generation pipeline so that `openspec init` installs them when the workflow is selected.

#### Scenario: Template file exports

- **WHEN** the template file is loaded
- **THEN** it SHALL export `getReviewCycleSkillTemplate()` returning a SkillTemplate named `openspec-review-cycle`
- **AND** it SHALL export `getOpsxReviewCycleCommandTemplate()` returning a CommandTemplate for `/opsx:review-cycle`
- **AND** both templates SHALL follow the same pattern as existing workflow templates (e.g. `ship.ts`, `verify-enhanced.ts`)

#### Scenario: Delegates to the review engine, does not fork it

- **WHEN** the review-cycle instructions describe how to run a review pass
- **THEN** they SHALL invoke the existing `openspec-gstack-review` skill as the review engine
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

A finding SHALL be marked resolved only when a reviewer who did NOT author the fix confirms the fix against the original finding.

#### Scenario: Non-author confirms a fix

- **WHEN** a fix has been applied for a finding
- **AND** the reviewer confirming the fix is not the agent that authored the fix
- **THEN** the reviewer SHALL confirm the fix against the original finding text
- **AND** only then SHALL the finding be marked resolved

#### Scenario: Trivial inline fix uses the equivalent non-author check

- **WHEN** the orchestrator applies a trivial fix inline
- **THEN** an independent gate-run (tests/lint/build) plus a diff-read of the exact change SHALL serve as the equivalent non-author check
- **AND** that check MUST be recorded in the cycle report

#### Scenario: Self-certification is rejected

- **WHEN** the only confirmation available for a fix is from the agent that authored that fix
- **THEN** the finding SHALL NOT be marked resolved
- **AND** the workflow SHALL obtain an independent confirmation before resolving it

### Requirement: Tool-Agnostic Loop with Optional Claude Acceleration

The loop SHALL be tool-agnostic, with an optional Claude Code agent-teams acceleration that resumes the original reviewer for a delta-only re-review, and a mandatory fallback when resume is unavailable.

#### Scenario: Claude resume path re-reviews only the delta

- **WHEN** running on Claude Code with agent-teams enabled (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`)
- **AND** the original reviewer agent can be resumed
- **THEN** the lead MAY resume that reviewer via `SendMessage` to re-review only the fix delta
- **AND** only the lead SHALL originate `SendMessage`

#### Scenario: Tool-agnostic fallback when resume is unavailable

- **WHEN** agent-teams is unavailable, disabled, or the tool is not Claude Code
- **THEN** the workflow SHALL fall back to a fresh delta review
- **AND** the prior findings and the fix diff SHALL be passed to the fresh reviewer through a shared file
- **AND** the outcome SHALL be equivalent to the resume path (only costlier)

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
