## Context

Round-one live testing asked why added nodes land at fixed positions instead of staying
where dragged (user request 3). The mechanism, verified at the current tree (child 1
shipped, ship 4de74cdd):

- The page's flow state is fully derived: every mutation handler calls
  `recomputeFlow(def)` (`PipelineCanvasPage.tsx:531-561`), which runs `draftToGraph` then
  `layoutGraph(nodes, edges)` (`layout.ts:601-674`, dagre left-to-right, deterministic)
  and REPLACES all flow nodes, re-stamping `selected` by id (the selection-carry, which
  must survive this change untouched).
- Drags DO reach the page: edit mode passes `onNodesChange` (`:1042-1061`), React Flow
  emits `position` changes during a drag and a final one with `dragging === false` at
  drag end, and `applyNodeChanges` writes them into the flow state. The position is
  discarded only when the next mutation rebuilds from layout. So the fix is capture plus
  honor, not new drag plumbing.
- v2 nodes are draggable per node (`draftToGraph` sets `draggable: safelyEditable`,
  `layout.ts:558`); v1 stage nodes get `draggable: true` in `recomputeFlow`'s map
  (`:537-540`).
- v2 rename changes the node id (`renameV2Node` via `renameSelectedV2Node`,
  `:2020-2056`; the selection follows to the new id).
- No position persistence exists anywhere today (`pending-draft.ts` documents its own
  no-storage posture; no sessionStorage/localStorage in `src/canvas`).
- The shared ReactFlow test mock (`pipeline-canvas-page.test.tsx:54-413`) models
  `select` and `remove` changes only; `applyNodeChanges` (`:385-398`) drops `position`
  changes.

Constraints: IR frozen (positions never enter `src/core/pipeline-registry/` or the
definition wire shape); one home for rules (the position rule lives in the geometry
module, the page only wires); selection-carry preserved; baseline 67 files / 866 tests;
ADDED-only delta (round-one/round-two discipline while the dev/0.2.0-side merge order is
open).

## Goals / Non-Goals

**Goals:**

- A dragged node stays where the author put it across every subsequent mutation in the
  same v2 edit session (the user's ask).
- New and synthesized elements still get computed layout (no behavior change for them).
- A precise, testable invalidation rule for placements whose owners leave the root
  graph, plus a rename carry so renaming does not teleport a node.
- An explicit author escape hatch: Re-layout resets placement.
- The definition payload stays byte-for-byte free of layout data.

**Non-Goals:**

- Palette drag-and-drop placement of NEW nodes (click-to-add keeps computed placement;
  the palette's DnD path is v1-only today via `onDropStage`; extending it is a separate
  candidate change and would overlap child 3's palette work).
- Cross-reload or saved placement persistence. The Save-does-not-persist defect stays
  untouched; no storage of any kind. A fresh edit session starts from layout.
- v1 durability (v1 `parallelGroup` subflow children use parent-relative positions and
  `extent: 'parent'`, a different coordinate contract; v1 is maintenance-mode and keeps
  today's behavior).
- Any fitView/panning behavior change.

## Decisions

**D1 — Capture at drag end, keyed by node id, held in a page ref.** In
`onNodesChange`, position changes with `dragging === false` (the drag-final change)
write `{ x, y }` into a `useRef<Map<string, { x: number; y: number }>>`. Capturing at
drag end rather than during the drag means mid-drag intermediate positions never enter
the cache, and no extra render is needed (React Flow's own state already shows the
dragged position; the ref is consumed by the next `recomputeFlow`). Capture is guarded
to v2 (`draft.version === 2`). Alternative rejected: caching every position change —
same end state with more writes and a wider surface for non-drag position changes.

**D2 — The rule lives in `layout.ts`; `layoutGraph` grows an optional author-positions
parameter.** `layoutGraph(nodes, edges, authorPositions?)` applies a cached `{ x, y }`
to a stage node whose id matches, after the dagre pass and before the group-relative
conversion concern (v2 has no groups; group nodes are skipped as a type guard anyway).
A pure `pruneAuthorPositions(positions, presentStageIds)` helper returns a cache keyed
to exactly the current root graph's node ids. `layout.ts` already owns the geometry
vocabulary (NODE_WIDTH, dagre, group boxes) and is plain-Node unit-testable; putting the
rule in `draft.ts` would leak view geometry into the definition model, and a new module
would split the geometry vocabulary in two. Callers without a cache (view mode,
`viewFlowNodes`) are unchanged — the parameter is optional and defaults to none.
Alternative rejected: a post-hoc map over laid-out nodes in the page — that puts the
rule in the page, violating the one-home constraint.

**D3 — `recomputeFlow` applies then prunes; the cache is exactly "placements of nodes
present in the root graph".** Order inside `recomputeFlow`: build from draft, lay out
with the cache, re-stamp selection (unchanged), then prune the cache to the ids in the
rebuilt node set. Consequences, each deliberate: (a) deletion drops the placement;
(b) extraction (body nodes move into the declaration; a CompositeRef replaces them
under a new id) drops the moved nodes' placements and the ref lays out afresh — correct,
since the ref is a new element; (c) delete-then-re-add under a reused id yields a
computed position, not a resurrection — predictable and easy to state in the spec;
(d) `enterEditWith` resets the cache, so every session starts from layout and no
cross-definition id collisions can leak placements. Alternative rejected: keeping
entries forever and applying only to present ids — silently resurrects placements for
reused ids and makes the cache's meaning depend on history rather than the current
graph.

**D4 — Rename carries the placement across the id change.** `renameSelectedV2Node`
rewrites the node id; without a carry, rule D3's prune would drop the placement and the
renamed node would teleport to its dagre position. The handler moves the cache entry to
the new id before calling `recomputeFlow` — the same identity-follows-rename posture
the selection already has (`:2036-2044`).

**D5 — Re-layout is the explicit reset.** `relayout()` (`:2144-2147`) clears the cache
before `recomputeFlow(draft)`. Without this, Re-layout would be a visible no-op for
every dragged node, which is bug-shaped; with it, the author has a one-click "put
everything back" and the button's name finally means what it says.

**D6 — Session-only lifetime, stated in the spec.** The cache lives in the ref, reset
per `enterEditWith`; nothing writes storage; the definition payload assertion (no
position fields in the submitted draft) is part of the test matrix, pinning the IR-free
boundary from the UI side.

## Risks / Trade-offs

- [Layout drift for undragged neighbors: dagre re-layouts the WHOLE graph each rebuild,
  so an undragged node's computed position can shift when the graph grows] → accepted
  and spec-stated (undragged elements always lay out afresh); only dragged nodes are
  pinned. Full incremental layout (re-layout only the affected region) is a much larger
  change with no user ask behind it yet.
- [A dragged node may end up overlapping a newly laid-out node] → inherent to pinning;
  Re-layout is the escape hatch; no collision solver is attempted.
- [The ReactFlow mock does not model position changes, so page tests cannot drive drags
  today] → the mock's `applyNodeChanges` learns the `position` change type (mirroring
  controlled-mode React Flow) and gains a drag trigger button, the same
  one-trigger-per-concern pattern the box-select and selection triggers already use;
  the mock renders node positions in a dump testid so tests can assert placements
  without layout.
- [Ref-state bugs are invisible until the next rebuild] → page tests drive
  drag-then-mutate sequences for every scenario; the CDP check repeats the sequence
  against real React Flow, where drag physics (not the mock) produce the final change.
- [Spec base drift between this branch and dev/0.2.0's unmerged sync] → ADDED-only
  delta, no MODIFIED block, no em-dashes in requirement prose (child-4 parser trap).

## Migration Plan

Single forward-only UI change; no wire, engine, or storage migration. Rollback is
reverting the commit: `recomputeFlow` returns to full re-layout semantics.

## Open Questions

- None blocking. If the author later wants placement to survive reload, the cache's
  keying discipline (per-session reset, id-keyed) is the seam to extend — pending the
  Save-defect resolution, which is out of scope here.
