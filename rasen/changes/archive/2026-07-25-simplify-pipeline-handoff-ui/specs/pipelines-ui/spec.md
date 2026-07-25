## MODIFIED Requirements

### Requirement: A Pipelines page presents each pipeline's structure and configuration together

The web UI SHALL provide a Pipelines route within each planning space, reachable from the header navigation beside the Board, Archive, and Config entries. For every pipeline available in the addressed space the page SHALL always show a scannable summary—a provenance badge (built-in or user), the layer the definition resolves from (project, user, or package), the pipeline's description, the graph-view affordance, and the pipeline's stages in build order with each stage's id, role, and skill. The pipeline's editable per-stage gate and model configuration, including effective values and source layers, and its per-role runtime controls SHALL sit behind an explicit per-pipeline configure/expand affordance rather than rendering inline for every pipeline at once, so the list page reads as a library instead of a wall of controls; expanding one pipeline SHALL NOT require collapsing another. The structural view is read-only: the page SHALL offer no stage adding, removing, or reordering—structural editing remains pipeline authoring.

#### Scenario: List page reads as a scannable library

- **WHEN** the user opens the Pipelines page in a space with several pipelines
- **THEN** each pipeline shows its name, badges, description, and build-order stage lane, and no per-stage configuration controls render until that pipeline's configure affordance is expanded

#### Scenario: Configurable values appear on demand

- **WHEN** the user expands a pipeline's configure affordance
- **THEN** that pipeline's stages show editable effective gate and model controls with their source layers, together with the pipeline's per-role runtime controls

#### Scenario: Provenance and source layer are visible

- **WHEN** a project-layer pipeline shadows a built-in of the same name
- **THEN** the page shows the resolved definition with its project source badge, so a frozen or forked copy is visible rather than silent

### Requirement: Per-stage configuration rows write the pipeline config families

Each stage row SHALL offer editable controls bound to the per-stage gate (`on`/`off`/inherit) and model (a suggestion-backed text input accepting any id) configuration families, and each pipeline section SHALL offer per-role runtime controls bound to the runtime family. Writes SHALL go through the config API as family-instance writes carrying the page's scope mode (the same Global/Local segmented control the Config page uses: Local targets the space's own scope, Global the machine scope), and an inherit/unset action SHALL remove the instance at the active scope so the value falls back down the chain. Setting any per-stage gate/model or per-role runtime value SHALL never write a pipeline definition file. After a write the row SHALL re-render from the server's re-resolved state.

The Configure surface SHALL reserve stage handoff authoring for the Canvas pipeline definition editor and SHALL NOT offer a mutation control for `pipelines.<name>.handoff.<stage>` instances. Existing instances remain compatibility inputs to server-side resolution.

#### Scenario: Gate a single stage in two writes

- **WHEN** the user sets `autopilot.gates` to `off` in the Defaults area and turns the `propose` stage's gate `on` for the `small-feature` pipeline
- **THEN** exactly two configuration values exist, the page shows `propose` as the only effective gate in that pipeline, and the setting survives a reload

#### Scenario: Stage model override without YAML

- **WHEN** the user sets a model on one stage and reloads the pipelines listing
- **THEN** the stage's effective model is the override with a per-stage source, and no pipeline definition file was created or modified in the space

#### Scenario: Unset falls back down the chain

- **WHEN** a stage has a Local-scope model override and the user unsets it in Local mode
- **THEN** the row re-renders with the value the chain resolves without that instance, naming the new source

#### Scenario: Configure remains focused

- **WHEN** the user expands a pipeline's Configure surface
- **THEN** stage gate, stage model, and per-role runtime controls are available
- **AND** no stage handoff instance editor or nested Advanced stage threshold disclosure is offered

### Requirement: The Defaults table presents the role matrix and autopilot keys

The Pipelines page SHALL retain a slim Defaults area presenting the base and per-role model keys (`models.default`, `models.roles.<role>`) as a compact role grid, together with the `autopilot.gates` mask base, `autopilot.selection`, and the separately specified keepalive lifecycle controls. These are ordinary configuration keys written through the config API under the page's scope mode, with suggestion-backed model inputs accepting any id.

The base and per-role legacy handoff keys SHALL not appear in the Defaults area. Threshold Schemes and runtime bindings SHALL be the page's ordinary controls for scalar and role-specific handoff policy, while stored legacy values remain backend compatibility inputs.

#### Scenario: Model defaults remain a compact grid

- **WHEN** the user views the Defaults area
- **THEN** the six model values render as one role-keyed grid
- **AND** no handoff-threshold column or legacy handoff editor appears in that area

#### Scenario: Defaults write like config keys

- **WHEN** the user edits `models.roles.reviewer` in Local mode at a project space
- **THEN** the write carries the project scope through the config API and the grid re-renders from the re-resolved response

#### Scenario: Threshold policy has one ordinary home

- **WHEN** the user configures default or role-specific handoff policy from the Pipelines page
- **THEN** the page directs that work through Threshold Schemes and runtime bindings rather than machine legacy handoff controls

### Requirement: The canvas editor composes and modifies pipelines

The graph route SHALL offer an edit mode for editable pipelines (and for new drafts): entered by an explicit control, absent for built-ins. In edit mode the user SHALL be able to move stage cards freely (positions are session-only presentation—the saved definition carries no coordinates, and reopening auto-lays-out again), connect one stage to another to add a dependency, delete edges, and delete stages—deleting a stage also removes every dependency reference to it. A connection that would create a dependency cycle SHALL be rejected at connect time with a transient explanation and no edge added; this instant check is a convenience, with the server's draft validation remaining the authority. A palette listing the installed skills from the pipeline catalog endpoint SHALL support dragging a skill onto the canvas to create a new stage (with a generated, editable stage id); skills the catalog reports as disabled SHALL be visibly greyed with their state named and SHALL not be placeable. A properties panel on the selected stage SHALL edit the stage's id (rewriting references), role, skill, gate, condition, verify policy, model, runtime, optional dual-form `handoff.threshold`, parallel group, and review-cycle loop settings—with every closed vocabulary and threshold constraint sourced from the catalog endpoint's response, never restated in UI code—and the pipeline's description SHALL be editable in the header. Definition content the editor does not expose SHALL be preserved verbatim through editing and saving. Changing a stage's parallel group SHALL re-run auto-layout so group containers stay truthful, and a re-layout control SHALL be available at any time.

#### Scenario: Assemble by drag and connect

- **WHEN** the user drags two skills from the palette onto the canvas and connects the first stage to the second
- **THEN** two stages exist with a dependency edge between them, each stage carrying the dragged skill and a generated id the user can rename

#### Scenario: Cycle rejected instantly

- **WHEN** the user attempts to connect a stage to one of its own (direct or transitive) prerequisites
- **THEN** no edge is created and a transient message explains the cycle, without any server round-trip

#### Scenario: Deleting a stage cleans its references

- **WHEN** the user deletes a stage that other stages require
- **THEN** the stage and every dependency reference to it are removed from the draft, and the canvas shows no dangling edge

#### Scenario: Disabled skills are visible but not placeable

- **WHEN** the catalog reports a skill as installed but disabled in the active selection
- **THEN** the palette shows it greyed with its disabled state named, and it cannot be dropped onto the canvas

#### Scenario: Stage handoff threshold is durable definition data

- **WHEN** the user selects fraction or remaining-tokens form for a stage handoff threshold, enters a valid value, and saves the Canvas draft
- **THEN** the corresponding `stage.handoff.threshold` value is saved in the pipeline definition and reloads in the same form
- **AND** no `pipelines.<name>.handoff.<stage>` config instance is created

#### Scenario: Clearing a stage threshold preserves other handoff fields

- **WHEN** a stage definition contains an authored threshold plus unexposed `maxRelays` or `stallLimit` and the user returns the threshold control to inherit
- **THEN** the threshold is removed while the unexposed handoff fields survive unchanged
- **AND** a handoff block containing no remaining fields is omitted rather than saved as an empty object

#### Scenario: Unexposed fields survive the editor

- **WHEN** the user edits one field of a pipeline whose definition carries content the panel does not expose (such as a goal-loop gate configuration or runtime session settings)
- **THEN** the saved definition preserves that content verbatim alongside the edit

### Requirement: The Defaults section offers a keepalive beat control

The Pipelines page's Defaults section SHALL offer one keepalive lifecycle area for the `keepalive.enabled`, `keepalive.beatSeconds`, `keepalive.runtimes.claude`, `keepalive.runtimes.codex`, and `keepalive.contextFloor` configuration keys, rendering each setting only when its key is visible in the active scope mode. The enabled switch and beat control SHALL show their effective values and sources, allow the user to write or unset them in Global mode or in Local mode for a project space, and SHALL NOT offer a Local write in a store space. The global-only runtime gates and context floor SHALL appear in the same lifecycle area in Global mode and use the standard config control, source, validation, and unset behavior.

The beat control SHALL offer one built-in preset—270 seconds (economy, the default)—plus a custom numeric input bounded to 90–280; activating the preset or committing a custom value SHALL write `keepalive.beatSeconds` through the config API exactly like other Defaults keys, and the control SHALL reflect the effective value on load and after each write (270 selects the economy preset, any other value presents as custom). The control SHALL display an informational derived tool-timeout hint of the effective beat plus 50 seconds, clearly presented as guidance for the shell tool timeout rather than a written setting. Unset SHALL be offered per key under the page's existing scope-mode rules, returning that key to its inherited or registry-default value. Labels, descriptions, state text, and accessible names for the lifecycle controls SHALL use the active UI locale.

#### Scenario: Preset writes the key

- **WHEN** the user activates the 270-second economy preset in Global mode
- **THEN** a config API write sets `keepalive.beatSeconds` to 270 at the global scope, and the control re-renders from the re-resolved response with the economy preset selected

#### Scenario: Custom value within bounds

- **WHEN** the user commits a custom value of 180
- **THEN** the write carries 180, and the control presents as custom with the derived tool-timeout hint showing 230 seconds

#### Scenario: Out-of-range custom value is rejected client-side and by the API

- **WHEN** the user enters 300 in the custom input
- **THEN** the control surfaces the 90–280 constraint and no successful write occurs

#### Scenario: Hint is informational only

- **WHEN** the user changes the beat value
- **THEN** the tool-timeout hint updates to beat + 50 seconds and no configuration key other than `keepalive.beatSeconds` is written

#### Scenario: Effective enabled state is visible

- **WHEN** the effective `keepalive.enabled` value is `false` from the global layer
- **THEN** the keepalive control presents the switch as off and identifies the global source without changing the retained beat value

#### Scenario: Project-local switch overrides global

- **WHEN** a user turns keepalive on in Local mode for a project whose inherited global value is off
- **THEN** the config API writes `keepalive.enabled: true` at project scope and the re-resolved control presents the switch as on with source `project`

#### Scenario: Unsetting the project switch restores inheritance

- **WHEN** a project-local `keepalive.enabled` value is unset
- **THEN** the control re-renders from the inherited global value and source returned by the config API

#### Scenario: Store-local mode does not offer the switch

- **WHEN** the Pipelines page is in Local mode for a store space
- **THEN** `keepalive.enabled` is not rendered as an editable setting because the key has no store scope

#### Scenario: Global lifecycle gates stay with keepalive

- **WHEN** the user selects Global mode
- **THEN** the Keepalive lifecycle area exposes the Claude and Codex runtime gates and context floor with their effective sources
- **AND** those keys are not presented as threshold overrides or scheme bindings

#### Scenario: Global-only lifecycle gates do not leak into Local mode

- **WHEN** the user selects Local mode for a project or store
- **THEN** the runtime gates and context floor are absent because their registry scopes are global-only

#### Scenario: Lifecycle copy follows the active locale

- **WHEN** the active UI locale changes among English, Japanese, and Simplified Chinese
- **THEN** the lifecycle labels, descriptions, state text, and accessible names update without remounting the page

## REMOVED Requirements

### Requirement: Advanced Overrides preserves legacy controls and gives non-destructive migration guidance

**Reason**: The pre-release Advanced Overrides surface duplicates the normal Threshold Scheme policy path, mixes handoff thresholds with unrelated worker-lifecycle settings, and exposes a temporary stage config layer that is superseded by durable Canvas definition editing.

**Migration**: Existing legacy machine handoff values and per-stage handoff config instances remain stored and continue to participate in backend resolution. Default and role-specific policy is authored through Threshold Schemes and bindings, durable stage exceptions are authored in Canvas, and keepalive runtime/context controls move to Defaults → Keepalive.
