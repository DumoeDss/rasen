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

The project Board page SHALL offer a "New change" affordance that opens an inline submission form
(change name and description fields) without leaving the Board. Submission SHALL go through the UI
package's single API client seam to `POST /api/v1/changes`, scoped to the currently viewed project.
On success the form SHALL close and the Board SHALL refetch its data through the management API, so
the new Change appears as a real card sourced from disk; the Board SHALL NOT optimistically inject a
locally fabricated card. On failure the form SHALL remain open, editable, and display the CLI's
error message from the response envelope verbatim. While a submission is in flight, the submit
control SHALL be disabled. A Store Issue Board SHALL NOT expose this raw Change-only submission;
Store viewers SHALL use Unlinked Changes when creating a new single-Change Issue.

#### Scenario: Successful submission shows the real new change

- **WHEN** the user submits a valid name and description from a project Board form
- **THEN** the form closes, the Board refetches Changes, and the newly created Change appears as a
  real Planning card

#### Scenario: New change lands in the viewed space

- **WHEN** the user submits a new Change from a project Board other than the daemon's launch project
- **THEN** the request carries that project's selector and creates the Change there

#### Scenario: Store Issue Board offers no raw Change submission

- **WHEN** the user opens `/s/<storeId>/issues`
- **THEN** no project Change submission form is offered and the Unlinked Changes surface remains the
  explicit path for creating a single-Change Issue

#### Scenario: CLI failure surfaced verbatim

- **WHEN** submission fails, for example because the Change name already exists
- **THEN** the form stays open with the user's input intact and displays the returned CLI error

#### Scenario: Unauthorized submission follows the shared auth handling

- **WHEN** the submission request returns 401
- **THEN** the app switches to the full-screen re-launch notice consistently with other API calls

#### Scenario: Double submission prevented in the UI

- **WHEN** a submission is in flight
- **THEN** the submit control remains disabled until the request settles

### Requirement: Board is the space-scoped home and reachable from navigation

The Task/Change Board SHALL be the home view for a selected project space at
`/p/<projectId>/board`; its project root `/p/<projectId>` SHALL redirect there and project
navigation SHALL offer Board from every project view. The Issue Board SHALL be the home view for a
selected Store at `/s/<storeId>/issues`; its Store root `/s/<storeId>` and a legacy
`/s/<storeId>/board` URL SHALL replace-redirect there, and Store navigation SHALL offer Issues
instead of the Task/Change Board. The root route `/` SHALL resolve a planning space and redirect to
the canonical home for that space's namespace.

#### Scenario: Space board route renders the board

- **WHEN** the user opens `/p/<projectId>/board`
- **THEN** the project Task/Change Board renders as that project's landing page

#### Scenario: Space root redirects to the board

- **WHEN** the user opens `/p/<projectId>` with no section
- **THEN** the app replace-redirects to `/p/<projectId>/board`

#### Scenario: Store root redirects to Issues

- **WHEN** the user opens `/s/<storeId>` with no section
- **THEN** the app replace-redirects to `/s/<storeId>/issues`

#### Scenario: Legacy Store Board redirects without rendering duplicate truth

- **WHEN** the user opens `/s/<storeId>/board`
- **THEN** the app replace-redirects to `/s/<storeId>/issues` and never mounts the Task/Change Board

#### Scenario: Root route redirects to a space board

- **WHEN** the user opens `/` and the shell resolves a project or Store planning space
- **THEN** it redirects respectively to the project Board or Store Issue Board

#### Scenario: Navigation exposes only the matching Board owner

- **WHEN** the viewer is in a project or Store space
- **THEN** project navigation offers Board while Store navigation offers Issues and no Store Board
  entry

#### Scenario: Board reachable from the config view

- **WHEN** the user is on Config within a project or Store space and activates its canonical home
  navigation entry
- **THEN** the app navigates to the project Board or Store Issue Board without a full reload or
  manual URL editing

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

### Requirement: Cross-project Issues are a Store-level view whose nodes reference project changes

The operations UI SHALL present a Store's Issues as a Store-level view, not inside any project's view,
and each Issue SHALL show its state and the Changes its current Execution Plan references, together
with the project each referenced Change belongs to. A referenced Change the Store cannot read SHALL be
shown as unreadable rather than omitted.

#### Scenario: An Issue shows what it references and where

- **WHEN** an Issue with a published plan is viewed
- **THEN** each referenced Change is shown with the project it belongs to

#### Scenario: An unreadable reference is shown, not hidden

- **WHEN** a referenced Change cannot be read
- **THEN** it is shown as unreadable with the reason
- **AND** it is not silently dropped from the view

### Requirement: An aggregate view never submits a mutation with an incomplete scope

A mutation initiated from a Store-level or aggregate view SHALL carry its complete scope — Store,
project, and target line. The view SHALL NOT fill a missing part from the current selection, the only
visible candidate, or the item's position in a list, and SHALL make the mutation unavailable until the
scope is complete rather than submit and let the server refuse.

#### Scenario: An incomplete scope blocks the mutation in the view

- **WHEN** the scope needed for a mutation is not fully determined in an aggregate view
- **THEN** the mutation is unavailable in that view
- **AND** no request with a partial scope is sent

#### Scenario: A sole visible candidate is not adopted as scope

- **WHEN** exactly one project is visible in the view and the mutation's project is undetermined
- **THEN** that project is not adopted as the scope

