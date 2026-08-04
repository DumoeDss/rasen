## MODIFIED Requirements

### Requirement: A Pipelines page presents each pipeline's structure and configuration together

The web UI SHALL provide a Pipelines route within each planning space, reachable from the header navigation beside the Board, Archive, and Config entries. For every pipeline available in the addressed space the page SHALL always show a scannable summary—a provenance badge (built-in or user), the layer the definition resolves from (project, user, or package), the pipeline's description, the graph-view affordance, and the pipeline's stages in build order with each stage's id, role, and skill. The pipeline's editable per-stage gate, model, and effort configuration, including effective values and source layers, and its per-role runtime controls SHALL sit behind an explicit per-pipeline configure/expand affordance rather than rendering inline for every pipeline at once, so the list page reads as a library instead of a wall of controls; expanding one pipeline SHALL NOT require collapsing another. The structural view is read-only: the page SHALL offer no stage adding, removing, or reordering—structural editing remains pipeline authoring.

#### Scenario: List page reads as a scannable library

- **WHEN** the user opens the Pipelines page in a space with several pipelines
- **THEN** each pipeline shows its name, badges, description, and build-order stage lane, and no per-stage configuration controls render until that pipeline's configure affordance is expanded

#### Scenario: Configurable values appear on demand

- **WHEN** the user expands a pipeline's configure affordance
- **THEN** that pipeline's stages show editable effective gate, model, and effort controls with their source layers, together with the pipeline's per-role runtime controls

#### Scenario: Provenance and source layer are visible

- **WHEN** a project-layer pipeline shadows a built-in of the same name
- **THEN** the page shows the resolved definition with its project source badge, so a frozen or forked copy is visible rather than silent

### Requirement: Per-stage configuration rows write the pipeline config families

Each stage row SHALL offer editable controls bound to the per-stage gate (`on`/`off`/inherit), model (a suggestion-backed text input accepting any non-empty id), and reasoning effort (inherit, `low`, `medium`, `high`, `xhigh`, or `max`) configuration families, and each pipeline section SHALL offer per-role runtime controls bound to the runtime family. Writes SHALL go through the config API as family-instance writes carrying the page's scope mode (the same Global/Local segmented control the Config page uses: Local targets the space's own scope, Global the machine scope), and an inherit/unset action SHALL remove the instance at the active scope so the value falls back down the chain. Setting any per-stage gate, model, or effort or any per-role runtime value SHALL never write a pipeline definition file. After a write the row SHALL re-render from the server's re-resolved state.

The Configure surface SHALL reserve stage handoff authoring for the Canvas pipeline definition editor and SHALL NOT offer a mutation control for `pipelines.<name>.handoff.<stage>` instances. Existing instances remain compatibility inputs to server-side resolution.

#### Scenario: Gate a single stage in two writes

- **WHEN** the user sets `autopilot.gates` to `off` in the Defaults area and turns the `propose` stage's gate `on` for the `small-feature` pipeline
- **THEN** exactly two configuration values exist, the page shows `propose` as the only effective gate in that pipeline, and the setting survives a reload

#### Scenario: Stage model override without YAML

- **WHEN** the user sets a model on one stage and reloads the pipelines listing
- **THEN** the stage's effective model is the override with a per-stage source, and no pipeline definition file was created or modified in the space

#### Scenario: Stage effort override uses the active scope

- **WHEN** the user selects `max` for one stage while the Pipelines page is in project-local mode
- **THEN** the page writes only `pipelines.<name>.efforts.<stage>` at project scope and re-renders the stage with effective effort `max` and its per-stage project source

#### Scenario: Unset falls back down the chain

- **WHEN** a stage has a Local-scope effort override and the user selects Inherit in Local mode
- **THEN** only that stage effort instance is removed at Local scope, and the row re-renders with the effective effort and source the server resolves without it

#### Scenario: Inherited effort remains explained

- **WHEN** a stage has no active-scope effort instance but a role, authored pipeline, or lower configuration layer supplies its effort
- **THEN** the stage control shows Inherit as the editing choice while also displaying the backend-reported effective effort and source

#### Scenario: A shadowed scope remains independently editable

- **WHEN** the user edits Global mode while a project stage-effort instance wins the effective value
- **THEN** the effort control derives its Global editing choice from the exact config instance's global scope value rather than mistaking the project winner for a Global value
- **AND** choosing Inherit removes only the global instance while the backend-reported project effective value and source remain visible

#### Scenario: Configure remains focused

- **WHEN** the user expands a pipeline's Configure surface
- **THEN** stage gate, stage model, stage effort, and per-role runtime controls are available
- **AND** no stage handoff instance editor or nested Advanced stage threshold disclosure is offered

### Requirement: The Defaults table presents the role matrix and autopilot keys

The Pipelines page SHALL retain a slim Defaults area presenting the base and per-role model keys (`models.default`, `models.roles.<role>`) and the parallel reasoning-effort keys (`efforts.default`, `efforts.roles.<role>`) as one compact role grid for default, planner, implementer, reviewer, fixer, and shipper, together with the `autopilot.gates` mask base, `autopilot.selection`, and the separately specified keepalive lifecycle controls. These are ordinary configuration keys written through the config API under the page's scope mode. Model controls SHALL offer all existing suggestions plus `gpt-5.6-luna` and `gpt-5.6-terra` without restricting any other non-empty model id. Effort controls SHALL offer the supported `low`, `medium`, `high`, `xhigh`, and `max` values and an inherit/unset action that clears only the active scope.

The base and per-role legacy handoff keys SHALL not appear in the Defaults area. Threshold Schemes and runtime bindings SHALL be the page's ordinary controls for scalar and role-specific handoff policy, while stored legacy values remain backend compatibility inputs.

#### Scenario: Model and effort defaults remain a compact grid

- **WHEN** the user views the Defaults area
- **THEN** the six role rows render Model and Effort columns in one role-keyed grid
- **AND** no handoff-threshold column or legacy handoff editor appears in that area

#### Scenario: Defaults write like config keys

- **WHEN** the user edits `models.roles.reviewer` in Local mode at a project space
- **THEN** the write carries the project scope through the config API and the grid re-renders from the re-resolved response

#### Scenario: Role effort can inherit

- **WHEN** the project scope sets `efforts.roles.reviewer` and the user clears it through the reviewer Effort cell in Local mode
- **THEN** only the project value is removed and the cell re-renders the effective lower-scope or runtime-default value with its source

#### Scenario: Luna and Terra are suggestions, not restrictions

- **WHEN** the user opens a Defaults or per-stage model input
- **THEN** `gpt-5.6-luna` and `gpt-5.6-terra` appear alongside every existing model suggestion
- **AND** entering another non-empty custom model id writes that id unchanged

#### Scenario: Threshold policy has one ordinary home

- **WHEN** the user configures default or role-specific handoff policy from the Pipelines page
- **THEN** the page directs that work through Threshold Schemes and runtime bindings rather than machine legacy handoff controls
