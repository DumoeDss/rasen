# Proposal: canvas-backedge-loop-inference

## Why

The portfolio's target experience says the author draws edges, connects them into a loop with an
exit (能够连成环（有出口）), and the editor infers the IR. Today the canvas does the opposite: the
moment an author draws a connection that would close a cycle, `wouldCreateCycle` refuses it with
a toast and nothing is added — the one gesture that most directly expresses "this repeats" is
the one the editor cannot accept. The only loop affordance is the explicit palette gesture,
which drops a `BoundedLoop` over the first declaration that happens to carry a body. This slice
teaches the drawn back-edge to mean what the author meant: a bounded loop over the region the
edge closes.

## What Changes

- Drawing a cycle-closing connection in the v2 editor stops being a dead end: the editor
  recognizes the drawn edge as loop intent and opens a loop review instead of only refusing.
  The drawn edge itself still never enters the draft as a plain connection.
- The review shows what the loop will be: the enclosed region (every node on a path from the
  drawn edge's target back around to its source, endpoints included), the derived declaration
  contract (input ports and outcomes from the edges the region's extraction severs — child 2's
  derivation), the author-supplied bound (max iterations), and the exit outcome picked from the
  definition's outcomes.
- Confirming extracts the region into a Custom Composite declaration (child 2's extraction
  machinery), synthesizes a `BoundedLoop` pointing at it with the author's bound and exit
  mapping, rewires every root connection that crossed the region onto the loop's ports, and
  leaves the loop selected. The back-edge is consumed by the synthesis — it exists only as loop
  semantics, never as a root connection.
- Cancel keeps today's behavior exactly: the draft is unchanged and the refusal message stands.
- Regions the model cannot extract are refused with the same named blockers as the
  package-into-block action (non-stage nodes, outside gate/parallel/consultation references).
- The explicit palette Loop gesture and the declarations-panel insert action are untouched —
  inference is additive, no capability hole.

## Capabilities

### New Capabilities

<!-- none — loop inference is canvas-editor behavior inside the existing pipelines-ui capability -->

### Modified Capabilities

- `pipelines-ui`: the canvas editor recognizes a drawn back-edge as bounded-loop intent.
  Delivered as one ADDED requirement ("The canvas turns a drawn back-edge into a bounded
  loop") — the cycle refusal requirement text stays true for every path the author does not
  confirm (cancel leaves the draft unchanged), so no existing requirement is modified.

## Impact

- Code: `packages/ui/src/canvas/draft.ts` (region computation over the same adjacency the
  cycle check uses; internal decomposition of `extractSubgraph` so the loop path reuses
  declare/remove/rewire without inserting a `CompositeRef`; the synthesis transaction — the
  one-home rule), a loop review dialog (`packages/ui/src/canvas/V2LoopReviewPanel.tsx`, the
  child-2 review pattern), `PipelineCanvasPage.tsx` (the connect-refusal branch opens the
  review; confirm handler), and `packages/ui/test/canvas/` (model + component tests reusing
  child 1's `onSelectionChange` trigger and child 2's review-test patterns).
- Frozen: `src/core/pipeline-registry/` untouched (asserted by a task).
- No API, dependency, or engine changes; `BoundedLoop`'s shape is exactly what the explicit
  gesture already builds (`addBoundedLoopOverDeclaration`).
- Out of scope, unchanged: parallel-frontier and sink-finish inference (children 4/5), v1
  editor, canvas Save persistence defect, box-select reliability (the open m2 probe is
  repeated first in this change's browser gate and routed to child 1 if it reproduces).
