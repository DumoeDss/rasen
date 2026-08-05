## ADDED Requirements

### Requirement: PlanningScopeId is stable and scope-complete

Rasen SHALL derive `PlanningScopeId` deterministically from the normalized permanent Store identity, canonical project id, and stable target-line id using a versioned, domain-separated canonical serialization. The derivation SHALL NOT depend on Store or project paths, Git branch names, refs, current working directory, or platform path syntax.

#### Scenario: Same semantic scope is portable

- **WHEN** the same Store, project, and target-line identities are derived on Windows and POSIX machines with different checkout paths
- **THEN** both machines derive the same `PlanningScopeId`

#### Scenario: Another project or target line is another scope

- **WHEN** either the project id or target-line id changes while the other inputs remain fixed
- **THEN** the derived `PlanningScopeId` changes

#### Scenario: Branch rename does not change scope identity

- **WHEN** a target line's Git branch/ref locator is renamed without changing its stable target-line id
- **THEN** its `PlanningScopeId` remains unchanged

### Requirement: ChangeInstanceId identifies one portable attempt

Each v2 Change instance SHALL carry a cryptographically strong instance seed minted once and a `ChangeInstanceId` derived from that seed and its verified `PlanningScopeId`. The human Change alias, physical Change directory, branch name, and worktree identity SHALL NOT participate in the derivation. Reusing a Change alias for a later attempt SHALL use a new seed and produce a different instance id.

#### Scenario: Moving a Change does not rewrite identity

- **WHEN** a Change with unchanged v2 scope metadata and instance seed is checked out at another path or on a renamed branch
- **THEN** verification derives the same `ChangeInstanceId`

#### Scenario: Same alias can represent a new attempt

- **WHEN** a later Change attempt uses the same alias and planning scope but a newly minted seed
- **THEN** it has a different `ChangeInstanceId`

#### Scenario: Same seed on another target line does not collide

- **WHEN** the same seed is evaluated under two different stable target-line ids
- **THEN** the two Change instance ids differ because their planning scopes differ

### Requirement: Identity formats are typed, canonical, and domain separated

Planning scope, Change instance, worktree instance, and workspace-pair ids SHALL each use a distinct fixed prefix followed by a lowercase SHA-256 digest. Parsers SHALL reject the wrong prefix, wrong digest length, non-hex characters, uppercase aliases, and values derived for another identity domain. Hash preimages SHALL use canonical UTF-8 JSON with an explicit versioned domain.

#### Scenario: Identity kind cannot be substituted

- **WHEN** a valid worktree instance id is supplied where a Change instance id is required
- **THEN** validation rejects it despite both carrying SHA-256 digests

#### Scenario: Canonical derivation is repeatable

- **WHEN** equivalent validated input objects are constructed with different JavaScript property insertion order
- **THEN** canonical serialization produces the same derived id

#### Scenario: Malformed digest is rejected

- **WHEN** an id has a known prefix but an uppercase, truncated, extended, or non-hex digest
- **THEN** its typed parser rejects the value

### Requirement: WorktreeInstanceId represents one local physical worktree

Rasen SHALL derive a `WorktreeInstanceId` from canonical repository identity and canonical physical worktree identity supplied by the local Git adapter. Planning and execution worktrees SHALL each have their own id. The derivation contract SHALL be pure and SHALL NOT infer either identity from an active Change alias or branch naming convention.

#### Scenario: Different worktrees in one repository differ

- **WHEN** two worktrees share a repository identity but have different canonical physical worktree identities
- **THEN** they derive different `WorktreeInstanceId` values

#### Scenario: Same canonical local identity is stable

- **WHEN** equivalent local path spellings have already been canonicalized by the adapter to the same repository and worktree identity inputs
- **THEN** the foundation derives the same worktree instance id

#### Scenario: Non-canonical local identity input is refused

- **WHEN** a repository or worktree identity input is empty or contains forbidden control data
- **THEN** worktree identity derivation fails without guessing a physical location

### Requirement: WorkspacePairId binds ordered planning and execution worktrees to a Change

Rasen SHALL derive `WorkspacePairId` from a verified `ChangeInstanceId`, the planning `WorktreeInstanceId`, and the execution `WorktreeInstanceId` in explicit role order. Changing the Change instance or either worktree SHALL change the pair id, and swapping planning and execution inputs SHALL NOT describe the same pair.

#### Scenario: Pair is deterministic

- **WHEN** the same verified Change, planning worktree, and execution worktree ids are supplied repeatedly
- **THEN** the same `WorkspacePairId` is derived

#### Scenario: Worktree replacement changes pair identity

- **WHEN** either physical worktree is replaced while the semantic Change remains the same
- **THEN** the new workspace pair has a different id

#### Scenario: Planning and execution roles are ordered

- **WHEN** the same two worktree ids are supplied with their planning and execution roles swapped
- **THEN** the derived `WorkspacePairId` differs

### Requirement: V2 Change metadata verifies its derived identity

When Change metadata contains an identity block with `version: 2`, Rasen SHALL validate the Store, project, target-line, seed, and instance-id formats, recompute the planning scope and Change instance id, and reject any mismatch. Change metadata without a v2 identity block SHALL remain valid for legacy and standalone compatibility and SHALL serialize without injected v2 fields. `implementation: none` SHALL be the explicit portable declaration that a Change has no code implementation; absent implementation intent retains code-backed compatibility.

#### Scenario: Valid v2 metadata verifies

- **WHEN** a metadata identity block carries canonical scope fields, a valid seed, and the corresponding derived instance id
- **THEN** it parses and verifies as one portable Change instance

#### Scenario: Tampered scope or seed fails closed

- **WHEN** a v2 metadata file changes its Store, project, target line, or seed without updating the derived instance id
- **THEN** metadata validation rejects the inconsistency
- **AND** no mutation-safe Change identity is returned

#### Scenario: Legacy metadata remains readable

- **WHEN** existing Change metadata contains schema and created fields but no identity or implementation fields
- **THEN** it remains valid
- **AND** a read/serialize round trip does not add v2 identity fields

#### Scenario: Planning-only intent is explicit

- **WHEN** metadata declares `implementation: none`
- **THEN** finalization contracts can distinguish it from a code-backed Change without fabricating a code commit
