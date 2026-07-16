# pipeline-handoff-config Delta Specification

## MODIFIED Requirements

### Requirement: Handoff config resolution order
The effective handoff config for a stage SHALL resolve as: stage-level `handoff` > pipeline `handoff.roles[<stage role>]` (threshold only) > pipeline `handoff` > project config `handoff.threshold` (threshold only) > global config `handoff.threshold` (threshold only) > built-in defaults (`threshold: 0.5`, `maxRelays: 3`, `stallLimit: 2`). The config layers tune only the threshold; `maxRelays` and `stallLimit` resolve from pipeline declarations or built-in defaults. The resolved config's source SHALL name the config layers distinctly (e.g. `project-config`, `global-config`) so callers can report where the effective threshold came from.

#### Scenario: Role threshold applies when stage has no override
- **WHEN** a stage with `role: reviewer` has no stage-level `handoff` and the pipeline declares `handoff.roles.reviewer: 0.65`
- **THEN** the resolved threshold for that stage SHALL be 0.65
- **AND** its `maxRelays`/`stallLimit` SHALL come from the pipeline block or built-in defaults

#### Scenario: Defaults apply when nothing is configured
- **WHEN** neither the pipeline nor the stage declares `handoff` and no config layer sets `handoff.threshold`
- **THEN** the resolved config SHALL be the built-in defaults

#### Scenario: Project config threshold applies below pipeline declarations
- **WHEN** neither the pipeline nor the stage declares a handoff threshold
- **AND** the project's `rasen/config.yaml` sets `handoff.threshold: 0.4`
- **THEN** the resolved threshold SHALL be 0.4 with a source identifying the project config layer
- **AND** `maxRelays`/`stallLimit` SHALL still resolve from pipeline declarations or built-in defaults

#### Scenario: Global config threshold is the project fallback
- **WHEN** no pipeline, stage, or project config threshold is set
- **AND** the global config sets `handoff.threshold: 0.65`
- **THEN** the resolved threshold SHALL be 0.65 with a source identifying the global config layer

#### Scenario: Pipeline declarations beat config layers
- **WHEN** a pipeline declares `handoff.threshold: 0.7` and the project config sets `handoff.threshold: 0.4`
- **THEN** the resolved threshold for its stages SHALL be 0.7
