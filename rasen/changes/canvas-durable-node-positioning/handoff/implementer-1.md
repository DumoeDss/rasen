# Handoff — implementer-1, canvas-durable-node-positioning (apply, DONE)

## State at stand-down

- 16/16 apply tasks ticked (`rasen/changes/canvas-durable-node-positioning/tasks.md`).
- Working tree carries the implementation UNCOMMITTED (shipper's job), exactly
  4 tracked files (plus the change dir):
  - `packages/ui/src/canvas/layout.ts` — `AuthorPosition` type; `layoutGraph`
    gains the optional third param `authorPositions?: ReadonlyMap<string,
    AuthorPosition>` (after the dagre pass, a stage node whose id is cached
    renders at the cached position; nodes with a `parallelGroup` are excluded
    so the v1 parent-relative contract is structurally untouched); pure
    `pruneAuthorPositions(positions, presentStageIds)` returns a fresh Map
    keyed to exactly the given ids.
  - `packages/ui/src/canvas/PipelineCanvasPage.tsx` — `authorPositionsRef`
    (Map ref, doc-commented session-only); drag-final capture in
    `onNodesChange` (`type === 'position' && dragging === false && position`,
    guarded to `draft.version === 2`); `recomputeFlow` passes the cache for
    v2 and prunes to the rebuilt root node ids AFTER the selection-carry
    stamping (that code is byte-identical); `renameSelectedV2Node` carries
    the entry old-id → new-id BEFORE `recomputeFlow`; `enterEditWith` resets
    the cache first; `relayout()` clears it before recomputing.
  - Tests: `packages/ui/test/canvas/layout.test.ts` (+6) and
    `packages/ui/test/canvas/pipeline-canvas-page.test.tsx` (+8 in a new
    "durable node positioning" describe, plus the shared-mock extensions:
    `position` change type in `applyNodeChanges`, per-node
    `mock-node-drag` trigger emitting the drag-final change with a fixed
    +180/+120 displacement, and the `mock-node-position` positions dump).
- Suites (CI-canonical `pnpm --dir packages/ui exec vitest run`, never
  tail-piped): **67 files / 880 tests, exit 0, zero failures** (baseline
  67/866; +14). Two full runs (879 before the last test was added, 880
  final); logs kept at `.rasen/changes/canvas-durable-node-positioning/
  full-suite-run{,-2}.log` (run-state, never staged).
- Discrimination proven by three targeted mutations, each caught by exactly
  the intended test and reverted (grep for `MUTATION-PROBE`/`&& false` in
  src is clean): cache not passed to `layoutGraph` → scenarios 1/2/4 fail;
  prune disabled → departed-id scenario fails; `relayout` clear disabled →
  scenario 6 fails.
- Real browser (task 5.1): **ALL 11 CHECKS PASSED** on real React Flow drag
  physics. App port 9345 (`rasen ui --no-open --no-daemon`), CDP port 9346
  (both re-verified free before use — child 1 had released them; 9333-9344
  consumed). Throwaway Chrome 151 headless killed via its user-data-dir
  marker; profile dir removed; server stopped; ports released (TIME_WAIT
  only). Evidence: `evidence/cdp-transcript.md`, `cdp-results.json`, 5
  screenshots, rerunnable `cdp-durable-positioning-check.mjs`.
- Gates: `evidence/gates-6.md` — 6.1 counts (67/880), 6.2 IR-frozen asserts
  (porcelain + `git diff fb243e83 -- src/core/pipeline-registry/` empty,
  `V2_BODY_PALETTE_KINDS` still `['AtomicStage']` at draft.ts:750, zero
  `legacyRuntimeOwner`, `draft.ts` entirely untouched — no position write on
  any draft-mutation path; payload-clean pinned by the scenario-6 recursive
  walk of the `mutatePipeline` body), 6.3 full scenario-to-test/CDP
  traceability table.

## Decisions made during apply (successor must know)

1. **The layout oracle for page tests is the page's own geometry**: every
   "lays out afresh" assertion computes `layoutGraph(draftToGraph(<the
   definition the last Validate call submitted>))` with NO cache inside the
   test and compares against the mock's positions dump — exact equality
   without pinning dagre bytes. This is why the jsdom tests can assert
   "every non-dragged node at computed layout" even as the graph grows and
   dagre moves everything.
2. **Group members are excluded from the cache override in `layoutGraph`**
   (not just synthesized group nodes): a v1 `parallelGroup` member's rendered
   position is RELATIVE to its group's box, so an absolute cached placement
   applied there would land wrong; the cache is only ever populated in v2
   sessions anyway (capture guard), making the exclusion a structural
   guarantee of the v1-stays-unchanged boundary, not a behavior guess.
3. **The mock's drag trigger displaces by a fixed delta from the node's
   CURRENT rendered position** (real-drag semantics), and the positions dump
   (`mock-node-position` spans with `data-x`/`data-y`) is the single read
   seam. Later children testing drag interactions reuse the trigger; do not
   add another seam.
4. **The extra 8th page test** ("a fresh edit session starts from computed
   layout") pins the requirement's session-lifetime clause via drag →
   description-keystroke (a drag alone does NOT dirty the draft) → Discard →
   Edit again in the same page instance. Without `enterEditWith`'s reset the
   re-entered session would resurrect the placement.

## Eliminated hypotheses (the one debugging arc — CDP round 1, 8/11)

- **Symptom A**: the drag-check FAILED with the node at
  `translate(114.576px, -393.893px)` while the naive expectation
  (start + screenDelta/zoom) was ≈(130.6, -83.1) — the node moved FARTHER
  in y than the screen delta even after dividing by zoom.
- **Eliminated**: (a) the page mis-capturing the position (the transform was
  stable through every later rebuild — capture worked); (b) zoom being read
  wrong (1.68447 was consistent across both axes); (c) a product defect —
  PRODUCT was unchanged between runs.
- **Root cause**: React Flow's `autoPanOnNodeDrag` — the drag vector pointed
  UP toward the pane's top edge, and while the pointer held near the margin
  the viewport panned, adding to the node's flow-coordinate displacement.
  Fix in the DRIVER (not product): drag into the pane's interior
  (down-right) and assert direction (sign match both axes) + a real
  displacement (≥40 flow px) instead of an exact delta formula. Rule for
  future canvas CDP drivers: never assert exact drag landing coordinates
  unless the drag vector is provably clear of every pane edge; direction +
  displacement + post-drag byte-stability is the durable assertion set.
- **Symptom B**: `timeout waiting for: the fifth stage node
  (atomic-stage-5)`.
- **Root cause**: driver expectation, not product — the rename had released
  the base id, so `v2NodeIdFor('AtomicStage')` re-minted `atomic-stage`
  (exactly the freed-id reuse the invalidation rule describes). The fix
  waits for 5 nodes and reads whichever id appeared, and the run gained a
  free live verification of spec scenario 5 (re-added freed id lands on
  computed layout, not the departed placement).

## Durable notes / residue

- Known canvas Save persistence defect untouched; all CDP verification
  in-memory (never saved).
- Untracked residue NOT to stage: `.rasen/changes/canvas-durable-
  positioning/*` run-state (suite logs), sibling `.rasen/changes/*` mirrors,
  and the content-empty CRLF phantom `bin/rasen.js` (never commit it).
- Pre-existing `pnpm --dir packages/ui run typecheck` errors exist at HEAD
  in files this change never touched (ConsultationBindingEditor.tsx,
  IssuesDrawer.tsx, v2-node-panel-consultation.test.tsx, plus 2 in
  pipeline-canvas-page.test.tsx at ~line 7066) — verified present before my
  edits; my two files typecheck clean.

## Next action

Verify (rasen-verify-change): artifacts vs implementation,
`evidence/gates-6.md` + `evidence/cdp-transcript.md`. Then ship with a
narrow pathspec: the 4 tracked files + `rasen/changes/canvas-durable-
node-positioning/` (LF discipline; `git diff --check` clean on evidence;
never `git add -A`; exclude `signals/` dirs at archive time per the repo
trap).
