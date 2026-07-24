## ADDED Requirements

### Requirement: The Audit page lists and switches among saved local reports

The Web UI SHALL provide an installation-wide Audit page that lists valid audit reports in the user's resolved Rasen `analytics` directory, newest first. Each entry SHALL identify at least the runtime, session, generated time, and agent/thread count. Opening the page SHALL select the newest valid report when the user has not already selected one, and selecting another entry SHALL render that saved report without rerunning its audit.

Malformed, unsupported, non-file, or symlink entries in the analytics directory SHALL NOT prevent valid reports from being listed. The page SHALL disclose that entries were skipped and SHALL render an explicit empty state when no valid report exists.

#### Scenario: Newest saved result is selected on first visit
- **WHEN** the user opens Audit and the analytics directory contains several valid reports
- **THEN** the reports are listed newest first and the newest report is rendered

#### Scenario: User switches reports without analysis
- **WHEN** the user selects a different saved report
- **THEN** that report is loaded and rendered without starting another audit

#### Scenario: Invalid analytics entry does not break the list
- **WHEN** the analytics directory contains a valid report plus malformed JSON, a directory, or a symlink
- **THEN** the valid report remains selectable and the page indicates that unsupported entries were skipped

#### Scenario: No saved reports
- **WHEN** the analytics directory contains no valid audit report
- **THEN** the page shows an explicit empty state and keeps session selection and file import available

#### Scenario: Native separators resolve the same result inventory
- **WHEN** the analytics directory is resolved on Windows, macOS, or Linux
- **THEN** the page receives the same report inventory semantics using that platform's native path resolution

### Requirement: The Audit page offers quick native-session analysis

The Audit page SHALL list recent auditable Claude, Codex, and Zed root sessions discovered from their established local runtime stores, globally ordered by recent activity and labeled with their runtime and available identifying metadata. The user SHALL be able to select one and start analysis without copying an id or path.

Missing or unreadable storage for one runtime SHALL be reported as unavailable for that runtime while sessions from other runtimes remain usable. On success, the newly written report SHALL become selected and the saved-result list SHALL refresh.

#### Scenario: Recent session is analyzed
- **WHEN** the user selects a discovered Claude, Codex, or Zed session and activates Analyze
- **THEN** the page shows an in-progress state, runs the existing runtime-appropriate audit, selects the resulting report, and refreshes the saved list

#### Scenario: One runtime is unavailable
- **WHEN** the Zed database is absent but Claude or Codex sessions are discoverable
- **THEN** the page identifies Zed as unavailable and continues to offer the other sessions

#### Scenario: Exact native session is used
- **WHEN** the user chooses a listed session
- **THEN** the audit targets that entry's exact runtime and session id and does not ask the browser to provide a transcript path

#### Scenario: Audit failure preserves the current report
- **WHEN** analysis fails because the session disappeared or its format changed
- **THEN** the page shows the server's actionable error and retry control while leaving the previously selected report visible

### Requirement: The Audit page imports user-granted session or report files

The Audit page SHALL provide a file picker and drop target for importing a local file. A `.jsonl`, `.db`, or `.sqlite` source SHALL be analyzed with the existing audit engine, while a `.json` carrying a supported `rasen-token-audit/*` report SHALL be validated and copied into the analytics inventory without re-analysis. The browser SHALL upload the selected file's bytes and SHALL NOT submit an arbitrary server-side path.

The page SHALL disclose that a single imported transcript may omit sibling agent files that were not selected. Unsupported, oversized, malformed, or format-drift files SHALL produce a specific actionable error and SHALL NOT create a saved result.

#### Scenario: Transcript file is imported and analyzed
- **WHEN** the user selects or drops a supported transcript/rollout/database file within the upload limit
- **THEN** the page shows an in-progress state, analyzes the granted bytes locally, selects the generated report, and refreshes the saved list

#### Scenario: Existing report is imported
- **WHEN** the user selects a JSON file with a supported audit-report schema
- **THEN** the report is validated, saved under the analytics inventory with a collision-safe name, and rendered without rerunning analysis

#### Scenario: Browser does not grant arbitrary path access
- **WHEN** the user imports a file
- **THEN** only the user-selected bytes and a basename/type hint are sent, and no API request accepts a client-supplied server filesystem path

#### Scenario: Invalid import is recoverable
- **WHEN** the user imports an unsupported extension, malformed report, oversized file, or unrecognized transcript
- **THEN** the page explains why it was rejected, offers another selection, and preserves the current report and saved inventory

### Requirement: Audit loading, empty, and error states remain independently usable

Saved-result loading, recent-session discovery, report detail loading, and audit/import execution SHALL have independent visible states. A failure in one area SHALL NOT erase successful data in another. Audit/import actions SHALL be disabled while an execution is in flight, and a competing execution rejected as busy SHALL be presented as retryable.

#### Scenario: Saved list loads while discovery fails
- **WHEN** saved reports load successfully but recent-session discovery fails
- **THEN** the user can still browse and switch among saved reports and can retry discovery

#### Scenario: Detail selection ignores stale response
- **WHEN** the user selects report B before the request for report A finishes
- **THEN** a late response for A does not replace B in the viewer

#### Scenario: Duplicate execution is prevented
- **WHEN** an audit or import is already running
- **THEN** additional execution controls are disabled, and a server busy response is shown as retryable rather than as lost data

### Requirement: The Web UI renders the established audit visualization

The Audit page SHALL render supported Claude, Codex, and Zed reports using the shipped viewer's existing runtime-aware visualization and SHALL tolerate older report shapes that the standalone viewer already supports. Report data SHALL be transferred to the embedded viewer only through a same-origin channel after the viewer is ready; the bearer token and report filesystem path SHALL NOT appear in the embedded viewer URL.

#### Scenario: Runtime-specific report is rendered
- **WHEN** the user opens a Claude, Codex, or Zed saved report
- **THEN** the embedded viewer renders the same runtime-appropriate totals, timelines, caveats, and unsupported-dimension disclosures as the standalone viewer

#### Scenario: Older compatible report is rendered
- **WHEN** a saved report omits optional enriched fields supported by the standalone viewer's backward-compatible path
- **THEN** the Web UI renders the available report dimensions without failing

#### Scenario: Embedded viewer is not ready yet
- **WHEN** report data finishes loading before the embedded viewer signals readiness
- **THEN** the page queues the current report and sends it only after readiness, without losing the selection

#### Scenario: Theme is synchronized
- **WHEN** the Web UI theme changes while a report is selected
- **THEN** the embedded report adopts the same theme and retains the selected report

### Requirement: The Audit workspace prioritizes report width

The Audit page SHALL use substantially more of the available viewport width than a reading-width page and SHALL keep its outer side margins compact and responsive. Its saved-results rail SHALL be collapsible and expandable; collapsing it SHALL remove the saved-results content from the layout and give the reclaimed width to the embedded report pane.

At normal desktop widths, the page and embedded report SHALL fit the available viewport without requiring page-level horizontal scrolling where practical. The rail SHALL initially be expanded at normal desktop widths and collapsed at narrow widths. Its toggle SHALL remain operable by keyboard, expose its expanded state and controlled region to assistive technology, use a state-specific accessible label, and preserve a usable way to reopen the saved-results list.

#### Scenario: Collapsing the rail expands the report
- **WHEN** the user collapses the expanded saved-results rail
- **THEN** the saved-results content leaves the layout and the report pane expands into the reclaimed horizontal space

#### Scenario: Expanded rail restores saved-result switching
- **WHEN** the user activates the expand control while the saved-results rail is collapsed
- **THEN** the saved-results list and its notices return without changing the currently selected report

#### Scenario: Wide desktop avoids unnecessary horizontal scrolling
- **WHEN** the Audit page is displayed at a normal desktop width
- **THEN** compact outer gutters and responsive report sizing use substantially more of the viewport without introducing page-level horizontal scrolling

#### Scenario: Toggle communicates state accessibly
- **WHEN** keyboard or assistive-technology users operate the saved-results toggle
- **THEN** the control is keyboard operable, retains focus, exposes the controlled region and current expanded state, and announces whether activating it will expand or collapse saved results

#### Scenario: Narrow layout remains usable
- **WHEN** the Audit page opens at a narrow viewport width
- **THEN** the saved-results rail starts collapsed, its expand control remains available, and expanding the list uses a full-width responsive layout without making the report or actions unreachable
