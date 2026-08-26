# Tasks: canvas-loop-validate-clean-synthesis

## 1. Model groundwork (draft.ts)

- [x] 1.1 Add the control-port type constant to draft.ts (`CONTROL_PORT_TYPE = 'ecp/control'`), doc comment citing the engine's `definition.ts:2749` (`CONTROL_PORT_TYPE`) and the declaration-row rule (`contractForNode` reads `portMap(declaration.inputs)` with no control widening).
- [x] 1.2 Add the pure producible-outcome helper (working name `bodyTerminalOutcomes(def, region, catalog)`): per region node (AtomicStage by the refusals), resolve the capability in `catalog.skills` by `(id, version)`; take its `outcomes`, REPLACED by the engine's loop-phase projection when the node carries `reviewCyclePhase`/`goalCyclePhase` (review→`findings`, triage→`ready`, fix→`fixed`, re-review→`clean`+`needs_fix`, goal work→`ready`, goal judge→`clean`+`needs_fix`; mirror of `loopPhaseOutcomeNames`, definition.ts:2777); consume `(from.node, from.port)` for every INTERNAL region connection whose `from.port` is in that node's outcome set; return distinct names in body-node order. A capability not found in the catalog contributes nothing and is reported by 1.3.
- [x] 1.3 Add the catalog-gap probe (working name `underivableBodyStages(def, region, catalog)`): returns the stage ids whose capability is missing from the catalog — consumed by the review-open refusal list and re-checked at confirm.

## 2. Model: derivation, synthesis, shared mint layer (draft.ts)

- [x] 2.1 `deriveBackedgeLoopContract` gains a `catalog` parameter: input rows re-typed `CONTROL_PORT_TYPE` (severed and fallback rows alike; NAMES unchanged — boundary convention intact), `outcomes` become `bodyTerminalOutcomes(...)` on every side (supersedes child-1's `[from]` fallback and the severed stage-id names; update the doc comment to name the supersession and the engine's exact-cover rule). `deriveSubgraphContract` itself stays byte-identical (extract path untouched).
- [x] 2.2 `rewireCrossingsOnto` gains an OPTIONAL outgoing-port override: when present, every outgoing crossing rewires `from: { node: replacementId, port: override }`; the extract path passes nothing and keeps the positional row mapping byte-identically.
- [x] 2.3 `synthesizeBoundedLoopFromBackedge` gains a `catalog` parameter: re-derive fallback rows via the new derivation; REFUSE with a named message when `input.exitOutcome` is not in `def.outcomes`; pass the exit outcome as the outgoing-port override (engine rule: a BoundedLoop's output ports are its exit-action outcome values).
- [x] 2.4 Add `ensureLoopExitOutcomesDeclared(def, loopNode)`: for every exit-action outcome value in the minted loop's `exits` and `lifecycle.exits` missing from `def.outcomes`, append via `declareDefinitionOutcome` (the single rule site; no local append). Call it from BOTH `synthesizeBoundedLoopFromBackedge` and `addBoundedLoopOverDeclaration` (palette gesture covered by the shared mint layer).
- [x] 2.5 IR freeze assertion after each edit session: `git status --porcelain -- src/core/pipeline-registry/` prints nothing.

## 3. Page and review panel

- [x] 3.1 `PipelineCanvasPage.tsx` `openLoopReview`: pass the catalog to the derivation; append `underivableBodyStages` refusals (naming the stage) to the review's refusal list so confirm is blocked; `confirmLoopReview` passes the catalog through. No new decision surface in the page.
- [x] 3.2 `V2LoopReviewPanel.tsx`: one muted line listing the outcome names confirming will declare (from the exit mapping + default lifecycle, minus already-declared ones), rendered only when non-empty. Presentational only.

## 4. Unit tests (packages/ui/test/canvas/draft.test.ts)

- [x] 4.1 `bodyTerminalOutcomes` coverage: an internally consumed outcome is excluded; a two-sink body unions both sinks' outcomes; a phase-tagged stage projects to the engine's phase outcome names; duplicate names deduplicate keeping body-node order; a catalog-missing capability is reported by the probe.
- [x] 4.2 Standalone-cycle zero-edit shape: derived inputs = `[{ name: <to>, type: 'ecp/control' }]`, outcomes = the body's producible names (typical capability: `['done']`); the synthesized declaration carries them; the loop's exits cover every outcome with the last exiting to the chosen exit outcome; `def.outcomes` gained `iteration-limit`; no `legacyRuntimeOwner` anywhere.
- [x] 4.3 Deliberate-supersession updates: rewrite the round-one externals-first pins and child-1's deep-equal pin to the new truth (outcome rows = producible names; outgoing rewire source port = the exit outcome; input row types = `ecp/control`), each with a comment naming this change as the deliberate supersession. Assert what STAYS identical: region, refusals, input row names, incoming positional rewire, body content preservation.
- [x] 4.4 Model refusal coverage: confirm with an exit outcome the definition does not declare throws naming the outcome; confirm over a catalog-gap region throws naming the stage (review is not trusted).
- [x] 4.5 Palette gesture: `addBoundedLoopOverDeclaration` declares the lifecycle's exit outcome when absent (`iteration-limit`; plus `def.outcomes[0] ?? 'done'` when the definition declared nothing) and leaves an already-declaring definition unchanged.
- [x] 4.6 Self-loop and mixed-side re-pins under the new rules (entry naming per side; outcomes always producible).

## 5. Page test (packages/ui/test/pipeline-canvas-page.test.tsx)

- [x] 5.1 Zero-edit acceptance flow: empty canvas, two stages wired into a cycle, review opens (control-typed entry row default, producible outcome rows, the declare-notice line), inline-declare the exit outcome, confirm, connect an external stage onto the entry handle and the loop onward, Validate asserts zero loop errors following the file's existing validation-assertion pattern.

## 6. Gates

- [x] 6.1 Full UI suite via `pnpm --dir packages/ui exec vitest run` (CI-canonical; never pipe through tail): cite file/test counts against the baseline 68 files / 902; isolate-and-rerun any Windows timeout flake before blaming the delta.
- [x] 6.2 Real-browser gate on a fresh port (9349+, `--window-size=1600,1000`, fresh user-data-dir, build packages/ui first, serve root dist; direct CDP): reuse child-1's drivers (`.rasen/changes/canvas-loop-port-inference/ephemera/author-edits-to-green.mjs` minus the three edits, and `validate-variants.mjs`) — empty canvas → cycle → confirm (with only the review's own inline declare for the exit outcome) → connect externals → Validate `valid: true` with ZERO contract edits; then the palette gesture over a well-formed declaration body validates clean. Assert on error counts / `valid`, never on "no issues at all" (the machine's unrelated workflow-profile warning).
- [x] 6.3 Constraint sweep before commit: empty diff under `src/core/pipeline-registry/`; extract path untouched (`git diff -- packages/ui/src/canvas/draft.ts` reviewed for `deriveSubgraphContract`/`computeSubgraphCut` byte-identity); `V2_BODY_PALETTE_KINDS` unchanged; no `legacyRuntimeOwner` in the diff; narrow pathspec commit (change dir + touched files only; no ephemera, no `bin/rasen.js` CRLF phantom).
