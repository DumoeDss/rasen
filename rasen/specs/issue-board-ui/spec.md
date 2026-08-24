# issue-board-ui Specification

## Purpose
TBD - created by archiving change issue-read-surface. Update Purpose after archive.
## Requirements
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

### Requirement: Issue route transitions synchronously own their displayed state

The Issue Board and Issue Detail SHALL bind every loading, error, filter, refresh, and response
state to the full Store selector they currently display; Issue Detail SHALL additionally bind it to
the current Issue id. When one mounted route component transitions to another Store or Issue, the
new owner SHALL replace the prior owner's state before any prior response can render or commit.

#### Scenario: Board Store transition starts with the new owner

- **WHEN** one mounted Issue Board navigates from Store A to Store B before Store A's reads settle
- **THEN** Store A's cards, filter, errors, and late responses never appear under Store B's route
- **AND** the Board renders only Store B's fresh result

#### Scenario: Detail Issue transition starts with the new owner

- **WHEN** one mounted Issue Detail navigates between Issue or Store route parameters
- **THEN** the earlier Issue's projection, attention, refresh state, and provenance never appear
  under the later URL

#### Scenario: Returning to a route rebuilds mount-local interaction state

- **WHEN** a viewer leaves an Issue Board or Detail and later returns
- **THEN** its project filter and other mount-local interaction state start from their documented
  defaults and its displayed facts come from new reads

### Requirement: Every displayed Issue state family links to evidence provenance

The Issue Board and Issue Detail SHALL provide a visible evidence path for each displayed state
family: phase, health, progress, attention, plan/Change resolution, acceptance/review, runtime
attribution, and delivery. A state evidence link SHALL resolve within the Issue Detail to a
provenance entry carrying the exact Git or runtime locators and fingerprints supplied by the
projection payload. Missing, unreadable, divergent, or out-of-scope evidence SHALL resolve to an
explicit diagnostic provenance entry rather than an invented locator.

#### Scenario: Board state enters Detail provenance

- **WHEN** a viewer follows the evidence affordance for a card's phase, health, progress, or top
  attention item
- **THEN** the corresponding Issue Detail opens at the provenance entry for that state family

#### Scenario: Git provenance carries exact payload facts

- **WHEN** a displayed state is supported by Issue records, plan revisions, Store refs, acceptance
  records, archive records, commits, or structured evidence
- **THEN** its provenance entry carries the exact available revision, ref, path, content hash,
  commit, and evidence hash fields from the payload without normalizing filesystem paths

#### Scenario: Runtime provenance carries exact payload facts

- **WHEN** a displayed state is supported by an execution root, run-state path, evidence locator,
  Session, thread, or transcript
- **THEN** its provenance entry carries those exact runtime fields and identifies them as runtime
  evidence

#### Scenario: Unavailable provenance stays visible

- **WHEN** evidence is unreadable, divergent, incomplete, or outside the current run-state scope
- **THEN** the state still links to a provenance entry that names the reported gap and does not
  fabricate a file, ref, Run, Session, or successful conclusion

#### Scenario: A provenance link resolves exactly once

- **WHEN** the rendered Issue page is inspected
- **THEN** every state evidence fragment resolves to exactly one provenance entry in that page

### Requirement: Issue interactions hand work to the existing action owners

The Issue Board SHALL use Issue Detail as the destination for card inspection. Issue Detail SHALL
offer Store Operations for Run/Session inspection and authorized resume/retry/stop controls, and
Unlinked Changes for Change-to-Issue association work. The Issue read surface SHALL remain
read-only: these links SHALL NOT submit a mutation, infer an exact Run from a Change alias, or
construct a project-scoped Operations route.

#### Scenario: Card inspection opens Issue Detail

- **WHEN** a viewer activates an Issue card or one of its evidence affordances
- **THEN** the matching Store Issue Detail opens, optionally at its stable evidence anchor

#### Scenario: Runtime work opens Store Operations

- **WHEN** a viewer follows the Issue Detail action for runtime inspection or control
- **THEN** the same Store's `/operations` surface opens and no Run or member selector is guessed by
  the Detail page

#### Scenario: Association work opens Unlinked Changes

- **WHEN** a viewer follows the Issue Detail action for Change association work
- **THEN** the same Store's `/unlinked-changes` surface opens and the Detail page sends no Issue or
  plan mutation itself

### Requirement: Discarding client state rebuilds an equivalent evidence-backed view

The completed Issue interface SHALL persist no Issue status, provenance graph, association,
execution fact, or navigation choice as a second source of truth. When browser storage and caches
are discarded and the interface is remounted against unchanged Git/runtime evidence, fresh API
reads SHALL reconstruct an equivalent state-and-provenance view. When the underlying evidence has
changed, the rebuilt view SHALL reflect that change without a client invalidation operation.

#### Scenario: Cache-cleared remount is equivalent

- **WHEN** local storage, session storage, browser caches, IndexedDB, and registered service-worker
  state for the UI origin are discarded while Git/runtime evidence remains unchanged
- **THEN** a remount performs fresh reads and reproduces the same normalized state values,
  provenance links, and evidence locators

#### Scenario: Fresh evidence changes the rebuilt view

- **WHEN** committed Store evidence changes between two cache-cleared mounts
- **THEN** the second view reflects the new projection without consulting or invalidating a client
  status cache

#### Scenario: Runtime visibility remains honest after rebuild

- **WHEN** runtime evidence is in scope on one rebuild or unavailable on another
- **THEN** the reconstructed provenance reports the corresponding execution root and runtime
  locators, or the explicit absence, exactly as the fresh payload does

#### Scenario: Rebuild issues no domain mutation

- **WHEN** the interface is cleared, remounted, refreshed, or traversed through evidence links
- **THEN** no Issue, Change, plan, Run, Session, Store, or project mutation is issued
