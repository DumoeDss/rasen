# board-ui Specification

## Purpose
Provide a Kanban-style board page in the UI package that shows a project's active changes, grouped into lifecycle columns, sourced from the management API.
## Requirements
### Requirement: Kanban board renders active changes in lifecycle columns
The UI package SHALL provide a board page at the `/board` route that displays the project's active changes as cards grouped into lifecycle columns — Planning, Ready, In Progress, and Done — derived from each change's artifact completion, task progress, and run state. The board SHALL render real data fetched from the management API; it never shows placeholder or fabricated changes.

#### Scenario: Changes grouped by lifecycle
- **WHEN** the board loads for a project whose changes span planning, apply-ready, partially implemented, and fully implemented states
- **THEN** each change appears as a card in exactly one column matching its state (artifacts incomplete → Planning; apply-ready with no tasks done and no active run → Ready; tasks underway or a run in progress → In Progress; all tasks complete → Done)

#### Scenario: Card content
- **WHEN** a change card is rendered
- **THEN** it shows the change name, schema name, task progress (completed / total), and a run indicator when run state exists for that change

#### Scenario: Escalated run badge
- **WHEN** a change's run state contains an escalated stage
- **THEN** its card displays an escalation badge while remaining in its lifecycle column

#### Scenario: Empty project
- **WHEN** the project has no active changes
- **THEN** the board shows an explicit empty state, not a blank page

### Requirement: Board data agrees with the workflow's active-change definition
The board SHALL present change data sourced exclusively from the management API, which enumerates changes through the same source of truth as `rasen status` — the `getActiveChangeIds` definition, which requires a `proposal.md` in the change directory. For the same project state, the set of changes and their statuses on the board SHALL match that definition. A change directory that holds only planning documents and no `proposal.md` is intentionally absent from the board, because no workflow command (`status`, `validate`, `archive`, the instruction loader) can act on it. The board SHALL NOT be widened to reproduce `rasen list`'s bare directory scan, which is the outlier definition.

#### Scenario: Parity with the active-change definition
- **WHEN** the board and `rasen status` are consulted for the same project at the same time
- **THEN** they show the same set of active changes with consistent status information

#### Scenario: Planning-only directory absent from the board
- **WHEN** a directory under `rasen/changes/` contains planning documents but no `proposal.md`
- **THEN** it does not appear on the board, matching `rasen status` rather than `rasen list`

### Requirement: Board uses the shared API seam and auth handling
All board data fetching SHALL go through the UI package's single API client seam, inheriting bearer-token injection and unauthorized handling; a 401 during board fetches SHALL surface the existing re-launch notice rather than a broken board.

#### Scenario: Token expiry on the board
- **WHEN** a board API call returns 401
- **THEN** the app switches to the full-screen re-launch notice, consistent with the config page's behavior

#### Scenario: Fetch failure
- **WHEN** a board API call fails for a non-auth reason
- **THEN** the board shows an error state with the failure message instead of rendering partial or stale content silently

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

### Requirement: Board is the space-scoped home and reachable from navigation
The board SHALL be the platform's home view for the selected planning space, rendered at the space-scoped route `/p/<projectId>/board` for a project space and `/s/<storeId>/board` for a store space; the space root route (`/p/<projectId>` or `/s/<storeId>`) SHALL redirect to that space's board. The root route `/` SHALL NOT render the board directly; it SHALL resolve a planning space (per the management-ui-shell capability's bootstrap rule) and redirect to that space's board route. The shared layout's navigation SHALL offer an entry to the board within the current space from every view, so a user on the configuration page can reach the board without editing the URL.

#### Scenario: Space board route renders the board
- **WHEN** the user opens `/p/<projectId>/board` (as reached from the URL `rasen ui` prints)
- **THEN** the board view renders as the landing page for that project space

#### Scenario: Root route redirects to a space board
- **WHEN** the user opens the platform at `/`
- **THEN** the app resolves a planning space and redirects to that space's board route rather than rendering the board at `/`

#### Scenario: Board reachable from the config view
- **WHEN** the user is on the configuration page within a space and activates the board navigation entry
- **THEN** the app navigates to that space's board view without a full reload or manual URL editing

#### Scenario: Space root redirects to the board
- **WHEN** the user opens a space root route such as `/p/<projectId>` with no section
- **THEN** the board view renders, identical to the space's `…/board` route

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

### Requirement: Project space board shows worktrees and switches its data source

When a project space's repository has more than one worktree (per the live worktree inventory), the board SHALL render a worktrees panel listing each worktree with its path tail, checked-out branch, active-change count, and a live-session count derived from session provenance (sessions whose working directory lies within that worktree's root — the same attribution rule as the store board's member chips, introducing no new persisted state). The panel SHALL let the user switch the board's data source to a specific worktree: the board's changes and runs then reflect that worktree's own branch-local planning state, addressed through the worktree's root path selector. The default data source SHALL be the main checkout. Exactly one worktree's state SHALL be shown at a time — the board SHALL NOT aggregate changes across worktrees, because same-named changes on different branches would misrepresent each other. The selected worktree SHALL be carried in the board route's query string so it survives a reload, while the space identity (route prefix, pins, header switcher, session space attribution) remains the project's — a worktree is never a separate space. A project space with a single worktree, a non-git root, or an unavailable inventory SHALL render the board exactly as before, with no panel.

#### Scenario: Panel lists worktrees with per-worktree facts

- **WHEN** the board loads a project space whose repository has a main checkout and a linked worktree on branch `feat/x` with two active changes and one running session working inside it
- **THEN** a worktrees panel shows both worktrees with path tail and branch, `2` active changes and one live session on the `feat/x` worktree

#### Scenario: Board defaults to the main checkout

- **WHEN** the board loads a multi-worktree project space with no worktree selection in the URL
- **THEN** the changes and runs shown are the main checkout's

#### Scenario: Switching shows only that worktree's state

- **WHEN** the user selects a linked worktree in the panel
- **THEN** the board refetches and shows that worktree's branch-local changes and runs only, with no entries from any other worktree mixed in

#### Scenario: Switching keeps the previous board visible while the new source loads

- **WHEN** the user switches the board's data source between worktrees of one space
- **THEN** the previous source's board stays visible with a visible refreshing indication until the new source's data arrives, and the full-page loading state appears only on first load or when the space itself changes

#### Scenario: Selection survives reload without changing the space

- **WHEN** the user reloads the board after selecting a worktree
- **THEN** the same worktree's state is shown, the route's space prefix is unchanged, and the header switcher still shows the project space

#### Scenario: Single-worktree project shows no panel

- **WHEN** the board loads a project space whose repository has only its main checkout (or is not a git repository)
- **THEN** no worktrees panel is rendered and the board behaves exactly as before

### Requirement: The worktree strip reads as one structured control group

The board's worktrees panel SHALL present its worktrees as one visually structured control group: a labeled strip of uniform-height chips in a single aligned row (wrapping when space demands), where every chip presents its facts in the same fixed order — worktree name, checked-out branch, a main-checkout badge when applicable, the active-change count, and the live-session indicator when present. A chip missing an optional fact SHALL omit it without breaking the shared height or alignment. The selected chip SHALL remain clearly distinguished. This is a presentation contract only — the panel's data, selection behavior, and routing are unchanged.

#### Scenario: Chips align with a fixed anatomy

- **WHEN** the board shows several worktrees whose names, branches, and counts differ in length
- **THEN** all chips render at a uniform height in one aligned, labeled strip, each presenting its facts in the same order rather than as differently shaped free-floating pills

#### Scenario: Optional facts collapse cleanly

- **WHEN** one worktree is the main checkout with no live sessions and another is a linked worktree with live sessions
- **THEN** each chip shows only its applicable facts while both chips keep the same height and segment order

