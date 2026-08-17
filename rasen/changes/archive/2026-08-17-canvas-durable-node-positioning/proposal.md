# Proposal: canvas-durable-node-positioning

## Why

Live testing of the round-one canvas (PR #167 build, 2026-08-17, user request 3) asked why
every added node lands at a fixed position instead of staying where the author drags it.
The cause is structural, not cosmetic: `recomputeFlow()`
(`PipelineCanvasPage.tsx:531-561`) rebuilds the flow from the draft and re-runs
`layoutGraph` (dagre) over EVERY node after EVERY mutation, so an author-dragged position
survives only until the next keystroke — add a node, edit a contract, declare an outcome,
and the whole graph snaps back. Drag positions do reach the page (React Flow emits
`position` changes through `onNodesChange`, `PipelineCanvasPage.tsx:1042-1061`); they are
simply discarded by the next full re-layout. Round one recorded this as a deliberate
non-goal; the user's request is the trigger to fix it.

## What Changes

- Author-dragged node positions become durable within a v2 edit session: a position
  cache, populated when a drag ends (React Flow's final `position` change,
  `dragging === false`), and honored by `recomputeFlow` — cached nodes render at the
  author's placement; uncached nodes (palette adds, synthesized refs/loops/pairs,
  insert-into-graph) still get computed layout positions.
- The rule lives in the geometry module: `layoutGraph` (`layout.ts`) gains an optional
  author-positions map, applied to matching stage nodes after the dagre pass, plus a pure
  prune helper that keeps the cache keyed to the nodes currently in the root graph. The
  page only wires data; no panel decides anything.
- Invalidation rule: cache entries are pruned to the current root node id set on every
  recompute, so nodes that leave the graph (deletion; extraction into a declaration,
  where body nodes leave the root graph) drop their placement, and a re-added node with a
  reused id lays out afresh. Renaming a v2 node changes its id
  (`renameV2Node`), so the rename handler carries the cached placement across the id
  change — a rename must not teleport the node.
- The Re-layout toolbar button (`relayout()`, `PipelineCanvasPage.tsx:2144-2147`) becomes
  the explicit reset: it clears the cache, returning every node to computed layout.
- Placement is edit-session state only: reset when a session starts
  (`enterEditWith`), never written to the definition payload, the IR, or any storage. The
  known Save-does-not-persist defect is untouched; this change neither fixes nor extends
  it (no sessionStorage/localStorage).
- Scope boundary: v2 edit sessions only. v1 editing keeps today's behavior (its
  `parallelGroup` subflow children use parent-relative positions, a different coordinate
  contract; v1 is maintenance-mode).
- Spec coverage via an ADDED-only delta under `pipelines-ui` ("The canvas keeps the
  author's node placement").

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipelines-ui`: ADDED-only delta adding one requirement covering durable author
  placement in v2 edit sessions: dragged placement survives subsequent mutations, new
  elements lay out afresh, placement follows a node through rename, departed nodes leave
  no placement behind, Re-layout resets placement, and placement never enters the
  definition payload.

## Impact

- `packages/ui/src/canvas/layout.ts`: optional third parameter on `layoutGraph`
  (author-positions map) plus a pure `pruneAuthorPositions` helper; existing signatures
  unchanged; `layout.test.ts` gains unit coverage.
- `packages/ui/src/canvas/PipelineCanvasPage.tsx`: a position-cache ref; drag-final
  capture in `onNodesChange` (position changes with `dragging === false`, v2 only);
  cache passed by `recomputeFlow` and pruned after each rebuild; reset in
  `enterEditWith`; placement carry in `renameSelectedV2Node`; cache clear in `relayout`.
  The selection-carry stamping inside `recomputeFlow` is preserved untouched.
- Tests: the shared ReactFlow mock (`pipeline-canvas-page.test.tsx:54-413`) learns the
  `position` change type in `applyNodeChanges` and a drag trigger, mirroring real
  controlled-mode React Flow; page tests cover every scenario; a real-browser CDP check
  drags and verifies placement survives a follow-up mutation. Baseline 67 files / 866
  tests via `pnpm --dir packages/ui exec vitest run`.
- Frozen and untouched: `src/core/pipeline-registry/` (asserted empty diff), the
  definition wire shape (no position fields anywhere), `V2_BODY_PALETTE_KINDS`, no node
  synthesis, no `legacyRuntimeOwner` risk.
- Explicit non-goals: palette drag-and-drop placement of NEW v2 nodes (click-to-add keeps
  computed placement; a future change could extend palette DnD), cross-reload or saved
  placement persistence, v1 durability, auto-fit-view changes.
