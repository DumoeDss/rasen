# opsx-pipeline-registry Delta Specification

> Stacked delta: the REMOVED requirement below is the ADDED text of the pending `ui-config-redesign-store-scope` (W1) change's delta to this spec — W1 must archive before this change.

## REMOVED Requirements

### Requirement: Machine config supplies per-role agent model layers across project, store, and global scopes

**Reason**: A per-stage configured model (`pipelines.<name>.models.<stage>`) becomes the new top of the chain — above even the stage-level YAML `model` — so a user can override a stage's model without touching any pipeline definition. Replaced by "Per-stage configured models top the stage model resolution chain".
**Migration**: Every existing layer and its precedence is unchanged below the new top layer; stages with no per-stage instance resolve identically to before.

## ADDED Requirements

### Requirement: Per-stage configured models top the stage model resolution chain

The effective model for a stage SHALL resolve with precedence: a `pipelines.<name>.models.<stage>` configuration instance first (itself resolving project over store over global), then the stage-level `model`, then the pipeline `agents.<role>.model` role default, then the project config `models.roles.<role>`, then the project config `models.default`, then the inherited store config `models.roles.<role>`, then the inherited store config `models.default`, then the global config `models.roles.<role>`, then the global config `models.default`, then the runtime's built-in default. Within each machine config scope a per-role model SHALL win over that scope's `models.default`, the machine scopes SHALL rank project > store > global entirely, and the store layers apply only where configuration inheritance is active (see `store-config-inheritance`). A model id at any layer SHALL be an opaque string accepted as-is (no allow-list rejection). `rasen pipeline show <name> --json` SHALL report each stage's resolved model with a source distinguishing the per-stage configured layers (scope-qualified) from the stage, pipeline, project, store, and global layers, and the resolved model SHALL be the one the model-preset (handoff/reuse threshold) layer keys off. Setting a per-stage instance SHALL NOT write any pipeline definition file.

#### Scenario: Per-stage instance beats the stage-level YAML model

- **WHEN** a stage declares `model: sonnet` in its pipeline definition and `pipelines.<name>.models.<that stage>` is set to `fable` at project scope
- **THEN** the stage's resolved model is `fable` with a per-stage project source, and the pipeline definition file is unmodified

#### Scenario: Per-stage instances rank project over store over global

- **WHEN** the same per-stage instance is set to different values at global and project scope
- **THEN** the project value wins, and with only store and global set, the store value wins

#### Scenario: Chain below the top layer is unchanged

- **WHEN** no per-stage instance exists for a stage
- **THEN** resolution ranks stage > pipeline role default > project role > project default > store role > store default > global role > global default > runtime default, byte-identically to before this capability, including all store-layer and no-store behaviors

#### Scenario: pipeline show reports the per-stage source

- **WHEN** a per-stage instance determines a stage's effective model and the user runs `rasen pipeline show <name> --json`
- **THEN** that stage's reported model is the instance value with a source identifying the per-stage configured layer and its scope

### Requirement: Per-role runtime updates persist as configuration, not pipeline copies

`rasen pipeline agents <name>` SHALL keep its command surface (per-role runtime flags, `--json`, root selection) while persisting per-role runtime updates as `pipelines.<name>.runtimes.<role>` configuration instances written to the resolved root's configuration through the standard config write path — it SHALL NOT write a pipeline definition file. The effective runtime for a role SHALL resolve: the per-role runtime family instance (project over store over global) first, then the pipeline's declared `agents.<role>.runtime`, then the default runtime. Reads SHALL report each role's resolved runtime with the layer that supplied it. A pipeline definition copy previously frozen into a project by the old behavior SHALL remain untouched and SHALL keep resolving as that project's definition (the project layer of pipeline resolution) — the inspection surface's source badge makes the frozen copy visible, and removing it is the user's explicit action, never an automatic migration.

#### Scenario: Setting a runtime writes config, not YAML

- **WHEN** the user runs `rasen pipeline agents small-feature --reviewer codex` in a project
- **THEN** a `pipelines.small-feature.runtimes.reviewer` instance is written to the project's configuration, no `pipeline.yaml` is created or modified, and subsequent upstream changes to the built-in pipeline keep applying in that project

#### Scenario: Runtime chain resolves config over declaration

- **WHEN** a pipeline declares `agents.reviewer.runtime: claude` and the project sets the reviewer runtime instance to `codex`
- **THEN** the reviewer-role stages resolve to `codex` with a config-layer source, and unsetting the instance reverts to the declaration

#### Scenario: Existing frozen copies stay visible, not silently migrated

- **WHEN** a project carries a full pipeline copy written by the old `agents` behavior
- **THEN** that copy still resolves as the project's definition with its project source badge shown, and no automatic deletion or rewrite occurs
