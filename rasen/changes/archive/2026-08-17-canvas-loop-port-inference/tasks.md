# Tasks: canvas-loop-port-inference

## 1. Model: back-edge contract derivation (draft.ts)

- [x] 1.1 Add exported pure `deriveBackedgeLoopContract(def, region, from, to): DerivedSubgraphContract` in `packages/ui/src/canvas/draft.ts` beside `deriveSubgraphContract`: compute the base via `deriveSubgraphContract(def, region)`, then per side — empty `inputs` becomes `[{ name: to, type: CONTROL_TARGET_PORT }]`, empty `outcomes` becomes `[from]`; a side with severed rows passes through verbatim. Doc comment records the boundary naming convention and the root/sink soundness argument (acyclic draft ⇒ `to` is the body's unique root, `from` its unique sink). Do NOT touch `deriveSubgraphContract`, `computeSubgraphCut`, or `rewireCrossingsOnto`.
- [x] 1.2 Switch `synthesizeBoundedLoopFromBackedge`'s internal re-derivation (the `deriveSubgraphContract(def, region)` call feeding `rewireCrossingsOnto`, draft.ts:3110) to `deriveBackedgeLoopContract`. Confirm by reading that fallback rows cannot shift positional rewire indices (they exist only when a side's severed key list is empty).
- [x] 1.3 IR freeze assertion after each edit session: `git status --porcelain -- src/core/pipeline-registry/` prints nothing.

## 2. Page wiring (PipelineCanvasPage.tsx)

- [x] 2.1 `openLoopReview` derives the review's opening contract via `deriveBackedgeLoopContract(draft, nodeIds, from, to)`; the `loopReview` state's `derived` type annotation (`ReturnType<typeof deriveSubgraphContract>` at PipelineCanvasPage.tsx:317) follows the new function. No change to `V2LoopReviewPanel` (its `derived` prop shape is identical) and none to `layout.ts`.

## 3. Unit tests (packages/ui/test/canvas/draft.test.ts)

- [x] 3.1 Standalone two-stage cycle: refused back-edge over a region with no external connections synthesizes a declaration with `inputs` exactly `[{ name: <to>, type: 'input' }]` and `outcomes` exactly `[<from>]`; the loop's `exits` maps the fallback outcome to the exit action resolving to the author's definition outcome.
- [x] 3.2 Single-node self-loop (`from === to`): both fallback rows name that stage (separate namespaces, no collision) and the body graph is the one node with no connections.
- [x] 3.3 Mixed sides, both directions: incoming severed + outgoing empty yields severed input rows plus the fallback outcome; outgoing severed + incoming empty yields the fallback input plus severed outcome rows.
- [x] 3.4 Regression pin: for an externals-first region (the round-one acceptance shape), `deriveBackedgeLoopContract` deep-equals `deriveSubgraphContract` output; every pre-existing loop synthesis test in the file passes UNCHANGED (no edits to round-one assertions).
- [x] 3.5 Review-edit override: confirming with an author-renamed fallback input/outcome uses the author's names in the declaration (the model honors reviewed rows over any derivation).

## 4. Page test (packages/ui/test/pipeline-canvas-page.test.tsx)

- [x] 4.1 Empty-canvas acceptance flow: two stages wired into a cycle, the loop review opens showing the fallback rows, confirm synthesizes the loop, the rendered flow node exposes the entry input handle and the exit outcome handle (port descriptors from the declaration contract), an external stage's connection onto the entry handle lands on the entry port, and Validate reports no issue for the wired graph.

## 5. Gates

- [x] 5.1 Full UI suite via `pnpm --dir packages/ui exec vitest run` (CI-canonical; never pipe through tail; background with bounded polling if long): cite file/test counts against the baseline 68 files / 894; any Windows timeout flake gets isolated and re-run before blaming the delta.
- [x] 5.2 Real-browser check (throwaway Chrome, fresh port 9349+, `--window-size=1600,1000`, fresh user-data-dir, direct CDP; `pnpm --dir packages/ui run build` first, then serve root dist): empty canvas → two stages wired into a cycle → confirm review → assert both handles present on the loop node → drag a connection from an external stage onto the entry handle → Validate passes. Also record in evidence what Validate reports for the intermediate state (entry handle present, nothing connected) as a fact, without changing engine or UI for it.
- [x] 5.3 Constraint sweep before commit: empty diff under `src/core/pipeline-registry/` vs `f512e3ea`; `V2_BODY_PALETTE_KINDS` still `['AtomicStage']`; no `legacyRuntimeOwner` anywhere in the diff; narrow pathspec commit (change dir + touched src/test files only; no ephemera, no `bin/rasen.js` CRLF phantom).
