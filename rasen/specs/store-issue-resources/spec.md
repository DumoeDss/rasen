# store-issue-resources Specification

## Purpose
Add the Store Issue as a first-class, repo-blind planning resource for work that spans projects: a minimal record carrying intent and state, immutable Execution Plan revisions that verify their referenced Change instances against committed Store evidence, and a single serializer-and-lock so one truth owns every mutation.

## Requirements
### Requirement: A Store Issue is a repo-blind statement of intent

A Store Issue SHALL carry its stable identifier, its title, its state, and its own narrative, and
SHALL carry nothing about any repository, branch, ref, checkout, path, or machine. It SHALL live at
the Store level rather than inside any project partition, so an Issue that spans several projects
belongs to none of them. An Issue SHALL be readable and meaningful without access to any code
repository.

#### Scenario: An Issue names no repository

- **WHEN** an Issue is created and read back
- **THEN** its record contains no repository, branch, ref, path, or machine value
- **AND** it is complete without consulting any code repository

#### Scenario: An Issue is not project content

- **WHEN** an Issue is created in a Store that has several member projects
- **THEN** the Issue exists at the Store level
- **AND** it is not placed inside, or attributed to, any single project partition

### Requirement: Execution Plan revisions are immutable and ordinally addressed

Publishing a plan SHALL create the next revision rather than modify any existing one. Every revision
SHALL be addressed by a canonical zero-padded decimal ordinal of fixed width, so the latest revision
is identifiable without opening every file. A revision that already exists SHALL never be rewritten,
and the sequence SHALL contain no gap and no duplicate.

#### Scenario: Publishing adds a revision rather than editing one

- **WHEN** a second plan is published for an Issue that already has one revision
- **THEN** a new revision exists at the next ordinal
- **AND** the first revision's bytes are unchanged

#### Scenario: The latest revision is identifiable from its address alone

- **WHEN** an Issue has several revisions
- **THEN** the latest is determined from the ordinals
- **AND** no revision file has to be opened to determine it

#### Scenario: A revision is never rewritten

- **WHEN** publication is attempted at an ordinal that already exists
- **THEN** it is refused
- **AND** the existing revision's bytes are unchanged

### Requirement: A revision carries and proves its own content digest

Every Execution Plan revision SHALL carry a digest over its own canonical content. Reading a revision
SHALL verify that digest and SHALL refuse a revision whose stored digest does not match its content,
rather than return content that has been altered since it was published. Two revisions with equivalent
content constructed in different field order SHALL produce the same digest.

#### Scenario: Altered content is refused on read

- **WHEN** a stored revision's content is altered without updating its digest
- **THEN** reading it is refused, naming the mismatch
- **AND** no altered plan is returned to the caller

#### Scenario: Field order does not change the digest

- **WHEN** two equivalent revisions are constructed with different property insertion order
- **THEN** they produce the same digest

#### Scenario: The digest is a stable published value

- **WHEN** a revision with fixed, known content is published
- **THEN** its digest equals the value published for that exact content
- **AND** a change to how the digest is computed is visible rather than absorbed

### Requirement: Plan references are verified against committed Store evidence

A plan node that names a Change SHALL be accepted only when that Change is present and committed in
the Store. A node naming a Change that is absent, uncommitted, or outside the Store SHALL be refused
with the reason named, and the plan SHALL NOT be published. Verification SHALL consult the Store's own
committed evidence rather than the current working directory, the current checkout, or a caller's
claim.

#### Scenario: A plan naming an absent Change is refused

- **WHEN** a plan node names a Change that does not exist in the Store
- **THEN** publication is refused, naming the missing Change
- **AND** no revision is created

#### Scenario: A plan naming an uncommitted Change is refused

- **WHEN** a plan node names a Change that exists on disk but is not committed in the Store
- **THEN** publication is refused, naming that Change and the reason
- **AND** no revision is created

#### Scenario: Verification does not consult the working directory

- **WHEN** publication runs from a checkout that contains a Change the Store does not
- **THEN** that Change is not accepted as evidence
- **AND** the refusal names the Store as the authority

### Requirement: A plan graph is normalized, checked, and refused rather than repaired

Plan nodes SHALL be normalized to one canonical form, so two spellings of one plan are one plan.
Duplicate nodes SHALL be refused rather than silently merged, a dependency naming a node not in the
plan SHALL be refused, and a dependency cycle SHALL be refused. No plan SHALL be stored with a defect
the checker can name.

#### Scenario: Two spellings of one plan are one plan

- **WHEN** two plans differ only in node ordering or in equivalent spellings of the same values
- **THEN** they normalize to the same canonical plan

#### Scenario: An explicit required node and an absent lifecycle are one plan

- **WHEN** two plans differ only in one spelling a node's lifecycle as `required` and the other omitting it
- **THEN** they normalize to the same canonical plan
- **AND** the stored canonical form omits a `required` lifecycle, so its digest matches the form published before the field existed

#### Scenario: A duplicate node is refused

- **WHEN** a plan carries two nodes with the same identifier
- **THEN** publication is refused, naming the duplicate
- **AND** the two are not merged into one

#### Scenario: A cycle or dangling dependency is refused

- **WHEN** a plan carries a dependency cycle, or a dependency on a node the plan does not contain
- **THEN** publication is refused, naming the offending nodes
- **AND** no revision is created

### Requirement: One lock serializes every Issue mutation

All Issue mutation SHALL serialize through one Issue lock, so two concurrent publications cannot
interleave into a revision sequence with a gap or a duplicate. The lock SHALL be released even when
the operation fails. A lock whose recorded owner is provably gone SHALL NOT permanently block a later
operation.

#### Scenario: Concurrent publications produce a clean sequence

- **WHEN** two publications for one Issue are attempted at the same time
- **THEN** the resulting revisions form a sequence with no gap and no duplicate

#### Scenario: A failed mutation still releases the lock

- **WHEN** a mutation fails partway
- **THEN** the Issue lock is released
- **AND** a subsequent mutation can proceed

### Requirement: An Issue's records are written deterministically and read strictly

An Issue record and an Execution Plan revision SHALL each be written in a stable field order with
stable formatting, so equivalent values produce identical bytes. Reading SHALL reject an unrecognized
field rather than silently drop it, and SHALL reject a record whose required facts are missing rather
than fill them with defaults.

#### Scenario: Equivalent records are written identically

- **WHEN** equivalent Issue records are constructed with different property insertion order
- **THEN** they are written as identical bytes

#### Scenario: An unrecognized field is reported

- **WHEN** a stored Issue record carries a field the product does not define
- **THEN** reading reports the unrecognized field
- **AND** the value is not silently discarded

#### Scenario: A record missing required facts is refused

- **WHEN** a stored record is missing its identifier, title, or state
- **THEN** reading refuses, naming what is missing
- **AND** no default is substituted

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

### Requirement: Plan nodes carry a closed lifecycle vocabulary

A plan's Change nodes SHALL carry a lifecycle drawn from exactly four values — `required`,
`optional`, `cancelled`, `superseded` — where an absent lifecycle SHALL read as `required`, so
every revision published before this vocabulary existed reads back with all its nodes required
and its digest unchanged. A node marked `cancelled` or `superseded` SHALL carry a recorded
reason, and that reason SHALL satisfy the same portable-durable-text contract Issue records
enforce, refused at the schema rather than trimmed. A reason SHALL be recorded only for
`cancelled` and `superseded` nodes — a reason authored on wanted work (`required` or
`optional`) is refused rather than stored, because a reason explains only work the plan no
longer wants. A lifecycle value outside the four SHALL be
refused naming the defined values, and an intent node SHALL carry no lifecycle at all. A
lifecycle change SHALL be expressed only as a new revision: the next revision says what the
current one no longer does, and the earlier revision's bytes never change.

#### Scenario: An absent lifecycle reads as required

- **WHEN** a revision published before this vocabulary existed is read back
- **THEN** every Change node in it reads as `required`
- **AND** the revision's stored digest still verifies against its bytes

#### Scenario: A cancelled node without a reason is refused

- **WHEN** a plan node is authored with lifecycle `cancelled` and no reason
- **THEN** publication is refused, naming the node and that a cancelled node requires a recorded reason
- **AND** nothing is written

#### Scenario: A superseded node without a reason is refused

- **WHEN** a plan node is authored with lifecycle `superseded` and no reason
- **THEN** publication is refused, naming the node and that a superseded node requires a recorded reason
- **AND** nothing is written

#### Scenario: A reason that is not portable durable text is refused

- **WHEN** a cancelled or superseded node's reason carries a machine filesystem path or embedded credential
- **THEN** publication is refused at the schema rather than trimmed
- **AND** nothing is written

#### Scenario: An undefined lifecycle value is refused

- **WHEN** a plan node carries a lifecycle outside the four defined values
- **THEN** publication is refused, naming the value and the four that are defined
- **AND** the Issue's state is unchanged

#### Scenario: A lifecycle change is a new revision, never a rewrite

- **WHEN** a plan is re-published with one node's lifecycle changed from `required` to `cancelled`
- **THEN** the new revision exists at the next ordinal and names that node `cancelled` with its reason
- **AND** the earlier revision's bytes, including that node's previous lifecycle, are unchanged
