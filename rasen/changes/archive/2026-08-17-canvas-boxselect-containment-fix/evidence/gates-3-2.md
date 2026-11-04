# Gates — canvas-boxselect-containment-fix task 3.2

Run 2026-08-17, worktree `feat/canvas-gesture-ir-compiler` @ `9e74b4e0` + this
change's working-tree delta (no commits made; ship owns them).

## IR frozen — `src/core/pipeline-registry/`

- Base = the branch's last archived child's ship commit `41dda20d`
  (canvas-backedge-loop-inference, archived at HEAD `9e74b4e0`):
  `git diff 41dda20d..HEAD -- src/core/pipeline-registry/` → **empty** (0 lines).
- `git status --porcelain -- src/core/pipeline-registry/` → **empty** (0 lines) —
  frozen in the working tree, not just in commits.

## `V2_BODY_PALETTE_KINDS` stays `['AtomicStage']`

- `git diff -- packages/ui/src/canvas/draft.ts` → **0 lines** — draft.ts is
  byte-identical (design non-goal: "Touching draft.ts at all").
- `packages/ui/src/canvas/draft.ts:736`:
  `export const V2_BODY_PALETTE_KINDS: readonly V2EditableNodeKind[] = ['AtomicStage'];`

## Scope guard — design D4 (one source line + one import + tests)

Tracked working-tree diff is EXACTLY three files (`git diff --stat`):

- `packages/ui/src/canvas/PipelineCanvasPage.tsx` — +2 lines: the
  `SelectionMode` import and `selectionMode={SelectionMode.Partial}` beside
  `selectionKeyCode="Shift"` (`:2779`). Nothing else in the file.
- `packages/ui/test/canvas/pipeline-canvas-page.test.tsx` — +27/−1: the
  mock's `selectionMode` prop + wrapper `data-selection-mode` attribute +
  `SelectionMode` stand-in export (mirrors `@xyflow/system`'s real enum
  values `'partial'`/`'full'`, without which the new source import resolves
  to `undefined` under the mock), the test-side import, and the prop-pin
  test itself.
- `packages/ui/test/canvas/canvas-authored-composite-export.test.tsx` — +3:
  the same `SelectionMode` stand-in in that file's `@xyflow/react` mock
  (it renders the real page; without the export the prop expression throws).

Untracked additions outside the source tree: this change's own directory
(artifacts + evidence) and vitest/CLI scratch roots from the full-suite run
(`.rasen-e2e-bugfix-*`, `.rasen-pipeline-command-*`,
`test-pipeline-e2e-ackloss-tmp` — Windows EBUSY leftover temp roots, never
staged). `.rasen/changes/<change>/ephemera/auto-run.json` is the pipeline
run-state written by the LEAD's dispatch, not by the implementer.

## Suite (task 2.1, recorded here for the one-stop gate view)

CI-canonical `pnpm --dir packages/ui exec vitest run`: **67 files / 815
tests, exit 0** (baseline 67/814; +1 = the prop-pin test). Not piped through
`tail`. The prop pin was red-checked: with the source prop line removed the
test fails (1 failed), restored it passes — the guard discriminates.

## Real browser (task 3.1)

`cdp-transcript.md` + `cdp-results.json` + rerunnable driver
`cdp-boxselect-fix-check.mjs` (archived child-3 probe function VERBATIM —
same 10px-left-clip rect construction that failed 3/3 pre-fix) + 3
screenshots — **ALL CHECKS PASSED** (throwaway Chrome 151 headless, fresh
profile + fresh port 9340, `--window-size=1600,1000`, app 4540):

- middle pair: `["atomic-stage-2","atomic-stage-3"]` full membership YES
  (pre-fix: `["atomic-stage-3"]` — leftmost dropped)
- singleton: `["atomic-stage-3"]` full membership YES (pre-fix: `[]`)
- region triple: `["atomic-stage-2","atomic-stage-3","atomic-stage-4"]` full
  membership YES (pre-fix: `["atomic-stage-3","atomic-stage-4"]`)
