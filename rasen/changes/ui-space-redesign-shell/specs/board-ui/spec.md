## MODIFIED Requirements

### Requirement: Board is the platform home and reachable from navigation
The board SHALL be the platform's home view for the selected planning space, rendered at the space-scoped route `/p/<projectId>/board` for a project space and `/s/<storeId>/board` for a store space; the space root route (`/p/<projectId>` or `/s/<storeId>`) SHALL redirect to that space's board. The root route `/` SHALL NOT render the board directly; it SHALL resolve a planning space (per the management-ui-shell capability's bootstrap rule) and redirect to that space's board route. The shared layout's navigation SHALL offer an entry to the board within the current space from every view, so a user on the configuration page can reach the board without editing the URL.

#### Scenario: Space board route renders the board
- **WHEN** the user opens `/p/<projectId>/board` (as reached from the URL `rasen ui` prints)
- **THEN** the board view renders as the landing page for that project space

#### Scenario: Root route redirects to a space board
- **WHEN** the user opens the platform at `/`
- **THEN** the app resolves a planning space and redirects to that space's board route rather than rendering the board at `/`

#### Scenario: Board reachable from the config view
- **WHEN** the user is on the configuration page within a space and activates the board navigation entry
- **THEN** the app navigates to that space's board view without a full reload or manual URL editing

#### Scenario: Space root redirects to the board
- **WHEN** the user opens a space root route such as `/p/<projectId>` with no section
- **THEN** the board view renders, identical to the space's `…/board` route
