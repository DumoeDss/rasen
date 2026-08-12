## ADDED Requirements

### Requirement: Strict validation rejects scenario-deleting deltas
`rasen validate --strict` SHALL reject a MODIFIED requirement delta that omits scenarios present in the permanent spec baseline, naming the missing scenarios. Plain `validate` SHALL report the same condition as a warning without changing its exit code, so the defect is visible at authoring time rather than only at archive.

#### Scenario: Strict rejects a delta that drops scenarios
- **WHEN** a MODIFIED block omits scenarios that exist in the main spec
- **THEN** `validate --strict` SHALL fail and name every missing scenario

#### Scenario: Plain validate warns and keeps the exit code
- **WHEN** the same delta is validated without `--strict`
- **THEN** it SHALL emit a warning naming the missing scenarios
- **AND** the exit code SHALL match the behavior of a casual `validate` run

### Requirement: Validation reports every preservation failure in one pass
The scenario-preservation check SHALL collect the result for every MODIFIED requirement and report all failures in a single run, rather than stopping at the first failing requirement.

#### Scenario: Multiple failing requirements all reported
- **WHEN** several MODIFIED requirements each omit baseline scenarios
- **THEN** a single `validate --strict` run SHALL report every failing requirement, not only the first
