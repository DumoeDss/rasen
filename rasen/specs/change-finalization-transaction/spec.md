# change-finalization-transaction Specification

## Purpose
Wraps the existing Archive transaction engine with target-line-scoped Archive v2 records:
destination override, accounting writers, journal phases, resume tables, and suffix-aware
name matching. The transaction is the atomic unit that publishes an Archive entry and its
spec-sync actions (or records a passive outcome with no spec changes).
## Requirements
### Requirement: Finalization is planned immutably and applied from a revalidated token

Finalizing a Change SHALL be a two-step operation. Planning SHALL be read-only and total: it SHALL resolve the scope, the frozen identity, the outcome, the successor, the reachability proof, the destination, the spec actions, the record draft, and the evidence inventory, and SHALL report every unsatisfied precondition rather than stopping at the first. The plan SHALL be an immutable value whose identifier is derived from its canonical serialization, and that serialization SHALL cover both the finalization decision and the underlying archive transaction, so a change to either invalidates the identifier. Applying SHALL consume only the token and SHALL re-read no working directory, no current branch, and none of the selectors that produced the plan. Before its first write, applying SHALL revalidate the planning worktree's checked-out ref and commit, the target line's code ref commit and the reachability proof, the target-line catalog text, every canonical-spec target digest, the destination's non-existence, the Change source fingerprint, and the successor evidence, aborting with a stale-plan diagnostic on any mismatch. A stale plan SHALL be invalidated rather than repaired. Plans SHALL live in the machine data directory and SHALL NOT be written into either Git repository.

#### Scenario: Planning writes nothing and reports every problem

- **WHEN** a finalization plan is produced for a Change with several unsatisfied preconditions
- **THEN** the plan SHALL list every one of them with its values
- **AND** no file under either repository or the machine data directory SHALL be created or modified

#### Scenario: Equal inputs produce an identical plan

- **WHEN** the same scope, Change, outcome, and repository state are planned twice with no intervening change
- **THEN** both plans SHALL serialize identically and carry the same plan identifier

#### Scenario: A moved code ref invalidates the plan

- **WHEN** the target line's code ref moves between planning and applying
- **THEN** applying SHALL abort with a stale-plan diagnostic naming the ref and both commit identifiers
- **AND** no spec SHALL be written and no Change directory SHALL move

#### Scenario: Apply consumes only the token

- **WHEN** a stored plan is applied after the invoking directory and selectors have changed
- **THEN** the applied result SHALL be the one the plan froze
- **AND** the current directory and selectors SHALL NOT influence the outcome, the destination, or the spec actions

### Requirement: Archive v2 entries are addressed by stable target line and verified Change instance

A Store v2 finalization SHALL publish its entry below the project partition's stable target-line Archive directory, under a name carrying the archive date, the Change alias, and a suffix derived from the verified Change-instance identity. The address SHALL be produced by the layout contract from validated semantic identifiers, never composed by string concatenation, and SHALL be containment-checked against the project partition on both Windows and POSIX path semantics. Two attempts differing only in Change instance SHALL address different entries, and neither SHALL overwrite the other by construction. Publication SHALL remain no-clobber: an occupied destination SHALL refuse rather than merge into or replace it.

#### Scenario: A same-day retry cannot overwrite its predecessor

- **WHEN** two attempts share a project, target line, Change alias, and archive date but carry different verified Change instances
- **THEN** their published addresses SHALL differ by instance suffix
- **AND** neither SHALL overwrite the other

#### Scenario: Two release lines file separately

- **WHEN** the same Change alias is finalized on two different stable target lines
- **THEN** each entry SHALL be published below its own target-line Archive directory
- **AND** neither address SHALL contain the other line's identifier

#### Scenario: An occupied destination refuses

- **WHEN** the computed entry address already exists
- **THEN** publication SHALL refuse naming the path
- **AND** the existing entry, the active Change, and every canonical spec SHALL be unchanged

### Requirement: The finalization record is produced from verified identities or refused

A Store v2 finalization SHALL write an Archive v2 record built from a Change-instance identity re-derived and verified from committed Change metadata and a workspace-pair identity obtained from the verified binding. When either cannot be obtained verified, finalization SHALL refuse and SHALL NOT mint, guess, or substitute a well-formed placeholder to make the record validate. The record SHALL be validated before anything is written and serialized through the canonical self-verifying serializer, so an inconsistent draft produces no file. Evidence entries SHALL be portable relative paths with lowercase digests satisfying the record contract's uniqueness and traversal rules on both path flavors.

#### Scenario: An unavailable workspace pair refuses rather than being minted

- **WHEN** the verified workspace pair for the Change cannot be obtained
- **THEN** finalization SHALL refuse naming the missing identity
- **AND** no pair identifier SHALL be derived from a path, an alias, or a placeholder

#### Scenario: An inconsistent draft produces no file

- **WHEN** a draft record would combine a passive outcome with an applied spec action, or a landed outcome with an unproven reachability fact
- **THEN** serialization SHALL fail
- **AND** no record file SHALL be created at the destination

#### Scenario: The written record round-trips

- **WHEN** a finalization completes
- **THEN** the published record SHALL parse back to the same validated value that was planned
- **AND** its evidence digests SHALL match the published evidence tree

### Requirement: The v2 record and the legacy accounting record are dispatched, never sniffed

Both the Archive v2 record and the existing accounting record SHALL be written under the same file name, and which one is written SHALL be decided from the Store's declared layout and the plan's recorded scope, never by inspecting an existing file's content or by matching a path substring. A standalone project and a legacy flat Store SHALL keep the existing record unchanged. An entry relocated from a legacy layout SHALL be left byte-identical: it SHALL NOT be upgraded, rewritten, wrapped, or validated against the v2 contract, and no outcome, target line, or workspace pair SHALL be fabricated for it.

#### Scenario: Scope decides the record schema

- **WHEN** the same Change content is archived once in a standalone project and once in a Store v2 project scope
- **THEN** the standalone entry SHALL carry the existing accounting record
- **AND** the Store v2 entry SHALL carry the Archive v2 record

#### Scenario: A relocated legacy entry is never upgraded

- **WHEN** a Store v2 partition holds Archive entries relocated from a legacy flat layout
- **THEN** finalizing a new Change SHALL leave every legacy entry byte-identical
- **AND** no legacy record SHALL be read, validated, or rewritten to satisfy the v2 contract

### Requirement: Association completion is a phase of the transaction

The binding's terminal state SHALL be a recorded phase of the finalization transaction, ordered after the record is durable and before the active Change directory is removed, and the transaction SHALL NOT report completion until it lands. The phase SHALL record the outcome, published entry address, and archive timestamp in the machine workspace binding, and SHALL mark the execution-side association's Change as finalized so a later mutation from that checkout does not resolve an archived Change as active. It SHALL NOT modify the planning-worktree marker, remove a worktree, or delete a branch.

Planning a non-noop pair SHALL unconditionally derive and freeze its execution-association path from the admitted execution root. If the association document is absent, planning SHALL report a pre-mutation `planning_execution_binding_mismatch` blocker and SHALL NOT produce an applicable saved transaction. Association/index agreement SHALL compare the immutable Store, scope, Change, pair, root, repository, and worktree identities; cached branch and head projections SHALL NOT redefine the pair. Applying SHALL still validate live Git membership, refs, and heads against the facts frozen by the plan. A missing index entry SHALL be repaired from the frozen pair plus live Git; a disagreeing entry SHALL fail closed with the published entry retained and the journal naming the phase. A scope with no workspace pair SHALL make the phase an explicitly planned no-op.

Association and index writes SHALL use the shared workspace atomic-write authority. An unjournaled exact intent may resume only the independently requested target, bytes, and before-state. A journal-bound call SHALL require its exact recorded carrier authority and SHALL NOT fall back. Every cleanup and tolerated directory-durability outcome SHALL retain the workspace module's identity revalidation contract on Windows, macOS, and Linux.

#### Scenario: A crash before the phase resumes and completes

- **WHEN** the transaction is interrupted after the record is durable and before the binding is updated
- **THEN** the transaction SHALL NOT report completion
- **AND** re-applying the same token SHALL complete the phase rather than duplicating any earlier step

#### Scenario: A disagreeing binding fails closed and stays recoverable

- **WHEN** the recorded binding names a different Change instance or a worktree that is no longer one of the recorded repository's worktrees
- **THEN** the phase SHALL fail closed naming both values
- **AND** the published entry SHALL remain and the journal SHALL identify the unfinished phase

#### Scenario: No workspace pair is a planned no-op

- **WHEN** the scope has no workspace pair, no binding entry, and no markers
- **THEN** the plan SHALL declare the phase a no-op in advance
- **AND** applying SHALL complete without writing a binding

#### Scenario: Ordinary commits before planning preserve pair identity

- **WHEN** either worktree receives a normal commit after binding but before finalization planning
- **THEN** planning freezes the current live ref and head while preserving the same immutable workspace pair
- **AND** applying that unchanged plan SHALL not fail after publication merely because the index cached an older head

#### Scenario: Git movement after planning remains stale

- **WHEN** a frozen worktree ref or head moves after finalization planning and before a fresh apply
- **THEN** apply SHALL refuse the stale plan before its first mutation
- **AND** it SHALL NOT repair the live Git fact from the older index projection

#### Scenario: Missing association blocks before transaction persistence

- **WHEN** a bound pair's derived execution association document is absent during planning
- **THEN** the non-applicable plan SHALL freeze the expected path and report `planning_execution_binding_mismatch`
- **AND** no transaction-store plan, canonical spec, archive entry, or association mutation SHALL be created

#### Scenario: Exact self-contained association intent resumes

- **WHEN** an unjournaled association/index write finds the exact durable intent for the independently requested target, bytes, and stable before-state
- **THEN** it SHALL establish or resume the proved claim, publish without clobbering, and clean only carriers whose identities are revalidated
- **AND** a different target, bytes, state, or replaced carrier SHALL remain intact and be refused

#### Scenario: Journal-bound association write never falls back

- **WHEN** association recovery supplies recorded external carrier authority that disagrees with a retained self-contained claim
- **THEN** the write SHALL retain the evidence and fail with the workspace conflict
- **AND** it SHALL NOT adopt the claim through the unjournaled recovery path

### Requirement: Finalization serializes on semantic scope and Change locks

Finalization SHALL serialize on owner-aware machine-local locks keyed by semantic scope and instance rather than by Change alias: a scope lock over Store, project, and target line, and a Change lock over the Change instance. They SHALL be acquired in the established fixed order. Two finalizations of one Change instance SHALL be mutually exclusive; finalizations in different projects or on different target lines SHALL proceed concurrently. Contention SHALL retry within a bounded deadline and then report the recorded holder; a semantic conflict SHALL NOT be retried; a Git-level lock failure SHALL surface as itself and SHALL NOT be resolved by removing a lock file. Because this capability performs no write into a Store integration ref, the integration lock SHALL NOT be taken here, and the first operation that merges into an integration ref SHALL take it.

#### Scenario: One Change instance finalizes once at a time

- **WHEN** two processes finalize the same Change instance concurrently
- **THEN** exactly one SHALL proceed and the other SHALL report the recorded holder
- **AND** no partially published entry SHALL exist

#### Scenario: Two target lines finalize concurrently

- **WHEN** two Changes on different target lines of one Store finalize at the same time
- **THEN** both SHALL proceed without waiting on each other
- **AND** neither SHALL observe the other's canonical-spec writes

#### Scenario: A semantic conflict is not retried

- **WHEN** finalization fails on a mismatched target line, an unreachable commit, or a disagreeing binding
- **THEN** it SHALL report immediately
- **AND** it SHALL NOT re-attempt the same operation within a retry loop

### Requirement: Every finalization surface consumes one plan contract

Direct command-line finalization, bulk finalization, in-ship finalization, and the management finalization endpoint SHALL each produce their decision through the same plan contract, and given identical inputs their canonically serialized plans SHALL be identical. No surface SHALL move a Change directory, write a canonical spec, compose an entry address, or hand-write a record itself. The management endpoint SHALL mutate only by spawning the command-line interface, SHALL require the complete scope explicitly, and SHALL NOT complete a missing scope field from a filter, a session, or a previously viewed selection. A batch SHALL require its own explicit outcome per Change and SHALL NOT infer one from a sibling.

#### Scenario: Four surfaces produce one plan

- **WHEN** direct, bulk, in-ship, and endpoint finalization are driven with identical inputs
- **THEN** their canonically serialized plans SHALL be byte-identical
- **AND** each SHALL carry the same plan identifier

#### Scenario: A batch never borrows an outcome

- **WHEN** a bulk finalization includes a Change with no declared outcome
- **THEN** the batch SHALL refuse naming that Change
- **AND** no member's outcome SHALL be applied to another

#### Scenario: The endpoint infers no scope

- **WHEN** a finalization request omits the Store, project, target line, or Change instance
- **THEN** the endpoint SHALL reject it
- **AND** it SHALL NOT complete the missing field from a filter or a prior selection

### Requirement: An Archive is passive history and is never replayed

Reading, listing, showing, indexing, or aggregating an Archive entry SHALL change no canonical spec, and no code path outside applying a landed finalization SHALL apply a delta spec to a canonical spec. A checkout, a Git merge, an index rebuild, or a cross-project aggregation that brings an Archive entry into a target line SHALL add audit history only. A non-landed entry that reaches another line by any means SHALL still apply nothing.

#### Scenario: Reading an archive changes nothing

- **WHEN** landed and passive Archive entries are listed, shown, and aggregated
- **THEN** every canonical spec SHALL remain byte-identical
- **AND** no delta SHALL be parsed for application

#### Scenario: A merged passive entry applies nothing

- **WHEN** a passive Archive entry is brought into another target line by an ordinary Git merge
- **THEN** it SHALL contribute audit history only
- **AND** no canonical spec SHALL be created, updated, or deleted as a result

### Requirement: Archive recovery proves cleaner deletion ownership losslessly
An archive plan SHALL bind every planned cleaner deletion to lossless file identity and content authority captured from the opened file. Apply and exact-token recovery SHALL validate the complete authority collection before interpreting cleaner progress or absence. The source SHALL prove the complete plan-time identity immediately before claim; when rename changes platform metadata, the engine SHALL verify a rename-stable transition and bind the private claim to the complete post-rename identity before deletion. Rounded numeric identity SHALL NOT authorize either boundary.

#### Scenario: Unchanged Windows candidate reaches the planned late phase
- **WHEN** a Windows file identifier cannot be represented exactly as a JavaScript number and the planned cleaner candidate remains unchanged
- **THEN** apply accepts its lossless authority, accounts for the deletion, and continues to the planned accounting or source-removal operation

#### Scenario: Source-removal fault is not masked by cleaner identity rounding
- **WHEN** a transaction with unchanged planned cleaner candidates injects a failure at source removal
- **THEN** the recoverable result reports the injected source-removal operation and error rather than `archive_cleaner_ownership_unverified`
- **AND** applying the exact token after the injected fault is removed resumes and completes the transaction

#### Scenario: Replaced cleaner candidate fails closed
- **WHEN** a planned cleaner candidate is replaced or its exact identity or content changes before deletion
- **THEN** apply refuses cleaner ownership, retains recovery evidence, and leaves the unproved object undeleted

#### Scenario: Same bytes with changed exact metadata fail closed
- **WHEN** a candidate keeps the planned bytes, device, inode, mode, and size but its exact timestamps change before claim, or its complete identity changes after the verified rename transition
- **THEN** apply refuses cleaner ownership and retains the candidate or private claim for manual recovery

#### Scenario: Verified claim restoration remains exactly replayable
- **WHEN** a cleaner attempt fails after the engine-owned claim and the engine safely restores the same object through a no-replace name transition
- **THEN** the journal records the complete restored identity
- **AND** exact-token retry uses that identity rather than weakening the original plan predicate or trusting later absence

#### Scenario: Legacy delete plan without exact authority is retained
- **WHEN** a stored legacy plan requests cleaner deletion but contains no trustworthy lossless deletion authority
- **THEN** apply refuses the deletion and retains the transaction for manual recovery or replanning

#### Scenario: Legacy plan with no cleaner deletion remains replayable
- **WHEN** a stored legacy plan has no effective cleaner deletion
- **THEN** the absence of cleaner deletion authority does not by itself block exact-token recovery

### Requirement: Store finalization preserves complete typed preparation blockers

Store finalization SHALL carry every `SpecReconciliationIssue` produced during archive preparation into its immutable preview and external responses with the original code, source, capability, optional requirement, optional missing-scenario list, message, and deterministic occurrence order. It SHALL produce one blocker per issue without source-wide or capability-wide deduplication. `finalization_spec_skip_conflict` SHALL be used only for an intentional spec-sync skip or decline, never as a replacement for preparation failures that happened to produce no actions.

#### Scenario: Several issues in one capability remain separate

- **WHEN** spec preparation returns several typed reconciliation issues from one source or capability, including issues for different requirements
- **THEN** the Store finalization preview SHALL contain the complete ordered issue array with every typed field unchanged
- **AND** no issue SHALL be removed because another issue shares its source or capability

#### Scenario: Failed preparation is not rewritten as a skip conflict

- **WHEN** reconciliation produces no actions because it returned typed issues
- **THEN** finalization SHALL be non-applicable with all of those issues
- **AND** it SHALL NOT replace them with `finalization_spec_skip_conflict`

#### Scenario: Intentional decline keeps the generic skip refusal

- **WHEN** a landed Change has valid preparable deltas but the operator explicitly requests or confirms skipping spec synchronization
- **THEN** finalization SHALL refuse with `finalization_spec_skip_conflict`
- **AND** the generic refusal SHALL not be used for any reconciliation failure

### Requirement: Store finalization consumes shared selection and archive recovery authority

Store finalization SHALL resolve its project through the shared canonical main-first project selection and SHALL refuse normalized registry/config identity drift or conflicting canonical aliases before planning content or transaction state is mutated. Stored apply and abort SHALL use the archive engine's cleaner deletion authority, transaction-operation lock, abort/retry phase decision, platform path identity, and plan-derived destructive operands without a finalization-specific classifier.

#### Scenario: Registry and config drift refuses finalization without side effects

- **WHEN** Store finalization selects a canonical project whose registry identity disagrees with its normalized config identity, or whose canonical alias group has conflicting live fixed metadata
- **THEN** selection SHALL fail with the established planning or registry conflict before the finalization plan is persisted
- **AND** registry, config, transaction store, canonical specs, and active Change bytes SHALL remain unchanged

#### Scenario: Finalization abort uses archive ownership semantics

- **WHEN** a stored Store finalization token is submitted for abort or retry
- **THEN** its eligibility, retained paths, destructive operands, cleaner authority, and recovery disposition SHALL be the archive engine's result
- **AND** finalization SHALL only preserve and report that result, never relax or reclassify it

