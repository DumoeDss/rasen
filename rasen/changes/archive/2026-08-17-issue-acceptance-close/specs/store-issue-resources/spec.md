# store-issue-resources Specification (Delta)

## RENAMED Requirements

- FROM: `### Requirement: An Issue changes only through creating, setting its state, and publishing a plan`
- TO: `### Requirement: An Issue changes only through its five declared mutations`

## MODIFIED Requirements

### Requirement: An Issue changes only through its five declared mutations

An Issue SHALL be mutable only through five operations: creating it, setting its state,
publishing an Execution Plan for it, publishing acceptance conditions for it, and recording an
acceptance of it. Every other interaction with an Issue SHALL be a read. Creating an Issue whose
identifier already exists SHALL be refused rather than overwrite the existing Issue, and setting
a state the product does not define SHALL be refused rather than stored.

#### Scenario: A duplicate Issue is refused

- **WHEN** an Issue is created with an identifier that already exists
- **THEN** the request is refused, naming the existing Issue
- **AND** the existing Issue is unchanged

#### Scenario: An undefined state is refused

- **WHEN** a state outside the defined vocabulary is set on an Issue
- **THEN** the request is refused, naming the states that are defined
- **AND** the Issue's state is unchanged
