## Purpose

Answer questions that span more than one project in a Store without letting any caller reconstruct a Store-internal path. One module exposes typed query methods over projects, target lines, Changes, Issues, and Execution Plan revisions; Change results arrive already grouped by project and target line, so the group key is a validated value rather than something a consumer re-derives from a path or an identifier substring. Cross-reference state is read from committed Store refs and from local planning worktrees with a stated authority order, and the module reports what it could not prove — an unresolvable reference, disagreeing claimants, a divergent record, an unreadable ref — as those states rather than as absence, with an explicit completeness flag so a partial answer is never mistaken for a total one. Aggregation reads Archive records as data, replays no spec, persists no index, and holds no lock.

## ADDED Requirements

### Requirement: Store aggregation is served by typed query methods

Store, project, and target-line aggregate reads SHALL be served by one query module exposing typed methods for projects, target lines, Changes, Issues, and Execution Plan revisions. Inputs and results SHALL be typed values carrying validated identities; the module SHALL NOT accept or return a Store-relative path string as an address, and no consumer SHALL traverse Store directories or join a Store path to obtain aggregate content. A catalog that fails validation SHALL be reported as an entry carrying its diagnostic rather than omitted from the result.

#### Scenario: A consumer addresses aggregate content without a path

- **WHEN** a CLI, management, or UI consumer requests a Store's projects, target lines, Changes, or Issues
- **THEN** it SHALL receive typed results from the query module
- **AND** it SHALL NOT compute, accept, or pass a Store-relative planning path to obtain them

#### Scenario: An invalid catalog is reported, not dropped

- **WHEN** one of a Store's project or target-line catalogs fails strict validation
- **THEN** the rollup SHALL include an entry for it carrying the validation diagnostic
- **AND** the entry SHALL NOT be silently omitted from the listing

### Requirement: Change results are grouped by project and target line by construction

A Change aggregate result SHALL be a set of groups, each keyed by one validated project identity and one validated target-line identity and carrying that group's active and archived entries. The module SHALL NOT offer a flat listing that omits the group key, because a consumer recovering an implicit key could only recover it from a path or an identifier substring. Each active entry SHALL carry the Change alias and its verified Change instance; each archived entry SHALL additionally carry its finalization outcome and archive date. Any absolute path in a result SHALL be an inert local locator that confers no authority.

#### Scenario: Two projects using one Change alias stay distinct

- **WHEN** two projects in one Store each have an active Change named `refresh-cache`
- **THEN** the two entries SHALL appear in different groups keyed by their own project identity
- **AND** neither entry SHALL be distinguishable only by a path

#### Scenario: Every entry carries the facts a card must show

- **WHEN** an aggregate result is rendered
- **THEN** each entry SHALL supply its project, target line, and Change instance from the result itself
- **AND** an archived entry SHALL additionally supply its finalization outcome

#### Scenario: A legacy record does not gain an invented outcome

- **WHEN** an archived entry in a layout v2 partition carries a relocated legacy accounting record rather than a v2 record
- **THEN** the entry SHALL report no outcome and SHALL be marked as a legacy record
- **AND** no outcome SHALL be inferred, defaulted, or upgraded

### Requirement: Cross-reference state is resolved from committed Store refs and local planning worktrees

Resolving a Change instance referenced from Store-level content SHALL read committed Store content as Git blobs across the Store refs the target-line catalogs name, and SHALL additionally consult the local machine workspace index to locate an instance whose planning branch has not merged. Committed content SHALL be the authority for existence, committed identity, and archived outcome; a local worktree SHALL be a non-portable locator of lower authority. Resolution SHALL match on re-derived Change instance identity and SHALL NOT match on a directory name, a Change alias, or a branch name. Nothing SHALL be checked out, merged, fetched, or pushed.

#### Scenario: An unmerged planning worktree is still resolvable

- **WHEN** a referenced Change exists only in a local planning worktree whose branch has not merged into any integration ref
- **THEN** resolution SHALL locate it through the machine workspace index
- **AND** the locator SHALL be reported as local and non-portable

#### Scenario: Identity is matched, not names

- **WHEN** a Store contains a Change whose directory name and alias match a reference but whose re-derived instance identity does not
- **THEN** it SHALL NOT be selected
- **AND** no branch name SHALL be parsed for project, target line, or Change identity

#### Scenario: Reading the Store changes nothing

- **WHEN** a full aggregate query runs against a Store with several target lines
- **THEN** no ref, HEAD, working tree, or index SHALL be modified in the Store or any project repository
- **AND** no network access SHALL occur

### Requirement: An aggregate reports the unproven as unproven and never as absence

A query SHALL report what it could not prove rather than asserting a state it cannot support, and SHALL NOT fail wholesale because one item is unresolvable. A reference with no evidence SHALL be reported as unresolved, naming the refs searched. A reference with disagreeing or multiple claimants SHALL be reported as ambiguous, listing every claimant and selecting none. An Issue whose records differ between two Store refs SHALL be reported as divergent, listing every copy with its ref and presenting none as the record. A Store ref that cannot be read SHALL be listed as an unsearched ref and SHALL NOT be treated as evidence of absence. Every aggregate result SHALL carry a required completeness flag that is false whenever any ref was unsearched.

#### Scenario: One broken reference does not break the board

- **WHEN** one node of one Execution Plan revision references an unresolvable Change instance
- **THEN** the query SHALL still return every other group, entry, and node
- **AND** the affected node SHALL be reported as unresolved with the refs that were searched

#### Scenario: An unreadable ref lowers completeness rather than removing content

- **WHEN** one of the Store's target-line refs cannot be read during a query
- **THEN** the ref SHALL appear in the result's unsearched list and the completeness flag SHALL be false
- **AND** no reference SHALL be reported as unresolved on the strength of that ref being unreadable

#### Scenario: A divergent Issue record picks no winner

- **WHEN** two Store refs carry byte-differing records for one Issue identifier
- **THEN** the Issue SHALL be reported as divergent with every copy and its ref
- **AND** no copy SHALL be presented as the record and no recency heuristic SHALL choose one

### Requirement: Aggregation reads Archive records as data and replays nothing

Reading an Archive record for aggregation SHALL treat it as passive data. Aggregation SHALL NOT apply, replay, or re-derive any delta spec action, SHALL NOT write any canonical spec, and SHALL NOT create, modify, or delete any file under a project partition, an Archive entry, or a Change directory. The query module SHALL have no write surface at all, and this SHALL be asserted by a guard rather than by convention.

#### Scenario: Canonical specs are byte-identical after a full aggregate query

- **WHEN** a full aggregate query runs over a Store whose Archives contain applied spec actions
- **THEN** every canonical spec file under every project partition SHALL be byte-identical before and after
- **AND** no spec action SHALL be applied or re-derived

#### Scenario: The query module cannot write

- **WHEN** the query module's sources are inspected
- **THEN** they SHALL import no spec-application, archive-transaction, or filesystem-write function
- **AND** they SHALL invoke no Git verb outside the read set

### Requirement: Issue readiness is derived and never written back

A query SHALL derive an Issue's readiness from its latest Execution Plan revision — which nodes are not started, which are blocked by an unsatisfied dependency, and which reference a finalized Change — and SHALL report the derivation as part of the read. The derivation SHALL NOT modify the Issue record, the plan revision, or any referenced Change, and SHALL NOT change an Issue's state. An Issue's state SHALL remain operator-declared.

#### Scenario: A fully landed plan does not resolve its Issue

- **WHEN** every `change` node of an Issue's latest revision references a Change finalized as landed
- **THEN** the query SHALL report the Issue as ready to resolve
- **AND** the Issue's recorded state SHALL remain `open` until an operator changes it

#### Scenario: An intent node counts as not started

- **WHEN** a revision mixes `change` nodes referencing finalized Changes with `intent` nodes
- **THEN** readiness SHALL report the `intent` nodes as not started
- **AND** the Issue SHALL NOT be reported as ready to resolve

### Requirement: Aggregation persists no index and holds no lock

A query SHALL compute its answer from a fresh read of committed Store content and the machine workspace index at request time. It SHALL NOT write, maintain, or consult a durable aggregate index or cache, because that would be a second source of truth about state whose first source is Git. Memoization SHALL be confined to one invocation — a Store ref read once per query rather than once per reference — and SHALL leave no state after the call. A query SHALL acquire no lock, so a held write lock never blocks a read.

#### Scenario: A second query sees a change made between the two

- **WHEN** Store content changes between two identical queries
- **THEN** the second result SHALL reflect the new content with no cache invalidation step

#### Scenario: One ref is read once per query

- **WHEN** a query resolves many references that live on one Store ref
- **THEN** that ref SHALL be read once for the query
- **AND** no memo, index, or cache file SHALL exist after the call returns

#### Scenario: A read completes while writers hold locks

- **WHEN** an aggregate query runs while another process holds the issue, scope, workspace, and Change locks
- **THEN** the query SHALL complete without waiting
- **AND** it SHALL acquire no lock
