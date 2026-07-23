# pipelines-ui Delta

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: The canvas page fits a single viewport

The pipeline graph route (view and edit modes) SHALL fit within the browser viewport: the page itself SHALL NOT scroll with the length of its side panels. The skills palette and the stage properties panel SHALL scroll independently within their own bounds, and the canvas area SHALL fill the remaining space, keeping the canvas, its toolbar, and any feedback surfaces simultaneously visible regardless of how many skills are installed. Other routes keep their normal scrolling behavior.

#### Scenario: Long skill list never hides the canvas

- **WHEN** the user opens the canvas editor with more installed skills than fit the viewport height
- **THEN** the skills palette scrolls within its own panel while the canvas, toolbar, and feedback surfaces stay fully visible without scrolling the page

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
