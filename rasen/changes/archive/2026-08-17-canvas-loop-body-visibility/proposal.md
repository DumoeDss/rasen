# Proposal: canvas-loop-body-visibility

## Why

The user's original question 1 (2026-08-17 live testing, round 3): "为什么不能展开" — why
can't the loop be expanded. After confirming a loop review, the body stages (review ⇄ fix)
move into the declaration's graph (`declarations[]`), and the canvas renders only the root
graph: the `BoundedLoop` node is an opaque black box. The author's mental model —
"review⇄fix 在环里" — is invisible, and the round-3 brief pins the fix direction: render
the body INSIDE the loop node as an expandable React Flow group. The codebase already
carries the mechanism for this exact shape: v1 `parallelGroup` rendering
(`layout.ts:599-700`) wraps members in a subflow container (`parentId` +
`extent: 'parent'`, frame-relative positions, frame sized to its members' bounding box),
verified live in the installed `@xyflow/react` 12.11.2 / `@xyflow/system` 0.0.79 dist
(parent-relative positioning, child z-order, extent clamping). Children 1 and 2 landed
the contract this frame renders against: control-typed entry rows and producible
outcome rows are what the loop's handles already expose.

## What Changes

- **Expandable frames.** A `BoundedLoop` node (and, symmetrically, a `CompositeRef` —
  same declaration mechanism, cheap) gains a chevron toggle. Collapsed (the default) is
  today's compact card byte-for-byte. Expanded, the node becomes a frame: explicit
  width/height sized to its body's laid-out bounding box (+header strip +padding), the
  declaration body's stages rendered INSIDE as child flow nodes (`parentId` = the frame
  node, `extent: 'parent'`, positions relative to the frame origin from a second dagre
  pass over the declaration's graph), with the body's internal connections as edges
  between them. The frame keeps the node's identity and its external handles — external
  connections are untouched.
- **Moment-of-formation feedback.** The just-synthesized loop opens expanded (loop
  synthesis and the palette gesture alike; the extraction's new ref too — symmetric),
  so the author immediately sees what got captured. Expansion state is edit-session
  state (a page-level set keyed by root node id, reset per session like the placement
  cache); it never enters the definition payload.
- **See and select, not edit (this change's honest scope).** Body cards render their
  real card data (id, kind, capability, badges) and are clickable: selecting one opens
  a read-only body-stage panel (card data + which declaration it lives in + a pointer
  to the declaration contract editor). Body cards are otherwise inert in React Flow
  terms — not connectable, not draggable, not selectable-by-box — because frame-local
  positions are layout-owned and no declaration-body mutation helpers exist yet.
  Editing stays where it lives today: the loop's contract via the declarations panel,
  the definition via the contract panel, Validate as the authority.
- **Placement rules.** The round-2 placement cache is untouched by expansion: it stays
  keyed and pruned to root node ids; body children never enter it; a dragged root node
  keeps its placement across expand/collapse (undragged neighbors may shift as with any
  structural change, per the round-2 rule). Frame sizing is a stateless derivation at
  every rebuild — any draft change that alters a body re-sizes its frame.
- Spec coverage via an ADDED-only delta under `pipelines-ui` ("The loop shows its
  body").

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipelines-ui`: ADDED-only delta adding one requirement: loops (and composite refs)
  render their declaration bodies inside expandable frames — collapsed default with
  today's card intact, expand chevron, sized-to-content frames with body stages and
  their connections, read-only body-stage selection panel, synthesis auto-expand, and
  the placement/selection non-regression guarantees.

## Impact

- `packages/ui/src/canvas/layout.ts`: `UnpositionedStage` gains optional per-node
  `width`/`height` (default `NODE_WIDTH`/`NODE_HEIGHT` — every existing caller
  unchanged); new pure helper projecting a declaration body into frame children
  (namespaced flow ids `<frameId>::<bodyNodeId>` — declaration-scoped body ids may
  collide with root ids; frame-local dagre pass; prefixed internal edge ids; parent
  emitted before children per React Flow's resolution order).
- `packages/ui/src/canvas/draftToGraph` path (`layout.ts`): optional
  `expandedFrames: ReadonlySet<string>` parameter — collapsed calls byte-identical;
  expanded frames emit the frame node with explicit style size plus body children.
- `packages/ui/src/canvas/StageNode.tsx`: a frame variant of the loop/ref card
  (header strip with identity + chevron + inner body region; explicit size), and the
  collapsed card's chevron affordance; body cards carry inert flags.
- `packages/ui/src/canvas/PipelineCanvasPage.tsx`: `expandedFramesRef` (session state,
  reset in `enterEditWith`), the toggle handler (ref write + `recomputeFlow`), the
  auto-expand writes in the loop-synthesis, palette-loop, and extraction-confirm
  handlers, and a `bodySelection` state (mutually exclusive with root selection, pane
  click clears) feeding a new read-only panel.
- New `packages/ui/src/canvas/V2BodyStagePanel.tsx`: presentational, read-only body
  stage view.
- Tests: layout unit tests (frame sizing, namespaced ids, frame-relative positions,
  parent-first order, per-node dimensions default); page tests (collapsed default
  parity, expand renders body cards + internal edges, body selection opens the panel,
  collapse restores, auto-expand on synthesis, dragged placement survives a toggle,
  composite-ref symmetry, body inertness). No new ReactFlow mock seam needed — the
  chevron is real DOM and body cards are plain nodes. Baseline 68 files / 912 via
  `pnpm --dir packages/ui exec vitest run`.
- Real-browser gate: fresh port 9354+ (9352/9353 used), `--window-size=1600,1000`,
  build-then-serve, route derived from the `?space=` query param (child-2's handoff:
  the entry pathname is `/` — deriving from it 404s the SPA route): synthesize a loop,
  assert it opens expanded with both body stages and their connection visible, select
  a body stage, collapse, re-expand.
- Frozen and untouched: `src/core/pipeline-registry/`, synthesis defaults (child 2's),
  port derivation (child 1's), the definition wire shape (no frame/expansion fields
  anywhere), `V2_BODY_PALETTE_KINDS`, v1 groups, the extract path.
- Explicit non-goals: in-frame EDITING (adding/removing/rewiring body stages or
  editing their execution requires new declaration-graph mutation helpers plus
  contract re-derivation — a change of its own; recorded as the follow-up); body-node
  drag durability (the cache stays root-keyed by the round-2 rule); the loop
  output-handle render divergence child-2 recorded (port changes are child-1's
  territory per this round's split); persistence across sessions; recursive nesting
  of frames inside frames (a body node renders as a card, never as a nested frame);
  fitView-on-toggle.
