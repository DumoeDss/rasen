# Proposal: canvas-boxselect-containment-fix

## Why

Box-select silently drops visually-enclosed nodes, reproduced deterministically 3/3 in child 3's
browser gate (and observed 3/3 in child 2's): every geometry-verified rectangle missed exactly
its leftmost enclosed node, and a tight singleton rectangle selected zero nodes. The mechanism
is now confirmed from the installed library source, not guessed: React Flow v12's default
`selectionMode` is `SelectionMode.Full`
(`@xyflow/react/dist/esm/index.js:3728`), and box selection calls `getNodesInside(...,
selectionMode === SelectionMode.Partial, ...)` (`index.js:1519`) — under Full, `getNodesInside`
includes a node only when the rectangle FULLY contains its bounds
(`@xyflow/system/dist/esm/index.js:354-381`: `overlappingArea >= area` unless `partially`).
Our `CanvasFlow` passes only `selectionKeyCode="Shift"` (`PipelineCanvasPage.tsx:2777`) and
never sets `selectionMode`, so any rectangle that clips a node's edge by even a pixel silently
drops it — the evidence rectangles entered exactly 10px into the leftmost target's left edge,
which is why the leftmost node was always the one missed and a tight singleton selected
nothing. The reviewer's drag-on-node and coordinate-transform hypotheses are ruled out by the
same source. This is a real defect against the shipped intent: a selection box drawn around
nodes must select them.

## What Changes

- `CanvasFlow` passes `selectionMode={SelectionMode.Partial}` to React Flow (one-line fix,
  imported from `@xyflow/react`): box selection selects every node the rectangle overlaps —
  intersection semantics, the mainstream node-editor behavior the box-select gesture implies.
  Multi-node rectangles select all overlapped nodes; a rectangle touching a single node selects
  it. Applies identically to the v1 and v2 editors (one shared component).
- Edge co-selection follows automatically (React Flow selects edges by connection to selected
  nodes on the same code path), so the mixed node+connection behavior is unchanged in shape,
  just no longer under-selecting.
- A component test pins that `CanvasFlow` passes `SelectionMode.Partial` (the mock cannot
  express rect geometry — jsdom does no layout — so the behavioral pin is the real-browser
  repeat-probe).
- The real-browser gate reruns the m2 probe shape — same 10px-clip rectangles that failed,
  `--window-size=1600,1000`, fresh throwaway-CDP port — and requires full membership 3/3 plus
  the singleton case.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `pipelines-ui`: MODIFIED "Canvas selection is a set" (child 1's requirement, in our tree at
  `rasen/specs/pipelines-ui/spec.md:578`) — the defect falsifies the box-select scenario's
  intent in the shipped build, and the requirement's "encloses" wording is ambiguous between
  full-containment and overlap. The delta pins intersection semantics explicitly ("every node
  and connection the box overlaps") and adds the partial-overlap and singleton scenarios so a
  future regression is a spec violation, not just a probe failure. Baseline copied from our own
  tree (child 1's text, landed via its archive — the f77bccdf rule applies only to
  round-one-touched requirements).

## Impact

- Code: `packages/ui/src/canvas/PipelineCanvasPage.tsx` (the `selectionMode` prop + import) and
  `packages/ui/test/canvas/pipeline-canvas-page.test.tsx` (the prop pin). Nothing else — no
  draft.ts touch, no new components, no refactors.
- Frozen: `src/core/pipeline-registry/` untouched (asserted by a task).
- Out of scope: everything else — no gesture changes, no selection-model changes, no probe
  driver refactors beyond rerunning it.
