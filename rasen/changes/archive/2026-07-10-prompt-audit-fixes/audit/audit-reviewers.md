# Audit — Review/QA/Guard expert prompts

Scope: review, cso, qa, qa-only, benchmark, design-review, codex, chrome-use, tdd, prototype, careful, freeze, guard, unfreeze.
Seam blocks: _shared.ts (PREAMBLE, QA_METHODOLOGY, DESIGN_METHODOLOGY, DESIGN_REVIEW_LITE, ADVERSARIAL_STEP, TEST_COVERAGE_AUDIT_REVIEW), review-cycle.ts, _orchestration.ts (Step B/C/D/E).

Taxonomy: A rule-vs-rule / B missing state / C precedence gap / D wrong-generalization / E buried override / F cross-block seam.
Severity: Critical = wrong behavior on the common path / Major = plausible path / Minor = friction.

---

## RV-1 — Severity scale mismatch: review emits `critical/informational`, the loop consumes `Blocker/Major/Minor/Trivial` (no mapping) — Critical, F

**Side A (the engine)** `experts/review.ts:92-93,144`
> Pass 1 (CRITICAL): SQL & Data Safety... Pass 2 (INFORMATIONAL)...
> `Pre-Landing Review: N issues (X critical, Y informational)`
review.ts uses a **two-level** scale everywhere (`[CRITICAL]`/`[INFORMATIONAL]`, lines 169/173). It never produces Blocker/Major/Minor/Trivial.

**Side B (the consumer)** `workflows/review-cycle.ts:21,67` + `workflows/_orchestration.ts:103,107`
> review-cycle: "delegates each review pass to the always-installed `rasen-review` engine" (= review.ts)
> table header `Findings (B/Ma/Mi/T)` (Blocker/Major/Minor/Trivial)
> Step E.1: "collect findings with severity (Blocker / Major / Minor / Trivial)"
> Step E.5 / termination: "Never report clean while a Blocker or Major finding is open."

**Scenario:** review-cycle (and `/rasen:auto`'s review-loop) dispatch a reviewer worker that invokes `rasen-review`. It returns "3 critical, 5 informational." The loop's termination invariant is defined purely over Blocker/Major. With no mapping rule, the LEAD must guess whether "critical"→Blocker or →Major, and whether "informational"→Minor or →Trivial. A genuinely blocking data-corruption item that review.ts happened to label INFORMATIONAL (its Pass-2 list literally includes "LLM output not type-checked before DB write") is read as non-blocking and the loop reports clean over it. Conversely every "critical" may be treated as Blocker, forcing needless escalation.

**Fix direction:** Either make review.ts emit the Blocker/Major/Minor/Trivial scale, or state an explicit mapping in review-cycle/_orchestration ("critical→Blocker; informational→Minor unless the finding names data loss/security→Major"). Pick one scale as canonical across all reviewers.

---

## RV-2 — Every parallelGroup expert speaks a different severity scale; the verify loop collects them with no normalization — Major, F

**Side A (the experts, each different):**
- `experts/cso.ts:300` — `CRITICAL | HIGH | MEDIUM` (no Low/Trivial; anything <8/10 confidence dropped)
- `experts/qa.ts` + `_shared.ts` QA health rubric (`_shared.ts:513-517`) — `critical / high / medium / low / cosmetic`
- `experts/benchmark.ts:141,189` — `REGRESSION / WARNING / OK` plus letter `Grade: B`
- `experts/design-review.ts` + `_shared.ts` DESIGN (`_shared.ts:857-863`) — impact `high / medium / polish` plus letter grades `A–F`
- `experts/codex.ts:84` — `[P1]/[P2]` + `GATE PASS/FAIL`

**Side B** `_orchestration.ts:90` (Step D)
> "a `verify` stage with `parallelGroup=experts` becomes one reviewer worker per condition-met expert skill (review / cso / benchmark / design-review / qa), all dispatched at once and all results collected before the loop."
Loop then triages by Blocker/Major/Minor/Trivial (`_orchestration.ts:103`).

**Scenario:** the verify stage fans out to five experts. cso hands back "HIGH", benchmark "REGRESSION", design-review "impact: high / grade C". The loop has to fold all of these into one Blocker/Major/Minor/Trivial triage to decide clean-vs-loop, but no cross-scale mapping exists. A benchmark REGRESSION or a cso HIGH may silently be treated as non-blocking (not "Blocker/Major"), so `ship` proceeds; or the LEAD invents inconsistent mappings per run.

**Fix direction:** define one canonical severity vocabulary and a per-expert mapping table in _orchestration Step D (or in each expert). At minimum state how REGRESSION / letter-grades / HIGH map to Blocker/Major.

---

## RV-3 — Report-file contract inverted: experts save their OWN reports at skill-specific paths; Step B says they "save NOTHING" and the worker writes the canonical file — Major (borderline Critical), F

**Side A** `_orchestration.ts:56` (Step B)
> "the generic expert skills (review / cso / qa / qa-only / benchmark / design-review) print findings to the conversation and save NOTHING; the worker that invokes them is responsible for ALSO writing the findings to the canonical report file: `review-report.md`, `cso-report.md`, `qa-report.md`, `benchmark-report.md`, `design-review-report.md`. These files are what the resume artifact cross-check, `ship`'s verification pre-flight, and `retro` consume."

**Side B (the experts DO save, at other paths/formats):**
- `cso.ts:322-332` — `mkdir -p .rasen/security-reports` → writes `.rasen/security-reports/{date}.json` (JSON, not `cso-report.md`)
- `qa.ts:256-264` — writes `.rasen/qa-reports/qa-report-{domain}-{YYYY-MM-DD}.md` **and** `~/.rasen/projects/{slug}/...` (not `qa-report.md`)
- `qa-only.ts:59-67` — same qa paths (not `qa-report.md`)
- `benchmark.ts:210-212` — writes `.rasen/benchmark-reports/{date}-benchmark.md` + `.json` (not `benchmark-report.md`)
- `design-review.ts:200-208` — writes `.rasen/design-reports/design-audit-{domain}-{date}.md` + project-scoped (not `design-review-report.md`)

**Scenario:** under `/rasen:auto`, the verify worker faithfully runs cso.ts, which writes `.rasen/security-reports/2026-07-09.json`. Step B's consumers (`ship`'s verification pre-flight, `retro`, the resume artifact cross-check) look for `rasen/changes/<name>/cso-report.md`, find nothing, and conclude the security pass never ran — or the worker dutifully writes cso-report.md too and now there are two divergent reports in two locations/formats. The premise "save NOTHING" is factually wrong for 5 of the 6 named skills (only review.ts truly saves no report file), so the worker's dispatch instruction and the skill's own Phase-8/Phase-10 fight each other every run.

**Fix direction:** reconcile the two — either drop the skills' self-save phases when run under orchestration (add a "when dispatched, write only the canonical `<role>-report.md`" clause) or change Step B to point consumers at the skills' real output paths. Remove the false "save NOTHING" claim.

---

## RV-4 — qa & design-review are fix+commit skills, but the orchestration treats them as read-only reviewers in a concurrent verify group — Major, F/C

**Side A** `_orchestration.ts:56,90`
> Step B: "generic expert skills (... qa ... design-review) print findings to the conversation and save NOTHING"
> Step D: verify `parallelGroup=experts` → "one reviewer worker per ... expert skill (review / cso / benchmark / design-review / qa), all dispatched at once"

**Side B** the skills mutate and commit, and require a clean tree:
- `qa.ts:12` "QA engineer AND a bug-fix engineer"; `qa.ts:34-48` STOP if `git status --porcelain` non-empty; `qa.ts:143-146` `git add`/`git commit` one-per-fix
- `design-review.ts:33-47` clean-tree gate; `design-review.ts:129-132` `git commit`
- (review.ts also mutates via AUTO-FIX — RV-5)

**Scenario:** the verify stage dispatches review + qa + design-review concurrently against ONE working tree. All three read `git status --porcelain`; qa and design-review each demand a clean tree and then start committing fixes. Concurrent `git add`/`git commit` from parallel workers on the shared index interleave (the exact class of index-clobber the project has already hit), and each skill's clean-tree precondition is violated by its siblings' in-flight edits. Additionally qa/design-review self-certify their own fixes ("verified" in 8e), so a "reviewer" in the verify group is both author and verifier — contradicting Step C (`_orchestration.ts:80-82`).

**Fix direction:** mark qa/design-review as mutating (not read-only) skills; when dispatched in a verify/parallel group force their report-only behavior (like qa-only) or run them serially with an isolated tree; never list a fix+commit skill as a concurrent "reviewer."

---

## RV-5 — `rasen-review` is Fix-First (auto-applies edits + AskUserQuestion), but review-cycle delegates to it expecting a pure findings-returning reviewer — Critical, F

**Side A** `review.ts:140-186,257`
> Step 5 Fix-First: "Every finding gets action." 5b "Apply each fix directly." 5c batches remaining items into `AskUserQuestion`. Line 257: "AUTO-FIX items are applied directly."

**Side B** `review-cycle.ts:21` + `_orchestration.ts:103-106` (Step E)
> "each review pass delegates to the always-installed `rasen-review` engine"; the loop then separately does "**Triage by fix size**" and "**Fix** via the routed actor" with a **non-author** re-review. Step C: "The worker that re-reviews a fix MUST NOT be the worker that authored the fix."

**Scenario:** review-cycle's model is review(collect findings) → LEAD triages → separate fixer → non-author re-reviews. But the reviewer worker invokes `rasen-review`, which *itself* auto-applies fixes and calls `AskUserQuestion` mid-pass. So (a) the reviewer mutates code — it is now the fixer, collapsing author≠verifier; (b) the LEAD's triage/route step operates on findings the reviewer already fixed, causing double-fixing or confusion about what's still open; (c) `AskUserQuestion` fired from a dispatched leaf worker has no interactive user in the auto/review-cycle path, so it blocks or fails. The whole point of the loop (structurally independent re-review) is defeated on its primary path.

**Fix direction:** give review.ts a "findings-only / non-interactive" mode used when dispatched under orchestration (no AUTO-FIX, no AskUserQuestion — just return classified findings), or have review-cycle invoke a review variant that only reports. State which mode the reviewer worker must use.

---

## RV-6 — qa.ts internal contradiction: "Never read source code" vs "Read the source code" in the fix loop — Major, A (calibration family: memorable-but-wrong-in-context rule)

**Side A** `_shared.ts:571` (QA_METHODOLOGY Important Rules #5, embedded verbatim in qa.ts Phases 1-6)
> "5. **Never read source code.** Test as a user, not a developer."

**Side B** `qa.ts:127-146` (Phase 8 Fix Loop, same skill)
> 8a "Grep for error messages, component names, route definitions"; 8b "**Read the source code**, understand the context. Make the minimal fix."

**Scenario:** qa.ts is a test→fix→verify skill. An agent anchored on the memorable imperative "Never read source code" (rule #5, stated as an absolute) refuses to read source in Phase 8, cannot locate the buggy file, and marks every issue "deferred / cannot fix from source." Or it reads source and knowingly violates a rule stated as absolute. Rule #5 is correct for the *testing* phases but is un-scoped and directly negates the fix phase of the same skill. This is the exact failure family flagged (an escape-hatch/memorable rule matching the opposite intent).

**Fix direction:** scope rule #5 to the exploration/testing phases ("during exploration, test as a user — do not read source to form findings; the fix loop reads source"). Same edit needed in the shared block if it must serve both qa and qa-only.

---

## RV-7 — design-review.ts internal contradiction: "Never read source code" vs "Read the source code" in the fix loop — Major, A

**Side A** `_shared.ts:907` (DESIGN_METHODOLOGY Important Rules #4, embedded in design-review.ts Phases 1-6)
> "4. **Never read source code.** Evaluate the rendered site, not the implementation. (Exception: offer to write DESIGN.md...)"

**Side B** `design-review.ts:120-132` (Phase 8 Fix Loop)
> 8b "**Read the source code**, understand the context. Make the minimal fix." + 8c `git commit`.

**Scenario:** identical to RV-6. design-review is a design-audit→fix→verify skill; the absolute "never read source" (rule #4) negates the fix phase. An agent that honors #4 can never perform Phase 8, defeating the "→ Fix → Verify" half of the skill; one that ignores it violates a rule presented as absolute. The single carved-out exception (DESIGN.md) reinforces that #4 is meant absolutely except for that one case — so reading source to fix is not covered.

**Fix direction:** scope rule #4 to the audit phases; add fix-loop source reading as an explicit allowed activity (parallel to RV-6).

---

## RV-8 — cso assesses categories in Phase 2 that Phase 5 then hard-excludes from findings — Minor, A

**Side A (assess it)** `cso.ts:105,146-150,168`
> A04: "Are there rate limits on authentication endpoints?"
> A09: "Are authorization failures logged? ... Are admin actions audit-trailed?"
> STRIDE: "Denial of Service: Can the component be overwhelmed?"

**Side B (discard it)** `cso.ts:205,226`
> Hard exclusion #1: "Denial of Service (DOS), resource exhaustion, or **rate limiting** issues" → automatically discard.
> Hard exclusion #16: "**Missing audit logs** — absence of logging is not a vulnerability."

**Scenario:** the agent spends Phase 2/Phase 3 analyzing rate limiting, DoS, and audit-logging (explicitly instructed to), finds e.g. "no rate limit on /login" or "auth failures not logged," then Phase 5 forces discarding exactly those. Net: guaranteed wasted analysis, and a checklist item that can never surface a finding. In a gate context "no findings" then reads as "secure." Not wrong behavior per se (zero-noise is intentional) — but the two passes are internally inconsistent about whether these classes matter.

**Fix direction:** either drop the A04-rate-limit / A09-logging probes from Phase 2, or narrow the hard exclusions (e.g. "missing brute-force protection on auth IS reportable"; keep generic DoS excluded). Make Phase 2 and Phase 5 agree on scope.

---

## RV-9 — freeze/guard block edits outside a boundary; review/qa/design-review auto-fix files with no precedence acknowledged — Minor, C

**Side A** `freeze.ts:39-43`, `guard.ts` — hook returns `permissionDecision: "deny"` for any Edit/Write outside the freeze directory (a hard block, not a warning).

**Side B** `review.ts:152-154` (AUTO-FIX applies edits), `qa.ts:135-146` (fix + commit), `design-review.ts:120-132` (fix + commit) — all edit source files, potentially outside a freeze boundary. None of the review/fix skills mention freeze/guard precedence.

**Scenario:** user runs `/freeze src/api` then `/review`. review's Fix-First tries to AUTO-FIX a finding in `src/web/foo.tsx`; the freeze hook denies the Write. review.ts has no handling for a denied auto-fix — it either silently drops the fix (reports `[AUTO-FIXED]` for an edit that never landed) or stalls. The hook correctly wins, but the review skill's Fix-First flow assumes edits always succeed.

**Fix direction:** low priority. Add a note in the Fix-First flow that a denied edit (freeze/guard active) must be reported as an un-applied finding, not as `[AUTO-FIXED]`. Precedence is fine (hook wins); the gap is the skill not expecting denial.

---

## Notes / non-findings (checked, resolved)
- **codex.ts** [P1]/[P2] + GATE: internally consistent; codex is NOT in Step B's generic-expert list nor the parallelGroup, so its scale only meets others in ADVERSARIAL_STEP synthesis (display-only merge of critical/informational + P1/P2 + FIXABLE/INVESTIGATE) — cosmetic, not gate-consumed. Left out to avoid noise.
- **chrome-use.ts / tdd.ts / prototype.ts**: no severity/report/author-verifier seam; self-consistent. tdd's "refactoring is not part of the loop → code-review skill" is a clean handoff, not a conflict.
- **qa-only.ts** "Never read source code" (rule #5 + additional rule 11): consistent — qa-only never fixes, so no internal contradiction (unlike qa/design-review). Its report-path issue is covered by RV-3.
- **careful.ts / unfreeze.ts**: self-consistent; `$HOME/.gstack` state path is branding staleness (excluded per scope), not behavior-changing as long as freeze/guard/unfreeze all read the same path (they do).
- **review.ts "never commit" (line 257) vs qa/design-review commit**: real inconsistency across the "expert" set, folded into RV-4 (they should not be grouped as uniform experts).

---

### Summary
- Critical: 2 (RV-1, RV-5)
- Major: 5 (RV-2, RV-3, RV-4, RV-6, RV-7)
- Minor: 2 (RV-8, RV-9)
- Total: 9
