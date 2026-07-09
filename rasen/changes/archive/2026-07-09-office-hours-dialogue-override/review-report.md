# Review Report — office-hours-dialogue-override

**Reviewer:** independent (not the author)
**Date:** 2026-07-09
**Verdict (round 0):** DONE_WITH_CONCERNS — 1 Major, 2 Minor, 1 Trivial. No Blockers.
**Verdict (final, after fix round 1):** CLEAN TO SHIP. Both Minor findings resolved by the implementer; the Major and Trivial are accepted-known per LEAD ruling (see "Fix Round 1" section at the bottom). No open blocking findings. The approved dialogue fix is implemented correctly and completely; the Major finding was a commit-hygiene / scope-attribution issue caused by the in-flight openspec→rasen migration sharing the same files, not a defect in the dialogue change.

**Tests:** `npx vitest run test/core/templates/` → **6 passed / 0 failed** (1 file, `skill-templates-parity.test.ts`, 6 tests, ~2.85s). No Windows EBUSY/10s-timeout flakes observed on this run.

---

## 1. Contract fidelity — PASS

All 5 approved items are present and faithful to the specs, and the original failure scenario is closed at three independent layers.

| Approved item | Location | Status |
|---|---|---|
| Dialogue Override in PREAMBLE | `_shared.ts:35-43` | Present — matches `expert-dialogue-override` spec verbatim in intent (decision-tool-not-conversation-tool, pause & answer in prose with no options/RECOMMENDATION/Completeness, never answer+advance same turn, "answer me first" ≠ skip, Re-ground only after long gap). |
| Completeness scoping | `_shared.ts:28` | Present — Completeness now "only when the decision weighs a shortcut against a complete implementation; discussion-type or exploratory forks do NOT carry a Completeness score." |
| Interview discipline "Answer before you ask" | `office-hours.ts:211` (src line ~83) | Present, 4th bullet; explicitly binds Startup (2A) and Builder (2B). |
| Escape hatch tightened (Startup + Builder) | `office-hours.ts:362` and `:403` (src ~231, ~272) | Both hatches now fire ONLY on explicit skip signals; a user question / request to discuss is explicitly routed to Dialogue Override, "not impatience." |
| Phase 5 hard gate | `office-hours.ts:597` (src ~412) | Present — sole precondition = explicit Phase 4 approval; complaint/silence/question explicitly NOT approval. |
| Consultation posture | `office-hours.ts:189` (src ~61) | Present — skip generative questioning, deliver analysis prose, discuss peer-to-peer, offer doc only after convergence as a byproduct. |

**Original-failure regression check (the load-bearing requirement):** a user question or "answer me first" is caught and routed to prose discussion — never the escape hatch, never doc-writing — at all three sites: PREAMBLE Dialogue Override (`_shared.ts:37`), both escape hatches (`office-hours.ts:362`, `:403` — "A user question or a request to explain or discuss is NOT a skip signal"), and the Phase 5 gate (`:597` — "a user asking to be answered first or to discuss more is asking for more conversation, not a doc"). The exact reported bug is closed. ✅

---

## 2. Instruction-prose quality — mostly clean; 2 Minor gaps

The core risk the LEAD flagged (a contradictory instruction set that reproduces the bug) is **well-handled**. The layering is correct: the AskUserQuestion Format governs *how* a call is structured; Dialogue Override is a gate on *whether* to make the call at all. So there is no contradiction between Dialogue Override and the mandatory 4-part AskUserQuestion Format, nor with "One question at a time," nor with the Phase 4 approval gate. Escape hatch (skip on explicit signal) and Dialogue Override (pause on question) are mutually exclusive by construction — no overlap.

Two residual gaps, both Minor:

### Finding 2 — [Minor] Consultation posture vs Phase 5 hard-gate wording collision
**File:** `src/core/templates/experts/office-hours.ts:412` (Phase 5 HARD GATE) vs `:61-68` (Consultation posture)
**Problem:** The Phase 5 hard gate states the *sole* precondition for writing the doc is "an explicit user approval of an approach **in Phase 4**." But the Consultation posture (D5) deliberately bypasses the numbered interview flow (skip generative questioning) and reaches doc-writing via its own convergence step ("Offer the doc only after convergence… ask whether to distill it into a design doc"). A literal LLM reading of "in Phase 4" makes the gate either unsatisfiable in Consultation mode (model refuses to ever write the doc) or forces the model to rationalize that convergence-approval counts — the kind of ambiguity that gate was added to remove. Note this does NOT reproduce the original bug (writing *without* approval); worst case is over-refusal.
**Suggested fix:** Broaden the Phase 5 precondition to "explicit user approval of an approach — the Phase 4 approval question, or (in Consultation posture) the user's explicit go-ahead after the discussion converges." One clause closes the gap.

### Finding 3 — [Minor] Consultation posture not wired into the Phase 1 mode-mapping
**File:** `src/core/templates/experts/office-hours.ts:48-50` (Phase 1 "Mode mapping") vs `:61` (Consultation posture)
**Problem:** Phase 1's explicit mode-mapping routes every session to Startup (2A) or Builder (2B) only — Consultation is not listed there. The Consultation section relies on the model self-noticing its trigger ("user arrives with a concrete design + feedback request") rather than being routed to from the deterministic mode-selection step. A model that follows the Phase 1 mapping literally may never branch into Consultation, defeating the posture for the exact users it targets.
**Suggested fix:** Add a Consultation branch to the Phase 1 mode-mapping (e.g. "Concrete design + feedback request → Consultation posture (below)") so the routing is deterministic rather than emergent.

---

## 3. Blast radius / golden-master parity — MAJOR concern

### Finding 1 — [Major] The diff bundles the in-flight openspec→rasen migration with this change; parity update is NOT scoped to the 14 affected templates, and careful/freeze/guard/unfreeze hashes DID change
**Files:** `test/core/templates/skill-templates-parity.test.ts` (whole file), plus migration hunks in `_shared.ts` and `office-hours.ts`.

**Evidence:**
- The parity test diff is a **wholesale rename of every template key** `openspec-*` → `rasen-*` (~30 templates) with **every hash recomputed** — not just the 14 PREAMBLE-embedding templates the contract scoped.
- LEAD review item 3 asked to confirm `careful/freeze/guard/unfreeze` hashes did **not** change. They **did** change (e.g. `getCarefulSkillTemplate` `843881e0…` → `e2ee6ded…`; `openspec-careful` key → `rasen-careful` with new content hash). Root cause is the brand rename (these templates carry `/opsx:` / `openspec` strings), **not** the PREAMBLE Dialogue Override — those four templates do not embed PREAMBLE, so the dialogue change did not reach them. So the *spirit* of item 3 holds (Dialogue Override did not leak into them) but the *letter* fails (their hashes are not stable in this diff).
- The two source files likewise carry migration-only hunks unrelated to the dialogue fix: `/opsx:`→`/rasen:`, `~/.openspec/`→`~/.rasen/`, `.openspec/`→`.rasen/`, and the skill `name`/`author` rename `openspec:office-hours`→`rasen:office-hours` (`office-hours.ts:612,616`).

**Why it's Major, not Blocker:** the working tree is mid-migration (git status shows ~50 files modified) and `planning-context.md` explicitly anticipated "工作树有大量与本 change 无关的未提交修改（迁移期）." The parity test *had* to be regenerated against the working-tree brand, so the combined hashes are unavoidable while the migration is uncommitted. The tests pass. No functionality is wrong.

**Consequence the LEAD must decide:** these three files cannot be committed in isolation by pathspec without also committing a large slice of the openspec→rasen migration (whole-file granularity). Options: (a) land the migration as its own commit first, then this change diffs cleanly; (b) accept the bundled migration in this change's commit and note it in the ship log. This is a commit-sequencing decision, not a code fix — flagging per the shared-index / pathspec discipline.

---

## 4. Regeneration integrity — PASS (with a Trivial note)

- `.claude/skills/rasen-office-hours/SKILL.md` contains the new Dialogue Override (`:35-37`), Completeness scoping (`:28`), Consultation posture (`:189`), Answer-before-you-ask (`:211`), both tightened escape hatches (`:362`, `:403`), and the Phase 5 HARD GATE (`:597`). Generated output matches what the template produces. ✅
- Parity suite passes, confirming the generated content for all pinned templates matches the recorded hashes. ✅

### Finding 4 — [Trivial] Stale `openspec-*` generated skills remain installed and lack the Dialogue Override
**Evidence:** `.claude/skills/` still contains pre-migration `openspec-office-hours`, `openspec-review`, `openspec-design-review`, etc. alongside the new `rasen-*` skills; `openspec-office-hours/SKILL.md` does **not** contain the Dialogue Override text.
**Impact:** a user who invokes the stale `openspec:office-hours` skill still gets the old buggy behavior. This is migration cleanup (removing the superseded `openspec-*` install), out of this change's declared scope — noting only so it isn't lost. Not attributable to this change.

---

## Fix Round 1 — Re-review (2026-07-09)

Implementer applied fixes to `src/core/templates/experts/office-hours.ts` only. Re-reviewed the delta; `_shared.ts` untouched this round; parity re-run independently: **6/6 green** (`skill-templates-parity.test.ts`). Since only office-hours.ts changed, the only parity hashes that could move are `getOfficeHoursSkillTemplate` (function) and `rasen-office-hours` (generated content) — and the suite is green, which proves every other template's hash still matches its unchanged content. So only office-hours hashes moved this round, as required. No Windows flakes.

- **Finding #2 (Phase 5 gate unsatisfiable in Consultation) — RESOLVED.** The Phase 5 HARD GATE (`office-hours.ts:414`) now names two explicit entry paths: "explicit user approval of an approach in Phase 4 — OR, in the Consultation posture, the user's explicit 'yes' to distilling the converged discussion into a doc. Those are the only two ways in." Complaint/silence/question are still explicitly NOT approval. The Consultation track now has a valid, unambiguous doc-entry; the gate is satisfiable in both postures. Fix matches my suggested wording.
- **Finding #3 (Consultation routing emergent) — RESOLVED.** Phase 1 now has step 5 "Consultation short-circuit" (`office-hours.ts:35`): an opening message with a concrete design/plan PLUS a feedback request routes straight to the Consultation posture, skipping the goal question and mode menu. Routing is now deterministic rather than reliant on the model self-noticing.
- **No new contradiction introduced.** (a) Short-circuit vs the Phase 1 goal step: step 6 begins "**Otherwise**, ask: what's your goal" — the two are mutually exclusive, step 6 is only reached when the short-circuit did not fire. Clean. (b) The two gate entry paths are disjoint by posture (Phase-4-flow vs Consultation) and jointly exhaustive ("the only two ways in") — no overlap or gap. Pre-existing note (not a new finding): Consultation still bypasses the Phase 4 "(MANDATORY)" alternatives step, but that was the accepted D5 design from round 0 and the gate now explicitly blesses the Consultation doc-entry, so the instruction set is internally consistent.

### LEAD rulings on remaining findings (recorded in auto-run.json)
- **Finding #1 [Major] — ACCEPTED (won't-fix in this change).** Migration bundle is accepted and to be documented at ship. The three files carry the uncommitted openspec→rasen migration; not a code defect. Closed as accepted-known.
- **Finding #4 [Trivial] — ACCEPTED-KNOWN.** Stale `openspec-*` installed skills are migration cleanup, out of scope for this change. Closed as accepted-known.

**Final verdict: CLEAN — no open blocking findings.** 2 Minor resolved, 1 Major + 1 Trivial accepted-known by LEAD. Ready to ship.

---

## Durable findings (1-3 lines)
The approved office-hours dialogue fix is implemented correctly and completely, tests green (6/6 parity), and the exact reported failure is closed at three layers. The one material concern is scope-attribution: this diff carries the uncommitted openspec→rasen migration (whole parity test rehashed for all ~30 templates; careful/freeze/guard/unfreeze hashes changed via branding, not PREAMBLE), so the three files can't be committed in isolation — a sequencing decision for the LEAD. Two Minor prose gaps (Consultation vs the "in Phase 4" hard-gate wording; Consultation missing from the Phase 1 mode-mapping) are worth a follow-up but do not reproduce the original bug.
