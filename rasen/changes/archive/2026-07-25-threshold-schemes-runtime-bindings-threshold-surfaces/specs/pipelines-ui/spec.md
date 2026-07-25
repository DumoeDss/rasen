## MODIFIED Requirements

### Requirement: Per-stage configuration rows write the pipeline config families

Each stage row SHALL offer editable controls bound to the per-stage configuration families—gate (`on`/`off`/inherit) and model (a suggestion-backed text input accepting any id)—and each pipeline section SHALL offer per-role runtime controls bound to the runtime family. The stage's dual-form handoff threshold control SHALL remain available in that pipeline section under an explicit Advanced Overrides disclosure rather than occupying the ordinary stage row. Writes SHALL go through the config API as family-instance writes carrying the page's scope mode (the same Global/Local segmented control the Config page uses: Local targets the space's own scope, Global the machine scope), and an inherit/unset action SHALL remove the instance at the active scope so the value falls back down the chain. Setting any per-stage or per-role value SHALL never write a pipeline definition file. After a write the row SHALL re-render from the server's re-resolved state, including any binding metadata or fallback diagnostic the server reports.

#### Scenario: Gate a single stage in two writes

- **WHEN** the user sets `autopilot.gates` to `off` in the Defaults area and turns the `propose` stage's gate `on` for the `small-feature` pipeline
- **THEN** exactly two configuration values exist, the page shows `propose` as the only effective gate in that pipeline, and the setting survives a reload

#### Scenario: Stage model override without YAML

- **WHEN** the user sets a model on one stage and reloads the pipelines listing
- **THEN** the stage's effective model is the override with a per-stage source, and no pipeline definition file was created or modified in the space

#### Scenario: Unset falls back down the chain

- **WHEN** a stage has a Local-scope model override and the user unsets it in Local mode
- **THEN** the row re-renders with the value the chain resolves without that instance, naming the new source

#### Scenario: Stage threshold remains available but secondary

- **WHEN** the user expands a pipeline's configuration and opens Advanced Overrides
- **THEN** each stage offers its existing dual-form `pipelines.<name>.handoff.<stage>` control with source and inherit behavior
- **AND** those controls are absent from the ordinary collapsed stage row

### Requirement: The Defaults table presents the role matrix and autopilot keys

The Pipelines page SHALL retain a slim Defaults area presenting the base and per-role model keys (`models.default`, `models.roles.<role>`) as a compact role grid, together with the `autopilot.gates` mask base, `autopilot.selection`, and the separately specified keepalive beat control. These are ordinary configuration keys written through the config API under the page's scope mode, with suggestion-backed model inputs accepting any id.

The base and per-role handoff keys SHALL no longer appear as a primary column in this grid. They SHALL remain editable under Advanced Overrides, while scheme and binding sections become the primary threshold controls.

#### Scenario: Model defaults remain a compact grid

- **WHEN** the user views the Defaults area
- **THEN** the six model values render as one role-keyed grid
- **AND** no handoff-threshold column appears in that primary grid

#### Scenario: Defaults write like config keys

- **WHEN** the user edits `models.roles.reviewer` in Local mode at a project space
- **THEN** the write carries the project scope through the config API and the grid re-renders from the re-resolved response

#### Scenario: Legacy handoff keys remain reachable

- **WHEN** a user needs to inspect or change `handoff.threshold` or `handoff.roles.reviewer`
- **THEN** those keys are available with their dual-form controls and source badges after opening Advanced Overrides

## ADDED Requirements

### Requirement: The Pipelines page manages the threshold scheme library

The Pipelines page SHALL present the machine-level threshold scheme library as cards before the pipeline list. Each valid card SHALL show the scheme name, handoff scalar, reuse scalar, and expandable role overrides. An invalid scheme file SHALL render an error card without preventing valid schemes from loading.

The page SHALL support creating, editing, and deleting schemes through the threshold-scheme management API. Create and edit SHALL use structured dual-form fields and only the roles accepted by the core schema; create SHALL require a valid non-reserved name, edit SHALL preserve the name, and no write SHALL occur until the user confirms. Delete SHALL require confirmation that existing bindings may become dangling and fall through. Successful mutations SHALL refresh scheme cards, dynamic binding choices, binding warnings, and effective pipeline data.

#### Scenario: Create a complete scheme

- **WHEN** the user enters valid handoff/reuse values, optional role overrides, and the new name `tight`, then confirms
- **THEN** the API stores `tight`, its card appears, and it becomes available in binding selectors

#### Scenario: Edit preserves scheme identity

- **WHEN** the user edits the reuse scalar of `tight`
- **THEN** the update targets `tight` without offering a rename and the refreshed card shows the normalized stored value

#### Scenario: Validation failure does not dismiss the editor

- **WHEN** a scheme draft omits a required scalar or contains an invalid threshold
- **THEN** the editor displays an actionable field or API error, remains open with the user's draft, and no prior file is replaced

#### Scenario: Malformed file does not break the library

- **WHEN** the catalog returns one invalid entry and one valid scheme
- **THEN** the page shows the invalid entry's server error and continues to show and edit the valid scheme

#### Scenario: Delete warns about dangling bindings

- **WHEN** the user chooses to delete a scheme
- **THEN** confirmation states that bindings referencing it remain configured but will warn and fall through
- **AND** only an explicit confirmation submits delete

### Requirement: Built-in preset fallbacks are visible and seed editable schemes

The scheme library SHALL include a read-only preset area driven by the server's preset seed catalog. Each preset SHALL show its model match family, context-window size, handoff seed, reuse seed, and per-family source badge distinguishing a preset suggestion from a built-in default. Presets SHALL NOT be editable or bindable as if they were saved schemes.

Each preset SHALL offer “Seed scheme,” which opens the normal create editor populated from the server-provided complete seed. Seeding SHALL perform no write until the user supplies a valid scheme name and confirms creation.

#### Scenario: Read-only preset provenance is visible

- **WHEN** a GPT-5 preset supplies absolute handoff and reuse suggestions
- **THEN** its card shows both values with built-in-preset source badges and no edit action

#### Scenario: Default-filled preset is labeled honestly

- **WHEN** a preset has no threshold suggestion
- **THEN** its seed values display the family defaults with default source badges rather than claiming preset provenance

#### Scenario: Seed opens a draft without writing

- **WHEN** the user activates Seed scheme on a preset
- **THEN** the create editor opens with both scalar values populated and role maps empty
- **AND** no scheme appears until the user chooses a valid name and confirms

### Requirement: Runtime binding rows expose per-key scope and fallback behavior

The Pipelines page SHALL present runtime-to-scheme binding rows using the server-provided probe-capable runtime vocabulary plus the optional `default` row. Each represented row SHALL show its selected scheme, effective source badge, and configured global/store/project values needed to explain per-key override. Add SHALL offer only eligible rows that are not set at the active write scope, and remove SHALL unset only the active scope so a lower-scope value can reappear. Binding writes SHALL use the existing config API and Global/Local scope mode.

An inherited store binding SHALL follow the existing read-only/edit-in-store behavior in project-local mode. The `default` row SHALL be labeled as the fallback for other or unrecognized runtimes. A missing/invalid referenced scheme SHALL be marked dangling; the UI SHALL present server diagnostics/effective metadata rather than guessing which lower candidate won.

When no binding exists at any scope, the section SHALL show an empty state explaining that no runtime binding is configured and threshold resolution behaves exactly as before schemes. A future runtime that becomes probe-capable SHALL appear from the API vocabulary without a Pipelines component allow-list change.

#### Scenario: Bind one runtime without affecting another

- **WHEN** the user selects scheme `tight` for Codex at project scope
- **THEN** the config API writes only `thresholds.bindings.codex` at project scope
- **AND** Claude and default rows remain unchanged

#### Scenario: Source badge reflects per-key inheritance

- **WHEN** Codex is bound globally and overridden in the addressed project
- **THEN** its row shows the project scheme as effective and exposes the shadowed global value with scope badges

#### Scenario: Removing an override reveals the lower scope

- **WHEN** the user removes a project Codex binding while a global Codex binding exists
- **THEN** only the project key is unset and the row refreshes to the global value/source

#### Scenario: Default row is explicit and optional

- **WHEN** no default binding exists
- **THEN** the page does not fabricate one
- **AND** the user can explicitly add `default` from the allowed rows

#### Scenario: Empty state preserves compatibility

- **WHEN** no runtime or default binding is configured
- **THEN** the section states that legacy pipeline/config/preset/default resolution remains active

#### Scenario: Audit-only runtime never appears

- **WHEN** Zed remains audit-capable but not probe-capable
- **THEN** it is absent from add choices and rows

### Requirement: Advanced Overrides preserves legacy controls and gives non-destructive migration guidance

The Pipelines page SHALL provide a collapsed Advanced Overrides area for legacy machine handoff scalar/role keys, per-stage handoff instances, `keepalive.runtimes.*`, and `keepalive.contextFloor`. Every control SHALL preserve its existing validation, scope mode, source badge, and inherit/unset behavior. Keepalive controls SHALL be labeled as independent lifecycle/cache gates and SHALL NOT be presented as threshold binding rows.

When one or more effective runtime bindings coexist with an explicitly configured legacy `handoff.threshold` or `handoff.roles.<role>` value, the page SHALL show a migration notice. The notice SHALL explain the actual precedence—configured stage instance and stage YAML remain above schemes; a usable bound scheme outranks pipeline-wide and legacy machine thresholds—and SHALL warn that stored legacy values can become active again when bindings are removed or unusable. It SHALL link or focus the scheme editor and Advanced Overrides but SHALL NOT create, rename, bind, unset, or delete any value automatically.

#### Scenario: Advanced area is collapsed by default

- **WHEN** the user opens the Pipelines page
- **THEN** dense legacy threshold and keepalive controls do not occupy the primary scheme/binding view
- **AND** an explicit Advanced Overrides affordance reveals them

#### Scenario: Keepalive stays independent

- **WHEN** the user edits `keepalive.runtimes.claude` or `keepalive.contextFloor`
- **THEN** the existing config key is written with its existing scope rules and no threshold binding changes

#### Scenario: Coexistence produces guidance, not a mutation

- **WHEN** a runtime binding and a legacy role/scalar handoff value are both explicitly set
- **THEN** the migration notice explains which layer wins and where to inspect both
- **AND** merely viewing or dismissing the notice performs no write

#### Scenario: Legacy-only configuration is not misreported as migrated

- **WHEN** legacy handoff values exist but no binding is configured
- **THEN** the page does not claim they are shadowed by schemes and the empty binding state explains compatibility behavior
