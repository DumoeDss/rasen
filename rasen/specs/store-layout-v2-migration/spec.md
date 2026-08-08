# store-layout-v2-migration Specification

## Purpose
Migrates a Store from the flat 0.1.6 layout (where every project's changes, specs, and
design-docs share one set of directories) to the project-partitioned layout v2 (where
each project owns `rasen/projects/<projectId>/`). Migration is previewable, evidence-based,
no-clobber, and fail-closed when ownership cannot be proven from auditable evidence.
## Requirements
### Requirement: Flat Store layout is inventoried per Git ref

Layout inventory SHALL report, for every local Store ref and linked worktree, whether that ref declares layout v2, still carries flat planning content, has no Store metadata, or cannot be read, using read-only Git blob access without checking anything out. Remote-tracking refs SHALL be reported and SHALL NOT be migration candidates. For the ref checked out in the invoking Store worktree, inventory SHALL additionally enumerate every flat canonical spec, active Change, Archive entry, Store-level design doc, membership record, and legacy adoption manifest entry. Inventory SHALL be total rather than fail-fast: an unreadable item SHALL be recorded with its reason and SHALL NOT abort the scan. Inventory SHALL write nothing.

#### Scenario: Every flat ref is reported, not just the current one

- **WHEN** a Store has three local branches and two of them still carry flat planning content
- **THEN** inventory SHALL list both flat refs with their layout classification
- **AND** it SHALL state that migrating the checked-out ref does not migrate the others

#### Scenario: Migration is refused for a ref that is not checked out

- **WHEN** an operator asks to migrate a flat ref that is not checked out in the invoking Store worktree
- **THEN** the command SHALL refuse and name the worktree it must be run from
- **AND** it SHALL NOT check out, merge, rebase, or otherwise mutate any ref

#### Scenario: Inventory of a damaged Store is complete

- **WHEN** one Change directory is unreadable and one membership record fails to parse
- **THEN** inventory SHALL record both with their reasons and SHALL still report every other item
- **AND** the Store, the project repositories, and the machine data directory SHALL remain byte-identical

### Requirement: Project ownership is decided only from auditable evidence

Migration SHALL determine the owning project of each item only from recorded identity inside the item, Store adoption and membership records, Change or Session association records whose project is a member of this Store, and a committed explicit mapping file, in that precedence. Recorded identity SHALL be binding and SHALL NOT be overridden by any other source or by the mapping file; a lower-priority source disagreeing with it SHALL be recorded as superseded evidence. Two lower-priority sources disagreeing with each other SHALL be unresolved. Migration SHALL NOT infer ownership from a Change name prefix, a Git branch name, directory adjacency, sibling ordering, or the only member project whose name looks similar. Evidence naming a project that is not a member of the Store, or naming an id that fails the v2 portable identifier contract, SHALL be unresolved, and the id SHALL NOT be sanitized.

#### Scenario: Adoption evidence uniquely recovers the owner

- **WHEN** the Store's adoption record lists a Change name as owned by project `elftia` and no other source disagrees
- **THEN** migration SHALL assign that Change to `elftia` and record the evidence source in its plan

#### Scenario: Remaining entries are never distributed among members

- **WHEN** a Store has three member projects and some flat Changes have no ownership evidence at all
- **THEN** those Changes SHALL be reported as unresolved with no owner
- **AND** they SHALL NOT be assigned to any member on the strength of membership, name similarity, or being the only remaining candidate

#### Scenario: Conflicting lower-priority evidence blocks

- **WHEN** an adoption record and an association record name different projects for the same Change and the Change records no identity of its own
- **THEN** the item SHALL be unresolved as an evidence conflict naming both sources and both projects

#### Scenario: Recorded identity wins and the disagreement is kept

- **WHEN** a Change records its own project identity and a stale adoption record names a different project
- **THEN** the Change SHALL be assigned to its recorded identity
- **AND** the disagreement SHALL be recorded as superseded evidence and reported, without blocking migration

### Requirement: Canonical spec ownership comes from provenance, and shared specs block migration

Migration SHALL determine the owner of a flat canonical spec from a provenance graph built from every active and archived Change delta that touches that capability, not from directory adjacency. A capability with exactly one known contributing project SHALL be assigned to it. A capability with no contributor, or with any contributor whose own ownership is unresolved, SHALL be unresolved. A capability contributed to by two or more distinct projects SHALL block migration until the explicit mapping file declares either one authoritative owner or an explicit per-project split; a declared owner SHALL record the other contributing projects as historical contributors without creating a runtime cross-project spec reference, and a declared split SHALL place identical content in each named project's partition. Migration SHALL NOT carry an unattributed shared spec into layout v2.

#### Scenario: Single-contributor capability is assigned

- **WHEN** every Change that ever supplied a delta for capability `session-relay` resolves to project `elftia`
- **THEN** that capability SHALL be assigned to `elftia`'s partition with `spec-provenance` evidence

#### Scenario: Multi-project capability blocks until declared

- **WHEN** capability `telemetry` has contributing Changes from two different projects and the mapping declares nothing for it
- **THEN** migration SHALL block, name both contributing projects, and state that an authoritative owner or an explicit split is required
- **AND** no partition SHALL be written

#### Scenario: Declared split copies identical content

- **WHEN** the mapping declares a split of capability `telemetry` across two projects
- **THEN** each named project's partition SHALL receive identical spec content
- **AND** the receipt SHALL record the split and both contributors

#### Scenario: An unresolved Change does not make a spec look single-owner

- **WHEN** a capability has one contributor resolved to project `elftia` and one contributor whose own ownership is unresolved
- **THEN** the capability SHALL be unresolved rather than assigned to `elftia`

### Requirement: Store-level design docs are retained unless explicitly reclassified

Migration SHALL retain every Store-level design doc at the Store-level design-doc address by default, because a design document carries no attributable ownership evidence. The plan SHALL list every retained document explicitly so retention is a stated decision rather than an omission, the explicit mapping file MAY assign any document to a project partition, and the retained set SHALL be recorded in the receipt and reported as a standing informational diagnostic.

#### Scenario: Unclassified design docs stay at Store level

- **WHEN** a flat Store holds design docs with no mapping entries
- **THEN** those documents SHALL remain at the Store-level design-doc address
- **AND** the plan SHALL list each one as retained

#### Scenario: Mapping moves a design doc into a partition

- **WHEN** the mapping assigns a design doc to project `elftia`
- **THEN** the document SHALL land in `elftia`'s project design-doc location
- **AND** the receipt SHALL record the reclassification as an operator declaration

### Requirement: Facts legacy evidence cannot prove are declared, minted, or refused

Migration SHALL NOT synthesize a fact that legacy data cannot prove. A target line SHALL come only from an explicit operator declaration in the mapping file or a default target-line option, SHALL be recorded as an assertion distinct from derived evidence, and its absence for an item that needs one SHALL be unresolved. Target-line catalog records SHALL be written only from explicit `storeRef` and per-project `codeRef` declarations, and a declaration disagreeing with an existing catalog SHALL block. A relocated Change SHALL receive one newly minted instance seed with derived and verified planning-scope and Change-instance identities only when its target line is declared and the Store carries a permanent identity; an existing v2 identity SHALL be verified rather than re-minted. Legacy Archive entries SHALL be relocated byte-for-byte under their existing directory names, and migration SHALL NOT produce, upgrade, or infer an Archive v2 record, a finalization outcome, a reachability fact, or a workspace pair for them.

#### Scenario: Missing target line blocks rather than defaulting

- **WHEN** an active Change has no declared target line and no default is supplied
- **THEN** the item SHALL be unresolved as a missing target line
- **AND** no target line SHALL be derived from a branch name, a ref, or another Change

#### Scenario: Minted identity is recorded against the old alias

- **WHEN** a Change with a declared target line is relocated in a Store carrying a permanent identity
- **THEN** its metadata SHALL carry a v2 identity whose scope and instance ids verify together
- **AND** the receipt SHALL record the old Change alias and the new Change instance id

#### Scenario: Store without permanent identity blocks

- **WHEN** the Store has no permanent Store identity
- **THEN** migration SHALL block with the Store-identity repair command
- **AND** no planning-scope or Change-instance identity SHALL be derived

#### Scenario: Legacy Archive entries keep their names and records

- **WHEN** legacy Archive entries are relocated into a project's stable target-line Archive directory
- **THEN** their directory names and record files SHALL be byte-identical to the originals
- **AND** no Archive v2 record, outcome, reachability fact, or workspace-pair identity SHALL be written for them

### Requirement: Migration plans are immutable, content-addressed, and revalidated before applying

Planning SHALL produce an immutable plan containing every item's source, destination, owner, evidence chain, and digest, together with catalog upgrades, target-line catalogs, receipt content, and the retirement set. The plan SHALL be canonically serialized and addressed by its own digest, and applying SHALL consume only a plan token rather than re-resolving the current directory, branch, or selector. Before its first write, applying SHALL revalidate the Store metadata and declared layout, the ref name and head commit, every source digest, the non-existence of every destination, the mapping file digest, and every catalog upgrade source. Any mismatch SHALL invalidate the plan and require a new one. Plans and recovery manifests SHALL be machine-local coordination state and SHALL NOT be written into either Git repository.

#### Scenario: Equal inputs produce an identical plan

- **WHEN** a plan is computed twice from the same inventory and mapping
- **THEN** both plans SHALL serialize identically and carry the same plan id

#### Scenario: A changed Store invalidates the plan

- **WHEN** the Store head commit, a source file, the mapping file, or the Store metadata changes between planning and applying
- **THEN** applying SHALL fail as stale and SHALL NOT write, move, or delete anything
- **AND** it SHALL NOT silently re-resolve to a different destination set

#### Scenario: Plan state is not committed to the Store

- **WHEN** a plan and its recovery manifest exist for an in-flight migration
- **THEN** neither SHALL be located inside the Store repository or a project repository
- **AND** a routine commit in the Store SHALL NOT be able to capture them

### Requirement: Migration applies only when every item resolves

Applying SHALL be refused unless every inventoried item is resolved and no item is blocked. The refusal SHALL list every unresolved and blocked item with its reason and the mapping entry or repair that would resolve it. There SHALL be no override flag and no partial or subset migration, because a Store holding both flat and partitioned planning content is an ambiguous truth source. An item whose destination already exists SHALL block, and migration SHALL NOT overwrite, merge, or rename around existing content. A Store worktree with tracked modifications or staged changes on plan sources SHALL block; untracked files inside moved trees SHALL be reported and SHALL require an explicit acknowledgement because Git cannot restore them.

#### Scenario: One unresolved item blocks the whole run

- **WHEN** every item but one resolves and one Change has no ownership evidence
- **THEN** applying SHALL refuse, naming that item and its reason
- **AND** no partition, catalog, or receipt SHALL be written

#### Scenario: Same-named Changes from two projects do not clobber

- **WHEN** two projects each own a Change with the same alias
- **THEN** both SHALL resolve to destinations in their own project partitions
- **AND** neither SHALL be renamed, merged, or reported as a collision

#### Scenario: An existing destination is never overwritten

- **WHEN** a computed destination path already exists in the Store
- **THEN** the item SHALL block, naming both paths
- **AND** the existing content SHALL remain byte-identical

#### Scenario: Dirty sources block and untracked files are acknowledged

- **WHEN** a plan source has tracked modifications, or contains untracked files and no acknowledgement was given
- **THEN** applying SHALL refuse, listing the affected paths and which class each falls into

### Requirement: Migration stages, publishes atomically, retires separately, and recovers

Applying SHALL copy the complete destination tree into a staging area inside the Store worktree, leaving every source intact and readable, and SHALL verify the staged tree by per-file digest, strict UTF-8 decoding, schema validation of every produced catalog and metadata file, identity re-derivation, and containment. Publication SHALL write a recovery manifest first, rename staged trees into their destinations, and declare layout version 2 last as the single point at which readers switch layouts. Removing the flat tree SHALL be a separate, idempotent step that refuses unless a completed publication is recorded for that ref. A recovery command SHALL report the recorded phase and SHALL support resuming, and rolling back by removing only paths the manifest proves this run created and restoring the previous Store metadata; after the flat tree has been retired, rollback SHALL refuse and SHALL name Git as the recovery path. Any failure SHALL leave either a fully readable pre-publication state or one complete published state, never a partially published tree.

#### Scenario: Failure before the layout flip leaves the old Store intact

- **WHEN** copying, verification, or any rename fails
- **THEN** the flat Store SHALL remain completely readable
- **AND** no partially published project partition SHALL remain

#### Scenario: The layout flip is the switch point

- **WHEN** publication completes
- **THEN** the Store metadata SHALL declare layout version 2 only after every partition, catalog, and receipt is in place
- **AND** readers before the flip SHALL have seen the intact flat layout

#### Scenario: Retirement is a separate step

- **WHEN** publication has completed and the operator has committed it
- **THEN** removing the flat tree SHALL be a separate command producing its own commit suggestion
- **AND** it SHALL refuse to run when no completed publication is recorded for that ref

#### Scenario: Rollback removes only what this run created

- **WHEN** an interrupted run is rolled back before retirement
- **THEN** only paths recorded as created by that run SHALL be removed and the previous Store metadata SHALL be restored
- **AND** no pre-existing Store content SHALL be deleted or modified

### Requirement: Layout migration upgrades membership records and records provenance in a committed receipt

Migrating a Store to layout v2 SHALL convert each per-project membership record into a v2 project catalog, carrying the project identity, display id, remote, knowledge bundle, and roles, and blocking when a value cannot satisfy the stricter v2 contract. The planning binding SHALL be derived only from adoption evidence or a proven pointer-without-local-planning binding, never from membership alone. Adoption name lists SHALL be dropped from the catalog and preserved in a committed migration receipt, together with the legacy adoption manifest content, per-item source, destination, owner and evidence, minted identity and old-alias mappings, relocated legacy Archive entries marked as legacy-schema, shared-spec resolutions with their contributors, retained design docs, superseded evidence, and the publication and retirement phases. The receipt SHALL be deterministic UTF-8 without a byte-order mark.

#### Scenario: Adoption evidence produces a bound catalog

- **WHEN** a membership record carries adoption data for a project
- **THEN** its v2 catalog SHALL declare the project a planning member with a bound planning binding and a canonical binding timestamp

#### Scenario: Membership alone does not bind

- **WHEN** a membership record declares only a knowledge role and carries no adoption data
- **THEN** its v2 catalog SHALL declare the planning binding unbound

#### Scenario: A value that cannot become a v2 catalog blocks

- **WHEN** a membership record's display id or remote cannot satisfy the v2 catalog contract
- **THEN** migration SHALL block naming the record, the field, and the reason
- **AND** the value SHALL NOT be rewritten to make it fit

#### Scenario: The receipt explains the migration afterwards

- **WHEN** a migration has been applied
- **THEN** the committed receipt SHALL allow every item's owner, evidence, source, and destination to be reconstructed without re-running inventory
- **AND** it SHALL contain the dropped adoption lists and the old-alias-to-instance mapping

### Requirement: Store planning writes never target two layouts

Every Store planning mutation SHALL assert the Store's declared layout before writing. A Store declaring layout v2 SHALL refuse writes to flat Store planning paths, a legacy flat Store SHALL refuse writes to project partitions and SHALL report that migration is required, and a Store found holding both SHALL refuse both and name the recovery command. No command SHALL write the same planning fact to both layouts, and no supported read SHALL union flat content with partitioned content.

#### Scenario: A v2 Store refuses a flat planning write

- **WHEN** any Store planning mutation would create or modify a root-level Store `rasen/specs` or `rasen/changes` path in a Store declaring layout v2
- **THEN** the mutation SHALL fail
- **AND** no such path SHALL be created

#### Scenario: A flat Store refuses a partition write

- **WHEN** any Store planning mutation would create a project partition in a Store that has not declared layout v2
- **THEN** the mutation SHALL fail naming the migration command
- **AND** no partition SHALL be created

#### Scenario: A half-migrated Store refuses both

- **WHEN** a Store declares layout v2 and still holds flat planning content with no completed publication recorded
- **THEN** planning mutations SHALL fail naming the recovery command
- **AND** neither layout SHALL be written

### Requirement: Migration diagnostics are read-only and name the repair

`rasen doctor` and `rasen store doctor` SHALL report layout-migration health: refs that still carry flat planning content, a Store declaring layout v2 that still holds flat content, an unfinished or failed migration run recorded for this Store and ref, items with absent or conflicting ownership evidence, capabilities with unresolved shared ownership, a partition with no project catalog or a bound catalog with no partition, a membership record left at the legacy schema inside a v2 Store, relocated Archive entries whose records are not Archive v2, and retained unclassified Store-level design docs. Each finding SHALL carry a stable code, name the affected ref, file, or item, and carry a copy-pasteable repair command. These diagnostics SHALL write nothing, contact no network, and repair nothing, and human and JSON output SHALL report the same codes and repair commands.

#### Scenario: A flat Store is diagnosed with its migration command

- **WHEN** doctor inspects a Store whose refs still carry flat planning content
- **THEN** it SHALL report each such ref with the command that migrates it

#### Scenario: A half-migrated Store is distinguished from a flat one

- **WHEN** a Store declares layout v2 but still holds flat planning content
- **THEN** doctor SHALL report the residue and the incomplete run distinctly from an unmigrated flat Store

#### Scenario: Unresolved ownership is visible before anyone plans a migration

- **WHEN** doctor inspects a flat Store whose items have absent or conflicting ownership evidence
- **THEN** it SHALL report the count and the affected items without producing a plan

#### Scenario: Diagnosis writes nothing

- **WHEN** any migration diagnostic is reported
- **THEN** no file under the Store, a project repository, or the machine data directory SHALL be modified

