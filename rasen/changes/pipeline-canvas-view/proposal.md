## Why

The Pipelines page renders each pipeline's stages as a flat build-order lane, which hides the actual DAG: `requires` edges, parallel groups, and convergence points are invisible, and the flat list is the wrong substrate for the upcoming assembly editor (child 4). Child 2 shipped `GET /api/v1/pipelines/<name>` with the declared definition (the only wire source of `requires` and `parallelGroup`) precisely so a graph view can exist; this change builds that read-only view and establishes the canvas stack (React Flow v12 under preact/compat, validated end-to-end in `rasen/office-hours/canvas-demos/react-flow/`) that child 4 will extend into editing.

## What Changes

- A per-pipeline graph view in the management UI: a new space-prefixed route (`/p/:id/pipelines/:name`, `/s/:id/pipelines/:name`) opened from a "View graph" affordance on each pipeline section of the Pipelines page.
- Rendering: React Flow v12 (`@xyflow/react`) aliased to `preact/compat` (vite `resolve.alias` for `react`, `react-dom`, `react/jsx-runtime` — the proven demo pattern; no second React runtime ships), `dagre` left-to-right auto-layout, custom stage-card nodes in the existing UI design language (stage id, role badge, skill, gate indicator), `parallelGroup` members wrapped in React Flow group (subflow) nodes.
- Route-level lazy loading: the canvas and its dependencies (React Flow, dagre) live in a lazily loaded chunk fetched only when a graph route is opened; the existing pages' bundle stays canvas-free.
- Read-only affordances: fit-to-view on load, zoom/pan, React Flow Controls; node positions are layout-owned (no dragging), no connecting, no palette, no editing of any kind — structural editing arrives in child 4. Built-in pipelines show their read-only state (from the detail response's `editable` flag).
- Data source: `GET /api/v1/pipelines/<name>` (child 2's detail endpoint) — edges from the definition's `requires`, grouping from `parallelGroup`, badges joined from the resolved view. New client function plus `packages/ui/src/api/types.ts` mirror entries for the consumed shapes (`PipelineDetailResponse`, `WirePipelineDefinition` and its stage shape) — the mirror debt child 2 explicitly deferred to its first consumer.
- New UI dependencies: `@xyflow/react`, `dagre` (+ `@types/dagre`).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipelines-ui`: adds the pipeline graph view — a read-only, lazily loaded per-pipeline DAG canvas route presenting stages, dependency edges, and parallel groups, reachable from the Pipelines page.

## Impact

- Code: `packages/ui/src/app.tsx` (two lazy routes), `packages/ui/src/components/PipelinesPage.tsx` (View-graph affordance), new `packages/ui/src/canvas/` (canvas page, stage node, layout module), `packages/ui/src/api/client.ts` (+`getPipelineDetail`), `packages/ui/src/api/types.ts` (mirror entries), `packages/ui/vite.config.ts` (compat aliases), `packages/ui/tsconfig.json` (type path mapping for the alias), `packages/ui/package.json` (deps).
- Tests: layout module unit tests (pure: dagre positions, group bounding boxes, edge derivation from a definition), canvas page smoke under jsdom with the API mocked, and a build-output assertion that the canvas chunk is separate from the entry chunk.
- Server: none — consumes child 2's endpoints as shipped.
- Sets up child 4: the canvas module boundary, the definition mirror (declared in full so the editor re-touches nothing), and the alias infrastructure are all in place; child 4 adds interactivity, palette, validation overlay, and save.
