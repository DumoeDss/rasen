# issue-unified-review Specification — Delta

## MODIFIED Requirements

### Requirement: Open threads are named, never guessed

The review view SHALL carry an open-threads inventory of the facts the gate deliberately
excludes but a reviewer must see, each one a named kind carrying the node it names where it
names one: `optional-open`, for a wanted optional node whose work is not terminal, named
with its observed state; `archive-pending`, for a node whose observed work is terminal while
its Change instance is not archived — expected progress, named as awaiting the archive,
never as damage; `record-absent`, for an archived entry that carries no archive record at
all; `evidence-missing`, for the missing-evidence names an archived record froze, carried
as the recorded facts they are; and the attention-derived `failure`, `blocked-behind`, and
`waiting-human` threads, composed from the attention derivation over the same status. An
attention `acceptance-awaiting` item SHALL NOT become a thread — it is the review-ready
determination's own conclusion — and an attention `problem` item SHALL NOT become a thread
— standing problems are gate blockers the `not-ready` determination already carries.
A `deferred` node SHALL NOT be an `optional-open` thread and SHALL have no thread kind of
its own: the deferral removed the node from the `optional` lifecycle, and the recorded
deferral is already presented in full by the gate's exclusion account in the acceptance
section — a deferral thread would present the same fact twice, and the determination never
needs a second blocking basis to account for postponed work.
Threads SHALL order stably, the attention kinds in their fail-first order and the remaining
kinds in a stable (kind, node) order, and a count SHALL summarize them without replacing
them: every thread stays listed in full.

#### Scenario: Expected progress reads as a thread, not damage

- **WHEN** a required node observes run-terminal through located run-state while its Change
  instance has no archive entry
- **THEN** the thread reads `archive-pending` for that node, named as evidence that will
  exist when the Change archives
- **AND** the determination is unaffected by the thread

#### Scenario: Recorded missing evidence informs without blocking

- **WHEN** an archived record froze the missing-evidence name `verification-report`
- **THEN** the thread reads `evidence-missing` for that node, carrying the recorded name
- **AND** the review view invents no verdict about the verification the name refers to

#### Scenario: An in-flight optional node is an open thread

- **WHEN** an Issue's required nodes are all terminal and one optional node observes
  in-flight
- **THEN** the thread reads `optional-open` for that node with its observation
- **AND** the determination reads `review-ready` over the required nodes alone

#### Scenario: Attention trouble composes into threads

- **WHEN** an optional node of the same Issue observes failed and a downstream not-started
  node is blocked behind it
- **THEN** the threads carry the attention-derived `failure` and `blocked-behind` entries
  in the attention fail-first order
- **AND** no attention item outside the three mapped kinds becomes a thread

#### Scenario: Threads order stably and stay listed

- **WHEN** a review view carries threads of several kinds
- **THEN** the attention-derived threads precede the others, each group in its stable
  order, and the same evidence derives the identical ordering twice
- **AND** every thread remains listed in full beside any count that summarizes them

#### Scenario: A deferral dissolves the optional-open thread without a second basis

- **WHEN** a revision defers a previously optional non-terminal node with a recorded reason
  and the Issue's required nodes are all terminal
- **THEN** no `optional-open` thread names that node and no thread kind presents the
  deferral, whose record stands in the acceptance section's exclusion account
- **AND** the determination reads `review-ready` exactly as the gate maps it, with no new
  blocking basis introduced by the deferral
