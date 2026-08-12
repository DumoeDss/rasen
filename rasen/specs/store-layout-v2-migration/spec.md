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

Migration SHALL first classify each active Change and Archive entry as either a project-owned `project-change` or a Store-level `store-issue`, and SHALL require an owning project only for `project-change`. Project ownership SHALL be determined only from recorded identity inside the item, Store adoption and membership records, Change or Session association records whose project is a member of this Store, and a committed explicit mapping file, in that precedence. Recorded identity SHALL be binding: it SHALL materialize as `project-change` and SHALL NOT be overridden by another project or by `store-issue`; lower-priority disagreement SHALL remain superseded evidence. Two lower-priority project sources disagreeing with each other SHALL remain unresolved unless a strict mapping version 2 declaration explicitly classifies the source, and all derived evidence SHALL remain visible after that assertion.

Mapping version 1 SHALL retain its existing closed schema and SHALL always use the existing project-ownership and project-copy behavior. For the same inventory, mapping, clock, and options it SHALL produce the same ownership, unresolved/conflicting results, target lines, destinations, evidence, diagnostics, immutable plan schema version 1 bytes, and plan id as before mapping version 2 support. Mapping version 2 SHALL use separate closed active and archived work-item unions with `kind: project-change` or `kind: store-issue`. A project declaration SHALL accept only `project` and optional `targetLine`. An active Issue declaration SHALL accept only portable `issueId`, `title`, and optional `plan`, SHALL generate state `open`, and SHALL reject state/reason fields. An archived Issue declaration SHALL explicitly carry `state: open | resolved | dropped`; `open` SHALL carry no reason and either terminal state SHALL carry a non-empty operator rationale. Unknown fields, fields from the other union branch, and ambiguous declarations SHALL be rejected.

One trustworthy E1, E2, or E3 project result MAY continue to normalize an undeclared version 2 item as `project-change`; absent or conflicting ownership evidence SHALL require an explicit version 2 work declaration before the whole plan is applicable. A `store-issue` classification SHALL have no owner or target line and SHALL record those concepts as not applicable rather than missing. Migration SHALL NOT infer classification or ownership from a Change name prefix, Git branch, directory adjacency, title, planning-document content, Session cwd, member order, remaining candidate, or similarity. Evidence naming a non-member or non-portable project SHALL remain unresolved and SHALL NOT be sanitized.

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

#### Scenario: Version 1 mapping retains its exact meaning and plan identity

- **WHEN** an existing version 1 mapping and Store inventory are planned after version 2 support is installed
- **THEN** every ownership decision, unresolved item, target line, destination, blocker, evidence record, plan-schema-v1 canonical byte, token field, and plan id SHALL match the pre-version-2 result
- **AND** no Change or Archive entry SHALL become an Issue or gain a materialization field

#### Scenario: Trustworthy project evidence needs no redundant classification

- **WHEN** an item has one trustworthy member-project owner under E1, E2, or E3 and version 2 declares no entry for it
- **THEN** the item SHALL normalize to `project-change` with the complete evidence chain
- **AND** absence of a declaration SHALL NOT select `store-issue`

#### Scenario: Recorded project identity cannot be relabelled as an Issue

- **WHEN** a version 2 mapping declares `kind: store-issue` for an item whose E1 identity names a project
- **THEN** planning SHALL fail with an actionable contradiction naming the item and recorded project
- **AND** neither an Issue output nor another project destination SHALL be written

#### Scenario: Unknown or conflicting work requires a version 2 declaration

- **WHEN** an active Change or Archive entry has absent or conflicting project evidence under mapping version 2
- **THEN** the plan SHALL remain inapplicable until the exact mapping key declares `project-change` with a project or `store-issue` with Issue fields
- **AND** human and JSON output SHALL list both accepted repairs without guessing

#### Scenario: Cross-branch fields are rejected

- **WHEN** a `store-issue` declaration contains a project, target line, Pipeline, cwd, commit, or acceptance field, or a `project-change` declaration contains Issue fields
- **THEN** mapping validation SHALL reject the closed-union declaration
- **AND** no unknown or inapplicable field SHALL be ignored

#### Scenario: Coordinator-looking content is not evidence

- **WHEN** a legacy tree contains proposal, tasks, specs, planning-context, portfolio-like names, cross-project prose, or child aliases but has no qualifying evidence or mapping version 2 declaration
- **THEN** migration SHALL leave the item unresolved
- **AND** SHALL NOT inspect that content to invent an owner, Issue, plan node, state, or dependency

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

Migration SHALL NOT synthesize a fact that legacy data cannot prove. For `project-change`, a target line SHALL come only from an explicit operator declaration in the mapping file or a default target-line option, SHALL be recorded as an assertion distinct from derived evidence, and its absence SHALL be unresolved. Target-line catalog records SHALL be written only from explicit `storeRef` and per-project `codeRef` declarations, and a declaration disagreeing with an existing catalog SHALL block. A relocated active `project-change` SHALL receive one newly minted instance seed with derived and verified planning-scope and Change-instance identities only when its target line is declared and the Store carries a permanent identity; an existing v2 identity SHALL be verified rather than re-minted. A legacy Archive entry classified `project-change` SHALL be relocated byte-for-byte under its existing directory name, and migration SHALL NOT produce, upgrade, or infer an Archive v2 record, finalization outcome, reachability fact, or workspace pair for it.

A source classified `store-issue` SHALL instead have an explicit `generated-tree` materialization at the Store-level Issue address. It SHALL have no project owner or target line, SHALL NOT receive a Change identity or project Archive destination, and SHALL NOT be copied. Its provenance SHALL retain the source lifecycle, alias, Store-relative path, recursive digest, mapping assertion, Store source revision, generated destination root, and exact generated file roles/digests. The generated tree SHALL contain only one standard Issue record and an optional standard Execution Plan revision; no owner, legacy Archive schema, finalization, acceptance, Pipeline, cwd, member commit, or legacy tree content SHALL be invented.

#### Scenario: Missing target line blocks rather than defaulting

- **WHEN** an active Change classified `project-change` has no declared target line and no default is supplied
- **THEN** the item SHALL be unresolved as a missing target line
- **AND** no target line SHALL be derived from a branch name, a ref, or another Change

#### Scenario: Minted identity is recorded against the old alias

- **WHEN** a Change classified `project-change` with a declared target line is relocated in a Store carrying a permanent identity
- **THEN** its metadata SHALL carry a v2 identity whose scope and instance ids verify together
- **AND** the receipt SHALL record the old Change alias and the new Change instance id

#### Scenario: Store without permanent identity blocks

- **WHEN** the Store has no permanent Store identity
- **THEN** migration SHALL block with the Store-identity repair command
- **AND** no planning-scope or Change-instance identity SHALL be derived

#### Scenario: Legacy Archive entries keep their names and records

- **WHEN** legacy Archive entries classified `project-change` are relocated into a project's stable target-line Archive directory
- **THEN** their directory names and record files SHALL be byte-identical to the originals
- **AND** no Archive v2 record, outcome, reachability fact, or workspace-pair identity SHALL be written for them

#### Scenario: Store Issue materialization has independent provenance

- **WHEN** an active Change or Archive entry is explicitly classified `store-issue`
- **THEN** its plan and receipt SHALL describe a generated Store Issue root, source lifecycle/path/digest, and generated file inventory without an owner or project destination
- **AND** no legacy source byte SHALL be copied into the generated tree or treated as member delivery

### Requirement: Migration plans are immutable, content-addressed, and revalidated before applying

Planning SHALL produce a strict immutable plan containing every item's source and digest, its version-appropriate destination or materialization, project owner/evidence/target line when it is `project-change`, generated file inventory and provenance when it is `store-issue`, together with catalog upgrades, target-line catalogs, receipt content, and the retirement set. Each plan SHALL be canonically serialized and addressed by the digest of the canonical body for its declared schema version, and applying SHALL consume only a plan token rather than re-resolving cwd, branch, selector, classification, or generated content.

Mapping version 1, no-mapping invocations, and every existing path whose output is representable by the existing plan SHALL continue to emit the current migration plan schema version 1 with byte-identical canonical fields, omission rules, bytes, plan id, and token for equal inputs. A plan SHALL use schema version 2 only when a mapping version 2 result requires an explicit materialization/disposition that schema version 1 cannot encode. Schema version 2 SHALL explicitly encode `copy-tree`, `generated-tree`, and `retain`, and its id SHALL digest that v2 canonical body. Stored-plan reader, apply, resume, and rollback SHALL dispatch strictly by declared version; they SHALL reject missing/unknown versions and cross-version fields, SHALL NOT infer a version from shape, and SHALL NOT normalize or re-hash v1 as v2.

Before its first write, applying SHALL revalidate the Store metadata and layout, ref and HEAD, every source digest, version-appropriate destination precondition, mapping and optional plan-input digest, generated inventory, and catalog upgrade source. Any mismatch SHALL invalidate the plan and require a new one. Plans and recovery manifests SHALL remain machine-local coordination state outside both repositories.

#### Scenario: Equal inputs produce an identical plan

- **WHEN** a plan is computed twice from the same inventory, mapping, clock, and options
- **THEN** both plans SHALL serialize identically and carry the same plan id

#### Scenario: A changed Store invalidates the plan

- **WHEN** the Store head commit, a source file, the mapping file, a plan input, a generated-file expectation, or the Store metadata changes between planning and applying
- **THEN** applying SHALL fail as stale and SHALL NOT write, move, or delete anything
- **AND** it SHALL NOT silently re-resolve to a different destination or materialization set

#### Scenario: Plan state is not committed to the Store

- **WHEN** a plan and its recovery manifest exist for an in-flight migration
- **THEN** neither SHALL be located inside the Store repository or a project repository
- **AND** a routine commit in the Store SHALL NOT be able to capture them

#### Scenario: Existing plan paths remain schema version 1

- **WHEN** mapping version 1, no mapping, or another pre-existing migration input is planned without a v2-only materialization
- **THEN** the stored plan SHALL use schema version 1 and its canonical body and plan id SHALL be byte-identical to the pre-change implementation
- **AND** merely installing a v2 reader or parsing support SHALL NOT invalidate an existing token

#### Scenario: Explicit generated materialization selects plan schema version 2

- **WHEN** a mapping version 2 plan includes a `store-issue` generated tree or another explicit disposition that schema version 1 cannot represent
- **THEN** the plan SHALL use schema version 2 and include the exact materialization fields and generated bytes/digests
- **AND** apply SHALL verify the token against the v2 canonical body only

#### Scenario: Reader rejects version-shape disagreement

- **WHEN** stored plan bytes declare one schema version but contain fields belonging only to another, or declare an unknown version
- **THEN** read/apply/recovery SHALL refuse before any write with the unsupported or invalid version
- **AND** SHALL NOT guess, upgrade, or recompute a replacement plan id

### Requirement: Migration applies only when every item resolves

Applying SHALL be refused unless every inventoried item has a valid resource classification and materialization and no item is unresolved or blocked. The refusal SHALL list every item with its reason and exact mapping entry or repair. There SHALL be no override flag and no partial or subset migration. A destination root or path claimed by any copy-tree or generated-tree SHALL block if it exists, case-folds or canonicalizes to another claimant, aliases a file/directory conflict, or appears after planning; migration SHALL NOT overwrite, merge, or rename around it.

A Store worktree with tracked modifications or staged changes on plan sources SHALL block. Untracked files inside a `copy-tree` SHALL retain the existing report-and-explicit-acknowledgement contract because those bytes are copied. Every untracked or ignored file, directory, symlink, junction, or other non-Git entry below a `generated-tree` source SHALL block unconditionally even with `--include-untracked`, because the source is not copied and those bytes cannot be restored from source HEAD after retirement.

#### Scenario: One unresolved item blocks the whole run

- **WHEN** every item but one resolves and one Change has neither project ownership nor an explicit Store Issue classification
- **THEN** applying SHALL refuse, naming that item and its reason
- **AND** no partition, Issue tree, catalog, or receipt SHALL be written

#### Scenario: Same-named Changes from two projects do not clobber

- **WHEN** two projects each own a Change with the same alias
- **THEN** both SHALL resolve to destinations in their own project partitions
- **AND** neither SHALL be renamed, merged, or reported as a collision

#### Scenario: An existing destination is never overwritten

- **WHEN** a computed project or Issue destination path already exists
- **THEN** the item SHALL block, naming both paths or claimants
- **AND** the existing content and every legacy source SHALL remain byte-identical

#### Scenario: Dirty sources block and untracked files are acknowledged

- **WHEN** a copy-tree plan source has tracked modifications, or contains untracked files and no acknowledgement was given
- **THEN** applying SHALL refuse, listing the affected paths and which class each falls into

#### Scenario: Untracked acknowledgement cannot authorize generated-source data loss

- **WHEN** a generated-tree coordinator source contains an untracked or ignored entry and the operator supplies `--include-untracked`
- **THEN** migration SHALL remain blocked with the affected Store-relative paths or a bounded summary and repair
- **AND** neither publication nor retirement SHALL discard or relocate that entry

#### Scenario: Issue destinations are unique across canonical aliases

- **WHEN** two Issue ids, a case-fold alias, a symlink/junction alias, or a file-versus-directory path resolves to the same destination root
- **THEN** planning SHALL block the complete migration and name every claimant
- **AND** no force or alternate spelling SHALL bypass the collision

### Requirement: Migration stages, publishes atomically, retires separately, and recovers

Applying SHALL copy each `copy-tree` and write each `generated-tree` exact file inventory into staging inside the Store worktree, while `retain` performs no staged write and every source stays intact. Verification SHALL compare per-file/recursive digests, strict UTF-8 and BOM rules, catalog/metadata/Issue/Execution Plan schemas, Change identity re-derivation, exact generated inventory, and containment before publication.

For a plan containing generated Issues, apply SHALL strictly load the frozen plan without writing, derive the deduplicated canonical `(storeUid, issueId)` key set for every generated root, acquire all keys in stable ascending canonical byte order through the existing Issue-lock abstraction, and only then acquire the owner-aware Store/ref migration-run lock. The complete Issue batch and run lock SHALL be held before the first generated-destination precondition revalidation and through staging, prepared-operation persistence, generated publication, receipt, layout flip, staging cleanup, and the final durable publication manifest. A plan without generated Issues SHALL retain the existing run-lock-only path. No path SHALL take an Issue key after taking the migration-run lock.

Publication SHALL make recovery intent durable before every mutation. Before an in-place catalog or metadata replacement it SHALL durably record the exact preimage. Before each destination rename it SHALL verify the destination precondition and persist a `prepared` operation containing the migration run identity, operation identity and kind, canonical destination, staged/source identity, expected absence, and expected recursive digest. Only then MAY it rename. After rename it SHALL verify the destination digest and durably mark that operation `published`/completed before starting another operation. Publication order SHALL be project catalog upgrades, target-line catalogs, project copy outputs, generated Issue roots, receipt, and finally the layout-version-2 declaration as the reader switch point.

Resume after process restart SHALL strictly reload the same versioned plan and recovery manifest, reacquire the same canonical Issue batch before the migration-run lock, and reconcile every prepared operation from its durable identity, staged/destination presence, and planned digest while those locks remain held. Staged-present/destination-absent MAY retry rename. Staged-absent/destination-present with the exact expected digest SHALL be recognized as the after-rename result of that prepared run and marked completed. A completed operation MAY be skipped only while its digest still matches. Both-present, unrecorded, run-identity mismatch, or digest mismatch SHALL block and SHALL NOT be repaired by deletion or overwrite.

Rollback before retirement SHALL reacquire the same Issue-batch-before-migration-run order, remove only a completed destination or an after-rename prepared destination whose run identity and exact digest prove this run created it, and restore only durable recorded preimages. It SHALL persist the rolled-back or failed manifest before releasing the inner run lock and then the Issue batch in reverse order. Unknown, unrecorded, or mismatched content SHALL never be deleted. Removing flat sources SHALL remain a separate idempotent step that requires completed publication for the same Store/ref and removes only explicit retirement paths. After retirement rollback SHALL refuse and name Git recovery. Failures SHALL leave either the intact authoritative flat state with durable recovery evidence or one complete v2 state, never an unsupported mixed truth.

#### Scenario: Failure before the layout flip leaves the old Store intact

- **WHEN** copying, verification, a prepared-operation write, rename, or completion-mark write fails before the layout flip
- **THEN** the flat Store SHALL remain completely readable and authoritative
- **AND** any destination reached by the interrupted run SHALL remain covered by a durable operation that resume or rollback can reconcile without treating it as complete by pathname alone

#### Scenario: The layout flip is the switch point

- **WHEN** publication completes
- **THEN** the Store metadata SHALL declare layout version 2 only after every partition, complete generated Issue root, catalog, and receipt is in place
- **AND** readers before the flip SHALL have seen the intact flat layout

#### Scenario: Retirement is a separate step

- **WHEN** publication has completed and the operator has committed it
- **THEN** removing the flat tree SHALL be a separate command producing its own commit suggestion
- **AND** it SHALL refuse to run when no completed publication is recorded for that ref

#### Scenario: Rollback removes only what this run created

- **WHEN** an interrupted run is rolled back before retirement
- **THEN** only destinations whose durable operation proves this run and whose bytes still match the planned digest SHALL be removed, and previous Store metadata/catalog bytes SHALL be restored
- **AND** no pre-existing, unrecorded, unknown, or mismatched Store content SHALL be deleted or modified

#### Scenario: Prepared intent is durable before rename

- **WHEN** publication is about to rename a project tree, generated Issue root, catalog file, or receipt into a new destination
- **THEN** its prepared operation with run identity, destination precondition, and expected digest SHALL be durable before rename is invoked
- **AND** another operation SHALL NOT begin until rename is verified and this operation is marked completed

#### Scenario: Resume reconciles a crash immediately after rename

- **WHEN** the process terminates after rename succeeds but before the completion mark and a fresh process resumes the same run
- **THEN** recovery SHALL identify the destination only from the prepared run identity plus the exact planned digest, mark it completed, and continue without a duplicate rename
- **AND** SHALL NOT require the vanished staging path to pretend rename never occurred

#### Scenario: Rollback reconciles a crash immediately after rename

- **WHEN** the process terminates after rename succeeds but before completion marking and a fresh process rolls the run back
- **THEN** rollback SHALL remove the destination only if the prepared operation and current digest prove this run created it
- **AND** a missing, both-present, unrecorded, or mismatched destination SHALL be a non-destructive recovery blocker

#### Scenario: Mismatched content is never deleted during recovery

- **WHEN** a prepared or completed destination contains bytes whose recursive digest differs from the operation expectation
- **THEN** resume and rollback SHALL refuse with the run, operation, path, expected digest, and actual digest
- **AND** SHALL leave those bytes untouched for explicit human recovery

#### Scenario: Generated output verification fails before publication

- **WHEN** a generated Issue record or plan is corrupt, non-canonical, outside the Store, digest-mismatched, or invalid under the existing Issue contracts
- **THEN** staging verification SHALL fail before any destination or layout declaration is published
- **AND** every Store and member-project source SHALL remain byte-identical

#### Scenario: Retirement is idempotent and path-bounded

- **WHEN** retirement is retried after removing some or all plan-listed legacy sources
- **THEN** it SHALL remove only the remaining explicit retirement paths and stamp the same receipt phase once
- **AND** no generated Issue, project partition, mapping/plan input, unrelated flat path, or member-project file SHALL be removed

#### Scenario: An ordinary create that wins the Issue key makes migration refuse

- **WHEN** ordinary Issue create acquires the shared Issue key and creates the planned destination after preview but before migration acquires its canonical batch
- **THEN** migration SHALL wait, then fail its first generated-destination revalidation after acquiring the batch and run lock
- **AND** it SHALL leave the created Issue, every legacy source, and every other Store byte unchanged

#### Scenario: Issue mutations write nothing at publication barriers

- **WHEN** deterministic interleaving pauses migration after the generated precondition, prepared write, rename, completion mark, receipt, or layout flip while the Issue batch is held and starts ordinary create, state, and plan mutations
- **THEN** every mutation SHALL remain lock-blocked or return the existing bounded lock diagnostic and SHALL write no Issue byte
- **AND** the generated destination SHALL continue to match the immutable plan and receipt digests at every protected barrier

#### Scenario: Queued mutations observe the canonical tree only after durable completion

- **WHEN** migration has flipped the layout but has not yet persisted the final publication manifest and ordinary Issue mutations are queued on its held keys
- **THEN** those mutations SHALL remain unable to write until the final manifest proves the exact generated bytes and receipt and all migration locks are released
- **AND** queued create SHALL then refuse the existing Issue while queued state or plan publication SHALL read the canonical live tree and may change only the resource permitted by its normal contract

### Requirement: Layout migration upgrades membership records and records provenance in a committed receipt

Migrating a Store to layout v2 SHALL convert each per-project membership record into a v2 project catalog, carrying project identity, display id, remote, knowledge bundle, and roles, and blocking when a value cannot satisfy the stricter contract. Planning binding SHALL derive only from adoption evidence or a proven pointer-without-local-planning binding, never membership alone. Adoption name lists SHALL be dropped from the catalog and preserved in a committed deterministic UTF-8 receipt without BOM.

For plan schema/version-1 project-copy migrations, receipt schema version 1 and its interpretation SHALL remain readable and unchanged. A migration using v2-only conversion materialization SHALL write a strict receipt schema version 2. Readers SHALL dispatch by declared receipt version, reject unknown/invalid versions as incomplete evidence, and never rewrite an old receipt. Receipt v2 SHALL preserve all existing project-item, minted-identity, dropped-adoption, legacy Archive, shared-spec, retained-doc, superseded-evidence, target-line, and phase facts, and SHALL additionally record the mapping schema/path/digest and each conversion's source lifecycle/alias/path/digest, classification evidence, generated Issue id/state/reason/state-nature, `acceptanceEvidence: unproven` for terminal imports, exact output roles/digests, and optional plan-input path/digest.

Per-item `owner` and project destination SHALL be required only for project materialization. A generated Store Issue SHALL instead record its independent generated destination and source-to-generated provenance with owner/target line not applicable. The source revision SHALL explicitly carry `repositoryKind: store` and `role: planning-source`; Store HEAD SHALL never be emitted as a member `codeCommit`. Receipt state SHALL remain immutable historical migration evidence and SHALL never override live Issue records, plan revisions, Change ownership, or Archive finalization.

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
- **THEN** the committed receipt SHALL reconstruct every item's classification/materialization, applicable owner, evidence, source, and destination without re-running inventory
- **AND** it SHALL contain the dropped adoption lists, old-alias-to-instance mappings, and generated conversion provenance appropriate to its version

#### Scenario: Terminal import is asserted but acceptance is unproven

- **WHEN** an archived coordinator is imported as `resolved` or `dropped`
- **THEN** receipt version 2 SHALL record the declared state, rationale, mapping source, and asserted nature
- **AND** SHALL record that archive placement, child state, ship log, Store commit, Issue acceptance, and Dispatch completion were not proven by migration

#### Scenario: Store and member commits cannot be confused

- **WHEN** a receipt records the source revision for a coordinator conversion
- **THEN** its provenance SHALL identify the Store planning repository and source role
- **AND** no field SHALL present that object id as a member project's code commit or delivery proof

#### Scenario: Version 1 receipt remains readable

- **WHEN** status, doctor, recovery, or archive compatibility encounters an existing valid version 1 receipt
- **THEN** it SHALL retain the pre-change interpretation without mutation
- **AND** absence of version 2 conversion evidence SHALL NOT prove that an alias became an Issue

#### Scenario: Receipt cannot change live Issue state

- **WHEN** receipt state evidence disagrees with a later canonical Issue record or plan revision
- **THEN** live Issue commands and queries SHALL use the canonical Issue resources
- **AND** the receipt SHALL remain historical evidence rather than an update source

#### Scenario: Git provenance restores the retired source

- **WHEN** an operator inspects a converted coordinator after retirement
- **THEN** the receipt SHALL provide Store identity/ref, source HEAD, Store-relative source path, and recursive digest sufficient to retrieve and verify tracked bytes from Git
- **AND** SHALL NOT identify that Store object id as a member code commit

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

`rasen doctor`, `rasen store doctor`, planning, status, and recovery diagnostics SHALL report layout-migration health: refs that still carry flat content; a v2 Store with residue; unfinished, failed, or unreconciled operations for this Store/ref; items with absent/conflicting classification or ownership; unresolved shared specs; missing catalogs/partitions; legacy-schema Archive entries; retained Store-level design docs; invalid mapping-v2 unions; unsafe plan input; generated-source non-Git bytes; generated-output validation/collision; receipt version/evidence failures; and run-identity/digest recovery mismatches. Each finding SHALL carry a stable code, affected Store-relative ref/item/path, and copy-pasteable repair or continuation. A missing optional Issue plan SHALL be non-blocking and SHALL report `no plan supplied; no nodes invented` plus the existing Issue plan command. Human and JSON SHALL report equivalent codes, facts, and actions.

Diagnostics SHALL write nothing, contact no network, repair nothing, infer no owner/Issue/state/acceptance, and remain path-safe across native Windows/POSIX spellings, case-folding filesystems, long/non-ASCII paths, symlinks, and junctions. Canonical containment SHALL prevent aliases escaping the Store or claiming a second destination.

#### Scenario: A flat Store is diagnosed with its migration command

- **WHEN** doctor inspects a Store whose refs still carry flat planning content
- **THEN** it SHALL report each such ref with the command that migrates it

#### Scenario: A half-migrated Store is distinguished from a flat one

- **WHEN** a Store declares layout v2 but still holds flat planning content
- **THEN** doctor SHALL report the residue and the incomplete run distinctly from an unmigrated flat Store

#### Scenario: Unresolved ownership is visible before anyone plans a migration

- **WHEN** doctor inspects a flat Store whose items have absent or conflicting ownership/classification evidence
- **THEN** it SHALL report the count and affected items without producing a plan

#### Scenario: Diagnosis writes nothing

- **WHEN** any migration diagnostic is reported
- **THEN** no file under the Store, a project repository, or the machine data directory SHALL be modified

#### Scenario: Human and JSON output agree

- **WHEN** any coordinator refusal, recovery mismatch, or no-plan continuation is rendered in human and JSON modes
- **THEN** both modes SHALL contain the same stable code, affected item/path, and repair or continuation command
- **AND** neither SHALL imply that a missing plan, archived child, receipt, or Store commit proves Issue completion

#### Scenario: Windows and POSIX aliases resolve to one safe destination

- **WHEN** equivalent drive-letter, separator, case, symlink, junction, or POSIX spellings address a mapping input, plan input, source, or Issue destination
- **THEN** containment and no-clobber SHALL resolve them against one Store boundary and canonical destination
- **AND** an escape or collision SHALL block before any write

#### Scenario: Long non-ASCII paths preserve exact bytes

- **WHEN** valid tracked coordinator content or a plan input uses a long path or non-ASCII filename on a supported platform
- **THEN** planning, digest verification, receipt recording, Git recovery, and retirement SHALL preserve the exact path and bytes
- **AND** generated text SHALL remain strict UTF-8 without BOM, U+FFFD, or mojibake

### Requirement: Optional Issue plan input is explicit and disposable

A mapping-version-2 `store-issue` declaration MAY name one plan-input file inside the Store worktree. The input SHALL be tracked, byte-identical across Store HEAD/index/worktree, strictly decoded as UTF-8 without BOM or replacement characters, bound into the immutable migration plan by Store-relative path and digest, and revalidated before the first write. It SHALL author at most one existing Execution Plan revision version 1 and SHALL NOT introduce another runtime Issue plan schema.

The input MAY use a migration-only `sourceChange` selector for an active source item that the same immutable migration plan resolves as `project-change` with one canonical Change instance. The node SHALL still declare project and target line, compilation SHALL verify both against the planned identity, and SHALL replace only the selector with canonical `changeInstanceId`. No generated resource, receipt-owned live reference, query, or later command SHALL resolve by `sourceChange`.

#### Scenario: Clean plan input produces revision 0001

- **WHEN** a `store-issue` declaration supplies a tracked clean in-Store plan input whose nodes and dependencies validate
- **THEN** migration SHALL generate exactly one standard `plans/0001.yaml` with canonical digest and null supersedes
- **AND** re-planning with unchanged inputs and clock SHALL produce byte-identical generated content

#### Scenario: Missing plan invents no nodes

- **WHEN** a `store-issue` declaration supplies no plan input
- **THEN** migration SHALL generate only the Issue record and report `no plan supplied; no nodes invented`
- **AND** SHALL provide `rasen store issue plan <issue-id> --store <store-id> --from-file <path>` as the follow-up

#### Scenario: Same-migration Change selector compiles away

- **WHEN** a plan-input node names `sourceChange`, project, and target line for an active item the same plan materializes as a matching project Change
- **THEN** the generated revision SHALL contain canonical `changeInstanceId`, project, and target line
- **AND** neither the selector nor alias-based runtime resolution SHALL remain

#### Scenario: Unsafe source selector blocks the whole plan

- **WHEN** `sourceChange` is absent, ambiguous, archived, classified as Issue, lacks canonical planned identity, or disagrees with declared project/target line
- **THEN** migration SHALL block naming the selector and correction
- **AND** SHALL NOT downgrade it to intent or choose by ref order, path proximity, or name similarity

#### Scenario: Dirty or external input is refused

- **WHEN** plan input is outside the Store, untracked, ignored, modified, staged differently, moved, has BOM, U+FFFD, or invalid UTF-8
- **THEN** planning or apply revalidation SHALL refuse it with path and repair
- **AND** no Issue or project output SHALL be staged

