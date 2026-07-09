# review-cycle-workflow Specification

## Purpose
Re-bases `review-cycle` onto the shared `opsx-orchestration` playbook as its inner loop, and corrects the primary/fallback ordering so the `SendMessage`-driven multi-agent path is PRIMARY and single-context is the explicit fallback — making author ≠ verifier structural rather than a same-context convention.

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Shares the Orchestration Playbook

The review-cycle workflow SHALL consume the shared `opsx-orchestration` playbook as its inner loop rather than embedding its own orchestration mechanics.

#### Scenario: Reuses the playbook

- **WHEN** the review-cycle instructions describe how the loop is driven
- **THEN** they SHALL reference the `opsx-orchestration` playbook for tier detection, role-isolated dispatch, run-state, and escalation
- **AND** SHALL continue to delegate each review pass to the `openspec-gstack-review` engine without forking it
