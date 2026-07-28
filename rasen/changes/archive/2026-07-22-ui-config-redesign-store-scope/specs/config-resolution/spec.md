# config-resolution Delta Specification

## REMOVED Requirements

### Requirement: Effective configuration resolution

**Reason**: Superseded by three-layer resolution — the chain gains a store layer between project and global, sources and raw per-layer values gain `store`, and resolution can address a store root directly. Replaced by "Effective configuration resolution across global, store, and project layers".
**Migration**: Consumers keep calling the same in-process resolution function; entries additionally carry a `store` source possibility and a raw store-layer value where inheritance is active.

## ADDED Requirements

### Requirement: Effective configuration resolution across global, store, and project layers

The system SHALL provide an in-process resolution function (`resolveEffectiveConfig()` in `src/core/`) that merges configuration layers into per-key effective values with source metadata. For each registered configuration key it SHALL report the effective value, the source layer that produced it (`default`, `global`, `store`, `project`, or `env-override`), and the raw per-layer values (`global`, `store`, `project`). Precedence per key SHALL be: environment override > project config (when the key is project-scoped and a project root is available) > store config (when the key is store-scoped and a store layer is active — see `store-config-inheritance`) > global config > built-in default. A layer SHALL contribute to a key only when the key's registry scopes include that layer's scope.

#### Scenario: Default value when nothing is configured

- **WHEN** a registered key is set in neither the global config, an active store layer, nor the project config, and no environment override applies
- **THEN** resolution reports the key's built-in default value with source `default`

#### Scenario: Project value wins over store and global

- **WHEN** `handoff.threshold` is set to 0.7 in the global config, 0.6 in the inherited store's config, and 0.4 in the project config
- **THEN** the effective value is 0.4 with source `project`
- **AND** the raw per-layer values report 0.7 (global), 0.6 (store), and 0.4 (project)

#### Scenario: Store value wins over global

- **WHEN** a project inherits from a store whose config sets `models.default: opus`, the global config sets `models.default: sonnet`, and the project config sets no `models.default`
- **THEN** the effective value is `opus` with source `store`

#### Scenario: Environment override wins over everything

- **WHEN** `telemetry.enabled` is `true` in the global config and `RASEN_TELEMETRY=0` is set in the environment
- **THEN** the effective value is disabled with source `env-override`

#### Scenario: No store layer without an inheritance edge

- **WHEN** resolution runs for a project that declares no `store:` pointer (or whose pointer is inactive)
- **THEN** every key resolves exactly as before this capability existed, and no raw store-layer value is reported

#### Scenario: Resolution addresses a store root directly

- **WHEN** resolution runs for a store space (a registered store's root, no project root)
- **THEN** the store's own config values are reported as the store layer with source `store` where they win, the raw project-layer value is absent, and store-scoped keys resolve store > global > default

#### Scenario: Resolution without any root

- **WHEN** resolution runs without a project root or store layer (e.g. outside any Rasen root)
- **THEN** each key resolves from environment, global, and default layers only, and the call succeeds
