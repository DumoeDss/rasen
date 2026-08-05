## ADDED Requirements

### Requirement: Finalization outcome is explicit and shape-valid

A v2 finalization contract SHALL identify exactly one outcome: `landed`, `superseded`, `cancelled`, or `abandoned`. `landed` SHALL have no reason or successor; every non-landed outcome SHALL have a non-empty reason; only `superseded` SHALL name a successor `ChangeInstanceId`. Validation SHALL reject missing, unknown, or contradictory outcome fields before any mutation plan can consume them.

#### Scenario: Landed outcome has no passive-history reason

- **WHEN** a finalization input declares `landed` without a reason or successor
- **THEN** its outcome shape is valid

#### Scenario: Superseded requires a successor

- **WHEN** a finalization input declares `superseded` without a non-empty reason or verified successor Change instance id
- **THEN** outcome validation rejects it

#### Scenario: Cancelled and abandoned reject successors

- **WHEN** a `cancelled` or `abandoned` input carries `supersededBy`
- **THEN** outcome validation rejects the contradictory field

#### Scenario: Unknown outcome is rejected

- **WHEN** a finalization record names any outcome outside the four defined values
- **THEN** strict validation rejects it

### Requirement: Supersession preserves Store project ownership

Given resolved scope records for the current and successor Changes, pure finalization validation SHALL require a superseding Change to belong to the same permanent Store and project. The successor MAY use another stable target line. Missing or conflicting successor scope evidence SHALL fail validation rather than infer ownership from a Change alias, directory, or branch.

#### Scenario: Same project on another target line can supersede

- **WHEN** the current and successor Changes have the same Store and project ids but different target-line ids
- **THEN** the supersession relation is valid

#### Scenario: Cross-project successor is rejected

- **WHEN** a successor Change resolves to another project in the same Store
- **THEN** semantic outcome validation rejects the supersession

#### Scenario: Opaque successor without scope evidence fails closed

- **WHEN** a successor id is well formed but its Store and project scope cannot be supplied or verified
- **THEN** the finalization contract does not approve the supersession relation

### Requirement: Landed proof shape distinguishes code and planning-only Changes

A code-backed `landed` record SHALL carry a code repository identity, execution `WorktreeInstanceId`, target ref, commit OID, and an affirmative reachability fact. A Change whose portable metadata explicitly declares `implementation: none` SHALL represent landed state with `codeMerge: null`. No other outcome SHALL require or carry a code-merge object in Archive v2.

#### Scenario: Reachable code-backed landed record is valid

- **WHEN** a code-backed landed record carries complete code-merge facts with `reachable: true`
- **THEN** the record satisfies the Archive v2 proof shape

#### Scenario: Unreachable landed code is rejected

- **WHEN** a code-backed landed record omits its commit proof or reports `reachable: false`
- **THEN** Archive v2 validation rejects it

#### Scenario: Planning-only landed record carries no fake commit

- **WHEN** a landed Change declares `implementation: none` and has `codeMerge: null`
- **THEN** Archive v2 validation accepts the proof shape
- **AND** no placeholder code commit is required

#### Scenario: Non-landed code merge is rejected

- **WHEN** a superseded, cancelled, or abandoned Archive v2 record carries a code-merge object
- **THEN** strict validation rejects the contradictory accounting

### Requirement: Archive v2 makes landed-only spec synchronization structural

An Archive v2 `landed` record SHALL report `specSync.applied: true` and a strictly validated list of create, update, or delete actions. Every non-landed record SHALL report `specSync.applied: false` with an empty action list. Each action SHALL name a canonical capability id and carry before/after SHA-256 digests consistent with its operation.

#### Scenario: Landed record may apply no-op spec plan

- **WHEN** a landed Change has no delta-spec actions
- **THEN** its Archive v2 record may contain `specSync.applied: true` with an empty action list

#### Scenario: Passive-history spec action is rejected

- **WHEN** a superseded, cancelled, or abandoned record reports applied spec sync or any spec action
- **THEN** Archive v2 validation rejects the record as inconsistent

#### Scenario: Spec action digest shape matches operation

- **WHEN** a create action has no before digest and a valid after digest, an update has both, or a delete has a before digest and no after digest
- **THEN** the action shape is valid

#### Scenario: Contradictory action digest is rejected

- **WHEN** a create, update, or delete action has missing or extra before/after digest fields for its operation
- **THEN** strict action validation rejects it

### Requirement: Archive v2 records complete stable scope and workspace accounting

Every Archive v2 record SHALL carry schema version 2, implementation intent, permanent Store id, project id, stable target-line id, Change alias, verified `ChangeInstanceId`, verified `WorkspacePairId`, outcome data, planning worktree/ref/OID facts, code-merge facts or null, spec-sync accounting, portable evidence hashes, missing-evidence names, and an ISO-8601 archive timestamp. Branch and ref values SHALL remain locators; stable ownership SHALL come from the identity fields.

#### Scenario: Complete record round-trips

- **WHEN** a valid Archive v2 value is serialized and parsed
- **THEN** every stable identity, outcome, planning, code, spec-sync, evidence, and timestamp field is retained
- **AND** the parsed value equals the validated input contract

#### Scenario: Missing stable scope field is rejected

- **WHEN** an Archive v2 value omits Store, project, target-line, Change instance, or workspace-pair identity
- **THEN** strict validation rejects the record

#### Scenario: Branch name cannot replace target-line identity

- **WHEN** a record carries planning refs but omits or corrupts its stable target-line id
- **THEN** validation rejects it rather than deriving a line from a ref name

### Requirement: Archive v2 evidence is portable, unique, and digest-verified in shape

Archive v2 evidence entries SHALL use relative non-escaping portable paths and lowercase SHA-256 digests. Validation SHALL reject absolute paths, parent traversal, duplicate normalized paths, malformed digests, and unknown evidence fields. The `missing` list SHALL contain unique non-empty evidence names.

#### Scenario: Nested portable evidence is accepted

- **WHEN** evidence uses a normalized relative nested path and a lowercase SHA-256 digest
- **THEN** its Archive v2 shape is accepted on Windows and POSIX

#### Scenario: Absolute or escaping evidence path is rejected

- **WHEN** an evidence path is absolute, contains parent traversal, or normalizes outside the evidence root
- **THEN** Archive v2 validation rejects it

#### Scenario: Case-alias duplicate is rejected for portable accounting

- **WHEN** two evidence entries normalize to the same portable case-insensitive path identity
- **THEN** validation rejects the duplicate accounting

### Requirement: Archive v2 serialization is deterministic and self-verifying

Archive v2 serialization SHALL emit UTF-8 JSON without BOM using stable field order, two-space indentation, and one trailing newline. Serialization SHALL validate before writing its string, and parsing the emitted text SHALL reproduce the same validated record. Unknown fields and invalid cross-field combinations SHALL be rejected rather than dropped.

#### Scenario: Equivalent records serialize identically

- **WHEN** equivalent valid Archive v2 values are constructed with different JavaScript property insertion order
- **THEN** they serialize to identical bytes

#### Scenario: Unknown field fails strict parsing

- **WHEN** an Archive v2 object contains an unrecognized top-level or nested field
- **THEN** parsing rejects it instead of silently omitting it

#### Scenario: Serializer refuses inconsistent value

- **WHEN** a caller asks to serialize a non-landed record with applied spec actions or another invalid cross-field combination
- **THEN** serialization fails and returns no ledger text
