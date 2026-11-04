# issue-unified-review Specification

## Purpose
This capability composes an Issue's review view — a review-readiness determination, an
open-threads inventory, and a verification summary — as a pure post-pass over the status
projection's own facts, the same status one `store issue show` read already derived, mapping
the acceptance gate's own evaluation onto a closed determination vocabulary (`review-ready`,
`accepted`, `not-ready`, `conditions-missing`, `no-plan`, `dropped`, `acceptance-unknown`) as
the ONE blocking basis, and naming the delivery-evidence and attention facts the gate
deliberately excludes as open threads that never flip the determination. The derivation
writes nothing: no review value lands in an Issue record, plan revision, acceptance record,
archive record, a Change's run-state, or the workspace index; it is a display-only conclusion
rendered as the show surface's concluding section, and reading the same Issue over unchanged
evidence yields the identical determination and threads. Every Issue derives an answer from a
closed vocabulary — an unreadable plan, missing conditions, or an evaluation-less read each
name their own determination — never an absent or guessed conclusion.

## Requirements
### Requirement: The review view composes the projection's own facts

Rasen SHALL derive an Issue's review view as a pure post-pass over the status projection's
own facts — the same status one show read derived — composing the delivery rollup and the
attention items from that status and nothing else, so the review view, the node lines, the
acceptance section, and the delivery section of the same read can never disagree. The
derivation SHALL take its issue and revision identities as plain resolved strings beside the
status (the delivery rollup's signature precedent) and SHALL persist nothing: no review
value SHALL be written into an Issue record, a plan revision, an acceptance record, an
archive record, a Change's run-state, or the workspace index. Every Issue SHALL derive a
review view — an Issue with no readable plan derives the determination that says so, never
an absent answer — and deriving the same view twice over unchanged evidence SHALL yield the
identical result. A read that supplied no acceptance facts SHALL report the determination
`acceptance-unknown`, naming the omission, rather than a guessed eligibility.

#### Scenario: The view derives from one status

- **WHEN** an Issue's review view is derived from the status a show read just derived
- **THEN** the view's determination, threads, and summary are computed from that status
  alone — its gate evaluation, its nodes, its problems, and the delivery facts its nodes
  carry
- **AND** no file, index, or run-state is read or written by the derivation

#### Scenario: Every Issue derives an answer

- **WHEN** the review view is derived for an Issue with no published plan revision
- **THEN** the determination reads `no-plan`, naming that no readable plan exists to review
- **AND** the view is present, never an absent or empty answer standing in for the fact

#### Scenario: A read without acceptance facts names the omission

- **WHEN** the review view is derived from a status whose read supplied no acceptance facts
- **THEN** the determination reads `acceptance-unknown`, naming that the gate could not be
  evaluated on this read
- **AND** no eligibility, blocker, or conditions fact is presented

### Requirement: The determination is machine-checkable over one blocking basis

The review determination SHALL be one value of a closed vocabulary, mapped from the
acceptance gate's own evaluation over the same status — the gate is the ONE blocking basis,
and the mapping SHALL NOT re-derive, widen, or narrow it: the gate holds → `review-ready`,
naming the conditions revision it would accept; the Issue already carries a verified
acceptance record → `accepted`, carrying the record's acceptance date and conditions
revision; the gate names fact blockers → `not-ready`; no readable acceptance conditions →
`conditions-missing`; no readable plan with nodes → `no-plan`; the Issue is dropped →
`dropped`. No delivery-evidence state, node lifecycle, open thread, or count SHALL change
the determination the gate's evaluation maps to: a terminal node not yet archived, an
optional node still running, and a recorded missing-evidence name are named facts beside
the determination, never reasons it flips. The `--json` form SHALL carry the determination
as a machine-checkable value a consumer can branch on.

#### Scenario: A holding gate reads review-ready

- **WHEN** an open Issue's every required node's work is complete or finalized, health is
  not failed, no status problem stands, and a conditions revision is published
- **THEN** the determination reads `review-ready`, naming the conditions revision it would
  accept
- **AND** the view states that accepting remains the operator's act

#### Scenario: Blockers map not-ready without a second basis

- **WHEN** the gate names one un-terminal required node and one standing status problem
- **THEN** the determination reads `not-ready` over the gate's own blockers, both named
- **AND** no additional blocker the gate did not name is invented by the review view

#### Scenario: Threads never flip the determination

- **WHEN** the same holding-gate Issue also carries one optional node in flight and one
  run-terminal node whose Change is not archived
- **THEN** the determination still reads `review-ready`
- **AND** both facts are named as open threads beside it, never as blockers

#### Scenario: A done Issue reads accepted

- **WHEN** an Issue's state is resolved and its acceptance record reads back verified
- **THEN** the determination reads `accepted`, carrying the record's acceptance date and
  conditions revision
- **AND** the threads that still stand are named beside it, not hidden by the conclusion

#### Scenario: Conditions authoring precedes readiness

- **WHEN** an Issue's required work is complete and terminal, no problem stands, and no
  conditions revision exists
- **THEN** the determination reads `conditions-missing`, naming the authoring act it awaits
- **AND** the work's completeness is not re-litigated by the review view

#### Scenario: A dropped Issue reads dropped

- **WHEN** the review view is derived for an Issue whose state is dropped
- **THEN** the determination reads `dropped`, naming abandonment rather than unreadiness

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

### Requirement: The show surface concludes with the review view

`rasen store issue show` SHALL render the review view as the concluding section, after the
delivery evidence: the determination with the facts it names (the conditions revision when
review-ready, the record's date and revision when accepted, the blocker count the gate
named when not-ready), the open threads each on its own line, the verification summary —
the required-work pair and the five-state delivery counts, by reference to the facts the
same read already reported — and the closing statement that the review derives and
accepting remains the operator's act. The `--json` form SHALL carry the same facts under a
`review` key beside `status` and `delivery`. `rasen store issue list` SHALL NOT report the
review view — the listing stays compact and the review conclusion is the show surface's
answer. The command SHALL write nothing.

#### Scenario: A review-ready Issue concludes the show

- **WHEN** an Issue whose gate holds is shown in human form
- **THEN** the review section reads the `review-ready` determination naming its conditions
  revision, lists the standing threads, and closes with the operator's-act statement
- **AND** the `--json` form carries the same determination, threads, and summary under
  `review`

#### Scenario: A not-ready Issue points at the named blockers

- **WHEN** an Issue whose gate names blockers is shown
- **THEN** the review section reads `not-ready` and names the blockers the gate's
  evaluation already listed in the acceptance section above
- **AND** the review section invents no blocker the gate did not name

#### Scenario: The listing stays compact

- **WHEN** Issues with derived review views are listed
- **THEN** the listing's lines carry no determination or thread facts
- **AND** the show surface remains the review answer

#### Scenario: Showing writes nothing

- **WHEN** `rasen store issue show` runs to completion with the review section rendered
- **THEN** every Issue record, plan revision, acceptance record, archive record, run-state
  file, and the workspace index are byte-identical before and after
