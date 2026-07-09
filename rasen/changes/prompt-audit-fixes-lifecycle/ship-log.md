# Ship Log: prompt-audit-fixes-lifecycle

**Date:** 2026-07-09
**Mode:** local
**Branch:** main
**Commit:** 6b4974a57e5eb3a39a78b1194c1bdd8b47609f95
**Tree:** 9b46db86ae2e7fc6aedb74e455d027d5cb06e089
**Status:** Committed (delivery deferred — portfolio delivers once at the end)

## What Shipped

Lifecycle stage contract fix (child #5 of the `prompt-audit-fixes` portfolio): wires the propose/office-hours/archive/apply/continue workflow commands into the evidence chain and gates established by children #1-#3, and closes a resume-ladder generation-match gap in orchestration.

1. **WF-2 — propose consumes office-hours validation** (`propose.ts`, `office-hours.ts`): `/rasen:propose` now checks both `office-hours-design.md` in the change directory and the sibling office-hours directory (by slug) before drafting, incorporating found validation into the proposal and naming office-hours as the source. All paths resolved from status JSON, not hardcoded. office-hours.ts's own producer-side notes (dual-write, auto-detect, downstream integration) were made accurate to match.
2. **WF-6 — office-hours workflow delegates to the expert** (`office-hours.ts`, the workflow command — `experts/office-hours.ts` untouched): restructured so the `/office-hours` expert is the single facilitation authority; the inline six-questions/builder text becomes an explicit fallback pre-brief used only if the expert is unavailable, not a second pass; design-doc production consolidated to one step; precedence stated.
3. **WF-4 — archive verdict + task hard gates** (`archive-change.ts`, both getters): a verification-verdict gate reads `verification-report.md` (child #2's evidence file) and refuses to archive by default when `VERIFY VERDICT: BLOCKED`, requiring an explicit blocker-naming override (refuses outright non-interactively); CLEAN passes with no gate; absent report gets a soft note only. The incomplete-tasks check was elevated from soft warning to hard gate with the same override/refuse semantics. The "don't block archive on warnings" guardrail was re-scoped (enumerate-and-gate sweep of the whole Guardrails block) to soft warnings only, explicitly excluding both new hard gates.
4. **WF-5/WF-11 — archive delivery precondition + portfolio awareness** (`archive-change.ts`, both getters): a soft warning fires when `ship-log.md` is absent ("archive without delivering?", with an explicit escape for spec-only changes); when present and its Status line reads "delivery deferred to portfolio level" (the exact marker `ship.ts` writes in local mode), a note flags that portfolio-level delivery is still pending and prompts for confirmation before archiving the child.
5. **WF-5 (apply) / WF-10 (continue) — completion nudges** (`apply-change.ts`, `continue-change.ts`, both getters each): the all-tasks-complete message now steers through `/rasen:verify` then `/rasen:ship`, naming archive only as the post-delivery step, instead of offering archive as an immediate co-equal option.
6. **F.1 — resume ladder generation-match clause** (`_orchestration.ts`, Step F.1 step 2; LEAD-added mid-review, one tight clause, nothing else in the file touched — children #1/#3's edits survive byte-for-byte): a handoff/retirement document counts only if it's the LATEST holder's own distillation; an un-exhausted latest holder that left no document resumes from its TRANSCRIPT, which beats any earlier generation's document — never seed from a stale predecessor's document when a newer holder's unrecorded context survives. Added the same-session-restart nuance: when the session directory survived a restart, `SendMessage`-by-NAME may still resolve to the latest holder — try that wake first, fall back to the ladder only if it doesn't resolve. This clause was **live-validated during this change's own implementation** (see Infra-Revival Event below).
7. **Parity registry expansion** (`skill-templates-parity.test.ts`): added the 11 previously-unpinned skill templates and 8 command payloads (office-hours-command, verify-enhanced, ship, retro, auto, review-cycle, handoff, goal-plan, goal-iterate, goal-report, goal-command) to the golden master — this is what makes the F.1 edit verifiable, since it hash-locks `rasen-auto`/`rasen-goal`/`rasen-review-cycle` (the three `_orchestration.ts` embedders) for the first time.

Installed skills regenerated. Hash movement: 8 moved function hashes (propose/apply/continue/archive skill getters + their 4 Opsx command variants) + 4 moved content hashes (rasen-propose/apply-change/continue-change/archive-change) from the WF-2/4/5/6/10/11 edits; 19 added function + 11 added content hashes from the new parity-registry entries (task group 6); zero expert-hash movement (no `_shared.ts`/`experts/*` edits in this child) — all confirmed by independent reviewer audit against `--numstat`.

## Infra-Revival Event (H.4(b) applied live)

During fix round 1, the implementer's connection closed mid-edit. The LEAD applied the H.4(b) infra-death protocol established by child #3: `SendMessage`-revived the same agent rather than cold-reconstructing a successor, instructing it to re-orient (re-read tasks.md, check git status) before continuing. Outcome: **zero rework** — the edits had already landed on disk before the interruption, so the revived worker simply confirmed state and continued. This was not charged against relay or stall budget, per the H.4(b) contract. Notably, this is also a live validation of the F.1 same-session-restart nuance this very change was adding: `SendMessage`-by-name resolved the latest holder successfully post-restart, confirming the clause's behavior works as specified before the change's own hash-lock even landed.

## Review Outcome

Review-cycle round 1, verdict **CLEAN** (non-author confirmed). 0 Blocker, 0 Major.

- **1 Minor — fixed round 1:** propose.ts and office-hours.ts modeled slug derivation with *different* example transforms (propose's example abbreviated "add user authentication" -> `add-user-auth`; office-hours' example was verbatim "real-time collaboration" -> `real-time-collaboration`) — two LLM prompts told to "derive kebab-case" from divergent examples could produce different slugs, silently breaking the sibling-dir scan. Fixed: both now teach the identical verbatim, no-abbreviation transform with the same example, plus a convergence note pointing at the shared derivation step.
- **1 Minor — accepted-known (D8, inherent to prior parity debt):** the F.1 edit's hash movement can't be diff-verified against a pre-edit baseline, since `rasen-auto`/`rasen-goal`/`rasen-review-cycle` were pinned in the *same* regen run as the F.1 clause itself — there was no prior pinned state to diff against. This is exactly what task group 6 (parity expansion) was for: locking these three templates makes the clause verifiable *going forward*, even though this first instance can't be diffed. Not a defect — an acknowledged limit of doing the registry-expansion and the edit in the same change.
- **2 Trivial — accepted-known, skipped by design:**
  - office-hours.ts's "Downstream Integration" note describes propose's *reads* as JSON-resolved (accurate) but sits near office-hours' own *hardcoded write* paths (`rasen/changes/<name>/...`), which could read as inconsistent in context — but hardening those write paths is WF-3, explicitly deferred to child #6.
  - The F.1 clause is dense (~90 words, one sentence plus a parenthetical) — correct and in-scope, but near the upper bound of scannability. Tightening was explicitly declined because editing `_orchestration.ts` again would re-churn the newly-locked auto/goal/review-cycle hashes for a purely cosmetic change with zero functional gain.
- **Seam integrity confirmed byte-compatible in both directions:** WF-4's archive gate reads `verification-report.md`'s exact `VERIFY VERDICT: <CLEAN|BLOCKED>` line format as written by child #2's verify-change.ts; WF-5/11's archive precondition reads the exact `ship-log.md` filename and "delivery deferred to portfolio level" marker string as written by `ship.ts` in local mode — the reviewer called this out as "the opposite of the WF-1 disease" (the original bug class this whole portfolio exists to close): the consumer points at a string the producer actually writes, not an aspirational one.

## Known-Open Item for the Portfolio-End Report

**Goal templates registered but `update` doesn't emit `rasen-goal*` skill directories.** The implementer discovered (and this ship confirms via `node dist/cli/index.js update` re-run) that `goal-plan`/`goal-iterate`/`goal-report`/`goal-command` templates ARE registered in the generation registry (closing the gap child #3 flagged as new debt), but the `update` command still doesn't emit their `rasen-goal*` skill directories to `.claude/skills/`. Suspected cause: a deploy-path filter excluding them somewhere in the update pipeline, not yet root-caused. This is **out of this portfolio's declared scope** (registration vs. deployment are different gaps) — flagged here for the final portfolio report, not fixed in this change.

## Test Gate

- Tests: ran green — `npx vitest run test/core/templates/` -> 6/6 passed, re-run at ship time.

## Pre-Flight Results

- Verification: pass (review-report.md + auto-run.json, verdict CLEAN)
- Tasks: 20/20 complete (tasks.md, all 8 numbered groups)

## Delivery

Local mode: committed only, no push, no PR. This is child #5 of the `prompt-audit-fixes` portfolio; delivery happens once at the portfolio/parent level after all children complete, per the user's decision.
