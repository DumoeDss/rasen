# Handoff — implementer-1, canvas-root-contract-editor (apply, DONE after fix round 1)

## State at stand-down

- 14/14 apply tasks ticked (`rasen/changes/canvas-root-contract-editor/tasks.md`),
  plus reviewer2's round-1 findings all fixed (`evidence/fix-round-1.md`).
  `rasen validate canvas-root-contract-editor` green (last run after the M1
  reword and again at the round's close).
- Working tree carries the implementation UNCOMMITTED (shipper's job), exactly
  9 tracked files:
  - `packages/ui/src/canvas/draft.ts` — `declareDefinitionOutcome(def, name)`
    beside `updateDefinitionContracts` (trim; blank/duplicate refused by the
    rule family via the underlying full-array call; sole rule site preserved).
  - `packages/ui/src/canvas/DeclarationsPanel.tsx` — `NameListField` gains an
    optional `inputRef` (D6 locate) and the m2 identical-value blur guard
    (displayed text always re-normalizes; `onCommit` fires only when the
    canonical value differs from the authoritative prop).
  - `packages/ui/src/canvas/DefinitionContractPanel.tsx` — outcomes field is
    the shared `NameListField` (commit-on-blur; keeps the
    `definition-outcomes` testid + `outcomes` focused-field ring); new optional
    `outcomesInputRef` / `panelRef` props.
  - `packages/ui/src/canvas/V2LoopReviewPanel.tsx` — `definitionOutcomes` is a
    live-read prop; inline declare affordance rendered only while it is empty
    (`v2-loop-review-declare{,-name,-confirm}`; blank disables confirm; an
    effect adopts the first declared outcome as the exit pick when the select
    initialized empty); required `onDeclareOutcome(name)` thin callback.
  - `packages/ui/src/canvas/V2NodePanel.tsx` — `SinkPromotionSection` empty
    state (`v2-node-panel-sink-empty` text + `v2-node-panel-sink-locate`
    action; no select/confirm) when `outcomes.length === 0`;
    `sinkPromotion` group gains `onLocateDefinitionOutcomes`.
  - `packages/ui/src/canvas/PipelineCanvasPage.tsx` — loop review renders
    `definitionOutcomes` from the live draft (the open-time snapshot field is
    dropped from the `loopReview` state), `declareOutcomeFromLoopReview` (one
    declare transaction; refusal toasts, draft untouched), the two locate refs
    + `locateDefinitionOutcomes` (scrollIntoView + focus), props wiring.
  - `packages/ui/src/style.css` — `.pipeline-canvas__toast` z-index 10 → 30
    (above the review scrim's 20; no ancestor stacking context in between).
  - Tests: `packages/ui/test/canvas/pipeline-canvas-page.test.tsx` (+8 cases,
    2 existing drivers moved to the focus/blur pattern),
    `packages/ui/test/canvas/v2-authoring-model.test.ts` (+3),
    `packages/ui/test/style/canvas-authoring-column-lock.test.ts` (+1 CSS pin).
- Suites (CI-canonical `pnpm --dir packages/ui exec vitest run`, never
  tail-piped): full suite **67 files / 866 tests, exit 0, zero failures**
  (baseline 67/854 → 864 at round-0 close → 866 after fix round 1).
- Real browser (task 6.1): **ALL 20 CHECKS PASSED** on the REAL engine —
  fresh assembly → two unconnected sinks → Validate raises the actual
  PORT_MISMATCH → issue click selects the sink whose offer shows the EMPTY
  state + locate (field focused, panel on-screen) → declare `done` (blur
  commit) → sink select offers exactly `['done']` → Validate again clears the
  PORT_MISMATCH with no other edit (one unrelated stored-profile warning
  remains, recorded honestly). Evidence: `evidence/cdp-transcript.md`,
  `cdp-results.json`, rerunnable driver `cdp-root-contract-editor-check.mjs`,
  4 screenshots. App port 9345, CDP port 9346 (9333-9344 consumed). Throwaway
  Chrome killed by user-data-dir marker; server stopped; ports released.
- Gates: `evidence/gates-7.md` — 7.1 suite counts, 7.2 IR-frozen asserts
  (porcelain + `git diff fb243e83 -- src/core/pipeline-registry/` empty,
  `V2_BODY_PALETTE_KINDS` still `['AtomicStage']` at draft.ts:750, zero
  `legacyRuntimeOwner` in the diff), 7.3 per-scenario traceability table
  (updated for the M1 retitle).

## Decisions made during apply (successor must know)

1. **The refusal semantics live at the rule site, not the list field** (M1):
   the `NameListField` commit canonicalizes (trim/drop-blanks/dedupe), so a
   blank or duplicate can never reach `updateDefinitionContracts` from the
   outcomes text. The spec delta now says exactly that; refusals surface
   through the panel's row editors (duplicate row name → toast, contract
   kept — page-tested) and the model layer (`declareDefinitionOutcome` unit
   tests). Don't "restore" a refusing outcomes field; it contradicts D2 and
   the corrected spec.
2. **The m2 guard sits in the shared widget, not the page**: every
   NameListField consumer (declaration outcomes, extraction review, loop
   review, definition outcomes) now no-ops an unchanged blur. All pre-existing
   consumer tests commit CHANGED values, so nothing else moved.
3. **The toast z-index fix is a direct comparison**: I verified no ancestor
   between `.pipeline-canvas__toast` and `.pipeline-canvas__dialog-overlay`
   creates a stacking context (`__body`/`__flow-column`/`__flow` carry no
   transform/opacity/isolation/z-index), so 30-vs-20 is decisive. If someone
   later adds a transform/opacity to any of those ancestors, the pin test
   will still pass while the REAL stacking changes — the pin anchors the
   declaration, not the stacking context absence.
4. **Exit-outcome adoption effect** (V2LoopReviewPanel): the select
   initializes empty on a fresh contract; when the inline declare lands the
   first outcome, an effect adopts it as the pick so confirm submits the
   declared outcome rather than `''`. The only definitionOutcomes change
   while the modal is open is the review's own declare, so the effect fires
   exactly there.

## Eliminated hypotheses (the one debugging arc — CDP round 1, 17/20)

- **Symptom**: after the declare step, the sink select stayed `[]` and the
  second Validate still raised PORT_MISMATCH.
- **Eliminated**: (a) the blur-commit idiom being broken in the product —
  jsdom page/component tests for the exact flow were green; (b) the patch
  being refused by the rule site — no toast appeared and `['done']` cannot be
  refused; (c) focus mechanics — `document.activeElement` was the field.
- **Root cause (live-tab probe, two variables separated)**: the driver's
  synthetic `new Event('input')` + programmatic `el.blur()` never reached
  Preact's delegated `onInput`/`onBlur` in real Chrome — the DOM value showed
  the text while the component state stayed empty, so the blur committed the
  EMPTY canonical list (a no-op against an empty contract). Real CDP
  `Input.insertText` + a real Tab key committed correctly. PRODUCT unchanged
  between the failing and passing runs.
- **Rule for future canvas CDP drivers**: synthetic input/blur events are NOT
  equivalent to real ones for Preact-delegated handlers in this browser —
  type with `Input.insertText` and blur with a real Tab (or a click elsewhere).
  (Sibling drivers' old `value`-setter + synthetic-input pattern only appeared
  to work because the pre-change field committed per-keystroke through a
  different prop path.)

## Durable notes / residue

- The known canvas Save persistence defect stays out of scope; all
  verification is in-memory (per-throwaway-tab pipelines, never saved).
- Untracked residue NOT to stage (pre-existing + my run): `test-pipeline-e2e-ackloss-tmp/`,
  `.rasen-pipeline-command-*/`, `.rasen-e2e-bugfix-p7kW0o/`, sibling
  `.rasen/changes/*` mirrors, `.rasen/changes/canvas-root-contract-editor/ephemera/`
  (two CDP probe scripts — `.rasen` is run-state).
- The infra server error that killed the first fix-round turn happened AFTER
  all edits and both test runs; everything was re-verified against disk before
  `evidence/fix-round-1.md` was written (the file records this).

## Next action

Verify (rasen-verify-change): artifacts vs implementation, the spec delta's
corrected semantics, `evidence/gates-7.md` + `evidence/fix-round-1.md` +
`evidence/cdp-transcript.md`. Then ship (narrow pathspec: the 9 tracked files
+ `rasen/changes/canvas-root-contract-editor/`; LF discipline, `git diff
--check` clean on evidence; exclude `signals/` dirs at archive time per the
repo trap).
