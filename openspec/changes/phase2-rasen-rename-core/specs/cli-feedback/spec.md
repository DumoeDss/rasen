## MODIFIED Requirements

### Requirement: Feedback command

The system SHALL provide a `rasen feedback` command that creates a GitHub Issue in the fork's repository (`DumoeDss/rasen`) using the `gh` CLI. The system SHALL use `execFileSync` with argument arrays to prevent shell injection vulnerabilities.

#### Scenario: Simple feedback submission

- **WHEN** user executes `rasen feedback "Great tool!"`
- **THEN** the system executes `gh issue create` with title "Feedback: Great tool!"
- **AND** the issue is created in the `DumoeDss/rasen` repository
- **AND** the issue has the `feedback` label
- **AND** the system displays the created issue URL

#### Scenario: Safe command execution

- **WHEN** submitting feedback via `gh` CLI
- **THEN** the system uses `execFileSync` with separate arguments array
- **AND** user input is NOT passed through a shell
- **AND** shell metacharacters (quotes, backticks, $(), etc.) are treated as literal text

#### Scenario: Feedback with body

- **WHEN** user executes `rasen feedback "Title here" --body "Detailed description..."`
- **THEN** the system creates a GitHub Issue with the specified title
- **AND** the issue body contains the detailed description
- **AND** the issue body includes metadata (rasen version, platform, timestamp)

#### Scenario: Manual fallback targets the fork

- **WHEN** the `gh` CLI is unavailable and the system prints a pre-filled GitHub issue URL for manual submission
- **THEN** the URL points at `github.com/DumoeDss/rasen/issues/new`
