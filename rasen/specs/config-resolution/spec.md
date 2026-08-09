# config-resolution Specification

## Purpose
Defines an in-process resolution function that merges configuration layers (environment override, project config, global config, built-in defaults) into per-key effective values with source metadata, reusable by CLI and non-CLI consumers alike.
## Requirements
### Requirement: Effective configuration resolution across global, store, and project layers

The system SHALL provide an in-process resolution function (`resolveEffectiveConfig()` in `src/core/`) that merges configuration layers into per-key effective values with source metadata. For each registered configuration key it SHALL report the effective value, the source layer that produced it (`default`, `global`, `store`, `project`, or `env-override`), and the raw per-layer values (`global`, `store`, `project`). Precedence per key SHALL be: environment override > project config (when the key is project-scoped and a project root is available) > store config (when the key is store-scoped and a store layer is active — see `store-config-inheritance`) > global config > built-in default. A layer SHALL contribute to a key only when the key's registry scopes include that layer's scope. Absence of a store layer SHALL mean the project declares no store; a project that declares a store which cannot be resolved SHALL NOT resolve as though it had no store layer — resolution SHALL instead report the expected store, the reason it is unavailable, and a repair command.

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

- **WHEN** resolution runs for a project that declares no `store:` pointer at all
- **THEN** every key resolves exactly as before this capability existed, and no raw store-layer value is reported
- **AND** a project whose declared store cannot be resolved does NOT take this path — it is reported as unavailable with its reason and repair command instead

#### Scenario: Resolution addresses a store root directly

- **WHEN** resolution runs for a store space (a registered store's root, no project root)
- **THEN** the store's own config values are reported as the store layer with source `store` where they win, the raw project-layer value is absent, and store-scoped keys resolve store > global > default

#### Scenario: Resolution without any root

- **WHEN** resolution runs without a project root or store layer (e.g. outside any Rasen root)
- **THEN** each key resolves from environment, global, and default layers only, and the call succeeds

### Requirement: Reusable module boundary
The resolution function SHALL be a pure in-process module in `src/core/` accepting an explicit optional project root, so that non-CLI consumers (the planned local config HTTP API) can reuse it without invoking command-layer code.

#### Scenario: Explicit project root parameter
- **WHEN** a caller passes `{ projectRoot: <path> }` for a project other than the current working directory
- **THEN** project-layer values are read from that project's `rasen/config.yaml`

#### Scenario: Command layer renders, does not compute
- **WHEN** the interactive config editor or the effective-config listing displays values and sources
- **THEN** the displayed data comes from `resolveEffectiveConfig()` output rather than a separate merge implementation

### Requirement: Reasoning effort resolves with model-parallel precedence and provenance

The system SHALL support reasoning-effort defaults and role overrides at project, inherited-store, and global scopes, plus per-stage pipeline config instances. For a stage, effective effort precedence SHALL be: project/store/global-resolved `pipelines.<name>.efforts.<stage>` instance; stage YAML `effort`; pipeline `agents.<role>.effort`; project `efforts.roles.<role>` then `efforts.default`; inherited store role then default; global role then default; and finally the runtime's own default represented by an absent value. Resolution SHALL expose `effortSource` independently from runtime and `modelSource`.

#### Scenario: Luna Max resolves from project role configuration
- **WHEN** a Codex planner resolves model `gpt-5.6-luna` and project configuration sets `efforts.roles.planner: max`, with no higher effort value
- **THEN** its execution view reports effort `max` with source `project-role`
- **AND** model provenance remains independently reported

#### Scenario: Terra resolves with an independently configured effort
- **WHEN** a Codex implementer resolves model `gpt-5.6-terra` and its winning effort layer supplies `medium`
- **THEN** its execution view reports model `gpt-5.6-terra` and effort `medium` with their independent sources
- **AND** neither value is inferred from the other

#### Scenario: Stage instance wins over every declared and inherited value
- **WHEN** a project-scoped `pipelines.<name>.efforts.<stage>` instance sets `max` while stage YAML, pipeline role, project, store, and global layers set other valid efforts
- **THEN** the stage resolves `max` with the per-stage project source

#### Scenario: Pipeline role wins over machine layers
- **WHEN** stage YAML has no effort, `agents.reviewer.effort` is `high`, and project/store/global effort layers are present
- **THEN** the reviewer resolves `high` with source `agent`

#### Scenario: Project then store then global fallback
- **WHEN** a stage and pipeline role omit effort
- **THEN** resolution considers project role/default before inherited store role/default and store before global role/default

#### Scenario: No effort configuration preserves the runtime default
- **WHEN** no layer supplies an effort
- **THEN** effective effort is absent with source `default`
- **AND** dispatch omits the reasoning-effort override rather than inventing one

### Requirement: Leaf reasoning effort is validated before dispatch

The shared supported leaf effort vocabulary SHALL be exactly `low`, `medium`, `high`, `xhigh`, and `max`. Authored pipeline values outside that list SHALL fail preparation. Invalid project/store/global leaves SHALL be ignored with an actionable diagnostic so valid sibling and lower-precedence values remain usable. A direct `rasen agent dispatch --effort` outside the list SHALL return `invalid-input` before spawning a worker. Model ids SHALL remain opaque non-empty strings and SHALL not be restricted to a built-in allow-list.

#### Scenario: Max is accepted for Luna
- **WHEN** a stage or direct dispatch selects model `gpt-5.6-luna` and effort `max`
- **THEN** validation accepts both values and preserves `max` unchanged

#### Scenario: Ultra is not silently selected for a leaf
- **WHEN** a pipeline stage or direct bridge call requests effort `ultra`
- **THEN** preparation or dispatch fails with an actionable effort diagnostic before worker launch
- **AND** the first-class path does not silently clamp the user's configured value

#### Scenario: Invalid resilient config falls through
- **WHEN** a project effort leaf is invalid and a valid inherited store or global value exists
- **THEN** resolution reports the invalid project diagnostic and selects the valid lower layer with its actual source

#### Scenario: Arbitrary non-empty model remains valid without discovery
- **WHEN** a user selects a non-empty model id that Rasen does not recognize, including a future or provider-qualified Codex id
- **THEN** model validation accepts and preserves it unchanged without model discovery or allow-list lookup
- **AND** Codex remains responsible for reporting availability

#### Scenario: Empty model is invalid
- **WHEN** an authored configuration or direct dispatch supplies an empty model id
- **THEN** preparation or dispatch rejects it before worker launch with an actionable model diagnostic
