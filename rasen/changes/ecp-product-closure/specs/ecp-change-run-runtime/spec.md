## ADDED Requirements

### Requirement: Engine selection is explicit, defaulted, and reversible

Rasen SHALL resolve which engine owns a NEW Run from an explicit policy — the `--engine` flag on `rasen pipeline start`, then the `runs.engine` configuration key (project, then store, then global), then the built-in default `auto` — and SHALL display the effective engine and its deciding source wherever a Run is launched. Under `auto`, the reconciler engine SHALL be selected exactly when the pipeline's capability discovery reports it supported, and the legacy path SHALL be used otherwise with the support reason shown. An explicit `reconciler` selection for an unsupported pipeline SHALL fail with the support reason rather than silently falling back. An explicit `legacy` configuration SHALL make `rasen pipeline start` refuse to create a canonical Run with a typed `engine_disabled_by_config` error naming the deciding configuration layer, so the reconciler engine can be turned off without editing any pipeline. Engine selection SHALL apply only at launch: it SHALL never re-home an existing Run, and legacy Runs SHALL continue to recover exactly as before regardless of the policy in effect.

#### Scenario: Default auto selects the reconciler where supported

- **WHEN** `rasen pipeline start` launches a Run for a pipeline whose capability discovery reports the reconciler supported, with no `--engine` flag and no `runs.engine` configuration
- **THEN** the Run SHALL be created with the reconciler engine owner
- **AND** the launch output SHALL show the effective engine and source (e.g. `engine: reconciler (auto)`)

#### Scenario: Explicit legacy disables canonical Run creation

- **WHEN** `runs.engine: legacy` is configured and `rasen pipeline start` is invoked
- **THEN** the command SHALL refuse with an `engine_disabled_by_config` error that names the deciding configuration layer
- **AND** no canonical Run Record SHALL be created

#### Scenario: Forced reconciler on an unsupported pipeline fails closed

- **WHEN** `--engine reconciler` is passed for a pipeline whose capability discovery reports the reconciler unsupported
- **THEN** the launch SHALL fail with that support reason
- **AND** SHALL NOT create a Run under either engine

#### Scenario: Flag overrides configuration

- **WHEN** `runs.engine: legacy` is configured and `rasen pipeline start --engine reconciler` is invoked for a supported pipeline
- **THEN** the Run SHALL be created with the reconciler engine owner and the output SHALL attribute the choice to the flag

#### Scenario: Legacy recovery is untouched by policy

- **WHEN** a change has only legacy run-state and any `runs.engine` value is configured
- **THEN** resuming that change SHALL follow the legacy recovery path unchanged
- **AND** the policy SHALL NOT migrate, adopt, or block that legacy Run
