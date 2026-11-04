# Review report — canvas-loop-port-inference (stage: verify)

Reviewer: reviewer3 (independent non-author; dispatched, report-only).
Target: uncommitted delta vs `f512e3ea` under `packages/ui/` (5 files, +478/-9).
Method: fresh read of the change artifacts + planning-context Child-1 digest,
full-diff review against the seam contract, source read of every touched
mechanism, independent `rasen validate` re-run, independent full UI suite run.

Scope check: CLEAN. The diff touches exactly the declared surface —
`draft.ts` (one new function + one call-site switch),
`PipelineCanvasPage.tsx` (one import, one type annotation, one call-site
switch, one doc comment), `V2LoopReviewPanel.tsx` (doc comments only,
disclosed in fix-round-1.md), and the two declared test files (pure
insertions; zero edits to round-one assertions). `bin/rasen.js` shows as
modified in the tree — the known CRLF phantom, task 5.3 already excludes it
from the commit pathspec (ship-stage reminder, not a delta defect).

## Verdict

**0 Blocker / 0 Major / 1 Minor / 1 Trivial.** Ship-able as amended.

Test gate (independent run, 2026-08-17): `pnpm --dir packages/ui exec
vitest run` → **68 files / 902 tests passed, exit 0** (baseline 68/894 + 8
new: 7 unit in `draft.test.ts`, 1 page in `pipeline-canvas-page.test.tsx`;
`draft.test.ts` went 117 → 124). No i18n-contention flake; no isolation
needed. `rasen validate canvas-loop-port-inference` → "valid" (re-run by
this reviewer, not trusted from the implementer's claim).

## Gate-by-gate

### 1. Seam discipline — PASS

- Exactly TWO behavioral switch points, verified by grepping every call
  site in `packages/ui/src/`: `openLoopReview`
  (`packages/ui/src/canvas/PipelineCanvasPage.tsx:1408`) and
  `synthesizeBoundedLoopFromBackedge`'s re-derivation
  (`packages/ui/src/canvas/draft.ts:3162`). The only other references are
  the definition itself (`draft.ts:2877`) and its internal base call
  (`draft.ts:2883`).
- `deriveSubgraphContract` (`draft.ts:2819`), `computeSubgraphCut`
  (`draft.ts:2773`), and `rewireCrossingsOnto` (`draft.ts:3025`) have ZERO
  diff hunks. The extract path still calls the base directly at
  `draft.ts:2943` (`extractSubgraph`) and
  `PipelineCanvasPage.tsx:1337` (extract review) — the fallback is
  structurally invisible there; the new function's doc comment records the
  non-goal (`draft.ts:2874-2875`).
- The confirm path (`confirmLoopReview`, `PipelineCanvasPage.tsx:1450-1454`)
  spreads the panel's reviewed rows over `{from, to}`; the model re-derives
  independently inside the transaction. One rule, one home, no drift
  surface.

### 2. Byte-preservation — PASS (discrimination judged, see note)

Structural argument verified in source: `rewireCrossingsOnto`
(`draft.ts:3039-3063`) indexes ONLY into the cut's real key lists, and a
crossing connection exists only when its side's key list is non-empty — so
whenever rewire consults `derived`, that side passed through verbatim and
the fallback never entered its index space. A fallback row can never shift
a positional rewire index.

Test discrimination: the task-3.4 deep-equal pin
(`draft.test.ts:2100-2108`) is RELATIONAL — alone it would be blind to a
uniform mutation of the shared base (both sides of the equality would move
together; same class as the known relative-assertion blindness). It does
NOT stand alone here: the unchanged round-one tests pin ABSOLUTE outputs of
the severed path (`draft.test.ts:1696` declaration+loop synthesis,
`:1747` rewire with extension fields preserved), and the new standalone /
mixed tests pin absolute expected rows. Compose-transparency + absolute
anchors = adequate discrimination.

The subtle implementation choice is correct and TESTED: the fallback tests
the CUT's key lists, not the materialized rows
(`draft.ts:2884-2891`) — necessary because the base materializes an empty
outcome side as `['done']` (`draft.ts:2839`). Mixed test "incoming severed"
(`draft.test.ts:2019-2051`) discriminates exactly this: base outcomes are
`['done']` (non-empty) yet the fallback still fires → proves keys are
tested, not rows. A rows-based regression would fail this test.

### 3. Amended spec honesty — PASS (the round-2 M1 lesson applied)

- Entry-port landing claim: engine-true — browser evidence records the
  landed edge `atomic-stage:done->bounded-loop:atomic-stage`; page test
  pins `external:done->bounded-loop:review` plus the declaration rows and
  `exits` map (`pipeline-canvas-page.test.tsx:6627-6651`).
- Author-alignment green claim: engine-true — variant V5 (0 errors,
  `valid: true`) AND driven end-to-end through the real UI
  (`author-edits-to-green.mjs`, `0 errors` after the three authored edits).
- Deferral bullet: true — unedited defaults measurably carry 6 errors (V1,
  three pre-existing classes, all shared with the round-one severed path,
  none introduced by this delta), and the named sibling
  `rasen/changes/canvas-loop-validate-clean-synthesis/` EXISTS (verified on
  disk), so the reference is not a promise of hypothetical work.
- Format: zero em-dashes in the delta (grepped), SHALL on line one of the
  requirement prose (`specs/pipelines-ui/spec.md:5`), ADDED-only.
- `rasen validate` green — re-run by this reviewer.

### 4. Naming soundness — PASS

- Unique-root/unique-sink argument holds: `backedgeRegion`
  (`draft.ts:340-359`) returns nodes on `to ⇝* n ∧ n ⇝* from` paths over the
  same adjacency `wouldCreateCycle` uses; an internal edge `m → to` would
  imply the pre-existing cycle `to ⇝* m ⇝* to` in an acyclic draft.
  Self-loop documented and handled (`draft.ts:336-338`, region = the one
  node); unit test pins both rows naming the stage
  (`draft.test.ts:1984-2017`).
- Fallback fires only on an empty side (`draft.ts:2886-2891`), so the
  unsuffixed name cannot collide (severed rows suffix on collision;
  inputs/outcomes are separate namespaces).
- The cited rename reconciliation EXISTS and is covered by a pre-existing
  test: `updateDeclaration` rebuilds every referencing loop's exits
  (`draft.ts:2259-2277`, `reconcileBoundedLoopExits`) — pinned at
  `v2-authoring-model.test.ts:546-573` including the unrelated-loop
  untouched case. The spec scenario's "rename keeps exit mapping
  consistent" clause rests on tested behavior.

### 5. Test quality — PASS (one Minor, below)

The acceptance path is pinned end-to-end at the page level: near-empty
canvas → refused back-edge → review opens on the fallback rows (values
asserted: `review` / `fix`) → confirm → BOTH handles asserted from the
declaration contract (`data-input-ports` `[{'review','input'}]`,
`data-output-ports` `[{'fix','outcome/fix'}]`) → connect-after onto the
entry handle → submitted definition shape (nodes, the landed connection,
declaration rows, exits) → Validate badge. Mixed severed/fallback covered
BOTH directions at unit level, including the mixed-region rewire
(`bounded-loop:fix->finish:input`, `draft.test.ts:2085-2098`). The
author-align leg is covered by browser evidence, not the page test — see
Minor 1.

### 6. Independent test gate — PASS

68 files / 902 tests, exit 0 (cited above; single clean run, no retry).

### 7. Invariants — PASS

- `git status --porcelain -- src/core/pipeline-registry/` → empty (IR
  frozen).
- `V2_BODY_PALETTE_KINDS` still `['AtomicStage']` (`draft.ts:750`, no
  diff hunk).
- No `legacyRuntimeOwner` anywhere in the diff (grepped).
- Selection pairing preserved: `confirmLoopReview` keeps the same-tick
  selection/recomputeFlow override (`PipelineCanvasPage.tsx:1464-1470`,
  unchanged); round-one tests still green.

### 8. Evidence faithfulness — PASS

`browser-gate.md` matches what the code does: the fallback-row values, the
handle ids, the landed connection id, the V1→V5 variant table (V1 6 → V2 2
→ V3 1 → V5 0), the honest machine-warning caveat, and — verified by this
reviewer — the disclosure that the page test's "No issues" badge runs
against the mocked `client.validatePipeline` (it does;
`pipeline-canvas-page.test.tsx:3483`). `fix-round-1.md` faithfully records
the LEAD's deviation decision and the sibling's starting points.

## Findings

### Minor 1 — Validate-clean acceptance leg has no CI-visible anchor

`packages/ui/test/canvas/pipeline-canvas-page.test.tsx:6653-6657` asserts
the "No issues" badge against the MOCKED `client.validatePipeline`
response, so the assertion has zero discrimination over the posted
definition; the spec scenario's engine-truth claim ("Validate reports zero
errors for the loop graph" after author alignment) is pinned ONLY by the
browser gate's `author-edits-to-green.mjs` run and variant replayers —
ephemera not re-runnable in CI. Failure scenario: a future refactor (e.g.
the sibling change mishandling `updateDeclaration` reconciliation, or a
regression in the alignment affordances) makes the green path unreachable
again and every CI suite stays green. The split is disclosed in
`browser-gate.md`, follows the file's established idiom, and was accepted
in the LEAD's fix-round-1 decision; the durable home for the fix is
`canvas-loop-validate-clean-synthesis` (whose defaults, once engine-clean,
make an unedited-defaults CI pin meaningful). Recorded as accepted-known,
not a blocker.

### Trivial 1 — variant table skips V4 with no note

`evidence/browser-gate.md:67-72` lists V1, V2, V3, V5. No recorded row is
false (each was replayed through the real validation endpoint), but the
absent V4 is unexplained; a driver-iteration note would preempt confusion
for the sibling change's author.

## Notes (verified-sound, no action)

- `deriveBackedgeLoopContract` recomputes `computeSubgraphCut` a second
  time (it already ran inside `deriveSubgraphContract`) — a pure O(edges)
  recompute that buys the correct emptiness test; the trade-off is
  documented in the function's doc comment (`draft.ts:2870-2872`).
- The page test's mock button `mock-connect-loop-entry`
  (`pipeline-canvas-page.test.tsx:354-387`) is disabled until both handles
  render — so the connect-after assertion would fail if the fallback rows
  stopped reaching the node's port descriptors. Good coupling for an
  acceptance pin.
- The requirement's "SHALL not change what the loop offers" reads as
  capability (entry + exit exist in either authoring order), coherent with
  the severed-precedence scenario that explicitly keeps different NAMES on
  severed sides. Not an overclaim.

## Coverage summary (Step 4.75, diff-scoped)

New code paths: `deriveBackedgeLoopContract` (4 branches: severed/severed,
empty/empty, severed-in/empty-out, empty-in/severed-out) — all 4 unit
tested with absolute expected outputs, plus the self-loop degenerate case.
The two call-site switches are covered at page level (review-open values)
and unit level (confirm transaction, mixed rewire). User flows:
standalone-cycle acceptance (page test, real browser), author-rename
override (unit), post-hoc rename (pre-existing reconciliation test).
Gaps: the author-align→Validate-clean engine flow (Minor 1). No E2E/EVAL
marks — UI-only change, engine truth delegated to the endpoint-backed
browser gate by design.
