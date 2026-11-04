# Fix record — review round 1 (canvas-multi-selection)

Fixer: implementer-2 (fixer role, review-loop round 1). Date: 2026-08-17. No commits made.
Full UI suite after the fix: **67 files / 768 tests, all passed, exit 0** via the
CI-canonical `pnpm --dir packages/ui exec vitest run` from repo root (baseline after
round 1: 67/765; +3 regression tests).

## B1 (Blocker) — programmatic selection writes reverted by RF's SelectionListener

- **Mechanism verified against the installed source before fixing**:
  `@xyflow/react/dist/esm/index.mjs:157-165` — `SelectionListenerInner`'s effect deps
  `[selectedNodes, selectedEdges, onSelectionChange]`, and the page passes a fresh
  callback identity every render, so the listener re-fires with store truth after every
  commit; store truth adopts the `selected` flags we pass (`StoreUpdater` →
  `adoptUserNodes` in `@xyflow/system`, `internalNode = { ...userNode, ... }`).
- **Fix (pairing, reviewer direction b)**: new `syncFlowSelection` re-stamps
  `selected` on the current flow nodes/edges from a selection
  (`packages/ui/src/canvas/PipelineCanvasPage.tsx:342`), and `replaceSelection`
  (`PipelineCanvasPage.tsx:367`) now writes mirror AND flags in one update. All
  previously unpaired writers routed through it:
  - `selectIssueTarget` branches (`PipelineCanvasPage.tsx:1741` — definition/node/
    connection/declaration branches all call `replaceSelection`);
  - the four panel close handlers (`PipelineCanvasPage.tsx:2351, 2389, 2397, 2409`).
- Already-paired writers were audited and left alone (each writes the mirror together
  with `recomputeFlow(…, nextSelection)` or drops ids the flow already lost):
  gesture adds (`selectAddedNodes` callers), `editParallelContract` join-follow,
  `renameSelectedV2Node`, v1 `renameSelectedStage`, `applyV2BatchRemoval` +
  `pruneSelectionToDraft`, `enterEditWith`; save-success/discard switch to view mode
  where the listener is unmounted. The same-value guard in `onSelectionChange` is
  untouched — the paired write makes the listener's follow-up firing carry a value
  equal to the mirror, which the guard absorbs (no loop, tab-freeze protection intact).
- **Pinned by**: `pipeline-canvas-page.test.tsx:5044` (issue-click selection survives
  the re-fire; flags end exactly at the target) and `:5079` (singleton + summary close
  buttons stay closed; flags cleared).

## M1 (Major) — v1 deleteSelection left ghost stage cards / re-popped the panel

- **Fix**: the v1 branch of `deleteSelection` (`PipelineCanvasPage.tsx:1790`) now drops
  the deleted cards from `flowNodes` (the Delete key's `applyNodeChanges` tail does
  this for that path; the panel button never did) and clears mirror + flags together
  via `replaceSelection([])` — replacing the old bare `pruneSelectionToDraft`, which
  was equivalent in outcome (every selected stage was just removed; v1 prune also
  drops all connection ids) but left the flow un-stamped.
- **Pinned by**: `pipeline-canvas-page.test.tsx:5113` — flow content loses the deleted
  ids (no ghosts), the summary does not re-pop.

## m1 (Minor) — ReactFlow mock had no SelectionListener stand-in

- **Fix**: the mock (`packages/ui/test/canvas/pipeline-canvas-page.test.tsx:69-143`)
  now models both real truths:
  - **store truth = the `selected` flags on the passed nodes/edges** (controlled-mode
    adoption): interaction buttons echo `select` changes through
    `onNodesChange`/`onEdgesChange` exactly as real RF does, and `applyNodeChanges`/
    `applyEdgeChanges` (`pipeline-canvas-page.test.tsx:351`) actually apply `select`
    and `remove` changes instead of being identity;
  - **SelectionListener stand-in**: a no-deps `useEffect` (`pipeline-canvas-page.test.tsx:135`)
    re-emits current flag truth after EVERY render, reproducing the identity-keyed
    re-fire. The `interactionSelection` state is gone (flags are the store); the
    delete-key button reads flags, and refused nodes now stay flagged as in the real
    store.
- **Discrimination proven by mutation** (both reverted afterwards):
  - unpairing `replaceSelection` (drop its `syncFlowSelection` call) → both B1 tests
    fail (2 failed / 91 skipped under `-t B1`);
  - removing the ghost filter in v1 `deleteSelection` → the M1 test fails.
  The existing issue-click test (`replaces a multi-selection with exactly the issue's
  target`, now at `pipeline-canvas-page.test.tsx:4991`) also became discriminative —
  it asserted the right outcome all along but could not see the revert before the
  stand-in existed.

## t1 (Trivial) — V2SelectionPanel title in the v1 editor

- **Fix**: `V2SelectionPanel` gains `title?: string` (default `'Selection'`,
  `packages/ui/src/canvas/V2SelectionPanel.tsx:17,26`); the page passes
  `'Selected stages'` for the v1 stage editor (`PipelineCanvasPage.tsx:2404`).
- **Pinned by**: the v1 title assertion inside the M1 test
  (`pipeline-canvas-page.test.tsx:5125`) and the v2 `'Selection'` assertion inside the
  B1 close test (`:5101`).

## Gates re-verified after the fix

- `git status --porcelain -- src/core/pipeline-registry/` → empty;
  `git diff 74568906 --stat -- src/core/pipeline-registry/` → empty (IR frozen).
- `draft.ts:704` — `V2_BODY_PALETTE_KINDS` still `['AtomicStage']`.
- No `legacyRuntimeOwner` occurrences in the working-tree canvas diff.
- Files touched by this round: `packages/ui/src/canvas/PipelineCanvasPage.tsx`,
  `packages/ui/src/canvas/V2SelectionPanel.tsx`,
  `packages/ui/test/canvas/pipeline-canvas-page.test.tsx` (plus this record).
  No commits, no `git add`, no run-state writes, no tasks.md changes.
