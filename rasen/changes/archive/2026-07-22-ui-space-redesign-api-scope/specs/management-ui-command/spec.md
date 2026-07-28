## ADDED Requirements

### Requirement: The launch URL carries the cwd-resolved planning space
`rasen ui` SHALL resolve the planning space of the directory it is run in — using the shared cwd→space derivation of the planning-space-addressing capability — and include it in the opened URL as a `space` query parameter (`?space=project:<id>` or `?space=store:<id>`, placed before the token fragment), on both the daemon-adopting and self-hosted launch forms. Before emitting a `project:` selector, the command SHALL ensure the project is registered with a usable project id (the same registration any root-resolving CLI command performs), so the emitted selector always resolves against the server. When the working directory yields no derivable space, the URL SHALL carry no `space` parameter and the launch proceeds exactly as before.

#### Scenario: Launch inside a project emits the project space
- **WHEN** a user runs `rasen ui` inside a Rasen project while a daemon launched elsewhere is adopted
- **THEN** the opened URL contains `?space=project:<that project's id>` ahead of the `#token=` fragment

#### Scenario: Launch inside a pointer repo emits the store space
- **WHEN** a user runs `rasen ui` inside a repo whose planning is externalized to registered store `team-store`
- **THEN** the opened URL contains `?space=store:team-store`

#### Scenario: First launch in an unregistered project still addresses itself
- **WHEN** `rasen ui` runs in a project that has never been registered on this machine
- **THEN** the project is registered during launch and the emitted `project:` selector resolves against the server

#### Scenario: No space, no parameter
- **WHEN** `rasen ui` runs outside any Rasen root
- **THEN** the opened URL carries no `space` parameter and launch behavior is otherwise unchanged
