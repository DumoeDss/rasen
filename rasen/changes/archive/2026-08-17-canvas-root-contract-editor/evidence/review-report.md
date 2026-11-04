# Review report — canvas-root-contract-editor (verify, round 2)

- Stage: verify (verifyPolicy standard — one pass, no fix loop). Reviewer: reviewer-2
  (independent, non-author; round-one reviewer was a different agent).
- Date: 2026-08-17. Branch `feat/canvas-authoring-followups`, base fb243e83.
- Target: uncommitted working-tree delta vs fb243e83 under `packages/ui/`
  (8 files, +661/-58; no untracked files under packages/ui).
- Scope check: CLEAN — `git diff fb243e83 --name-only` outside `packages/ui/` and
  `rasen/changes/canvas-root-contract-editor/` is empty. No second surface built: the
  premise-corrected scope (reachability + degenerate pickers on the EXISTING
  `DefinitionContractPanel`) is what was delivered.

## Verdict

**FINDINGS — 0 Blocker / 1 Major / 2 Minor / 1 Trivial.** The implementation is
faithful to the corrected intent across all seven adversarial gates; the Major is a
spec-text-vs-behavior divergence inside this change's own ADDED delta that should be
reconciled (spec-side) before archive. Independent test gate: 67 files / 864 tests,
exit 0 (baseline 854, +10 — count only grew).

## Gate results

### Gate 1 — Single-home verdict ("write where blocked, point where visible"): PASS

- Exactly one new write path: `declareOutcomeFromLoopReview`
  (`packages/ui/src/canvas/PipelineCanvasPage.tsx:1432`) -> `declareDefinitionOutcome`
  (`packages/ui/src/canvas/draft.ts:539`) -> `updateDefinitionContracts`
  (`draft.ts:499`, the sole rule site; `assertNamedOutcomes` `draft.ts:492`). No
  second rule site crept in: the wrapper only assembles the append; the loop-review
  panel holds no model logic (callback only, `V2LoopReviewPanel.tsx:100-104`).
- Sink promotion is locate-only (`V2NodePanel.tsx:466-477` empty state +
  `onLocateDefinitionOutcomes`); the page test proves read-only posture by asserting
  the submitted definition still has `outcomes: []` after the locate click
  (`pipeline-canvas-page.test.tsx`, "with no declared outcomes the offer states so
  and locates...").
- `NameListField`'s trim/drop-blank/dedupe parse (`DeclarationsPanel.tsx:277-288`) is
  pre-existing canonicalization in the shared widget, not a contract rule site — it
  mints no names and bypasses no refusal (see Finding 1 for the spec-text fallout).

### Gate 2 — NameListField commit-on-blur idiom: PASS (with Finding 3's nuance)

- The per-keystroke full-draft patch (old `DefinitionContractPanel.tsx:198-216`) is
  gone; the field is the shared `NameListField` (`DefinitionContractPanel.tsx:217-229`)
  — literally the same widget the declaration outcomes use, so parity (blur commit,
  draft survives intermediate separators) holds by construction.
- Component test pins "onPatch not called during input" and the canonical blur commit;
  `data-testid="definition-outcomes"` and the `outcomes` focused-field key are kept
  (ring style exists: `style.css:1711`).

### Gate 3 — Stale snapshot fix: PASS

- `loopReview` state no longer carries `definitionOutcomes` (dropped at mint
  `PipelineCanvasPage.tsx:1370` and from the state type `:290-299`); the render site
  passes the live read `draft?.version === 2 ? [...draft.outcomes] : []`
  (`PipelineCanvasPage.tsx:2793-2796`), matching the parallel review's posture. No
  dangling `loopReview.definitionOutcomes` references remain (grep: zero).

### Gate 4 — Acceptance scenario discrimination: PASS

- Task 5.1 (jsdom, `pipeline-canvas-page.test.tsx` "acceptance: an undeclared terminal
  outcome is declared from the contract panel and re-validation clears it"): two
  unconnected sinks -> mocked engine-shaped PORT_MISMATCH (paths
  `/root/nodes/0/capability` + related `/root/nodes/1/capability`, message naming
  `done`) -> declare `done` via the LEFT panel (focus/type/blur) -> explicit Validate.
  Discriminating: a regressed declare path fails `fixed.outcomes` toEqual `['done']`;
  the pre-fix body is pinned (`withIssue.outcomes` toEqual `[]`), and nodes/connections
  are asserted byte-identical across the fix.
- The loop-review inline path is separately discriminated: "declares an outcome inline
  while the review is open and the exit select reads it live" fails if the live read
  regresses to an open-time snapshot (select would stay empty).
- Task 6.1 (CDP, real `rasen ui` server on port 9345, real engine): transcript +
  `cdp-results.json` (allOk: true, 20 checks) + 4 screenshots present; covers
  issue-click -> sink empty state -> locate focuses the outcomes field and panel
  on-screen -> panel blur commit of `done` -> re-Validate clears PORT_MISMATCH with
  zero errors and no other edit. The driver-notes section honestly documents a
  driver-side synthetic-event defect iteration (product unchanged between runs).

### Gate 5 — Regressions: PASS

- Baseline page test at fb243e83:1256-1289 (the all-eight gesture-authored request
  test) is extended in place, not deleted; its outcomes drive moved to focus/blur,
  its inputs/artifacts/limits drives unchanged.
- Non-empty sink promotion branch markup is byte-identical to the old select/confirm;
  its tests still present.
- Parallel review untouched: `V2ParallelReviewPanel` and its render site are not in
  the diff; its undeclared-defaults corner was NOT half-fixed (correctly left for the
  later child).

### Gate 6 — Independent test gate: PASS

- Fresh invocation `pnpm --dir packages/ui exec vitest run` (never piped; output to
  file): **67 files / 864 tests, exit 0** — matches the implementer's claim exactly.
  +10 over the 854 baseline (3 model + 7 page), all new, zero failures, no
  skip/only tricks (count only grew).

### Gate 7 — Invariants: PASS

- `git status --porcelain -- src/core/pipeline-registry/` empty AND
  `git diff fb243e83 -- src/core/pipeline-registry/` empty (IR frozen).
- `V2_BODY_PALETTE_KINDS` still exactly `['AtomicStage']` (`draft.ts:750`).
- Zero `legacyRuntimeOwner` occurrences in the diff; no node synthesis anywhere.
- `draft.ts` change is one additive exported helper; V2 gesture vocabulary untouched.

## Findings (canonical severities)

### 1. MAJOR — The ADDED spec delta asserts a refusal the shipped field never performs for outcome names

- Where: `rasen/changes/canvas-root-contract-editor/specs/pipelines-ui/spec.md`
  (requirement prose sentence 2: "The panel SHALL refuse blank and duplicate outcome
  names with a diagnostic and keep the previous contract"; scenario "The outcome list
  commits on blur and refuses invalid names", second WHEN/THEN) vs
  `packages/ui/src/canvas/DeclarationsPanel.tsx:277-288` and
  `pipeline-canvas-page.test.tsx` ("definition outcomes: the list-field idiom...").
- What happens: `NameListField` silently canonicalizes on blur — trims, drops blanks,
  dedupes — so a blank or duplicate outcome name NEVER reaches the rule site from the
  panel. There is no diagnostic and nothing is refused: text `done, done, partial`
  commits as `['done','partial']`. The refusal-with-diagnostic behavior the spec
  SHALLs is unreachable for outcome names (the implementer's own component test and
  `evidence/gates-7.md` scenario-2 row document this and substitute input-ROW
  refusals + model-layer unit tests as the proof). Task 2.2's demanded assertion
  ("an invalid commit (duplicate/blank) is refused ... surfaces the diagnostic") is
  likewise realized through input rows, not outcome names.
- Why it matters: the delta ships into the durable spec at archive. Scenario 2's FIRST
  WHEN/THEN (canonical parse) and the requirement's refusal sentence describe
  mutually exclusive behaviors; the implementation implements the former. A future
  reader or change would treat "duplicate outcome commit -> diagnostic" as protected
  behavior that does not exist. The shipped behavior is the design-D2-blessed idiom
  (parity with every other outcome list) — the spec text, not the code, is what is
  wrong.
- Failure scenario: after archive, a later child refactors `NameListField`; its
  reviewer validates the change against the spec's refusal claim, passes it, and the
  never-existent refusal path is now doubly imaginary — or the spec claim blocks a
  legitimate refactor.
- Fix direction (LEAD's call, spec-side one-liner): reword the requirement/scenario to
  state the canonicalizing commit ("trimmed, non-blank, deduplicated, in typed order")
  and locate the refusal SHALL at the contract rule site
  (`updateDefinitionContracts`/`declareDefinitionOutcome`), matching what the tests
  actually pin. Scenario 4's refusal clause ("WHEN the inline declare name is blank or
  already declared THEN the review refuses it with a diagnostic") has the same
  reachability problem — blank is button-blocked and duplicate is structurally
  impossible while the affordance renders only with zero declared outcomes
  (`V2LoopReviewPanel.tsx:183,205`) — and deserves the same rewording (prevention +
  rule-site refusal) in the same edit.

### 2. MINOR — Loop-review declare refusal toast renders beneath the modal scrim

- Where: `PipelineCanvasPage.tsx` `declareOutcomeFromLoopReview` (catch ->
  `showToast`) vs `packages/ui/src/style.css:1649-1652`
  (`.pipeline-canvas__toast` z-index 10) and `:1639-1641`
  (`.pipeline-canvas__dialog-overlay` z-index 20).
- What happens: any toast fired while a review modal is open is painted under the
  40% scrim. The loop-review declare refusal routes to exactly such a toast. Today
  the refusal is unreachable through the UI (blank blocked by the disabled confirm;
  duplicate impossible while the affordance requires an empty contract), so the
  impact is latent — but the spec (scenario 4) claims a visible diagnostic on that
  path.
- Failure scenario: a later change loosens the affordance condition (e.g., inline
  declare also when outcomes exist); the author types an already-declared name,
  confirm throws, the toast appears under the scrim, and the author sees nothing —
  the button reads as broken.
- Fix direction: raise the toast z-index above the overlay, or surface the refusal
  inside the dialog (the panel already has an `error` slot pattern).

### 3. MINOR — Every blur of the outcomes field commits, including no-edit blurs, wiping the validation result

- Where: `DeclarationsPanel.tsx:277-288` (`onBlur` always calls `onCommit(next)`,
  no identical-value guard) -> `PipelineCanvasPage.tsx:1672-1684`
  (`patchDefinitionContract` has no no-op guard) -> `markDraftChanged`
  (`PipelineCanvasPage.tsx:421-430`) clears the last validation result, issues
  drawer, and node badges.
- What happens: focusing the outcomes field and blurring it with zero keystrokes
  fires a content-identical patch that clears the author's validation results and
  re-runs the full layout. The old per-keystroke input only acted on real input
  events, so tabbing through did nothing — this is a plausible-path behavior change
  for THIS field at fb243e83. It is inherent to the shared idiom (declaration
  outcomes has always behaved this way), so it is parity-consistent by design D2;
  flagged because the regression surface is new for the definition panel.
- Failure scenario: author validates, sees three issues, tab-navigates the contract
  panel; focus crosses the outcomes field; the drawer and result chip vanish though
  nothing was edited.
- Fix direction: early-return in `NameListField` when
  `next.join(',') === authoritative` (fixes all three users of the widget), or a
  no-op guard in `patchDefinitionContract`.

### 4. TRIVIAL — `pipeline-canvas__inline-declare` marker class has no CSS rule and no real-browser coverage

- Where: `V2LoopReviewPanel.tsx:184`; `grep pipeline-canvas__inline-declare
  packages/ui/src/style.css` -> no match.
- The affordance's layout rides entirely on `stage-panel__section`; the extra class
  is a dead marker. The affordance itself is jsdom-covered only — the CDP flow
  (task 6.1 as written) exercises the sink offer + panel path, not the loop-review
  inline declare, so its real-browser appearance is unverified. Harmless as shipped;
  either add the rule or drop the class, and let the next CDP pass touch the review
  dialog.

## Test gate (independent rerun)

- Command: `pnpm --dir packages/ui exec vitest run` (clean invocation, output to
  file, never piped through tail).
- Result: exit 0 — **67 files / 864 tests passed**, zero failures, no flake rerun
  needed. Matches the implementer's claim and the +10 delta over the 854 baseline.

## Summary for the LEAD

The change delivers the corrected scope precisely: one thin write path through the
single rule site, one live-read fix, one locate pointer, the idiom swap, and a
discriminating acceptance story at both jsdom and real-engine depth, with all frozen
invariants intact. The one decision needed before ship/archive is Finding 1: reconcile
the delta's refusal wording with the canonicalizing behavior the tests actually pin
(the code is right per design D2; the spec prose is not). Findings 2-3 are small,
latent-or-cosmetic seams worth a fixer pass or explicit accept-known.
