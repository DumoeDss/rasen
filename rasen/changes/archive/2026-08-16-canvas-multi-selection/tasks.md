## 1. Selection model (draft.ts)

- [x] 1.1 Add `CanvasSelection` (`{ nodeIds: ReadonlySet<string>; connectionIds: ReadonlySet<string> }`), `EMPTY_CANVAS_SELECTION`, `singletonNodeId()`, and `selectionPanelMode()` (`'empty' | 'node' | 'connection' | 'multi'`) to `packages/ui/src/canvas/draft.ts` beside `DefinitionIssueTarget`, with the one-home rationale in a doc comment
- [x] 1.2 Add `removeV2Nodes(def, ids)` returning `{ next, removedIds, refused: { id, reason }[] }`: route selected FanOuts through `removeParallelPair` (Join travels with it, selected or not), refuse a lone Join / Gate-targeted node / only parallel member with the existing `removeV2Node` message strings, skip read-only kinds silently
- [x] 1.3 Unit tests for 1.1-1.2 in `packages/ui/test/canvas/draft.test.ts`: panel-mode boundaries (0/1 node/1 connection/mixed/2+), pair co-deletion, lone-Join refusal, Gate-target refusal, last-member refusal, mixed batch with partial refusals, empty/no-op batch

## 2. Page migration (PipelineCanvasPage.tsx)

- [x] 2.1 Replace `selectedStageId`/`selectedConnectionId` with `selection: CanvasSelection` state; re-derive `selectedStage`/`selectedV2Node`/`selectedConnection` and the field-issue memos from `singletonNodeId`/singleton-connection so singleton behavior (incl. `key={id}` remounts) is unchanged; keep `selectedDeclarationId` scalar
- [x] 2.2 Wire `onSelectionChange` as the single user-action mirror writer; delete the hand-rolled XOR bodies of `onNodeClick`/`onEdgeClick`/`onPaneClick` and their `CanvasFlow` props; pass `selectionKeyCode="Shift"` explicitly in `CanvasFlow` and leave `multiSelectionKeyCode`/`selectionOnDrag`/`deleteKeyCode` at current behavior
- [x] 2.3 Migrate the programmatic write sites per design D3: gesture handlers (`addStageGesture`, `addRootGesture`, `insertDeclarationRef`) replace selection with the new node id; `spliceConnectionCondition`/`unspliceSelectedChoice` clear the affected half; `renameSelectedV2Node`/`renameSelectedStage`/`editParallelContract` join-follow replace with the new id; `deleteParallel`, `enterEditWith`, `backToViewAfterDiscard`, and save-success reset clear; `selectIssueTarget` replaces with the single target node
- [x] 2.4 Add selection-carry to `recomputeFlow`: stamp `selected` from `selection` onto rebuilt nodes and edges by id, so non-destructive mutations no longer visually deselect
- [x] 2.5 Prune `selection.nodeIds`/`connectionIds` of removed ids in `onNodesChange`/`onEdgesChange`, and route v2 node removals through `removeV2Nodes` with ONE summary toast when refusals exist ("Deleted N · M refused: …"); v1 keeps its `removeStage` loop

## 3. Multi-state panel

- [x] 3.1 Create `packages/ui/src/canvas/V2SelectionPanel.tsx`: `.stage-panel`-styled summary (node/connection counts, node kinds), a delete button wired to the same batch path as the Delete key, no other affordances; render it for `selectionPanelMode === 'multi'` in the right-column slot via `data-testid="v2-selection-panel"`

## 4. Tests

- [x] 4.1 Extend the ReactFlow mock in `packages/ui/test/canvas/pipeline-canvas-page.test.tsx` with an `onSelectionChange` trigger (same button-callback pattern as `mock-node-click`/`mock-pane-click`) and migrate every existing selection assertion to it; all singleton behaviors (node panel opens, connection panel opens, pane clears, issue click selects one stage) must stay green
- [x] 4.2 New component tests: box/multi selection renders the summary panel; mixed node+connection selection; multi-delete removes the set and cleans references; FanOut co-deletes its Join; refusal summary is one message naming each refused element; selection survives an add-node mutation; selection pruned after delete; issue click replaces a multi-selection; v1 multi-stage delete
- [x] 4.3 Run the full UI suite via the `packages/ui` vitest config (`pnpm exec vitest run --config packages/ui/vitest.config.ts` from repo root), CITE the file/test counts against the 67 files / 743 tests baseline, and fix regressions (do not pipe the command through `tail`)

## 5. Gates

- [x] 5.1 Real-browser verification via throwaway CDP Chrome (fresh `--user-data-dir`, `--remote-debugging-port`; never the user's daily browser): Shift+drag box-select selects several nodes, Control+click augments, Delete on a multi-selection containing a parallel pair removes the pair, a follow-up palette add keeps the prior selection highlighted; record the transcript in the change's evidence dir
- [x] 5.2 Assert `git diff 74568906..HEAD -- src/core/pipeline-registry/` is empty (IR frozen), confirm no test asserts `legacyRuntimeOwner` stamps were added, and confirm `V2_BODY_PALETTE_KINDS` is still `['AtomicStage']`
