# Gates 7.1 / 7.2 / 7.3 — canvas-root-contract-editor (apply, implementer-1)

## 7.1 — Full UI suite, CI-canonical

- Invocation: `pnpm --dir packages/ui exec vitest run` from the worktree root,
  clean invocation, output to a file (never piped through `tail`).
- Result: **exit 0 — 67 files / 864 tests, all passed.**
- Baseline (proposal/tasks): 67 files / 854 tests → count only grew (+10, all
  new: 3 model, 1 definition-outcomes component, 1 panel-refusal page, 2
  loop-review page, 1 loop-review component, 1 sink empty-state page, 1
  acceptance page).
- Zero failures to enumerate; no flake re-run needed (single clean run).

## 7.2 — IR-frozen + hard-constraint asserts (2026-08-17, this apply session)

- `git status --porcelain -- src/core/pipeline-registry/` → empty.
- `git diff fb243e83 -- src/core/pipeline-registry/` → empty (frozen).
- `V2_BODY_PALETTE_KINDS` → still exactly `['AtomicStage']`
  (`packages/ui/src/canvas/draft.ts:750`, moved only by additive lines above).
- `git diff fb243e83 -- packages/ui | grep legacyRuntimeOwner` → no matches
  (only git's LF/CRLF working-copy warnings, no content hits); this change
  synthesizes no nodes at all.
- Bonus invariants asserted by the suite: the existing POST-body
  `not.toHaveProperty('legacyRuntimeOwner')` guards in
  `pipeline-canvas-page.test.tsx` all still pass.

## 7.3 — Traceability: every scenario in the ADDED requirement → a test or CDP step

Requirement: "The canvas declares the definition's outcome contract"
(`specs/pipelines-ui/spec.md`, 6 scenarios).

| # | Scenario | Proof (by name) |
|---|---|---|
| 1 | An undeclared terminal outcome is declared from the contract panel | jsdom: `acceptance: an undeclared terminal outcome is declared from the contract panel and re-validation clears it (spec scenario 1)` (`pipeline-canvas-page.test.tsx`). CDP: checks "the real engine raises the PORT_MISMATCH naming terminal outcome done", "the outcomes field commits done on blur", "the PORT_MISMATCH is gone after the declare", "no other edit was made" (`evidence/cdp-transcript.md`, real engine). |
| 2 | The outcome list commits on blur and canonicalizes | jsdom component: `definition outcomes: the list-field idiom, committed on blur only (NameListField swap)` (no patch before blur; trimmed/non-blank/deduped commit; duplicate deduped by the canonical parse; the `outcomes` focused-field ring). jsdom page: `the definition contract panel refuses blank/duplicate row names with a diagnostic and keeps the previous contract` — the panel's refusal path through the shared rule site (`updateDefinitionContracts` throws → toast → previous contract kept). Model: `refuses blank and duplicate names through the rule site without mutating the input` (`v2-authoring-model.test.ts`). The text field itself pre-dedupes through the shared `NameListField` parse, so a duplicate never reaches the rule site from it — the rule-site refusal is demonstrated through the panel's rows (same sole rule site) and pinned at the model layer. (Scenario wording canonicalized in fix round 1 / M1; the mapping is unchanged.) |
| 3 | Typed input and artifact rows stay editable | jsdom (pre-existing, still green): `authors definition, AtomicStage, Gate, loop lifecycle, and parallel fields through mounted controls` drives input/artifact row adds + renames through the mounted panel; the new refusal test above adds the blank/duplicate row diagnostic. Model (pre-existing): `refuses duplicate or blank typed identities and non-positive authored limits in the draft model`. |
| 4 | The loop review reads the live contract and can declare inline | jsdom page: `declares an outcome inline while the review is open and the exit select reads it live` (declare → review open, affordance gone, exit select offers the new outcome from the LIVE draft, graph untouched) and `the loop review reads a contract edited while it is open (no open-time snapshot)`. jsdom component: `inline declare affordance (direct render): hidden once outcomes exist, hands over the trimmed name, keeps the review open` (hidden when outcomes exist; trimmed-name callback; blank disables confirm; local edits intact). Refusal clause mapping (per the M1 reword): blank → confirm disabled (component test); duplicate → structurally unreachable through this affordance (it renders only while NOTHING is declared), refusal pinned at the model layer (`declareDefinitionOutcome` duplicate test). |
| 5 | The sink endpoint offer points at the contract when no outcomes exist | jsdom page: `with no declared outcomes the offer states so and locates the contract panel instead of an empty select` (no select/confirm, states the situation, locate focuses the outcomes field + one `scrollIntoView({block:'nearest'})`, definition untouched). CDP: checks "no dead-end outcome select is rendered", "the empty state states that no outcomes are declared", "the locate action focuses the definition outcomes field", "the definition contract panel is on-screen". |
| 6 | Pickers offer exactly the declared outcomes | jsdom (pre-existing, still green): `renders the endpoint-naming section for a selected stage sink…` asserts the sink select lists exactly the fixture outcomes; new page test's `sink offer now offers exactly ['done']` post-declare is asserted in the acceptance flow and in the loop-review live-read test for the exit select. CDP: "the sink offer now offers exactly the declared outcome (['done'])". |

Model helper (task 1.1/1.2, not a scenario but the delta's mechanism):
`declareDefinitionOutcome (the thin declare-one-more wrapper)` — 3 tests in
`v2-authoring-model.test.ts`.
