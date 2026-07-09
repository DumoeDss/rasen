# Ship Log: prompt-audit-fixes-office-hours

**Date:** 2026-07-09
**Mode:** local
**Branch:** main
**Commit:** (backfilled below)
**Status:** Committed (delivery deferred — portfolio delivers once at the end)

## What Shipped

Office-hours consultation precedence fix (child #4 of the `prompt-audit-fixes` portfolio): closes a two-route ambiguity where the Consultation posture (added by the earlier `office-hours-dialogue-override` change) and the Startup/Builder interview's Phase 4 "fully-formed-plan" rules could both plausibly apply to the same opening message, with no stated precedence — the original office-hours interrogation bug's root cause (a state machine with no unambiguous route) could recur through this second seam.

1. **IN-1 — Consultation precedence stated at all four colliding sites** (`office-hours.ts`): the Consultation posture explicitly **replaces** Phases 2-4 rather than coexisting with them ambiguously. Precedence is restated not just in the posture description itself but at each of the three "fully-formed-plan" rule sites in Phase 4 plus the Phase 4 header, so an agent anchored on any one of the four colliding sites reaches the same deterministic route: a fleshed-out design plus a feedback request ("poke holes," "what do you think") routes to Consultation and skips Phases 2-4 entirely; a vague idea or a detailed plan with no feedback request runs the normal interview, where Phase 2A's real-evidence bar still forbids a full skip.
2. **IN-2 — Consultation terminal defined** (`office-hours.ts`): the Consultation posture's terminal state writes the design doc via the existing Phase 5 HARD GATE (unchanged, already admits the Consultation "yes to distill" entry from the prior office-hours-dialogue-override change) and then closes plainly, explicitly skipping Phase 4.5 and Phase 6 — Phase 4.5's "before writing the doc" precondition is cleanly bypassed by construction, not left dangling.
3. **IN-3 — `--noproxy` compliance** (`design-consultation.ts`): template curl invocations updated to carry `--noproxy` consistently, matching the prior chrome-use-parity-followups fix pattern for the same class of proxy-interference bug.
4. **IN-4/IN-5/IN-6 — interview seam scopings** (`office-hours.ts`): narrower fixes to the Startup/Builder interview discipline, keeping the existing Phase 2A real-evidence bar and Important Rules from silently overriding each other.
5. **IN-7 — exploratory-fork note** (`design-consultation.ts`): a scoping note clarifying an exploratory-fork case is out of the Consultation-replaces-Phases-2-4 rule's blast radius.
6. **IN-8 — onboard answer-then-resume** (`onboard.ts`): the onboarding workflow's own question-handling now follows the same "answer before advancing" discipline established for office-hours by the earlier Dialogue Override fix, so onboard doesn't regress the same interrogation-state-machine bug in its own narrower flow.
7. **SH-6 — PREAMBLE re-ground defers to Dialogue Override** (`_shared.ts`): the shared PREAMBLE's "ALWAYS follow this structure" AskUserQuestion Format framing now explicitly carves out only the re-ground opener as gap-gated (genuine long gap / session start), while steps 2-4 of the format remain every-call — the carve-out is stated explicitly rather than left to be inferred, and the Dialogue Override section it defers to lives in the same PREAMBLE constant a few lines below, so the reference resolves cleanly in every one of the 15 PREAMBLE-embedding expert skills.

Installed skills regenerated. Parity hashes resynced: 17 function hashes (the 15 PREAMBLE-embedding experts + onboard's 2 getters) and 16 content hashes (those 15 experts' `rasen-*` skills + rasen-onboard) — careful/freeze/guard/unfreeze confirmed to still not embed PREAMBLE and correctly show zero movement.

## Review Outcome

Review-cycle, verdict **CLEAN — 0 Blocker / 0 Major / 0 Minor / 0 Trivial on the first pass**. This is the first zero-finding review of the entire `prompt-audit-fixes` portfolio (children #1-#3 each had at least one Minor or Trivial caught and fixed in round 1).

The reviewer's own report characterizes why: the IN-1 fix is robust specifically because precedence is restated at every colliding site — the posture description, the Phase 4 header, and all three individual fully-formed-plan rules — not only in one place, closing the exact class of gap (an agent anchored on a *different* site than the one carrying the fix, still hitting the ambiguity) that produced Minor findings in earlier children of this portfolio. The reviewer performed and recorded a three-opening behavioral walk-through (vague idea / fleshed design + feedback request / detailed plan with no feedback request) confirming a single deterministic route for each, and independently re-ran the parity suite and the moved-hash audit rather than trusting the implementer's numbers.

**No accepted-known items, no relayed debt for this child** — a genuinely clean pass.

## Test Gate

- Tests: ran green — `npx vitest run test/core/templates/` -> 6/6 passed, re-run at ship time (matches implementer's and reviewer's own independent re-run recorded in the review report).

## Pre-Flight Results

- Verification: pass (review-report.md + auto-run.json, verdict CLEAN 0/0/0/0)
- Tasks: 19/19 complete (tasks.md, all 7 numbered groups)

## Delivery

Local mode: committed only, no push, no PR. This is child #4 of the `prompt-audit-fixes` portfolio; delivery happens once at the portfolio/parent level after all children complete, per the user's decision.
