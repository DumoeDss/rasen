# lifecycle-stage-sequencing Specification

## Purpose
Steer the apply and continue workflow completion messages through the intended stage sequence (verify -> ship -> archive) rather than offering archive as an immediate, co-equal next step alongside implementation or delivery.
## Requirements
### Requirement: Apply completion routes through the delivery sequence

The generated apply workflow skill SHALL, on all-tasks-complete, direct the user to the next workflow by relaying the CLI's `nextWorkflows` rather than hardcoding a stage chain. The completion message SHALL present the relayed next step(s) — named by this tool's invocation for that skill — and SHALL NOT name a specific downstream workflow (such as verify or ship) as a hardcoded literal, so a lean profile that lacks verify/ship is never pointed at an uninstalled skill. When no `nextWorkflows`-bearing command has been run this turn, the body SHALL instruct running `rasen status --change "<name>" --json` to obtain them.

#### Scenario: Apply completion nudge

- **WHEN** the generated `rasen-apply-change` skill reports all tasks complete
- **THEN** the completion message SHALL relay the CLI's `nextWorkflows` as the next action
- **AND** SHALL NOT contain a hardcoded `/rasen-verify-change` / `/rasen-ship` chain
- **AND** SHALL carry the zero-CLI fallback instruction to run `rasen status --change "<name>" --json`

### Requirement: Continue completion routes to implementation

The generated continue workflow skill SHALL, on all-artifacts-complete, direct the user to the next workflow by relaying the CLI's `nextWorkflows` rather than hardcoding the next stage. The completion message SHALL present the relayed next step (named by this tool's invocation for that skill) and SHALL NOT name a specific downstream workflow as a hardcoded literal, nor offer archive as an immediate co-equal option before implementation.

#### Scenario: Continue completion nudge

- **WHEN** the generated `rasen-continue-change` skill reports all artifacts complete
- **THEN** the completion message SHALL relay the CLI's `nextWorkflows` as the next action
- **AND** SHALL NOT contain a hardcoded `/rasen-apply-change` reference
- **AND** SHALL NOT offer archive as an immediate co-equal option before implementation

