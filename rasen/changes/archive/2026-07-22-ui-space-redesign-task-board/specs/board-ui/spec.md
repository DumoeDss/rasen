## ADDED Requirements

### Requirement: Board groups changes into Tasks

The board SHALL group the selected planning space's active changes into Tasks, where a Task is the redesign's unit of intent. A **portfolio** — a change directory carrying a `planning-context.md` whose children exist as `<parent>-<slice>` sibling changes — SHALL render as ONE Task whose constituent changes are its children; the portfolio container itself SHALL be recognized from the membership fact reported by the management API (the child changes carry it), since the container directory holds no `proposal.md` and is absent from the active-change listing. A **bare change** with no portfolio container SHALL render as an implicit single-item Task with no wrapper ceremony — its id and label are the change's own name. Task cards SHALL NOT be draggable: the board is a read-only status-grouped view derived from workspace files, not a kanban.

#### Scenario: Portfolio changes collapse into one Task

- **WHEN** the board loads a space whose active changes include `redesign-api`, `redesign-shell`, and `redesign-board`, and a sibling directory `redesign/` carries a `planning-context.md`
- **THEN** the three changes appear as one Task labeled `redesign` with those three as its children, not as three separate cards

#### Scenario: Bare change is an implicit single-item Task

- **WHEN** the board loads a space with an active change `fix-login` that has no portfolio container
- **THEN** `fix-login` appears as its own single-item Task with no portfolio wrapper

#### Scenario: Coincidental name prefix does not fabricate a Task

- **WHEN** two changes share a leading name segment (for example `store-add-project` and `store-project-namespace`) but no `store/` directory with a `planning-context.md` exists
- **THEN** they appear as two separate single-item Tasks, not grouped under a phantom `store` Task

#### Scenario: Cards are not draggable

- **WHEN** a user attempts to drag a Task card between columns
- **THEN** the card does not move columns, because a Task's column is derived from its changes' state, not set by direct manipulation

### Requirement: Task lifecycle column is derived from the Task's changes

The board SHALL place each Task in exactly one of the four lifecycle columns — Planning, Ready, In Progress, Done — derived from its constituent changes and never from a persisted Task-status field. A portfolio Task's column SHALL aggregate its children's per-change lifecycle columns by precedence: any child In Progress → In Progress; else any child Ready → Ready; else any child Planning → Planning; else (every child Done) → Done. A single-item Task's column SHALL be its one change's derived column. An escalation on any child's run SHALL be reported on the Task as a badge while the Task remains in its derived column, never as a fifth column.

#### Scenario: Portfolio in progress when any child is in progress

- **WHEN** a portfolio Task has children spanning planning, ready, and in-progress states
- **THEN** the Task appears in the In Progress column

#### Scenario: Portfolio still planning when a child remains in planning

- **WHEN** a portfolio Task has one child Done and one child in Planning, with none in Ready or In Progress
- **THEN** the Task appears in the Planning column, because there is still planning work

#### Scenario: Portfolio Done only when every child is Done

- **WHEN** every one of a portfolio Task's children is in the Done column
- **THEN** the Task appears in the Done column

#### Scenario: Single-item Task takes its change's column

- **WHEN** a single-item Task's one change is apply-ready with no tasks done and no active run
- **THEN** the Task appears in the Ready column, matching that change's own lifecycle column

#### Scenario: Escalation shown as a badge, not a column

- **WHEN** any child of a Task has a run state with an escalated stage
- **THEN** the Task's card shows an escalation badge while the Task stays in its derived lifecycle column

### Requirement: Task card shows child progress, a live-run indicator, and a link to Task detail

A Task card SHALL show the Task's progress, a live-run indicator, and a link to the Task detail route. For a portfolio Task the progress SHALL be its child-change completion (for example "2/3 changes"); for a single-item Task it SHALL be that change's own task-checkbox progress (for example "4/6 tasks"). When a live session (a session in a starting, running, or exiting state) targets one of the Task's changes, the card SHALL show a live-run indicator and the running session's current stage; when no live session targets the Task, no live-run indicator SHALL be shown. The card SHALL link to the Task detail route for that Task, built through the shared space-scoped link helper so the opaque space token and the Task id round-trip unchanged.

#### Scenario: Portfolio progress counts child changes

- **WHEN** a portfolio Task has three children on the board of which two are in the Done column
- **THEN** its card shows child-change progress such as "2/3 changes"

#### Scenario: Single-item Task shows task-checkbox progress

- **WHEN** a single-item Task's change has six tasks with four completed
- **THEN** its card shows "4/6 tasks"

#### Scenario: Live-run indicator with current stage

- **WHEN** a live session targets one of a Task's changes and its run reports a current stage
- **THEN** the Task card shows a live-run indicator and that stage

#### Scenario: No live-run indicator when nothing is running

- **WHEN** no live session targets any of a Task's changes
- **THEN** the Task card shows no live-run indicator, regardless of stale run files on disk

#### Scenario: Card links to the Task detail route

- **WHEN** a user activates a Task card
- **THEN** the app navigates to that Task's detail route within the current space, without editing the URL by hand

### Requirement: Store space board offers a member chip filter

When the board renders a store space, it SHALL offer a member chip row built from the store's members as reported by the spaces listing: an "All" chip (selected by default, showing the full member rollup) plus one chip per member. Selecting a member SHALL narrow the board to the Tasks attributed to that member; selecting "All" SHALL restore the full rollup. Member attribution SHALL be derived from session provenance — a Task is attributed to a member when it has a session whose working directory lies within that member's root — introducing no new persisted state. A Task with no attributing session SHALL appear only under "All". A project space board SHALL NOT render a member chip row.

#### Scenario: Store board renders All plus a chip per member

- **WHEN** the board loads a store space whose spaces-listing entry has two members
- **THEN** a chip row shows "All" (selected) and one chip for each of the two members

#### Scenario: Selecting a member narrows the board

- **WHEN** the user selects a member chip and a Task has a session whose working directory is within that member's root
- **THEN** the board shows that Task and hides Tasks with no session attributed to that member

#### Scenario: Unattributed Task appears only under All

- **WHEN** a Task has no session run for any of its changes
- **THEN** it appears when "All" is selected and is hidden under every specific member chip

#### Scenario: Project space has no chip row

- **WHEN** the board loads a project space
- **THEN** no member chip row is rendered

## MODIFIED Requirements

### Requirement: Board-embedded change submission with real-result feedback

The board page SHALL offer a "New change" affordance that opens an inline submission form (change name and description fields) without leaving the board. Submission SHALL go through the UI package's single API client seam to `POST /api/v1/changes`, scoped to the board's currently viewed planning space — the request SHALL carry the current space selector so the new change is created in the space the user is viewing, not the daemon's launch project. On success the form SHALL close and the board SHALL refetch its data through the management API, so the new change appears as a real card sourced from disk — the board SHALL NOT optimistically inject a locally fabricated card. On failure the form SHALL remain open, editable, and display the CLI's error message from the response envelope verbatim. While a submission is in flight, the submit control SHALL be disabled.

#### Scenario: Successful submission shows the real new change

- **WHEN** the user submits a valid name and description from the board form
- **THEN** the form closes, the board refetches changes from the management API, and the newly created change appears as a card in the Planning column

#### Scenario: New change lands in the viewed space

- **WHEN** the user submits a new change from a board scoped to a store space or a project other than the daemon's launch project
- **THEN** the submission carries that space's selector and the change is created in that space, not in the daemon's launch project

#### Scenario: CLI failure surfaced verbatim

- **WHEN** the submission fails (e.g. duplicate change name) and the API returns the CLI's error
- **THEN** the form stays open with the user's input intact and displays the CLI error message as returned, not a generic failure notice

#### Scenario: Unauthorized submission follows the shared auth handling

- **WHEN** the submission request returns 401
- **THEN** the app switches to the full-screen re-launch notice, consistent with all other API calls

#### Scenario: Double submission prevented in the UI

- **WHEN** a submission is in flight
- **THEN** the submit control is disabled until the request settles
