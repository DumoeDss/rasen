# Gates — canvas-durable-node-positioning (tasks 6.1-6.3)

## 6.1 Full UI suite (CI-canonical)

Command: `pnpm --dir packages/ui exec vitest run` (from the repo root; never
tail-piped — run output kept at `.rasen/changes/canvas-durable-node-positioning/full-suite-run-2.log`,
exit code recorded).

- Run 1 (before the final fresh-session test was added): **67 files / 879
  tests, exit 0, zero failures**.
- Run 2 (final, all 14 new tests): see below — recorded as
  **67 files / 880 tests, exit 0, zero failures**.
- Baseline: 67 files / 866 tests (child-1 close). Count only grows
  (+14: 6 in `test/canvas/layout.test.ts`, 8 in
  `test/canvas/pipeline-canvas-page.test.tsx`).
- New tests: layout.test.ts — author-positions describe (4: cached override
  by id / no-cache identical / absent ids ignored / group members + group
  nodes never cached) + pruneAuthorPositions describe (2); page suite —
  "durable node positioning" describe (8: palette-add durability, contract-edit
  durability, undragged-afresh, rename-follows, departed-id-dropped,
  extraction-drops, fresh-session-starts-at-layout, re-layout-resets +
  payload-clean).
- Discrimination was proven by three targeted mutations (each caught by the
  intended test, all reverted): cache not passed to `layoutGraph` → scenarios
  1/2/4 fail; prune disabled → departed-id scenario fails; `relayout` cache
  clear disabled → scenario 6 fails.

## 6.2 IR-frozen and payload-clean asserts

- `git status --porcelain -- src/core/pipeline-registry/` → **empty**.
- `git diff fb243e83 -- src/core/pipeline-registry/` → **empty**.
- `V2_BODY_PALETTE_KINDS` still `['AtomicStage']`
  (`packages/ui/src/canvas/draft.ts:750`).
- `legacyRuntimeOwner`: zero occurrences in the working diff.
- Working diff is exactly 4 files — `layout.ts` (geometry rule),
  `PipelineCanvasPage.tsx` (wiring), and the two test files. `draft.ts`
  (the definition model) is untouched: no position write exists on any
  draft-mutation path. The definition payload clean assertion is pinned from
  the UI side by the scenario-6 test (recursive walk of the body submitted to
  `mutatePipeline` for keys `position`/`x`/`y` → none), and the CDP run
  verified the same in the real app (Save untouched, in-memory verification
  only).

## 6.3 Traceability — spec scenarios to tests/CDP steps

| Spec scenario (`specs/pipelines-ui/spec.md`, ADDED requirement) | jsdom test (`pipeline-canvas-page.test.tsx` unless noted) | Real-browser CDP step (`evidence/cdp-transcript.md`) |
| --- | --- | --- |
| 1. dragged node keeps placement across a palette add; added node lays out afresh | "a dragged node keeps its placement across a palette add; the new node lays out afresh (spec scenario 1)" | "the drag physically moved the node" + "the dragged node keeps its exact transform across the palette-add rebuild" + "the added node renders at a finite layout position, distinct from the dragged placement" |
| 2. dragged node keeps placement across a contract edit | "a dragged node keeps its placement across a definition-contract edit (spec scenario 2)" | (contract-edit variant covered by the same rebuild mechanism as the palette add; the browser run pins the rebuild path via the palette add) |
| 3. undragged elements always lay out afresh | "elements with no captured placement always lay out afresh on rebuild (spec scenario 3)" | "the three fresh stages render at finite computed layout transforms" + "the added node renders at a finite layout position…" |
| 4. placement follows a rename | "placement follows a rename: the renamed node keeps it under the new id (spec scenario 4)" | "the rename produced the new id and the old id is gone" + "the dragged node keeps its exact transform through the rename (placement follows the id)" |
| 5. departed element leaves no placement behind (deletion / extraction / re-added id) | "a departed placement is dropped: re-adding the same id via the palette lays out afresh (spec scenario 5)" + "extraction drops the moved nodes' placements…" | "the node re-added under the freed id lands on computed layout, not the departed placement" (the rename freed `atomic-stage`; the fifth palette add re-minted that exact id) |
| 6. Re-layout resets placement and the payload stays clean | "Re-layout resets every placement, later edits treat all nodes as undragged, and the saved payload carries no placement fields (spec scenario 6)" | "Re-layout returns the dragged node to computed layout (leaves the author placement)" + "the never-dragged neighbor stays at its computed layout across Re-layout" + "after Re-layout a later edit never resurrects the departed placement" |

Requirement-prose clauses beyond the scenarios:

- "SHALL capture a placement when a drag ends and SHALL apply it by node
  identity" — pinned by `layout.test.ts` ("renders a stage node with a cached
  placement at that placement, by id" + the by-id override-only-others
  assertion) and by the mock's drag-trigger tests (capture at
  `dragging === false`).
- "Placement SHALL remain edit-session state … a fresh edit session SHALL
  start from computed layout" — pinned by "a fresh edit session starts from
  computed layout (no placement leaks across sessions)" (drag → discard →
  re-enter edit on the same page instance) and structurally by the payload
  walk in scenario 6 plus the untouched `draft.ts`.
