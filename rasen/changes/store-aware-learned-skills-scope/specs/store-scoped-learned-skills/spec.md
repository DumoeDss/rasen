## ADDED Requirements

### Requirement: Store records have typed canonical identity and storage

A store-scoped learned skill SHALL have canonical identity
`(store, storeId, skillId)` and SHALL be stored under the selected registered
store's Rasen root. Store identity SHALL resolve through the typed store
registry and valid store metadata; a project with the same bare ID, a candidate
path, a directory basename, or the current working directory SHALL NOT replace
that authority. Successful store mutations SHALL report the exact typed identity
and store root without committing or pushing the store repository.

#### Scenario: Store record is created in the selected store

- **WHEN** an approved valid plan targets `store:team` and skill `typescript-cli-routing`
- **THEN** the canonical record is created under the `team` store's Rasen learned-skills directory
- **AND** its identity is reported as `(store, team, typescript-cli-routing)`

#### Scenario: Same skill ID in two stores remains distinct

- **WHEN** stores `team-a` and `team-b` each contain a managed skill with the same skill ID
- **THEN** list/show/mutation operations address each record by its typed store owner
- **AND** neither record overwrites or retires the other

#### Scenario: Project and store sharing one bare ID do not collide

- **WHEN** both `project:platform` and `store:platform` are registered
- **THEN** a store-scoped operation resolves only `store:platform`
- **AND** the project machine-home record remains unchanged

#### Scenario: Copied record with the wrong owner is refused

- **WHEN** a store-v2 managed directory declaring owner `store:team-a` appears under `store:team-b`
- **THEN** the CLI reports a typed owner mismatch
- **AND** does not adopt, rewrite, or retire the copied directory

#### Scenario: Windows store paths remain canonical

- **WHEN** the registered store root is reached on Windows through drive-letter case, separator, or canonical filesystem aliases
- **THEN** the record path is built with platform-native path resolution beneath the authoritative canonical store root
- **AND** the typed store identity remains unchanged

### Requirement: Versioned schemas preserve v1 read compatibility

The learned-skill schema boundary SHALL strictly accept the existing candidate
and manifest version 1 project/global forms and a versioned store-capable form.
Valid v1 records SHALL normalize to typed in-memory identity without being
rewritten on list, show, applicability checks, or other reads. Store-owned
records and provenance containing store sources SHALL use the store-capable
version, and a manifest owner SHALL agree with its resolved canonical owner.

#### Scenario: V1 project record remains byte-stable on read

- **WHEN** a valid managed project manifest version 1 is listed or shown
- **THEN** it is returned as `(project, resolvedProjectId, skillId)`
- **AND** its manifest bytes and version remain unchanged

#### Scenario: V1 global record remains readable

- **WHEN** a valid managed global manifest version 1 carries project evidence
- **THEN** it remains readable as a global canonical record
- **AND** its v1 project IDs normalize to typed project contributors in memory

#### Scenario: Store record requires the store-capable version

- **WHEN** a candidate creates or rewrites store-owned knowledge
- **THEN** the resulting strict manifest records the typed store owner and typed evidence provenance
- **AND** a project/global v1 manifest is not relabeled as store-owned

#### Scenario: Unknown fields still fail strict validation

- **WHEN** a v1 or store-capable candidate or manifest includes fields outside its declared versioned shape
- **THEN** validation rejects it before any canonical state changes

### Requirement: Store knowledge is explicitly manageable

`rasen knowledge apply`, `list`, `show`, and `retire` SHALL operate on an
explicitly selected store owner. The candidate/request scope SHALL match the
resolved store owner, human and JSON output SHALL include the typed identity,
and commands SHALL NOT implicitly enumerate or select every registered store.
Store retirement SHALL target only an exact managed record and require explicit
confirmation.

#### Scenario: Explicit store list returns that store only

- **WHEN** a user runs the store-scoped list operation for `store:team`
- **THEN** the result contains managed records owned by `store:team`
- **AND** records in other stores, projects, and global storage are not included

#### Scenario: Store show preserves typed identity

- **WHEN** a user shows skill `typescript-cli-routing` for `store:team`
- **THEN** human and JSON output identify the record's store ID, skill ID, scope, and lifecycle status

#### Scenario: Mismatched selector and scope fail

- **WHEN** a candidate requests store scope while the resolved owner is a project or global scope
- **THEN** the command reports an owner/scope mismatch before mutation planning
- **AND** no registry is changed

#### Scenario: Exact store retirement is confirmed

- **WHEN** a user confirms retirement of `(store, team, typescript-cli-routing)`
- **THEN** only that exact managed store record becomes retired
- **AND** its provenance remains available through show

### Requirement: Promotion sources are authoritative managed records

A sharing or promotion plan SHALL treat candidate-named source identities as
locator requests. Every source SHALL resolve to an active Rasen-managed
canonical record with matching typed owner, stable knowledge key, and valid
stored digest. Candidate-declared contributor IDs or evidence text alone SHALL
NOT satisfy an evidence gate. Version-1 promotion candidates SHALL remain
parseable but SHALL be blocked unless their declared project sources resolve to
eligible managed records.

#### Scenario: Exact active sources qualify for planning

- **WHEN** a promotion candidate names active managed source records whose typed identities and knowledge keys match
- **THEN** the plan uses their canonical provenance as eligible evidence
- **AND** reports those source identities for approval

#### Scenario: Fabricated contributor ID is rejected

- **WHEN** a candidate declares evidence from `project:api` but no matching eligible managed project record exists
- **THEN** the plan reports the unresolved source
- **AND** does not count `project:api` toward the evidence threshold

#### Scenario: Retired or human-owned source is ineligible

- **WHEN** a named source is retired, unmanaged, has a different knowledge key, or fails its stored digest
- **THEN** promotion is blocked with the exact source reason
- **AND** target state remains unchanged

#### Scenario: V1 promotion is shape-compatible but authority-checked

- **WHEN** a strict version-1 global promotion candidate names two project IDs in its evidence
- **THEN** the candidate parses successfully
- **AND** the operation proceeds only if both IDs resolve to matching eligible managed project records

### Requirement: Store sharing requires independent member-project evidence

Creating or rewriting a store-scoped learned skill SHALL require matching
active source records from at least two distinct stable project IDs, and every
source project SHALL be a current explicit project-namespace member of the
target store. Membership SHALL be evaluated as a many-to-many graph edge;
neither a project's config-inheritance store nor registry ordering SHALL define
an exclusive parent. Store sharing SHALL also require informed store-specific
approval.

#### Scenario: Two current members support store creation

- **WHEN** `project:web` and `project:api` each have an eligible record with the same knowledge key
- **AND** both are explicit members of `store:team`
- **AND** the user approves the displayed store plan
- **THEN** the store record is created with both typed sources in its provenance

#### Scenario: One project with several changes counts once

- **WHEN** all eligible evidence comes from several changes or clones sharing one stable project ID
- **THEN** the store gate counts one distinct project
- **AND** refuses publication for insufficient independent members

#### Scenario: Project belonging to several stores is evaluated per target

- **WHEN** `project:web` is a member of both `store:team` and `store:platform`
- **THEN** it may qualify independently for either selected target
- **AND** neither store is treated as the project's exclusive owner

#### Scenario: Store and transitive references do not count as project members

- **WHEN** the target store references another store that references `project:web`
- **THEN** `project:web` does not qualify through that transitive path
- **AND** only an explicit project-namespace membership edge counts

#### Scenario: Membership drift blocks commit

- **WHEN** an eligible project is removed from the target store after planning but before commit
- **THEN** the commit revalidation blocks the store mutation
- **AND** asks the user to re-plan against current membership

### Requirement: Global promotion requires independent homogeneous sources

A global create or rewrite SHALL require matching active managed sources from
at least two distinct stable projects or at least two distinct stable stores.
One promotion plan SHALL use project sources or store sources as one homogeneous
class; mixed project/store counting SHALL be refused. Global promotion SHALL
require informed global-specific approval, and several changes or clones with
one owner ID SHALL count once.

#### Scenario: Two project records promote globally

- **WHEN** two distinct eligible project records share the requested knowledge key
- **AND** the user approves the displayed global plan
- **THEN** the global record records both typed project sources

#### Scenario: Two store records promote globally

- **WHEN** two distinct eligible store records share the requested knowledge key
- **AND** the user approves the displayed global plan
- **THEN** the global record uses the store-capable manifest and records both typed store sources

#### Scenario: Mixed source classes are refused

- **WHEN** a promotion candidate attempts to satisfy the threshold with one project and one store
- **THEN** the plan reports that independent sources must come from one source class
- **AND** no global record is created or rewritten

#### Scenario: Duplicate stable store ID counts once

- **WHEN** multiple clones or evidence entries resolve to the same stable store ID
- **THEN** the global gate counts one distinct store

### Requirement: Approval is explicit and scope-bound

Store sharing and global promotion SHALL require separate consent that is bound
to the planned target scope. In an interactive human session the CLI SHALL show
the target typed identity, action, knowledge key, applicability, and source
identities before prompting. JSON or other non-interactive execution SHALL
require the matching explicit approval flag. A consent flag for another scope
SHALL be rejected and SHALL NOT authorize mutation.

#### Scenario: Store approval authorizes only store publication

- **WHEN** a non-interactive valid store plan includes explicit store approval
- **THEN** the store plan may commit after all other preconditions pass
- **AND** that consent cannot authorize a global mutation

#### Scenario: Global approval authorizes only global promotion

- **WHEN** a non-interactive valid global plan includes explicit global approval
- **THEN** the global plan may commit after all other preconditions pass
- **AND** that consent cannot authorize a store or project mutation

#### Scenario: Missing approval leaves state unchanged

- **WHEN** a valid store or global plan lacks the matching interactive or explicit approval
- **THEN** the operation reports approval required
- **AND** canonical source and target state remain unchanged

#### Scenario: Project codification keeps existing authorization

- **WHEN** an active codify profile submits an ordinary project-scoped upsert for its resolved project owner
- **THEN** the project mutation uses the existing project authorization
- **AND** store/global approval flags are neither required nor accepted

### Requirement: Store mutations preserve managed ownership and atomicity

Store create, rewrite, and retirement SHALL use deterministic plan/commit
mutation with per-store serialization, ownership revalidation, staged digest
verification, atomic replacement, and rollback. A human-owned occupant,
malformed manifest, typed-owner mismatch, changed source, or permission failure
SHALL block the operation and preserve existing bytes. Temporary and lock
artifacts SHALL be tracked by declared exact names and SHALL not remain as
committed store content after completion or failure.

#### Scenario: Managed store rewrite replaces the whole record

- **WHEN** an approved store rewrite passes commit-time validation
- **THEN** the complete manifest and `SKILL.md` are atomically replaced
- **AND** the prior instructions are not appended to

#### Scenario: Human-owned collision is preserved

- **WHEN** the target store directory is occupied without the expected managed ownership
- **THEN** the operation reports an ownership collision
- **AND** leaves the occupant byte-for-byte unchanged

#### Scenario: Source changes between plan and commit

- **WHEN** an eligible source record is rewritten, retired, removed, or changes knowledge key after planning
- **THEN** commit refuses the stale promotion plan
- **AND** the target remains at its pre-plan bytes

#### Scenario: Store write reports reviewable files without Git mutation

- **WHEN** a store mutation succeeds
- **THEN** the result reports the store root and exact canonical files changed
- **AND** the CLI does not create a commit, push, fetch, or modify unrelated store files
