# Handoff — implementer-1, canvas-boxselect-containment-fix (apply)

## Status: COMPLETE — 4/4 apply tasks ticked; parked out to stand-down

- Change: `canvas-boxselect-containment-fix` (inserted child g-003.5 of
  `canvas-gesture-ir-compiler`), stage apply of pipeline bug-fix.
- Worktree: `feat/canvas-gesture-ir-compiler` @ HEAD `9e74b4e0`, **no commits
  made** (ship owns them). Tracked working-tree delta is EXACTLY three files:
  - `packages/ui/src/canvas/PipelineCanvasPage.tsx` +2: the `SelectionMode`
    import and `selectionMode={SelectionMode.Partial}` beside
    `selectionKeyCode="Shift"` (now `:2779`). Nothing else in the file.
  - `packages/ui/test/canvas/pipeline-canvas-page.test.tsx` +27/−1: mock
    `selectionMode` prop + wrapper `data-selection-mode` attribute +
    `SelectionMode` stand-in export + test-side import + the prop-pin test.
  - `packages/ui/test/canvas/canvas-authored-composite-export.test.tsx` +3:
    the same `SelectionMode` stand-in in that file's `@xyflow/react` mock.
- Tests: full UI suite **67 files / 815 tests, exit 0** via the CI-canonical
  `pnpm --dir packages/ui exec vitest run` (baseline 67/814; +1 = the prop
  pin). Not tail-piped. Prop pin red-checked: prop line removed → test fails
  (1 failed / 106 skipped on `-t "prop pin"`), restored → passes.
- Real browser: **ALL CHECKS PASSED** — `evidence/cdp-transcript.md`,
  `evidence/cdp-results.json`, rerunnable driver
  `evidence/cdp-boxselect-fix-check.mjs`, 3 screenshots.
- Gates: `evidence/gates-3-2.md` — `git diff 41dda20d..HEAD --
  src/core/pipeline-registry/` empty (commits AND working tree;
  41dda20d = child-3 ship), `draft.ts` zero diff lines,
  `V2_BODY_PALETTE_KINDS` still `['AtomicStage']` (draft.ts:736).

## The headline: the m2 containment miss is FIXED (verbatim probe, 3/3)

The archived child-3 probe function was rerun VERBATIM — same rect
construction including the 10px left clip (`from.x = min(...) + 10`), same
fit-view discipline, same pane-clear between attempts, same graph setup
(4 atomic stages + finish, chained with real handle-to-handle drags) — on
throwaway Chrome 151 headless, fresh CDP port 9340, fresh profile,
`--window-size=1600,1000`, app `rasen ui --no-open --no-daemon --port 4540`
serving this worktree's freshly built dist (chunk
`PipelineCanvasPage-kMWGcsEp.js` verified to contain
`selectionKeyCode:"Shift",selectionMode:sn.Partial`):

- middle pair `{2,3}` → `["atomic-stage-2","atomic-stage-3"]` full YES
  (pre-fix `["atomic-stage-3"]`)
- singleton `{3}` → `["atomic-stage-3"]` full YES (pre-fix `[]`)
- region triple `{2,3,4}` → `["atomic-stage-2","atomic-stage-3","atomic-stage-4"]`
  full YES (pre-fix `["atomic-stage-3","atomic-stage-4"]`)

## Decisions a successor must know

1. **Both `@xyflow/react` mocks need the `SelectionMode` stand-in.** The
   source now imports `SelectionMode` from `@xyflow/react`; under
   `vi.mock('@xyflow/react', ...)` that resolves to whatever the factory
   exports. Both factories that render the real page
   (`pipeline-canvas-page.test.tsx`, `canvas-authored-composite-export.test.tsx`)
   now export `SelectionMode: { Partial: 'partial', Full: 'full' }` — values
   mirrored from the installed `@xyflow/system` (enum at its
   `dist/esm/index.js:72-77`). Omit it and every render of `CanvasFlow`
   throws `Cannot read properties of undefined (reading 'Partial')`.
2. **The prop pin asserts two things on purpose**: equality with the
   (mock-exported) `SelectionMode.Partial` AND the literal `'partial'` — the
   second anchor keeps a mutated stand-in from making a wrong source value
   pass. The behavioral pin is the browser probe; jsdom does no layout, so
   the mock cannot express rect geometry (design D2).
3. **I briefly added a comment block above the prop, then removed it** —
   task 1.1 says "touch nothing else in the file", and the scope guard
   (task 3.2 / design D4) is line-strict. If a successor wants the comment,
   it needs an artifact amendment first, not a drive-by.
4. **Throwaway browser discipline that made the run green on the first
   attempt**: explicit `--window-size=1600,1000` (at default headless size
   the flow column collapses and handle drags report `src-covered`), fresh
   CDP port (9333-9338 busy with siblings), fresh `--user-data-dir`, direct
   CDP over `localhost` (cdp-proxy.mjs hardwires 127.0.0.1, which this
   Chrome refuses), and the token taken from the `rasen ui` stdout URL.
   Driver env: `RASEN_UI_TOKEN` (+ optional `CDP_HTTP`/`APP_ORIGIN`,
   defaults 9340/4540).

## Residue / notes

- Untracked vitest/CLI scratch roots from the full-suite run
  (`.rasen-e2e-bugfix-*`, `.rasen-pipeline-command-*`,
  `test-pipeline-e2e-ackloss-tmp` — Windows EBUSY leftover temp roots) sit
  in the worktree root, untracked and never staged; ship should not include
  them in any pathspec.
- `.rasen/changes/canvas-boxselect-containment-fix/ephemera/auto-run.json`
  is the LEAD's dispatch run-state (apply in_progress) — implementer never
  writes there.
- Chrome on this machine: `C:\Program Files\Google\Chrome\Application\chrome.exe`
  (151.0.7922.138).

## Next action for the successor

Stage per pipeline order: **verify** (rasen-verify-change — artifacts vs
implementation: prop/import/test files/tasks/spec delta), then ship/archive.
The spec delta (`specs/pipelines-ui/spec.md`, MODIFIED "Canvas selection is a
set" with the two added scenarios) is authored and untouched by apply.
