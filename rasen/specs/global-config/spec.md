# global-config Specification

## Purpose

This spec defines how Rasen resolves, reads, and writes user-level global configuration. It governs the `src/core/global-config.ts` module, which provides the foundation for storing user preferences, feature flags, and settings that persist across projects. The spec ensures cross-platform compatibility by following XDG Base Directory Specification with platform-specific fallbacks, and guarantees forward/backward compatibility through schema evolution rules.
## Requirements
### Requirement: Machine data root

The system SHALL resolve the machine data root (project registry and homes, store registry, user schemas, user pipelines, workset state) with the precedence: `RASEN_HOME` environment variable (highest, resolved to an absolute path) > `$XDG_DATA_HOME/rasen` (compatibility alias) > `~/.rasen` (the default on ALL platforms). Platform-specific application-data locations (`%LOCALAPPDATA%`) SHALL NOT be consulted. An unusable `RASEN_HOME` value SHALL produce a warning and fall back to the default rather than failing. `RASEN_HOME` points the config directory and the data root at the same directory, so one variable relocates everything.

#### Scenario: Default is ~/.rasen everywhere

- **WHEN** neither `RASEN_HOME` nor `XDG_DATA_HOME` is set, on Windows, macOS, or Linux
- **THEN** the machine data root SHALL resolve to `~/.rasen` (the user's home directory joined with `.rasen`)

#### Scenario: RASEN_HOME overrides everything

- **WHEN** `RASEN_HOME` is set to an absolute directory path
- **THEN** both the machine data root and the global config directory SHALL resolve to that path
- **AND** XDG variables SHALL be ignored for these resolutions

#### Scenario: XDG alias retained below RASEN_HOME

- **WHEN** `RASEN_HOME` is not set and `XDG_DATA_HOME` is set
- **THEN** the machine data root SHALL resolve to `$XDG_DATA_HOME/rasen`, preserving existing explicit-XDG installs and test isolation

### Requirement: Global configuration storage
The system SHALL store global configuration in `~/.rasen/config.json` (the resolved global config directory joined with `config.json`), including telemetry state with `anonymousId` and `noticeSeen` fields.

#### Scenario: Initial config creation
- **WHEN** no global config file exists
- **AND** the first telemetry event is about to be sent
- **THEN** the system creates `config.json` under the resolved global config directory (default `~/.rasen`) with telemetry configuration

#### Scenario: Telemetry config structure
- **WHEN** reading or writing telemetry configuration
- **THEN** the config contains a `telemetry` object with `anonymousId` (string UUID) and `noticeSeen` (boolean) fields

#### Scenario: Config file format
- **WHEN** storing configuration
- **THEN** the system writes valid JSON that can be read and modified by users

#### Scenario: Existing config preservation
- **WHEN** adding telemetry fields to an existing config file
- **THEN** the system preserves all existing configuration fields

### Requirement: Global Config Directory Path

The system SHALL resolve the global configuration directory with the precedence: `RASEN_HOME` (highest) > `$XDG_CONFIG_HOME/rasen` (compatibility alias) > `~/.rasen` (the default on ALL platforms). Platform-specific roaming-profile locations (`%APPDATA%`) SHALL NOT be consulted. Under defaults the config directory and the machine data root are the same `~/.rasen` directory; their contents do not collide.

#### Scenario: Default config dir is ~/.rasen

- **WHEN** neither `RASEN_HOME` nor `XDG_CONFIG_HOME` is set, on any platform
- **THEN** `getGlobalConfigDir()` returns `~/.rasen` (expanded to an absolute path)

#### Scenario: XDG_CONFIG_HOME still honored

- **WHEN** `RASEN_HOME` is not set and `$XDG_CONFIG_HOME` is set to `/custom/config`
- **THEN** `getGlobalConfigDir()` returns `/custom/config/rasen`

#### Scenario: RASEN_HOME wins for config too

- **WHEN** `RASEN_HOME` is set
- **THEN** `getGlobalConfigDir()` returns the `RASEN_HOME` directory regardless of XDG variables

### Requirement: Global Config Loading

The system SHALL load global configuration from the config directory with sensible defaults when the config file does not exist or cannot be parsed.

#### Scenario: Config file exists and is valid
- **WHEN** `config.json` exists in the global config directory
- **AND** the file contains valid JSON matching the config schema
- **THEN** `getGlobalConfig()` returns the parsed configuration

#### Scenario: Config file does not exist
- **WHEN** `config.json` does not exist in the global config directory
- **THEN** `getGlobalConfig()` returns the default configuration
- **AND** no directory or file is created

#### Scenario: Config file is invalid JSON
- **WHEN** `config.json` exists but contains invalid JSON
- **THEN** `getGlobalConfig()` returns the default configuration
- **AND** a warning is logged to stderr

### Requirement: Global Config Saving

The system SHALL save global configuration to the config directory, creating the directory if it does not exist.

#### Scenario: Save config to new directory
- **WHEN** `saveGlobalConfig(config)` is called
- **AND** the global config directory does not exist
- **THEN** the directory is created
- **AND** `config.json` is written with the provided configuration

#### Scenario: Save config to existing directory
- **WHEN** `saveGlobalConfig(config)` is called
- **AND** the global config directory already exists
- **THEN** `config.json` is written (overwriting if exists)

### Requirement: Default Configuration

The system SHALL provide a default configuration that is used when no config file exists.

#### Scenario: Default config structure
- **WHEN** no config file exists
- **THEN** the default configuration includes an empty `featureFlags` object

### Requirement: Config Schema Evolution

The system SHALL merge loaded configuration with default values to ensure new config fields are available even when loading older config files.

#### Scenario: Config file missing new fields
- **WHEN** `config.json` exists with `{ "featureFlags": {} }`
- **AND** the current schema includes a new field `defaultAiTool`
- **THEN** `getGlobalConfig()` returns `{ featureFlags: {}, defaultAiTool: <default> }`
- **AND** the loaded values take precedence over defaults for fields that exist in both

#### Scenario: Config file has extra unknown fields
- **WHEN** `config.json` contains fields not in the current schema
- **THEN** the unknown fields are preserved in the returned configuration
- **AND** no error or warning is raised

### Requirement: One-time brand config migration
On startup, before any command runs, the system SHALL perform a one-time, lossless adoption of machine data into the resolved locations, covering both the brand rename and the root relocation as one chain. When no environment override (`RASEN_HOME`, or the respective XDG variable) is in effect and the target (`~/.rasen`) lacks the corresponding content, the system SHALL adopt from old-scheme locations computed explicitly — the pre-relocation `rasen` directories (`%LOCALAPPDATA%\rasen` / `~/.local/share/rasen` for data; `%APPDATA%\rasen` / `~/.config/rasen` for config) first, else their legacy `openspec` brand siblings — by copying: per top-level child, all-or-nothing (temp-then-rename), never overwriting existing target content, never deleting or modifying the source. Telemetry `anonymousId` and `noticeSeen` SHALL survive adoption verbatim. Adoption SHALL be idempotent, and failures SHALL print a loud warning naming the source, target, and manual remedy while never breaking CLI startup. When an environment override is set, no adoption occurs — an explicit location is the user's choice.

#### Scenario: Old-scheme rasen data adopted into ~/.rasen

- **WHEN** the CLI starts with no env overrides, `~/.rasen` absent, and a pre-relocation `rasen` data directory containing `projects/` and `stores/`
- **THEN** the contents SHALL be copied into `~/.rasen`
- **AND** the registered project homes and registries SHALL be readable from the new location without any rewrite (registry keys are project paths; home entries are names)
- **AND** the old directory SHALL remain untouched

#### Scenario: Ancient openspec install chains in one hop

- **WHEN** the CLI starts with no env overrides, `~/.rasen` absent, no pre-relocation `rasen` directory, and a legacy `openspec` directory at the old-scheme location
- **THEN** the legacy contents SHALL be adopted into `~/.rasen` directly, preserving `anonymousId` and `noticeSeen`

#### Scenario: No adoption over existing content

- **WHEN** `~/.rasen` already contains the corresponding content
- **THEN** the system performs no adoption and overwrites nothing

#### Scenario: Env override disables adoption

- **WHEN** `RASEN_HOME` or the respective XDG variable is set
- **THEN** no adoption occurs for that resolution

#### Scenario: Adoption failure is loud but never fatal

- **WHEN** the adoption copy fails partway (e.g. a filesystem error)
- **THEN** the partially-copied child is cleaned up, a warning names the source, target, and the manual command to finish by hand
- **AND** CLI startup proceeds
- **AND** the next startup re-attempts (idempotent)

