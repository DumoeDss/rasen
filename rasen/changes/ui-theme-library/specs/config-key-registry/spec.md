## ADDED Requirements

### Requirement: Theme preference key

The configuration-key registry SHALL define `ui.theme` as a global-only string
key in the Appearance group, with the built-in default `editorial` and a
portable theme-identifier constraint. Registry-driven CLI and HTTP config
writes SHALL validate identifier syntax while theme availability SHALL be
reported by the theme catalog and activation experience.

#### Scenario: Global theme identifier is accepted

- **WHEN** `ui.theme` is set globally to a lowercase portable identifier
- **THEN** registry validation accepts the value and the resolved configuration
  reports the global source

#### Scenario: Theme remains global-only

- **WHEN** `ui.theme` is set at store or project scope
- **THEN** validation rejects the write and identifies global as the supported
  scope

#### Scenario: Unsafe identifier is rejected

- **WHEN** `ui.theme` is set to an identifier containing path syntax, uppercase
  characters, whitespace, or characters outside the theme-id contract
- **THEN** validation rejects it before any configuration file is written
