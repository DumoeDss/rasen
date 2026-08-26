# Review report — canvas-subgraph-extraction (verify stage)

- Reviewer: reviewer-1 (verified child 1 and its fix round; non-author for child 2's implementer).
  Dispatched report-only mode: no fixes applied, no commits, no subagents, no working-tree edits.
- Date: 2026-08-17. Branch `feat/canvas-gesture-ir-compiler`, HEAD `5973d2ea` (child-1 archive on
  ship `115857a0`); review target = uncommitted working-tree delta vs HEAD over `packages/ui/`
  plus untracked `packages/ui/src/canvas/V2ExtractReviewPanel.tsx`.

## Verdict: FINDINGS — 0 Blocker, 0 Major, 2 Minor, 1 Trivial (ship-able; Minors recorded as accepted-known or routable)

The extraction model, review flow, and tests are correct and thorough. The cut/port derivation,
refusal completeness, verbatim preservation, rewiring, and the never-stamp-`legacyRuntimeOwner`
discipline all check out against the grammar facts (verified independently — citations below).
The two Minors are a rare UI duplicate-key render issue and a cross-child observation from the
real-browser evidence, neither blocking.

## Independent test gate (mandatory)

- Command: `pnpm --dir packages/ui exec vitest run` from repo root, not piped.
- Result: **67 files / 794 tests, all passed, exit 0** — matches the claim exactly
  (baseline 67/768, +26: `draft.test.ts` 55→76, `pipeline-canvas-page.test.tsx` 93→98).
- Evidence sanity: `evidence/cdp-transcript.md`, `cdp-results.json`, the driver, and 6 screenshots
  exist and are internally consistent (throwaway Chrome on 9338, port choice explained; chunk-hash
  provenance; "tab is alive" listener check present).

## Scope check: CLEAN

Intent: box-select → package into Custom Composite with review step, model-owned refusals,
verbatim preservation, rewires. Delivered: exactly the expected touch set — `draft.ts` (+350:
`subgraphExtractionRefusals` / `deriveSubgraphContract` / `extractSubgraph` beside
`insertCompositeRef`), `PipelineCanvasPage.tsx` (+123: action wiring + review flow),
`V2SelectionPanel.tsx` (optional `onPackage`/`packageRefusals`, presentational — listed in the
proposal's Impact, so no drift), `DeclarationsPanel.tsx` (12 lines: doc comments + two `export`
keywords on `NameListField`/`PortListEditor`; insert-action markup byte-identical),
`V2ExtractReviewPanel.tsx` (new), tests. Frozen-IR gates re-verified by this reviewer:
`git diff 74568906 --stat -- src/core/pipeline-registry/` empty AND `git diff 5973d2ea --stat`
empty; `draft.ts:704` still `['AtomicStage']`; no `legacyRuntimeOwner` writes anywhere in the delta.

## Standards axis — verified correct (with code citations)

- **RefId pre-mint is sound.** `extractSubgraph` mints `v2NodeIdFor('CompositeRef', next)`
  (`draft.ts`, extraction section) and then calls `insertCompositeRef(next, …)`, which mints
  `v2NodeIdFor('CompositeRef', def)` against the same `def` state (`draft.ts:891`) — deterministic
  minter, same input → the returned `refId` is the appended ref. Pinned by
  `expect(result.refId).toBe('composite-ref')` (draft.test.ts).
- **Extension fields preserved structurally.** `addV2Connection` appends the passed object
  verbatim with only an id-dedupe guard (`draft.ts:1440-1458`); the rewire spreads
  `{ ...connection, id, to|from }`. Tested at model layer (`condition: 'always'` on the inbound
  rewire) and on the POSTed definition (component test).
- **Outcome ports are bare names — correct.** A ref's out-handles are rendered with
  `id: <outcome>` and `type: 'outcome/<name>'` (`layout.ts:121-124`) — the `outcome/` prefix is
  the handle TYPE, not the port id; rewiring with `from.port = <name>` matches the handle id and
  the `onConnect` convention. CDP evidence confirms the engine-side graph rendered and the second
  insert worked.
- **Refusal completeness.** All five families (kind, outside Gate, outside FanOut
  branches/members-id/hierarchicalPath, outside Join inputs/required/optional, consultation
  sourceStage) with BOTH id forms and the reverse hybrid via `referencedSelectedStage`
  (raw / prefix-stripped / prefixed). Rule 1 reads `V2_BODY_PALETTE_KINDS.includes` — the refusal
  vocabulary IS the palette constant; no drift. Unit tests cover each rule in isolation plus a
  fully-normalized `stage:`-prefixed fixture and the consultation reverse-hybrid; component tests
  cover all five as rendered refusal text with the draft unchanged.
- **Transaction atomicity.** All validation (refusals, blank/unique id, row rules) throws BEFORE
  any state is built; the rewire loop cannot throw (`addV2Connection` never throws; ids minted
  uniquely per step against the evolving `next`). Rewires cannot create cycles (they mirror
  existing edges through the replacement node). Deleted-row fallback to derived names is
  deliberate, documented, and tested — Validate stays the authority (design's stated posture).
- **Selection-write pairing discipline (child-1 B1) honored on the new path.**
  `confirmExtractReview` writes `setSelection([refId])` + `recomputeFlow(next, catalog,
  nextSelection)` in one tick; the component test asserts `data-selected="true"` on the ref and
  the node panel open — with child-1's SelectionListener mock stand-in live, an unpaired write
  would be reverted before those assertions and fail.
- **never-stamp-`legacyRuntimeOwner`, two layers, both discriminating.** Model layer:
  `not.toHaveProperty` over every declaration body node and every root node post-extraction
  (any stamp on the ref or a moved node fails). POST-body layer: the component test walks
  `submitted.root.nodes` + `submitted.declarations.flatMap(graph.nodes)` and asserts the same —
  the definition actually sent to the API is guarded.
- **Cross-child checks.** `CompositeRef` is in `V2_EDITABLE_NODE_KINDS` (`draft.ts:675+`), so a
  multi-selection containing a ref still multi-deletes cleanly through child-1's
  `removeV2Nodes`; issue-drawer navigation to a body node goes through the untouched
  declaration-editor branch; selection-survives-non-destructive-edits holds (extraction pairs its
  write as above); the v1 editor offers no package action and renders no refusal text (tested).

## Spec axis — all six scenarios pinned

1. "A selected pair becomes one reusable block" — model verbatim test (`toBe` identity on moved
   nodes) + component confirm test (root = upstream/finish/ref, rewired ids exact, ref selected).
2. "The review step edits the derived contract" — renamed outcome → rewired source port uses it
   (component + model reviewed-rows tests); artifact row exercised at model layer
   (`artifacts: [{ name: 'patch', ... }]` carried into the declaration) — see t1.
3. "Mixed or non-stage selections are refused" — kind case rendered as text, no button, draft
   unchanged.
4. "A stage under outside structural references is refused" — gate/fan-out/join/consultation
   cases rendered, draft unchanged.
5. "The extracted declaration stays reusable" — second `insertCompositeRef` (model) and the
   declarations-panel row insert adds `composite-ref-2` (component + CDP).
6. "Definition content survives the packaging" — execution/retained fields verbatim
   (`toBe` + `retainedExecutionNote` on the POSTed body), extension fields carried, two-layer
   no-`legacyRuntimeOwner` guard.

## Findings

### m1 — MINOR: duplicate React keys when two consultation bindings share a source stage

- Site: `packages/ui/src/canvas/V2SelectionPanel.tsx` (refusal list:
  `packageRefusals.map((refusal) => <p key={refusal} …>)`).
- Concrete failure scenario: a stage with two consultation bindings (e.g. two teacher skills on
  the same stage) yields byte-identical refusal strings — `subgraphExtractionRefusals` emits one
  per binding and the message does not name the binding (`draft.ts`:
  `Stage '<id>' is referenced by a consultation binding.`). Keyed-list rendering with duplicate
  keys produces a Preact warning and can drop one of the lines. UI-only, no data effect; a
  plausible-but-uncommon authoring shape. Fix: `key={`${index}-${refusal}`}` (or name the
  binding in the message).

### m2 — MINOR (cross-child observation, out of this delta's blast radius): box-select under-selection in the real-browser pass

- Evidence: `rasen/changes/canvas-subgraph-extraction/evidence/cdp-transcript.md` (steps line
  "the middle pair is the selection"): three consecutive Shift+drag box-select attempts whose
  rectangle the driver verified geometrically contained BOTH nodes selected only ONE
  (`attempt1/2/3=["atomic-stage-3"]`), worked around with Control+click augmentation. Child 1's
  own CDP run had box-select select exactly the enclosed pair first try.
- This is child-1 gesture territory (no child-2 code touches selection geometry), and the
  evidence is a single run — could be driver-geometry vs React Flow rect-intersection, or a real
  intermittent. Children 3-5 lean on box-select as the primary gesture: recommend a dedicated
  probe (repeat box-select N times in a throwaway browser, log selected sets) before child 3
  ships. Not a blocker for this change.

### t1 — TRIVIAL: artifact-row addition in the review dialog untested at component level

- The spec scenario "renames an outcome and adds an artifact row" is fully covered at the model
  layer (reviewed `artifacts` rows carried and asserted), and the dialog reuses the declarations
  editor's `PortListEditor` (tested there), but no component test clicks the extract dialog's
  artifact add-row. Coverage gap only; the shared component is the tested implementation.

## Counts

- Blocker: 0 · Major: 0 · Minor: 2 (m1, m2) · Trivial: 1 (t1)
- Standards axis worst: m1 (Minor). Spec axis: no failing items — all six scenarios delivered and pinned.
- Test gate: 67 files / 794 tests, exit 0 — independently reproduced.
