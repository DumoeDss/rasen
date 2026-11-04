# Design: canvas-multi-selection

## Context

The v2 canvas editor tracks selection in three single scalars
(`PipelineCanvasPage.tsx`: `selectedStageId`, `selectedConnectionId` — mutually
exclusive by hand-rolled clearing in `onNodeClick`/`onEdgeClick`/`onPaneClick` —
and `selectedDeclarationId`). Underneath them, `@xyflow/react` v12 runs its own
selection on `node.selected`/`edge.selected`: box-select (Shift+drag) and
multi-select-key augmentation are on by default, and select changes flow through
the same `onNodesChange` → `applyNodeChanges` pipe the page already owns. The two
truths already disagree in the shipping app: `recomputeFlow()` rebuilds every
flow node via `draftToGraph` + `layoutGraph` (neither carries `selected`), so any
draft mutation visually deselects everything while the page scalars persist — and
a box-select + Delete today bypasses the panels entirely.

`office-hours-design.md` in this change directory is the source exploration: it
verified every premise above against `74568906` (now this branch's base) and the
React Flow v12 API reference, and chose the direction elaborated here.

Constraints carried from the portfolio: IR frozen under `src/core/pipeline-registry/`;
one home for canvas model vocabulary in `draft.ts`; `V2_BODY_PALETTE_KINDS` stays
`['AtomicStage']`; never stamp `legacyRuntimeOwner` (this change synthesizes no
nodes at all); canvas Save persistence defect is out of scope and verification
stays in-memory.

## Goals / Non-Goals

**Goals:**

- One selection truth: React Flow's interaction selection drives everything; the
  page keeps a derived mirror that panels read.
- Set semantics with mixed node/connection selection; box-select and augmented
  click work as first-class gestures.
- Singleton selection preserves today's panel behavior exactly (node panel,
  connection panel, v1 stage panel, issue navigation).
- Multi-delete as the independently-useful capability, with parallel-pair
  co-deletion and one summarized refusal message.
- Selection survives non-destructive mutations.
- The mirror (`CanvasSelection.nodeIds`) is the forward contract children B/C/D
  will consume (subgraph extraction, loop inference, frontier inference).

**Non-Goals:**

- Subgraph extraction, loop/parallel/finish inference — later children; no
  B-shaped assumptions (e.g. "exactly two") anywhere in the model.
- Durable node positions / manual placement (`recomputeFlow` re-layout stays;
  only selection is carried across it).
- Atomic all-or-nothing multi-delete (best-effort now; cut atomicity belongs to
  child B, see Open Questions).
- Declaration editor changes (selection there stays a single scalar).
- View mode changes; palette changes; fixing canvas Save persistence.
- `selectionOnDrag` (plain-drag box-select) — product call deferred.

## Decisions

### D1. React Flow owns the interaction truth; the page derives (chosen over page-owned Set with two-way sync, and over keeping scalars)

The page holds `selection: CanvasSelection` (`{ nodeIds: ReadonlySet<string>;
connectionIds: ReadonlySet<string> }`), updated from exactly two writer
families: `onSelectionChange` (every user-driven change: click, box, augment,
pane click, delete) and programmatic replacers (gesture handlers selecting the
node they just created, issue navigation, id-following after rename). React Flow
never receives selection writes back except through the `selected` flags the
page stamps when rebuilding nodes — a one-way flow, no reconciliation loop.

*Why not two-way sync:* mirroring page sets into React Flow on every keystroke
is the exact drift class draft.ts's vocabulary comments warn about ("four
independent encodings … drifting apart"). *Why not keep scalars:* they cannot
represent the multi state and already diverge from React Flow's selection today.

### D2. Model types and pure helpers live in `draft.ts` (one-home rule)

`CanvasSelection`, `EMPTY_CANVAS_SELECTION`, `singletonNodeId(selection)`, and
`selectionPanelMode(selection): 'empty' | 'node' | 'connection' | 'multi'` are
exported from `draft.ts`, beside `DefinitionIssueTarget` — the existing
precedent for UI-adjacent model types. Panels and the page never re-derive
"what does this selection mean" independently.

### D3. The migration is a fixed write-site map (no scattershot refactor)

Every current scalar write site, migrated:

| Site (at base `74568906`) | Becomes |
|---|---|
| scalar declarations (`:148/152/154`) | `selection` + `selectedDeclarationId` |
| `onNodesChange` removal prunes (v2 `:677-682`, v1 `:691`) | prune `selection.nodeIds` |
| `onEdgesChange` removal prune (`:727-729`) | prune `selection.connectionIds` |
| `onNodeClick` / `onEdgeClick` / `onPaneClick` (`:744-761`) | deleted — React Flow updates selection natively; `onSelectionChange` mirrors it |
| gesture handlers `addStageGesture`/`addRootGesture`/`insertDeclarationRef` | replace selection with `{nodeIds: new Set([newId])}` |
| `spliceConnectionCondition` / `unspliceSelectedChoice` | clear the affected half (connection / node) |
| `renameSelectedV2Node` / `renameSelectedStage` (and `editParallelContract`'s join-follow) | replace with the new id |
| `deleteParallel` | clear node half |
| `selectIssueTarget` (`:1527-1560`) | replace selection with the issue's single target node (spec: "an issue selects exactly its target") |
| `enterEditWith` / `backToViewAfterDiscard` / save-success reset | clear both `selection` and the declaration scalar |
| `recomputeFlow` (`:313-325`) | selection-carry: stamp `selected` from `selection` onto rebuilt nodes and edges |

Singleton panel behavior is preserved by derivation: `selectedV2Node` /
`selectedStage` / `selectedConnection` memos read `singletonNodeId` /
singleton-connection instead of the scalars; `key={id}` remount semantics and
field-issue memos are unchanged. v1 paths consume the same
`singletonNodeId` — v1 is unified by derivation, not by parallel state.

### D4. Box-select configuration: pin the defaults, change nothing else

`CanvasFlow` passes `selectionKeyCode="Shift"` and leaves
`multiSelectionKeyCode` at its platform-aware default (Control off-macOS —
verified in the React Flow v12 API reference), `selectionOnDrag` false,
`deleteKeyCode` as today. Pinning Shift makes the interaction contract visible
in code instead of relying on library defaults.

### D5. Multi-delete: one pure batch helper, best-effort, pair-aware

`removeV2Nodes(def, ids): { next, removedIds, refused: { id, reason }[] }` in
`draft.ts`:

- A selected `FanOut` routes through `removeParallelPair` (its `Join` goes with
  it whether or not the Join was selected); a lone selected `Join` is refused
  with the existing paired-deletion message.
- Other refusals reuse `removeV2Node`'s existing thrown messages verbatim
  (Gate target, only parallel member) — no new vocabulary; read-only kinds are
  skipped and not counted as refusals (they were never selectable-editable).
- The page calls it once per delete batch, prunes `selection.nodeIds` by
  `removedIds`, then `recomputeFlow` + `markDraftChanged`, and shows **one**
  summary toast when `refused` is non-empty ("Deleted N · M refused: …").
- The v1 branch keeps its existing `removeStage` loop (already batch-capable).
- Best-effort over atomic: matches today's single-delete refusal semantics;
  atomicity is deferred to child B where the extraction cut makes it
  load-bearing (Open Questions).

### D6. Panel modes: `V2SelectionPanel` for the multi state

`selectionPanelMode` picks the right-column panel: `'node'` → `V2NodePanel`
(unchanged), `'connection'` → `V2ConnectionPanel` (unchanged), `'multi'` → new
`V2SelectionPanel` (counts by entity and node kind, delete button wired to the
same batch path as the Delete key, `.stage-panel` styling like its siblings).
No disabled previews of future portfolio actions. `'empty'` renders nothing,
as today.

### D7. Spec delta is ADDED-only, deliberately base-independent

Round one's spec sync lives in archive commit `f77bccdf`, which is NOT an
ancestor of this branch (this branch carries the round-one code from
`74568906`; the spec text in the tree is pre-round-one). An ADDED-only delta
("Canvas selection is a set") applies cleanly regardless of which state the
spec is in when this change archives, and nothing in the existing requirements
("render, connect, select, edit, and delete every v2 root node kind", "delete
stages", "a properties panel on the selected stage") becomes false under set
selection. No requirement is modified, so no whole-requirement replacement can
accidentally drop round-one wording.

### D8. Test strategy

- Unit (`draft.test.ts` / new selection-model tests): `removeV2Nodes` pair
  routing and every refusal class; `selectionPanelMode` boundaries; prune
  helpers.
- Component (`pipeline-canvas-page.test.tsx`): the ReactFlow mock gains an
  `onSelectionChange` trigger (same pattern as its existing
  `mock-node-click`/`mock-pane-click` buttons); existing singleton-selection
  assertions migrate to the new trigger and must stay green; new tests cover
  multi panel mode, batch delete + refusal summary, prune-on-removal,
  selection-carry across a mutation, issue navigation replacing the selection,
  v1 multi-delete.
- Real browser (throwaway CDP Chrome, never the daily browser): one scripted
  pass for Shift+drag box-select, Control+click augmentation, Delete on a
  multi-selection containing a parallel pair. jsdom performs no layout, so the
  box geometry itself is verified only here.
- Discipline: run via the `packages/ui` vitest config and cite file/test counts
  (baseline at this base: 67 files / 743 tests).

## Risks / Trade-offs

- [Round-one spec sync (`f77bccdf`) is not in this branch] → ADDED-only delta
  (D7) makes the delta valid against either spec state; the implement/verify
  stages should not "helpfully" rebase the delta onto the stale tree copy.
- [`onSelectionChange` does not fire for programmatic changes] → every
  programmatic selection goes through explicit replacers (D3); a missed one
  shows up as a stale panel, covered by the component tests.
- [Selection-carry interacts with rename (ids change)] → rename replaces the
  selection with the new id rather than carrying by id; covered by tests.
- [Preact + `ReadonlySet` identity churn re-rendering panels] → the mirror is
  replaced only on actual selection change; memos depend on the selection
  object identity, matching today's scalar behavior.
- [Batch delete partial application surprises users mid-portfolio] → the one
  summary message names every refusal; atomicity revisited at child B.
- [Windows test flakiness contaminating the gate] → re-run in isolation on a
  settled machine before diagnosing; never pipe gate output through `tail`.

## Migration Plan

Single change, single PR: model + helpers land with their unit tests first,
page migration and panel second, mock + component tests third, real-browser
check last; IR-frozen assertion runs as a task gate. Rollback is the PR revert;
no data, API, or persisted-format changes exist (selection is session-only UI
state). Ship `local` per the portfolio decision; the parent delivers once all
children complete.

## Open Questions

- Should multi-delete become atomic (pre-validate, all-or-nothing) when child
  B's extraction cut lands? Best-effort is shippable either way.
- Should `selectionOnDrag` replace Shift+drag once box-select becomes the
  primary gesture after child B? Product call with working code in hand.
- Whether the post-archive spec state renames any heading this delta should
  reference — moot while the delta is ADDED-only, revisit only if a later
  spec-sync touches selection wording.
