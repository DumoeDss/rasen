## ADDED Requirements

### Requirement: Sessions view lists live and ended sessions with run progress
The management UI SHALL provide a Sessions view, reachable from the platform navigation alongside Board and Config, listing every session the server reports — live and retained ended — with, per session: kind, task, lifecycle state, start and last-output times, and for ended sessions the termination reason and exit code or signal. When a session's listing entry carries a joined run-state with a parsed pipeline run, the entry SHALL render the pipeline's per-stage progress; a session without a linked change SHALL state that plainly rather than appearing stuck; an invalid run-state SHALL surface its reason. The view SHALL refresh itself on a short fixed cadence while open so state transitions appear without manual action, and SHALL keep a manual refresh affordance.

#### Scenario: Live session visible with pipeline progress
- **WHEN** a session launched with a change name is running and its change has a valid run-state on disk
- **THEN** the Sessions view shows the session as running with its per-stage pipeline progress, updating as stages complete without a manual refresh

#### Scenario: Ended session shows its terminal facts
- **WHEN** a session has ended for any reason
- **THEN** it remains listed with state exited, its termination reason, and its exit code or signal

#### Scenario: Session without a linked change is honest
- **WHEN** a session was launched without a change name
- **THEN** its entry states that no change is linked (with progress available on the board once the run creates one), not an empty or broken progress display

### Requirement: Session detail exposes recent output
A session entry SHALL expand to a detail view showing the bounded recent stdout and stderr the server retains for that session, refreshed on the same cadence while expanded, so a user can judge whether a quiet session is alive.

#### Scenario: Tails visible for a running session
- **WHEN** a user expands a running session's entry
- **THEN** the recent output tails are shown and continue updating while expanded

### Requirement: Confirmed kill from the UI, reflected on the board
Each live session SHALL offer a kill action that requires an explicit confirmation, then issues the sessions API's delete call. The entry SHALL show the exiting state immediately from the API response and reach its terminal state (exited, reason killed) via refresh — the entry never silently disappears. Killing a session that ended meanwhile SHALL resolve gracefully (the terminal state is shown; a no-longer-known session refreshes the list). The board SHALL visibly reflect running sessions — an indicator showing the count of live sessions linking to the Sessions view — so that killing a real session is observable on the board: the indicator updates and the Sessions view shows the killed session's terminal state.

#### Scenario: Kill a real session and the board reflects it
- **WHEN** a user confirms the kill action on a running session
- **THEN** the entry shows exiting immediately, then exited with reason killed, and the board's live-session indicator decreases accordingly

#### Scenario: Kill requires confirmation
- **WHEN** a user clicks the kill action but does not confirm
- **THEN** no delete call is issued and the session keeps running

#### Scenario: Kill races a natural exit gracefully
- **WHEN** a user confirms a kill for a session that already exited
- **THEN** the UI shows the session's terminal state without error noise

### Requirement: Launching an auto or goal run from the UI
The Sessions view SHALL offer a launch flow with exactly three inputs: the run kind (auto or goal), the task text, and an optional change name explained as linking the run to an existing change for live progress. Submitting SHALL call the sessions API's launch endpoint and, on success, show the new session in the list immediately. Server-side rejections (validation, concurrency cap, missing agent CLI, no project) SHALL be surfaced with the server's own error message. The UI SHALL NOT offer any way to run agent sessions other than through this sessions API call.

#### Scenario: Launch an auto run from the board UI
- **WHEN** a user submits the launch form with kind auto and a task
- **THEN** the sessions API is called, and on success the new session appears in the list in a live state without a page reload

#### Scenario: Server rejection surfaces verbatim
- **WHEN** the launch is rejected (for example the concurrency cap or a missing agent CLI)
- **THEN** the dialog shows the server's own error message and no session is added to the list

### Requirement: Sessions UI uses the shared API seam and stays a shell
All sessions traffic SHALL go through the UI package's single fetch seam with the session bearer token and the shared error narrowing; the session wire shapes SHALL be maintained as an explicit mirror of the server's settled contract, named as such in the code. The sessions UI SHALL be implemented entirely within the UI package: it SHALL NOT introduce any write path other than the sessions and change-submission API calls, and this change SHALL NOT modify any file outside the UI package.

#### Scenario: Unauthorized handling matches the rest of the app
- **WHEN** a sessions API call returns 401
- **THEN** the app's existing unauthorized handling engages, identical to board and config calls

#### Scenario: UI-package-only footprint
- **WHEN** this change's modified files are enumerated
- **THEN** every path is inside the UI package
