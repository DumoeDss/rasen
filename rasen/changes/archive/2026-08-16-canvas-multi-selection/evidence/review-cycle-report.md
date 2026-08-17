# Review-cycle report — canvas-multi-selection, round 1

- Re-reviewer: reviewer-1 (same reviewer as round 0; fixer is implementer-2, a non-author).
- Scope per dispatch: the fix delta and its blast radius only. No fixes applied, no commits, no
  subagents, no working-tree edits (mutation re-runs were therefore not re-executed by me;
  discrimination verified analytically against the code plus the fixer's documented mutations).
- Fix record reviewed: `evidence/fix-round-1.md`.

## Independent test gate

- Command: `pnpm --dir packages/ui exec vitest run` from repo root, not piped.
- Result: **67 files / 768 tests, all passed, exit 0** — matches the fix claim exactly
  (+3 over round 0's 765; `pipeline-canvas-page.test.tsx` 90→93, `draft.test.ts` unchanged at 55).

## Per-finding verdicts

### B1 (Blocker) — RESOLVED

- `syncFlowSelection` (`PipelineCanvasPage.tsx:342-357`) correctly re-stamps flags in BOTH
  directions — `next.nodeIds.has(node.id) === !!node.selected ? node : { ...node, selected: has }`
  clears flags of unselected ids and adds flags of newly selected ones, preserving object identity
  when already equal (no render churn). Edges handled identically.
- `replaceSelection` (`PipelineCanvasPage.tsx:367-377`) writes mirror AND flags in one update.
- All previously-unpaired writers verified routed through it: `selectIssueTarget` branches
  (`PipelineCanvasPage.tsx:1755, 1761, 1766-1767, 1776`), the four panel close handlers
  (`PipelineCanvasPage.tsx:2351, 2389, 2397, 2409`), and the v1 delete path (`:1810`).
- Complete writer inventory re-grepped — every remaining bare `setSelection` is provably safe:
  `pruneSelectionToDraft` (`:386`) only drops ids absent from the next draft, and every caller
  rebuilds/filters the flow in the same tick so flags cannot hold them; `enterEditWith` (`:453`)
  re-stamps via `recomputeFlow(seed, catalog, EMPTY_CANVAS_SELECTION)` (`:463`); save-success
  (`:648`) and discard (`:495`) switch to view mode where the listener is unmounted
  (`onSelectionChange={editable ? ... : undefined}`); `onSelectionChange`'s same-value guard
  (`:902`) is untouched; gesture/rename/`editParallelContract` writers remain paired through the
  intact `recomputeFlow` `selectionOverride` (`:416, 431, 438`); v1 rename (`:1615`) now goes
  through the paired `replaceSelection` itself. The round-0 "safe sites" list is unchanged and
  still safe.
- Mechanism check: the paired write lands mirror and flags in ONE commit; the listener's next
  identity-keyed re-fire (still present — `@xyflow/react/dist/esm/index.mjs:157-165`, callback
  still re-created per render) now carries a value EQUAL to the mirror, which the guard absorbs.
  No loop; the tab-freeze protection is intact by construction.

### M1 (Major) — RESOLVED

- v1 `deleteSelection` (`PipelineCanvasPage.tsx:1790-1812`) now drops the deleted cards from
  `flowNodes` (`:1809`) and clears mirror + flags together via `replaceSelection([])` (`:1810`).
  No other v1 panel-button delete path exists; the Delete-KEY path was already correct via the
  `applyNodeChanges` tail.
- The fix's note that `replaceSelection([])` is outcome-equivalent to the old
  `pruneSelectionToDraft` here (every selected stage was just removed; v1 prune drops all
  connection ids) is correct — the change adds the flag pairing, not new mirror semantics.

### m1 (Minor) — RESOLVED

- The mock (`pipeline-canvas-page.test.tsx:54-140, 305-328, 351-378`) now models both real
  truths: store truth IS the `selected` flags on the passed nodes/edges (controlled-mode
  adoption), interactions echo `select` changes through `onNodesChange`/`onEdgesChange` exactly
  as controlled-mode RF does, `applyNodeChanges`/`applyEdgeChanges` genuinely apply `select` and
  `remove`, and the no-deps `useEffect` stand-in (`:135-140`) re-fires `onSelectionChange` with
  flag truth after EVERY render — a faithful stand-in for the identity-keyed re-fire. The old
  `interactionSelection` state is gone; the delete-key button reads flags, and refused nodes stay
  flagged (realistic).
- Discrimination verified analytically: with `replaceSelection` unpaired, the issue-click test's
  post-flush assertions (`pipeline-canvas-page.test.tsx:5063-5076`) would observe the reverted
  mirror (summary panel instead of the gate node panel; stale flags) because the stand-in re-fires
  with the stale flags after the very commit that wrote the mirror; the close test (`:5084-5110`)
  would see the panel reopen; the M1 ghost check (`:5131-5133`) fails without the flowNodes
  filter. The fixer additionally ran both mutations for real and reverted them (documented in
  `fix-round-1.md`). The round-0 issue-click test (`:4991`) is now discriminative as well.
- Residual (observation, not a defect): `emitSelection` invokes `onSelectionChange` synchronously
  with the target set while the select echo lands via the change handlers in the same batch — a
  slight ordering simplification vs the real listener (which fires after store adoption). State
  converges identically; no assertion depends on the gap.

### t1 (Trivial) — RESOLVED

- `V2SelectionPanel` gains `title?: string` defaulting to `'Selection'`
  (`V2SelectionPanel.tsx:17, 26, 38`); the page passes `'Selected stages'` for the v1 editor
  (`PipelineCanvasPage.tsx:2404`). Pinned in both directions: v2 `'Selection'` at
  `pipeline-canvas-page.test.tsx:5101`, v1 `'Selected stages'` at `:5125`.

## New findings

None within the fix's blast radius. Specifically checked and clean:

- New render loops from the stand-in + guard interplay: none (same-value absorbed; the full suite
  including all 90 pre-existing page tests now runs under the realistic listener and is green —
  strictly stronger evidence than round 0).
- Frozen-IR gates re-verified by this reviewer after the fix: `git status --porcelain -- src/core/pipeline-registry/` empty, `git diff 74568906 --stat -- src/core/pipeline-registry/` empty,
  `draft.ts:704` still `['AtomicStage']`, no `legacyRuntimeOwner` writes in the working-tree diff.
- Working-tree scope unchanged: the same five files as round 0 (`PipelineCanvasPage.tsx`,
  `draft.ts`, two test files, untracked `V2SelectionPanel.tsx`); no commits, no run-state writes.

## Overall verdict: CLEAN

All four round-0 findings resolved with correct, minimal, well-paired fixes; the test
infrastructure now actually guards the mechanism that hid the Blocker; independent gate
reproduced at 67 files / 768 tests, exit 0. Ready for ship.
