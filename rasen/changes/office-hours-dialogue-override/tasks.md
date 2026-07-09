## 1. Shared PREAMBLE — Dialogue Override & Completeness scoping

- [x] 1.1 In `src/core/templates/experts/_shared.ts`, add a **Dialogue Override** section to the `PREAMBLE` constant (place it early, near the AskUserQuestion Format so it governs later phases): state AskUserQuestion is a decision tool not a conversation tool; before each call inspect the user's previous message; if it contains a question, a request to explain/discuss, or free-text that is not a clean option selection → pause the question flow and answer in body prose (no options, no RECOMMENDATION, no Completeness), keep discussing until the user explicitly signals to proceed, then resume the original phase without skipping ahead.
- [x] 1.2 In the same Dialogue Override section, forbid combining "answer the question" + "advance the phase" in one turn; state that a request for more dialogue ("answer me first," "let's discuss," repeated follow-ups) is the opposite of a skip signal and never triggers fast-forward/escape hatch; restrict the Re-ground restatement to genuine long gaps and forbid repeating the template opener during continuous conversation.
- [x] 1.3 In the `PREAMBLE` "AskUserQuestion Format" section, scope `Completeness X/10` to shortcut-vs-complete-implementation decisions only, and state that discussion-type/exploratory forks do NOT attach a Completeness score.

## 2. office-hours skill — interview discipline, escape hatch, gate, consultation

- [x] 2.1 In `src/core/templates/experts/office-hours.ts`, add a fourth Interview discipline rule (~lines 61-69) "Answer before you ask": the user's question is the highest-priority input; answering it precedes advancing the question list. Ensure it reads as binding on both Startup (2A) and Builder (2B) phases.
- [x] 2.2 Tighten the Startup-mode escape hatch (~220-225): trigger only on explicit skip signals ("just do it" / "skip" / "stop asking, just write it"); a user question or request to explain/discuss routes to Dialogue Override, never the escape hatch; a request for more discussion is not impatience.
- [x] 2.3 Tighten the Builder-mode escape hatch (~261) with the same explicit-skip-signal-only semantics as 2.2.
- [x] 2.4 Add a hard gate to Phase 5 (design-doc writing, ~396): the sole precondition for writing the doc is an explicit user approval of an approach in Phase 4; complaints, silence, and questions are not approval; do not begin the doc without it. Keep Phase 4's existing "Do NOT proceed without user approval" as the upstream gate.
- [x] 2.5 Add a **Consultation posture** to office-hours: when the user opens with a concrete design + a feedback request ("what do you think," "is there a better way"), skip generative questioning, deliver analysis prose directly, discuss peer-to-peer, and only after the discussion converges ask whether to distill it into a design doc (doc = byproduct, not the flow's terminus).

## 3. Regenerate installed skills

- [x] 3.1 Run `pnpm build` (compiles TS → `dist/`; `update` reads templates from `dist/`, so the source edits must be compiled first), then `node dist/cli/index.js update` to regenerate the installed `.claude/skills/*`. Confirm `rasen-office-hours/SKILL.md` and a sample sibling (e.g. `rasen-review/SKILL.md`) now contain the Dialogue Override text.

## 4. Sync golden-master parity test

- [x] 4.1 Run `pnpm vitest run test/core/templates/skill-templates-parity.test.ts` — expect failures for the 14 PREAMBLE-embedding, parity-pinned templates (benchmark, codebase-design, codex, cso, design-consultation, design-review, investigate, navigator, office-hours, prototype, qa, qa-only, review, tdd).
- [x] 4.2 From the assertion diff, copy the actual hashes into `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` in `test/core/templates/skill-templates-parity.test.ts` for the affected templates. Verify that non-PREAMBLE templates (careful, freeze, guard, unfreeze) are NOT among the changed hashes — a diff there signals an unintended edit.
- [x] 4.3 Re-run the parity test until green.

## 5. Verify

- [x] 5.1 Run the full test suite for the affected area: `pnpm vitest run test/core/templates/` (and any office-hours/skill-generation tests). Report pass/fail; note known Windows CLI-spawning EBUSY flakes as non-regressions if they appear.
- [x] 5.2 Run `node dist/cli/index.js validate office-hours-dialogue-override` and confirm the change validates clean.
