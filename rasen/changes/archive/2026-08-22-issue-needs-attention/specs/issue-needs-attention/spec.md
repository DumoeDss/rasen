# issue-needs-attention Specification — Delta

## ADDED Requirements

### Requirement: Attention items derive through the projection with one closed vocabulary

The attention derivation SHALL compute, for an Issue whose status a read derived, exactly the
items a human must act on, drawn from one closed vocabulary and from the status projection's
own facts alone — persisted nowhere, identical over unchanged evidence. The kinds are:
`failure`, for a node the plan still wants whose observation is `failed`; `blocked-behind`,
for a wanted not-started node at least one of whose direct dependencies observes `failed`,
`waiting-human`, or `unknown`, named with every non-terminal direct dependency and its
observed state; `waiting-human`, for a wanted node whose observation is `waiting-human`;
`acceptance-awaiting`, for an Issue whose phase is `review` — an open Issue whose required
work stands complete, or a resolved Issue without a verified acceptance record — carrying
whether the acceptance gate holds and its blockers when it does not; and `problem`, for every
standing status problem the projection reported, with its kind, node, ref, and reason. Every
item SHALL carry its Issue's identifier, the node it names where it names one, and the Issue's
phase and health beside the fact, so an item never needs a second read to explain its
context.

#### Scenario: A failed node among running siblings is a failure item

- **WHEN** an Issue's plan carries two wanted nodes in flight and one wanted node whose run-state records a failure escalation
- **THEN** the attention derivation reports one `failure` item for the failed node
- **AND** the item carries the Issue's `active` phase and `failed` health beside the node's identity, so the failure reads unmasked

#### Scenario: A node blocked behind trouble is a blocked-behind item

- **WHEN** a wanted not-started node's direct dependency observes `failed` or `unknown`
- **THEN** the derivation reports a `blocked-behind` item for the downstream node, naming that dependency with its node identifier, target project, and observed state
- **AND** the item names every other non-terminal direct dependency the same way

#### Scenario: A parked stage is a waiting-human item

- **WHEN** a wanted node's run-state records a stage parked as escalated for a human decision
- **THEN** the derivation reports a `waiting-human` item for that node
- **AND** the item carries the Issue's health, which the projection already reads `waiting-human`

#### Scenario: An Issue in review is acceptance-awaiting

- **WHEN** an open Issue's every required node's work is complete and no verified acceptance record exists
- **THEN** the derivation reports one `acceptance-awaiting` item for the Issue, carrying that the gate holds and acceptance is the human's next act
- **AND** a resolved Issue without a verified record reports the same item, the legacy-close upgrade path it is

#### Scenario: Every standing problem is an item

- **WHEN** a read reports an invalid run-state on one node and an unresolved reference on another
- **THEN** the derivation reports one `problem` item per problem, each with its kind, node, ref, and reason
- **AND** no problem the projection reported is dropped from the attention answer

### Requirement: Ordinary progress is not attention

The derivation SHALL NOT report attention items for work that needs no human: a wanted node
whose observation is `in-flight`, `advanced`, `run-terminal`, or `finalized`; a not-started
node whose every dependency's work is complete (a ready node); and a not-started node blocked
only on dependencies that are themselves ordinary progress — not-started or healthy in-flight
without any attention-worthy observation — because serial sequencing is scheduling, not
sickness, exactly as the health axis already provides. Absence from the attention items SHALL
never be presented as absence from view: the answer's scan summary names every Issue it
scanned with its phase, health, and item count, so healthy in-flight work is visible as
scanned and honestly unlisted, and a store where nothing needs attention reports that state
explicitly rather than an empty silence.

#### Scenario: A healthy in-flight Issue contributes no items but stays visible

- **WHEN** an Issue's wanted nodes are all in flight and healthy and the attention answer is derived
- **THEN** no attention item names any of its nodes
- **AND** the scan summary lists the Issue with its `active` phase, `healthy` health, and zero items

#### Scenario: A serial wait is not attention

- **WHEN** a not-started node's only dependency is a healthy in-flight sibling
- **THEN** the node contributes no attention item
- **AND** its wait remains visible on the Issue's own read surface, where dependency facts belong

#### Scenario: An honestly empty answer

- **WHEN** every Issue of a store is scanned and none yields an attention item
- **THEN** the answer says that no Issue needs attention and names how many it scanned
- **AND** the empty state is a stated fact, not a blank line or an error

### Requirement: A failure is never masked by the aggregation

The attention answer SHALL order and group so that failure surfaces first: `failure` items
before `blocked-behind` items, before `waiting-human` items, before `acceptance-awaiting`
items, before `problem` items, and within every group the items in a stable order by Issue
identifier and node identifier. The grouping and the per-item phase-and-health context SHALL
together guarantee the unmasked read: an Issue whose health is `failed` appears through its
failure items with the failed health beside an `active` phase even while its siblings run,
and no grouping, count, or summary SHALL present such an Issue as merely busy. A scan summary
SHALL NOT replace the items: counts may summarize the answer, but every item remains listed
in full in both the human and `--json` forms.

#### Scenario: The failed Issue leads the answer

- **WHEN** a store scan covers one Issue with a failed node among running siblings and another Issue parked waiting for a human
- **THEN** the failed Issue's failure item appears before the parked Issue's waiting-human item
- **AND** each item carries its own Issue's phase and health, so the failed-but-active Issue never reads as merely active

#### Scenario: Counts summarize without replacing

- **WHEN** the attention answer carries items of several kinds
- **THEN** the answer may carry per-kind counts in its summary
- **AND** every item is still listed in full in both forms, with no item reduced to a tally

### Requirement: The attention answer surfaces on a store read verb

`rasen store attention` SHALL scan every Issue of the resolved Store — each through its
latest readable revision and the same status composition the Issue read surface uses — and
report the scan summary followed by the attention items grouped and ordered as this
capability defines, in human and `--json` forms carrying the same facts. `--issue <issue-id>`
SHALL narrow the scan to one Issue, and the command SHALL refuse an Issue identifier the
Store does not know rather than report an empty scan. The answer SHALL carry the run-state
visibility discipline the per-Issue reads enforce: an Issue whose run-state is not visible on
this machine derives from committed evidence only, and its items say so rather than present
absence as a recorded state. The command SHALL write nothing — Issue records, revisions,
run-state files, and the workspace index are byte-identical before and after — and the same
scan over unchanged evidence SHALL yield the same answer.

#### Scenario: Both forms carry the same facts

- **WHEN** a store scan with attention items runs in human form and in `--json` form
- **THEN** the scan summary, the grouped items, and every item's context are the same facts in both forms

#### Scenario: Narrowing to one Issue

- **WHEN** `rasen store attention --issue <id>` runs for a known Issue
- **THEN** the answer scans that Issue alone, with the same summary and item discipline
- **AND** an unknown identifier is refused, never read as an empty store

#### Scenario: The scan respects run-state visibility

- **WHEN** the scan runs from a directory that resolves no execution root for an Issue whose attention would depend on run-state
- **THEN** the derived items say what was visible, per the visibility discipline the per-Issue reads enforce
- **AND** absence of run-state is not presented as a recorded failure or completion

#### Scenario: Scanning writes nothing

- **WHEN** `rasen store attention` runs to completion
- **THEN** every Issue record, plan revision, run-state file, and the workspace index are byte-identical before and after
