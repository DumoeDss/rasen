## MODIFIED Requirements

### Requirement: Global configuration storage
The system SHALL store global configuration in `~/.config/rasen/config.json`, including telemetry state with `anonymousId` and `noticeSeen` fields.

#### Scenario: Initial config creation
- **WHEN** no global config file exists
- **AND** the first telemetry event is about to be sent
- **THEN** the system creates `~/.config/rasen/config.json` with telemetry configuration

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

The system SHALL resolve the global configuration directory path following XDG Base Directory Specification with platform-specific fallbacks.

#### Scenario: Unix/macOS with XDG_CONFIG_HOME set
- **WHEN** `$XDG_CONFIG_HOME` environment variable is set to `/custom/config`
- **THEN** `getGlobalConfigDir()` returns `/custom/config/rasen`

#### Scenario: Unix/macOS without XDG_CONFIG_HOME
- **WHEN** `$XDG_CONFIG_HOME` environment variable is not set
- **AND** the platform is Unix or macOS
- **THEN** `getGlobalConfigDir()` returns `~/.config/rasen` (expanded to absolute path)

#### Scenario: Windows platform
- **WHEN** the platform is Windows
- **AND** `%APPDATA%` is set to `C:\Users\User\AppData\Roaming`
- **THEN** `getGlobalConfigDir()` returns `C:\Users\User\AppData\Roaming\rasen`

## ADDED Requirements

### Requirement: One-time brand config migration
On startup the system SHALL perform a one-time, lossless migration from the legacy `openspec`-named global directories to the new `rasen`-named directories. When a resolved new-brand directory (config or data) does not exist but its sibling legacy `openspec`-named directory does, the system SHALL copy the legacy directory's contents into the new location, preserving telemetry `anonymousId` and `noticeSeen`. The system SHALL NOT overwrite an existing new-brand directory and SHALL NOT delete or corrupt the legacy directory. Migration failures SHALL NOT break CLI startup.

#### Scenario: Legacy config adopted
- **WHEN** the CLI starts
- **AND** the new-brand config directory does not exist
- **AND** a legacy `openspec` config directory with a `config.json` exists at the corresponding location
- **THEN** the system copies the legacy config into the new-brand directory
- **AND** the same `anonymousId` and `noticeSeen` are readable from the new location

#### Scenario: No migration when new directory already exists
- **WHEN** the CLI starts
- **AND** the new-brand config directory already exists
- **THEN** the system performs no migration and does not overwrite the existing config

#### Scenario: No legacy directory present
- **WHEN** the CLI starts
- **AND** neither a new-brand nor a legacy config directory exists
- **THEN** the system creates configuration under the new-brand directory on first write, as normal

#### Scenario: Migration never breaks startup
- **WHEN** the migration cannot complete (e.g., a filesystem error)
- **THEN** the error is swallowed and CLI startup proceeds
- **AND** telemetry identity for the current run is preserved where possible
