## ADDED Requirements

### Requirement: Audit is reachable as an installation-wide shell route

The management UI shell SHALL expose an Audit navigation entry at the global `/audit` route from every authenticated view. Audit SHALL be installation-wide rather than project/store-scoped, while the shell's recent-space fallback SHALL keep Board, Archive, Config, and Pipelines reachable when the user is on Audit. Navigating to Audit SHALL NOT change the selected/recent planning space or write any workspace state.

#### Scenario: Audit is reachable without a resolved space
- **WHEN** an authenticated user has no current space route
- **THEN** the shell still displays an Audit navigation entry that opens `/audit`

#### Scenario: Audit is active from a space
- **WHEN** the user follows Audit from `/p/<id>/board` or `/s/<id>/config`
- **THEN** `/audit` becomes active and the prior space remains available through the shell's recent-space navigation

#### Scenario: Audit navigation is read-only to workspace selection
- **WHEN** the user enters or leaves `/audit`
- **THEN** navigation changes only the URL/view and issues no workspace/configuration write
