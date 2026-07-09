# Review report — prompt-audit-fixes-office-hours (child #4)

**Reviewer:** dispatched reviewer-1 (did NOT author). Report-only.
**Verdict:** CLEAN — Blocker: 0, Major: 0, Minor: 0, Trivial: 0.
**Recommendation:** APPROVE for ship.

Core lens applied: would the agent, following the NEW text literally, ever reproduce the
original bug (ignore user questions / fast-forward past discussion / run interview machinery
on a peer-review opening)? Answer: no, on every traced path.

---

## 1. Contract fidelity (IN-1..IN-8 + SH-6 per Decisions 1–7)

| Finding | Decision | Landed | Notes |
|---|---|---|---|
| IN-1 (Critical) | D1 | ✅ | Posture "authoritative … replaces Phases 2,3,4" (`:67`); precedence one-directional; scoped at ALL colliding sites (Phase 4 header `:361`, Phase 2A escape hatch `:239`, Phase 2B `:280`, Important Rules `:625`), not only in the posture. |
| IN-2 (Major) | D2 | ✅ | Explicit Consultation terminal (`:73`): plain summary + `/rasen:propose`, SKIP 4.5/6. Phase 4.5 (`:398`) + Phase 6 (`:553`) scoped to interview paths with explicit "Consultation does NOT run this." |
| IN-3 (Major) | D4 | ✅ | All three Phase 2 curls now carry `--noproxy '*'`. Compliance fix, no spec delta (correct). |
| IN-4 (Minor) | D3 | ✅ | Answer-first broadened to whole skill incl. Phase 3/4 gates (`:83`,`:88`); still names 2A/2B so the existing scenario passes. |
| IN-5 (Minor) | D3 | ✅ | Startup keeps real-evidence bar; Builder `:280` + Important Rules `:625` defer to it. |
| IN-6 (Minor) | D3 | ✅ | Proceed-vs-stop line at both escape hatches (`:239`,`:280`). |
| IN-7 (Minor) | D5 | ✅ | Q2 exploratory-fork exemption note. Compliance fix, no spec delta (correct). |
| IN-8 (Minor) | — | ✅ | onboard Guardrails line: question-at-PAUSE answered then resumed. |
| SH-6 (Minor) | D7 | ✅ | Format step 1 defers to Dialogue Override; carve-out explicit. |
| SH-3 | D6 | ✅ declined | SPEC_REVIEW_LOOP untouched; office-hours runs top-level, no co-occurrence. Rationale sound per fix-writing philosophy. |

All new absolutes carry a scope clause; no new severity/mode vocabulary introduced. Sweep of every
touched block found no residual unscoped absolute.

## 2. Instruction-prose integrity (CORE)

**(a) IN-1 three-opening walk-through under NEW text:**
- *Vague idea* → short-circuit `:35` does not fire (no concrete design) → goal question → Startup/Builder
  interview; Phase 4 MANDATORY applies. Correct.
- *Fleshed design + "poke holes"* → short-circuit fires → Consultation posture, which now explicitly
  replaces Phases 2–4; Phase 4 header + all three fully-formed-plan rules are scoped away from
  Consultation. **Deterministic single route — the original bug cannot recur.**
- *Detailed pre-revenue plan, Startup mode* (no feedback request) → interview path; Phase 2A real-evidence
  bar forbids a full skip, Builder/Important-Rules now defer to it → runs the questions. No contradiction.
  (If such a plan also carries a feedback request it routes to Consultation by design — acceptable.)
- No residual two-route ambiguity. Precedence is stated where the colliding rules live, not only in the
  posture (verified all four sites).

**(b) IN-2 terminal vs Phase 5 gate:** Consultation terminal writes the doc via the Phase 5 HARD GATE
(`:417–419`), which was already amended (prior change) to admit the Consultation "yes" and is UNTOUCHED
here. Terminal then closes plain, skipping 4.5/6. 4.5 sits "before writing the doc" and is cleanly
bypassed. **Phase 5 gate's Consultation entry is not orphaned; it remains the doc-write mechanism.**

**(c) SH-6 vs "ALWAYS follow this structure":** No contradiction. Step 1 explicitly names the
"for every AskUserQuestion call" framing and carves out only the re-ground opener as gap-gated, while
stating "steps 2–4 apply every call." Steps 2–4 remain every-call. Carve-out is explicit, not implied.

**(d) New-absolute sweep:** clean (see §1).

## 3. Seam integrity

- SH-6 text is generic ("session start / genuine gap") and reads coherently in non-office-hours
  embedders. Spot-checked the referent chain: the **Dialogue Override lives in the SAME PREAMBLE constant**
  (`_shared.ts:80–86`, re-ground rule at `:86`) immediately below the edited Format, so "per the Dialogue
  Override" resolves in all 15 embedders (rasen-investigate, rasen-cso, etc.) — no dangling reference.
- Child #1's dispatched-mode PREAMBLE block (`_shared.ts:55–66`) is UNTOUCHED by this diff; only line 71
  changed in that region.

## 4. Tests / parity

- `npx vitest run test/core/templates/` → **6 passed** (ran it myself).
- Moved-hash set verified exactly as claimed:
  - **17 function hashes:** the 15 PREAMBLE-embedding experts (grep-confirmed exactly 15 files embed
    `${PREAMBLE}`: benchmark, chrome-use, codebase-design, codex, cso, design-consultation, design-review,
    investigate, navigator, office-hours, prototype, qa, qa-only, review, tdd) + onboard×2
    (getOnboardSkillTemplate + getOpsxOnboardCommandTemplate).
  - **16 content hashes:** those 15 experts' `rasen-*` + rasen-onboard.
  - **Frozen set holds:** careful/freeze/guard/unfreeze do NOT embed PREAMBLE (grep-confirmed) → their
    function + content hashes correctly did not move.
  - No unexpected template moved (diff touches only the enumerated entries).

## 5. Validate + regen spot-checks

- `node dist/cli/index.js validate prompt-audit-fixes-office-hours` → **valid** (every requirement ≥1
  scenario; 4-hashtag headers).
- Consultation "replaces Phases 2–4" text, terminal text, and re-ground wording all present in the
  regenerated source (inspected directly).

## Durable finding (1–3 lines)

Child #4 is CLEAN in one pass. The IN-1 resolution is robust because precedence is restated at every
colliding site (posture + Phase 4 header + all three fully-formed-plan rules), not only in the posture —
so an agent anchored on any one of those sites still reaches the same route. Frozen safety skills
(careful/freeze/guard/unfreeze) genuinely do not embed PREAMBLE, which is why SH-6 leaves them untouched.
