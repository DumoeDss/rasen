# issue-acceptance-close Specification

## Purpose
This capability closes the loop between an Issue's execution and its completion. An Issue
carries versioned acceptance conditions, and `rasen store issue acceptance` derives the live
gate from the plan's real node states — every Change node terminal before acceptance is
possible — so the operator cannot accept work that is not real. `rasen store issue accept`
records the verified acceptance that closes the Issue, and the Issue's `done` phase reads back
only when the resolved state is backed by a recorded, verified acceptance. Acceptance content
is Issue-scoped planning state: versioned like plan revisions, mutable only through its own
recorded mutations, and read back from the record the Store committed.

## Requirements
### Requirement: Acceptance conditions are versioned Issue content

Rasen SHALL hold an Issue's acceptance conditions as Issue content: publishing conditions SHALL
create the next immutable revision under the Issue's own location, addressed by the same
canonical ordinal discipline Execution Plan revisions use, carrying a digest over its own
canonical content that a read verifies. A conditions revision SHALL carry at least one
condition, each with a stable identifier, a requirement statement, and an optional verification
note, and every text it carries SHALL satisfy the same portable-durable-text contract Issue
records already enforce. A published revision SHALL never be rewritten, and the latest
revision SHALL be identifiable from its ordinal alone.

#### Scenario: Publishing adds a conditions revision rather than editing one

- **WHEN** conditions are published for an Issue that already has one conditions revision
- **THEN** a new revision exists at the next ordinal
- **AND** the first revision's bytes are unchanged

#### Scenario: Altered conditions are refused on read

- **WHEN** a stored conditions revision's content is altered without updating its digest
- **THEN** reading it is refused, naming the mismatch
- **AND** no altered conditions are returned to the caller

#### Scenario: Conditions carry no machine-local text

- **WHEN** a condition's requirement or verification note carries a machine filesystem path or embedded credential
- **THEN** publication is refused at the schema rather than trimmed
- **AND** nothing is written

### Requirement: The acceptance gate is derived and visible before it is crossed

Rasen SHALL evaluate an Issue's acceptance gate on read from the tri-axis status: the gate holds
when every required node of the latest readable plan has completed or finalized work (the same
observation rule execution binding uses), the Issue's health is not `failed`, and no status
problem stands between the reader and the facts. `rasen store issue show` SHALL report the gate
— eligible, or every blocker named: each un-terminal node with its observed execution state,
each node behind a failed health, and each open status problem — alongside the latest conditions
revision, in both human and `--json` forms.

#### Scenario: The gate names what is not accepted yet

- **WHEN** an Issue with acceptance conditions has one node in flight and one with an invalid run-state
- **THEN** the gate reports not eligible, naming the in-flight node and the unreadable run-state problem
- **AND** no other fact is invented to fill the gap

#### Scenario: A passing gate is reported eligible

- **WHEN** every required node's work is complete or finalized, health is not failed, and no status problem stands
- **THEN** the gate reports eligible
- **AND** names the conditions revision it would accept

#### Scenario: Failed health holds the gate

- **WHEN** an Issue's health is `failed`
- **THEN** the gate reports not eligible, naming the nodes whose recorded failure drives the health

### Requirement: Accepting an Issue closes it explicitly and refuses honestly

`rasen store issue accept` SHALL, for one Issue, evaluate the acceptance gate and record the
acceptance only when the gate holds, closing an open Issue by resolving it in the same
serialized mutation. The command SHALL refuse, naming the reason and the facts: an Issue whose
state is dropped, which is abandoned rather than acceptable; an Issue already carrying an
acceptance record; an Issue with no readable plan; and an Issue with no conditions revision,
refused toward authoring conditions first. Fact blockers SHALL be named together — every
un-terminal node, every failing node, every open status problem — rather than one at a time.
For an Issue already resolved without an acceptance record — a close made before this
capability existed — the command SHALL record the acceptance without a further state
transition, upgrading the legacy close rather than refusing it.

#### Scenario: A gate that does not hold refuses, naming everything

- **WHEN** `rasen store issue accept` runs while one required node is un-terminal and another's run-state is unreadable
- **THEN** the command refuses, naming both the node and its observation and the unreadable run-state problem
- **AND** no acceptance record is written and the Issue's state is unchanged

#### Scenario: A passing gate records the acceptance and closes the Issue

- **WHEN** `rasen store issue accept` runs on an open Issue whose gate holds
- **THEN** an acceptance record is written and the Issue's state becomes resolved
- **AND** the write prints a pathspec-scoped commit suggestion and stages nothing

#### Scenario: A dropped Issue is not acceptable

- **WHEN** `rasen store issue accept` runs for an Issue whose state is dropped
- **THEN** the command refuses, naming dropped as abandoned
- **AND** nothing is written

#### Scenario: A second acceptance is refused

- **WHEN** `rasen store issue accept` runs for an Issue that already carries an acceptance record
- **THEN** the command refuses as already accepted
- **AND** the existing record's bytes are unchanged

#### Scenario: A legacy close is upgraded, not re-transitioned

- **WHEN** `rasen store issue accept` runs for an Issue resolved before acceptance records existed, whose gate holds
- **THEN** the acceptance record is written and the Issue's state remains resolved
- **AND** no state transition is attempted

### Requirement: The acceptance record is durable close evidence

The acceptance record SHALL be one record per Issue, written at the Issue's own location, never
rewritten, and SHALL carry: when the acceptance happened, the conditions revision it accepted
with that revision's digest, the gate snapshot at acceptance — completed and total required
nodes, the health value, and that no status problem stood — an optional note, and a digest over
its own canonical content that a read verifies. A record whose stored digest does not match its
content SHALL be refused on read and reported, and the Issue SHALL not present as done from
unreadable bytes.

#### Scenario: The record freezes what was accepted

- **WHEN** an acceptance record is read back
- **THEN** it names the conditions revision and that revision's digest at acceptance time
- **AND** a later conditions revision does not change what the record says was accepted

#### Scenario: A tampered record never presents as done

- **WHEN** a stored acceptance record's content is altered without updating its digest
- **THEN** reading it is refused with the mismatch reported as a status problem
- **AND** the Issue does not present as done from the unreadable record

### Requirement: Done follows explicit acceptance

An Issue SHALL present phase `done` only when its state is resolved AND an acceptance record
reads back verified — never from an archived count of its Changes, and never from the resolved
state alone. An Issue resolved without an acceptance record SHALL present `review` — its work
complete, its acceptance unproven — with health `waiting-human`, and SHALL become `done` when
its acceptance is recorded. The acceptance, the state, and the plan stand in that order: the
record proves the acceptance, the resolved state records the close, and the archived count of
Changes proves neither.

#### Scenario: A bare state flip does not derive done

- **WHEN** an Issue whose required work is complete has its state set to resolved without an acceptance record
- **THEN** its phase reads `review`
- **AND** its health reads `waiting-human`

#### Scenario: Recording the acceptance moves the phase

- **WHEN** the same Issue is then accepted through `rasen store issue accept` with its gate holding
- **THEN** its phase reads `done`

#### Scenario: Archived Changes alone never derive done

- **WHEN** every Change of an open Issue's plan is finalized and archived
- **THEN** its phase reads `review`
- **AND** only the recorded acceptance changes that
