# Handoff — implementer-2, canvas-multi-selection (review-loop round 1 fix)

## Status: COMPLETE — B1/M1/m1/t1 all fixed; 67 files / 768 tests green (exit 0); parked to beat cap

- Change: `canvas-multi-selection` (child 1 of `canvas-gesture-ir-compiler`), stage
  review-loop round 1 (fixer). Worktree `feat/canvas-gesture-ir-compiler` @ base
  `74568906`, **no commits made** (ship still owns them; narrow pathspecs unchanged:
  four modified files + `packages/ui/src/canvas/V2SelectionPanel.tsx` + change dirs).
- Full record for the re-reviewer: `evidence/fix-round-1.md` (per-finding deltas with
  file:line and pinning tests). Tests: `pnpm --dir packages/ui exec vitest run` from
  repo root → **67 files / 768 tests, exit 0** (was 67/765; +3 regression tests).
- Gates re-verified: `src/core/pipeline-registry/` empty status + empty diff vs base;
  `V2_BODY_PALETTE_KINDS` still `['AtomicStage']` (draft.ts:704); zero
  `legacyRuntimeOwner` in the diff; tasks.md untouched (14/14).

## What round 1 changed (the short version)

1. **B1 (pairing fix, reviewer direction b)**: `syncFlowSelection`
   (PipelineCanvasPage.tsx:342) re-stamps `selected` flags; `replaceSelection`
   (:367) now writes mirror + flags in one update. Routed through it:
   `selectIssueTarget` (:1741) and the four panel close handlers
   (:2351/:2389/:2397/:2409). The same-value guard in `onSelectionChange` is
   INTENTIONALLY untouched — the paired write makes the listener's follow-up carry an
   equal value which the guard absorbs.
2. **M1**: v1 `deleteSelection` (:1790) now drops deleted cards from `flowNodes` and
   clears via `replaceSelection([])` (replaces the old `pruneSelectionToDraft` call —
   outcome-equivalent for this path since every selected stage was just removed).
3. **m1**: the ReactFlow mock now models BOTH real truths — store truth = the
   `selected` flags on passed nodes/edges (interactions echo `select` changes through
   onNodesChange/onEdgesChange; `applyNodeChanges`/`applyEdgeChanges` actually apply
   select+remove instead of identity), plus a no-deps `useEffect`
   (pipeline-canvas-page.test.tsx:135) that re-emits flag truth after EVERY render —
   the identity-keyed listener re-fire. `interactionSelection` state is GONE.
4. **t1**: `V2SelectionPanel` gained `title?: string` (default 'Selection'); page
   passes 'Selected stages' for v1 (PipelineCanvasPage.tsx:2404).

## Discrimination proofs (mutation-tested, then reverted — none remain)

- Unpair `replaceSelection` (drop its `syncFlowSelection` call) → both B1 tests fail.
- Remove the ghost filter in v1 `deleteSelection` → the M1 test fails.
- The pre-existing issue-click test (pipeline-canvas-page.test.tsx:4991) also became
  discriminative — it asserted the correct outcome all along but was blind before the
  stand-in existed. That is the m1 lesson institutionalized: a green suite proved
  nothing about the listener path until the mock modeled it.

## Decisions a successor must know

1. **Why pairing (direction b) and NOT callback stabilization (direction a)**: with
   `useCallback` alone, RF's store keeps the stale selection (Delete key would target
   it, visuals would lag), and a pane-click after a programmatic write would produce
   NO store change → no listener firing → the mirror would keep the stale value.
   Pairing keeps one truth and makes every firing consistent.
2. **Mechanism, verified in the installed source** (not from the review report alone):
   `SelectionListenerInner` effect deps `[selectedNodes, selectedEdges,
   onSelectionChange]` (@xyflow/react dist/esm/index.mjs:157-165); store adoption
   spreads the user node (`adoptUserNodes` in @xyflow/system 0.0.79) so the flags we
   pass ARE store truth in controlled mode.
3. **In controlled mode RF echoes interactions as `select` changes** through
   onNodesChange/onEdgesChange — the page's `applyNodeChanges` tail is what lands
   them on the flags. The old mock's identity appliers hid this; the new ones apply
   select+remove. If a later child mocks RF again, copy this mock, don't stub it bare
   (canvas-authored-composite-export.test.tsx still has the bare stub — fine there,
   it never exercises selection).
4. **Every mirror writer must go through `replaceSelection` (or pair with
   `recomputeFlow(…, nextSelection)`)**. The audited-safe set that does NOT call
   replaceSelection: gesture adds, editParallelContract join-follow,
   renameSelectedV2Node (all pass explicit selectionOverride), pruneSelectionToDraft
   (always called after the flow already lost the pruned ids), enterEditWith
   (rebuilds from EMPTY), save-success/discard (listener unmounted in view mode).
   A future writer that calls bare `setSelection` will be caught by the stand-in in
   jsdom — that is the point of it.

## Eliminated hypotheses (debugging record)

- "The tab freeze and the B1 snap-back are the same bug" — NO: the freeze was the
  same-value guard missing (fresh object per unchanged value → render loop); B1 is a
  CROSS-value overwrite. Same listener, different failure. The guard fixes only the
  first; pairing fixes the second. Do not merge the two concepts.
- "Mock the listener by re-emitting the mock's own interaction-selection state" —
  NO: that store model never sees the page's re-stamps, so the FIXED code would still
  snap back in jsdom (the fix would be unverifiable). Store truth must be the FLAGS.
- "Keep `interactionSelection` state as the store" — NO: with flag-echo landing via
  real appliers, it is redundant and diverges (it survived adoption points the real
  store would not). Removed; the delete-key button reads flags, refused nodes stay
  flagged (matches real RF).
- "Also stabilize the callback with useCallback" — rejected, see decision 1.
- Pre-existing `pnpm run typecheck` failures in ConsultationBindingEditor.tsx /
  IssuesDrawer.tsx / v2-node-panel-consultation.test.tsx are NOT from this round
  (zero errors in the four touched files; the failing files are untouched and
  reference long-standing type shapes). Left alone — out of scope.

## Environment notes for reruns

- Full suite ~2 min; gate command exactly `pnpm --dir packages/ui exec vitest run`
  from repo root. Never pipe the gate through `tail` (exit-code trap).
- Mutation experiments on the fix: edit, run `-t B1` / `-t M1` filtered, REVERT, then
  re-run the FULL suite before reporting — a leftover marker would ship a broken page
  with green focused runs (checked: `grep -rn MUTATION- packages/ui` clean).

## Next action

Re-review round 2 (LEAD routes; reads `evidence/fix-round-1.md` + the working-tree
diff). If it returns findings, the fixer resumes from THIS file plus the review
report; if clean, ship commits with the pathspecs listed in implementer-1's handoff.
