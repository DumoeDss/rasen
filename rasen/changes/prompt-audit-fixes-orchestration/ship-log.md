# Ship Log: prompt-audit-fixes-orchestration

**Date:** 2026-07-09
**Mode:** local
**Branch:** main
**Commit:** becf9184404ef26accbda9e6cc752b951290d560
**Tree:** f89cfd27beed56e2698e3ca1f24ce4e4a2dc8a20
**Status:** Committed (delivery deferred — portfolio delivers once at the end)

## What Shipped

Orchestration worker lifecycle fix (child #3 of the `prompt-audit-fixes` portfolio): closes a family of ambiguities in the LEAD orchestration playbook (`_orchestration.ts`, `auto.ts`, `goal-command.ts`) around worker death, threshold counters, and gate semantics — cases where the same-sounding number or event was governed by two different rules depending on context, with no explicit disambiguation.

1. **OR-1 / SH-4 — Threshold family disambiguation:** the playbook previously used similar-sounding thresholds (relay caps, stall limits, round caps) across different lifecycle events without stating which applies where. Fixed by naming each threshold family explicitly and scoping it to the event it governs.
2. **H.4 / OR-6 — Worker-death taxonomy + infra revival:** defines a two-branch death taxonomy — (a) genuine work-exhaustion (HANDOFF) vs (b) infrastructure death (process/connection failure) — and states that an infra-death SendMessage-triggered revival is NOT charged against the relay/stall caps that govern (a), since it isn't a work-exhaustion signal. The boundary between (a) and (b) has a documented residual ambiguity (a silently-exhausted worker can misclassify as (b)) — explicitly accepted in design Risks as cheap/self-correcting, since a genuinely-full worker HANDOFFs on the wake turn and gets reclassified.
3. **OR-9 / OR-13 / OR-15 — Counter disambiguation:** a counter table maps every counter token used anywhere in the playbook (maxRelays, stallLimit, maxRounds, loop.maxRounds, strategyAttempts, loopStallLimit, sessionHandoff.n) to its exact governing rule — verified by grep audit that every counter mentioned anywhere resolves to a table row with matching semantics, no orphans.
4. **Run-state / loop-role / portfolio / Tier-C:** Tier-C worker-evaluation degradations (OR-4, OR-14) scoped so the LEAD never self-certifies a Tier-C implementer's work without an independent check; `verifyPolicy` standard/light modes defined (in `auto.ts` §5, since `verify` stages only run under the auto command).
5. **OR-8 / OR-11 / SH-5 / SH-7 — Schema/policy + PREAMBLE/LEAD scope:** SH-5 scopes the LEAD's "flag it" duty — out-of-scope issues the LEAD notices route to DONE durable-findings (not autonomous investigate/fix/ask-user); the last sentence explicitly disclaims reopening child #1's dispatched-mode report-only contract, keeping the two channels (in-scope findings -> `*-report.md`; unrelated noticed issues -> durable-findings) distinct. SH-7 defines a narrow inline-fix exception.
6. **Gate directive precedence (D6):** Step G of the orchestration playbook resolves how a decomposed portfolio's child-pipeline gates behave when the parent run carries no explicit gate directive — the chosen default is **auto-continue** (record the gate decision as a checkpoint, do not pause per child), with pausing reserved for when the user explicitly requested gating. The literal "always pause at every gate" reading is deliberately rejected for no-directive portfolio runs, since irreversible actions collapse to the single portfolio-level delivery decision at the end. This was a LEAD ruling (see below), not a silent default — round 2 of review tightened the prose (Step G sentence 1) after the reviewer flagged that the original wording could be misread as contradicting this default.

Installed skills regenerated (`node build.js`). Parity hashes resynced for the 15 PREAMBLE-importing expert templates (careful/freeze/guard/unfreeze do NOT import PREAMBLE and correctly show zero hash movement — task-note originally miscounted this as 19, corrected to 15 in fix round 1).

## LEAD Ruling: D6 Child-Gate Default (auto-continue for no-directive portfolios)

**Decision:** when a decomposed portfolio runs with no explicit gate directive from the user, child-pipeline gates default to **auto-continue** — the LEAD records the gate decision as a checkpoint and proceeds, rather than pausing for human confirmation at every child gate. This is deliberate: irreversible actions (ship, archive, delivery) already collapse to a single portfolio-level decision point at the end of the whole portfolio, so per-child gate pauses would be redundant friction without added safety for a no-directive run.

**This is a reversible product decision, surfaced to the user (not silently baked in):** if the user's actual preference is "no directive still means pause at every child gate," that is a legitimate alternative default the user can request — this ship-log entry and the run-end report are the surface where that gets raised. The review process (round 1 verdict) accepted D6 as written; round 2 caught that the prose describing this default (Step G sentence 1) could be misread as asserting the opposite behavior, and tightened the wording without changing the behavior itself.

## Parity-Uncovered Templates — Verification Method

`_orchestration.ts`, `auto.ts`, and `goal-command.ts` are **not** in the `skill-templates-parity.test.ts` golden-master registry (a pre-existing gap, not introduced by this change — same class of gap as child #2's chrome-use fix, but for the orchestration-family templates rather than expert templates). Since the parity suite cannot catch regressions in these three files' generated output, this change was verified by:
1. `node build.js` (regenerates `dist/`) succeeding without error.
2. `node dist/cli/index.js update` regenerating the installed skills without error.
3. **5 independent grep spot-checks** against the regenerated `rasen-auto/SKILL.md`, `rasen-review-cycle/SKILL.md`, and the `commands/rasen/auto.md` output, confirming the new death-taxonomy language, the counter table, the Step G gate-directive prose (both round-1 and round-2 wording), and the SH-5 scoping sentence are all present verbatim in the generated artifacts — performed independently by both the implementer and the reviewer (reviewer's spot-check was described as "independent grep verification of parity-uncovered output" in auto-run.json).
4. Full manual review (2 rounds, CLEAN APPROVED, non-author confirmed).

**Registry expansion relayed to child #5** (`prompt-audit-fixes-lifecycle`): adding `_orchestration`/`auto`/`goal-command`/`review-cycle`/`ship`/`verify-enhanced` to the parity registry is out of this change's scope (would require its own design decision about how to hash command-template output, similar to child #2's chrome-use addition) — flagged for child #5 to pick up if in scope there.

**New debt found (also relayed to child #5):** the implementer discovered that `rasen-goal`/`goal-plan` templates are **absent from the generation registry entirely** (not just the parity registry) — a distinct, deeper gap than parity-uncoverage, since it means these templates may not even be regenerated by `update`. Flagged in auto-run.json's apply-stage note; relayed to child #5 as new debt, not something this change's scope covers or introduces.

## Review Outcome

Review-cycle, 2 rounds, verdict **CLEAN APPROVED** (non-author confirmed). 0 Blocker, 0 Major throughout.

- **Round 1 — 1 Minor fixed, 1 Trivial fixed:**
  - Minor: `auto.ts:130`'s gate guardrail ("Always pause at gate stages — never skip human confirmation") was textually unqualified — correct once a reader reaches Step G (which resolves precedence: parent directive > child gate), but no back-pointer from the guardrail line itself. Fixed by appending a scoped cross-reference: "(for a decomposed portfolio's child-pipeline gates, this resolves per the playbook's Step G child-gate semantics: parent directive > child gate)" — verified to apply only to portfolio child gates, not over-generalize to top-level gates.
  - Trivial: `tasks.md` 7.3 miscounted "19 PREAMBLE-embedding expert skills" (should be 15 — careful/freeze/guard/unfreeze don't import PREAMBLE). Implementation was already correct; only the task-note count was wrong. Corrected to list the exact 15.
- **Round 2 — 1 new Minor found and fixed:** the re-review, after Round 1's fix, asked whether "no explicit gate directive -> child gates still pause" is preserved — it is NOT (that's the deliberate D6 default), but Step G sentence 1's wording ("does NOT suppress ... by default") could be misread as asserting the opposite. Fixed by tightening S1 to state precisely what it governs (the decompose decision only) without the ambiguous "suppress ... by default" phrasing, while S2's actual auto-continue default is unchanged. The reviewer explicitly separated this from a behavior question — "if the intended default were the opposite, that would be a D6 reversal, a design decision for the LEAD/user, not something this fix round introduced." LEAD upheld D6 as written and surfaced it to the user per above.
- **Seam integrity confirmed:** child #1's Step B report-contract sentence (`_orchestration.ts:56`) verified verbatim, untouched by this diff. Child #2's verify/ship evidence chain lives entirely outside this diff's files. Both survive unmodified — no seam regression.

## Test Gate

- Tests: ran green — `npx vitest run test/core/templates/` -> 6/6 passed, re-run at ship time.
- Build note: `node build.js` used directly (same `pnpm-workspace.yaml` situation noted in children #1/#2 — by this point resolved upstream by the rebrand session's commits, but `node build.js` remains the confirmed-working path).

## Pre-Flight Results

- Verification: pass (review-report.md + auto-run.json, verdict CLEAN APPROVED)
- Tasks: 27/27 complete (tasks.md, all 8 numbered groups; group 8 "Parity-registry expansion" is explicitly marked RELAYED-not-done-here, consistent with the relay documented above)

## Delivery

Local mode: committed only, no push, no PR. This is child #3 of the `prompt-audit-fixes` portfolio; delivery happens once at the portfolio/parent level after all children complete, per the user's decision.
