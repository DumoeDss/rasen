# pipelines-ui Delta Specification

## ADDED Requirements

### Requirement: A Pipelines page presents each pipeline's structure and configuration together

The web UI SHALL provide a Pipelines route within each planning space, reachable from the header navigation beside the Board, Archive, and Config entries. For every pipeline available in the addressed space the page SHALL show a provenance badge (built-in or user), the layer the definition resolves from (project, user, or package), and the pipeline's stages in build order — each stage with its id, role, skill, and its current effective gate, model, handoff threshold, and runtime as the server resolved them. The structural view is read-only: the page SHALL offer no stage adding, removing, or reordering — structural editing remains pipeline authoring.

#### Scenario: Stage graph with effective values

- **WHEN** the user opens the Pipelines page in a space
- **THEN** each pipeline renders its stages in build order with role and skill, and every stage shows its effective gate, model, handoff, and runtime with the source layer that supplied each

#### Scenario: Provenance and source layer are visible

- **WHEN** a project-layer pipeline shadows a built-in of the same name
- **THEN** the page shows the resolved definition with its project source badge, so a frozen or forked copy is visible rather than silent

### Requirement: Per-stage configuration rows write the pipeline config families

Each stage row SHALL offer editable controls bound to the per-stage configuration families — gate (`on`/`off`/inherit), model (a suggestion-backed text input accepting any id), and handoff threshold (the dual form) — and each pipeline section SHALL offer per-role runtime controls bound to the runtime family. Writes SHALL go through the config API as family-instance writes carrying the page's scope mode (the same Global/Local segmented control the Config page uses: Local targets the space's own scope, Global the machine scope), and an inherit/unset action SHALL remove the instance at the active scope so the value falls back down the chain. Setting any per-stage or per-role value SHALL never write a pipeline definition file. After a write the row SHALL re-render from the server's re-resolved state.

#### Scenario: Gate a single stage in two writes

- **WHEN** the user sets `autopilot.gates` to `off` in the Defaults area and turns the `propose` stage's gate `on` for the `small-feature` pipeline
- **THEN** exactly two configuration values exist, the page shows `propose` as the only effective gate in that pipeline, and the setting survives a reload

#### Scenario: Stage model override without YAML

- **WHEN** the user sets a model on one stage and reloads the pipelines listing
- **THEN** the stage's effective model is the override with a per-stage source, and no pipeline definition file was created or modified in the space

#### Scenario: Unset falls back down the chain

- **WHEN** a stage has a Local-scope model override and the user unsets it in Local mode
- **THEN** the row re-renders with the value the chain resolves without that instance, naming the new source

### Requirement: The Defaults table presents the role matrix and autopilot keys

The Pipelines page SHALL open with a Defaults table presenting the base and per-role model keys (`models.default`, `models.roles.<role>`) and the base and per-role handoff keys (`handoff.threshold`, `handoff.roles.<role>`) as a compact role-by-column grid, together with the `autopilot.gates` mask base and `autopilot.selection` controls. These are ordinary configuration keys written through the config API under the page's scope mode, with the same controls they had on the Config page: dual-form threshold inputs and suggestion-backed model inputs accepting any id.

#### Scenario: Role matrix reads as a grid

- **WHEN** the user views the Defaults table
- **THEN** the six model values and six handoff values render as rows of one grid keyed by role, not as twelve unrelated entries

#### Scenario: Defaults write like config keys

- **WHEN** the user edits `models.roles.reviewer` in Local mode at a project space
- **THEN** the write carries the project scope through the config API and the grid re-renders from the re-resolved response

### Requirement: The pipeline library is managed from the page

The page SHALL offer pipeline library actions through the pipelines API's CLI-backed bridge, never by the browser touching the filesystem, and SHALL offer each action only where the CLI supports it: **init** (scaffold a draft to a picked output directory, success shows the draft path), **import** (a picked `.rasenpkg`, with an explicit overwrite retry when a same-name pipeline is already installed), **export** (user pipelines only — the CLI refuses to export a built-in or project pipeline; picked destination and filename, explicit overwrite retry on an existing destination), **delete** (user pipelines only, behind confirmation; a referrer-guard refusal shows the CLI's message naming the referrers with a separately confirmed force option). A pipeline the CLI will not export or delete — a built-in (package) pipeline or a project-layer pipeline, i.e. anything not resolved from the user library — SHALL therefore present neither a delete nor an export affordance and SHALL be visibly locked, so no action leads to a dead CLI refusal. Pipeline validation has no UI surface on this page — it stays the CLI path (`rasen pipeline validate`) and the Workflows page's concern; the pipelines mutation bridge admits only init/import/export/delete. Every failure SHALL surface the CLI's own error message verbatim, and the page SHALL prevent submitting a second mutation while one is in flight.

#### Scenario: Non-user-library pipelines are locked

- **WHEN** the user views a pipeline that is not resolved from the user library (a built-in package pipeline or a project-layer pipeline)
- **THEN** neither a delete nor an export control is offered and the entry is visibly locked, matching what the CLI will accept

#### Scenario: Import conflict offers overwrite

- **WHEN** the user imports a package whose pipeline name is already installed
- **THEN** the CLI's refusal is shown and an explicit overwrite retry succeeds

#### Scenario: Guarded delete surfaces referrers

- **WHEN** the user confirms deleting a still-referenced user pipeline
- **THEN** the refusal names the referrers, and only a separate force confirmation deletes it
