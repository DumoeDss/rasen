# board-ui Specification (delta)

## ADDED Requirements

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
