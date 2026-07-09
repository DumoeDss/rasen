## Why

The grills-derived expert skills (review, cso, qa, qa-only, benchmark, design-review) were absorbed as full-featured standalone tools — each fixes, commits, asks the user, spawns adversarial subagents, and self-saves reports at its own path. But the auto / review-cycle / verify pipeline dispatches them as role-isolated **leaf reviewer workers** that must be report-only, non-author, no-spawn, and hand off through the change directory. The two contracts collide on the common path: a dispatched reviewer mutates the diff it is reviewing (collapsing author≠verifier), fires AskUserQuestion with no interactive user (blocks), spawns subagents (breaks the flat-hierarchy accounting), and writes reports where the pipeline never looks. On top of that, six experts each speak a different severity scale while the loop's clean/escalate decision is defined purely over Blocker/Major/Minor/Trivial with no mapping — so a genuinely blocking finding can be read as non-blocking and shipped. This is the audit's "重中之重": we must take the精华 of these absorbed behaviors and cut the糟粕, not leave a缝合怪.

## What Changes

- **Canonical severity vocabulary.** Establish Blocker/Major/Minor/Trivial as the one canonical scale (already the loop's consumer vocabulary) and carry an explicit per-expert mapping table in the shared expert PREAMBLE. In dispatched mode each expert self-maps and tags every finding with a canonical severity, so the LEAD/loop never guesses. (RV-1, RV-2)
- **Dispatched vs standalone mode contract.** Define, in the PREAMBLE, a report-only "dispatched" mode that every generic expert enters when invoked by an orchestrating LEAD (the dispatch prompt already says "do only this one unit of work — do NOT spawn subagents; the LEAD owns orchestration"). Dispatched mode: no AUTO-FIX, no AskUserQuestion, no git commit, no self-spawned subagents; return classified findings and write the canonical `<skill>-report.md` in the change directory. Standalone (direct user) mode keeps the richer behavior where adjudicated genuinely beneficial. (RV-4, RV-5, SH-3)
- **Adjudication of every grills behavior (KEEP/ADAPT/CUT).** design.md carries the full table: qa/design-review fix-loop + commit + clean-tree gate, review Fix-First AUTO-FIX + AskUserQuestion batching, ADVERSARIAL_STEP subagent dispatch, TEST_COVERAGE generate+commit, self-saved report paths — each adjudicated with a rationale grounded in "does this genuinely benefit rasen's role-isolated pipeline."
- **Report-file contract reconciled.** Drop the false "save NOTHING" claim in orchestration Step B. One convention: dispatched mode writes ONLY the canonical `<skill>-report.md` in the change dir (the expert writes it, the worker verifies presence); standalone mode may keep its skill-specific `.rasen/*-reports/` + `~/.rasen/projects/` paths. (RV-3)
- **cso probe/exclusion alignment.** Make cso Phase 2 assessment agree with Phase 5 hard exclusions: keep the auth brute-force / rate-limit probe and narrow the DoS exclusion to admit it; drop the generic audit-logging probe and generic-DoS STRIDE probe that Phase 5 always discards. (RV-8)
- **Denied-edit honesty.** A Fix-First / fix-loop edit denied by an active /freeze or /guard boundary MUST be reported as an un-applied finding, never as `[AUTO-FIXED]`. (RV-9)

## Capabilities

### New Capabilities
- `expert-dispatch-contract`: the dispatched vs standalone mode contract for generic expert skills — report-only gating (no fix/ask/commit/subagent) when orchestrated, the canonical report-file convention reconciling orchestration Step B with the skills' real save behavior, and denied-edit honesty. Covers RV-3, RV-4, RV-5, SH-3, RV-9.
- `canonical-severity-vocabulary`: Blocker/Major/Minor/Trivial as the single canonical scale plus the per-expert mapping table (critical/informational, CRITICAL|HIGH|MEDIUM, REGRESSION/WARNING/Grade, impact+letter, critical..cosmetic, P1/P2), carried in the PREAMBLE and self-applied by experts in dispatched mode. Covers RV-1, RV-2.
- `cso-finding-scope`: cso Phase 2 probes agree with Phase 5 hard exclusions (auth brute-force reportable, generic DoS excluded, audit-logging probe dropped). Covers RV-8.

### Modified Capabilities
<!-- None. The existing loop-side vocabulary (Blocker/Major) in review-cycle-workflow / opsx-orchestration is the CONSUMER side and is unchanged; this change defines the PRODUCER side. No existing spec asserts the "save NOTHING" behavior at the requirement level, so Step B's template edit is captured by the new expert-dispatch-contract capability. -->

## Impact

- **Source (only TS templates):** `src/core/templates/experts/_shared.ts` (PREAMBLE: severity vocabulary + dispatched-mode contract + denied-edit honesty; ADVERSARIAL_STEP: gate subagent dispatch; TEST_COVERAGE: gate generate+commit), `experts/review.ts` (Step 5 Fix-First gating + canonical severity), `experts/cso.ts` (RV-8 + dispatch gating + report path), `experts/qa.ts`, `experts/qa-only.ts`, `experts/benchmark.ts`, `experts/design-review.ts` (dispatch gating + canonical report path + severity mapping), and one sentence in `workflows/_orchestration.ts` Step B (report-contract reconciliation only).
- **Generated skills:** all PREAMBLE-embedding `SKILL.md` files regenerate; parity golden master (`test/core/templates/skill-templates-parity.test.ts`) hashes recomputed by hand.
- **Downstream interface:** the canonical severity vocabulary defined here is consumed by child #2 (`prompt-audit-fixes-verify-ship`) for verify verdict / ship gate alignment — noted in design.md.
- **Out of scope (other children):** verify/ship seams (WF-1/7/8), "Never read source" scoping (RV-6/RV-7/SH-1/SH-2 → child #2), orchestration Step E/H text (child #3), store paths (child #6).
