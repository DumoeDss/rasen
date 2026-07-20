## MODIFIED Requirements

### Requirement: Platform shell scoped to routing, layout, and API client
The app SHALL provide a platform shell — client-side routing, an application layout with navigation and a project switcher, and a typed API client mirroring the served APIs' wire shapes — whose navigation offers the platform's views: the board (the platform home) and the configuration page. The shell SHALL NOT pre-build task-submission or session-supervision modules or their state management; future modules extend the shell.

#### Scenario: Navigation offers the platform views
- **WHEN** the user explores the app's navigation
- **THEN** it offers the board and the configuration page, with the active view indicated
- **AND** no task-submission or session-supervision module is offered

#### Scenario: Project switcher
- **WHEN** the user opens the project switcher
- **THEN** it lists the machine's registered projects from the API and defaults to the project the server was launched from
- **AND** selecting a project reloads the configuration view for that project

#### Scenario: Launched outside a project
- **WHEN** the server was launched outside any Rasen project and no project is selected
- **THEN** the app shows global configuration, and project-scope editing is disabled with an explanation until a project is selected

### Requirement: The app authenticates with the session token from the URL fragment
On load, the app SHALL take the session token from the URL fragment, keep it only in memory, and immediately remove it from the address bar; it SHALL never store the token persistently. Every API request SHALL carry the token as a bearer authorization header. When no token is present or the API answers unauthorized (a stale tab after a server restart), the app SHALL show a clear notice telling the user to re-launch via `rasen ui` rather than failing silently or retrying.

#### Scenario: Token consumed and scrubbed on load
- **WHEN** the browser opens the URL printed by the launch command (token in the fragment)
- **THEN** the app authenticates its API calls with that token
- **AND** the token no longer appears in the address bar or in the URL the user would copy

#### Scenario: Stale tab after server restart
- **WHEN** a previously-opened tab talks to a newly-restarted server (its token is no longer valid)
- **THEN** the app shows a notice instructing the user to re-launch `rasen ui`
