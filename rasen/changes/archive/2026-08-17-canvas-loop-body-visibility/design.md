# Design: canvas-loop-body-visibility

## Context

Round 3's user questions map one-to-one onto its children: Q2/Q3 ("no entry", "must wire
externals first") were children 1-2; Q1 ("为什么不能展开") is this one. The loop body
lives in a declaration's graph; the canvas renders `draftToGraph(def)` over ROOT nodes
only, so the `BoundedLoop` card (StageNode, kind badge + handles from
`lookupDeclarationPorts`) is all the author sees.

The mechanism is already in the repo: v1 `parallelGroup` subflow rendering
(`layout.ts:599-700`). Group nodes carry explicit `style` width/height sized to their
members' post-dagre bounding box (+`GROUP_PADDING` +`GROUP_LABEL_HEIGHT`), members get
`parentId: 'group:<name>'`, `extent: 'parent'`, positions RELATIVE to the group's
origin, and group nodes are returned BEFORE members (React Flow's `parentId`
resolution order). Verified against the installed dist (@xyflow/react 12.11.2 resolving
@xyflow/system 0.0.79): `evaluateAbsolutePosition` resolves child positions through the
parent lookup, child z-order derives from parents, extent clamping is live — and the v1
path exercises it in production today. Differences from v1 groups, all consequential:

- The parent is a REAL root node (the loop/ref with its card data and external
  handles), not a synthetic `group:*` container.
- Body node ids are DECLARATION-scoped and may collide with root ids — flow ids must be
  namespaced.
- Expansion is per-node and toggleable, and the body layout is a separate dagre pass
  whose bounding box also feeds the ROOT pass (the frame occupies a bigger box in the
  root layout).

Adjacent machinery this must not regress: `recomputeFlow`
(PipelineCanvasPage.tsx:560-604) rebuilds nodes from the draft on every mutation with
the selection-carry re-stamp and the placement-cache prune; the placement cache is
root-node-id keyed and pruned to root ids (round-2 child 2); `CanvasSelection` and the
panels key off root ids. `V2NodePanel` renders for a selected root node
(PipelineCanvasPage.tsx:3091+).

## Goals / Non-Goals

**Goals:**

- The author can SEE the loop body (stages + their connections) inside the loop node,
  on demand, with the node's identity and external wiring intact.
- Collapsed default is byte-identical to today; the just-synthesized loop opens
  expanded (moment-of-formation feedback).
- Selecting a body stage shows an honest read-only panel; every body interaction
  otherwise changes nothing.
- Placement cache, selection pairing, and every prior child's contract untouched.
- CompositeRef frames work the same way (symmetric declaration mechanism).

**Non-Goals:**

- In-frame EDITING (add/remove/rewire body stages, edit execution settings inside the
  frame): no declaration-body mutation helpers exist; building them plus the contract
  re-derivation a body edit forces (outcome rows must re-cover the body) is its own
  change. This change renders and selects only.
- Body-node drag durability: the placement cache stays root-keyed (round-2's rule);
  frame-local positions are layout-owned, recomputed every rebuild.
- Loop output-handle render divergence (child-2's recorded boundary): port derivation
  is child-1's territory per this round's split; drawing from the loop stays as today
  (engine-valid whenever the exit outcome name coincides with a producible row).
- Recursive frames (a declaration body containing a ref renders that ref as a plain
  card, never a nested frame); fitView-on-toggle; cross-session persistence; v1 group
  changes; any synthesis or IR change.

## Decisions

### D1 — Frame mechanism: reuse the v1 group pattern with the node itself as parent

`draftToGraph(def, catalog, expandedFrames?)` — optional set of root node ids to render
expanded. For each expanded `BoundedLoop`/`CompositeRef` whose declaration exists:

- The frame node: the node's own projection with explicit `style` width/height =
  body bounding box + header strip + padding (the group-sizing arithmetic, reusing the
  group constants), `parentId` unset (it IS a root node), identity + handles unchanged.
- Body children: one flow node per `declaration.graph.nodes`, flow id
  `<frameId>::<bodyNodeId>` (collision-proof against root ids and other frames' body
  ids — two expanded refs may share ONE declaration), `parentId: <frameId>`,
  `extent: 'parent'`, position relative to the frame origin, `selectable: false,
  draggable: false, connectable: false` (group-node parity), card data from
  `v2NodeCardData(node, declaration.graph, catalog, declarations)`.
- Body edges: the declaration's internal connections projected with prefixed ids
  (`body:<frameId>:<connectionId>`), endpoints on the namespaced child ids.
- Emission order: frame node strictly before its children (the v1 rule; React Flow
  resolves `parentId` on first render).
- Collapsed (id not in the set): ZERO new nodes — the existing projection unchanged,
  byte-parity pinned by re-running today's assertions.

`UnpositionedStage` gains optional `width`/`height`; `layoutGraph`'s dagre pass uses
them per node (default the current constants) so the root pass reserves the frame's
real box; every existing caller omits them and is unchanged. The body pass is a second
dagre run over the declaration's nodes/edges with the same constants (LR), wrapped and
made relative exactly like group members. All stateless — every rebuild re-derives
frame sizes from the current declaration graphs.

Alternative rejected: a nested `<ReactFlow>` instance inside the frame card (a known RF
anti-pattern for this use; breaks viewport/edge coordination and duplicates the
renderer). Another rejected: rendering the body as static HTML inside the card (no
per-stage cards/edges semantics, no selection — fails "see the stages + open their
panels").

### D2 — Expansion state: page ref keyed by root node id; auto-expand at formation

`expandedFramesRef = new Set<string>()` in the page (a ref, not state: the flow-node
rebuild IS the render truth, mirroring the placement cache's pattern); reset in
`enterEditWith`; never written to the payload or any storage. The chevron on the
collapsed card and the header of the expanded frame both toggle: ref write +
`recomputeFlow(draft)` (no draft mutation, no `markDraftChanged`, no selection change).

Auto-expand at the moment of formation, symmetric across all three synthesis handlers:
`confirmLoopReview` (the new loop), the palette loop gesture handler, and
`confirmExtractReview` (the new ref) add the minted node id to the ref before their
`recomputeFlow` — the author sees what got captured immediately, which is the whole
point of Q1. Collapsing is one click.

Frame-size changes may shift undragged neighbors (dagre re-runs); dragged nodes keep
their placements (the cache applies as always) — consistent with round-2's stated rule
("undragged elements always lay out afresh"), no new rule needed, pinned by test.

### D3 — Body interaction: see + select, everything else inert

Body cards: `selectable: false` keeps them OUT of React Flow's selection store — the
round-1/2 selection machinery (mirror, box-select, multi-delete, pairing) never sees a
body id and cannot regress. Clicking a body card sets a NEW page scalar
`bodySelection: { frameId: string; declarationId: string; nodeId: string } | null`
(mutually exclusive with root node/connection selection — selecting one clears the
other, the round-1 node/edge exclusivity pattern; pane click clears both). The
`V2BodyStagePanel` renders from the declaration lookup: card facts (id, kind,
capability, badges), the owning declaration, and a muted pointer to the declarations
panel for the loop's contract — plus the honest note that body-stage editing is a
future change. No edits, no drawn edges from body handles (`connectable: false` — the
handles still RENDER because React Flow edges need them as anchors, but they start
nothing), no drags.

Why not full in-frame editing (the stretch, honestly judged): editing needs
declaration-graph MUTATION helpers that do not exist (every body edit must also
re-derive the loop's contract rows against the engine's exact-cover rule — child 2's
`bodyTerminalOutcomes` becomes a re-derivation engine, plus refusals, plus revalidate),
and in-frame drags would fight the layout-owned frame-local positions. That is a
portfolio of its own; the user's question was SEEING the body. Recorded as the explicit
follow-up.

### D4 — CompositeRef symmetric (in scope — it is cheap)

`CompositeRef.declarationId` and `BoundedLoop.body` are the same lookup
(`lookupDeclarationPorts` already unifies them for handles). One helper parameterized
by the declaration id source covers both; the frame card keeps each kind's own
identity rendering. Shared declarations referenced by two expanded refs render twice
(namespaced per frame) — no collision, no ambiguity.

## Risks / Trade-offs

- [Frame growth shifts undragged neighbors on expand/collapse] → Same class as any
  structural change (round-2 rule); dragged placements pinned to survive; fit-view
  control remains the author's tool.
- [Namespaced ids leak into tests/assertions expecting raw body ids] → The namespace
  is part of the frame contract; page tests assert through it (and the panel strips it
  for the declaration lookup). Issue navigation paths (root `/declarations/i/graph/...`)
  are unaffected — they target the wire, not flow ids.
- [A large body makes a huge frame that dominates the canvas] → Real cost, accepted:
  collapse exists, the frame is one node in the root layout, and the alternative
  (scrollable mini-viewport inside the card) is the nested-ReactFlow anti-pattern.
- [Body clicks during a drag could set bodySelection spuriously] → The card's onClick
  guards on the drag state the same way the pane click handler does (the existing
  pattern).
- [Selection machinery regressions] → Body nodes are RF-unselectable by construction;
  the pairing and cache code paths are untouched; the page suite's existing
  selection/placement tests run unchanged as the regression net.

## Migration Plan

Pure rendering change; no wire format, no persisted state, no migration. Rollback =
revert the commit (collapsed rendering is the untouched default path).

## Open Questions

None blocking. Cosmetic choices (chevron glyph, header strip wording, frame padding
constants reuse vs new) are implementer discretion within the group-sizing arithmetic;
the spec pins behavior, not pixels.
