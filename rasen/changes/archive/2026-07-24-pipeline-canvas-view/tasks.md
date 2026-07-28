## 1. Toolchain: compat alias + dependencies

- [x] 1.1 Add `@xyflow/react` and `dagre` to `packages/ui/package.json` dependencies (`@types/dagre` dev); pnpm install
- [x] 1.2 Add `resolve.alias` (react → preact/compat, react-dom → preact/compat, react-dom/test-utils → preact/test-utils, react/jsx-runtime → preact/jsx-runtime) to `packages/ui/vite.config.ts` with a comment explaining the app-wide decision and the demo evidence; add matching `compilerOptions.paths` to `packages/ui/tsconfig.json` so `tsc --noEmit` passes
- [x] 1.3 Verify `pnpm run build` and `pnpm run typecheck` pass with the new deps before any canvas code exists

## 2. API client + mirror

- [x] 2.1 Mirror in `packages/ui/src/api/types.ts`: `WirePipelineDefinitionStage` and `WirePipelineDefinition` declared IN FULL (every loader-accepted field, per design D5) plus `PipelineDetailResponse`; do NOT mirror validation/catalog shapes (child 4 is their first consumer)
- [x] 2.2 Add `getPipelineDetail(name, selector)` to `packages/ui/src/api/client.ts` (percent-encode the name segment, thread the space selector like `listPipelines`)

## 3. Canvas module (`packages/ui/src/canvas/`)

- [x] 3.1 `layout.ts` (pure, no JSX): `definitionToGraph(detail)` — nodes joined with resolved stages by id, one edge per `requires` entry; `layoutGraph` — dagre LR positions; parallel-group pass computing group containers from member bounding boxes (+padding, rank-separation bump when groups exist) with member positions relative to `parentId`
- [x] 3.2 `StageNode.tsx` — stage card: id, role badge (existing role color language), skill, effective-gate indicator; tooltip/detail affordance with effective model, handoff, runtime and their sources
- [x] 3.3 `PipelineCanvasPage.tsx` — fetch detail, loading/error/not-found states (page-level error pattern with fix hint, not-found links back to the Pipelines list), header with name + provenance + read-only notice when `editable` is false; ReactFlow with `fitView`, `Controls`, `Background`, `nodesDraggable=false`, `nodesConnectable=false`, `elementsSelectable=true`

## 4. Routing + entry affordance

- [x] 4.1 Register lazy routes `/p/:projectId/pipelines/:name` and `/s/:storeId/pipelines/:name` in `packages/ui/src/app.tsx` via preact-iso `lazy()` so the canvas chunk splits at the route boundary
- [x] 4.2 Add a "View graph" affordance to each pipeline section header in `PipelinesPage.tsx` linking to the graph route (percent-encoded name, current space prefix)

## 5. Tests

- [x] 5.1 `layout.ts` unit tests: edge derivation (multi-requires convergence), LR ordering follows dependencies, parallel-group boxes contain exactly their members and intersect no non-member node for the built-in pipelines' shapes
- [x] 5.2 Page tests with the flow component mocked: loading state, detail render path, 404 → not-found with back link, error with fix hint, read-only notice for `editable: false`
- [x] 5.3 Build-split test: after `vite build`, the entry chunk's static import graph does not reach the canvas chunk (via the build manifest, paths handled with path.join)

## 6. Verification

- [x] 6.1 `pnpm run typecheck`, `pnpm run test`, `pnpm run build` in `packages/ui`; full repo suite on Windows with the known EBUSY-flake isolation discipline
- [x] 6.2 Manual browser check against a live `rasen ui` (or vite dev proxy): built-in pipeline graph renders with groups, zoom/pan/fit work, list pages load without fetching the canvas chunk (network tab)
- [x] 6.3 Run `rasen validate pipeline-canvas-view --strict` from the worktree and fix findings
