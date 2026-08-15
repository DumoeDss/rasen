# store-planning-identity-v2 Specification

## Purpose
Define the typed v2 planning identities - Store, member project, target line, Change, and planning worktree - as stable, domain-separated addresses whose digests do not change when directories move or metadata inserts in a different order, so every later Store-v2 capability refers to planning objects through one identity contract instead of inventing its own.
## Requirements
### Requirement: A planning scope has one stable, portable identity

Rasen SHALL derive a planning scope's identity deterministically from the permanent Store identity,
the canonical project id, and the stable target-line id. That identity SHALL NOT depend on Store or
project locations on disk, Git branch names, refs, the current working directory, or platform path
syntax, so the same semantic scope is the same scope on every machine.

#### Scenario: Same semantic scope is portable

- **WHEN** the same Store, project, and target-line identities are used on Windows and POSIX machines whose checkouts live at different locations
- **THEN** both machines derive the same planning scope identity

#### Scenario: Another project or target line is another scope

- **WHEN** either the project id or the target-line id changes while the other inputs stay fixed
- **THEN** the derived planning scope identity changes

#### Scenario: Branch rename does not change scope identity

- **WHEN** a target line's Git ref is renamed while its stable target-line id is unchanged
- **THEN** its planning scope identity is unchanged

### Requirement: A Change instance identifies one portable attempt

Each v2 Change instance SHALL carry an instance seed minted once from a cryptographically strong
source, and an instance identity derived from that seed and its verified planning scope. The human
Change alias, the Change's directory, its branch name, and any worktree SHALL NOT participate in that
identity. Reusing a Change alias for a later attempt SHALL mint a new seed and therefore be a
different instance.

#### Scenario: Moving a Change does not rewrite its identity

- **WHEN** a Change with unchanged v2 scope metadata and instance seed is checked out at another location or on a renamed branch
- **THEN** verification derives the same Change instance identity

#### Scenario: Same alias can represent a new attempt

- **WHEN** a later attempt uses the same Change alias and planning scope but a newly minted seed
- **THEN** it has a different Change instance identity

#### Scenario: Same seed on another target line does not collide

- **WHEN** one seed is evaluated under two different stable target-line ids
- **THEN** the two Change instance identities differ, because their planning scopes differ

### Requirement: Identity kinds are typed, canonical, and never interchangeable

Planning-scope, Change-instance, worktree-instance, and workspace-pair identities SHALL each carry
their own fixed prefix followed by a lowercase digest, and each SHALL be derived under its own
versioned domain. Validation SHALL reject the wrong prefix, the wrong digest length, non-hexadecimal
characters, uppercase aliases, and a value derived for another identity kind, so one kind can never
be accepted where another is required.

#### Scenario: Identity kind cannot be substituted

- **WHEN** a valid worktree instance identity is supplied where a Change instance identity is required
- **THEN** validation rejects it, despite both carrying digests of the same shape

#### Scenario: Derivation is repeatable regardless of field order

- **WHEN** equivalent validated inputs are constructed with different property insertion order
- **THEN** the derived identity is the same

#### Scenario: Malformed digest is rejected

- **WHEN** an identity has a known prefix but an uppercase, truncated, extended, or non-hexadecimal digest
- **THEN** its parser rejects the value

### Requirement: A worktree instance identifies one local physical worktree

Rasen SHALL derive a worktree instance identity from the canonical repository identity and canonical
physical worktree identity supplied by the local Git adapter. A planning worktree and an execution
worktree SHALL each have their own identity. The contract SHALL be pure and SHALL NOT infer either
input from a Change alias or a branch-naming convention.

#### Scenario: Different worktrees in one repository differ

- **WHEN** two worktrees share a repository identity but have different canonical physical worktree identities
- **THEN** they have different worktree instance identities

#### Scenario: Same canonical local identity is stable

- **WHEN** equivalent local location spellings have already been canonicalized by the adapter to the same repository and worktree identity inputs
- **THEN** the same worktree instance identity is derived

#### Scenario: Non-canonical local identity input is refused

- **WHEN** a repository or worktree identity input is empty or carries forbidden control data
- **THEN** derivation fails without guessing a physical location

### Requirement: A workspace pair binds ordered planning and execution worktrees to a Change

Rasen SHALL derive a workspace-pair identity from a verified Change instance identity, the planning
worktree identity, and the execution worktree identity in explicit role order. Changing the Change
instance or either worktree SHALL change the pair identity, and supplying the two worktrees with
their roles swapped SHALL NOT describe the same pair.

#### Scenario: Pair identity is deterministic

- **WHEN** the same verified Change, planning worktree, and execution worktree identities are supplied repeatedly
- **THEN** the same workspace-pair identity is derived

#### Scenario: Worktree replacement changes pair identity

- **WHEN** either physical worktree is replaced while the semantic Change is unchanged
- **THEN** the workspace pair has a different identity

#### Scenario: Planning and execution roles are ordered

- **WHEN** the same two worktree identities are supplied with their planning and execution roles swapped
- **THEN** the derived workspace-pair identity differs

### Requirement: V2 Change metadata proves its own identity

When Change metadata carries a v2 identity block, Rasen SHALL validate the Store, project,
target-line, seed, and instance-identity formats, re-derive the planning scope and Change instance
identity, and reject any mismatch, so a hand-edited scope cannot claim another Change's identity.
Change metadata without an identity block SHALL remain valid for legacy and standalone Changes and
SHALL round-trip without gaining v2 fields. A Change SHALL be able to declare explicitly that it has
no code implementation, and metadata that declares nothing SHALL keep its current code-backed
meaning.

#### Scenario: Valid v2 metadata verifies

- **WHEN** a metadata identity block carries canonical scope fields, a valid seed, and the corresponding derived instance identity
- **THEN** it parses and verifies as one portable Change instance

#### Scenario: Tampered scope or seed fails closed

- **WHEN** v2 metadata changes its Store, project, target line, or seed without updating the derived instance identity
- **THEN** validation rejects the inconsistency
- **AND** no usable Change identity is returned

#### Scenario: Legacy metadata remains readable

- **WHEN** existing Change metadata carries only its schema and creation fields
- **THEN** it remains valid
- **AND** a read/write round trip does not add v2 identity fields

#### Scenario: Planning-only intent is explicit

- **WHEN** metadata declares that the Change has no code implementation
- **THEN** finalization can tell it apart from a code-backed Change without fabricating a code commit

### Requirement: Change metadata rejects fields the product does not define

Reading or writing Change metadata SHALL reject a field the product does not define, so a misspelled
or misplaced key fails loudly instead of being silently ignored and then dropped. The quality
accounting the product's own archive records on an archived Change SHALL remain a recognized field,
so archived Changes stay readable.

#### Scenario: Misspelled field is reported rather than dropped

- **WHEN** a Change's metadata carries a misspelled field name
- **THEN** reading that metadata reports the unrecognized field
- **AND** the value is not silently discarded on the next write

#### Scenario: Archived quality accounting stays readable

- **WHEN** an archived Change's metadata carries the quality accounting the archive recorded on it
- **THEN** that metadata still reads successfully
- **AND** the quality accounting is preserved unchanged
