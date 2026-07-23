## ADDED Requirements

### Requirement: A per-pipeline graph view renders the stage DAG read-only

The web UI SHALL provide a per-pipeline graph view at a space-prefixed route (one additional path segment carrying the pipeline name under the space's pipelines section), reachable from a view-graph affordance on each pipeline section of the Pipelines page. The view SHALL render the pipeline's declared structure — obtained from the pipeline detail endpoint — as a left-to-right auto-laid-out directed graph: one card per stage showing the stage id, its role (in the page's existing role badge language), its skill, and its effective gate state; one edge per declared dependency; and stages sharing a parallel group rendered inside a labeled group container. Effective per-stage values (model, handoff, runtime, with their source layers) SHALL be available from a stage card without leaving the view. The view SHALL be read-only: zooming, panning, fitting, and selecting are offered, while moving stages, adding or removing stages or edges, and any form of definition editing are not. A pipeline whose detail reports it non-editable (a built-in) SHALL state its read-only provenance in the view. An unknown pipeline name SHALL present a not-found message with a way back to the Pipelines page, and detail-endpoint errors SHALL surface their message and fix hint like other pages.

#### Scenario: DAG structure is visible

- **WHEN** the user opens the graph view of a pipeline where two stages both require `apply` and a later stage requires both
- **THEN** the canvas shows the fork and the convergence as edges between stage cards, in left-to-right dependency order — structure the flat build-order lane cannot show

#### Scenario: Parallel group is drawn as a group

- **WHEN** a pipeline declares stages sharing a `parallelGroup`
- **THEN** those stage cards render inside one labeled group container, and stages outside the group render outside it

#### Scenario: View is read-only

- **WHEN** the user interacts with the graph view of any pipeline
- **THEN** zoom, pan, fit, and selection work, and no interaction moves a stage, creates or deletes an edge, or modifies the pipeline definition

#### Scenario: Built-in provenance stated

- **WHEN** the user opens the graph view of a built-in pipeline
- **THEN** the view states that the pipeline is built-in and read-only, matching the detail endpoint's editable flag

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
