## 1. Shared PREAMBLE — vocabulary, mode, denied-edit (`experts/_shared.ts`)

- [x] 1.1 Add a **Canonical severity vocabulary** section to the `PREAMBLE` constant: Blocker/Major/Minor/Trivial with one-line criteria (per design D1).
- [x] 1.2 Add the per-expert **mapping table** (review, cso, qa/qa-only, benchmark, design-review, codex → canonical) with the "content overrides label" rule (design D1).
- [x] 1.3 Add a **Dispatched vs standalone mode** section: the trigger (single-unit-of-work / no-subagents / LEAD-owns-orchestration = dispatched), and the dispatched report-only rules (no AUTO-FIX, no AskUserQuestion, no commit, no subagent; tag canonical severity; write canonical `<skill>-report.md`) (design D2).
- [x] 1.4 Add the **denied-edit honesty** clause near the mode section: freeze/guard-denied edit → report as un-applied, never `[AUTO-FIXED]` (design D6, RV-9).

## 2. Shared blocks — gate mutating steps by mode (`experts/_shared.ts`)

- [x] 2.1 `ADVERSARIAL_STEP`: gate the "Dispatch via the Agent tool" subagent dispatch (medium + large tier) so it does NOT run in dispatched mode; note independence comes from the LEAD's parallel reviewers + non-author re-review (design D3 #7, SH-3).
- [x] 2.2 `TEST_COVERAGE_AUDIT_REVIEW` Step 5: gate "generate the test, run it, commit" so dispatched mode reports coverage gaps as findings only (design D3 #8, SH-3).

## 3. review.ts — Fix-First gating + canonical severity

- [x] 3.1 Scope Step 5 Fix-First AUTO-FIX (5b) to standalone; dispatched mode returns findings only, routing fixes to the LEAD (design D3 #5, RV-5).
- [x] 3.2 Scope Step 5c batched `AskUserQuestion` and the Greptile-triage `AskUserQuestion` to standalone; dispatched reports ASK-class items as unresolved findings (design D3 #6/#13, RV-5c).
- [x] 3.3 Scope the two-axis parallel `Agent` workers to standalone; dispatched runs the two axes inline (design D3 #12, SH-3).
- [x] 3.4 Emit canonical severity: header/output tags each finding Blocker/Major/Minor/Trivial per the mapping; dispatched writes `review-report.md` with canonical severities (design D1/D4). Keep the "Never commit … that's ship's job" rule intact.

## 4. cso.ts — dispatch gating, report path, probe/exclusion alignment (RV-8)

- [x] 4.1 Phase 7 Remediation Roadmap `AskUserQuestion`: scope to standalone; dispatched reports findings only (design D3 #10).
- [x] 4.2 Phase 8 save: standalone keeps `.rasen/security-reports/{date}.json`; dispatched writes `cso-report.md` in the change dir with canonical severities (design D3 #11, D4, RV-3).
- [x] 4.3 RV-8: narrow hard-exclusion #1 to generic DoS/resource-exhaustion/rate-limiting with an explicit exception that auth / security-sensitive-endpoint brute-force IS reportable; keep the A04 auth rate-limit probe (design D5).
- [x] 4.4 RV-8: drop the A09 audit-logging probes (auth-failure logging, admin audit trail) from Phase 2 and drop/annotate the generic-DoS STRIDE probe, to agree with exclusions #16 and #1 (design D5).
- [x] 4.5 Map cso severities to canonical (CRITICAL→Blocker, HIGH→Major, MEDIUM→Minor) in the dispatched output (design D1).

## 5. qa.ts / qa-only.ts — dispatch gating, report path, severity

- [x] 5.1 qa.ts: scope the clean-tree STOP gate, Phase 8 fix loop, and per-fix `git commit` to standalone; dispatched reports findings only, no clean-tree requirement (design D3 #1/#2/#3, RV-4).
- [x] 5.2 qa.ts: Phase 10 save — standalone keeps `.rasen/qa-reports/` + `~/.rasen/projects/`; dispatched writes `qa-report.md` in the change dir with canonical severities (design D4, RV-3).
- [x] 5.3 qa-only.ts: Phase-8/report save — standalone keeps native paths; dispatched writes `qa-report.md` with canonical severities (qa-only never fixes, so only report-path + severity change) (design D4).
- [x] 5.4 Map qa/qa-only severities to canonical (critical→Blocker, high→Major, medium/low→Minor, cosmetic→Trivial) (design D1).

## 6. benchmark.ts / design-review.ts — dispatch gating, report path, severity

- [x] 6.1 benchmark.ts: Phase 9 save — standalone keeps `.rasen/benchmark-reports/`; dispatched writes `benchmark-report.md` with canonical severities; map REGRESSION/WARNING/OK + grade → canonical (design D1/D4).
- [x] 6.2 design-review.ts: scope the clean-tree gate, Phase 8 fix loop, and `git commit` to standalone; dispatched reports findings only (design D3 #4, RV-4).
- [x] 6.3 design-review.ts: Phase 10 save — standalone keeps `.rasen/design-reports/` + `~/.rasen/projects/`; dispatched writes `design-review-report.md` with canonical severities; map impact+letter → canonical (design D1/D4).

## 7. Orchestration Step B — report-contract reconciliation (`workflows/_orchestration.ts`)

- [x] 7.1 Rewrite ONLY the Step B report-contract sentence (currently "…print findings…and save NOTHING; the worker…responsible for ALSO writing…"): drop "save NOTHING"; state dispatched experts run report-only and write the canonical `<skill>-report.md` themselves; the worker verifies presence before returning (design D4, RV-3). Do NOT touch any other Step B/C/D/E/H text (child #3 scope).

## 8. Regenerate, verify, parity

- [x] 8.1 `pnpm build` (update reads dist — must build first).
- [x] 8.2 `node dist/cli/index.js update` to regenerate all skills.
- [x] 8.3 `npx vitest run test/core/templates/` — expect parity hash failures for the affected PREAMBLE-embedding templates.
- [x] 8.4 Hand-paste the new `EXPECTED_FUNCTION_HASHES` / `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` from the assertion diff (no `-u` mechanism); confirm ONLY the expected templates' hashes moved, then re-run `npx vitest run test/core/templates/` green. **Done for this change's 14 PREAMBLE-embedding templates (function + content), all green. NOTE for LEAD:** the parity function-hash test still shows 11 failing `getOpsx*CommandTemplate` entries — the concurrent openspec→rasen rebrand of command-template files (apply-change.ts etc.) this change never touched, NOT caused by this change. Left un-adopted to avoid bundling another session's uncommitted work into this change's parity update; LEAD reconciles cross-session at ship (whole-file bundling precedent).
- [x] 8.5 `node dist/cli/index.js validate prompt-audit-fixes-expert-dispatch` passes.
