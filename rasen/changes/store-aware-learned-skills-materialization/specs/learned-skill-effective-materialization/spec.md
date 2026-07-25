## ADDED Requirements

### Requirement: Effective resolution discovers every eligible member store

For a resolved project owner, Rasen SHALL derive the effective store layer from
every healthy registered store that explicitly identifies the project as a
project-namespace member. Discovery SHALL preserve many-to-many membership and
SHALL NOT treat planning-root identity, a config-inheritance store pointer,
registry order, filesystem order, path proximity, unprefixed store references,
or transitive store references as exclusive or additional membership. Store
discovery SHALL be deterministic and produce typed diagnostics for unavailable
stores.

#### Scenario: Project receives several member stores

- **WHEN** `project:web` is an explicit member of both `store:platform` and `store:team`
- **THEN** effective resolution includes the active catalogs of both stores
- **AND** neither store is designated as the project's parent or preferred store

#### Scenario: Planning store does not become a knowledge member by implication

- **WHEN** `project:web` uses `store:planning` as its change planning root but has no explicit project-membership edge in that store
- **THEN** `store:planning` is not added to the effective knowledge set solely because it hosts planning

#### Scenario: Config-inheritance pointer is not exclusive

- **WHEN** `project:web` inherits configuration from `store:team` and is also an explicit member of `store:platform`
- **THEN** effective knowledge includes every explicit eligible membership
- **AND** does not discard `store:platform` because the pointer names `store:team`

#### Scenario: Transitive store reference is excluded

- **WHEN** `store:team` references `store:upstream` and only `store:upstream` contains `project:web`
- **THEN** membership is not followed transitively through `store:team`

#### Scenario: Store traversal order does not affect facts

- **WHEN** the same registered stores are returned in different registry or filesystem orders
- **THEN** effective membership and diagnostics are identical and sorted by typed store ID

### Requirement: Applicability precedes project-store-global precedence

For each learned-skill ID in a project-local tool home, Rasen SHALL first keep
only active managed records whose applicability matches the resolved project
root, then apply `project > store > global` precedence. A retired,
non-applicable, or invalid higher-layer record SHALL NOT suppress an applicable
lower-layer record. Lower-layer content SHALL not be selected when an applicable
higher-layer winner exists.

#### Scenario: Project record wins

- **WHEN** applicable project, member-store, and global records share one skill ID
- **THEN** the effective record is the project-owned record
- **AND** its typed project identity is the materialized source

#### Scenario: Store record wins over global

- **WHEN** no applicable project record exists and an applicable member-store record shares an ID with an applicable global record
- **THEN** the effective record is store-scoped

#### Scenario: Non-applicable project falls through

- **WHEN** a project record exists but its applicability does not match the project root
- **AND** an applicable store record has the same ID
- **THEN** the store record becomes effective

#### Scenario: Retired store falls through to global

- **WHEN** every member-store record for an ID is retired or non-applicable
- **AND** an applicable active global record exists
- **THEN** the global record becomes effective

#### Scenario: Windows applicability uses the project root

- **WHEN** marker paths are evaluated for a Windows project reached through canonical path aliases or platform separators
- **THEN** applicability uses platform-native resolution against the authoritative project root
- **AND** precedence produces the same typed winner

### Requirement: Equivalent store copies deduplicate without a winning store

When several applicable member stores publish the same skill ID, Rasen SHALL
deduplicate them into one effective item only when their stable knowledge key
and verified canonical content digest/bytes are identical. The effective item
SHALL record every contributing typed store identity in stable order. Equal ID
or equal knowledge key with divergent content SHALL NOT establish equivalence.

#### Scenario: Exact copies become one effective item

- **WHEN** `store:platform` and `store:team` publish the same ID, knowledge key, and canonical bytes
- **THEN** one effective skill is planned
- **AND** both typed store identities are recorded as sources

#### Scenario: Registration order cannot choose the source

- **WHEN** equivalent copies are discovered in different orders
- **THEN** the rendered content and sorted source identity set are identical

#### Scenario: Equal key with different bytes is not deduplicated

- **WHEN** two member stores publish one ID and knowledge key but their canonical content differs
- **THEN** Rasen reports a store conflict rather than choosing a revision

#### Scenario: Equal bytes with different knowledge keys conflict

- **WHEN** two member stores publish byte-identical content under one ID but disagree on the stable knowledge key
- **THEN** Rasen reports the identity disagreement
- **AND** does not merge their provenance

### Requirement: Effective store conflicts fail deterministically

Rasen SHALL fail learned reconciliation deterministically on an effective store
conflict. When the store layer is effective for an ID and participating store
records are not equivalent, Rasen SHALL produce one order-independent conflict containing
every typed store identity, stable knowledge key, and canonical digest. A known
effective store conflict SHALL block all learned-skill file and learned-ledger
changes for that init/update run. Rasen SHALL NOT use a store ID, path,
registration time, planning relationship, or traversal order as a tie-breaker.

#### Scenario: Divergent stores block learned reconciliation

- **WHEN** two applicable member stores publish divergent content for one effective ID
- **THEN** learned reconciliation is blocked before adding, refreshing, or removing any learned copy
- **AND** existing learned ledgers and files remain unchanged

#### Scenario: Conflict report is order-independent

- **WHEN** the same three divergent records are discovered in any order
- **THEN** human and JSON conflict output list the same sorted typed sources, keys, and digests

#### Scenario: Project winner shadows a latent store disagreement

- **WHEN** an applicable project record wins an ID whose lower store layer is divergent
- **THEN** the project record remains the deterministic effective winner
- **AND** the lower disagreement is reported as latent rather than used to select a store

#### Scenario: User aligns store copies

- **WHEN** the user updates, renames, or retires canonical store records so all effective store copies become equivalent or only one remains
- **THEN** the next resolution can produce a ready plan without a store tie-breaker

### Requirement: Effective plans enforce post-resolution context budgets

Rasen SHALL calculate the active learned-skill description budget after
applicability, precedence, and equivalent-store deduplication. Each effective
item SHALL count once regardless of how many equivalent store sources it has.
An exceeded named budget SHALL block learned reconciliation before writes and
identify the effective items that must be merged, retired, or narrowed.

#### Scenario: Equivalent stores count one description

- **WHEN** four member stores contribute one equivalent effective skill
- **THEN** its always-loaded description counts once toward the active budget

#### Scenario: Shadowed lower records do not consume budget

- **WHEN** a project record shadows store and global records with the same ID
- **THEN** only the project winner's description counts

#### Scenario: Effective budget overflow blocks writes

- **WHEN** the final effective descriptions exceed `LEARNED_SKILL_ACTIVE_DESCRIPTION_BUDGET`
- **THEN** no learned file or ledger is changed
- **AND** the diagnostic names the budget and effective records

### Requirement: Materialized copies carry typed effective provenance

Every project-local materialized learned skill SHALL record generated
ownership, learned-skill ID, effective scope, all sorted typed canonical source
identities, and a resolution digest covering the source set and rendered
content. A provenance-only change SHALL be visible to reconciliation even when
instructions are unchanged. Generated output SHALL remain declarative and
contain no executable sidecars.

#### Scenario: Store-deduplicated copy records every source

- **WHEN** one effective item deduplicates equivalent records from two stores
- **THEN** its generated metadata and ledger identify both typed store sources
- **AND** do not invent one winning store

#### Scenario: Precedence change refreshes provenance

- **WHEN** a project record retires and an equivalent store record becomes effective
- **THEN** reconciliation updates the materialized source identity and resolution digest
- **AND** reports the precedence transition

#### Scenario: Generated output remains non-executable

- **WHEN** project, store, or global guidance is materialized
- **THEN** only the managed `SKILL.md` is generated
- **AND** no script or executable sidecar is created

### Requirement: Project-local learned ownership uses a typed dedicated ledger

Project-local learned materializations SHALL be tracked in a versioned
learned-specific ledger separate from workflow artifact ownership. Each entry
SHALL record the effective scope, all typed source identities, resolution
digest, and exact generated file path/digest. When only legacy learned entries
exist in the workflow ledger, Rasen SHALL normalize them to project/global
typed sources, write the new ledger atomically, and then remove only the legacy
learned sections while preserving all workflow entries and workflow-ledger
compatibility.

#### Scenario: Legacy project entry migrates

- **WHEN** a project workflow ledger tracks a project-scoped learned copy and no typed learned ledger exists
- **THEN** the entry migrates to the resolved typed project owner
- **AND** exact file ownership remains intact

#### Scenario: Legacy global entry migrates

- **WHEN** a project workflow ledger tracks a global learned copy
- **THEN** the typed ledger records its source as global without inferring a project or store

#### Scenario: Workflow ownership survives migration

- **WHEN** legacy learned sections and ordinary workflow entries share the workflow ledger
- **THEN** migration preserves the workflow ledger version and every workflow entry
- **AND** clears only the migrated learned sections after the new ledger is durable

#### Scenario: Crash leaves both representations safely recoverable

- **WHEN** a process stops after writing the typed ledger but before clearing legacy learned sections
- **THEN** the typed ledger remains authoritative on retry
- **AND** cleanup can complete without deleting or duplicating the materialized file

#### Scenario: Older CLI preserves migrated files

- **WHEN** an older CLI reads the preserved workflow ledger after learned ownership moved out
- **THEN** it retains ordinary workflow ownership
- **AND** treats typed learned copies as untracked occupants rather than deletion targets

### Requirement: Reconciliation modifies only exact owned copies

Project-local reconciliation SHALL create, refresh, and remove learned copies
only through exact typed-ledger identities and file digests. An untracked,
symlinked, non-regular, missing, or user-modified target SHALL be preserved with
an actionable diagnostic. Removal SHALL occur only when the canonical source is
authoritatively no longer effective; filename patterns and scope prefixes SHALL
not determine deletion.

#### Scenario: Unchanged tracked copy refreshes

- **WHEN** the effective resolution digest changes and the existing target still matches its ledger digest
- **THEN** Rasen atomically refreshes the managed copy and ledger entry

#### Scenario: Human edit blocks refresh

- **WHEN** a tracked `SKILL.md` no longer matches the recorded generated digest
- **THEN** Rasen preserves it byte-for-byte
- **AND** reports that the path is no longer the exact generated copy

#### Scenario: Retired source removes exact copy

- **WHEN** an effective source is authoritatively retired and the tracked target remains unchanged
- **THEN** Rasen removes only that exact file and its typed ledger entry

#### Scenario: Same-named untracked directory survives

- **WHEN** a desired or obsolete ID collides with an untracked human-owned directory
- **THEN** reconciliation leaves the directory unchanged

### Requirement: Unavailable stores defer destructive uncertainty

An unavailable store SHALL NOT be treated as an empty or retired catalog. When
typed ledger, frozen, or authoritative pointer facts show that the store
previously or potentially contributes to the project, Rasen SHALL defer
removals and same-layer replacements whose safety depends on that unavailable
source. A deterministic higher project layer MAY replace a prior store result.
Unavailable unrelated stores SHALL be reported without blocking unrelated
effective items.

#### Scenario: Prior store source becomes unavailable

- **WHEN** a typed ledger entry names `store:team` and that store cannot be evaluated
- **THEN** Rasen preserves the unchanged tracked copy and reports deferred reconciliation
- **AND** does not interpret the outage as retirement

#### Scenario: Project winner can replace unavailable lower source

- **WHEN** an applicable project record now wins an ID previously sourced from an unavailable store
- **THEN** project precedence authorizes the refresh
- **AND** the unavailable lower layer is not chosen

#### Scenario: Unrelated unavailable store does not block additions

- **WHEN** an unavailable registered store has no prior, pointer, frozen, or current membership evidence for the project
- **THEN** it is reported and excluded
- **AND** unaffected effective skills may reconcile

### Requirement: Global-only tool homes receive only global knowledge

A machine-global tool home, including Hermes, SHALL reconcile every active
approved global learned skill through a machine-global typed ledger,
independent of the current project's markers, member stores, or project-local
conflicts. Project and store records SHALL never materialize into that home.
One project's init/update SHALL NOT remove a shared global copy based on local
applicability or membership.

#### Scenario: Store skill is excluded from Hermes

- **WHEN** an applicable store-scoped record exists during Hermes reconciliation
- **THEN** it is not written to the Hermes global skill home
- **AND** the result reports the local-scope exclusion

#### Scenario: Project skill is excluded from Hermes

- **WHEN** an applicable project-scoped record exists
- **THEN** it is not written to the global-only home

#### Scenario: Global record ignores current project markers

- **WHEN** an active approved global record does not match the current project's path markers
- **THEN** it remains reconciled in the shared global-only home

#### Scenario: Project-local store conflict does not prune global copy

- **WHEN** one project has a divergent effective store conflict
- **THEN** that conflict does not remove or re-source an existing machine-global global record

### Requirement: Materialization results are complete and deterministic

Human and JSON results SHALL distinguish additions, updates, removals, skips,
equivalent-store deduplication, effective store conflicts, unavailable stores,
and deferred cleanup. Every store-related result SHALL use typed store IDs, and
the same canonical inputs SHALL produce the same sorted result independent of
registry, filesystem, or tool iteration order.

#### Scenario: Equivalent store result reports all sources

- **WHEN** two store copies deduplicate
- **THEN** output reports one effective ID and both sorted store identities

#### Scenario: Conflict result includes repair facts

- **WHEN** learned reconciliation is blocked by divergent stores
- **THEN** output includes every source identity, key, digest, and guidance to align, rename, or retire canonical records

#### Scenario: No learned changes is successful

- **WHEN** the desired typed plan and every exact tracked copy already agree
- **THEN** learned reconciliation reports no changes without rewriting files or ledgers
