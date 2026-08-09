## ADDED Requirements

### Requirement: Ship log reserves the Archive section for the archive engine

The ship workflow SHALL treat the level-two `## Archive` heading as a reserved, engine-owned section. Ship-generated evidence SHALL omit that heading, and ship preflight SHALL refuse an existing change-owned ship log that already contains it before delivery facts are updated. Only the archive engine MAY add the section while finalizing staged evidence before hashing.

#### Scenario: Generated ship log contains no archive placeholder

- **WHEN** ship creates `ship-log.md` for any delivery mode or archive timing
- **THEN** the generated log SHALL contain delivery, verification, and deployment facts without a `## Archive` heading or placeholder
- **AND** deferred `on-merge` timing SHALL be recorded without pre-creating the reserved section

#### Scenario: Existing reserved heading blocks ship preflight

- **WHEN** ship preflight reads an existing ship log containing `## Archive`
- **THEN** it SHALL refuse to overwrite or append delivery evidence until the operator removes or renames that section
- **AND** the diagnostic SHALL state that the archive engine owns the heading

#### Scenario: Engine finalization is the only writer

- **WHEN** archive finalizes a valid staged ship log
- **THEN** the archive engine MAY add the reserved section with its transaction-owned chain record
- **AND** no later ship step SHALL append to or rewrite the finalized evidence
