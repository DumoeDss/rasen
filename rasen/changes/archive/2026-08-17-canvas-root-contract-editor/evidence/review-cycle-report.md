# Review cycle report — canvas-root-contract-editor

## Round 0 — verify (reviewer-2, 2026-08-17)

- Verdict: FINDINGS — 0 Blocker / 1 Major / 2 Minor / 1 Trivial.
- Full report: `evidence/review-report.md` (this file remains the round-0 record).
- Independent suite: 67 files / 864 tests, exit 0 (baseline 854, +10).
- Findings: M1 spec delta asserted an outcome-name refusal the canonicalizing
  NameListField never performs; m1 refusal toast under the dialog scrim (z-index 10
  vs 20); m2 no-edit blur committed a content-identical patch that wiped the
  validation result; t1 dead `pipeline-canvas__inline-declare` CSS marker class.

## Round 1 — fix + re-review (reviewer-2, 2026-08-17)

Fix author: impl-8 (non-reviewer). Re-reviewer: reviewer-2 (same as round 0;
verifyPolicy single-reviewer continuity). Scope reviewed: the fix delta only
(`evidence/fix-round-1.md` + on-disk state), against the round-0 findings.

### M1 (spec delta reword) — RESOLVED

- `specs/pipelines-ui/spec.md`: the requirement's second sentence now states the
  list-field commit SHALL canonicalize (trim, non-blank, dedupe, typed order) so a
  blank or duplicate never reaches the contract from the list, and locates refusal
  at the contract rule site the row editors and the declare helper reach, with
  diagnostic + previous contract kept. Every SHALL is now TRUE of shipped behavior:
  canonicalization pinned by the component test; rule-site refusal pinned by the
  row-refusal page test and the `declareDefinitionOutcome` unit tests; diagnostics
  surface via toast and (per m1) sit above the scrim.
- Scenario 2 retitled "commits on blur and canonicalizes"; its second WHEN/THEN now
  describes canonicalization with no refusal — exactly what the tests pin. Scenario
  4's refusal clause now states blank = confirm disabled, duplicate =
  structurally unsubmitable through the affordance, rule-site refusal as the model
  guarantee — all true and pinned. The rows scenario's refusal clause was kept and
  IS true for the row editors (rows do not canonicalize; they hit the rule site).
- Acceptance scenario 1 is verbatim unchanged — NOT weakened. No em-dashes in the
  requirement/scenario prose.
- `design.md` D2 rewritten to the explicit canonicalizes / never-submits-a-refusable-
  value distinction — aligned with the delta and the code.
- `rasen validate canvas-root-contract-editor` re-run by this reviewer: valid.

### m1 (toast under scrim) — RESOLVED

- `packages/ui/src/style.css:1649-1657`: `.pipeline-canvas__toast` z-index 10 -> 30,
  with a comment recording the stacking argument. Reviewer independently spot-checked
  the load-bearing claim: none of `.pipeline-canvas__body` / `.pipeline-canvas__flow`
  / `.pipeline-canvas__flow-column` (style.css:1555/1670/1671/1775) carries
  transform/opacity/isolation/filter/z-index, so the toast and the fixed overlay
  compete directly and 30 > 20 wins.
- Pin: `test/style/canvas-authoring-column-lock.test.ts` "renders the toast above
  the review dialogs scrim" asserts BOTH anchors (toast z-index 30, overlay
  z-index 20) via the file's `declares()` helper.

### m2 (no-edit blur wiped validation) — RESOLVED

- `packages/ui/src/canvas/DeclarationsPanel.tsx:280-291`: display always
  re-normalizes on blur; `onCommit` fires only when the canonical value differs
  from the authoritative prop (`if (next.join(',') !== authoritative)`). Real-edit
  commit semantics UNCHANGED — a changed canonical value still commits (the round-0
  component test's first commit and every existing consumer test, which commit
  changed values, still pass; the guard's only behavioral delta is the no-op case,
  where the contract value is identical either way).
- Discriminating page pin added: validate -> findings shown -> retype the identical
  canonical text -> blur -> chip AND drawer still present and `validatePipeline`
  still called exactly once (fails if the guard regresses). Component pin extended:
  duplicate-text blur keeps `onPatch` at exactly one call and re-normalizes the
  display text.
- Blast radius (shared widget: declaration outcomes, extraction review, loop-review
  outcome lists): all consumers get no-op-blur semantics; suite green.

### t1 (dead CSS marker class) — RESOLVED

- `pipeline-canvas__inline-declare` appears nowhere under `packages/ui/src`; the
  affordance block is `stage-panel__section` only (`V2LoopReviewPanel.tsx:184`) and
  remains addressed by `data-testid="v2-loop-review-declare"`, which the component
  and page tests pin.

### Nothing new in the blast radius

- Diff-vs-fb243e83 growth fully accounted: 8 -> 10 files (`style.css` +7,
  `canvas-authoring-column-lock.test.ts` +16); page test 391 -> 429 insertions (the
  m2 page case + component extension); +2 deletions = exactly the class-attribute
  line and the `onCommit` line; 8 new `it(` cases = round-0's 7 + the m2 case. No
  other file changed; IR still frozen (no changes under `src/core/`).

### Round-1 gates (this reviewer, independent)

- Focused rerun `pnpm --dir packages/ui exec vitest run test/canvas/pipeline-canvas-page.test.tsx
  test/canvas/v2-authoring-model.test.ts test/style/canvas-authoring-column-lock.test.ts`:
  exit 0 — 3 files / 171 tests passed (matches the fix note).
- `rasen validate canvas-root-contract-editor`: valid.
- Full-suite claim (67 files / 866, exit 0) corroborated arithmetically: this
  reviewer's round-0 independent run was 67/864; the round adds exactly two cases
  (the m1 CSS pin and the m2 page case), both green in the focused rerun above.

### Round-1 verdict

**CLEAN — all four findings resolved; no new findings.** The implementer's
fix-round turn survived a mid-turn server crash; this re-review verified every item
against on-disk state (not the fix note's prose) and re-ran the focused gates
independently.
