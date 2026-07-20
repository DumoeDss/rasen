# board-ui Specification

## Purpose
Provide a Kanban-style board page in the UI package that shows a project's active changes, grouped into lifecycle columns, sourced from the management API.

## Requirements
### Requirement: Board is the platform home and reachable from navigation
The board SHALL be the platform's home view, rendered at the root route `/`, while remaining available at `/board`. The shared layout's navigation SHALL offer an entry to the board from every view, so a user on the configuration page can reach the board without editing the URL.

#### Scenario: Root route renders the board
- **WHEN** the user opens the platform at `/` (as printed by `rasen ui`)
- **THEN** the board view renders as the landing page

#### Scenario: Board reachable from the config view
- **WHEN** the user is on the configuration page and activates the board navigation entry
- **THEN** the app navigates to the board view without a full reload or manual URL editing

#### Scenario: Legacy board path still valid
- **WHEN** the user opens `/board` directly
- **THEN** the board view renders, identical to the root route

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
The board page SHALL offer a "New change" affordance that opens an inline submission form (change name and description fields) without leaving the board. Submission SHALL go through the UI package's single API client seam to `POST /api/v1/changes`. On success the form SHALL close and the board SHALL refetch its data through the management API, so the new change appears as a real card sourced from disk — the board SHALL NOT optimistically inject a locally fabricated card. On failure the form SHALL remain open, editable, and display the CLI's error message from the response envelope verbatim. While a submission is in flight, the submit control SHALL be disabled.

#### Scenario: Successful submission shows the real new change
- **WHEN** the user submits a valid name and description from the board form
- **THEN** the form closes, the board refetches changes from the management API, and the newly created change appears as a card in the Planning column

#### Scenario: CLI failure surfaced verbatim
- **WHEN** the submission fails (e.g. duplicate change name) and the API returns the CLI's error
- **THEN** the form stays open with the user's input intact and displays the CLI error message as returned, not a generic failure notice

#### Scenario: Unauthorized submission follows the shared auth handling
- **WHEN** the submission request returns 401
- **THEN** the app switches to the full-screen re-launch notice, consistent with all other API calls

#### Scenario: Double submission prevented in the UI
- **WHEN** a submission is in flight
- **THEN** the submit control is disabled until the request settles
