## 1. verify-change — persist report + canonical verdict + evidence (`workflows/verify-change.ts`)

- [x] 1.1 Add a **Save Report** step (to BOTH the skill getter and the command getter) that writes `rasen/changes/<name>/verification-report.md` with the summary scorecard, verdict status line, and grouped findings (design D1, WF-1).
- [x] 1.2 Map verify-change's CRITICAL/WARNING/SUGGESTION onto canonical Blocker/Major/Minor/Trivial, referencing (not re-declaring) the PREAMBLE `canonical-severity-vocabulary`; keep the human-facing prose as narration (design D2, WF-7).
- [x] 1.3 Emit the machine-checkable status line `VERIFY VERDICT: <CLEAN|BLOCKED> — Blocker:<n> Major:<n> Minor:<n> Trivial:<n>` into the report and conversation; CLEAN iff no open Blocker/Major (design D2). Apply to BOTH getters identically.
- [x] 1.4 When verify-change runs any test/gate command, record a test-evidence block (command(s) + result + `git rev-parse HEAD^{tree}`) into the report, matching the review-cycle schema (design D3, WF-8).

## 2. verify-enhanced — canonical verdict + evidence (`workflows/verify-enhanced.ts`)

- [x] 2.1 Map verify-enhanced's Critical Issues / Warnings / per-stage PASS-FAIL onto canonical Blocker/Major/Minor/Trivial (reference canonical-severity-vocabulary); keep per-stage PASS/FAIL as a display aid (design D2, WF-7).
- [x] 2.2 Emit the same `VERIFY VERDICT:` status line into the reports it writes (§5 Save Reports region) (design D2).
- [x] 2.3 When verify-enhanced runs the test/gate suite, record the tree-fingerprinted test-evidence block into its report (design D3, WF-8).

## 3. ship — consume the evidence (`workflows/ship.ts`)

- [x] 3.1 Add `verification-report.md` to the pre-flight verification-evidence list (`ship.ts` step 2a) so `/rasen:verify` satisfies the gate (design D1, WF-1).
- [x] 3.2 Name `verification-report.md` explicitly in the evidence-based test-skip gate's evidence sources (`ship.ts` step 2d) (design D3, WF-8). Do NOT change the skip-gate logic — it already reads "another verification report."

## 4. Scope "Never read source code" (`experts/_shared.ts`)

- [x] 4.1 QA_METHODOLOGY "Important Rules": scope #5 (and note #7) to the exploration/testing phase; add the enumerate-and-gate carve-out naming (a) diff-aware triage (map changed files → routes/pages) and (b) the standalone fix loop (qa Phase 8). Sweep confirmed: #5/#7 are the only read-source absolutes in the block (design D4, SH-1, RV-6).
- [x] 4.2 DESIGN_METHODOLOGY "Important Rules": extend #4's exception to include (b) diff-aware map-changed-files and (c) the standalone fix loop (design-review Phase 8); state #4 governs the audit phase. Sweep confirmed: #4 is the only read-source absolute (design D4, SH-2, RV-7).
- [x] 4.3 Verify the carve-outs name the STANDALONE fix loop (not the dispatched-mode reviewer, which child #1 made report-only) so child #1's contract stays intact.

## 5. chrome-use parity coverage (`test/core/templates/skill-templates-parity.test.ts`)

- [x] 5.1 Import/add `getChromeUseSkillTemplate` to `functionFactories` and add `['rasen-chrome-use', getChromeUseSkillTemplate]` to `GENERATED_SKILL_FACTORIES` (design D5).
- [x] 5.2 Add the computed `chrome-use` entries to `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` (hand-paste from the run in §6).

## 6. Regenerate, verify, parity

- [x] 6.1 `pnpm build` — if the pnpm workspace file is mid-flight/broken, fall back to `node build.js`.
- [x] 6.2 `node dist/cli/index.js update` to regenerate all skills.
- [x] 6.3 `npx vitest run test/core/templates/` — expect parity hash failures for qa/qa-only/design-review (QA/DESIGN methodology edits) plus the newly-added chrome-use entries; verify-change/verify-enhanced/ship are commands (check their content-parity too).
- [x] 6.4 Hand-paste new `EXPECTED_FUNCTION_HASHES` / `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` from the assertion diff (no `-u` mechanism); confirm ONLY the expected templates' hashes moved (qa, qa-only, design-review, + new chrome-use); then re-run `npx vitest run test/core/templates/` green.
- [x] 6.5 `node dist/cli/index.js validate prompt-audit-fixes-verify-ship` passes.
