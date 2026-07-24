# pipelines-ui Specification

## Purpose
Provide a per-space Pipelines page in the management web UI presenting each pipeline's structure and effective per-stage configuration together, with editable configuration-family controls and CLI-backed library management (init, import, export, delete) through the pipeline-http-api endpoints.
## Requirements
### Requirement: A Pipelines page presents each pipeline's structure and configuration together

The web UI SHALL provide a Pipelines route within each planning space, reachable from the header navigation beside the Board, Archive, and Config entries. For every pipeline available in the addressed space the page SHALL always show a scannable summary — a provenance badge (built-in or user), the layer the definition resolves from (project, user, or package), the pipeline's description, the graph-view affordance, and the pipeline's stages in build order with each stage's id, role, and skill. The pipeline's effective per-stage configuration (gate, model, handoff threshold, runtime as the server resolved them, with their source layers) and its per-role runtime controls SHALL sit behind an explicit per-pipeline configure/expand affordance rather than rendering inline for every pipeline at once, so the list page reads as a library instead of a wall of controls; expanding one pipeline SHALL NOT require collapsing another. The structural view is read-only: the page SHALL offer no stage adding, removing, or reordering — structural editing remains pipeline authoring.

#### Scenario: List page reads as a scannable library

- **WHEN** the user opens the Pipelines page in a space with several pipelines
- **THEN** each pipeline shows its name, badges, description, and build-order stage lane, and no per-stage configuration controls render until that pipeline's configure affordance is expanded

#### Scenario: Stage graph with effective values on demand

- **WHEN** the user expands a pipeline's configure affordance
- **THEN** that pipeline's stages show their effective gate, model, handoff, and runtime with the source layer that supplied each, with the same editable controls as before

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

The page SHALL offer pipeline library actions through the pipelines API's CLI-backed bridge, never by the browser touching the filesystem, and SHALL offer each action only where the CLI supports it: **import** (a picked `.rasenpkg`, with an explicit overwrite retry when a same-name pipeline is already installed), **export** (user pipelines only — the CLI refuses to export a built-in or project pipeline; picked destination and filename, explicit overwrite retry on an existing destination), **delete** (user pipelines only, behind confirmation; a referrer-guard refusal shows the CLI's message naming the referrers with a separately confirmed force option). Creating a new pipeline SHALL be a single entry on the page: the name-first canvas assembly flow (the editor-save requirement's entry) — the page SHALL NOT offer a second, scaffold-to-disk creation dialog; scaffolding a draft directory remains a CLI capability (`rasen pipeline init`). A pipeline the CLI will not export or delete — a built-in (package) pipeline or a project-layer pipeline, i.e. anything not resolved from the user library — SHALL therefore present neither a delete nor an export affordance and SHALL be visibly locked, so no action leads to a dead CLI refusal. The bridge's **save** operation is exercised only by the canvas editor's save flow (its own requirement), not by a page dialog; draft validation's only UI surface is likewise the canvas editor — the page itself offers no separate validation control, and `rasen pipeline validate` remains the CLI path. Every failure SHALL surface the CLI's own error message verbatim, and the page SHALL prevent submitting a second mutation while one is in flight.

#### Scenario: One creation entry leads to the canvas

- **WHEN** the user looks for a way to create a pipeline on the Pipelines page
- **THEN** exactly one creation entry is offered (besides Import), and choosing it starts the name-first canvas assembly flow

#### Scenario: Non-user-library pipelines are locked

- **WHEN** the user views a pipeline that is not resolved from the user library (a built-in package pipeline or a project-layer pipeline)
- **THEN** neither a delete nor an export control is offered and the entry is visibly locked, matching what the CLI will accept

#### Scenario: Import conflict offers overwrite

- **WHEN** the user imports a package whose pipeline name is already installed
- **THEN** the CLI's refusal is shown and an explicit overwrite retry succeeds

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

The graph route SHALL offer an edit mode for editable pipelines (and for new drafts): entered by an explicit control, absent for built-ins. In edit mode the user SHALL be able to move stage cards freely (positions are session-only presentation — the saved definition carries no coordinates, and reopening auto-lays-out again), connect one stage to another to add a dependency, delete edges, and delete stages — deleting a stage also removes every dependency reference to it. A connection that would create a dependency cycle SHALL be rejected at connect time with a transient explanation and no edge added; this instant check is a convenience, with the server's draft validation remaining the authority. A palette listing the installed skills from the pipeline catalog endpoint SHALL support dragging a skill onto the canvas to create a new stage (with a generated, editable stage id); skills the catalog reports as disabled SHALL be visibly greyed with their state named and SHALL not be placeable. A properties panel on the selected stage SHALL edit the stage's id (rewriting references), role, skill, gate, condition, verify policy, model, runtime, parallel group, and review-cycle loop settings — with every closed vocabulary sourced from the catalog endpoint's response, never restated in UI code — and the pipeline's description SHALL be editable in the header. Definition content the editor does not expose SHALL be preserved verbatim through editing and saving. Changing a stage's parallel group SHALL re-run auto-layout so group containers stay truthful, and a re-layout control SHALL be available at any time.

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

#### Scenario: Unexposed fields survive the editor

- **WHEN** the user edits one field of a pipeline whose definition carries content the panel does not expose (such as a goal-loop gate configuration or runtime session settings)
- **THEN** the saved definition preserves that content verbatim alongside the edit

### Requirement: The editor validates drafts and maps issues onto the canvas

The editor SHALL offer a validate action and SHALL always validate before saving, posting the current draft to the draft-validation endpoint. Returned issues SHALL be presented in an issues list carrying each issue's severity and message, and each issue whose locator path resolves to a stage SHALL be marked on that stage's card (and on the named field when its properties panel is open) with a select-the-stage affordance from the list; issues that resolve to no stage SHALL still appear in the list, never dropped. Error-severity issues SHALL block saving; warnings SHALL not. A draft stamped as UI-assembled that lacks the machine-enforced quality floor (a reviewer-role stage and a review-cycle loop stage) SHALL therefore surface that floor violation as a blocking issue in the editor before any save attempt.

#### Scenario: Issues land on their stages

- **WHEN** validation returns an error whose path points into the third stage's skill field
- **THEN** the third stage's card is marked, the issues list shows the message, and selecting the issue selects that stage

#### Scenario: Quality floor surfaces before save

- **WHEN** the user validates or attempts to save a UI-assembled draft with no reviewer-role stage
- **THEN** the floor violation appears as a blocking issue naming the missing stage kind, and no save request is sent

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

