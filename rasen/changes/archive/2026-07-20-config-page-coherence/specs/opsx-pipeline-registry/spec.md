## ADDED Requirements

### Requirement: Machine config supplies a per-role agent model layer
The effective model for a stage SHALL incorporate machine configuration layers below the pipeline's per-role runtime override and above the runtime's own default. A project or machine (global) config MAY declare a base model under `models.default` and per-role model overrides under `models.roles.<role>` for the closed role set (`planner`, `implementer`, `reviewer`, `fixer`, `shipper`). The effective stage model SHALL resolve with precedence: the stage-level `model` first, then the pipeline `agents.<role>.model` role default, then the project config `models.roles.<role>`, then the project config `models.default`, then the global config `models.roles.<role>`, then the global config `models.default`, then the runtime's built-in default (no configured model). Within each machine config scope a per-role model SHALL win over that scope's `models.default`, and the project scope SHALL win over the global scope entirely. A model id at any layer SHALL be an opaque string accepted as-is; a value matching no model-preset SHALL still be used (no allow-list rejection). `rasen pipeline show <name> --json` SHALL report each stage's resolved model, and the resolved model SHALL be the one the model-preset (handoff/reuse threshold) layer keys off.

#### Scenario: Global base model applies when nothing more specific is set
- **WHEN** the global config sets `models.default: sonnet`, no project model config or pipeline `agents.<role>.model` applies to a stage, and the stage sets no `model`
- **THEN** the stage's resolved model SHALL be `sonnet`

#### Scenario: Per-role model beats the base within a scope
- **WHEN** the global config sets `models.default: sonnet` and `models.roles.reviewer: fable`
- **AND** neither the pipeline nor the stage sets a model for a `reviewer`-role stage
- **THEN** that stage's resolved model SHALL be `fable`, while a non-reviewer stage resolves to `sonnet`

#### Scenario: Project model config beats global
- **WHEN** the global config sets `models.roles.reviewer: sonnet` and the project config sets `models.roles.reviewer: fable`
- **THEN** a `reviewer`-role stage resolves to `fable` (the project value wins over the global value)

#### Scenario: Pipeline role default beats machine config
- **WHEN** the pipeline declares `agents.reviewer.model: opus` and the global config sets `models.roles.reviewer: sonnet`
- **THEN** the `reviewer`-role stage resolves to `opus` (the pipeline role default wins over the machine config layer)

#### Scenario: Stage-level model wins over everything
- **WHEN** a stage sets `model: haiku` and the pipeline and machine config set other models for that role
- **THEN** the stage resolves to `haiku`

#### Scenario: An unrecognized model id is used as-is
- **WHEN** the project config sets `models.roles.implementer` to a model id that matches no built-in preset
- **THEN** the `implementer`-role stage resolves to that id unchanged, and `rasen pipeline show --json` reports it as the stage model
- **AND** the model-preset layer simply contributes no suggested threshold for it (the id resolves to no preset)

#### Scenario: pipeline show reflects the machine-config model
- **WHEN** a machine or project `models.*` value determines a stage's effective model and the user runs `rasen pipeline show <name> --json`
- **THEN** that stage's reported `model` SHALL be the machine-config-resolved value, with its source identifying the config layer that supplied it
