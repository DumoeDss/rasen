# Real-browser CDP transcript — canvas-multi-selection task 5.1

- Date: 2026-08-16T20:03:11.473Z
- App: http://127.0.0.1:4523 (in-process `rasen ui --no-open --no-daemon --port 4523` from this worktree, serving this worktree's freshly built `packages/ui/dist` — verified by the served chunk hash `PipelineCanvasPage-DD-cXw32.js` containing `v2-selection-panel`)
- Browser: throwaway Chrome 151 (`--remote-debugging-port=9333` + fresh temp `--user-data-dir`); the user's daily Chrome and its 9222/3456 proxy were never touched.
- Route: `/p/e2ee72ed-04a1-4395-86aa-7e77d2b83ec7/pipelines/cdp-multi-sel-check` (not-found → "Start assembling" — all verification in-memory; the canvas Save persistence defect is out of scope).
- Driver: this script (direct CDP over IPv6 localhost; the repo's cdp-proxy.mjs hardwires 127.0.0.1, which this Chrome does not bind).

## Defect this check caught and closed

The first runs of this check froze the tab permanently on entering the
editor: React Flow's `SelectionListenerInner` runs its effect on the
`onSelectionChange` callback's IDENTITY and fires it once at mount, and the
mirror writer initially wrote a fresh selection object for that unchanged
empty value — re-render, new callback identity, re-fire, forever. Fixed in
`PipelineCanvasPage.tsx` (`onSelectionChange` now returns the same state
for an unchanged value); jsdom could not see this because the test mock
invokes the callback only from explicit button clicks. Also fixed on the
model side after the run below exposed it: `removeV2Nodes` now removes
selected FanOut pairs before plain nodes, so a box-selection of a frontier
plus its members deletes as one unit instead of refusing the last member
("only parallel member" was an iteration-order artifact), and the parallel
palette gesture now selects BOTH halves of the pair it creates.

Driver-level findings recorded for reruns: the authoring gestures create
isolated nodes that dagre stacks in one over-fold column (click the
fit-view control before any coordinate interaction); React Flow's
multi-select key tracking needs a REAL keydown (a synthetic mouse event's
`modifiers` bit is not enough); a selection drag must START on bare pane
(starting on a node is a node drag); and React Flow's box selects by rect
INTERSECTION, not containment.

## Steps

- PASS — authoring setup produced five nodes (nodes=5)
- PASS — box rectangle contains the two stage rects and intersects no other node (from=(581,156) to=(1010,454))
- PASS — box drag starts on the pane, not on a node
- PASS — Shift+drag box-select selected exactly the two enclosed nodes (["atomic-stage","atomic-stage-2"])
- PASS — selection summary reports two nodes (2 nodes)
- PASS — Control+click augmented the selection to three nodes (["atomic-stage","atomic-stage-2","fan-out"])
- PASS — Control+click on a selected node removed it (["atomic-stage-2","fan-out"])
- PASS — Control+click re-added the node (three again) (["atomic-stage","atomic-stage-2","fan-out"])
- PASS — palette add kept the three previously selected nodes selected (["atomic-stage","atomic-stage-2","fan-out","atomic-stage-3"])
- PASS — deleting the selection removed the pair together (fan-out AND join) plus every selected node (["finish"])
- PASS — pair deletion produced no refusal toast (none)
- PASS — emptied selection closed every panel
- PASS — second box-select gathered the two remaining nodes (["finish","atomic-stage"])
- PASS — Delete key removed the whole multi-selection ([])
- PASS — selection summary closed with the emptied selection

## Screenshots

01-not-found.png, 02-authored-graph.png, 03-box-select-two-nodes.png, 04-selection-survives-palette-add.png, 05-pair-deleted-selection-pruned.png, 06-delete-key-emptied-canvas.png

## Result: ALL CHECKS PASSED
