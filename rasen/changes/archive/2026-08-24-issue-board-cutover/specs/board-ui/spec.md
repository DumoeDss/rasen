# board-ui Delta — issue-board-cutover

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Store space board offers a member chip filter

**Reason**: The Task/Change Board is no longer a Store surface. Its Session-cwd member attribution is
superseded by the Issue Board's Store-roster filter and Store Operations' frozen-execution
attribution.

**Migration**: Store viewers filter Issues at `/s/<storeId>/issues` and execution at
`/s/<storeId>/operations`; project Boards retain their existing project/worktree behavior.

### Requirement: A layout v2 Store board groups its changes by project and target line

**Reason**: The final Store information architecture has no generic Change aggregate Board. Issues
own Store intent, Operations owns execution, and Unlinked Changes owns Changes that lack an Issue
association.

**Migration**: Use Issue Detail for Changes grouped by member project, Store Operations for
execution, Unlinked Changes for active/archived association gaps, and project Board for a single
project's Change/Task view.
