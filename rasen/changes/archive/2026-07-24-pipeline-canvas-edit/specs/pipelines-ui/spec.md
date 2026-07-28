## MODIFIED Requirements

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

### Requirement: The pipeline library is managed from the page

The page SHALL offer pipeline library actions through the pipelines API's CLI-backed bridge, never by the browser touching the filesystem, and SHALL offer each action only where the CLI supports it: **init** (scaffold a draft to a picked output directory, success shows the draft path), **import** (a picked `.rasenpkg`, with an explicit overwrite retry when a same-name pipeline is already installed), **export** (user pipelines only — the CLI refuses to export a built-in or project pipeline; picked destination and filename, explicit overwrite retry on an existing destination), **delete** (user pipelines only, behind confirmation; a referrer-guard refusal shows the CLI's message naming the referrers with a separately confirmed force option). A pipeline the CLI will not export or delete — a built-in (package) pipeline or a project-layer pipeline, i.e. anything not resolved from the user library — SHALL therefore present neither a delete nor an export affordance and SHALL be visibly locked, so no action leads to a dead CLI refusal. The bridge's **save** operation is exercised only by the canvas editor's save flow (its own requirement), not by a page dialog; draft validation's only UI surface is likewise the canvas editor — the page itself offers no separate validation control, and `rasen pipeline validate` remains the CLI path. Every failure SHALL surface the CLI's own error message verbatim, and the page SHALL prevent submitting a second mutation while one is in flight.

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
