# issue-operations-ui Specification

## Purpose
TBD - created by archiving change issue-operations-and-unlinked. Update Purpose after archive.
## Requirements
### Requirement: Store Operations prioritizes active and abnormal execution

The Store Operations surface SHALL present the supervised Sessions and reconciler Runs observable
for the Store's planning space and its current member projects. Sessions whose recorded state is
`starting`, `running`, or `exiting` SHALL appear as active. A Session SHALL appear as abnormal when
its joined run-state is unreadable, or when it exited without a successful `exit` termination and a
zero exit code. A Run SHALL present the status, waits, terminal, source, and error facts projected by
the Run API. Successfully settled history MAY be collapsed, but active and abnormal entries SHALL
remain directly visible and one source failure SHALL NOT erase successful entries from other
projects.

#### Scenario: Live Sessions appear as active

- **WHEN** a Store or member-project Session reports `starting`, `running`, or `exiting`
- **THEN** Operations shows it in the active Session collection with its recorded state

#### Scenario: Failed and unreadable Sessions appear as abnormal

- **WHEN** a Session exits unsuccessfully or its joined run-state reports an error or invalid state
- **THEN** Operations shows it in the abnormal collection carrying the recorded termination and
  run-state diagnostic facts

#### Scenario: Run facts remain server vocabulary

- **WHEN** Operations renders a reconciler Run
- **THEN** its Run id, status, waits or terminal, source state, Record version, and any per-Run error
  equal the Run API's projected fields

#### Scenario: One unavailable project does not blank Operations

- **WHEN** execution reads for one member project fail while another member's reads succeed
- **THEN** the successful member's Sessions and Runs remain visible and the unavailable member is
  named with its own retryable error

### Requirement: Operations keeps actual cwd, execution binding, and attribution distinct

Each Session SHALL show the actual process cwd recorded at launch as a machine-local locator and,
separately, the frozen execution selection: planning-only, a project identity and checkout, or an
explicit legacy/unknown absence. A cwd SHALL NOT be labelled or used as project authority. When one
stable Change entry matches the Session or Run's recorded Change alias and frozen execution project,
Operations SHALL show that Change's alias, instance identity, project, and target line; when the
evidence yields zero or several candidates, it SHALL report unavailable or ambiguous attribution and
select none. In a Store view, Issue attribution SHALL come only from the Store's Change-to-Issue link
read. An exact Run id SHALL be shown only for a Run record that carries it; a shared Change alias
SHALL NOT be presented as proof that a Session belongs to one of several Runs.

#### Scenario: Actual cwd is a locator beside the execution project

- **WHEN** a Session records cwd `C` and a frozen project execution `P`
- **THEN** Operations shows `C` as the actual process cwd and `P` as the execution project in
  separate fields, without deriving either from the other

#### Scenario: Planning-only remains explicit

- **WHEN** a Session's frozen execution is planning-only
- **THEN** Operations labels it planning-only and does not infer a project from its cwd, Change, or
  the Store's sole member

#### Scenario: One exact Change candidate is attributed

- **WHEN** a Session or Run names a Change alias and its execution project resolves that alias to
  exactly one stable Store Change instance
- **THEN** Operations shows that exact Change identity, project, and target line

#### Scenario: Ambiguous Change attribution selects none

- **WHEN** the available evidence yields multiple Change instances for a Session or Run's alias and
  execution project
- **THEN** Operations names the attribution as ambiguous and does not choose by target line,
  recency, cwd, or list order

#### Scenario: Issue and Run attribution require direct evidence

- **WHEN** a Change-to-Issue link read proves Issue links, or a Run summary carries a Run id
- **THEN** Operations displays those identities; when either fact is absent or unknown, it displays
  the named absence rather than manufacturing the association

### Requirement: Store Operations filters by current member project without changing truth

Operations SHALL offer the Store aggregate's current project roster as a local, non-persistent
filter, defaulting to all projects and retaining planning-only Store Sessions in the all view. A
member without a usable machine checkout SHALL remain in the roster with execution data marked
unavailable; its membership SHALL NOT be hidden and no root SHALL be invented. Filtering SHALL only
change which already-attributed entries are visible and SHALL NOT alter, relaunch, or reattribute an
execution.

#### Scenario: A project filter narrows Sessions and Runs

- **WHEN** an operator selects member project `P`
- **THEN** only Sessions and Runs whose frozen/project query attribution is `P` remain visible

#### Scenario: Filter selection is not persisted

- **WHEN** the Operations page is left and revisited
- **THEN** the filter returns to all projects and no project selection has been written to storage

#### Scenario: A member without a checkout remains visible

- **WHEN** the Store records a current member project for which this machine has no usable checkout
- **THEN** the filter roster still names that member and reports execution data unavailable without
  guessing a path

### Requirement: Operations submits only controls projected by the lifecycle APIs

Operations SHALL render Run actions only from the selected Run view's `allowedControls`. A retryable
infrastructure wait's projected resume control SHALL be presented as retry; another projected resume
control SHALL be presented as resume; Run cancel and live Session kill SHALL be presented as stop and
require a second explicit confirmation. A Run control request SHALL carry the displayed Change id,
Run id, wait/decision id where applicable, and expected Record version. Success and version conflict
SHALL replace the displayed state only from a fresh committed server view; the client SHALL NOT
optimistically advance, retry, stop, or relaunch anything.

#### Scenario: Retry and resume use the projected wait

- **WHEN** a Run view allows resume for a retryable infrastructure wait or another resumable wait
- **THEN** Operations offers retry or resume respectively and submits that control's exact Wait id

#### Scenario: Run stop confirms before cancel

- **WHEN** an operator chooses stop on a Run whose view allows cancel
- **THEN** no request is sent until confirmation and the confirmed request submits the projected
  cancel control with the displayed Record version

#### Scenario: Session stop confirms before kill

- **WHEN** an operator chooses stop on a killable live Session
- **THEN** no delete request is sent until confirmation and the response or already-gone result is
  followed by a fresh Session read

#### Scenario: A version conflict refetches committed truth

- **WHEN** a Run control is refused because its displayed Record version is stale
- **THEN** Operations refetches the Run detail and offers only the controls in the new committed view

#### Scenario: An unprojected action is absent

- **WHEN** a Run is terminal, belongs to another workspace, or otherwise projects no control
- **THEN** Operations offers no resume, retry, or stop action for that Run

### Requirement: Store Operations is directly reachable and holds no execution cache

A Store space SHALL expose Operations at its own stable route and navigation entry. The page SHALL
refresh its Session, Run, member-roster, and Change-to-Issue link inputs from their existing APIs,
with no persisted execution status or attribution cache. Project Task detail SHALL remain the
project-scoped operations surface; this change SHALL NOT create a second project-wide lifecycle.

#### Scenario: Store navigation reaches Operations

- **WHEN** a viewer is in a Store space
- **THEN** navigation offers Operations and its URL can be opened directly

#### Scenario: Refresh rebuilds Operations

- **WHEN** the viewer refreshes Operations
- **THEN** every displayed execution and attribution fact is rebuilt from fresh API responses

#### Scenario: Project navigation keeps its existing operations surface

- **WHEN** a viewer is in a project space
- **THEN** no Store Operations route is offered and Run controls remain reachable through Task detail
