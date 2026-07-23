## Context

The management UI is Preact 10 + preact-iso routing + vite (`packages/ui`); the Pipelines page (`components/PipelinesPage.tsx`) lists pipelines with a flat build-order lane. Child 2's detail endpoint (`GET /api/v1/pipelines/<name>`) returns `PipelineDetailResponse { pipeline, definition, editable }` (`src/core/management-api/wire-types.ts:108`); the RESOLVED stage shape (`WirePipelineStage`, wire-types.ts:56) carries no `requires`/`parallelGroup` — only the DEFINITION does, so the graph must be drawn from the definition, joined with the resolved view for effective-value badges.

The canvas stack was validated in `rasen/office-hours/canvas-demos/react-flow/` (main repo): React Flow v12 under preact/compat aliasing builds AND runs correctly (hooks, context, custom nodes, drag, minimap verified live via CDP; zero console errors; 94 kB vs 144 kB gzip against plain React). Fallback documented there: a plain-React island for just the canvas subtree if a future upgrade breaks compat — no canvas code rewrite needed.

This is child 3 of pipeline-online-assembly; scope is READ-ONLY view. Child 4 adds editing on top of the module boundary established here.

## Goals / Non-Goals

**Goals:**
- Per-pipeline DAG view: dependency edges, parallel groups, role/gate at a glance.
- Canvas code and libraries load only when a graph route is opened.
- Full definition mirror in `packages/ui/src/api/types.ts` so child 4 re-touches nothing there.

**Non-Goals:**
- No editing, connecting, palette, validation overlay, or save (child 4).
- No changes to the existing Pipelines page sections beyond the View-graph affordance.
- No server changes; no minimap (graphs are small — typical pipelines are 4-12 stages; child 4 can add one if the editor warrants it).

## Decisions

1. **Dedicated lazy route, not in-page expansion.** `/p/:projectId/pipelines/:name` and `/s/:storeId/pipelines/:name` render a `PipelineCanvasPage`. Rationale: a route is the only clean chunk boundary — preact-iso's `lazy()` gives route-level code splitting for free, so React Flow + dagre + the compat shim never load for users who never open a graph; it also gives the view a shareable URL and leaves the list page untouched. In-page expansion (rejected) would either eagerly pull the chunk into the list bundle or need ad-hoc dynamic-import plumbing, and couples list scrolling with canvas viewport gestures. The pipeline name segment is percent-encoded on link construction; the route falls back to a not-found message with a link back to the list when the detail call 404s.

2. **preact/compat aliasing is app-wide vite config, plus tsconfig `paths`.** `resolve.alias` maps `react` → `preact/compat`, `react-dom` → `preact/compat`, `react-dom/test-utils` → `preact/test-utils`, `react/jsx-runtime` → `preact/jsx-runtime` (the exact demo config). Only modules that import React resolve through it — today that is exactly `@xyflow/react` — the Preact app code is untouched. `tsconfig.json` gets matching `compilerOptions.paths` so `tsc --noEmit` typechecks React Flow's types against preact/compat's React-compatible type surface. Vitest inherits the vite aliases via the shared config.

3. **Canvas module layout — `packages/ui/src/canvas/`:**
   - `PipelineCanvasPage.tsx` — route component: fetches detail via the client, owns loading/error/not-found states (page-level error pattern of the existing pages, `fix` hint shown), renders header (pipeline name, provenance badge, read-only notice when `editable` is false) + the flow.
   - `StageNode.tsx` — custom node: stage id, role badge (existing role color language from the lane/stage rows), skill name, gate indicator derived from the resolved stage's `effectiveGate` (the value that actually pauses a run), tooltip carrying effective model/handoff/runtime with sources. Data joined by stage id from `detail.pipeline.stages`.
   - `layout.ts` — PURE functions (unit-testable without React Flow): `definitionToGraph(detail)` → `{ nodes, edges }` (edges: one per `requires` entry, source=required stage, target=dependent stage) and `layoutGraph(nodes, edges)` → dagre LR positions. Kept free of JSX so tests need no canvas mounting.
   - Parallel groups: dagre lays out the LEAF stages (it has no native cluster support worth using); afterwards each distinct `parallelGroup` value becomes a React Flow group node sized to its members' post-layout bounding box (+padding), members get `parentId` and positions relative to the group. Group label = the parallelGroup name.

4. **Read-only affordances (settled):** `fitView` on load, zoom/pan enabled, React Flow `Controls` (zoom/fit buttons) and a dot-grid `Background`; `nodesDraggable={false}`, `nodesConnectable={false}`, `edgesFocusable={false}`, `elementsSelectable={true}` (selection highlights a node; no side panel yet). No minimap (see Non-Goals). Layout owns positions — there is no position persistence to invent, which is exactly what keeps this child small.

5. **Mirror strategy: declare the definition shape IN FULL now.** `packages/ui/src/api/types.ts` gains hand-maintained `WirePipelineDefinition` / `WirePipelineDefinitionStage` covering every loader-accepted field (name, description, agents, handoff, reuse, origin; stage id, kind, skill, childPipeline, role, requires, gate, loop, parallelGroup, condition, leadReview, verifyPolicy, runtime, sessionReuse, sandbox, model, effort, handoff) plus `PipelineDetailResponse`. Core's type is `z.infer`-derived, so the mirror is shape-keyed as always; declaring it fully once means child 4 (which needs full fidelity for editing/save) adds no mirror entries for the definition. Validation/catalog shapes are NOT mirrored here — child 4 is their first consumer. `client.ts` gains `getPipelineDetail(name, selector)` following `listPipelines`' selector threading.

6. **Testing strategy under jsdom.** React Flow needs browser APIs jsdom lacks (`ResizeObserver`, `DOMMatrixReadOnly`); rather than shimming enough of the browser to render the real canvas, tests split: (a) `layout.ts` pure-function tests (edge derivation incl. multi-requires convergence, dagre LR ordering, group bounding boxes and relative child positions — the logic that can actually regress); (b) page-level tests with the canvas component mocked: fetch/loading/error/404/read-only-notice behavior; (c) a build test asserting the vite output has a separate canvas chunk not referenced by the entry chunk's static imports. The demo already proved real-browser rendering; repeating that belongs to manual/QA verification, not vitest.

## Risks / Trade-offs

- [preact/compat is a shim; a future @xyflow/react upgrade could break it] → version-pin the dep (caret within v12); the documented fallback (plain-React island for the canvas subtree only) costs bundle size, not code rewrite. Demo evidence covers the entire surface this child uses.
- [Global react alias affects any future dep that imports React] → today the resolution set is exactly @xyflow/react (+ its internals); this is the Preact-recommended pattern and an intentional, documented app-wide decision (comment in vite.config.ts).
- [dagre is in maintenance mode] → it is a pure layout function behind our own `layout.ts` seam; swapping to elkjs/d3-dag later touches one module. Demo validated dagre output quality for exactly this graph family.
- [Group bounding-box layout can overlap non-member nodes in dense graphs] → padding + a rank-separation bump when groups exist; layout tests pin the invariant that no group box intersects a non-member node for the built-in pipelines' shapes.
- [jsdom can't render the real canvas — a React Flow-level regression slips tests] → accepted for a read-only view; the pure layout seam carries the regression-prone logic, and child 4's editor work will bring browser-level QA (rasen-qa) anyway.
- [Windows paths in tests] → UI tests are path-light; the build-output test uses vite's manifest with path.join, no hardcoded separators.

## Migration Plan

Purely additive UI change; no persisted state, no server surface. Rollback = revert commit.

## Open Questions

(none)
