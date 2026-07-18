# telemetry Specification

## Purpose

This spec defines how Rasen collects anonymous usage telemetry to help improve the tool. It governs the `src/telemetry/` module, which sends minimal usage events to the maintainer's own Cloudflare Worker via a fire-and-forget HTTP `POST` (no PostHog, no third-party client), and handles privacy-preserving event design, user opt-out mechanisms, and first-run notice display. The spec ensures telemetry is minimal, transparent, and respects user privacy.

## Requirements

### Requirement: Command execution tracking
The system SHALL send a usage event to the maintainer's telemetry backend when any CLI command executes, including the command name and Rasen version, plus optionally the operating system and Node.js version. No other fields are sent.

#### Scenario: Standard command execution
- **WHEN** a user runs any rasen command
- **THEN** the system sends an event whose payload contains `command`, `version`, and the anonymous `distinctId`, and may include `os` and `node_version`

#### Scenario: Subcommand execution
- **WHEN** a user runs a nested command like `rasen change apply`
- **THEN** the system sends an event with the full command path as `command` (e.g., `change:apply`)

#### Scenario: Optional environment dimensions
- **WHEN** an event is sent
- **THEN** it may include `os` and `node_version`, and includes no other dimensions beyond command, version, and the anonymous id

### Requirement: Privacy-preserving event design
The system SHALL NOT include command arguments, file paths, project names, spec content, error messages, or IP addresses in telemetry events. The only user identifier is a random anonymous UUID.

#### Scenario: Command with arguments
- **WHEN** a user runs `rasen init my-project --force`
- **THEN** the telemetry event contains only `command: "init"`, `version: "<version>"`, the anonymous id, and optional os/node_version — without arguments, path, or project name

#### Scenario: No IP address is sent or stored
- **WHEN** the system sends a telemetry event
- **THEN** the request body carries no IP address and the backend does not persist the caller's IP

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

### Requirement: Anonymous user identification
The system SHALL generate a random UUID as an anonymous identifier on first telemetry send, stored in global config.

#### Scenario: First telemetry event
- **WHEN** the first telemetry event is sent
- **AND** no anonymousId exists in config
- **THEN** the system generates a random UUID v4 and stores it in config

#### Scenario: Persistent identity
- **WHEN** a user runs multiple commands across sessions
- **THEN** the same anonymousId is used for all events

#### Scenario: Lazy generation with opt-out
- **WHEN** a user opts out before running any command
- **THEN** no anonymousId is ever generated or stored

### Requirement: Immediate event sending
The system SHALL send each telemetry event immediately as a single fire-and-forget HTTP `POST`, without batching and without retrying, bounded by a short (~1 second) timeout.

#### Scenario: Event transmission timing
- **WHEN** a command executes
- **THEN** the telemetry event is sent immediately as one request, not queued for batch transmission

#### Scenario: No retry and no response parsing
- **WHEN** the telemetry request completes or times out
- **THEN** the client does not retry and does not parse or act on the response body

### Requirement: Graceful shutdown
The system SHALL expose a `shutdown()` entry point that the CLI awaits before exit, and it SHALL complete quickly without depending on any PostHog client.

#### Scenario: Normal exit
- **WHEN** a command completes successfully
- **THEN** the system awaits `shutdown()` before exiting and `shutdown()` returns promptly

#### Scenario: Error exit
- **WHEN** a command fails with an error
- **THEN** the system still awaits `shutdown()` before exiting

#### Scenario: Shutdown never blocks exit
- **WHEN** `shutdown()` is called
- **THEN** it does not hang the CLI exit and does not require flushing a batched client

### Requirement: Silent failure handling
The system SHALL silently ignore telemetry failures without affecting CLI functionality.

#### Scenario: Network failure
- **WHEN** the telemetry request fails due to network error
- **THEN** the CLI command completes normally without error message

#### Scenario: Backend unavailable or slow
- **WHEN** the telemetry Worker is unavailable or does not respond within the timeout
- **THEN** the CLI command completes normally without error message

#### Scenario: Shutdown failure
- **WHEN** `shutdown()` fails or times out
- **THEN** the CLI exits normally without error message

### Requirement: Maintainer-owned telemetry destination
The system SHALL send telemetry only to the maintainer's Cloudflare Worker endpoint and SHALL NOT send any telemetry to PostHog or `edge.openspec.dev`. The client SHALL NOT depend on `posthog-node`.

#### Scenario: Events target the Worker endpoint
- **WHEN** a telemetry event is sent
- **THEN** it is `POST`ed to the maintainer's Cloudflare Worker telemetry endpoint and to no other destination

#### Scenario: No PostHog transport
- **WHEN** the telemetry module and package dependencies are inspected
- **THEN** there is no `posthog-node` dependency and no reference to a PostHog API key or `edge.openspec.dev` host

#### Scenario: Opt-out suppresses all network calls
- **WHEN** telemetry is disabled via `RASEN_TELEMETRY=0`, `DO_NOT_TRACK=1`, or CI auto-off
- **THEN** no request is made to the Worker endpoint
