# pipelines-ui Specification

## Purpose
Provide a per-space Pipelines page in the management web UI presenting each pipeline's structure and effective per-stage configuration together, with editable configuration-family controls and CLI-backed library management (init, import, export, delete) through the pipeline-http-api endpoints.
## Requirements
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

### Requirement: The pipeline library is managed from the page

The page SHALL offer pipeline library actions through the pipelines API's CLI-backed bridge, never by the browser touching the filesystem, and SHALL offer each action only where the CLI supports it: **import** (a `.rasenpkg` selected through the shared server-local chooser/fallback control, with an explicit overwrite retry when a same-name pipeline is already installed), **export** (user pipelines only; a destination directory selected through the same control plus a filename, with an explicit overwrite retry on an existing destination), and **delete** (user pipelines only, behind confirmation; a referrer-guard refusal shows the CLI's message naming the referrers with a separately confirmed force option).

For import and export, the visible path SHALL be the submitted selection: a typed dirty value SHALL resolve or fail inline before mutation, and unavailable or cancelled native choice SHALL leave the typed-path/server-browser fallback usable. Cross-platform destination construction SHALL retain the server-selected directory's native path semantics.

Creating a new pipeline SHALL be a single entry on the page: the name-first canvas assembly flow. The page SHALL NOT offer a second, scaffold-to-disk creation dialog; scaffolding a draft directory remains a CLI capability (`rasen pipeline init`). A pipeline the CLI will not export or delete, including a built-in package pipeline or a project-layer pipeline, SHALL present neither action and SHALL be visibly locked. The bridge's **save** operation SHALL be exercised only by the canvas editor's save flow, and draft validation's only UI surface SHALL likewise be the canvas editor. Every failure SHALL surface the CLI's own error message verbatim, and the page SHALL prevent submitting a second mutation while one is in flight.

#### Scenario: One creation entry leads to the canvas

- **WHEN** the user looks for a way to create a pipeline on the Pipelines page
- **THEN** exactly one creation entry is offered besides Import, and choosing it starts the name-first canvas assembly flow

#### Scenario: Non-user-library pipelines are locked

- **WHEN** the user views a pipeline that is not resolved from the user library, whether a built-in package pipeline or a project-layer pipeline
- **THEN** neither a delete nor an export control is offered and the entry is visibly locked, matching what the CLI will accept

#### Scenario: Import uses the shared package chooser

- **WHEN** the user selects a pipeline `.rasenpkg` through native choice or the fallback browser and activates Import
- **THEN** that visible absolute package path is submitted through the pipeline bridge instead of requiring manual copy/paste

#### Scenario: Dirty import path cannot submit an older value

- **WHEN** the user selects one package, types a different absolute package path, and immediately activates Import
- **THEN** only the typed visible path is resolved and submitted, or its inline error stops the import

#### Scenario: Import conflict offers overwrite

- **WHEN** the user imports a package whose pipeline name is already installed
- **THEN** the CLI's refusal is shown and an explicit overwrite retry succeeds

#### Scenario: Export uses a chosen destination directory

- **WHEN** the user selects an export directory through native choice or the fallback browser and enters a filename
- **THEN** the UI displays and submits the resulting absolute destination using the selected directory's native path semantics

#### Scenario: Windows export does not hardcode POSIX separators

- **WHEN** the selected Pipeline export directory is a Windows drive path
- **THEN** the destination preview and submitted path preserve Windows separator and drive behavior

#### Scenario: Native choice falls back safely

- **WHEN** native file or directory choice is unavailable or cancelled
- **THEN** the current selection remains unchanged and the typed-path/server-browser fallback remains usable

#### Scenario: Guarded delete surfaces referrers

- **WHEN** the user confirms deleting a still-referenced user pipeline
- **THEN** the refusal names the referrers, and only a separate force confirmation deletes it

### Requirement: A per-pipeline graph view renders the stage DAG read-only

The web UI SHALL provide a per-pipeline graph view at a space-prefixed route (one additional path segment carrying the pipeline name under the space's pipelines section), reachable from a view-graph affordance on each pipeline section of the Pipelines page. The view SHALL render the pipeline's declared structure — obtained from the pipeline detail endpoint — as a left-to-right auto-laid-out directed graph: one card per stage showing the stage id, its role (in the page's existing role badge language), its skill, and its effective gate state; one edge per declared dependency; and stages sharing a parallel group rendered inside a labeled group container. Effective per-stage values (model, handoff, runtime, with their source layers) SHALL be available from a stage card without leaving the view. In its view mode the graph SHALL be read-only: zooming, panning, fitting, and selecting are offered, while moving stages, adding or removing stages or edges, and any form of definition editing are not; editing happens only in the same route's explicit edit mode (its own requirement). A pipeline whose detail reports it non-editable (a built-in) SHALL state its read-only provenance, offer no edit mode, and offer a duplicate-to-edit affordance that starts a new draft seeded from its definition under a new name. An unknown pipeline name SHALL present a not-found message with a way back to the Pipelines page, and detail-endpoint errors SHALL surface their message and fix hint like other pages.

#### Scenario: DAG structure is visible

- **WHEN** the user opens the graph view of a pipeline where two stages both require `apply` and a later stage requires both
- **THEN** the canvas shows the fork and the convergence as edges between stage cards, in left-to-right dependency order — structure the flat build-order lane cannot show

#### Scenario: Parallel group is drawn as a group

- **WHEN** a pipeline declares stages sharing a `parallelGroup`
- **THEN** those stage cards render inside one labeled group container, and stages outside the group render outside it

#### Scenario: View mode is read-only

- **WHEN** the user interacts with the graph in view mode
- **THEN** zoom, pan, fit, and selection work, and no interaction moves a stage, creates or deletes an edge, or modifies the pipeline definition

#### Scenario: Built-in provenance stated and duplicable

- **WHEN** the user opens the graph view of a built-in pipeline
- **THEN** the view states that the pipeline is built-in and read-only, offers no edit mode, and offers duplicating it into a new editable draft under a different name

#### Scenario: Unknown pipeline

- **WHEN** the user navigates to a graph route naming a pipeline that does not exist in the addressed space
- **THEN** the view shows a not-found message and offers navigation back to the Pipelines page

### Requirement: The graph view loads its canvas code lazily

The graph view's canvas machinery SHALL live in a lazily loaded bundle chunk that is fetched only when a graph route is opened: opening the Board, Config, Workflows, Spaces, Archive, or Pipelines list pages SHALL NOT load the canvas libraries. Navigating to a graph route SHALL show a loading state until the chunk and the pipeline detail have loaded.

#### Scenario: List pages stay canvas-free

- **WHEN** the user browses the management UI without opening a graph route
- **THEN** the canvas chunk is never fetched

#### Scenario: Canvas loads on demand

- **WHEN** the user opens a pipeline's graph view for the first time
- **THEN** the canvas chunk is fetched, a loading state covers the fetch, and the graph renders

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

### Requirement: The editor validates drafts and maps issues onto the canvas

The editor SHALL offer a validate action and SHALL always validate before saving, posting the current draft to the draft-validation endpoint. Returned issues SHALL be presented in an issues list carrying each issue's severity and message, and each issue whose locator path resolves to a stage SHALL be marked on that stage's card (and on the named field when its properties panel is open) with a select-the-stage affordance from the list; issues that resolve to no stage SHALL still appear in the list, never dropped. Error-severity issues SHALL block saving; warnings SHALL not. The `origin: ui` stamp records Canvas provenance only: an otherwise valid UI-assembled draft SHALL NOT receive a quality-floor issue merely because it lacks a reviewer-role stage, a review-cycle loop stage, or both.

#### Scenario: Issues land on their stages

- **WHEN** validation returns an error whose path points into the third stage's skill field
- **THEN** the third stage's card is marked, the issues list shows the message, and selecting the issue selects that stage

#### Scenario: Floor-free Canvas draft remains valid

- **WHEN** the user validates or attempts to save an otherwise valid UI-assembled draft with no reviewer-role stage, no review-cycle loop stage, or both
- **THEN** validation reports no quality-floor error for those omissions and saving may proceed

#### Scenario: Ordinary validation errors still block

- **WHEN** a UI-assembled draft has an error-severity issue from any remaining schema, graph, decompose, or skill validation rule
- **THEN** the issue is shown and no save request is sent

#### Scenario: Warnings do not block

- **WHEN** validation returns only warning-severity issues
- **THEN** the issues are listed, the affected stages are marked, and saving proceeds

### Requirement: The editor saves through the bridge with a UI origin stamp

The editor's save SHALL submit the draft through the pipelines mutation bridge's save operation with the definition stamped as UI-assembled (`origin: 'ui'`), after a passing validation. A successful save SHALL clear the unsaved state, re-fetch the pipeline, and return to view mode, distinguishing created from overwritten. A name-collision refusal SHALL surface the server's message and offer an explicit overwrite retry — never overwriting silently; a busy-bridge response SHALL be reported with a manual retry, never an automatic retry loop; any other refusal SHALL surface the server's message verbatim. A new pipeline SHALL be assembled from a name-first entry on the Pipelines page that opens the canvas editor with an empty draft under the chosen name — with no reserved name segment, so a pipeline named `new` is never shadowed — and the not-found view for an unsaved draft's address SHALL offer starting that draft.

#### Scenario: Save stamps the UI origin

- **WHEN** the user saves an assembled draft
- **THEN** the request body's definition carries `origin: 'ui'`, and the saved pipeline loads back with that origin

#### Scenario: Collision offers explicit overwrite

- **WHEN** the user saves a draft under a name that already exists in the user library
- **THEN** the refusal is shown and only an explicit overwrite confirmation retries with force

#### Scenario: New pipeline from the page

- **WHEN** the user chooses to assemble a new pipeline and enters a valid name
- **THEN** the canvas editor opens in edit mode with an empty draft under that name, and saving installs it as a user pipeline

### Requirement: Unsaved editor changes are guarded

While the editor holds unsaved changes it SHALL show an unsaved indicator, SHALL ask for confirmation before in-app navigation away from the editor or exiting edit mode, and SHALL engage the browser's unload confirmation; all three release once the draft is saved or explicitly discarded. A discard action SHALL restore the last-loaded definition.

#### Scenario: Navigation while dirty asks first

- **WHEN** the user edits a stage and then follows the back link without saving
- **THEN** a confirmation offers discarding or continuing to edit, and choosing to stay preserves the draft

#### Scenario: Save releases the guards

- **WHEN** the user saves successfully and then navigates away
- **THEN** no confirmation is demanded

### Requirement: The canvas page fits a single viewport

The pipeline graph route (view and edit modes) SHALL fit within the browser viewport: in a real browser the document SHALL present no page-level scrollbar on this route — the application shell itself is bounded to the viewport, so no amount of panel content can grow the page. The skills palette and the stage properties panel SHALL scroll independently within their own bounds, and the canvas area SHALL fill the remaining space, keeping the canvas, its toolbar, and any feedback surfaces (including validation errors at the canvas bottom) simultaneously visible regardless of how many skills are installed. Other routes keep their normal scrolling behavior. Because DOM-only test environments perform no layout, this contract SHALL be verified against real browser layout (a measured document that does not exceed the viewport height), not solely by asserting markup.

#### Scenario: Long skill list never hides the canvas

- **WHEN** the user opens the canvas editor with more installed skills than fit the viewport height
- **THEN** the skills palette scrolls within its own panel while the canvas, toolbar, and feedback surfaces stay fully visible without scrolling the page

#### Scenario: No document scrollbar in a real browser

- **WHEN** the canvas editor is opened in a real browser with a fully populated skills palette
- **THEN** the document's scrollable height does not exceed the viewport (no page-level scrollbar), and validation feedback at the bottom of the canvas is on screen

#### Scenario: Only the canvas route is viewport-locked

- **WHEN** the user navigates from the canvas back to the Pipelines list or any other page
- **THEN** those pages scroll normally as before

### Requirement: Validation and save feedback is always visible

Running validation SHALL always produce visible feedback in the editor's control area: a clean result states that no issues were found, and a result with findings states the error and warning counts. The full issue list SHALL present within the visible editor viewport — each issue severity-tagged with its message and, when it maps to a stage, a click-to-locate affordance that selects that stage (opening its properties panel); issues that map to no stage remain listed. When a save is blocked by validation errors, the same visible issue presentation SHALL accompany the blocked-save message so the user can see exactly what to fix without hunting. Feedback SHALL never go stale silently: editing the draft after a validation clears or visibly invalidates the previous result.

#### Scenario: Clean validate confirms visibly

- **WHEN** the user validates a draft that produces no issues
- **THEN** a visible confirmation that no issues were found appears near the validate control (not silence)

#### Scenario: Findings are counted and listed on screen

- **WHEN** the user validates a draft with two errors and one warning
- **THEN** the control area states the counts and the issue list is visible within the viewport, each issue showing its severity and message

#### Scenario: Blocked save shows the blocking issues

- **WHEN** the user saves a draft that validation blocks
- **THEN** the blocked message appears together with the visible list of blocking issues, and clicking an issue that maps to a stage selects that stage for fixing

#### Scenario: Editing invalidates a previous result

- **WHEN** the user validates cleanly and then modifies the draft
- **THEN** the earlier "no issues" confirmation no longer presents as current

### Requirement: Canvas controls are legible and unbranded

The canvas's viewport controls (zoom, fit) SHALL render with the app's own visual identity so their icons are clearly visible against their background in both the light and dark color schemes, with a visible hover state. The canvas SHALL NOT display third-party library attribution or watermarks.

#### Scenario: Control icons visible in both schemes

- **WHEN** the user views the canvas controls in the light scheme and in the dark scheme
- **THEN** the control icons are clearly legible against their button background in both, without requiring hover to become visible

#### Scenario: No third-party watermark

- **WHEN** the user views any pipeline canvas
- **THEN** no third-party library attribution or logo renders on the canvas

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

### Requirement: Canvas holds one complete versioned Definition draft

Canvas SHALL load and save a complete version-discriminated Pipeline Definition
draft. It SHALL preserve v1 editing behavior and SHALL represent v2 directly;
Canvas MUST NOT maintain a second executable graph or flatten v2 into the v1
stage model.

#### Scenario: v2 fields survive an unrelated edit

- **WHEN** a user edits one exposed property of a v2 draft that contains declarations or typed fields the current panel does not expose
- **THEN** save preserves every unedited v2 field and the server returns the same semantic plan digest except for the intended edit

#### Scenario: v1 draft remains editable

- **WHEN** a user opens an existing editable v1 Pipeline
- **THEN** the existing stage editing experience and save contract remain available
- **AND** opening the draft does not rewrite it to version 2

### Requirement: Canvas edits the enabled v2 root vocabulary

In this slice, Canvas SHALL render, create, connect, select, edit, and delete v2
`AtomicStage`, `Gate`, `Choice`, and `Finish` root nodes. It SHALL expose stable
node identity, typed connections, branch outcomes, and terminal outcome mapping
needed by those nodes. Other known v2 kinds SHALL remain preserved in the draft
and visibly identified without claiming complete authoring support in this
slice.

#### Scenario: User assembles an enabled v2 root graph

- **WHEN** a user creates AtomicStage, Gate, Choice, and Finish nodes and connects compatible typed ports
- **THEN** Canvas retains stable node identities and submits the resulting v2 root graph for authoritative preparation

#### Scenario: Known but not yet editable kind is preserved

- **WHEN** Canvas loads a v2 definition containing a known node kind whose editor lands in a later slice
- **THEN** Canvas identifies the node as not editable in this version and preserves its definition content
- **AND** it does not reinterpret the node as an AtomicStage or unknown plug-in

### Requirement: Canvas and server diagnostics have locator parity

Canvas SHALL consume the server's shared diagnostic severity, code, message,
and JSON Pointer path and map paths to the corresponding root node, edge, or
property control. Client-side connection checks MAY provide immediate feedback,
but server preparation remains authoritative.

#### Scenario: Same invalid graph is marked in both planes

- **WHEN** a v2 graph has an invalid typed connection and is checked locally and by draft validation
- **THEN** Canvas and server identify the same consuming node and property path
- **AND** the server diagnostic remains visible in the issue list and on the mapped graph element

#### Scenario: Definition-level issue is not dropped

- **WHEN** a diagnostic points to a definition or declaration path rather than a visible root node
- **THEN** Canvas lists the issue with its full path and does not silently discard it

### Requirement: Canvas communicates preparation and execution capability

Canvas SHALL distinguish a valid draft, an available compiled plan, and an
executable runtime. A valid v2 definition with no installed runtime owner MAY be
saved and exported, but its Run affordance SHALL be unavailable with the
server-provided reason.

#### Scenario: Valid v2 draft can be authored but not run

- **WHEN** a v2 draft validates and compiles during this Definition-only slice
- **THEN** Canvas allows save and export
- **AND** Run is disabled with guidance that the reconciler runtime is not yet available
- **AND** Canvas exposes no Operations run controls

