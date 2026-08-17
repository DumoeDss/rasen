# Review report — canvas-sink-finish-inference (verify stage)

- Reviewer: reviewer-1 (verified children 1-4 and their fix rounds; non-author for impl-7).
  Dispatched report-only mode: no fixes applied, no commits, no subagents, no working-tree edits.
- Date: 2026-08-17. Branch `feat/canvas-gesture-ir-compiler`, HEAD `f66666d9`; review target =
  uncommitted working-tree delta vs HEAD over `packages/ui/` (no untracked files — the
  affordance extends the existing `V2NodePanel`, consistent with the proposal).

## Verdict: CLEAN — 0 Blocker, 0 Major, 0 Minor, 0 Trivial

## Independent test gate (mandatory)

- Command: `pnpm --dir packages/ui exec vitest run` from repo root, not piped.
- Result: **67 files / 854 tests, all passed, exit 0** — matches the claim exactly
  (baseline 67/839; +12 model, +3 component).
- `rasen validate canvas-sink-finish-inference` re-run by this reviewer → **valid**.
- Evidence sanity: `evidence/cdp-transcript.md` (26 PASS bullets, ALL CHECKS PASSED),
  `cdp-results.json`, the driver, and 8 screenshots exist and are internally consistent
  (throwaway Chrome headless, app 9342 / CDP 9344 with the busy-port census explained,
  `--window-size=1600,1000`, chunk-hash provenance, tab-alive check).

## Scope check: CLEAN

Exactly the claimed shape: **779 insertions / 0 deletions across exactly 5 files** (verified by
`git diff f66666d9 --stat`): `draft.ts` (+94, a single end-of-file append after
`synthesizeParallelFrontier`), `V2NodePanel.tsx` (+75, one optional prop group + a presentational
`SinkPromotionSection`), `PipelineCanvasPage.tsx` (+59: imports, one memo, one handler, one prop
pass), and the two test files. IR frozen re-verified against BOTH bases
(`git status --porcelain` empty; `git diff 74568906` and `git diff f66666d9` over
`src/core/pipeline-registry/` both empty); `V2_BODY_PALETTE_KINDS` untouched at draft.ts:736;
`addFinishNode` (draft.ts:901-905) and the palette gesture path untouched (additive-only diff;
behaviorally re-proven in jsdom and the browser per gates-4-2.md).

## Adversarial gates

### 1. Promotability rules — sound against the IR grammar

`PROMOTABLE_SINK_KINDS = {AtomicStage, Join}` (draft.ts, sink-promotion section): exactly the
two kinds whose terminal wiring the authored surface already draws — a stage's control-out and a
barrier's outcome-valued output are handles the renderer paints, so the promotion's edge lands on
a real handle. The exclusions are reasoned, not arbitrary: loop/composite-reference ends have
contract-named output ports needing per-kind resolution (deferred, documented as the gesture's
territory); gates and choice points are branch structures; a FanOut cannot sink alone by
construction (its pair's collector is the Join). The barrier case is APPENDS-never-converts:
`promoteSinkToFinish` adds a Finish downstream and the model test asserts the barrier remains a
`Join` with its semantics intact — a Join's `outcomes` are barrier semantics `{proceed, failed}`
(`types.ts:1460`), so conversion would be a category error; appending is the only sound shape.
`isPromotableSink` scopes to the ROOT graph (body-graph sinks are child-2's declaration-contract
territory — pinned by a truth-table case) and its out-edge scan rides `buildAdjacency`, the same
root-connection enumeration the cycle check and frontier detector read.

### 2. Barrier port wiring — citation verified

`layout.ts`'s Join output mapping (~:256-268, read directly): `Object.values(record.outcomes)`
become handles with `id: <value>` — the barrier's rendered outputs are the outcomes' VALUES, so
`sourcePort = node.outcomes.proceed` lands on the rendered handle (the same bare-value
convention children 2-4 used). The model test pins the exact id
(`barrier:shipped->finish:input`); the browser asserts `join:done->finish:input` in the edge
list.

### 3. `promoteSinkToFinish` — gesture-shaped, picked outcome, untouched sink

Re-validates node existence, sink-ness (stale refusal), and outcome non-blank + membership in
`def.outcomes` (exact refusal strings pinned, including the trimmed-blank case). The appended
node is `toEqual`-pinned in-test against the LIVE `addFinishNode(def)` output with only the
outcome replaced — if the gesture's shape ever changes, the pin follows it rather than drifting.
The finish id is pre-minted via `v2NodeIdFor('Finish', def)` and appended by `addV2Node` with
that exact id (non-colliding `finish-2` case pinned). The sink object survives by reference
(`toBe`) — content preservation by construction. The Finish is selected through the
`setSelection` + `recomputeFlow` override pairing (both truths in one tick; component test
asserts `data-selected` with the listener stand-in live). Nothing stamps
`legacyRuntimeOwner`: dual-layer guards (model walk + POST-body walk in the component test)
discriminate.

### 4. Pull affordance — render-bound, no stale-closure class

The section renders only when the page passes the prop group; `selectedV2SinkOutcomes` is the
ONE `isPromotableSink` consultation (a memo over `[draft, selectedV2Node]`). `onPromote` is an
arrow created at render closing over the current `selectedV2Node` and `draft` — invoked
synchronously from the panel button, so it is render-bound (unlike child-4's toast action, it
cannot outlive its render); the model's confirm-time re-validation is the belt-and-suspenders
for any torn state (a sink wired while the panel was open refuses cleanly — pinned by the
stale-non-sink model test). Non-promotable sinks (wired node, loop end) get no section (component
test) and the explicit gesture still covers them — no capability hole (pinned in jsdom and the
browser: the gesture's Finish stays unwired with the first-outcome default, exactly
`addFinishNode`).

### 5. Test quality — all seven spec scenarios pinned; the composition is real

Scenario mapping: terminal-stage offer (component 1), wired-node-nothing (component 1),
confirm-appends-named-Finish + selected + settings unchanged (component 2 POST-body), barrier
promoted never converted (model + browser), other-kinds-explicit-path (component 1 loop-end case
+ model truth table), promoted-Finish editable (model `updateV2NodeFields`), content survives
(model `toBe` + POST-body). Revert-discrimination: the truth table, exact wiring ids,
toEqual-against-gesture, refusal strings, and POST-body walk each fail under their targeted
regressions analytically.

**The compose scenario pins composition, not sequence.** The browser transcript walks
child-5 → child-4 → child-1 → child-5: the frontier offer fires over the already-promoted
Finish ("children compose"), the synthesis wires `join→finish` onto child-5's node, deleting
the Finish (child-1 delete semantics) drops the `join→finish` edge with it, the barrier's
sink-ness EMERGES from that deletion, and its promotion wires `join→finish` on the proceed-VALUE
port — with the exact edge list asserted at every boundary. Each link is additionally pinned
individually in jsdom; the full chain being browser-only is appropriate (it is the portfolio's
cross-child story, and the driver is rerunnable). Observation, not a gap.

Regression lens children 1-4: the diff is purely additive (0 deletions); no existing behavior,
handler, or panel path is modified; the full suite including every prior child's tests is green.

## Spec axis

The delta is ADDED-only ("The canvas names a sink's outcome", 7 scenarios), contains zero
em-dashes (verified by grep — the delta-parser truncation rule), and every scenario is
implemented and pinned as mapped above. Delivered exactly per proposal and tasks (8/8).

## Counts

- Blocker: 0 · Major: 0 · Minor: 0 · Trivial: 0
- Standards axis worst: none. Spec axis: no failing items.
- Test gate: 67 files / 854 tests, exit 0 — independently reproduced. `rasen validate` — valid
  (re-run). IR frozen vs both bases; `V2_BODY_PALETTE_KINDS` unchanged.
