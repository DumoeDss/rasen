## MODIFIED Requirements

### Requirement: Environment variable opt-out
The system SHALL disable telemetry when `RASEN_TELEMETRY=0` or `DO_NOT_TRACK=1` environment variables are set. The legacy `OPENSPEC_TELEMETRY` variable SHALL NOT be read.

#### Scenario: RASEN_TELEMETRY opt-out
- **WHEN** `RASEN_TELEMETRY=0` is set in the environment
- **THEN** the system sends no telemetry events

#### Scenario: DO_NOT_TRACK opt-out
- **WHEN** `DO_NOT_TRACK=1` is set in the environment
- **THEN** the system sends no telemetry events

#### Scenario: Environment variable takes precedence
- **WHEN** the user has previously used the CLI (config exists)
- **AND** the user sets `RASEN_TELEMETRY=0`
- **THEN** telemetry is disabled regardless of config state

### Requirement: CI environment auto-disable
The system SHALL automatically disable telemetry when `CI=true` environment variable is detected.

#### Scenario: CI environment detection
- **WHEN** `CI=true` is set in the environment
- **THEN** the system sends no telemetry events

#### Scenario: CI with explicit enable
- **WHEN** `CI=true` is set
- **AND** `RASEN_TELEMETRY=1` is explicitly set
- **THEN** telemetry remains disabled (CI takes precedence for privacy)

### Requirement: First-run telemetry notice
The system SHALL display a telemetry disclosure notice on the first command execution, before any telemetry is sent, that truthfully states the data goes to the maintainer's own Cloudflare Worker, what is collected, and how to opt out.

#### Scenario: First command execution
- **WHEN** a user runs their first rasen command
- **AND** telemetry is enabled
- **THEN** the system displays a one-line notice stating that anonymous usage stats (command, version, OS, Node version, and a random id) are sent to rasen's own Cloudflare Worker, and that opt-out is via `RASEN_TELEMETRY=0`

#### Scenario: Notice does not mention PostHog
- **WHEN** the first-run notice is displayed
- **THEN** it does not reference PostHog or `edge.openspec.dev`

#### Scenario: Subsequent command execution
- **WHEN** a user has already seen the notice (`noticeSeen: true` in config)
- **THEN** the system does not display the notice

#### Scenario: Notice before telemetry
- **WHEN** displaying the first-run notice
- **THEN** the notice appears before any telemetry event is sent
