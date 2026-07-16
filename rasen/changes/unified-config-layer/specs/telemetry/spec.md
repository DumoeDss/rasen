# telemetry Delta Specification

## MODIFIED Requirements

### Requirement: Environment variable opt-out
The system SHALL disable telemetry when `RASEN_TELEMETRY=0` or `DO_NOT_TRACK=1` environment variables are set. The legacy `OPENSPEC_TELEMETRY` variable SHALL NOT be read. Environment variables SHALL take precedence over the persisted `telemetry.enabled` configuration value.

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

#### Scenario: Environment override beats config enable
- **WHEN** the config holds `telemetry.enabled: true`
- **AND** `DO_NOT_TRACK=1` is set in the environment
- **THEN** the system sends no telemetry events

## ADDED Requirements

### Requirement: Persistent telemetry toggle
The system SHALL support disabling telemetry persistently via a `telemetry.enabled` boolean in the global configuration, settable through `rasen config set telemetry.enabled <true|false>`, stored in the same global config file and `telemetry` block that holds the anonymous id. When no environment opt-out applies, `telemetry.enabled: false` SHALL disable all telemetry events; an absent value SHALL leave telemetry enabled (current default behavior).

#### Scenario: Config toggle disables telemetry
- **WHEN** the user runs `rasen config set telemetry.enabled false`
- **AND** no telemetry-related environment variables are set
- **THEN** subsequent CLI invocations send no telemetry events

#### Scenario: Re-enabling via config
- **WHEN** `telemetry.enabled` is `false` and the user runs `rasen config set telemetry.enabled true` (or `rasen config unset telemetry.enabled`)
- **THEN** subsequent CLI invocations send telemetry events again (absent other opt-outs)

#### Scenario: Machine-managed telemetry fields are not CLI-settable
- **WHEN** the user attempts `rasen config set telemetry.anonymousId <value>`
- **THEN** the command rejects the key as not settable
- **AND** the stored anonymous id is unchanged

#### Scenario: Unreadable config fails open to default
- **WHEN** the global config file is missing or unparseable
- **THEN** the telemetry enable check falls back to the default (enabled, subject to environment opt-outs) without crashing the CLI
