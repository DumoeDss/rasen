## ADDED Requirements

### Requirement: Apply completion routes through the delivery sequence

The generated apply workflow skill and command SHALL, on all-tasks-complete, steer the user toward verification and shipping before archiving. The completion message SHALL name `/rasen:verify` and `/rasen:ship` as the immediate next steps and SHALL name archive only as the post-delivery step.

#### Scenario: Apply completion nudge

- **WHEN** the generated `rasen-apply-change` skill (or its command variant) reports all tasks complete
- **THEN** the completion message SHALL direct the user to verify and ship before archiving
- **AND** SHALL NOT present archive as the immediate next step

### Requirement: Continue completion routes to implementation

The generated continue workflow skill and command SHALL, on all-artifacts-complete, steer the user toward implementation. The completion message SHALL name `/rasen:apply` as the next step and SHALL name archive only as a later, post-implementation step, not as an immediate co-equal option.

#### Scenario: Continue completion nudge

- **WHEN** the generated `rasen-continue-change` skill (or its command variant) reports all artifacts complete
- **THEN** the completion message SHALL direct the user to implement with `/rasen:apply`
- **AND** SHALL NOT offer archive as an immediate co-equal option before implementation
