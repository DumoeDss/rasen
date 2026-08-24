# issue-board-ui Delta — issue-read-surface

## ADDED Requirements

### Requirement: The Issue Board renders one card per Issue in the five phase lanes

The Issue Board SHALL render a store space's Issues as exactly one card per Issue, each placed
in exactly one of five lanes named by the projection's closed phase vocabulary — planning,
ready, active, review, done — verbatim from the Issue's projected phase. The Board SHALL
present phase, health, and progress as three separate facts, never blended into a single
invented status. A card SHALL show the Issue's title and at most its single most important
attention item, taken first from the attention read's own fail-first ordering; a card SHALL
NOT list the Issue's Changes, nodes, or threads. The Board SHALL render Issues only — never a
Task, a Change, or any other abstraction dressed as an Issue.

#### Scenario: A card sits in the lane its projected phase names

- **WHEN** the Board renders an Issue whose projected phase is any of the five vocabulary
  values
- **THEN** the Issue's card appears in the lane of that name and in no other lane
- **AND** all five lanes are present even when empty

#### Scenario: The three axes stay separate on the card

- **WHEN** a card renders an Issue whose projection carries a phase, a health, and a progress
- **THEN** the card presents each as its own fact — lane placement for phase, a distinct
  health indicator, and the completed-over-total progress pair — with no value computed by
  the Board itself

#### Scenario: The card carries its most important attention item

- **WHEN** the attention scan reports items for an Issue
- **THEN** the Issue's card shows the first item in the scan's own ordering and no others
- **AND** an Issue with no attention items shows no attention line

#### Scenario: A card links to its Issue's detail

- **WHEN** a viewer follows an Issue card
- **THEN** the Issue Detail surface for that Issue is presented

### Requirement: The Board surfaces incompleteness and divergence instead of hiding them

The Board SHALL surface every incompleteness fact its payloads report: aggregate problems, an
incomplete scan, unsearched refs, a divergent or unreadable Issue record, an uncommitted-only
record, and absent live-run visibility. An Issue that could not be fully read SHALL still
appear, carrying the reported reason — it SHALL NOT be silently dropped, and its gaps SHALL
NOT be filled with invented values.

#### Scenario: An unreadable or divergent Issue still appears

- **WHEN** the projection list reports an Issue whose record is null with a diagnostic or a
  divergence
- **THEN** the Issue's card appears carrying the reported reason instead of a fabricated
  title or state

#### Scenario: Incomplete scans are announced

- **WHEN** a payload reports problems, an incomplete scan, or unsearched refs
- **THEN** the Board presents a visible notice carrying those facts

#### Scenario: Absent live-run visibility is disclosed

- **WHEN** the payload's run-state visibility reports that no execution root was in scope
- **THEN** the Board discloses that live-run facts were not part of the derivation

### Requirement: Member-project chips filter the Board without repartitioning it

The Board SHALL offer the store's member projects as chips that filter which cards are
visible, defaulting to all. Chips SHALL be a filter only: selecting one SHALL NOT regroup the
lanes, reassign cards, or become an ownership partition — lanes remain phase lanes under any
selection — and the selection SHALL NOT persist beyond the page.

#### Scenario: A chip narrows the visible cards

- **WHEN** a viewer selects a member-project chip
- **THEN** only cards of Issues whose projection carries a lane for that project remain
  visible, each still in its phase lane

#### Scenario: The filter does not persist

- **WHEN** the Board is left and revisited
- **THEN** the chip selection is back to all, because no selection was persisted

### Requirement: The Issue Detail presents the projection's full read surface

The Issue Detail SHALL present, for one Issue, the facts of the single-Issue projection read
and the narrowed attention read, organized as: the Issue's background and acceptance (record
content, acceptance conditions, gate evaluation, accepted record); the Execution Plan's nodes
with their lifecycle, observation, target project and line, and any suggestion or rationale,
plus the revision delta when a predecessor exists; the Changes grouped by member project with
each group's own progress; the cross-project dependency facts (each node's blockers with their
project and state labels); the run and session attribution and the delivery evidence, per node
and as the rolled-up counts; the review determination and its threads; and the Issue's needs
attention items. Every displayed fact SHALL come verbatim from a payload field.

#### Scenario: The detail sections render the payload's facts

- **WHEN** the Detail renders an Issue whose projection carries acceptance facts, plan nodes,
  project lanes, delivery evidence, and a review view
- **THEN** each section presents its facts from the corresponding payload fields, and no
  section invents, re-derives, or omits a reported value

#### Scenario: Cross-project dependencies show the projection's blocker facts

- **WHEN** a plan node carries blockers into other member projects
- **THEN** the Detail presents each blocker with the node, project, and state label the
  projection reported

#### Scenario: An Issue with problems still presents its read

- **WHEN** the single-Issue read reports problems — an unreadable plan or incomplete
  evidence
- **THEN** the Detail renders what was derived and presents the problems beside it

### Requirement: The Issue read surface holds no second state

The Issue Board and Issue Detail SHALL fetch their payloads from the projection endpoints on
navigation and on explicit refresh, and SHALL hold no other source of Issue truth: no status
fact SHALL be persisted client-side, cached across pages, or computed from other facts. Every
displayed state SHALL be traceable to a field of a projection payload, so discarding and
rebuilding any client cache reproduces a consistent view by construction.

#### Scenario: Refresh re-derives from the server

- **WHEN** a viewer refreshes the Board or Detail
- **THEN** the surface re-fetches its payloads and renders the fresh facts, reusing nothing
  from before

#### Scenario: Nothing is persisted to rebuild

- **WHEN** the Board or Detail renders
- **THEN** no Issue status fact is written to any client storage, so a cleared client starts
  from the same server truth

#### Scenario: Displayed values equal payload values

- **WHEN** the Board or Detail renders a payload
- **THEN** every displayed axis, count, label, and item equals the corresponding payload
  field's value

### Requirement: The Issue read surface is reachable from store-space navigation

A store space's navigation SHALL offer the Issue Board, and each Issue's Detail SHALL be
addressable by its own URL within the store space, so a specific Issue's read can be shared
and revisited directly. Project spaces SHALL NOT offer the Issue surface — Issues live in
stores.

#### Scenario: A store space navigates to its Board

- **WHEN** a viewer is in a store space
- **THEN** the navigation offers the Issues section and it presents that store's Board

#### Scenario: A deep link lands on the Detail

- **WHEN** a viewer opens an Issue Detail URL directly
- **THEN** the Detail for that store's Issue renders without visiting the Board first

#### Scenario: A project space offers no Issue surface

- **WHEN** a viewer is in a project space
- **THEN** the navigation offers no Issues section
