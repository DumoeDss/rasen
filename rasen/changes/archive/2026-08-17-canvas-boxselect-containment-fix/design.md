# Design: canvas-boxselect-containment-fix

## Context

The defect: box-select rectangles drop visually-enclosed nodes. Reproduced 3/3 in child 3's
browser gate (transcript Phase A: middle pair got `[3]` of `[2,3]`, singleton got `[]`, triple
got `[3,4]` of `[2,3,4]` — always the leftmost enclosed node missed, singleton zero), matching
child 2's earlier 3/3 observation. Child 3's reviewer hypothesized drag-on-node or
coordinate-transform classes; both are ruled out by the library source.

**Confirmed mechanism (all citations read, not inferred):**

1. `@xyflow/react` v12's `ReactFlow` default is `selectionMode = SelectionMode.Full`
   (`packages/ui/node_modules/@xyflow/react/dist/esm/index.js:3728`, the prop default in the
   component signature).
2. The box-selection update computes
   `getNodesInside(nodeLookup, nextUserSelectRect, transform, selectionMode === SelectionMode.Partial, true)`
   (`index.js:1519`) — the fourth argument is `partially`; under our configuration it is
   `false`.
3. `getNodesInside` (`packages/ui/node_modules/.pnpm/@xyflow+system@0.0.79/.../dist/esm/index.js:354-381`)
   includes a node only when `overlappingArea >= area` (the rectangle FULLY contains the
   node's bounds), or the node is being dragged, or it has no handle bounds yet
   (first-render only).
4. Our `CanvasFlow` passes only `selectionKeyCode="Shift"`
   (`packages/ui/src/canvas/PipelineCanvasPage.tsx:2777`) — `selectionMode` is never set, so
   Full containment applies.
5. The evidence rectangles entered exactly 10px into the leftmost target's left edge
   (the archived drivers' rect construction: `from.x = Math.min(...rects.map(r => r.x)) + 10`),
   which geometrically contains every node by intersection but never FULLY contains the
   leftmost — hence the deterministic leftmost-only miss and the singleton zero.

The same code path derives edge co-selection from the selected nodes' connections
(`index.js:1519-1531`), so edges under-select identically; fixing the node rule fixes both.

## Goals / Non-Goals

**Goals:**

- Box selection uses overlap semantics: any node the rectangle intersects is selected
  (multi-node rects select all overlapped; a singleton-touching rect selects its node).
- The m2 repeat-probe shape (same 10px-clip geometry that failed) passes 3/3.
- The semantics are spec-pinned (MODIFIED "Canvas selection is a set") and prop-pinned (a
  component test), so a regression is visible at both levels.

**Non-Goals:**

- Any change to selection state, panels, deletion, gestures, or the extraction/loop features.
- `selectionOnDrag`, `panOnDrag`, or any other interaction-mode change.
- Changing the probe drivers' geometry (the failing geometry is the regression fixture).
- Touching draft.ts at all.

## Decisions

### D1. Fix by passing `selectionMode={SelectionMode.Partial}` — one prop, not geometry or workaround

Import `SelectionMode` from `@xyflow/react` and pass `selectionMode={SelectionMode.Partial}`
on the `ReactFlow` element in `CanvasFlow`, beside `selectionKeyCode="Shift"`
(`PipelineCanvasPage.tsx:2777`). This flips the `partially` flag at `index.js:1519`, making
`getNodesInside` use `overlappingArea > 0`. Why Partial over keeping Full and "drawing
better rects": Full containment silently drops any node the box clips by a pixel — the
interaction reads as broken to an author sweeping a region, and the shipped scenario intent
("a selection box around four nodes" → all four) is overlap semantics. Overlap is the
mainstream node-editor convention and what the portfolio's box-select gesture (the region
sweep that feeds packaging and deletion) presumes.

### D2. Test where each layer can see

- **Component** (jsdom, no layout): pin the contract we own — `CanvasFlow` renders ReactFlow
  with `selectionMode` equal to `SelectionMode.Partial`. The mock cannot express rect
  geometry, so this is a prop pin, honestly labeled as such (removing the prop trips it).
- **Real browser** (the behavioral pin): rerun the m2 probe shape from the archived driver —
  same rect construction including the 10px left clip, `--window-size=1600,1000` (without it
  the flow column collapses and elementFromPoint falls through), fresh throwaway-CDP port
  (9333-9338 busy in sibling sessions), assert FULL membership 3/3 and the singleton case
  selecting its node. Reuse the archived driver's probe function verbatim; record the
  transcript in this change's evidence dir.

### D3. Spec delta: MODIFIED, baseline from our own tree

The defect falsifies the shipped scenario's intent, and the requirement's "encloses" wording
is ambiguous between containment readings. The delta copies the ENTIRE requirement block from
`rasen/specs/pipelines-ui/spec.md:578` (child 1's own text, landed via its archive — the
f77bccdf-from-git rule applies only to round-one-touched requirements), rewrites the box-select
sentence to overlap semantics ("every node and connection the box overlaps — full containment
is NOT required"), keeps all ten existing scenarios verbatim (behaviorally unchanged), and adds
two scenarios: "A clipped node still selects" and "A single-node rectangle selects its node".
Whole-requirement replacement per the delta rules — nothing omitted.

### D4. Scope guard

One source-file line plus one import in `PipelineCanvasPage.tsx`; one test file touched;
nothing else. `src/core/pipeline-registry/` untouched (task gate). v1 and v2 share
`CanvasFlow`, so both editors get the fix — intended, since both rely on box-select for
multi-delete.

## Risks / Trade-offs

- [Overlap selects nodes the user only grazed] → intended semantics (D1); the pane-click
  clear and Ctrl/Cmd-click removal remain the correction path, same as any node editor.
- [Prop pin test is weaker than behavior] → the real-browser probe is the behavioral pin
  (D2); the two layers are explicitly complementary.
- [Future RF upgrade changes defaults again] → the prop is pinned explicitly (like
  `selectionKeyCode`), so upgrades cannot silently flip it; the spec scenario keeps the
  product contract regardless.

## Migration Plan

Single change, single PR: prop + import, prop-pin test, spec delta, rerun probe. Rollback is
the PR revert. Ship per the bug-fix pipeline (propose → apply → verify → ship → archive).

## Open Questions

- None — the mechanism is source-confirmed and the fix is one prop.
