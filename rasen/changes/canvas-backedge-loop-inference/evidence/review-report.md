# Review report — canvas-backedge-loop-inference (verify stage)

- Reviewer: reviewer-1 (verified children 1-2 and their fix rounds; non-author for impl-4).
  Dispatched report-only mode: no fixes applied, no commits, no subagents, no working-tree edits.
- Date: 2026-08-17. Branch `feat/canvas-gesture-ir-compiler`, HEAD `8ad73cc9`; review target =
  uncommitted working-tree delta vs HEAD over `packages/ui/` plus untracked
  `packages/ui/src/canvas/V2LoopReviewPanel.tsx`.

## Verdict: FINDINGS — 0 Blocker, 0 Major, 0 Minor, 1 Trivial (ship-able without a fix round)

The region computation, decomposition, synthesis transaction, and interception are all correct,
with the load-bearing mechanics verified against the actual source rather than the claims.

## Independent test gate (mandatory)

- Command: `pnpm --dir packages/ui exec vitest run` from repo root, not piped.
- Result: **67 files / 814 tests, all passed, exit 0** — matches the claim exactly
  (baseline 67/795; +12 model, +7 component). Child-2's tests are pure additions away — the
  test diffs contain zero removed lines, so child-2's 21 model + 6 component tests ran unedited
  and green.
- Evidence sanity: `evidence/cdp-transcript.md`, `cdp-results.json`, the driver, and 7
  screenshots exist and are internally consistent (throwaway Chrome 151 headless on 9339, port
  choice explained, chunk-hash provenance, "tab is alive" listener check).

## Scope check: CLEAN

Intent: a refused cycle-closing draw opens a loop review; confirm extracts the region (child-2
machinery), synthesizes a BoundedLoop with the author's bound/exit, rewires crossings, selects
the loop; cancel reproduces today's refusal exactly; explicit paths untouched. Delivered:
exactly the expected touch set (`draft.ts` region + decomposition + synthesis;
`PipelineCanvasPage.tsx` onConnect interception + review handlers; `V2LoopReviewPanel.tsx`;
two test files). `DeclarationsPanel.tsx` and `PalettePanel.tsx` have zero diff lines. Frozen-IR
gates re-verified by this reviewer: `git status --porcelain` and `git diff 74568906/8ad73cc9
--stat` over `src/core/pipeline-registry/` all empty; `V2_BODY_PALETTE_KINDS` still
`['AtomicStage']` (draft.ts:736); `CUT_KEY_SEPARATOR` still `String.fromCharCode(0)` (draft.ts:2670,
no NUL literal anywhere in the file); `addBoundedLoopOverDeclaration` and the page's
`addRootGesture` loop branch untouched (the symbol's only diff appearance is a doc comment
inside the new function).

## Standards axis — claim-by-claim adversarial verification

- **`wouldCreateCycle` stays the single cycle owner.** `onConnect` still calls it first
  (`PipelineCanvasPage.tsx:784`); there is no second back-edge predicate — the interception is
  `wouldCreateCycle fired ∧ v2 ∧ both endpoints editable` → open review. The refusal string is
  built once (`refusal` const) and byte-identical to the pre-change template; the toast fires at
  DRAW time in every path, so cancel leaves exactly today's outcome (v1 and non-editable
  endpoints keep the plain refusal).
- **Region enumeration is correct — direction verified against the source.**
  `reachesThrough(adjacency, from, to)` answers "`to ⇝* from`" (draft.ts:269-285: DFS starts at
  `to`, follows forward adjacency, looks for `from`; `wouldCreateCycle(def, from, to)` at :305
  delegates to it — correct cycle semantics). Therefore `backedgeRegion`'s condition
  `reachesThrough(adj, node, to) && reachesThrough(adj, from, node)` is exactly the design's
  `to ⇝* n ∧ n ⇝* from` over the SAME `buildAdjacency` — the region cannot disagree with the
  rule that recognized the draw. Edge cases pinned by tests (draft.test.ts, new
  `backedgeRegion` describe): diamond with side branches excluded in BOTH directions (s
  downstream-only out; u upstream-only out) with the `wouldCreateCycle` precondition asserted;
  self-loop → exactly {node} (in an acyclic draft `to===from` admits only itself); endpoints-only
  on a v1 `requires` fixture (the shared-adjacency pin). A node reachable by two paths is
  counted once (Set). The source itself is always a member (seeded) regardless of other
  in-edges. Nested loops in the pre-synthesis draft cannot exist (drafts are acyclic by
  construction — cycles are refused at insert), so "nested" reduces to nested paths = the
  diamond case.
- **The back-edge never persists.** The drawn `Connection` is never written: `onConnect`'s
  refusal branch returns before any draft mutation, and the review state carries the endpoints
  as data only. `synthesizeBoundedLoopFromBackedge` moves only existing connections
  (region-internal into the body, crossings rewired). Pinned three ways: model test asserts
  every surviving root connection touches only externals and the loop; component POST-body test
  asserts no connection mentions the region nodes; CDP asserts `no back-edge edge exists` with
  the exact rewired id list.
- **Decomposition is faithful.** `extractSubgraphIntoDeclaration` (validate → declare → remove
  from root) and `rewireCrossingsOnto` (positional cut rewire, `replacementId`-parameterized)
  carry the same validation sequence and rewire logic as the old inline code; the pre-extraction
  def is correctly threaded for cut enumeration. `extractSubgraph`'s pre-minted `refId` is still
  `v2NodeIdFor('CompositeRef', declared)` against the same state `insertCompositeRef` mints
  against. Child-2's model tests pass unedited (zero removed test lines in the diff).
- **Synthesis mirrors the gesture with the author's knobs.** Loop node `toEqual`-pinned:
  `{ id, kind: 'BoundedLoop', body: declarationId, limits: { maxIterations: author's,
  maxActions: 12, budget: 12 }, lifecycle: createDefaultBoundedLoopLifecycle(), exits:
  last-reviewed-outcome exits to the author's exitOutcome, others continue }` — the gesture's
  convention with the two review knobs substituted. `loopId = v2NodeIdFor('BoundedLoop',
  declared)` is deterministic against the state `addV2Node` appends to. Bound validated
  (0/-1/2.5/NaN all throw /positive integer/). No CompositeRef is inserted (asserted).
- **Refusals reuse child-2's blockers verbatim** — same code path
  (`extractSubgraphIntoDeclaration` re-runs `subgraphExtractionRefusalsForNodeIds`), pinned by
  exact-string regexes for the kind and gate cases, and rendered in place of Confirm at the
  component layer (`v2-loop-review-confirm` is not rendered when refusals exist).
- **`legacyRuntimeOwner` dual-layer guards discriminate.** Model layer: `not.toHaveProperty`
  over every declaration body node and every root node (a stamp on the loop or a moved node
  fails). POST-body layer: the confirm test walks `submitted.root.nodes` +
  `submitted.declarations.flatMap(graph.nodes)` and asserts the same. Any stamp anywhere in the
  result fails the suite.
- **Selection pairing discipline (child-1 B1).** `confirmLoopReview` writes `setSelection([loopId])`
  + `recomputeFlow(result.next, catalog, nextSelection)` in one tick; the component test asserts
  `data-selected="true"` on the loop and its node panel open — with the SelectionListener
  stand-in live, an unpaired write would be reverted and fail.
- **Integer-bound discipline.** `IntegerContractField` under the `loop-review:maxIterations`
  scope; the scope is cleared on open, cancel, and confirm (no lingering block on Validate).
  Component test pins the full arc: invalid value → `aria-invalid` + error text + disabled
  confirm + page Validate blocked + click-on-disabled synthesizes nothing → repair unblocks and
  the repaired bound (4) lands in the POSTed definition.

## Spec axis — all seven scenarios pinned

1. "A drawn back-edge offers a loop" — component test 1 (review opens, endpoints/region/defaults,
   draft unchanged, refusal toast stands).
2. "Declining keeps the refusal outcome" — component test 2 (cancel: no declarations, chain
   intact, toast message).
3. "Confirming synthesizes the loop" — component test 3 + model tests (loop selected, region
   gone, externals rewired with exact ids, back-edge nowhere).
4. "The exit mapping follows the author's choice" — component test 4 (second definition outcome)
   + model default-to-`def.outcomes[0]` test + post-hoc patchability (model test 2.3).
5. "An unextractable region is refused with its blockers" — component test 5 (Choice in region:
   named blocker, no confirm rendered, cancel unchanged) + model verbatim-string tests.
6. "The explicit loop gesture still works" — component test 7 + CDP screenshot 07 + gates'
   zero-diff-line assertions on the gesture and insert action.
7. "Content survives the synthesis" — model verbatim (`toBe` on the moved node) + component
   POST-body (`execution.retainedExecutionNote`, `condition: 'always'` carried) + dual-layer
   no-`legacyRuntimeOwner`.

## m2 probe record — faithful

`evidence/cdp-transcript.md` Phase A records three geometry-verified rectangles, all failing
full membership: middle pair got `[3]` of `[2,3]`, singleton got `[]`, triple got `[3,4]` of
`[2,3,4]` — i.e. **3/3 reproduction, always the leftmost enclosed stage missed, singleton
selected zero**, exactly as summarized. Correctly routed to child 1 (canvas-multi-selection) as
a follow-up per the standing order and NOT fixed here — the back-edge flow demonstrably does
not lean on box-select (all Phase B checks passed without it). This upgrades my child-2 Minor
observation to a reproduced child-1 defect with a deterministic pattern (leftmost-only miss
suggests the drag start point interacts with the first enclosed node — likely the
drag-start-on-node / coordinate-transform class; worth that framing in child 1's fix).

## Findings

### t1 — TRIVIAL: model-side hardening gaps on the review inputs

- `synthesizeBoundedLoopFromBackedge` does not validate `exitOutcome` (blank or not a member of
  `def.outcomes` would mint `exits: { … { action: 'exit', outcome: '' } }`), and an empty
  reviewed `outcomes` list would pass `assertNamedOutcomes` and mint a loop with zero exits.
  Both are unreachable through the review UI (the exit select only offers `def.outcomes`; the
  definition contract editor keeps `def.outcomes` non-empty; and the empty-rows case is
  child-2's documented deleted-rows posture — Validate stays the authority). Hardening only;
  accept as known or fold into any later model touch.

## Counts

- Blocker: 0 · Major: 0 · Minor: 0 · Trivial: 1 (t1)
- Standards axis worst: t1 (Trivial). Spec axis: no failing items — all seven scenarios
  delivered and pinned.
- Test gate: 67 files / 814 tests, exit 0 — independently reproduced.
- Cross-change: child-1's box-select containment defect is now REPRODUCED (3/3) and routed;
  child-2's extraction tests untouched and green.
