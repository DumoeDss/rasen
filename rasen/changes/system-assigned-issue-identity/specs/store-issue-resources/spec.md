## MODIFIED Requirements

### Requirement: A Store Issue is a repo-blind statement of intent

A Store Issue SHALL carry its stable system-assigned identity, its title, its state, and its own
narrative, and SHALL carry nothing about any repository, branch, ref, checkout, path, or machine.
Its identity SHALL distinguish the immutable machine UID and human key from optional
non-authoritative aliases. It SHALL live at the Store level rather than inside any project
partition, so an Issue that spans several projects belongs to none of them. An Issue SHALL be
readable and meaningful without access to any code repository.

#### Scenario: An Issue names no repository

- **WHEN** an Issue is created and read back
- **THEN** its record contains no repository, branch, ref, path, or machine value
- **AND** it is complete without consulting any code repository

#### Scenario: An Issue is not project content

- **WHEN** an Issue is created in a Store that has several member projects
- **THEN** the Issue exists at the Store level
- **AND** it is not placed inside, or attributed to, any single project partition

#### Scenario: Identity roles remain distinct

- **WHEN** an Issue record carries a UID, human key, and optional aliases
- **THEN** the UID is its authoritative identity and the key is its stable human reference
- **AND** no alias is treated as a repository fact, relationship identity, or path authority

### Requirement: An Issue's records are written deterministically and read strictly

An Issue record and an Execution Plan revision SHALL each be written in a stable field order with
stable formatting, so equivalent values produce identical bytes. Reading SHALL reject an unrecognized
field rather than silently drop it, and SHALL reject a record whose version-required identity,
title, or state facts are missing rather than fill them with defaults. A version-2 Issue record
SHALL reject a key that is not the defined projection of its UID. Authoring SHALL meet the same
strictness: a plan publication input node carrying a field the node schemas do not define SHALL be
refused naming the field and the node, on the reporting path exactly as on the throwing path, rather
than published with the field silently dropped.

#### Scenario: Equivalent records are written identically

- **WHEN** equivalent Issue records are constructed with different property insertion order
- **THEN** they are written as identical bytes

#### Scenario: An unrecognized field is reported

- **WHEN** a stored Issue record carries a field the product does not define
- **THEN** reading reports the unrecognized field
- **AND** the value is not silently discarded

#### Scenario: A record missing required facts is refused

- **WHEN** a stored record is missing an identity fact, title, or state required by its version
- **THEN** reading refuses, naming what is missing
- **AND** no default is substituted

#### Scenario: A UID and key mismatch is refused

- **WHEN** a version-2 record carries a human key that does not derive from its recorded UID
- **THEN** reading reports the identity mismatch
- **AND** neither value is silently replaced

#### Scenario: An authored node with an unrecognized field is refused by name

- **WHEN** a plan publication input node carries a field the node schemas do not define, such as a misspelled suggestion key
- **THEN** publication is refused naming the node and the unrecognized field
- **AND** the field is not silently dropped from the published revision

### Requirement: An Issue changes only through its five declared mutations

An Issue SHALL be mutable only through five operations: creating it, setting its state,
publishing an Execution Plan for it, publishing acceptance conditions for it, and recording an
acceptance of it. Every other interaction with an Issue SHALL be a read. Creation SHALL allocate a
new identity and SHALL refuse rather than overwrite if an allocated identity collides after bounded
retry. The Issue record SHALL be the creation commit point. A failure after exact record publication
SHALL return that committed identity with a path-free warning; an outcome that cannot be verified
SHALL report the assigned identity as publication-indeterminate and not retry-safe. Setting a state
the product does not define SHALL be refused rather than stored.

#### Scenario: A duplicate Issue is refused

- **WHEN** an allocation attempt names an Issue UID or storage location that already exists
- **THEN** the system retries allocation or refuses after its bounded attempts
- **AND** the existing Issue is unchanged

#### Scenario: An undefined state is refused

- **WHEN** a state outside the defined vocabulary is set on an Issue
- **THEN** the request is refused, naming the states that are defined
- **AND** the Issue's state is unchanged

#### Scenario: Creation outcome cannot be verified

- **WHEN** the atomic writer fails and subsequent observation cannot prove either exact publication or a zero-write outcome
- **THEN** creation reports publication-indeterminate with its assigned UID/key and `retrySafe: false`
- **AND** raw filesystem causes and storage paths remain internal
