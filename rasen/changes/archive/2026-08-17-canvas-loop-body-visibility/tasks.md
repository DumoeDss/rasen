# Tasks: canvas-loop-body-visibility

## 1. Frame machinery (packages/ui/src/canvas/layout.ts)

- [x] 1.1 `UnpositionedStage` gains optional `width`/`height`; `layoutGraph`'s dagre pass uses them per node, defaulting to `NODE_WIDTH`/`NODE_HEIGHT` so every existing caller is unchanged. Unit-pin the default first (a node without dimensions lays out exactly as today).
- [x] 1.2 New pure frame projection helper (working name `declarationBodyFrame(def, declarationId, frameId, catalog)`): a dagre pass over the declaration body's nodes/edges with the existing constants; returns the frame's bounding box (body box + header strip + padding, the group-sizing arithmetic) and frame children — flow ids `<frameId>::<bodyNodeId>`, positions RELATIVE to the frame origin, `parentId: frameId`, `extent: 'parent'`, `selectable/draggable/connectable: false`, card data via `v2NodeCardData(node, declaration.graph, catalog, declarations)` — plus the body's internal connections as edges with prefixed ids (`body:<frameId>:<connectionId>`). Parameterized by declaration id source so `BoundedLoop.body` and `CompositeRef.declarationId` share it.
- [x] 1.3 `draftToGraph` gains optional `expandedFrames: ReadonlySet<string>`: expanded loop/ref nodes emit with explicit `style` width/height from 1.2's box (and per-node dimensions for the root dagre pass) followed by their body children (frame strictly before children — React Flow's `parentId` resolution order); ids not in the set emit exactly as today (byte-parity, no body nodes).
- [x] 1.4 Layout unit tests: frame sizing arithmetic; namespaced ids (including one root id EQUAL to a body id in another node — no collision); frame-relative child positions; parent-before-children order; TWO expanded refs sharing ONE declaration (per-frame namespacing, no duplicate flow ids).

## 2. Card and panel components

- [x] 2.1 `StageNode.tsx`: frame variant of the loop/ref card (header strip carrying the node's identity + the collapse control + an inner body region; explicit size honored) and the expand control on the collapsed card; the toggle reaches the page via a node-data callback (`onToggleExpand(frameId)`); body cards render their normal card content with the inert flags from 1.2 and an `onSelectBody` click callback (drag-state guarded, the pane-click pattern).
- [x] 2.2 New `V2BodyStagePanel.tsx`: presentational, read-only — identity, kind, capability/badges, the owning declaration id, a muted pointer to the declarations panel for the loop's contract, and the honest note that body-stage editing is a future change. No callbacks that mutate anything.
- [x] 2.3 CSS for the frame variant and body cards (string-level pin in `packages/ui/test/style/` if a new class carries a size/layout-critical property — follow the existing `declares(prop, value)` near-miss-guard pattern).

## 3. Page wiring (PipelineCanvasPage.tsx)

- [x] 3.1 `expandedFramesRef: Set<string>` (ref, not state — the flow rebuild is the render truth); reset in `enterEditWith`; `recomputeFlow` threads it into `draftToGraph`; the toggle handler does ref write + `recomputeFlow(draft)` with NO draft mutation and NO `markDraftChanged`.
- [x] 3.2 Auto-expand at formation: `confirmLoopReview` (the new loop id), the palette loop gesture handler, and `confirmExtractReview` (the new ref id) add the minted id to the ref before their `recomputeFlow`.
- [x] 3.3 `bodySelection: { frameId, declarationId, nodeId } | null` state: body-card click sets it and clears root selection; root node/connection selection clears it (the round-1 mutual-exclusivity pattern); pane click clears both; renders `V2BodyStagePanel`. `CanvasSelection` and every existing handler stay untouched.

## 4. Tests

- [x] 4.1 Page — collapsed default parity: with no expansion interaction, today's loop-node assertions pass UNCHANGED and no body nodes exist in the flow.
- [x] 4.2 Page — expand and collapse: clicking the expand control renders the body stage cards and the internal edge inside the frame (namespaced ids, parent set, extent parent); the collapse control removes them; the frame node's external handles/edges are unchanged by both.
- [x] 4.3 Page — body selection: clicking a body card opens `V2BodyStagePanel` with the stage's facts; pane click clears it; selecting a root node clears it and vice versa; body interactions produce NO draft change (inertness).
- [x] 4.4 Page — auto-expand: loop-review confirm, palette loop gesture, and extract confirm each render the new node expanded.
- [x] 4.5 Page — placement survival: drag a root node (the round-2 drag trigger), expand and collapse a loop, assert the dragged node's placement is unchanged and the flow never writes body ids into the placement cache.

## 5. Gates

- [x] 5.1 Full UI suite via `pnpm --dir packages/ui exec vitest run` (CI-canonical; never pipe through tail): cite file/test counts against the baseline 68 files / 912; isolate-and-rerun any Windows timeout flake before blaming the delta.
- [x] 5.2 Real-browser gate, fresh port 9354+ (9352/9353 consumed), throwaway Chrome `--window-size=1600,1000`, fresh user-data-dir, direct CDP; derive the project route from the `?space=` query param (child-2's handoff: the entry pathname is `/` and deriving from it 404s the SPA route); build `packages/ui` first, serve root dist. Flow: synthesize a loop from an empty canvas → the node opens expanded with both body stages and their connection visible → select a body stage (read-only panel) → collapse (compact card, handles intact) → re-expand → expand a composite ref (symmetry). Close the panel before any drag; fit-view before drags; screenshots + transcript to evidence.
- [x] 5.3 Constraint sweep before commit: empty diff under `src/core/pipeline-registry/`; the definition wire shape untouched (no frame/expansion fields anywhere in the payload); `V2_BODY_PALETTE_KINDS` unchanged; no `legacyRuntimeOwner`; v1 group path untouched; narrow pathspec commit (change dir + touched files only; no ephemera, no `bin/rasen.js` CRLF phantom).
