# change-finalization-outcomes Specification

## Purpose
Resolves a Change's semantic end state — `landed`, `superseded`, `cancelled`, or
`abandoned` — before any physical archive action. Only `landed` may update canonical
specs, and only after proving the code commit is reachable from the target line's code ref.
The three passive outcomes record history without replaying spec deltas.
## Requirements
### Requirement: A Store v2 Change ends in exactly one explicitly declared outcome

Finalizing a Change in a Store v2 project scope SHALL require exactly one explicitly declared outcome from `landed`, `superseded`, `cancelled`, and `abandoned`. There SHALL be no default and no inferred outcome. Every non-landed outcome SHALL carry a non-empty reason; only `superseded` SHALL carry a successor; `landed` SHALL carry neither. A contradictory combination SHALL be refused before any filesystem, Git, or spec access. Outcome shape SHALL be decided by the canonical finalization-record validator rather than by a second parser. Re-finalizing an already finalized Change SHALL be decided from the published entry and the transaction journal, not from a directory scan, and SHALL be idempotent when the recorded transaction identity matches.

#### Scenario: A missing outcome refuses and names the choices

- **WHEN** a Store v2 project Change is archived with no outcome declared
- **THEN** the command SHALL refuse with `finalization_outcome_required`, naming all four outcomes and which of them require a reason or a successor
- **AND** no planning, spec, or execution file SHALL be read for mutation or written

#### Scenario: A contradictory outcome combination is refused before any access

- **WHEN** a successor is supplied for a non-superseded outcome, a reason is supplied for `landed`, or a non-landed outcome is supplied with an empty or whitespace-only reason
- **THEN** the finalization SHALL be refused
- **AND** the refusal SHALL occur before any filesystem or Git access

#### Scenario: Re-finalizing a finalized Change is idempotent, not a second outcome

- **WHEN** finalization is invoked again for a Change whose entry is already published under a matching transaction identity
- **THEN** it SHALL report the recorded outcome and stop cleanly
- **AND** it SHALL NOT record a second outcome, rewrite the published record, or move any file

### Requirement: Only a landed outcome may change canonical specs

A `landed` finalization SHALL be the sole operation permitted to create, update, or delete a canonical spec in a Store v2 project partition. `superseded`, `cancelled`, and `abandoned` SHALL be passive history: they SHALL apply no delta, and the plan they produce SHALL have no field capable of carrying a spec action, so omitting the synchronization is structural rather than conditional. A landed Change with no deltas SHALL still record applied synchronization with an empty action list. Skipping spec synchronization SHALL be refused for a landed Change that has deltas, because a landed record asserts that synchronization was applied.

#### Scenario: A passive outcome leaves canonical specs byte-identical

- **WHEN** a Change carrying added, modified, and removed delta specs is finalized as `abandoned`, `cancelled`, or `superseded`
- **THEN** every file under the project partition's canonical specs SHALL be byte-identical to its pre-finalization content
- **AND** the record SHALL report synchronization as not applied with an empty action list

#### Scenario: A landed Change with no deltas records an applied no-op

- **WHEN** a landed Change has no delta specs
- **THEN** the record SHALL report synchronization as applied with an empty action list
- **AND** no canonical spec SHALL be created, updated, or deleted

#### Scenario: Skipping specs on a landed Change with deltas is refused

- **WHEN** a landed finalization is asked to skip spec synchronization while the Change carries delta specs
- **THEN** it SHALL refuse, explaining that a landed record asserts applied synchronization
- **AND** nothing SHALL be archived

### Requirement: A landed outcome is proven reachable from its target line's code ref

A code-backed `landed` finalization SHALL resolve a code commit in fixed priority — an explicitly supplied commit, the Change's recorded ship-log commit, then the execution worktree's `HEAD` — and SHALL record which source supplied it. It SHALL then prove, in the execution repository through a read-only Git adapter, that the value names a commit object and that the commit is an ancestor of the code ref the Change's target-line catalog declares for its project. An unresolvable code ref, an unknown commit, a negative ancestry answer, or an answer Git cannot determine SHALL each refuse with its own diagnostic naming both commit identifiers and the ref. Reachability SHALL never be defaulted, assumed from the fact that a delivery occurred, or inferred from a branch name. No fetch SHALL be performed: the proof SHALL be stated as being against the ref as it stands locally, and the ref's commit identifier at proof time SHALL be frozen so a ref that moves invalidates the proof rather than silently re-proving it.

#### Scenario: An unreachable commit cannot land

- **WHEN** the resolved code commit is not an ancestor of the target line's declared code ref
- **THEN** the finalization SHALL refuse, naming the commit, the ref, and the ref's commit identifier
- **AND** no spec SHALL be synchronized and no Change directory SHALL move

#### Scenario: An indeterminate Git answer refuses rather than defaulting

- **WHEN** the ancestry question cannot be answered because Git is unavailable, the repository state is ambiguous, or the query fails unexpectedly
- **THEN** the finalization SHALL refuse with an unavailable-proof diagnostic
- **AND** it SHALL NOT record reachability as true or as false

#### Scenario: The proof is scoped to the local ref and says so

- **WHEN** a landed proof succeeds
- **THEN** the recorded proof SHALL name the target ref and its local commit identifier at proof time
- **AND** no fetch, pull, or remote query SHALL have been performed

### Requirement: Planning-only intent is declared in the Change, never at finalization

A Change SHALL be treated as planning-only only when its committed metadata explicitly declares no implementation. That declaration SHALL be the only route to a landed record with no code-merge facts, and there SHALL be no finalization-time flag, prompt, or option that can assert it. A Change without the declaration SHALL be treated as code-backed and SHALL require the reachability proof; when it cannot supply one, the refusal SHALL name both repairs — declare and commit the intent in the Change, or land the code — and SHALL NOT offer a bypass.

#### Scenario: A declared planning-only Change lands with no commit

- **WHEN** a Change whose committed metadata declares no implementation is finalized as `landed`
- **THEN** the record SHALL carry no code-merge facts
- **AND** no commit SHALL be resolved, fabricated, or required

#### Scenario: Planning-only cannot be claimed at finalization time

- **WHEN** a code-backed Change with no reachable commit is finalized as `landed`
- **THEN** it SHALL refuse, naming both repairs
- **AND** no option SHALL exist that declares the Change planning-only during finalization

### Requirement: A superseding Change is resolved to verified scope evidence

A `superseded` finalization SHALL resolve its declared successor to a real Change instance before the relation is accepted. Resolution SHALL re-derive each candidate's Change-instance identity from committed metadata read as a Git object across the Store refs its target-line catalogs name, including entries already finalized, and SHALL match only on the derived identity — never on a Change alias, a directory name, a branch name, or adjacency. Exactly one match SHALL be required: none SHALL fail as unverified successor scope, and several SHALL fail as ambiguous, listing every claimant and choosing none. A ref that cannot be read SHALL be reported as unsearched and SHALL prevent a "not found" conclusion. The resolved scope SHALL then be checked by the canonical validator, which requires the same permanent Store and project and permits another target line. Nothing SHALL be checked out, merged, or fetched to perform the search.

#### Scenario: A successor on another target line is accepted

- **WHEN** the declared successor resolves, on another target line's Store ref, to a Change with the same Store and project identities
- **THEN** the supersession SHALL be accepted
- **AND** the successor's target line SHALL be recorded as differing from the current one

#### Scenario: An ambiguous successor chooses nothing

- **WHEN** more than one candidate derives the declared successor identity
- **THEN** the finalization SHALL refuse, listing every claimant
- **AND** it SHALL NOT select one by ref order, recency, or proximity

#### Scenario: An unsearched ref prevents a not-found conclusion

- **WHEN** a Store ref named by a target-line catalog cannot be read during the successor search
- **THEN** the ref SHALL be reported as unsearched with its reason
- **AND** the finalization SHALL refuse rather than concluding the successor does not exist

### Requirement: A Change is finalized only into its frozen target line

Finalization SHALL compare the target line resolved from the current scope with the one frozen in the Change's committed identity and SHALL refuse with a target-line mismatch, naming both, before computing a destination, reading a canonical spec, or entering the archive transaction. The destination SHALL be derived from the frozen line, so a resolution defect cannot file a Change under another release line. A checkout that happens to sit on another line's ref SHALL NOT re-point the Change.

#### Scenario: A mismatched line refuses before anything is read

- **WHEN** the scope resolves a target line other than the one frozen in the Change's identity
- **THEN** finalization SHALL refuse naming both lines
- **AND** no destination SHALL be computed and no canonical spec SHALL be read

#### Scenario: The destination follows the frozen line

- **WHEN** a finalization proceeds
- **THEN** the published entry SHALL be addressed under the frozen target line
- **AND** the current checkout's ref SHALL NOT participate in the address

### Requirement: Standalone and legacy flat Store finalization keeps its established behavior

A standalone project and a legacy flat Store SHALL archive exactly as they do today: no outcome SHALL be required, none SHALL be recorded, no reachability proof SHALL be demanded, and the existing accounting record and entry name SHALL be unchanged. The outcome axis SHALL be reached only from a Store v2 project scope, dispatched from the resolved scope rather than from a path shape. A legacy flat Store SHALL continue to refuse planning writes until it is migrated.

#### Scenario: A standalone archive is untouched by the outcome axis

- **WHEN** a Change is archived in a standalone project
- **THEN** no outcome SHALL be required or recorded
- **AND** the entry name, the accounting record, and the spec-synchronization behavior SHALL be exactly as before

#### Scenario: A legacy flat Store still refuses until migrated

- **WHEN** archiving targets a Store that has not declared layout version 2
- **THEN** it SHALL still refuse with the layout-migration diagnostic
- **AND** the outcome axis SHALL NOT make the legacy flat layout writable

