# opsx-pipeline-registry Delta Specification

## REMOVED Requirements

### Requirement: Machine config supplies a per-role agent model layer

**Reason**: The machine-config model layers gain a store scope between project and global. Replaced by "Machine config supplies per-role agent model layers across project, store, and global scopes".
**Migration**: Stages in projects without an active store layer resolve identically; the store layers appear only where configuration inheritance is active.

## ADDED Requirements

### Requirement: Machine config supplies per-role agent model layers across project, store, and global scopes

The effective model for a stage SHALL incorporate machine configuration layers below the pipeline's per-role runtime override and above the runtime's own default. A project, an inheriting store (see `store-config-inheritance`), or the machine (global) config MAY declare a base model under `models.default` and per-role model overrides under `models.roles.<role>` for the closed role set (`planner`, `implementer`, `reviewer`, `fixer`, `shipper`). The effective stage model SHALL resolve with precedence: the stage-level `model` first, then the pipeline `agents.<role>.model` role default, then the project config `models.roles.<role>`, then the project config `models.default`, then the inherited store config `models.roles.<role>`, then the inherited store config `models.default`, then the global config `models.roles.<role>`, then the global config `models.default`, then the runtime's built-in default (no configured model). Within each machine config scope a per-role model SHALL win over that scope's `models.default`, and the scopes SHALL rank project > store > global entirely. A model id at any layer SHALL be an opaque string accepted as-is (no allow-list rejection). `rasen pipeline show <name> --json` SHALL report each stage's resolved model with a source distinguishing the store layers (`store-role`, `store-default`) from the project and global layers, and the resolved model SHALL be the one the model-preset (handoff/reuse threshold) layer keys off.

#### Scenario: Store model applies below the project layer

- **WHEN** the inherited store's config sets `models.default: opus`, no project model config or pipeline `agents.<role>.model` applies to a stage, and the stage sets no `model`
- **THEN** the stage's resolved model SHALL be `opus` with a source identifying the store default layer

#### Scenario: Store per-role model beats the store base and the global layer

- **WHEN** the inherited store's config sets `models.default: sonnet` and `models.roles.reviewer: fable`, the global config sets `models.roles.reviewer: opus`, and neither the pipeline nor the stage sets a model for a `reviewer`-role stage
- **THEN** that stage's resolved model SHALL be `fable` (source: store role layer), while a non-reviewer stage resolves to `sonnet`

#### Scenario: Project model config beats the store layer

- **WHEN** the inherited store's config sets `models.roles.reviewer: sonnet` and the project config sets `models.roles.reviewer: fable`
- **THEN** a `reviewer`-role stage resolves to `fable` (the project value wins over the store value)

#### Scenario: Global layer is the store fallback

- **WHEN** neither the project nor the inherited store sets any `models.*` value and the global config sets `models.default: sonnet`
- **THEN** the stage's resolved model SHALL be `sonnet` exactly as before this capability existed

#### Scenario: Pipeline role default beats every machine config layer

- **WHEN** the pipeline declares `agents.reviewer.model: opus` and the project, store, and global configs set other reviewer models
- **THEN** the `reviewer`-role stage resolves to `opus`

#### Scenario: No store layer without inheritance

- **WHEN** the project inherits from no store
- **THEN** model resolution ranks exactly stage > agent > project > global > runtime default as before, and no store source is ever reported

#### Scenario: pipeline show reflects the store-config model

- **WHEN** an inherited store's `models.*` value determines a stage's effective model and the user runs `rasen pipeline show <name> --json`
- **THEN** that stage's reported `model` SHALL be the store-resolved value, with its source identifying the store layer that supplied it
