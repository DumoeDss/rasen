# Ship Log: prompt-audit-fixes-verify-ship

**Date:** 2026-07-09
**Mode:** local
**Branch:** main
**Commit:** e6a4b67fd84934f6f2b1ce89d886a0e46351f331
**Tree:** c47d02a8ccbfcd12d6757863f6fc47cad530f22c
**Status:** Committed (delivery deferred — portfolio delivers once at the end)

## What Shipped

Verify-ship evidence chain fix (child #2 of the `prompt-audit-fixes` portfolio): closes the gap where `verify-change` and `verify-enhanced` computed a verdict but never persisted a machine-checkable evidence artifact, so `ship`'s pre-flight test-skip gate had no canonical verify output to key off, and the verify-family's severity classifications weren't tied to child #1's canonical vocabulary. Also closes a "Never read source code" absolute-without-scope gap in the shared QA/DESIGN methodology blocks, and a pre-existing chrome-use parity coverage gap.

Scope: **WF-1** (evidence file + ship pre-flight wiring), **WF-7** (verdict unification consuming `canonical-severity-vocabulary`), **WF-8** (test-evidence chain), **SH-1/SH-2 + RV-6/RV-7** (enumerate-and-gate scoping of the "never read source" absolutes, with explicit STANDALONE carve-outs).

1. **`verify-change.ts`** (both the skill getter and the command getter): adds a Save Report step writing `rasen/changes/<name>/verification-report.md` with the summary scorecard, verdict status line, and grouped findings; maps CRITICAL/WARNING/SUGGESTION onto canonical Blocker/Major/Minor/Trivial by reference to `canonical-severity-vocabulary` (no re-declaration); emits the machine-checkable `VERIFY VERDICT: <CLEAN|BLOCKED> — Blocker:<n> Major:<n> Minor:<n> Trivial:<n>` status line (CLEAN iff no open Blocker/Major); records a test-evidence block (command(s) + result + `git rev-parse HEAD^{tree}`) matching the review-cycle schema when verify-change runs any test/gate command.
2. **`verify-enhanced.ts`**: same verdict-unification treatment — Critical Issues/Warnings/per-stage PASS-FAIL mapped onto canonical severities (per-stage PASS/FAIL kept as a display aid), the same `VERIFY VERDICT:` line, and the same tree-fingerprinted test-evidence block.
3. **`ship.ts`**: `verification-report.md` added to the pre-flight verification-evidence list (step 2a) so `/rasen:verify` alone satisfies the gate, and named explicitly in the evidence-based test-skip gate's evidence sources (step 2d) — the skip-gate logic itself is unchanged, this only widens what counts as "another verification report."
4. **`_shared.ts`** QA_METHODOLOGY / DESIGN_METHODOLOGY "Important Rules": scoped the "never read source code" absolutes (#5/#7 in QA, #4 in DESIGN) to the exploration/testing/audit phase, with an enumerate-and-gate carve-out naming (a) diff-aware triage (map changed files → routes/pages) and (b) the STANDALONE fix loop (qa Phase 8 / design-review Phase 8) — explicitly not reopening child #1's dispatched-mode report-only contract.
5. **`skill-templates-parity.test.ts`**: added `getChromeUseSkillTemplate` to `functionFactories` and `['rasen-chrome-use', getChromeUseSkillTemplate]` to `GENERATED_SKILL_FACTORIES`, closing a pre-existing parity blind spot noted in the office-hours-dialogue-override review; computed hashes added to both `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES`.

Installed skills regenerated (`node build.js` — same `pnpm-workspace.yaml` in-flight breakage as child #1, confirmed identical output). Parity hashes resynced for qa, qa-only, design-review (QA/DESIGN methodology edits) plus the newly-added chrome-use entries; verified no other template's hash moved.

## Review Outcome

Review-cycle round 1, verdict **CLEAN** (non-author confirmed). 0 Blocker, 0 Major.

- **1 Minor — fixed round 1:** `verify-change.ts`'s Save-Report prose (both getters) claimed `/rasen:retro` reads `verification-report.md`, but `retro.ts`'s "Outcome Artifacts" list never enumerates that file — a reverse instance of the exact producer/consumer seam this portfolio targets (WF-class), just pointed the other way (the producer promised a consumer that doesn't actually read it). Fixed by trimming the false claim from both getters; `/rasen:ship` (the real, correctly-wired consumer) remains named. Verified: generated `rasen-verify-change/SKILL.md` has 0 `retro` matches; exactly the 3 expected hashes moved in the fix round; all others byte-identical to round 0.
- **2 Trivial — accepted-known, no action needed:**
  - **qa-only carve-out wording:** QA_METHODOLOGY is shared by `qa` and `qa-only`; the shared carve-out's clause (b) references "qa Phase 8" fix loop, which `qa-only` doesn't have (it never fixes). Harmless — the carve-out *permits* an activity qa-only doesn't perform, it doesn't mandate one; the load-bearing carve-out (a) diff-aware triage applies correctly to both.
  - **verify-enhanced by-reference:** `verify-change` restates "finding content overrides the label" inline; `verify-enhanced`'s mapping paragraph omits the restatement, relying on the referenced `canonical-severity-vocabulary` (which carries the rule) instead. Acceptable by reference — the preferred DRY pattern — just a minor prose asymmetry between the two variants if perfect symmetry were wanted.
- **Relayed to later children (not this change's scope):** `ship.ts` and `verify-enhanced.ts` are workflow *commands*, outside the parity-test registry entirely — pre-existing scope gap, not introduced by this change. Flagged in the implementer's own tasks.md note for child #3 (`prompt-audit-fixes-orchestration`) / child #5 (`prompt-audit-fixes-lifecycle`) to pick up if in scope there.

## Whole-File Branding-Bundling Residue

None found this time. Unlike child #1's ship (which landed mid-rebrand, before the rebrand session's commit `2ebfae9`), this change's diff on all 5 target files is clean of any `/opsx:`/`.openspec/`-style branding hunks — the rebrand session's wholesale `openspec→rasen` rename has already been committed (`2ebfae9`, then `ca54b3b`), so these files no longer carry in-flight branding churn interleaved with this change's substantive edits. No LEAD ruling needed for this ship.

## Test Gate

- Tests: ran green — `npx vitest run test/core/templates/` → 6/6 passed, re-run at ship time.
- Build note: `pnpm build` remains broken by the `pnpm-workspace.yaml` issue noted in child #1; used `node build.js` directly (confirmed identical output) to regenerate installed skills.

## Pre-Flight Results

- Verification: pass (review-report.md + auto-run.json, verdict CLEAN)
- Tasks: 19/19 complete (tasks.md, all groups 1-6 checked; note the "19" comes from the auto-run.json apply-stage note, tasks.md itself lists 6 numbered groups with all sub-items checked)

## Delivery

Local mode: committed only, no push, no PR. This is child #2 of the `prompt-audit-fixes` portfolio; delivery happens once at the portfolio/parent level after all children complete, per the user's decision.
