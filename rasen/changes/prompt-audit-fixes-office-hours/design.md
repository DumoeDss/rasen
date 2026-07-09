# Design — prompt-audit-fixes-office-hours

## Context

`office-hours` is a dialogue-heavy expert skill. A prior archived change (`office-hours-dialogue`, commits 401bb5a / 8c47a06) added the **Dialogue Override** (in the shared PREAMBLE) and a **Consultation posture** (a peer-review mode for users arriving with a concrete design). Those were layered onto a flow whose phase machinery (Six Forcing Questions → Premise Challenge → MANDATORY Alternatives → founder plea) predates them. The audit found the layers now contradict each other on the Consultation path (IN-1 Critical), plus smaller seam/scoping gaps across `office-hours`, `design-consultation`, and `onboard`.

This is child #4 of the `prompt-audit-fixes` portfolio. Children #1–#3 (expert-dispatch, verify-ship, orchestration) shipped and archived; their capabilities (`canonical-severity-vocabulary`, `expert-dispatch-contract`, `orchestration-worker-lifecycle`, verify evidence convention) are consumed by reference where relevant and not re-declared here.

All line numbers below were re-verified against the current tree (post-rebrand, post-children-1–3); `office-hours.ts` matches the audit's line numbers almost exactly (Consultation short-circuit `:35`, posture `:63–72`, Phase 4 header `:358`, fully-formed-plan `:241`/`:277`/`:620`, answer-first `:85`, Phase 4.5 `:395–408`, Phase 6 `:548`, escape hatch `:236`/`:277`).

## Goals / Non-Goals

**Goals**
- Give the Consultation posture unambiguous precedence over the interview-path phase rules and an explicit terminal (IN-1, IN-2).
- Close the smaller dialogue seams in office-hours (IN-4/5/6), design-consultation (IN-3/7), onboard (IN-8), and the PREAMBLE Re-ground/Dialogue-Override seam (SH-6).
- Every new absolute carries a scope clause and states precedence vs. the adjacent rule; no new vocabulary.

**Non-Goals**
- Do NOT touch `workflows/office-hours.ts` (WF-2/WF-6 → child #5), `_orchestration.ts`, or store paths (WF-3/WF-9 → child #6).
- Do NOT gate `SPEC_REVIEW_LOOP` for orchestrated dispatch (SH-3 same-family note) — see Decision 6.
- Do NOT "fix" pre-rebrand `openspec` branding in existing spec text (out-of-scope churn); use `rasen` naming in new text only.

## Key decisions

### Decision 1 — IN-1 precedence wording (the headline)

The Consultation posture is made **authoritative for its whole session and replaces Phases 2, 3, and 4.** The reconciliation is stated as a one-directional precedence rule, applied at every colliding site:

- **Consultation posture (`:63–72`):** add "This posture is authoritative for the session: it replaces Phases 2, 3, and 4. The `Phase 4 (MANDATORY)` header and the 'fully formed plan still runs Phase 3 + Phase 4' rules below apply to the interview paths (Startup/Builder), not here."
- **Phase 4 header (`:358`):** "## Phase 4: Alternatives Generation (MANDATORY on the interview paths)" + a line "Not run in the Consultation posture — see Consultation posture."
- **Phase 2A `:241`, Phase 2B `:277`, Important Rules `:620`:** each fully-formed-plan statement gets "(interview paths only; a concrete-design-plus-feedback opening goes to the Consultation posture, which replaces Phases 2–4)."

**Why one-directional and posture-wins:** the audit shows the collision bites precisely on the posture's headline use case ("here's my design, poke holes in it"), which is exactly what the posture was added to serve. Making the MANDATORY/fully-formed-plan rules win would re-introduce the alternatives-menu + approval-gate anti-pattern the posture eliminates. Scoping those rules to the interview paths keeps them fully intact for the vague-idea / Startup / Builder flows where they earn their keep. This is KEEP-for-interview / CUT-for-Consultation, not deletion.

### Decision 2 — IN-2 Consultation terminal

The posture gets an explicit terminal so it never falls into founder-close machinery written for Startup/Builder sessions: **after the doc is distilled (on explicit "yes"), deliver a plain summary + `/rasen:propose` pointer; SKIP Phase 4.5 (founder-signal synthesis) and Phase 6 (founder plea).** Phase 6's "Every user gets all three beats regardless of mode (startup or builder)" (`:548`) and Phase 4.5's signal synthesis (`:395–408`) are scoped to the interview paths. Rationale: a peer design review has no tracked founder signals and the golden-age plea is a tone mismatch there — the "beats" belong to the founder-diagnostic flow, not to Consultation. The existing hard-approval gate (Phase 5 `:414`) already admits the Consultation "yes" path, so the doc-write precondition is untouched.

### Decision 3 — IN-4/5/6 (office-hours interview seams)

- **IN-4 (answer-first):** broaden `:85` so it binds every question in the skill, including the Phase 3 and Phase 4 approval prompts. Kept phrasing keeps the "2A and 2B" mention **and** adds "and the Phase 3 Premise Challenge and Phase 4 approval prompts" — so the existing `office-hours-dialogue` "Answer before you ask" scenario (which checks binding on Startup and Builder) still passes, and a new requirement locks the Phase 3/4 coverage. No MODIFY of the existing requirement needed.
- **IN-5 (full-skip bar):** Startup keeps the Phase 2A real-evidence bar; `:277` (Builder) and `:620` (Important Rules) are qualified to defer to it ("in Startup mode, a full skip still requires the Phase 2A real-evidence bar"). Reconciles with Decision 1's scoping: these are interview-path rules now.
- **IN-6 (proceed vs stop):** one line after the escape hatch: a "proceed/continue" reply after a Dialogue Override pause resumes the next question; only an explicit stop-asking signal fires the escape hatch. Disambiguates the shared "just do it" verbatim example.

### Decision 4 — IN-3 (design-consultation curls): compliance fix, no new spec

The `chrome-use-expert-methodology` capability already requires (and its scenario already names design-consultation) that every live `localhost:3456` curl passes `--noproxy '*'`. The three Phase 2 research curls (`design-consultation.ts:85–88`) simply drifted out of compliance. Fix = add the flag; **no new spec requirement** — the behavior is already specified, this is a bug bringing code back into spec. Locked by regenerating the design-consultation parity hash.

### Decision 5 — IN-7 (design-consultation Q2 Completeness): conformance note, no new spec

The PREAMBLE's Completeness rule (owned by `expert-dialogue-override`) already states that Completeness applies only to shortcut-vs-complete decisions and that **exploratory forks do NOT carry a Completeness score.** Q2's option E (skip the preview) is an exploratory design fork, so it is already correctly exempt — the gap is that the skill body doesn't say so, making the omission look accidental. Fix = add one exploratory-fork exemption note at Q2. **No new spec requirement** — the normative rule already exists in `expert-dialogue-override`; the edit records design-consultation's conformance. Locked by the design-consultation parity hash.

### Decision 6 — SH-3 (SPEC_REVIEW_LOOP gating): declined

office-hours runs as a top-level pre-build step, not a dispatched leaf worker, so the no-spawn / no-subagent constraint of the orchestration dispatch prompt does not co-occur with `SPEC_REVIEW_LOOP`'s "Dispatch ONE independent reviewer via the Agent tool." Gating it would edit the shared `SPEC_REVIEW_LOOP` block (defined in `_shared.ts`, embedded only by office-hours), churning that block's hash for a path that does not bite in practice. Per the fix-writing philosophy (don't adapt an absorbed behavior unless it is demonstrably harmful here), left as-is. Recorded so a later change that ever runs office-hours as an orchestrated stage can revisit.

### Decision 7 — SH-6 (PREAMBLE Re-ground): defer to Dialogue Override

The Format's step 1 ("Re-ground: State the project, the current branch… for every AskUserQuestion call", `_shared.ts:71`) is edited to defer to the Dialogue Override ("Re-ground per the Dialogue Override rule — session start / after a genuine gap, not on every consecutive call"). The Dialogue Override already owns the restraint side (`expert-dialogue-override` "Re-ground restraint in continuous conversation"); this closes the Format side that still said "every call." This touches the PREAMBLE → moves every PREAMBLE-embedding template's parity hash (see tasks). The existing `expert-dialogue-override` "Golden-master parity preserved" requirement already governs that hash churn.

## Spec-delta strategy

Consistent with the portfolio's 3/3-CLEAN ADDED-only strategy: all deltas are **ADDED** requirements (the existing requirements do not assert the now-wrong values, so no fragile MODIFY). Scenarios assert **generated content** ("WHEN the regenerated `<skill>` is inspected THEN it SHALL state…"), matching how the repo tests prompt templates. Deltas land in existing capabilities:
- `office-hours-dialogue` (IN-1, IN-2, IN-4, IN-5, IN-6) — 5 ADDED requirements.
- `expert-dialogue-override` (SH-6) — 1 ADDED requirement.
- `opsx-onboard-skill` (IN-8) — 1 ADDED requirement.
- IN-3, IN-7 — compliance fixes to existing capabilities (`chrome-use-expert-methodology`, `expert-dialogue-override`), no new requirements (Decisions 4–5).

## Parity coverage

All three edited generated skills are pinned embedders in `test/core/templates/skill-templates-parity.test.ts` (function-hash + generated-content-hash):
- **office-hours.ts body edits (IN-1/2/4/5/6)** → `getOfficeHoursSkillTemplate` + `rasen-office-hours` hashes.
- **design-consultation.ts body edits (IN-3/7)** → `getDesignConsultationSkillTemplate` + `rasen-design-consultation` hashes.
- **onboard.ts edit (IN-8)** → `getOnboardSkillTemplate` + `getOpsxOnboardCommandTemplate` + `rasen-onboard` hashes (onboard's skill and command templates share `getOnboardInstructions`). onboard does **not** embed the PREAMBLE, so SH-6 does not move onboard hashes — these move only from IN-8.
- **_shared.ts PREAMBLE edit (SH-6)** → moves the function-hash and generated-content-hash of **every PREAMBLE-embedding template** (all expert skills incl. office-hours and design-consultation; office-hours/design-consultation hashes therefore move from both their body edits and SH-6, resolved in one rebuild).

No new templates need registering (unlike child #2's chrome-use / child #3's auto-family debt — that parity-registry expansion is child #5's).
