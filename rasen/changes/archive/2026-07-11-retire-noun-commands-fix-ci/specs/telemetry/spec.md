# telemetry Specification (delta)

## MODIFIED Requirements

### Requirement: First-run telemetry notice
The system SHALL display a telemetry disclosure notice on the first command execution, before any telemetry is sent, that truthfully states the data goes to the maintainer's own Cloudflare Worker, what is collected, and how to opt out. The notice SHALL be written to stderr so it never contaminates a command's stdout, which must remain either valid machine-readable output (`--json`) or the command's own text result.

#### Scenario: First command execution
- **WHEN** a user runs their first rasen command
- **AND** telemetry is enabled
- **THEN** the system displays a one-line notice stating that anonymous usage stats (command, version, OS, Node version, and a random id) are sent to rasen's own Cloudflare Worker, and that opt-out is via `RASEN_TELEMETRY=0`

#### Scenario: Notice is written to stderr, never stdout
- **WHEN** the first-run notice is displayed for any command (text or `--json`)
- **THEN** the notice text appears on stderr
- **AND** stdout carries only the command's own output (unpolluted, and still valid JSON for `--json` commands)

#### Scenario: Notice does not mention PostHog
- **WHEN** the first-run notice is displayed
- **THEN** it does not reference PostHog or `edge.openspec.dev`

#### Scenario: Subsequent command execution
- **WHEN** a user has already seen the notice (`noticeSeen: true` in config)
- **THEN** the system does not display the notice

#### Scenario: Notice before telemetry
- **WHEN** displaying the first-run notice
- **THEN** the notice appears before any telemetry event is sent
