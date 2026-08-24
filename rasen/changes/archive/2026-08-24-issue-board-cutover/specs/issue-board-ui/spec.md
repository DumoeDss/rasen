# issue-board-ui Delta — issue-board-cutover

## ADDED Requirements

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
