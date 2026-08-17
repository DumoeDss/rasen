# Fix round 1 — canvas-root-contract-editor (reviewer2's four findings, all fixed)

Implementer note: the fix-round turn died on an infra server error after the work
and both test runs had completed but before this file was written; every item
below was re-verified against disk before this record was made, and both cited
runs executed against exactly the current tree (no edits landed between the runs
and this file).

## M1 — SPEC REWORD (prose-only): the false "panel SHALL refuse blank and duplicate outcome names"

- What: the delta's requirement asserted the panel refuses blank/duplicate
  outcome names, but the shipped `NameListField` commit canonicalizes (trim,
  drop blanks, dedupe) per design D2 — a blank or duplicate never reaches the
  rule site from the list, so the SHALL was unsatisfiable-as-stated. Reworded
  to canonicalizing-commit semantics with refusal located at the contract rule
  site.
- Where: `rasen/changes/canvas-root-contract-editor/specs/pipelines-ui/spec.md`
  — the requirement's second sentence (list-field commit SHALL canonicalize;
  refusal SHALL live at the contract rule site the row editors and the declare
  helper reach); Scenario 2 retitled "The outcome list commits on blur and
  canonicalizes" with the second WHEN/THEN now stating blanks are dropped and
  duplicates merged with no refusal raised; Scenario 4's refusal clause now
  states the blank case disables confirm and a duplicate cannot be submitted
  through the affordance (it renders only while nothing is declared), with the
  rule site's own refusal the model guarantee. The rows scenario's refusal
  clause ("a blank or duplicate row name is refused with a diagnostic") is
  TRUE for the row editors and was kept.
  `design.md` D2's "dedupe/trim parse matches assertNamedOutcomes" (adjacent
  phrasing implying the parse and the refusal are equivalent) rewritten to the
  explicit canonicalizes/never-submits-a-refusable-value distinction.
- Pin: prose-only — no test changes (the implementation already matched the
  corrected semantics; the component test "definition outcomes: the list-field
  idiom, committed on blur only" pins the canonicalizing commit).
- Revalidate: `rasen validate canvas-root-contract-editor` → "Change
  'canvas-root-contract-editor' is valid" (run twice: once right after the
  reword, once during this record's disk re-verification).

## m1 — loop-review declare-refusal toast rendered under the dialog scrim

- What: `.pipeline-canvas__toast` carried `z-index: 10` while
  `.pipeline-canvas__dialog-overlay` carries `z-index: 20`, so any toast fired
  while a review modal is open (the loop review's inline-declare refusal path,
  and every other review-time refusal toast) painted under the scrim.
- Where: `packages/ui/src/style.css` `.pipeline-canvas__toast` — `z-index: 10`
  → `z-index: 30`, with a comment recording the stacking argument (no ancestor
  between the toast and the overlay creates a stacking context — checked:
  `.pipeline-canvas__body` / `__flow-column` / `__flow` carry no
  transform/opacity/isolation/z-index — so the two z-indexes compete directly).
- Pin: `packages/ui/test/style/canvas-authoring-column-lock.test.ts` — new
  case "renders the toast above the review dialogs scrim" asserting BOTH
  property+value anchors via the file's `declares()` helper (toast
  `z-index: 30`, overlay `z-index: 20`). jsdom paints nothing, so the string
  pin is the layer; the stacking-context claim is documented in the rule's
  comment.

## m2 — a no-edit blur of the outcomes field wiped the validation result

- What: `NameListField`'s blur always called `onCommit(canonical parse)`, so
  blurring the definition outcomes field after retyping an identical value
  committed a content-identical `onPatch` whose page-side `markDraftChanged`
  cleared the validation chip, the issues drawer, and the issue markers even
  though no contract value changed.
- Where: `packages/ui/src/canvas/DeclarationsPanel.tsx` `NameListField.onBlur`
  — the displayed draft always re-normalizes (`setDraft(next.join(','))`), but
  `onCommit` fires only when the canonical value differs from the
  authoritative prop (`if (next.join(',') !== authoritative) onCommit(next)`).
  The guard lives in the shared widget, so every consumer (declaration
  outcomes, extraction review, loop review) gets the same no-op-blur
  semantics; all existing consumer tests commit CHANGED values and were
  unaffected.
- Pins: `pipeline-canvas-page.test.tsx` — new page case "a no-edit blur of the
  outcomes field commits nothing and keeps the validation findings (review
  m2)" (validate → findings shown → retype the identical canonical text into
  `definition-outcomes` → blur → chip AND drawer still present,
  `validatePipeline` still called exactly once); the component case
  "definition outcomes: the list-field idiom, committed on blur only
  (NameListField swap)" extended — the duplicate-text blur now asserts
  `onPatch` stays at exactly one call and the displayed text re-normalizes to
  `done,partial`.

## t1 — dead CSS marker class

- What: the loop review's inline-declare block carried
  `pipeline-canvas__inline-declare`, a class with no rule in `style.css`
  (invented marker, not part of any contract).
- Where: `packages/ui/src/canvas/V2LoopReviewPanel.tsx` — the affordance's
  `class` is now just `stage-panel__section`; `pipeline-canvas__inline-declare`
  appears nowhere in the tree.
- Pin: grep-clean (no CSS rule existed to pin; the affordance remains
  addressed by its `data-testid="v2-loop-review-declare"`, which the
  component and page tests already pin).

## Gates after the round

- Focused: `pnpm --dir packages/ui exec vitest run test/canvas/pipeline-canvas-page.test.tsx test/canvas/v2-authoring-model.test.ts test/style/canvas-authoring-column-lock.test.ts` → exit 0, **3 files / 171 tests passed.**
- Full suite (CI-canonical, clean invocation, not piped): exit 0, **67 files /
  866 tests passed, zero failures** — vs the round-0 close of 67/864 (+2: the
  m1 CSS pin and the m2 page case; the m2 component assertions extended an
  existing test). Log re-inspected in full for `failed|FAIL|ERR_`: no matches.
- `rasen validate canvas-root-contract-editor`: valid.
