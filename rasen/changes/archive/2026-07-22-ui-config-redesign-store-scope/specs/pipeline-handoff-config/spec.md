# pipeline-handoff-config Delta Specification

## REMOVED Requirements

### Requirement: Handoff config resolution order

**Reason**: The machine-config portion of the chain gains a store scope between project and global (`store-role` and `store-config` layers). Replaced by "Handoff config resolution order with a store configuration layer".
**Migration**: Pipelines and projects without an active store layer resolve identically; the two new source values appear only where inheritance is active.

## ADDED Requirements

### Requirement: Handoff config resolution order with a store configuration layer

The effective handoff config for a stage SHALL resolve as: stage-level `handoff` > pipeline `handoff.roles[<stage role>]` (threshold only) > pipeline `handoff` > project config `handoff.roles[<stage role>]` (threshold only) > project config `handoff.threshold` (threshold only) > inherited store config `handoff.roles[<stage role>]` (threshold only) > inherited store config `handoff.threshold` (threshold only) > global config `handoff.roles[<stage role>]` (threshold only) > global config `handoff.threshold` (threshold only) > model preset (threshold only) > built-in defaults (`threshold: 0.5`, `maxRelays: 3`, `stallLimit: 2`). Within each machine config scope (project, store, global) a role-specific threshold SHALL win over that scope's scalar `handoff.threshold`, and the scopes SHALL rank project > store > global entirely. The store layer applies only when the project's configuration inherits from a store (see `store-config-inheritance`). The config layers and the preset layer tune only the threshold; `maxRelays` and `stallLimit` resolve from pipeline declarations or built-in defaults. Every threshold value at every layer SHALL accept the dual form: a bare number, ALWAYS a fraction of the context window in (0, 1], or the object `{ remainingTokens: <positive integer> }`. The resolved config's source SHALL name the layer that supplied the resolved threshold specifically, in this same precedence order (`stage`, `role`, `pipeline`, `project-role`, `project-config`, `store-role`, `store-config`, `global-role`, `global-config`, `preset`, or `default`) — not merely a layer whose `handoff` block is non-empty.

#### Scenario: Role threshold applies when stage has no override

- **WHEN** a stage with `role: reviewer` has no stage-level `handoff` and the pipeline declares `handoff.roles.reviewer: 0.65`
- **THEN** the resolved threshold for that stage SHALL be 0.65

#### Scenario: Store config threshold applies below the project layer

- **WHEN** neither the pipeline, the stage, nor the project config declares a handoff threshold
- **AND** the inherited store's config sets `handoff.threshold: 0.45`
- **THEN** the resolved threshold SHALL be 0.45 with source `store-config`

#### Scenario: Store per-role threshold beats the store scalar

- **WHEN** no pipeline, stage, or project threshold is set and the inherited store's config sets both `handoff.threshold: 0.45` and `handoff.roles.reviewer: 0.7`
- **THEN** a `reviewer`-role stage resolves to 0.7 with source `store-role`, and a non-reviewer stage resolves to 0.45 with source `store-config`

#### Scenario: Project layer beats the store layer

- **WHEN** the project config sets `handoff.threshold: 0.4` and the inherited store's config sets `handoff.roles.reviewer: 0.7`
- **AND** the stage's role is `reviewer`
- **THEN** the resolved threshold SHALL be 0.4 with source `project-config` (the project scope wins over the store scope entirely)

#### Scenario: Store layer beats the global layer

- **WHEN** the inherited store's config sets `handoff.roles.implementer: 0.8` and the global config sets `handoff.roles.implementer: 0.6`
- **AND** the stage's role is `implementer` with no pipeline, stage, or project threshold
- **THEN** the resolved threshold SHALL be 0.8 with source `store-role`

#### Scenario: No store layer without inheritance

- **WHEN** the project inherits from no store
- **THEN** resolution ranks exactly project > global > preset > default as before, and the `store-role`/`store-config` sources never appear

#### Scenario: Global config threshold is the store fallback

- **WHEN** no pipeline, stage, project, or store threshold is set and the global config sets `handoff.threshold: 0.65`
- **THEN** the resolved threshold SHALL be 0.65 with a source identifying the global config layer

#### Scenario: Pipeline declarations beat all config layers

- **WHEN** a pipeline declares `handoff.threshold: 0.7` and the project, store, and global configs set other thresholds
- **THEN** the resolved threshold for its stages SHALL be 0.7

#### Scenario: A store layer accepts the absolute threshold form

- **WHEN** the inherited store's config sets `handoff.threshold: { remainingTokens: 45000 }`
- **THEN** the resolved threshold SHALL be `{ remainingTokens: 45000 }` with source `store-config` when no higher layer supplies one

#### Scenario: A config layer beats the model-preset layer

- **WHEN** neither the pipeline nor the stage declares a handoff threshold, any machine config scope (project, store, or global) sets one, and the stage's resolved model also matches a preset carrying a suggested handoff threshold
- **THEN** the resolved threshold SHALL come from the config layer, with its source identifying that layer, not `preset`

#### Scenario: Defaults apply when nothing is configured

- **WHEN** neither the pipeline nor the stage declares `handoff` and no config layer sets any scalar or per-role `handoff` threshold
- **THEN** the resolved config SHALL be the built-in defaults
