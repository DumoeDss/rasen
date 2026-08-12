# store-issue-resources Specification

## Purpose
Store-level Issue and Execution Plan resources that reference per-project ChangeInstances
across projects and target lines. An Issue is a cross-project work item whose resolution
depends on the dependency graph of its member Changes, not on a shared flat directory.
## Requirements
### Requirement: Cross-project work is a Store-level Issue that owns no Change

Work spanning more than one project SHALL be represented as a Store-level Issue that references per-project Change instances. An Issue SHALL NOT own, contain, or become the planning home of any Change, SHALL NOT cause a Change to have a second owner, and SHALL NOT be a route to creating a Change with no project owner. Issue content SHALL live at the Store level and SHALL NOT be written into any project partition. Every Change an Issue references SHALL remain independently plannable, verifiable, and finalizable.

#### Scenario: One Issue spans three projects without re-parenting any Change

- **WHEN** an Issue references Changes in three different projects across two target lines
- **THEN** each referenced Change SHALL still declare exactly one project owner in its committed identity
- **AND** no Change SHALL record the Issue as an owner and no planning content SHALL be duplicated into the Issue

#### Scenario: An Issue is not a place to create an ownerless Change

- **WHEN** a caller attempts to create a Change in a Store-level Issue scope
- **THEN** creation SHALL fail because a Change requires a project and target line
- **AND** the Issue SHALL remain unchanged

#### Scenario: Issue content stays out of project partitions

- **WHEN** an Issue and its plan revisions are written
- **THEN** every written path SHALL be Store-level Issue content
- **AND** no project partition, canonical spec, Change directory, catalog, or Archive entry SHALL be created or modified

### Requirement: An Issue record is a strict portable record with an operator-declared state

An Issue SHALL be identified by a stable identifier and described by one strict, versioned record carrying its identifier, title, state, an optional reason, and its creation timestamp. The record's containing directory name SHALL agree with the identifier, and disagreement SHALL fail validation rather than preferring either side. Unknown fields, machine filesystem paths, and credentials SHALL be rejected. The state SHALL be one of `open`, `resolved`, or `dropped`; `dropped` SHALL require a non-empty reason; and a terminal state SHALL NOT transition to another state. The record SHALL NOT restate a fact that is derivable elsewhere — the containing Store, the participating projects, the plan's nodes, or the latest revision.

#### Scenario: A record with an unknown field is rejected

- **WHEN** an Issue record carries a field the schema does not define, or a local checkout path
- **THEN** strict validation SHALL reject the record
- **AND** no machine path SHALL become durable Store content

#### Scenario: Directory name and identifier must agree

- **WHEN** an Issue record's identifier differs from its containing directory name
- **THEN** validation SHALL fail naming both values
- **AND** neither value SHALL be preferred, rewritten, or renamed

#### Scenario: Dropping requires a reason and is terminal

- **WHEN** an operator sets an Issue's state to `dropped` without a reason, or sets any state on an Issue that is already `resolved` or `dropped`
- **THEN** the command SHALL refuse
- **AND** the existing record SHALL remain byte-identical

### Requirement: An Execution Plan revision is immutable and ordinal-addressed

An Issue's Execution Plan SHALL be a series of revisions addressed by a zero-padded ordinal below that Issue. A published revision SHALL NOT be edited, replaced, or removed; correcting a plan SHALL publish a new revision that records the ordinal it supersedes. Publication SHALL refuse an ordinal whose revision already exists rather than overwriting it, and each revision SHALL record the digest of its own canonical bytes so a hand-edited revision is detectable. A revision identifier SHALL be a canonical zero-padded ordinal and SHALL NOT be derived from a branch name, a date, or a directory listing order.

#### Scenario: Correcting a plan leaves the earlier revision intact

- **WHEN** an operator publishes a corrected plan for an Issue that already has two revisions
- **THEN** a third revision SHALL be written recording the second as superseded
- **AND** the first and second revisions SHALL remain byte-identical

#### Scenario: Publishing over an existing revision is refused

- **WHEN** publication would write a revision file that already exists
- **THEN** it SHALL fail with `execution_plan_revision_exists`
- **AND** the existing revision SHALL remain byte-identical

#### Scenario: A tampered revision is detectable

- **WHEN** a published revision's content no longer matches its recorded canonical digest
- **THEN** reading it SHALL report the mismatch
- **AND** the revision SHALL NOT be silently repaired or re-digested

### Requirement: A plan node names its project and target line and is either a verified reference or a declared intent

Every node of an Execution Plan revision SHALL name a project and a target line. A node SHALL be either a `change` node, which additionally carries the verified Change instance identity it references, or an `intent` node, which declares work expected in that project on that line for which no Change exists yet. A node SHALL NOT carry a directory path, a worktree root, or a branch name. A human-readable Change alias MAY be recorded on a `change` node and SHALL NOT be used to resolve anything. Node dependencies SHALL form a directed acyclic graph; a cycle, an unknown dependency target, a duplicate node identifier, or two nodes naming one Change instance SHALL be refused before the revision is written.

#### Scenario: A plan is drafted before any Change exists

- **WHEN** a revision is published whose nodes are all `intent` nodes naming member projects and declared target lines
- **THEN** publication SHALL succeed without requiring any Change to exist
- **AND** each node's project and target line SHALL be recorded so ownership is explicit from the draft

#### Scenario: An intent becomes a reference through a new revision

- **WHEN** the Change an `intent` node anticipated is created and the node is pointed at it
- **THEN** the result SHALL be a new revision carrying that node as a `change` node
- **AND** the revision that carried it as an `intent` node SHALL remain unchanged

#### Scenario: The alias never resolves anything

- **WHEN** a `change` node's recorded alias names a different Change than its Change instance identity
- **THEN** resolution SHALL follow the instance identity
- **AND** no code path SHALL select a Change by alias, directory name, or branch name

#### Scenario: A cyclic or duplicated graph is refused

- **WHEN** a revision's nodes contain a dependency cycle, a dependency on an unknown node, a duplicate node identifier, or two nodes naming the same Change instance
- **THEN** publication SHALL refuse naming the offending nodes
- **AND** no revision file SHALL be written

### Requirement: Every change reference is verified against Store evidence before a revision is published

Publishing a revision through the normal Store Issue mutation contract SHALL verify each `change` node against committed evidence: the referenced Change instance SHALL re-derive to exactly one Change in this Store, that Change's committed identity SHALL name the node's project and target line, the project SHALL have a project catalog in this Store, and the target line SHALL have a target-line catalog. Zero matches SHALL fail with `issue_reference_unresolved`; more than one SHALL fail with `issue_reference_ambiguous` listing every claimant and choosing none; a scope disagreement SHALL fail with `issue_reference_scope_conflict` naming both values; and an instance belonging to another Store SHALL be refused outright. A Store ref that cannot be read SHALL be reported as unsearched and SHALL NOT be treated as evidence of absence. An `intent` node SHALL be verified against the project and target-line catalogs only.

Layout migration MAY compile an initial revision before a same-transaction project Change is committed only when the immutable migration plan has already resolved exactly one active source as `project-change`, frozen its verified or newly minted canonical Change instance, project, and target line, and frozen the corresponding catalogs and project destination for publication in that same whole-ref transaction. A migration-only `sourceChange` selector SHALL compile to that canonical instance before Issue serialization. Missing, ambiguous, archived, Store-Issue, foreign, or scope-conflicting candidates SHALL block the whole migration. This exception SHALL NOT be available to a normal Issue write, later revision, receipt lookup, or alias-based runtime resolution.

#### Scenario: An unverifiable reference blocks the revision

- **WHEN** a `change` node names a Change instance that no Store ref and no local planning worktree can produce
- **THEN** publication SHALL fail with `issue_reference_unresolved`, naming the refs that were searched
- **AND** no revision file SHALL be written

#### Scenario: A reference naming the wrong project is refused

- **WHEN** a `change` node declares one project or target line while the referenced Change's committed identity declares another
- **THEN** publication SHALL fail with `issue_reference_scope_conflict` naming both values
- **AND** neither the node's declaration nor the Change's identity SHALL be adjusted to agree

#### Scenario: An unreadable ref is not absence

- **WHEN** one of the Store's target-line refs cannot be read while a reference is being verified
- **THEN** the ref SHALL be reported as unsearched
- **AND** publication SHALL NOT conclude that the reference is unresolved on that evidence

#### Scenario: Same-migration frozen identity is sufficient only inside that plan

- **WHEN** a migration plan compiles `sourceChange` for one active source whose `project-change` identity, project, target line, catalogs, and destination are frozen in that same immutable plan
- **THEN** the generated revision SHALL contain the canonical Change instance and SHALL be staged and published atomically with the planned Change
- **AND** no normal Issue command, later plan publication, receipt, or alias lookup SHALL reuse the migration-only proof

### Requirement: Referencing a Change never writes to it and no back-reference is stored

An Issue-to-Change edge SHALL be one-directional. Publishing, editing, or removing a reference SHALL NOT create, modify, or delete any file inside the referenced Change, its project partition, or its Archive entry, and no Change SHALL record which Issues reference it. The reverse relationship SHALL be derived at read time from the Issue set and SHALL NOT be persisted in any record, index, or cache.

#### Scenario: The referenced Change is byte-identical afterwards

- **WHEN** a revision referencing an existing Change is published
- **THEN** that Change's directory SHALL be byte-identical before and after
- **AND** no file outside the Issue SHALL be created or modified

#### Scenario: Reverse lookup is derived, not stored

- **WHEN** a caller asks which Issues reference a given Change instance
- **THEN** the answer SHALL be computed from the Issue records at read time
- **AND** no durable back-reference, index entry, or cache file SHALL exist or be written

### Requirement: An Issue write requires a Store checkout that is not bound to a Change

An Issue or revision write through the normal Store Issue mutation contract SHALL resolve a Store scope that requires no project and no target line, and SHALL land in a Store checkout that is not a planning worktree bound to a Change. A write attempted from a bound planning worktree SHALL fail with `issue_write_requires_store_checkout`, naming the checkout, the Change it is bound to, and the repair, because that worktree's branch carries one Change's unmerged line and a cross-line resource written there cannot be seen from any other line. The command SHALL report the checkout and ref it wrote to, SHALL print a pathspec-scoped commit suggestion, and SHALL stage, commit, fetch, and push nothing.

Compiling and materializing a generated Issue tree during layout migration SHALL be part of the token-authorized whole-ref migration transaction rather than a live Issue mutation. It SHALL inherit the migration's resolved Store checkout and ref, immutable plan, no-clobber checks, staging verification, recovery ledger, and commit reporting; it SHALL NOT invoke the normal create, state, or plan-publication methods or grant an Issue command permission to write from a Change-bound worktree.

#### Scenario: An Issue command needs no project

- **WHEN** an operator creates an Issue naming only the Store
- **THEN** the command SHALL succeed without a project or target-line selector
- **AND** it SHALL NOT infer, invent, or require either

#### Scenario: A bound planning worktree refuses the write

- **WHEN** an Issue write resolves a Store checkout that is a planning worktree bound to a Change
- **THEN** it SHALL fail with `issue_write_requires_store_checkout`
- **AND** nothing SHALL be written in that worktree

#### Scenario: The write is reported and left uncommitted

- **WHEN** an Issue or revision is written
- **THEN** the command SHALL name the checkout and ref it wrote to and SHALL suggest the commit pathspec
- **AND** the Git index SHALL be untouched and nothing SHALL be fetched or pushed

#### Scenario: Migration materialization is owned by the layout transaction

- **WHEN** an immutable layout-migration plan contains a generated Issue tree
- **THEN** apply SHALL stage, verify, publish, recover, and report that tree under the migration transaction for its resolved Store ref
- **AND** it SHALL NOT perform a separate live Issue write or bypass the normal Issue checkout rule for any user command

### Requirement: Issue writes serialize on a Store-level issue lock

An Issue write through the normal Store Issue mutation contract SHALL serialize on an owner-aware machine-root lock keyed by the Store identity and the Issue identifier, whose filename is a digest of the canonically serialized key material. That key SHALL be acquired before the scope, workspace, Change, and integration keys, extending the established acquisition order without altering it, and no path SHALL reach back for an earlier key while holding a later one. An Issue write SHALL take only the issue key. Contention SHALL retry within a bounded deadline and then fail naming the holder; a semantic conflict SHALL NOT be retried. A read SHALL take no lock.

The migration Issue compiler SHALL be pure and SHALL take no lock or write any file. The layout publication seam SHALL reuse the existing Issue-lock abstraction rather than implement another lock. From the strictly parsed frozen plan, apply, resume, and rollback SHALL extract every generated Issue id, validate it through the normal Issue-id parser, construct the existing `(storeUid, issueId)` lock keys in the same effective machine coordination root, deduplicate equal canonical keys, and sort them by unsigned lexicographic order of their canonical `issue-lock/v1` key bytes.

The one cross-module acquisition order SHALL be the complete ascending Issue-key batch first and the owner-aware Store/ref migration-run lock second. Layout migration SHALL NOT acquire an Issue key while holding the migration-run lock and SHALL take no scope, workspace, Change, or integration key while holding this batch. Ordinary `create`, `setState`, and `publishPlan` SHALL continue to take one Issue key and no migration-run lock. A plan with no generated Issue SHALL take no Issue key and SHALL retain migration-run-only behavior.

Batch acquisition SHALL use the same issue-key path, owner-aware acquisition, holder diagnostics, bounded contention, stale-owner policy, held-lock context, and release implementation as a single Issue write. If acquisition of key N fails, every already acquired key SHALL be released in reverse order before the failure escapes. On callback success, callback failure, failed-manifest persistence, or rollback completion, the inner migration-run lock SHALL be released first and every Issue lock SHALL then be released in reverse order from `finally`.

The complete Issue batch SHALL be held before the first generated-destination precondition revalidation and through prepared-operation persistence, destination rename, digest verification, operation completion, receipt publication, layout flip, staging cleanup, and final durable publication or rollback manifest persistence. While it is held, an ordinary Issue mutation SHALL wait under the existing bounded policy or fail with the existing lock diagnostic and SHALL write no Issue byte. A mutation that acquired the key first SHALL finish before migration revalidates; any resulting existing or changed destination SHALL make migration refuse without overwrite. After successful publication and release, `create` SHALL observe the existing canonical Issue and refuse, while `setState` and `publishPlan` SHALL read and mutate that canonical live tree through their unchanged contracts.

#### Scenario: Two Issues in one Store proceed concurrently

- **WHEN** two Issue writes for different Issues in one Store run at the same time
- **THEN** they SHALL take different keys and SHALL NOT serialize against each other

#### Scenario: A read is never blocked by a writer

- **WHEN** an Issue or aggregate read runs while another process holds the issue, scope, and Change keys
- **THEN** the read SHALL complete
- **AND** it SHALL acquire no lock of its own

#### Scenario: A semantic conflict is not retried

- **WHEN** an Issue write fails because a reference disagrees with committed identity
- **THEN** the refusal SHALL be immediate
- **AND** no bounded retry loop SHALL delay the diagnostic

#### Scenario: Pure compilation takes no Issue lock

- **WHEN** layout planning compiles standard Issue bytes for a generated tree
- **THEN** the compiler SHALL return only an in-memory file inventory and digests without acquiring a lock or writing
- **AND** only the later layout publication seam SHALL acquire the existing Issue locks and migration-run lock

#### Scenario: Canonical Issue batch precedes the migration-run lock

- **WHEN** a frozen plan contains multiple generated Issue ids in duplicate or non-canonical input order
- **THEN** publication SHALL validate and deduplicate them, acquire their existing semantic Issue keys in ascending canonical byte order, and acquire the Store/ref migration-run lock only after the complete batch
- **AND** no apply, resume, or rollback path SHALL acquire an Issue key in the reverse order

#### Scenario: Partial acquisition and exceptions release in reverse order

- **WHEN** batch acquisition fails on a later Issue key, or the protected migration callback throws after all keys are acquired
- **THEN** every acquired handle SHALL be released exactly once in reverse acquisition order, with the migration-run lock released before the outer Issue batch when it was acquired
- **AND** a later ordinary Issue command SHALL be able to acquire every released key

#### Scenario: Ordinary mutations cannot enter the publication window

- **WHEN** ordinary `create`, `setState`, or `publishPlan` targets a generated Issue after migration holds its Issue batch at any precondition, prepared, renamed, completed, receipt, or layout-flip barrier
- **THEN** that mutation SHALL write no Issue byte until the final publication manifest is durable and the locks are released
- **AND** afterwards create SHALL refuse the existing Issue while state and plan publication SHALL read the canonical migrated tree through their normal contracts

#### Scenario: Overlapping migrations and Issue commands do not deadlock

- **WHEN** two migrations with overlapping or disjoint generated Issue sets and ordinary single-Issue commands contend across one or more Store refs
- **THEN** every migration SHALL use the same canonical Issue-key order before its ref-specific run lock and every ordinary command SHALL request only one Issue key
- **AND** each operation SHALL either complete or return its bounded lock or semantic refusal without a lock cycle

### Requirement: Layout migration compiles only standard Store Issue resources

The Store layout migration MAY compile an explicitly classified legacy coordinator into one existing Issue record version 1 and, when supplied, one existing Execution Plan revision version 1. The generated resources SHALL use the same strict identities, states, text validation, graph validation, canonical serialization, and content digests as resources produced by normal Store Issue operations. The public Issue mutation and query contracts SHALL acquire no legacy-import mode, second IssueStore, coordinator index, or alternate runtime schema.

The Issue record SHALL remain repo-blind. It SHALL contain no project, target line, Pipeline, cwd, worktree, commit, legacy planning tree, acceptance result, Dispatch result, latest-plan pointer, or back-reference. Project, target line, Change references, intents, and dependencies SHALL appear only in the optional Execution Plan revision.

#### Scenario: Active coordinator becomes one open Issue

- **WHEN** layout mapping explicitly classifies an active legacy Change as a Store Issue
- **THEN** migration SHALL generate one standard Issue record in state `open`
- **AND** SHALL NOT generate a completion, acceptance, Dispatch, Pipeline, project-ownership, or Change-finalization fact

#### Scenario: Archived coordinator state is an operator declaration

- **WHEN** layout mapping explicitly classifies a legacy Archive entry as a Store Issue
- **THEN** the generated record SHALL use the explicitly declared valid Issue state
- **AND** a terminal state SHALL require a non-empty operator rationale and SHALL NOT be derived from archive placement, child archives, a ship log, or a Store commit

#### Scenario: Issue record stays repo-blind

- **WHEN** a generated Issue record is parsed or shown after migration
- **THEN** it SHALL expose only the existing Issue record fields and its containing Store identity
- **AND** project, target line, Change, DAG, cwd, commit, and legacy content SHALL be absent from that record

#### Scenario: Existing Issue commands consume the generated resources

- **WHEN** migration completes and the operator runs the existing Issue show, plan, list, or state commands
- **THEN** those commands SHALL read and mutate the generated Issue through their normal contracts
- **AND** SHALL require no receipt lookup, legacy selector, import adapter, or special runtime flag

### Requirement: Migration-authored plan revision has no legacy runtime identity

When a clean plan input is supplied, the generated revision SHALL be the Issue's immutable ordinal `0001`, SHALL record no superseded revision, and SHALL contain only standard `change` and `intent` nodes. A migration-only `sourceChange` selector SHALL be accepted only on a node that explicitly declares project and target line, SHALL be verified during compilation against the same immutable migration plan, and SHALL be absent after it resolves to a matching canonical Change instance. Without a plan input, no plans directory entry or node SHALL be invented.

#### Scenario: Migration selector disappears from revision 0001

- **WHEN** a valid plan input refers to a same-migration project Change through `sourceChange` and declares its matching project and target line
- **THEN** the stored revision SHALL carry the verified canonical Change instance, project, and target line
- **AND** parsing the serialized revision SHALL reveal no legacy selector or alias-based lookup rule

#### Scenario: Intent remains explicit

- **WHEN** a plan input contains an intent node for work not yet represented by a Change
- **THEN** the generated revision SHALL record the node's explicit project, target line, summary, and dependencies
- **AND** SHALL NOT create a Change, select a repository, or infer a target from the coordinator tree

#### Scenario: No input means no execution graph

- **WHEN** migration generates an Issue without a plan input
- **THEN** the Issue SHALL have no published revision and no derived nodes
- **AND** a later existing plan command MAY publish revision `0001` independently

#### Scenario: Referenced Change remains independently owned

- **WHEN** a migration-generated revision references a Change created by the same layout migration
- **THEN** that Change SHALL retain exactly one project owner and its own target line, planning home, Pipeline, validation, and finalization lifecycle
- **AND** Issue generation SHALL write no back-reference or other byte into the Change or its member code repository

### Requirement: Migration history does not govern live Issue lifecycle

The migration receipt MAY explain how an Issue record and initial plan were produced, but live Issue state, revisions, references, and later transitions SHALL remain authoritative only in the standard Issue resources. A terminal historical import records an operator assertion at conversion time and SHALL NOT be treated as proof that future Issue acceptance, delivery, or reconciliation gates ran.

#### Scenario: Later state is read from issue.yaml

- **WHEN** a canonical Issue record changes after migration while its receipt remains unchanged
- **THEN** Issue queries and commands SHALL report the canonical record
- **AND** SHALL NOT restore or override state from the receipt

#### Scenario: Migration does not shortcut future acceptance

- **WHEN** a terminal historical Issue is displayed by a future consumer that understands acceptance or Dispatch artifacts
- **THEN** the consumer SHALL see migration's state as an asserted historical state with no proven acceptance or Dispatch completion
- **AND** SHALL NOT fabricate the missing artifacts from Change archives or receipt provenance

