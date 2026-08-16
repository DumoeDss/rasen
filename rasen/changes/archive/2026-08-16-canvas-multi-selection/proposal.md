# Proposal: canvas-multi-selection

## Why

The v2 pipeline canvas has no multi-select: selection is three mutually-exclusive single scalars
(`selectedStageId` / `selectedConnectionId` / `selectedDeclarationId` in
`PipelineCanvasPage.tsx`), so cleaning up a draft means one delete at a time, and no panel can
represent "several things are selected". This is also the substrate every later gesture of this
portfolio needs — the author's target experience is to box-select a region of the canvas and act
on it as one unit (round-one user wording: 框选「打成复用块」). React Flow already runs a
selection model of its own underneath the page's scalars — box-select (Shift+drag) and
Ctrl/Cmd+click augmentation are live by default and simply invisible to the page — so the editor
today has two selection truths that disagree after every mutation. (Design exploration and
evidence: `office-hours-design.md` in this change directory, source context for this proposal.)

## What Changes

- Set-based canvas selection replaces the node/connection single scalars: one selection state
  holding a set of node ids and a set of connection ids, driven by React Flow's own selection
  (box-select via Shift+drag, augmentation via Ctrl/Cmd+click, click to select, pane click to
  clear). Declaration selection stays single (the declaration editor edits one declaration).
- Panels render a multi-selection state: exactly one node selected opens today's node panel
  unchanged; exactly one connection opens today's connection panel unchanged; two or more
  selected elements (nodes, connections, or a mix) open a selection summary panel with counts
  and a delete action.
- Multi-delete with parallel-pair co-deletion: deleting a multi-selection removes every
  eligible node; a selected FanOut takes its Join with it; refusals (a Join whose FanOut was
  not selected, a node still targeted by a Gate, a parallel pair's last member, read-only
  nodes) are reported together in one summary message instead of one toast per node.
- Selection survives non-destructive edits: after adding a node or editing a contract, the
  current selection is still selected (today every mutation visually clears it).
- Issue-drawer navigation still selects exactly the one stage an issue points at.
- v1 editor rides the same selection model through the derived single-selection view; its
  properties-panel behavior is unchanged, and multi-delete of stages works there too.
- No inference, extraction, or synthesis features — those are later children of the portfolio;
  this slice only lays the selection contract they will consume (the node-id set).

## Capabilities

### New Capabilities

<!-- none — selection is canvas-editor behavior inside the existing pipelines-ui capability -->

### Modified Capabilities

- `pipelines-ui`: selection in the canvas editor becomes a set (box-select, augmented click,
  mixed node/connection selection, multi-state panels, selection surviving non-destructive
  edits) and deletion accepts a multi-selection with parallel-pair co-deletion and one summary
  message for refusals. Delivered as one ADDED requirement ("Canvas selection is a set") — no
  existing requirement text becomes false under this change, so no requirement is modified.

## Impact

- Code: `packages/ui/src/canvas/PipelineCanvasPage.tsx` (selection state, ~16 scalar write
  sites migrated, ReactFlow props), `packages/ui/src/canvas/draft.ts` (selection model types +
  pure batch-removal helper — the one-home rule), a new small `V2SelectionPanel.tsx`, and
  `packages/ui/test/canvas/` (ReactFlow mock gains a selection-change trigger; page/model
  tests migrated and extended).
- Frozen: `src/core/pipeline-registry/` untouched (asserted by a task).
- No API, dependency, or engine changes; `@xyflow/react` ^12.3.6 already provides every
  selection primitive used.
- Out of scope, unchanged: canvas Save persistence defect (pre-existing), declaration editor,
  palette, view mode.
