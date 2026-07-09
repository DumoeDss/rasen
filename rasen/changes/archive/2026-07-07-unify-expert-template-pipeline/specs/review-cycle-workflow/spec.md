## MODIFIED Requirements

### Requirement: Review-Cycle Skill and Command Templates

The system SHALL provide a SkillTemplate and a CommandTemplate for the review-cycle workflow in `src/core/templates/workflows/review-cycle.ts`, registered through the existing skill/command generation pipeline so that `openspec init` installs them when the workflow is selected.

#### Scenario: Template file exports

- **WHEN** the template file is loaded
- **THEN** it SHALL export `getReviewCycleSkillTemplate()` returning a SkillTemplate named `openspec-review-cycle`
- **AND** it SHALL export `getOpsxReviewCycleCommandTemplate()` returning a CommandTemplate for `/opsx:review-cycle`
- **AND** both templates SHALL follow the same pattern as existing workflow templates (e.g. `ship.ts`, `verify-enhanced.ts`)

#### Scenario: Delegates to the review engine, does not fork it

- **WHEN** the review-cycle instructions describe how to run a review pass
- **THEN** they SHALL invoke the existing `openspec-review` skill as the review engine
- **AND** they SHALL NOT reimplement the review heuristics inline

### Requirement: Shares the Orchestration Playbook

The review-cycle workflow SHALL consume the shared `opsx-orchestration` playbook as its inner loop rather than embedding its own orchestration mechanics.

#### Scenario: Reuses the playbook

- **WHEN** the review-cycle instructions describe how the loop is driven
- **THEN** they SHALL reference the `opsx-orchestration` playbook for tier detection, role-isolated dispatch, run-state, and escalation
- **AND** SHALL continue to delegate each review pass to the `openspec-review` engine without forking it
