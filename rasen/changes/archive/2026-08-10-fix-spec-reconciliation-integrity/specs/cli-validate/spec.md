## ADDED Requirements

### Requirement: Validation preserves complete reconciliation diagnostics

`rasen validate` SHALL report every independent delta-shape, canonical-reconciliation, and projected-spec error with stable source and capability identity. Human and JSON output SHALL preserve the same complete deterministic issue set in direct and bulk validation.

#### Scenario: Fenced scenario examples do not satisfy preservation

- **GIVEN** a canonical requirement has a real scenario that is absent from its `MODIFIED` replacement
- **AND** the replacement contains a matching `#### Scenario:` heading only inside a fenced Markdown example
- **WHEN** the change is validated
- **THEN** plain validation SHALL report the missing scenario as a warning
- **AND** strict validation SHALL report it as an error and mark the change invalid

#### Scenario: Duplicate modified blocks retain preservation findings

- **GIVEN** a delta contains duplicate `MODIFIED` blocks for one canonical requirement
- **AND** the duplicate blocks omit different current scenarios
- **WHEN** the change is validated
- **THEN** validation SHALL report the duplicate-header error
- **AND** it SHALL report the missing-scenario findings contributed by every duplicate block
- **AND** no duplicate block SHALL be selected as the projected replacement

#### Scenario: Shape errors suppress only equivalent projected errors

- **GIVEN** one delta requirement has a shape error with an equivalent projected-spec error
- **AND** another projected requirement has an independent error
- **WHEN** the change is validated
- **THEN** validation SHALL deduplicate the equivalent issue for the same source, requirement, and error kind
- **AND** it SHALL retain the independent projected error

#### Scenario: Unreadable delta retains capability identity

- **GIVEN** a discovered delta spec cannot be read
- **WHEN** the change is validated on Windows, macOS, or Linux
- **THEN** its `spec_delta_read_failed` issue SHALL include the capability path relative to the change's `specs` directory
- **AND** nested capability segments SHALL use the same stable identity as readable deltas

#### Scenario: Direct validation renders every error

- **GIVEN** a change has at least two independent validation errors across capabilities
- **WHEN** direct validation is rendered as human output or JSON
- **THEN** every error SHALL be present in deterministic order
- **AND** JSON issue metadata SHALL identify each affected capability and requirement when available

#### Scenario: Bulk validation renders every error

- **GIVEN** a selected change has at least two independent validation errors across capabilities
- **WHEN** bulk validation runs in human or JSON mode, including strict validation
- **THEN** the item's complete error set SHALL be rendered without first-error truncation
- **AND** its validity and the bulk summary SHALL reflect the full report
