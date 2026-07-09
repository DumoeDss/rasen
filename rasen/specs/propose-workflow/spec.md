# propose-workflow Specification

## Purpose
Provide a single `propose` workflow that combines `new` and `ff` to create a change and its planning artifacts in one step.

## Requirements
### Requirement: Propose workflow creation
The system SHALL provide a `propose` workflow that creates a change and generates all artifacts in one step.

#### Scenario: Basic propose invocation
- **WHEN** user invokes `/rasen:propose "add user authentication"`
- **THEN** the system SHALL create a change directory with kebab-case name
- **THEN** the system SHALL create `.openspec.yaml` in the change directory (via `rasen new change`)
- **THEN** the system SHALL generate all artifacts needed for implementation: proposal.md, design.md, specs/, tasks.md

#### Scenario: Propose with existing change name
- **WHEN** user invokes `/rasen:propose` with a name that already exists
- **THEN** the system SHALL ask if user wants to continue existing change or create new
- **THEN** if "continue": the system SHALL resume artifact generation from last completed state
- **THEN** if "create new": the system SHALL prompt for a new name
- **THEN** in non-interactive mode: the system SHALL fail with error suggesting to use a different name

### Requirement: Propose workflow onboarding UX
The `propose` workflow SHALL include explanatory output to help new users understand the process.

#### Scenario: First-time user guidance
- **WHEN** user invokes `/rasen:propose`
- **THEN** the system SHALL explain what artifacts will be created (proposal.md, design.md, specs/, tasks.md)
- **THEN** the system SHALL indicate next step (`/rasen:apply` to implement)

#### Scenario: Artifact creation progress
- **WHEN** the system creates each artifact
- **THEN** the system SHALL show progress (e.g., "✓ Created proposal.md")

### Requirement: Propose workflow combines new and ff
The `propose` workflow SHALL perform the same operations as running `new` followed by `ff`.

#### Scenario: Equivalent to new + ff
- **WHEN** user invokes `/rasen:propose "feature name"`
- **THEN** the result SHALL be functionally equivalent to invoking `/rasen:new "feature-name"` followed by `/rasen:ff feature-name`
- **THEN** the same directory structure and artifacts SHALL be created
- **THEN** console output MAY differ (propose includes onboarding explanations)

### Requirement: Consume office-hours validation as input context

The `propose` workflow SHALL, after creating the change and before drafting the proposal, look for office-hours validation output and read it as input context when present. Path lookups SHALL be resolved from `rasen status --json` (`changeRoot`, `planningHome`) rather than hardcoding repo-local paths. This wires the consumer side of the `opsx-office-hours-command` "Downstream Consumption by Propose" promise.

#### Scenario: Office-hours doc present in the change directory

- **WHEN** propose has created the change and resolved `changeRoot` from status JSON
- **AND** `office-hours-design.md` exists in `changeRoot`
- **THEN** the generated skill/command SHALL instruct reading that file as input context before drafting
- **AND** the generated proposal SHALL incorporate its findings, naming office-hours as the source

#### Scenario: Office-hours doc discoverable by slug in the sibling directory

- **WHEN** no `office-hours-design.md` exists in the change directory
- **AND** a file named `<change-name>.md` exists in the office-hours directory alongside the changes directory (resolved from `planningHome.changesDir`)
- **THEN** propose SHALL read that file as input context, since office-hours derives its filename slug the same way propose derives a change name, so the names align
- **AND** SHALL incorporate its findings into the proposal

#### Scenario: No office-hours output

- **WHEN** neither location contains an office-hours document for the change
- **THEN** propose SHALL proceed normally without office-hours context

