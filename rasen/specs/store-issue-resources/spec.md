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

Publishing a revision SHALL verify each `change` node against committed evidence: the referenced Change instance SHALL re-derive to exactly one Change in this Store, that Change's committed identity SHALL name the node's project and target line, the project SHALL have a project catalog in this Store, and the target line SHALL have a target-line catalog. Zero matches SHALL fail with `issue_reference_unresolved`; more than one SHALL fail with `issue_reference_ambiguous` listing every claimant and choosing none; a scope disagreement SHALL fail with `issue_reference_scope_conflict` naming both values; and an instance belonging to another Store SHALL be refused outright. A Store ref that cannot be read SHALL be reported as unsearched and SHALL NOT be treated as evidence of absence. An `intent` node SHALL be verified against the project and target-line catalogs only.

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

An Issue or revision write SHALL resolve a Store scope that requires no project and no target line, and SHALL land in a Store checkout that is not a planning worktree bound to a Change. A write attempted from a bound planning worktree SHALL fail with `issue_write_requires_store_checkout`, naming the checkout, the Change it is bound to, and the repair, because that worktree's branch carries one Change's unmerged line and a cross-line resource written there cannot be seen from any other line. The command SHALL report the checkout and ref it wrote to, SHALL print a pathspec-scoped commit suggestion, and SHALL stage, commit, fetch, and push nothing.

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

### Requirement: Issue writes serialize on a Store-level issue lock

An Issue write SHALL serialize on an owner-aware machine-root lock keyed by the Store identity and the Issue identifier, whose filename is a digest of the canonically serialized key material. That key SHALL be acquired before the scope, workspace, Change, and integration keys, extending the established acquisition order without altering it, and no path SHALL reach back for an earlier key while holding a later one. An Issue write SHALL take only the issue key. Contention SHALL retry within a bounded deadline and then fail naming the holder; a semantic conflict SHALL NOT be retried. A read SHALL take no lock.

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

