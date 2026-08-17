## 1. Geometry rule in layout.ts (design D2)

- [x] 1.1 Add the optional third parameter to `layoutGraph(nodes, edges, authorPositions?)` in `packages/ui/src/canvas/layout.ts`: after the dagre pass, a stage node whose id has a cached `{ x, y }` renders at the cached position; group nodes are skipped; absent ids change nothing. Add the pure `pruneAuthorPositions(positions, presentStageIds)` helper returning a cache keyed to exactly the given ids.
- [x] 1.2 Unit tests in `packages/ui/test/canvas/layout.test.ts`: cached override applied by id; no cache = identical output to today (pin against the existing golden behaviors); cache entries for absent ids ignored; prune drops departed ids and keeps present ones; group nodes never take a cached position.

## 2. Page wiring (design D1, D3, D4, D5)

- [x] 2.1 Add the position-cache ref (`Map<string, { x: number; y: number }>`) to `PipelineCanvasPage.tsx`; in `onNodesChange`, capture position changes with `dragging === false` (v2 edit sessions only) into the cache; reset the cache in `enterEditWith`.
- [x] 2.2 In `recomputeFlow`, pass the cache to `layoutGraph` and prune it to the rebuilt stage-node ids after stamping the selection-carry (the selection stamping code stays byte-identical).
- [x] 2.3 In `renameSelectedV2Node`, carry the cached placement from the old id to the new id before `recomputeFlow` (placement follows the rename, like the selection does).
- [x] 2.4 In `relayout()`, clear the cache before `recomputeFlow(draft)` so Re-layout returns every node to computed layout.

## 3. ReactFlow mock: position changes and a drag trigger

- [x] 3.1 Extend the shared mock in `pipeline-canvas-page.test.tsx`: `applyNodeChanges` applies `position` changes (mirroring controlled-mode React Flow), a drag trigger emits the drag-final change (`{ type: 'position', id, position, dragging: false }`) through `onNodesChange`, and a positions dump testid renders each stage node's id and position so tests can assert placements without layout.

## 4. Page tests: every spec scenario (jsdom)

- [x] 4.1 Placement survives follow-up edits: drag a node, add a second node from the palette, assert the dragged node keeps its placement and the new node gets a layout position; repeat the assertion after a definition-contract edit (outcome declare via child 1's field) — spec scenarios 1 and 2.
- [x] 4.2 Undragged elements lay out afresh: rebuild after a mutation with an empty cache; every node renders at its computed layout position (spec scenario 3).
- [x] 4.3 Placement follows rename: drag, rename the node through the node panel, assert the renamed node keeps the placement under the new id (spec scenario 4).
- [x] 4.4 Departed placement is dropped: drag a node, delete it, re-add a node with the same id (rename another node to the freed id or re-create via the palette), assert the re-added node renders at a layout position, not the departed placement; also cover extraction (box-select to declaration) dropping the moved nodes' placements (spec scenario 5).
- [x] 4.5 Re-layout resets and the payload stays clean: drag nodes, press Re-layout, assert every node returns to layout positions and a later edit still treats them as undragged; assert the draft submitted to `mutatePipeline` contains no position fields anywhere (spec scenario 6).

## 5. Real-browser CDP check (repo-trap protocol)

- [x] 5.1 Build `packages/ui`, serve with `node bin/rasen.js ui --no-open --no-daemon --port <fresh 9345+>`, drive a throwaway Chrome (`--window-size=1600,1000`, fresh `--user-data-dir`, direct CDP): in a v2 edit session drag a node (close any open panel first, re-fit-view before dragging), record its rendered transform, add another node from the palette, assert the dragged node's transform is unchanged while the new node appears at a layout position; rename the dragged node and assert the transform survives; press Re-layout and assert all nodes return to layout. Save the transcript under `evidence/` (with the port used).

## 6. Gates

- [x] 6.1 Full UI suite, CI-canonical: `pnpm --dir packages/ui exec vitest run`, never piped through `tail`; cite file and test counts against the 67 files / 866 baseline (count must only grow); failures enumerated in full; Windows flake re-run in isolation before blaming the delta.
- [x] 6.2 IR-frozen and payload-clean assert: `git status --porcelain -- src/core/pipeline-registry/` empty and `git diff fb243e83 -- src/core/pipeline-registry/` empty; `V2_BODY_PALETTE_KINDS` still `['AtomicStage']`; no `legacyRuntimeOwner`; grep the diff for position fields reaching any definition payload.
- [x] 6.3 Traceability pass: every scenario in `specs/pipelines-ui/spec.md`'s ADDED requirement maps to at least one task 4.x test or a 5.1 CDP step by name (list the mapping in the verify notes).
