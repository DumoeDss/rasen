# Constraint sweep — canvas-loop-body-visibility (task 5.3)

## IR frozen

`git status --porcelain -- src/core/pipeline-registry/` → EMPTY. Zero engine
changes; `draft.ts` (the UI model) also untouched — expansion is a pure
rendering concern.

## The definition wire shape is untouched

- No file under `src/core/` changed; `packages/ui/src/canvas/draft.ts`
  (the model that builds the payload) has an empty diff.
- No frame/expansion state ever enters the payload: expansion lives in
  `expandedFramesRef` (a page ref, session-only) and body ids exist only in
  flow-node space (`<frameId>::<bodyId>`). Pinned by the page test
  "placement survival": the submitted definition's JSON contains neither
  `::` nor `expandedFrame`.

## `V2_BODY_PALETTE_KINDS` unchanged

`packages/ui/src/canvas/draft.ts:829` — `['AtomicStage']`, byte-identical
(diff shows no touch).

## No `legacyRuntimeOwner`

`git diff -- packages/ui/src | grep legacyRuntimeOwner` → 0 matches.

## v1 group path untouched

`layoutGraph`'s group branch is unchanged (the only diff near the group
constants is the `export` keyword on `GROUP_PADDING`/`GROUP_LABEL_HEIGHT`,
needed so the CSS pin imports the same numbers the frame arithmetic uses).
The group bounding-box arithmetic, member projection, and
`group:<name>` emission are byte-identical; the full existing suite (v1
layout + group tests) runs green.

## Mock discipline

`useUpdateNodeInternals` is a new import from `@xyflow/react`; every test
file that mocks the module (`pipeline-canvas-page.test.tsx`,
`canvas-authored-composite-export.test.tsx`) provides a no-op stand-in —
the second file's missing export was caught by the full suite (its page
render crashed → the edit affordance vanished) and fixed.

## Gates cited

- Full UI suite (`pnpm --dir packages/ui exec vitest run`, unpiped):
  **69 files / 927 tests, 0 failures** — baseline 68/912, +1 file
  (`test/style/canvas-frame.test.ts`), +15 tests (6 layout, 4 style pin,
  5 page). First full run after the final code: green.
- Typecheck: exactly the 13 pre-existing errors (none in this change's
  files).
- Real browser: all 13 gates green in one run on the final clean build
  (`evidence/browser-gate.md`).

## Suggested narrow pathspec for the ship stage

```
packages/ui/src/canvas/layout.ts
packages/ui/src/canvas/StageNode.tsx
packages/ui/src/canvas/PipelineCanvasPage.tsx
packages/ui/src/canvas/V2BodyStagePanel.tsx
packages/ui/src/style.css
packages/ui/test/canvas/layout.test.ts
packages/ui/test/canvas/pipeline-canvas-page.test.tsx
packages/ui/test/canvas/canvas-authored-composite-export.test.tsx
packages/ui/test/style/canvas-frame.test.ts
rasen/changes/canvas-loop-body-visibility/
```

`bin/rasen.js` is the known CRLF phantom — out of every pathspec. The
`.rasen/…/ephemera/` dir (driver, screenshots, logs, throwaway Chrome
profiles) stays untracked; the chrome-profile* dirs are throwaway and can be
deleted. No `signals/` under the change dir.
