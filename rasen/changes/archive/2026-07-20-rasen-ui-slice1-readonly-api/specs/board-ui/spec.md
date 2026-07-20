# board-ui

## ADDED Requirements

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
