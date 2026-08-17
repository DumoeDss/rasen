# Proposal: canvas-sink-finish-inference

## Why

The portfolio's story is that the author drops nodes, draws edges, and the IR emerges; children
1-4 delivered selection, packaging, loops, and parallelism. The last unnamed structure is the
ending: a node with no outgoing connection is structurally terminal, and the only author input
the IR needs for it is WHICH named outcome that endpoint carries (the round-one user wording:
loops with an exit, and endings that mean something). Today the author must know to reach for
the explicit Finish palette gesture and draw the terminal edge themselves; the editor never
recognizes that the chain they just built already ends. This is the smallest slice of the
portfolio: recognition plus one select.

## What Changes

- Sink recognition in the draft model: a root node with no outgoing connection is a sink;
  plain stages and parallel barriers are promotable sinks (the two kinds whose authored
  terminal wiring the codebase already exercises). The barrier is never converted (a Finish is
  its own IR kind and a barrier's outcomes are barrier semantics); promotion always APPENDS a
  Finish downstream.
- A panel affordance on the selected promotable sink (pull, not push: sink-ness is too common
  for toast offers): a "name this endpoint's outcome" section in the node's properties panel
  with one outcome select over the definition's outcomes and a confirm button.
- Confirming appends a `Finish` in exactly the explicit gesture's shape (`addFinishNode`'s
  node, with the author's picked outcome instead of the first-outcome default), wires the sink
  to it on the rendered handle ids, and leaves the new Finish selected. The sink's own content
  is untouched; nothing is stamped with runtime-ownership metadata.
- The explicit Finish palette gesture is untouched and remains the path for non-promotable
  sink kinds (a loop or composite reference end, a gate, a branch point) and for authors who
  prefer it; no capability hole. No other inference.

## Capabilities

### New Capabilities

<!-- none — sink recognition is canvas-editor behavior inside the existing pipelines-ui capability -->

### Modified Capabilities

- `pipelines-ui`: the canvas editor recognizes terminal nodes and offers to name their
  outcome. Delivered as one ADDED requirement ("The canvas names a sink's outcome"); the
  Finish gesture, the node panels, and every existing scenario stay true, so no requirement is
  modified.

## Impact

- Code: `packages/ui/src/canvas/draft.ts` (`isPromotableSink` + `promoteSinkToFinish`, the
  one-home rule), `packages/ui/src/canvas/V2NodePanel.tsx` (optional promotion section,
  presentational), `PipelineCanvasPage.tsx` (compute the affordance, confirm handler with the
  selectionOverride pairing), and `packages/ui/test/canvas/` (model + component tests).
- Frozen: `src/core/pipeline-registry/` untouched (asserted by a task).
- No API, dependency, or engine changes; the Finish node's shape is exactly what
  `addFinishNode` already builds.
- Out of scope, unchanged: sinks inside declaration bodies (their outcome mapping belongs to
  the declaration's own contract, child 2's territory), other inference kinds, v1 editor,
  canvas Save persistence defect.
