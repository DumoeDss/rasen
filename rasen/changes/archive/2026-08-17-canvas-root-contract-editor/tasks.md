## 1. Model helper (design D4)

- [x] 1.1 Add `declareDefinitionOutcome(def, name)` in `packages/ui/src/canvas/draft.ts` beside `updateDefinitionContracts`: trim, refuse blank and duplicate names (refusals surfaced as thrown Errors from the existing rule family), append preserving order, return next definition; no other field touched. Gap it closes (cited): `updateDefinitionContracts` takes full arrays only, so an appending call site would re-implement the guard.
- [x] 1.2 Unit tests in `packages/ui/test/canvas/v2-authoring-model.test.ts`: appends to empty and non-empty lists; trims; blank refused; duplicate refused; order and all other definition fields preserved; refuses without mutating input.

## 2. Definition contract panel: outcomes list-field idiom (design D2)

- [x] 2.1 In `DefinitionContractPanel.tsx`, replace the per-keystroke outcomes input with the shared `NameListField` (commit on blur), keeping `data-testid="definition-outcomes"` and the `outcomes` focused-field key; inputs/artifacts rows and limits untouched.
- [x] 2.2 Update the direct-render component test (near `pipeline-canvas-page.test.tsx:3853`) and the page test that drives `definition-outcomes` with a bare input event (`:1276-1279`) to the focus/blur commit pattern the declaration-outcomes test uses (`:1309-1317`); assert an invalid commit (duplicate/blank) is refused, keeps the previous contract, and surfaces the diagnostic.

## 3. Loop review: live contract and inline declare (design D3, D5)

- [x] 3.1 In `PipelineCanvasPage.tsx`, render `V2LoopReviewPanel`'s `definitionOutcomes` from the live draft (`draft?.version === 2 ? [...draft.outcomes] : []`, matching the parallel review at `:2764`) and drop the `definitionOutcomes` snapshot from the `loopReview` state object minted at `:1363`.
- [x] 3.2 In `V2LoopReviewPanel.tsx`, add the inline declare affordance, rendered only while `definitionOutcomes` is empty: name input plus confirm that invokes a new thin `onDeclareOutcome(name)` callback; the panel keeps no model logic. Component tests: affordance hidden when outcomes exist; confirm invokes the callback with the trimmed name; review stays open and its other local edits are intact after the callback fires.
- [x] 3.3 Page wiring: `onDeclareOutcome` performs one `declareDefinitionOutcome` transaction (`setDraft` + `recomputeFlow` + `markDraftChanged`), leaves the review open, and toasts the refusal without touching the draft on error. Page test: declare while the review is open; the exit-outcome select then offers the new outcome (the live-read proof).

## 4. Sink endpoint offer: locate instead of dead end (design D3, D6)

- [x] 4.1 In `V2NodePanel.tsx` `SinkPromotionSection`, when the outcomes list is empty render the empty state: text stating no outcomes are declared plus a locate action invoking a new `onLocateDefinitionOutcomes` callback; no inline write. Component test for both states (empty: locate action, no select/confirm dead end; non-empty: unchanged offer).
- [x] 4.2 Page wiring: the locate handler focuses the outcomes field (ref exposed by `DefinitionContractPanel` on its `NameListField` input) and calls `scrollIntoView` on the contract panel. Page test asserts `document.activeElement` is the outcomes field after the locate click (no layout claims in jsdom).

## 5. Acceptance scenario (pinned; spec scenario 1)

- [x] 5.1 jsdom page-level end-to-end test: start assembling a fresh pipeline (outcomes empty), add two AtomicStages from the catalog as unconnected sinks, run Validate with `client.validatePipeline` mocked to return the engine-shaped `PORT_MISMATCH` (path `/root/nodes/0/capability`, related path `/root/nodes/1/capability`, message naming terminal outcome `done`), then declare `done` through the definition contract panel (focus, type, blur) and re-run Validate with the mock returning clean; assert the issues drawer is gone, `draft.outcomes` equals `['done']`, and the graph (nodes and connections) is unchanged by the fix.

## 6. Real-browser CDP check (repo-trap protocol)

- [x] 6.1 Build `packages/ui`, serve with `node bin/rasen.js ui --no-open --no-daemon --port <fresh 9345+>`, drive a throwaway Chrome (`--window-size=1600,1000`, fresh `--user-data-dir`, direct CDP on the debug port): assemble a fresh pipeline, add two unconnected stages, press Validate and observe the real engine's `PORT_MISMATCH`, declare `done` in the definition contract panel (blur commit), press Validate again and observe the issue cleared with no other edit; also click the sink offer's locate action and observe the outcomes field focused and the contract panel on-screen. Save the transcript under `evidence/` (cdp root-cause style, with the port used).

## 7. Gates

- [x] 7.1 Full UI suite, CI-canonical: `pnpm --dir packages/ui exec vitest run` from a clean invocation, never piped through `tail`; cite file and test counts against the 67 files / 854 baseline (count must only grow); failures enumerated in full, Windows flake re-run in isolation before blaming the delta.
- [x] 7.2 IR-frozen assert: `git status --porcelain -- src/core/pipeline-registry/` is empty and `git diff fb243e83 -- src/core/pipeline-registry/` is empty; `V2_BODY_PALETTE_KINDS` still `['AtomicStage']`; no `legacyRuntimeOwner` anywhere in the diff.
- [x] 7.3 Traceability pass: every scenario in `specs/pipelines-ui/spec.md`'s ADDED requirement maps to at least one test or CDP step by name (list the mapping in the verify notes).
