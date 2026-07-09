# Reconcile office-hours Consultation posture with the interview-path rules

## Why

The `office-hours` expert skill grew a **Consultation posture** (a peer-review mode for users who arrive with a concrete design and ask for feedback) on top of an interview-driven flow that was written before it existed. The two now collide on the most common Consultation path, plus a handful of smaller seam and scoping gaps in `office-hours`, `design-consultation`, and `onboard`. From the interactive audit (`audit/audit-interactive.md` IN-1..IN-8) and the shared-block audit (`audit/audit-shared.md` SH-6):

- **IN-1 (Critical).** A "concrete design PLUS a feedback request" opening matches BOTH the Consultation short-circuit AND the three "fully formed plan still runs Phase 3 + Phase 4 (MANDATORY)" rules (`:241`, `:277`, `:620`) plus the `Phase 4 (MANDATORY)` header. There is no precedence rule, so an agent can fire the exact alternatives-menu / approval-gate anti-pattern the Consultation posture was added to eliminate — on the posture's headline use case.
- **IN-2 (Major).** The Consultation posture never sets a mode, so it has no defined terminal: it falls into Phase 4.5 founder-signal synthesis (no signals were tracked) and the Phase 6 "every user gets all three beats" founder plea, ending a technical peer review with a "you could be a founder / golden age" close.
- **IN-3 (Major, mechanical).** The three `design-consultation` Phase 2 research curls call `localhost:3456` without `--noproxy '*'`, contradicting the embedded `CHROME_USE_SETUP` mandate — on a machine with `HTTP(S)_PROXY` set they 502 and the skill silently degrades to WebSearch-only. This is code that has drifted out of compliance with the already-shipped `chrome-use-expert-methodology` spec.
- **IN-4/IN-5/IN-6 (Minor).** "Answer before you ask" enumerates only 2A/2B, reading as if the Phase 3/4 approval prompts are exempt; the FULL-skip bar for a "fully formed plan" is stated three ways with different bars; and after a Dialogue Override pause "just do it" is ambiguous between "resume the questions" and "fire the escape hatch."
- **IN-7 (Minor).** `design-consultation` Q2 offers a shortcut option (E, skip the preview) with no Completeness framing, silently inconsistent with the PREAMBLE's Completeness rule (which already exempts exploratory forks).
- **IN-8 (Minor).** `onboard` PAUSE points have no "user asks a question here" branch, and onboard does not embed the PREAMBLE, so no Dialogue Override covers it.
- **SH-6 (Minor).** The PREAMBLE's AskUserQuestion Format step 1 ("Re-ground: State the project… for every AskUserQuestion call") contradicts the Dialogue Override's "re-ground only after a genuine gap; not between consecutive replies."

## What Changes

- **office-hours.ts** — make the Consultation posture authoritative for its whole session: it **replaces Phases 2–4**, and the `Phase 4 (MANDATORY)` header and the three "fully formed plan still runs Phase 3+4" rules are scoped to the **interview paths (Startup/Builder)**, with explicit precedence (IN-1). Give the Consultation posture an explicit **terminal** — plain summary + `/rasen:propose` pointer, skipping Phase 4.5 and Phase 6 — and scope the Phase 6 "every user gets all three beats" line to interview paths (IN-2). Broaden "Answer before you ask" to bind the Phase 3 and Phase 4 approval prompts (IN-4); unify the FULL-skip bar so a Startup full skip keeps the real-evidence bar and the Builder/Important-Rules statements defer to it (IN-5); add one line disambiguating post-pause "proceed/continue" (resume the next question) from an explicit stop-asking signal (fire the escape hatch) (IN-6).
- **design-consultation.ts** — add `--noproxy '*'` to the three Phase 2 research curls to match the embedded `CHROME_USE_SETUP` mandate (IN-3); add an explicit exploratory-fork exemption note at Q2 so the missing Completeness framing on option E is intentional, not a silent format break (IN-7).
- **_shared.ts** — make the AskUserQuestion Format's Re-ground step defer to the Dialogue Override (session start / after a genuine gap, not every consecutive call) (SH-6). Touches the PREAMBLE → moves every PREAMBLE-embedding template's parity hash.
- **onboard.ts** — one Guardrails line: if the user asks a question at a PAUSE, answer it, then resume the phase where you paused (IN-8).

Every new NEVER/ALWAYS/scope clause states its precedence vs. the adjacent rule; no new severity or mode vocabulary is introduced.

**Explicitly out of scope (with rationale):**
- **SPEC_REVIEW_LOOP subagent-dispatch gating (SH-3 same-family note).** office-hours runs as a top-level pre-build step, not a dispatched leaf worker, so the no-spawn constraint rarely co-occurs. Gating it would edit the shared `SPEC_REVIEW_LOOP` block (churning unrelated hashes) for a path that does not bite. Left alone per the fix-writing philosophy (don't adapt behavior that isn't demonstrably harmful here).
- **workflows/office-hours.ts (WF-2/WF-6), _orchestration.ts, store paths (WF-3/WF-9).** Belong to sibling children #5/#6; this change touches only the `experts/office-hours.ts` embedder, `design-consultation.ts`, `_shared.ts` (PREAMBLE), and `onboard.ts`.

## Capabilities

### Modified Capabilities
- `office-hours-dialogue`: add precedence and terminal rules so the Consultation posture and the interview-path rules stop colliding (IN-1, IN-2), broaden answer-first (IN-4), unify the full-skip bar (IN-5), and disambiguate post-pause proceed vs. stop (IN-6).
- `expert-dialogue-override`: the AskUserQuestion Format Re-ground step defers to the Dialogue Override (SH-6).
- `opsx-onboard-skill`: PAUSE points answer a user question then resume (IN-8).

### Compliance fixes (no new spec requirements)
- IN-3 brings `design-consultation` Phase 2 curls into compliance with the existing `chrome-use-expert-methodology` "curl Examples Bypass a Configured HTTP Proxy" requirement (which already names design-consultation).
- IN-7 makes `design-consultation` Q2 conform to the existing `expert-dialogue-override` "Completeness score scoped to shortcut-vs-complete decisions" requirement (exploratory forks are already exempt); the edit records that conformance explicitly in the skill body.

## Impact

- `src/core/templates/experts/office-hours.ts` — Consultation posture, Phase 4 header, Phase 2A/2B/Important-Rules fully-formed-plan sites, Phase 4.5/Phase 6 scope, Interview discipline answer-first, escape-hatch disambiguation.
- `src/core/templates/experts/design-consultation.ts` — Phase 2 research curls, Q2 option list.
- `src/core/templates/experts/_shared.ts` — PREAMBLE AskUserQuestion Format step 1.
- `src/core/templates/workflows/onboard.ts` — Guardrails.
- `test/core/templates/skill-templates-parity.test.ts` — regenerated parity hashes (see tasks for the exact set that moves).
