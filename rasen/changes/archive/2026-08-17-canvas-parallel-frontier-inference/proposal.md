# Proposal: canvas-parallel-frontier-inference

## Why

The portfolio's target experience says the author draws edges that fan out and reconverge, and
the editor infers the parallelism (the round-one user wording). Today the IR already encodes a
parallel frontier — `FanOut.branches`/`members` plus its paired `Join.inputs`
(`packages/ui/src/api/types.ts:1440-1461`) — but the only way to get one is the explicit
palette gesture, which drops an unwired pair over every root stage. The author who has already
drawn S→b1, S→b2, b1→T, b2→T has expressed the frontier plainly and the editor offers nothing:
no detection, no offer, no way to turn the drawn shape into the pair with the contract the
engine needs (membership, cap, budget). This slice closes that gap with detection plus the
established review-and-confirm pattern.

## What Changes

- Frontier detection over the root graph: one source with two or more clean branches that
  reconverge at a common downstream target. A branch member is clean when its only incoming
  edge is from the source and its only outgoing edge is to the target — exactly the sandwich
  the `FanOut`/`Join` pair encodes. The detector reuses the same adjacency machinery the cycle
  check and back-edge region use (one builder, no second reachability).
- A non-blocking offer at the moment the shape completes: when a successfully drawn connection
  completes a frontier (the last fan-out branch or the last reconverging edge), the editor's
  toast surface gains a "Run in parallel" action opening the review. Dismissing changes
  nothing — the drawn edges are legal and stay.
- The review (the established panel pattern): the detected membership list with
  required-vs-optional toggles, concurrency cap and budget integer fields, and the
  proceed/failed outcome picks from the definition's outcomes; source and target shown
  read-only.
- Confirming synthesizes the pair through `createParallelPair`-shaped machinery: the drawn
  branch edges (source→member and member→target) are consumed — removed from the root graph,
  never surviving alongside the pair — and replaced by source→FanOut, per-member dispatch and
  barrier edges on the rendered handle ids, and Join→target. The fan-out is left selected and
  the pair stays editable afterwards through the existing properties panel.
- The explicit Parallel palette gesture is untouched — inference is additive, no capability
  hole. No sink/finish inference (child 5's scope).

## Capabilities

### New Capabilities

<!-- none — frontier inference is canvas-editor behavior inside the existing pipelines-ui capability -->

### Modified Capabilities

- `pipelines-ui`: the canvas editor recognizes a drawn fan-out/reconverge shape as parallel
  intent. Delivered as one ADDED requirement ("The canvas offers a parallel frontier when
  branches reconverge") — the gesture, the pair property editors, and every existing scenario
  stay true (the drawn edges the inference consumes are the author's own plain connections,
  which remain freely authorable), so no requirement is modified.

## Impact

- Code: `packages/ui/src/canvas/draft.ts` (the detector, the synthesis transaction composed
  from `createParallelPair` + the `addV2Connection` convention — the one-home rule), a review
  panel (`packages/ui/src/canvas/V2ParallelReviewPanel.tsx`, the child-2/3 review pattern), the
  toast slot in `PipelineCanvasPage.tsx` (optional action button + the completing-connect hook
  + confirm handler), and `packages/ui/test/canvas/` (model + component tests).
- Frozen: `src/core/pipeline-registry/` untouched (asserted by a task).
- No API, dependency, or engine changes; the pair's shape is exactly what the explicit gesture
  and `createParallelPair` already build.
- Out of scope, unchanged: sink/finish inference (child 5), v1 editor, canvas Save persistence
  defect.
