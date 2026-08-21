# issue-ready-set-scheduling Specification — Delta

## ADDED Requirements

### Requirement: The ready set is deterministic and derives through the projection

The ready set SHALL be computed, for an Issue whose latest published Execution Plan revision
reads back, as exactly the Change nodes whose lifecycle the plan still wants — `required` or
`optional` — whose observed execution is `not-started`, and whose every dependency's observed
work is complete on the work-complete basis the status projection already enforces — terminal
run-state or finalized evidence — so a dependency whose work is complete releases its
downstream even before its Change is archived. Dependency gating SHALL be edge-wise and
project-blind exactly as `store issue start` gates: a dependency targeting another member
project releases its downstream exactly as a same-project dependency does. The ready set SHALL
derive on read from the status projection's own node facts alone — the same observations,
lifecycles, and dependency facts the read surface shows — persisted nowhere, and reading the
same Issue over unchanged evidence SHALL yield the same set. An Issue whose latest revision
does not read back SHALL yield no ready set rather than an empty one, because "no readable
plan" and "nothing runnable" are different truths.

#### Scenario: A serial chain's head is the only ready node

- **WHEN** an Issue's plan is a serial chain of three not-started Change nodes and the ready set is derived
- **THEN** the set contains exactly the chain's head node
- **AND** the second and third nodes are reported outside the set, each waiting on the node before it

#### Scenario: A cross-project dependency releases on completed work

- **WHEN** a not-started node's only dependency targets another member project and that dependency has terminal run-state while its Change is not yet archived
- **THEN** the node is in the ready set
- **AND** the gate does not wait for the dependency's archive

#### Scenario: Parallel opportunities are listed, not chosen among

- **WHEN** an Issue's plan carries two independent not-started Change nodes whose dependencies are all complete
- **THEN** the ready set contains both nodes
- **AND** the set is the answer itself — no node is singled out and no refusal is raised for several qualifying

#### Scenario: Unchanged evidence yields the same ready set

- **WHEN** an Issue's ready set is derived twice with no change to its plan revisions, committed evidence, or run-state
- **THEN** both derivations report the same members and the same exit reasons for every non-member

#### Scenario: An unreadable revision yields no ready set

- **WHEN** an Issue's latest revision exists but fails its digest or parse
- **THEN** no ready set is reported
- **AND** the reason is the same status problem the projection reports, never an empty set that would read "nothing runnable"

### Requirement: Every non-member is named with a reason

Every node of the revision the ready set does not contain SHALL be reported with a reason
drawn from one closed vocabulary derived from the node's own projection facts: a `cancelled`
node with its recorded reason; a `superseded` node with its recorded reason; an intent node as
pending Change creation with its target project and target line; a node whose observation is
`in-flight`, `advanced`, or `waiting-human` as running with that observation named; a `failed`
node as failed; a node whose work is complete — `finalized` or `run-terminal` — as complete; a
not-started node whose dependencies are not all complete as blocked, naming each non-terminal
dependency with its node identifier, its target project, and its observed state in the same
refinement vocabulary the node line uses; and an `unknown` node as unknown with its diagnostic.
No node SHALL be silently dropped from the answer, and no reason SHALL name a state the
projection did not observe.

#### Scenario: A cancelled node exits with its reason visible

- **WHEN** the revision carries a `cancelled` node with a recorded reason
- **THEN** the ready answer names that node outside the set as cancelled with its recorded reason
- **AND** the node is not omitted from the answer

#### Scenario: A superseded node exits with its reason visible

- **WHEN** the revision carries a `superseded` node with a recorded reason
- **THEN** the ready answer names that node outside the set as superseded with its recorded reason
- **AND** the node's history remains queryable on the read surfaces that carry it

#### Scenario: An intent node is named pending Change creation

- **WHEN** the revision carries an intent node
- **THEN** the ready answer names it outside the set as pending Change creation with its target project and target line
- **AND** it is never a ready-set member, because no Change exists to run

#### Scenario: A blocked node names each blocker with project and state

- **WHEN** a not-started node depends on two nodes whose work is not complete, one targeting another member project
- **THEN** the node is reported outside the set as blocked, naming both blockers
- **AND** each blocker is named with its node identifier, its target project, and its observed state, cross-project blockers included

#### Scenario: A running node is named running, not excluded silently

- **WHEN** a wanted node's observation is `in-flight`
- **THEN** the ready answer names it outside the set as running with the in-flight observation
- **AND** its dependency facts, if any, are not reported as the reason — the observation is

#### Scenario: An unknown node is never ready

- **WHEN** a wanted not-started node's observation is `unknown` with a diagnostic
- **THEN** the node is reported outside the set as unknown with its diagnostic
- **AND** no ready-set membership is derived from unreadable facts

### Requirement: The ready answer surfaces on a read verb

`rasen store issue ready <issue-id>` SHALL report, for the Issue's latest readable revision,
the ready set with each member's node identifier, target project, target line, Change alias,
suggested pipeline when the revision records one, and lifecycle when it is not `required`,
beside every non-member with its reason as this capability defines. The answer SHALL carry the
run-state visibility label and the status problems the projection reports, because the ready
set is a view of one machine's evidence: a read from a directory that resolves no execution
root sees committed evidence only, and the answer SHALL say so rather than present absence as
a recorded state. The command SHALL refuse toward planning for an Issue with no readable
published revision, naming the planning phase and the publish action that precedes execution,
and SHALL schedule the latest revision only — addressing an older revision is the show and
confirm surfaces' concern. The `--json` form SHALL carry every fact the human form carries,
and the command SHALL write nothing: the Issue record, every revision, every run-state file,
and the workspace index are byte-identical before and after.

#### Scenario: Both forms carry the same facts

- **WHEN** an Issue with a readable plan is answered in human form and in `--json` form
- **THEN** the ready members and every non-member's reason are the same facts in both forms
- **AND** both carry the visibility label and the status problems

#### Scenario: An Issue without a plan is refused toward planning

- **WHEN** `rasen store issue ready` runs for an Issue with no readable published plan
- **THEN** the command refuses, naming the planning phase and the publish action that precedes execution

#### Scenario: The answer labels what it could see

- **WHEN** the ready answer is read from a directory that resolves no execution root
- **THEN** the answer labels that no local run-state was visible
- **AND** a node whose work is running elsewhere is not reported failed or complete on the strength of that absence

#### Scenario: Reading writes nothing

- **WHEN** `rasen store issue ready` runs to completion
- **THEN** the Issue record, every plan revision, every run-state file, and the workspace index are byte-identical before and after

### Requirement: The ready set is the frontier the start gate and confirm compose

The ready set SHALL be exactly the candidate set `rasen store issue start` computes when no
node is named — the nodes its several-candidates refusal names, and the single node whose
launch contract it emits when exactly one qualifies — and exactly the nodes `rasen store issue
confirm` composes a FRESH launch contract or an unprepared report for among its not-started
nodes, its resume-oriented contracts, report-only contracts, and unprepared reports for begun
nodes riding beside that equivalence and never inside it, so the ready read surface, the start
gate, and the confirm composition cannot disagree about what may run now. The membership SHALL
be one derivation with one writer that all three surfaces consume, and the equivalence SHALL be
pinned by tests so a change to any one surface cannot drift the others.

#### Scenario: The several-candidates refusal names exactly the ready set

- **WHEN** an Issue's plan has two runnable nodes and `store issue start` runs with no `--node`
- **THEN** the refusal names both nodes as candidates
- **AND** those candidates are exactly the ready set's members, node for node

#### Scenario: Confirm's launchable scope equals the ready set

- **WHEN** the same Issue's plan is confirmed
- **THEN** the nodes confirm composes fresh launch contracts for, together with the nodes it reports unprepared for a fresh launch, are exactly the ready set's members
- **AND** a begun node's resume-oriented or report-only contract, or its unprepared report, rides beside the equivalence, never inside it
- **AND** its pending and waiting classifications are non-members with the reasons this capability defines

### Requirement: Archived legacy work releases its dependents

A dependency whose Change is archived under a legacy record basis SHALL have its work read
complete for scheduling exactly as an outcome-bearing archived Change does — a legacy record
basis being an archive entry with no v2 outcome record — so a node downstream of
delivered-legacy work enters the ready set and no run-state mirror is required to release it:
the archive fact is the evidence, and a seed of already-delivered work is complete the day it
is seeded. A dependency whose v2 archive record exists but fails validation SHALL read
`unknown` with its status problem and keep gating its downstream, because damaged bytes never
release a gate.

#### Scenario: A seeded legacy dependency releases its downstream node

- **WHEN** a plan node depends on a Change whose archived evidence was seeded into the Store with a derived identity and carries no v2 outcome record, and no run-state for it exists anywhere the read can see
- **THEN** the dependency's work reads complete and the downstream node is in the ready set
- **AND** the ready answer names the legacy basis on the dependency's facts rather than presenting it as run-terminal

#### Scenario: A corrupt v2 archive record keeps gating

- **WHEN** a dependency's Change is archived and its archive record is in v2 shape but fails validation
- **THEN** the dependency reads `unknown` with a status problem naming the file and the reason
- **AND** its downstream nodes are reported blocked on it, never ready
