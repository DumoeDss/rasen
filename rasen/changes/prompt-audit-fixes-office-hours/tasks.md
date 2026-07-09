# Tasks — prompt-audit-fixes-office-hours

## 1. office-hours.ts — Consultation precedence & terminal (IN-1, IN-2)

- [x] 1.1 Consultation posture (`:63–72`): state the posture is authoritative for the session and **replaces Phases 2, 3, and 4**; add the precedence clause that the `Phase 4 (MANDATORY)` header and the three "fully formed plan still runs Phase 3+4" rules apply to the interview paths (Startup/Builder), not to Consultation (IN-1).
- [x] 1.2 Phase 4 header (`:358`): scope MANDATORY to the interview paths ("MANDATORY on the interview paths") + a line that Phase 4 is not run in the Consultation posture (IN-1).
- [x] 1.3 Phase 2A `:241`, Phase 2B `:277`, Important Rules `:620`: add "(interview paths only; a concrete-design-plus-feedback opening routes to the Consultation posture, which replaces Phases 2–4)" to each fully-formed-plan statement (IN-1).
- [x] 1.4 Consultation terminal (in the Consultation posture / closing flow): after doc distillation on explicit "yes", deliver a plain summary + `/rasen:propose` pointer; SKIP Phase 4.5 and Phase 6 (IN-2).
- [x] 1.5 Phase 4.5 (`:395–408`) and Phase 6 "every user gets all three beats" (`:548`): scope to the interview paths (Startup/Builder); state the Consultation posture skips the founder close (IN-2).

## 2. office-hours.ts — interview seams (IN-4, IN-5, IN-6)

- [x] 2.1 Answer-first (`:85`): broaden to bind every question in the skill — keep the "Startup (2A) and Builder (2B)" mention AND add "and the Phase 3 Premise Challenge and Phase 4 approval prompts" (IN-4).
- [x] 2.2 Full-skip bar: keep Phase 2A `:241` real-evidence bar; qualify Builder `:277` and Important Rules `:620` to defer to the Startup real-evidence bar rather than an unqualified full skip (IN-5).
- [x] 2.3 Escape hatch (`:236`/`:277`): add one disambiguation line — after a Dialogue Override pause, a "proceed/continue" reply resumes the next question; only an explicit stop-asking signal fires the escape hatch (IN-6).

## 3. design-consultation.ts (IN-3, IN-7)

- [x] 3.1 Phase 2 research curls (`:85–88`): add `--noproxy '*'` to all three `localhost:3456` curls to match the embedded `CHROME_USE_SETUP` mandate and the existing `chrome-use-expert-methodology` spec (IN-3).
- [x] 3.2 Q2 (`:150`): add an exploratory-fork exemption note ("design forks are exploratory — Completeness scoring N/A") so option E's missing Completeness framing is intentional, per the PREAMBLE Completeness rule (IN-7).

## 4. _shared.ts PREAMBLE (SH-6)

- [x] 4.1 AskUserQuestion Format step 1 (`:71`): make Re-ground defer to the Dialogue Override — restate at session start / after a genuine gap, not on every consecutive AskUserQuestion call in continuous conversation (SH-6).

## 5. onboard.ts (IN-8)

- [x] 5.1 Guardrails (`:556–564`): add one line — if the user asks a question at a PAUSE, answer it, then resume the phase where you paused (IN-8; onboard does not embed the PREAMBLE, so the Dialogue Override does not cover it).

## 6. Regenerate & parity

- [x] 6.1 `pnpm build` (fall back to `node build.js` if the pnpm workspace file is mid-flight) — `update` reads `dist`, so build first.
- [x] 6.2 `node dist/cli/index.js update` — regenerate the `.claude/skills/*` from the templates.
- [x] 6.3 `npx vitest run test/core/templates/` — expect the parity golden-master to fail with new hashes.
- [x] 6.4 Hand-paste the new hashes from the assertion diff (no `-u` mechanism). Expected to move:
  - `getOfficeHoursSkillTemplate` + `rasen-office-hours` (office-hours body edits + SH-6)
  - `getDesignConsultationSkillTemplate` + `rasen-design-consultation` (design-consultation body edits + SH-6)
  - `getOnboardSkillTemplate` + `getOpsxOnboardCommandTemplate` + `rasen-onboard` (IN-8 only; onboard does not embed the PREAMBLE)
  - **every other PREAMBLE-embedding template's function + generated-content hash** (SH-6 touches the PREAMBLE)
- [x] 6.5 Confirm ONLY the expected templates' hashes moved — any non-PREAMBLE, non-office-hours/design-consultation/onboard template that moved is a mistake; re-inspect the diff before pasting.
- [x] 6.6 `npx vitest run test/core/templates/` again — green.

## 7. Validate

- [x] 7.1 `node dist/cli/index.js validate prompt-audit-fixes-office-hours` — passes (every requirement has ≥1 scenario; scenarios use 4-hashtag `#### Scenario:` headers).
