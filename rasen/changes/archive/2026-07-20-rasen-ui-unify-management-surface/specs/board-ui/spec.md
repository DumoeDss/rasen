## ADDED Requirements

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
