# Gates — canvas-backedge-loop-inference task 5.2

Run 2026-08-17, worktree `feat/canvas-gesture-ir-compiler` @ `8ad73cc9` + this
change's working-tree delta (no commits made; ship owns them).

## IR frozen — `src/core/pipeline-registry/`

- `git diff 74568906..HEAD -- src/core/pipeline-registry/` → **empty** (0 lines).
- `git status --porcelain -- src/core/pipeline-registry/` → **empty** (0 lines) —
  frozen in the working tree, not just in commits.

## `V2_BODY_PALETTE_KINDS` stays `['AtomicStage']`

- `packages/ui/src/canvas/draft.ts:736`:
  `export const V2_BODY_PALETTE_KINDS: readonly V2EditableNodeKind[] = ['AtomicStage'];`
- Zero diff lines touch this constant or its comment block.

## No capability hole — explicit paths untouched

- `git diff -- packages/ui/src/canvas/DeclarationsPanel.tsx packages/ui/src/canvas/PalettePanel.tsx`
  → **0 lines** — the declarations-row insert action and the palette renderer are
  byte-identical.
- `addBoundedLoopOverDeclaration` (draft.ts) and the page's `addRootGesture`
  loop branch have **zero diff lines** (the only diff mention of the symbol is a
  doc comment inside the new `synthesizeBoundedLoopFromBackedge`). The
  decomposition refactor (task 1.2) changed only `extractSubgraph`'s internals.
- Behaviorally pinned twice:
  - Component test `the explicit palette loop gesture still works after a
    synthesis` (jsdom): the gesture mints `bounded-loop-2` over the just-extracted
    declaration.
  - Real browser (task 5.1, `07-explicit-gesture-still-works.png`): the palette
    Loop gesture still works after a synthesis — same end state.

## Suite

CI-canonical `pnpm --dir packages/ui exec vitest run`:
**67 files / 814 tests, exit 0** (baseline 67/795; +12 model, +7 component,
child-2's tests green with zero edits). Not piped through `tail`.

## Real browser (task 5.1)

`cdp-transcript.md` + `cdp-results.json` + rerunnable driver
`cdp-backedge-loop-check.mjs` + 7 screenshots — **ALL CHECKS PASSED** (throwaway
Chrome 151 headless, fresh profile, CDP 9339, app 4531, chunk
`PipelineCanvasPage-DoKwXOt1.js`).

The **m2 box-select repeat-probe REPRODUCED 3/3** (every verified rectangle
dropped at least one enclosed node — always `atomic-stage-2`, the leftmost
enclosed stage). Recorded in the transcript and routed to child 1
(canvas-multi-selection) as a follow-up per the portfolio standing order — NOT
fixed in this change; the back-edge flow does not lean on box-select.

Driver note for reruns: headless Chrome needs an explicit `--window-size`
(1600x1000 used); at the default ~764x485 the flow column collapses to ~179px,
fit-view leaves node tops clipped outside the container, and every handle drag
reports `src-covered` (eliminated hypothesis: not a race, not a panel overlay —
pure viewport starvation).
