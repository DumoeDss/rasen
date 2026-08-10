## ADDED Requirements

### Requirement: Delta reconciliation fails closed on ambiguous structure

Rasen SHALL reconcile a delta only from visible Markdown structure and a one-to-one canonical requirement inventory. Ambiguous canonical or delta requirement identities SHALL produce complete diagnostics before any canonical spec is created, replaced, or removed.

#### Scenario: Fenced canonical heading is not a scenario

- **GIVEN** a canonical requirement contains a `#### Scenario:` heading inside a backtick or tilde fenced example
- **WHEN** a `MODIFIED` replacement is reconciled
- **THEN** the fenced heading SHALL NOT be counted as a canonical scenario that the replacement must preserve
- **AND** visible scenario headings outside fenced regions SHALL retain their existing identity

#### Scenario: Fenced incoming heading does not preserve a real scenario

- **GIVEN** a canonical requirement contains a visible scenario
- **AND** its `MODIFIED` replacement repeats that scenario heading only inside a fenced example
- **WHEN** the delta is reconciled
- **THEN** reconciliation SHALL report the visible canonical scenario as missing
- **AND** it SHALL refuse the replacement

#### Scenario: Duplicate canonical headers block before capability deletion

- **GIVEN** a canonical spec contains more than one requirement with the same normalized header
- **AND** a delta would otherwise remove the collapsed requirement key
- **WHEN** the delta is reconciled or applied
- **THEN** Rasen SHALL report the duplicate canonical header as a structural error
- **AND** it SHALL NOT classify the capability as empty
- **AND** the canonical spec file and capability directory SHALL remain unchanged

#### Scenario: Every duplicate modified block is diagnosed without mutation

- **GIVEN** multiple `MODIFIED` blocks use the same normalized requirement header
- **WHEN** the delta is reconciled
- **THEN** Rasen SHALL report the duplicate header
- **AND** it SHALL compare every block with the immutable canonical scenario inventory and report each missing-scenario finding
- **AND** it SHALL NOT choose any duplicate block for mutation
