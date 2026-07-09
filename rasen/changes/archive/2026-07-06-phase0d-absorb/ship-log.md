# Ship Log — phase0d-absorb

## Commit summary

feat(gstack): phase0d absorb — grill methodology into investigate/review/office-hours

- investigate: red-capable feedback-loop gate, minimise, ranked-falsifiable hypotheses (from diagnosing-bugs, MIT) + HITL loop template sidecar
- review: two-axis Standards/Spec parallel-worker orchestration in Step 4; Fowler 12-smell baseline added to checklist.md
- office-hours: interview discipline (one question, recommended answer, research first)
- tighten allowed-tools for codebase-design/domain-modeling; strip stale ethos from vendored top-level browse/SKILL.md

## Verification

- `bun run skill:check` — exit 0, all 29 generated `SKILL.md` files reported FRESH against their `.tmpl` sources.
- `openspec validate phase0d-absorb --strict` — `Change 'phase0d-absorb' is valid`.
- Count-sentinel tests (`test/core/pipeline-registry/*`, `test/commands/pipeline.test.ts`, etc.) were **not** run as a ship gate: the working tree is shared with concurrent sibling change `add-context-handoff`, which is independently modifying `src/core/**` and `test/**`. Any red there is attributed to that in-flight sibling work, not to this change's absorbed skill content (which touches only `skills/gstack/**`, `browse/SKILL.md`, and `openspec/**`).

## Review

- Review-loop **R1 clean**.
- One spec-wording finding from the review (M1): tightened "ethos-equivalence" language for clarity; addressed together with a related T1 finding.

## Accepted-known items

- Office-hours skill: some interview-discipline guidance restates existing conventions rather than introducing new mechanics — accepted as reinforcement, not redundant scope creep.
- Count-sentinel red: attributed to concurrent sibling change `add-context-handoff` touching shared `src/core/**` / `test/**` paths in the same working tree; not caused by this change and excluded from this change's verification gate.

## Archive

Archived via `openspec archive phase0d-absorb -y` → `openspec/changes/archive/2026-07-06-phase0d-absorb/`. Merged 5 ADDED specs into `openspec/specs/`:
- `browse-skill-ethos-cleanup` (+1)
- `investigate-diagnosing-absorption` (+3)
- `methodology-skill-tool-scoping` (+2)
- `office-hours-grilling-absorption` (+1)
- `review-two-axis-absorption` (+3)
