# task-detail-ui Specification

## Purpose
Provide an independent Task-detail route page that resolves a portfolio or single-item Task and presents its children's lifecycle, progress, and dependency hints across the true roster, alongside the Task's sessions with live run control.
## Requirements
### Requirement: Task detail is an independent route page

The platform SHALL render a Task detail page at the space-scoped route `/p/<projectId>/task/<taskId>` and `/s/<storeId>/task/<taskId>`, reached from a board Task card. The page SHALL derive its planning space from the URL (the same opaque-token space the rest of the shell uses) and read all data scoped to that space. A change to the selected space that leaves this route SHALL fall back to that space's board, consistent with the shell's non-switchable sections.

#### Scenario: Opening a Task card shows its detail page

- **WHEN** a user clicks a Task card on the board for a portfolio Task named `P` in project space `X`
- **THEN** the app navigates to `/p/X/task/P` and the Task detail page renders for that Task within space `X`

#### Scenario: Detail data is read within the page's space

- **WHEN** the Task detail page loads for a Task in store space `S`
- **THEN** every roster and session read it issues carries the `store:S` space selector, so the page shows only that space's changes and sessions

#### Scenario: The page reads the Task id verbatim

- **WHEN** the route's Task-id segment is an opaque canonical id
- **THEN** the page uses it exactly as received (only percent-decoded), never re-cased or path-normalized, when requesting the Task's roster

### Requirement: The Task detail page resolves a portfolio Task or a single-item Task

The Task detail page SHALL handle a polymorphic Task id: either a portfolio container (grouping several child changes) or a single bare change. For a portfolio Task it SHALL present the full child roster; for a single-item Task it SHALL present that one change, with the children column degraded to that change's own task checklist. When the id names no known Task, the page SHALL show a clear not-found state rather than a blank page or a spinner.

#### Scenario: Portfolio Task lists its child changes

- **WHEN** the Task detail page opens for a portfolio container that groups several child changes
- **THEN** the children column lists each child change as its own row

#### Scenario: Single-item Task degrades to its own checklist

- **WHEN** the Task detail page opens for a bare change that belongs to no portfolio
- **THEN** the page presents that single change and its children column shows that change's task checklist

#### Scenario: Unknown Task id shows a not-found state

- **WHEN** the Task detail page opens for an id that matches no active, archived, or portfolio Task in the space
- **THEN** the page shows a labeled "Task not found" state

### Requirement: The children column shows lifecycle, progress, and dependency hints across the true roster

For each child change the children column SHALL show its derived lifecycle state, its task-checkbox progress, and any dependency hints declared for it. An archived child SHALL be shown as done. A portfolio Task's overall progress ("N/M changes") SHALL reflect the true roster — every child, active and archived — so it is accurate even when some children have been archived and no longer appear on the board. When no dependency information is declared for the Task, the column SHALL indicate that plainly rather than erroring.

#### Scenario: A child change shows its lifecycle and progress

- **WHEN** the children column renders an active child change with completed and total tasks
- **THEN** that child's row shows its lifecycle state and its task-checkbox progress

#### Scenario: Archived children count toward portfolio progress

- **WHEN** a portfolio Task has some children still active and some already archived
- **THEN** the archived children are shown as done and the "N/M changes" progress counts both active and archived children in the total

#### Scenario: Dependency hints are shown when declared

- **WHEN** a portfolio run has recorded that a child depends on one or more sibling children
- **THEN** that child's row shows those dependency hints

#### Scenario: No declared dependencies renders cleanly

- **WHEN** the Task has no recorded dependency information
- **THEN** the children column renders without error and does not imply false dependencies

### Requirement: The sessions column surfaces the Task's runs with live control

The Task detail page SHALL show, in a right column, the supervised sessions belonging to the Task — those whose linked change is one of the Task's children — with live sessions ordered before ended ones. Each session SHALL expose an expandable output tail and, while it is still live, a kill control that confirms before terminating. The page SHALL offer a Launch run action that starts a supervised run attributed to the page's space and pre-associated with the Task's change context.

#### Scenario: Live sessions are shown first

- **WHEN** the sessions column renders a Task that has both live and ended sessions
- **THEN** the live sessions appear before the ended ones

#### Scenario: Only the Task's own sessions appear

- **WHEN** the space has sessions linked to changes outside this Task
- **THEN** the sessions column shows only the sessions whose linked change is one of this Task's children

#### Scenario: Killing a live session confirms first

- **WHEN** a user clicks kill on a live session and confirms
- **THEN** the session is terminated and the column refreshes to reflect its ended state

#### Scenario: Launch run carries space and change context

- **WHEN** a user launches a run from a single-item Task detail page in space `X`
- **THEN** the launch is submitted with space `X` and the Task's change pre-filled as the run's linked change

### Requirement: A change's task checklist renders with progressive disclosure

When the Task detail page shows a single change's task checklist, it SHALL render the checklist as a structured card rather than a flat dump of every item: a summary header stating completed/total progress with a visual progress indication, open (unchecked) items always listed, and completed items collapsed behind an explicit disclosure whenever at least one item is completed — so a fully completed change reads as a compact summary until the user expands it. Inline code spans in task text (backtick-delimited) SHALL render as code rather than as literal backticks.

#### Scenario: Completed change reads as a summary

- **WHEN** the user opens the detail page of a change whose tasks are all completed (for example an archived change with 34/34 tasks done)
- **THEN** the checklist shows the progress summary with the completed items collapsed behind a disclosure, and expanding the disclosure reveals the full item list

#### Scenario: Open items stay visible

- **WHEN** a change has both completed and open tasks
- **THEN** the open items are listed without any extra interaction while the completed items sit behind the disclosure with their count named

#### Scenario: Inline code renders as code

- **WHEN** a task item's text contains backtick-delimited spans (file paths, identifiers)
- **THEN** those spans render in code styling without the literal backtick characters

### Requirement: The sessions column actions follow the button hierarchy

The sessions column's toolbar SHALL present launching a run as the column's primary action and refreshing as a quiet secondary action, with clear spacing between them — never two identically styled buttons pressed together.

#### Scenario: Launch and refresh are visually distinct

- **WHEN** the user views the sessions column of a Task detail page
- **THEN** the launch-run action renders as the primary action, the refresh action renders as a quiet action, and the two are visibly separated

