# Review Report — prompt-audit-fixes-verify-ship (child #2)

Reviewer: dispatched, report-only (expert-dispatch contract). Author != reviewer.
Date: 2026-07-09.

## VERDICT (final, after fix round 1): CLEAN — Blocker:0 Major:0 Minor:0 Trivial:2

CLEAN per the review-cycle termination invariant (no open Blocker or Major).
Recommend ship. The 1 Minor was fixed in round 1 (see Findings); the 2 Trivials
are accepted-known per LEAD.

_Round 0 verdict was CLEAN — Blocker:0 Major:0 Minor:1 Trivial:2._

## Scope verified

Working tree touches exactly the 5 tracked files in the mandate
(`workflows/verify-change.ts`, `workflows/verify-enhanced.ts`, `workflows/ship.ts`,
`experts/_shared.ts`, `test/core/templates/skill-templates-parity.test.ts`) plus the
gitignored regenerated `.claude/skills/*`. No out-of-scope edits: `_orchestration.ts`
(child #3), `archive-change.ts` WF-4 gate (child #5), store paths (child #6),
sync-specs (child #5) are all untouched. No rebrand branding churn present in the diff.

## Dimension 1 — Contract fidelity (all 7 findings, D1–D5)

- **WF-1 (D1)** ✓ verify-change gains a **Save Report** step (step 9, BOTH the skill
  getter @148+ and the command getter @345+, byte-identical) writing
  `verification-report.md`. ship pre-flight (`ship.ts:36`) now names it first in the
  evidence list. No orphan producer/consumer: verify-change produces, ship pre-flight
  consumes.
- **WF-7 (D2)** ✓ Both verify variants map native verdicts → canonical
  Blocker/Major/Minor/Trivial (referencing `canonical-severity-vocabulary`, NOT
  re-declaring it) and emit the identical `VERIFY VERDICT: <CLEAN|BLOCKED> — Blocker:<n>
  Major:<n> Minor:<n> Trivial:<n>` line. CLEAN rule identical in both
  (`CLEAN iff no open Blocker and no Major`) = review-cycle termination invariant.
- **WF-8 (D3)** ✓ Both variants record the `TEST EVIDENCE` block (command / result /
  `git rev-parse HEAD^{tree}`) conditionally ("only when tests ran"), matching the
  review-cycle schema. ship's skip gate (`ship.ts:87`) names `verification-report.md`;
  skip-gate LOGIC unchanged (contract honored — it already read "another verification
  report").
- **SH-1 / RV-6 (D4)** ✓ QA_METHODOLOGY #5 scoped to exploration/testing; reinforcer #7
  also scoped (sweep complete — avoids child #1's incomplete-sweep Minor). Carve-outs
  name (a) diff-aware triage and (b) standalone fix loop (qa Phase 8).
- **SH-2 / RV-7 (D4)** ✓ DESIGN_METHODOLOGY #4 exception extended with (b) diff-aware
  map-changed-files and (c) standalone fix loop (design-review Phase 8); states #4
  governs the audit phase.
- chrome-use parity (D5) — see Dimension 4.

## Dimension 2 — Instruction-prose integrity (core risk)

- **Dispatched contract preserved (PASS).** Both carve-outs EXPLICITLY name the
  STANDALONE fix loop and add "it does NOT reopen the dispatched-mode report-only
  contract" (QA #5: "a dispatched reviewer still makes no edits"; DESIGN carve-out (c)
  identical). Child #1's report-only contract for orchestrated qa/design-review is not
  weakened.
- **No new unscoped absolute.** The two edited rules gained scope clauses; no absolute
  was added.
- **Severity mapping does not conflict.** CRITICAL→Blocker / WARNING→Major /
  SUGGESTION→Minor|Trivial. "Ready for archive"/"Fix before archiving" prose is
  explicitly demoted to human narration; the status line is the machine contract — no
  contradiction with the remaining verify text. content-overrides-label preserved in
  verify-change ("a divergence that causes data loss maps to Blocker"); consistent with
  the `canonical-severity-vocabulary` spec.
- **VERIFY VERDICT decidable & consistent.** CLEAN iff no open Blocker/Major, stated
  identically in verify-change (both getters) and verify-enhanced. ship does not parse
  the verdict (still file-exists only) — consistent with D2's "not yet a gating input."

## Dimension 3 — Seam integrity

- ship pre-flight (2a) and skip-gate (2d) evidence sources: every named file has a
  producer (`verification-report.md`←verify-change; `review-report.md`,
  `*-report.md`←dispatched experts / child #1; `review-cycle-report.md`←review loop). No
  producer writes a file no consumer reads — EXCEPT the Minor below.
- `_orchestration.ts` Step B canonical `<skill>-report.md` list is NOT contradicted:
  `verification-report.md` is verify-change's own artifact, correctly absent from Step
  B's dispatched-expert list.
- WF-4 archive-refusal question left untouched (`archive-change.ts` not in diff). ✓

## Dimension 4 — Tests

`npx vitest run test/core/templates/` → 6/6 PASS (exit 0), reproduced by reviewer.
Moved-hash set matches the implementer's claim EXACTLY:
- Function hashes moved: `getVerifyChangeSkillTemplate`, `getOpsxVerifyCommandTemplate`
  (verify-change ×2), `getDesignReviewSkillTemplate`, `getQaSkillTemplate`,
  `getQaOnlySkillTemplate`; ADDED `getChromeUseSkillTemplate`.
- Content hashes moved: `rasen-verify-change`, `rasen-design-review`, `rasen-qa`,
  `rasen-qa-only`; ADDED `rasen-chrome-use`.
- Nothing else moved (review/cso/benchmark/codebase-design/careful/freeze/guard/unfreeze
  + child-1's set all stable). Correct: this change touches only QA_METHODOLOGY /
  DESIGN_METHODOLOGY (embedded in qa/qa-only/design-review) and verify-change; PREAMBLE
  untouched so no PREAMBLE-embedder churn.
- `ship.ts` / `verify-enhanced.ts` are workflow commands OUTSIDE the parity registry —
  no hash movement expected (pre-existing scope, not a gap this change introduced).
- chrome-use added to `functionFactories` + `GENERATED_SKILL_FACTORIES` + both hash
  maps (D5). ✓

## Dimension 5 — Regeneration spot-check

- `rasen-verify-change/SKILL.md`: `VERIFY VERDICT` line, Save Report step,
  `verification-report.md`, `TEST EVIDENCE` block all present. ✓
- `rasen-qa/SKILL.md`: #5/#7 scoped, carve-out names diff-aware triage + STANDALONE fix
  loop. ✓
- `rasen-ship/SKILL.md`: `verification-report.md` in pre-flight (line 36) + skip gate. ✓
- `node dist/cli/index.js validate prompt-audit-fixes-verify-ship` → valid. ✓

## Findings

### [Minor — RESOLVED in fix round 1] verify-change Save-Report prose names `/rasen:retro` as a consumer that does not read `verification-report.md`

**Resolution (verified):** The clause was shortened in both getters to "This is
verify-change's canonical evidence artifact that `/rasen:ship`'s pre-flight looks for."
— the unwired `/rasen:retro` claim is dropped; `/rasen:ship` (the real consumer,
`ship.ts:36`) remains named, so no new dangling reference is introduced. `retro.ts`
untouched; generated `rasen-verify-change/SKILL.md` has 0 `retro` matches. Delta hash
movement is exactly the 3 expected (`getVerifyChangeSkillTemplate`,
`getOpsxVerifyCommandTemplate`, `rasen-verify-change` content); all other hashes
byte-identical to round 0. Parity 6/6 green; validate clean.

_Original finding (round 0):_

`verify-change.ts` (both getters) states: "This is verify-change's canonical evidence
artifact: `/rasen:ship`'s pre-flight looks for it and `/rasen:retro` reads it." ship is
correctly wired, but `retro.ts`'s "Outcome Artifacts" list (`retro.ts:42-46`) enumerates
`review-report.md`, `qa-report.md`, `cso-report.md`, `ship-log.md`,
`office-hours-design.md` — NOT `verification-report.md`. This is a reverse instance of
the exact producer/consumer seam the portfolio targets (WF-1): the producer's prose
promises a consumer that does not actually read the file. Low blast radius (verify writes
the file regardless; the machine gate via ship is complete). Fix: drop "and
`/rasen:retro` reads it" from both getters, OR (out of this change's declared scope) add
`verification-report.md` to retro's Outcome Artifacts list. Recommend the former to stay
in scope.

### [Trivial] QA carve-out (b) references "qa Phase 8" fix loop, inapplicable to qa-only

QA_METHODOLOGY is shared by qa AND qa-only; qa-only never fixes (no Phase 8). The
generated `rasen-qa-only/SKILL.md` therefore carries a carve-out permitting a
source-reading activity it does not perform. Harmless (it permits, does not mandate); the
load-bearing carve-out (a) diff-aware triage applies correctly to qa-only. No action
required.

### [Trivial] verify-enhanced does not restate content-overrides-label

verify-change restates "finding content overrides the label"; verify-enhanced's mapping
paragraph omits it, relying on the referenced `canonical-severity-vocabulary` (which
carries the rule). Acceptable by reference; a one-line asymmetry between the two variants
if perfect symmetry is wanted.

## Durable findings

1. Contract-complete and seam-clean; the only real nit is a false consumer claim
   (`/rasen:retro reads verification-report.md`) — retro's artifact list never gained
   it. Same WF-class seam, reversed. Fix = trim three words to stay in scope.
2. Sweep discipline good: BOTH QA #5 and reinforcer #7 scoped (child #1's incomplete
   sweep produced its only Minor; child #2 did not repeat it).
3. Dispatched report-only contract from child #1 is intact — both carve-outs name
   STANDALONE explicitly and disclaim reopening it.
