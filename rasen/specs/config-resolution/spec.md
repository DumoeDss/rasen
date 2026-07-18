# config-resolution Specification

## Purpose
Defines an in-process resolution function that merges configuration layers (environment override, project config, global config, built-in defaults) into per-key effective values with source metadata, reusable by CLI and non-CLI consumers alike.

## Requirements

### Requirement: Effective configuration resolution
The system SHALL provide an in-process resolution function (`resolveEffectiveConfig()` in `src/core/`) that merges configuration layers into per-key effective values with source metadata. For each registered configuration key it SHALL report the effective value, the source layer that produced it (`default`, `global`, `project`, or `env-override`), and the raw per-layer values. Precedence per key SHALL be: environment override > project config (when the key is project-scoped and a project root is available) > global config > built-in default.

#### Scenario: Default value when nothing is configured
- **WHEN** a registered key is set in neither the global config nor the project config and no environment override applies
- **THEN** `resolveEffectiveConfig()` reports the key's built-in default value with source `default`

#### Scenario: Project value wins over global
- **WHEN** `handoff.threshold` is set to 0.7 in the global config and 0.4 in the project config
- **AND** resolution runs with that project's root
- **THEN** the effective value is 0.4 with source `project`
- **AND** the raw per-layer values report both 0.7 (global) and 0.4 (project)

#### Scenario: Environment override wins over everything
- **WHEN** `telemetry.enabled` is `true` in the global config
- **AND** `RASEN_TELEMETRY=0` is set in the environment
- **THEN** the effective value is disabled with source `env-override`

#### Scenario: Resolution without a project root
- **WHEN** `resolveEffectiveConfig()` runs without a project root (or the cwd is not inside a Rasen project)
- **THEN** project-scoped values contribute nothing and each key resolves from environment, global, and default layers only
- **AND** the call succeeds (no error) so global-only contexts can use the same function

### Requirement: Reusable module boundary
The resolution function SHALL be a pure in-process module in `src/core/` accepting an explicit optional project root, so that non-CLI consumers (the planned local config HTTP API) can reuse it without invoking command-layer code.

#### Scenario: Explicit project root parameter
- **WHEN** a caller passes `{ projectRoot: <path> }` for a project other than the current working directory
- **THEN** project-layer values are read from that project's `rasen/config.yaml`

#### Scenario: Command layer renders, does not compute
- **WHEN** the interactive config editor or the effective-config listing displays values and sources
- **THEN** the displayed data comes from `resolveEffectiveConfig()` output rather than a separate merge implementation
