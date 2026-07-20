## MODIFIED Requirements

### Requirement: Handoff config resolution order
The effective handoff config for a stage SHALL resolve as: stage-level `handoff` > pipeline `handoff.roles[<stage role>]` (threshold only) > pipeline `handoff` > project config `handoff.roles[<stage role>]` (threshold only) > project config `handoff.threshold` (threshold only) > global config `handoff.roles[<stage role>]` (threshold only) > global config `handoff.threshold` (threshold only) > model preset (threshold only — the suggested `handoffThreshold` of the preset matching the stage's resolved model) > built-in defaults (`threshold: 0.5`, `maxRelays: 3`, `stallLimit: 2`). Within each machine config scope, a role-specific threshold SHALL win over that scope's scalar `handoff.threshold`, and the project scope SHALL win over the global scope entirely. The config layers and the preset layer tune only the threshold; `maxRelays` and `stallLimit` resolve from pipeline declarations or built-in defaults. Every threshold value at every layer (pipeline, role, stage, project config scalar, project config role, global config scalar, global config role, preset) SHALL accept the dual form: a bare number, ALWAYS a fraction of the context window in (0, 1], or the object `{ remainingTokens: <positive integer> }`, an absolute required-headroom threshold in tokens. The resolved config's source SHALL name the layer that supplied the resolved threshold specifically, in this same precedence order (`stage`, `role`, `pipeline`, `project-role`, `project-config`, `global-role`, `global-config`, `preset`, or `default`) — not merely a layer whose `handoff` block is non-empty.

#### Scenario: Role threshold applies when stage has no override
- **WHEN** a stage with `role: reviewer` has no stage-level `handoff` and the pipeline declares `handoff.roles.reviewer: 0.65`
- **THEN** the resolved threshold for that stage SHALL be 0.65
- **AND** its `maxRelays`/`stallLimit` SHALL come from the pipeline block or built-in defaults

#### Scenario: Model preset applies when nothing is configured
- **WHEN** neither the pipeline nor the stage declares any handoff threshold, no config layer sets a scalar or per-role threshold, and the stage's resolved model matches a preset carrying a suggested handoff threshold
- **THEN** the resolved threshold SHALL be the preset's suggested value
- **AND** the resolved config's `source` SHALL be `preset`
- **AND** `maxRelays`/`stallLimit` SHALL remain the built-in defaults

#### Scenario: Configured threshold overrides the preset
- **WHEN** the pipeline declares any handoff threshold (stage, role, or pipeline level) for a stage whose model matches a preset
- **THEN** the configured value SHALL win over the preset's suggested value

#### Scenario: Defaults apply when nothing is configured
- **WHEN** neither the pipeline nor the stage declares `handoff` and no config layer sets any scalar or per-role `handoff` threshold
- **THEN** the resolved config SHALL be the built-in defaults

#### Scenario: Project config threshold applies below pipeline declarations
- **WHEN** neither the pipeline nor the stage declares a handoff threshold
- **AND** the project's `rasen/config.yaml` sets `handoff.threshold: 0.4`
- **THEN** the resolved threshold SHALL be 0.4 with a source identifying the project config layer
- **AND** `maxRelays`/`stallLimit` SHALL still resolve from pipeline declarations or built-in defaults

#### Scenario: Project per-role threshold beats the project scalar
- **WHEN** neither the pipeline nor the stage declares a handoff threshold
- **AND** the project config sets both `handoff.threshold: 0.4` and `handoff.roles.reviewer: 0.7`
- **AND** the stage's role is `reviewer`
- **THEN** the resolved threshold SHALL be 0.7 with a source identifying the project role layer
- **AND** a stage whose role is not `reviewer` SHALL resolve to the project scalar 0.4

#### Scenario: Global config threshold is the project fallback
- **WHEN** no pipeline, stage, or project config threshold (scalar or per-role) is set
- **AND** the global config sets `handoff.threshold: 0.65`
- **THEN** the resolved threshold SHALL be 0.65 with a source identifying the global config layer

#### Scenario: Global per-role threshold beats the global scalar
- **WHEN** no pipeline, stage, or project config threshold is set
- **AND** the global config sets both `handoff.threshold: 0.6` and `handoff.roles.implementer: 0.8`
- **AND** the stage's role is `implementer`
- **THEN** the resolved threshold SHALL be 0.8 with a source identifying the global role layer

#### Scenario: Project layer beats the global layer for the same role
- **WHEN** the project config sets `handoff.roles.reviewer: 0.5` and the global config sets `handoff.roles.reviewer: 0.9`
- **AND** the stage's role is `reviewer`
- **THEN** the resolved threshold SHALL be 0.5 (the project per-role value wins over the global per-role value)

#### Scenario: Pipeline declarations beat config layers
- **WHEN** a pipeline declares `handoff.threshold: 0.7` and the project config sets `handoff.threshold: 0.4` and `handoff.roles.reviewer: 0.3`
- **THEN** the resolved threshold for its stages SHALL be 0.7

#### Scenario: A config layer accepts the absolute threshold form
- **WHEN** the project or global config sets `handoff.threshold: { remainingTokens: 45000 }`, or a per-role `handoff.roles.reviewer: { remainingTokens: 45000 }`
- **THEN** the resolved threshold SHALL be `{ remainingTokens: 45000 }` with a source identifying that config layer

#### Scenario: A config layer beats the model-preset layer
- **WHEN** neither the pipeline nor the stage declares a handoff threshold, a project or global config scalar or per-role threshold is set, and the stage's resolved model also matches a preset carrying a suggested handoff threshold
- **THEN** the resolved threshold SHALL come from the config layer, not the preset
- **AND** the resolved config's source SHALL identify the config layer, not `preset`
