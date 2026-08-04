## ADDED Requirements

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
