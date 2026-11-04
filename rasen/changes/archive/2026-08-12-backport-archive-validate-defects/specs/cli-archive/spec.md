## ADDED Requirements

### Requirement: Apply-time merge confirmation clears the on-merge timing gate
A change with `archive.timing: on-merge` delivered by pull request SHALL clear the timing blocker at apply time through an explicit `mergeConfirmed` assertion, without depending on a merge override frozen into the stored immutable plan. The stored plan SHALL remain byte-identical whether or not the assertion is supplied, and the documented `--save-plan` → `--apply-plan --yes` sequence SHALL complete for every `pr` + `on-merge` change.

#### Scenario: Saved without --yes, applied with --yes
- **WHEN** a `pr` + `on-merge` plan was saved without `--yes` and is later applied with `--yes`
- **THEN** the apply SHALL complete, because the `mergeConfirmed` assertion filters the timing blocker at apply time
- **AND** the stored plan's frozen override SHALL remain unchanged

#### Scenario: Applied without confirmation stays blocked
- **WHEN** the same plan is applied without the merge-confirmation assertion
- **THEN** it SHALL remain blocked by the timing gate

### Requirement: Strict archive-intent rejections name the offending constraint
An archive intent that fails strict validation SHALL be rejected with a stable code and a message that names the specific offending field or key, distinct per failure mode. A generic schema restatement that reads identically across failure modes SHALL NOT be used.

#### Scenario: Unexpected key is named
- **WHEN** an intent carries a key outside the accepted set
- **THEN** the rejection SHALL name that key and list the accepted keys

#### Scenario: Wrong schemaVersion names the received value
- **WHEN** an intent carries a wrong `schemaVersion`
- **THEN** the rejection SHALL name `schemaVersion` and the received value

### Requirement: Archive planning rejects a reserved ship-log heading
Archive planning SHALL detect a reserved `## Archive` heading in the ship log and emit a typed evidence blocker before declaring the plan complete or issuing a plan token. The apply-time collision guard remains as a second layer.

#### Scenario: Reserved heading blocks the plan
- **WHEN** the ship log contains a `## Archive` heading authored before archive
- **THEN** the plan SHALL be incomplete with an evidence blocker naming that reserved heading
- **AND** no plan token SHALL be issued until the heading is removed or renamed

#### Scenario: Clean ship log proceeds
- **WHEN** the ship log has no reserved `## Archive` heading
- **THEN** the plan SHALL proceed without the reserved-heading blocker
