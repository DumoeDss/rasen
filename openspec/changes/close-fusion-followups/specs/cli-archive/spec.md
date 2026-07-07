## MODIFIED Requirements

### Requirement: Spec Update Process

Before moving the change to archive, the command SHALL apply delta changes to main specs to reflect the deployed reality.

#### Scenario: Applying delta changes

- **WHEN** archiving a change with delta-based specs
- **THEN** parse and apply delta changes as defined in openspec-conventions
- **AND** validate all operations before applying

#### Scenario: Validating delta changes

- **WHEN** processing delta changes
- **THEN** perform validations as specified in openspec-conventions
- **AND** if validation fails, show specific errors and abort

#### Scenario: Conflict detection

- **WHEN** applying deltas would create duplicate requirement headers
- **THEN** abort with error message showing the conflict
- **AND** suggest manual resolution

#### Scenario: Zero-requirements spec deletion

- **WHEN** applying a change's deltas leaves an existing spec with zero requirements (every requirement REMOVED, none remaining)
- **THEN** the command SHALL delete that spec's directory from the main specs instead of writing an empty spec
- **AND** SHALL log a clear message naming the deleted capability
- **AND** SHALL treat this as a supported outcome, not a validation failure (no abort)
- **AND** `openspec validate --strict` SHALL pass afterward because the spec no longer exists rather than being left empty
- **AND** SHALL NOT delete a spec that still has any surviving requirement, nor a spec that did not already exist before this change
