# change-finalization-record-v2 Specification

## Purpose
TBD - created by archiving change store-planning-contract-v2. Update Purpose after archive.
## Requirements
### Requirement: Finalization names exactly one explicit outcome

A v2 finalization SHALL name exactly one outcome: landed, superseded, cancelled, or abandoned. A
landed finalization SHALL carry neither a reason nor a successor. Every outcome other than landed
SHALL carry a non-empty reason, and only supersession SHALL name a successor Change. Missing,
unknown, or contradictory outcome fields SHALL be rejected before any mutation can act on them.

#### Scenario: Landed outcome needs no reason

- **WHEN** a finalization declares landed with no reason and no successor
- **THEN** its outcome is valid

#### Scenario: Supersession requires a successor

- **WHEN** a finalization declares supersession without a non-empty reason or without a verified successor Change instance identity
- **THEN** validation rejects it

#### Scenario: Cancelled and abandoned reject successors

- **WHEN** a cancelled or abandoned finalization names a superseding Change
- **THEN** validation rejects the contradictory field

#### Scenario: Unknown outcome is rejected

- **WHEN** a finalization names any outcome outside the four defined values
- **THEN** validation rejects it

### Requirement: Supersession stays inside one Store project

Given the resolved scope of the current and successor Changes, finalization SHALL require a
superseding Change to belong to the same permanent Store and the same project. The successor MAY sit
on a different stable target line. Missing or conflicting successor scope evidence SHALL fail
validation rather than let ownership be inferred from a Change alias, a directory, or a branch.

#### Scenario: Same project on another target line can supersede

- **WHEN** the current and successor Changes share a Store and project but sit on different target lines
- **THEN** the supersession is valid

#### Scenario: Cross-project successor is rejected

- **WHEN** a successor Change resolves to another project in the same Store
- **THEN** validation rejects the supersession

#### Scenario: Opaque successor without scope evidence fails closed

- **WHEN** a successor identity is well formed but its Store and project scope cannot be supplied or verified
- **THEN** the supersession is not approved

### Requirement: Landed proof distinguishes code-backed from planning-only Changes

A landed record for a code-backed Change SHALL carry its code repository identity, execution worktree
identity, target ref, commit identity, and an affirmative reachability fact. A landed record for a
Change that explicitly declares no code implementation SHALL carry no code-merge evidence at all,
rather than a placeholder commit. No outcome other than landed SHALL carry code-merge evidence.

#### Scenario: Reachable code-backed landed record is valid

- **WHEN** a code-backed landed record carries complete code-merge facts and reports the commit reachable
- **THEN** the record satisfies the landed proof shape

#### Scenario: Unreachable or unproven landed code is rejected

- **WHEN** a code-backed landed record omits its commit proof or reports the commit not reachable
- **THEN** validation rejects it

#### Scenario: Planning-only landed record carries no fabricated commit

- **WHEN** a landed Change declares no code implementation and carries no code-merge evidence
- **THEN** validation accepts the proof shape
- **AND** no placeholder code commit is required

#### Scenario: Non-landed code merge is rejected

- **WHEN** a superseded, cancelled, or abandoned record carries code-merge evidence
- **THEN** validation rejects the contradictory accounting

### Requirement: Landed-only spec synchronization is structural

A landed record SHALL report spec synchronization as applied, together with a validated list of
create, update, or delete actions that MAY be empty. Every non-landed record SHALL report spec
synchronization as not applied with no actions, so passive history can never claim to have changed
the canonical specs. Each action SHALL name the capability by its canonical spec address and carry
before and after digests consistent with the operation it names.

#### Scenario: Landed record may apply an empty spec plan

- **WHEN** a landed Change has no delta-spec actions
- **THEN** its record may report spec synchronization applied with an empty action list

#### Scenario: Passive-history spec action is rejected

- **WHEN** a superseded, cancelled, or abandoned record reports applied spec synchronization or any spec action
- **THEN** validation rejects the record as inconsistent

#### Scenario: Nested capability address is accepted

- **WHEN** a spec action names a capability whose canonical address is one or more lowercase kebab segments separated by a forward slash
- **THEN** the action is accepted with that address preserved

#### Scenario: Action digests must match the operation

- **WHEN** a create action carries only an after digest, an update carries both, or a delete carries only a before digest
- **THEN** the action shape is valid

#### Scenario: Contradictory action digest is rejected

- **WHEN** a create, update, or delete action has a missing or extra before/after digest for its operation
- **THEN** validation rejects it

### Requirement: An Archive v2 record carries complete stable accounting

Every Archive v2 record SHALL carry its schema version, implementation intent, permanent Store id,
project id, stable target-line id, Change alias, verified Change instance identity, verified
workspace-pair identity, outcome, planning worktree/ref/commit facts, code-merge evidence or its
explicit absence, spec-synchronization accounting, evidence digests, missing-evidence names, and the
time it was archived. Branch and ref values SHALL remain locators only; stable ownership SHALL come
from the identity fields.

#### Scenario: Complete record round-trips

- **WHEN** a valid Archive v2 record is written and read back
- **THEN** every identity, outcome, planning, code, spec-synchronization, evidence, and timestamp field is retained unchanged

#### Scenario: Missing stable scope field is rejected

- **WHEN** a record omits its Store, project, target-line, Change instance, or workspace-pair identity
- **THEN** validation rejects the record

#### Scenario: Branch name cannot replace target-line identity

- **WHEN** a record carries planning refs but omits or corrupts its stable target-line id
- **THEN** validation rejects it rather than deriving a line from a ref name

### Requirement: Archive v2 evidence is portable, unique, and digest-verified

Archive v2 evidence entries SHALL use relative, non-escaping, portable paths together with lowercase
digests. Validation SHALL reject absolute paths, parent traversal, duplicates that normalize to one
portable identity, malformed digests, and unrecognized evidence fields. Missing-evidence names SHALL
be unique and non-empty.

#### Scenario: Nested portable evidence is accepted

- **WHEN** evidence uses a normalized relative nested path and a lowercase digest
- **THEN** it is accepted on Windows and POSIX alike

#### Scenario: Absolute or escaping evidence path is rejected

- **WHEN** an evidence path is absolute, contains parent traversal, or normalizes outside the evidence root
- **THEN** validation rejects it

#### Scenario: Case-alias duplicate is rejected

- **WHEN** two evidence entries normalize to the same portable case-insensitive identity
- **THEN** validation rejects the duplicated accounting

### Requirement: Archive v2 records are written deterministically and verified on write

Archive v2 records SHALL be written as UTF-8 text without a byte-order mark, with stable field order,
two-space indentation, and one trailing newline. Writing SHALL validate before producing any text,
and reading the produced text SHALL reproduce the same record. Unrecognized fields and invalid
cross-field combinations SHALL be rejected rather than dropped.

#### Scenario: Equivalent records are written identically

- **WHEN** equivalent valid records are constructed with different property insertion order
- **THEN** they are written as identical bytes

#### Scenario: Unrecognized field fails reading

- **WHEN** an Archive v2 record carries an unrecognized top-level or nested field
- **THEN** reading rejects it instead of silently omitting it

#### Scenario: Writer refuses an inconsistent record

- **WHEN** a caller asks to write a non-landed record that reports applied spec actions, or any other invalid combination
- **THEN** writing fails and produces no record text
