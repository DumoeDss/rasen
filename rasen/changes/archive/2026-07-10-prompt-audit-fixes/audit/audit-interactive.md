# Interactive / dialogue-flow prompt-conflict audit

Scope: dialogue-heavy expert & workflow skill templates, checked A–F within-file and
against the shared `PREAMBLE` (esp. the new **Dialogue Override**) and the chrome-use
shared blocks. Every finding names a concrete misbehavior. Line numbers are 1-based in the
`.ts` source (they point at the template-string content, which is the actual system prompt).

Taxonomy: A rule-vs-rule contradiction / B missing state / C precedence gap /
D wrong-generalization / E buried override / F cross-block seam conflict.
Severity: Critical = wrong behavior on a common path / Major = plausible path / Minor = ambiguity-friction.

---

## IN-1 — Consultation posture vs. "fully formed plan still runs Phase 3 + Phase 4 (MANDATORY)"
- **Taxonomy:** A (+ C precedence gap)
- **Severity:** Critical
- **File/sides:**
  - `src/core/templates/experts/office-hours.ts:35` (Consultation short-circuit) and `:64`–`:72` (Consultation posture)
  - vs `office-hours.ts:358` (`## Phase 4: Alternatives Generation (MANDATORY)`) + `:387` (`Do NOT proceed without user approval of the approach.`)
  - vs three "fully formed plan" rules: `office-hours.ts:241`, `:277`, `:620`

**Quotes.**
- `:35` "**Consultation short-circuit** … If the user's opening message already contains a **concrete design or plan** PLUS a **feedback request** … skip the goal question entirely and go straight to the **Consultation posture**."
- `:68`–`:70` "**Skip generative questioning.** … **Deliver analysis prose directly.** … **Offer the doc only after convergence.** … never rush to it, and never treat it as the goal the session is driving toward."
- `:358` "## Phase 4: Alternatives Generation (MANDATORY) … This is NOT optional." + `:387` "Present via AskUserQuestion. Do NOT proceed without user approval of the approach."
- `:620` (Important Rules) "**If user provides a fully formed plan:** skip Phase 2 (questioning) but still run Phase 3 (Premise Challenge) and Phase 4 (Alternatives). Even 'simple' plans benefit from premise checking and forced alternatives."
- `:241` (Phase 2A) "Only allow a FULL skip … if the user provides a fully formed plan … **Even then, still run Phase 3 (Premise Challenge) and Phase 4 (Alternatives).**"
- `:277` (Phase 2B) "or a fully formed plan → fast-track to Phase 4 … skip Phase 2 entirely but **still run Phase 3 and Phase 4**."

**Why it conflicts.** "A concrete design or plan PLUS a feedback request" (the short-circuit trigger) *is* "a fully formed plan." So the same opening message matches two mutually exclusive routes, and there is no precedence rule choosing between them:
- Consultation posture route: skip questioning, discuss peer-to-peer, offer the doc only after convergence — explicitly bypassing Phase 4's alternatives + approval gate (Phase 5's HARD GATE even provides a dedicated Consultation doc-entry at `:414`).
- "Fully formed plan" route (stated 3×, plus Phase 4 flagged MANDATORY/not-optional): must run Phase 3 Premise Challenge and Phase 4 (produce 2–3 approaches, get AskUserQuestion approval) regardless.

Note the conflict survives either reading of the posture's scope: Consultation posture says it replaces "the generative interview" (Phase 2) — it is silent on Phases 3/4. If an agent reads it as "posture replaces only Phase 2," it then runs the MANDATORY Phase 3/4 machinery *after* the peer discussion, contradicting the posture's own "offer the doc only after convergence / never rush to it." If it reads the posture as replacing 3/4 too, it contradicts the three "still run Phase 3 and Phase 4" rules.

**Concrete misbehavior.** User opens `/office-hours` with a fleshed-out design and "poke holes in this." An agent anchored on Phase 4 = MANDATORY and Important Rules `:620` responds by generating 2–3 alternative approaches and firing an AskUserQuestion approval menu — the exact "present a menu / drive toward the doc" anti-pattern the Consultation posture was added to eliminate. This is the headline use case the office-hours patch targets, so the contradiction bites on the most common path.

**Fix direction.** Make the posture authoritative for its whole session and state precedence explicitly: "Consultation posture replaces Phases 2–4 for concrete-design-with-feedback openings; Phases 3/4's MANDATORY/'fully formed plan still runs Phase 3+4' rules apply only to the interview path (vague idea / Startup / Builder), not to Consultation." Reconcile the three "fully formed plan" sites with the short-circuit so a concrete-design-plus-feedback opening deterministically goes to Consultation.

---

## IN-2 — Consultation posture has no defined Phase 4.5 / 5 / 6 handoff; mode-scoped closing fires the founder plea on a peer-review session
- **Taxonomy:** B (missing state)
- **Severity:** Major
- **File/sides:** `office-hours.ts:64`–`:72` (Consultation posture, a third entry that never sets a mode) vs `:395`–`:408` (Phase 4.5 founder-signal synthesis, assumes Startup/Builder session), `:548` (Phase 6: "Every user gets all three beats regardless of mode (startup or builder)."), `:572`–`:603` (tiered golden-age founder plea).

**Quotes.**
- `:50`–`:52` mode mapping produces only "Startup mode (Phase 2A)" or "Builder mode (Phase 2B)"; Consultation posture is entered *before* the goal/mode question (`:35`) so no mode is ever assigned.
- `:397` "Before writing the design doc, synthesize the founder signals you observed during the session" — but Consultation posture skipped Phase 2A/2B, so no signals were tracked.
- `:548` "Every user gets all three beats regardless of mode (startup or builder). The intensity varies by founder signal strength."
- `:601`–`:603` base-tier plea: "The skills you're demonstrating right now — taste, ambition, agency … are exactly the traits great founders share."

**Concrete misbehavior.** A developer uses office-hours as a design peer-review (Consultation posture), converges, says "yes, write it up." The agent reaches Phase 4.5/6, which are written only for Startup/Builder sessions, has no tracked founder-signal count, and per `:548` must still deliver all three closing beats — ending a technical design consultation with the "you could be a founder / this is the golden age" plea. Tone/content mismatch on a plausible path; also undefined behavior for the signal-count tier selection.

**Fix direction.** Give Consultation posture an explicit terminal: after the doc is distilled, deliver a plain summary + `/rasen:propose` pointer and **skip** Phases 4.5 and 6 (or add a Consultation branch to Phase 6 that omits the founder plea). Scope `:548`'s "every user" to the interview paths.

---

## IN-3 — design-consultation research curls drop `--noproxy '*'`, contradicting the embedded CHROME_USE_SETUP mandate
- **Taxonomy:** F (cross-block seam: skill body vs embedded shared block)
- **Severity:** Major
- **File/sides:** `src/core/templates/experts/design-consultation.ts:49` embeds `${CHROME_USE_SETUP}` (which is `_shared.ts:108`–`:139`, mandate at `:136`) vs `design-consultation.ts:85`–`:88` (Phase 2 research curls).

**Quotes.**
- `_shared.ts:136`–`:139` "**Every curl below passes `--noproxy '*'`** — on a machine with a configured `HTTP(S)_PROXY`, `curl localhost:3456` is otherwise hijacked … and returns 502. Keep the flag on every call."
- `design-consultation.ts:85`–`:88`:
  ```
  TAB=$(curl -s "localhost:3456/new?url=https://example-site.com" | jq -r .targetId)
  curl "localhost:3456/screenshot?target=$TAB&file=/tmp/design-research-site-name.png&full=true"
  curl "localhost:3456/snapshot?target=$TAB"
  ```
  (no `--noproxy '*'` on any of the three).

**Concrete misbehavior.** On any machine with `HTTP_PROXY`/`HTTPS_PROXY` set (the exact case the flag exists to guard), the Phase 2 visual competitive-research calls hit the outbound proxy instead of the local chrome-use proxy, get 502s, and the agent concludes chrome-use is unavailable and silently degrades to WebSearch-only — losing the skill's screenshot/snapshot research on precisely the environments the shared block warns about. Every other curl in the repo's chrome-use blocks carries the flag; these three are the outlier.

**Fix direction.** Add `--noproxy '*'` to all three Phase 2 curls (and any other chrome-use curls in this file, e.g. the Phase 5 flow) to match the embedded mandate.

---

## IN-4 — "Answer before you ask … binds 2A and 2B" narrows the global Dialogue Override, implying Phase 3/4 approval prompts are exempt
- **Taxonomy:** E (buried override) / C
- **Severity:** Minor
- **File/sides:** `office-hours.ts:85` (Interview discipline) vs `_shared.ts:38`–`:44` (Dialogue Override, global) and the AskUserQuestion gates at `office-hours.ts:354` (Phase 3) and `:387` (Phase 4).

**Quotes.**
- `_shared.ts:40` "**Before every AskUserQuestion call**, read the user's previous message. If it contains a question … pause the question flow."
- `office-hours.ts:85` "**Answer before you ask.** … answering always precedes advancing the question list … **This binds both Startup mode (2A) and Builder mode (2B).**"

**Why it's a hazard.** The local restatement enumerates only 2A/2B. Phase 3 (Premise Challenge confirm) and Phase 4 (approach approval) are the *most decision-heavy* AskUserQuestion gates, and an agent can read the explicit "binds 2A and 2B" as scoping the answer-first duty to the interview, treating the Phase 4 approval prompt as exempt. The global Dialogue Override still covers it, so this is friction, not a hard break.

**Concrete misbehavior.** At the Phase 4 approval menu the user asks "why do you recommend Approach B over A?" The agent, reading answer-first as 2A/2B-only, re-issues the AskUserQuestion approval menu instead of answering the question first.

**Fix direction.** Change `:85` to "binds every question in this skill, including the Phase 3 and Phase 4 approval prompts," or drop the mode enumeration so it doesn't read as an exhaustive scope.

---

## IN-5 — Inconsistent bar for a FULL skip on a "fully formed plan"
- **Taxonomy:** C (precedence gap)
- **Severity:** Minor
- **File/sides:** `office-hours.ts:241` (Phase 2A) vs `:277` (Phase 2B) vs `:620` (Important Rules).

**Quotes.**
- `:241` "Only allow a FULL skip … if the user provides a fully formed plan **with real evidence — existing users, revenue numbers, specific customer names.**"
- `:277` "or **a fully formed plan** → fast-track to Phase 4 … skip Phase 2 entirely."
- `:620` "If user provides **a fully formed plan:** skip Phase 2."

**Concrete misbehavior.** In Startup mode a user presents a detailed but pre-revenue plan. Phase 2A `:241` forbids a full skip (no "real evidence"); Important Rules `:620` and the Builder-mode `:277` permit it. The agent gets contradictory guidance on whether to skip the Six Forcing Questions — the evidence-gated bar (`:241`) is the one that matters for startups and is the one most likely to be overridden by the unqualified `:620`.

**Fix direction.** Qualify `:620` (and `:277`) with "in Startup mode, a full skip still requires the real-evidence bar of Phase 2A," or point both back to `:241`.

---

## IN-6 — "just do it" is ambiguous between Dialogue Override "signal to proceed" (resume questions) and the escape-hatch skip
- **Taxonomy:** C (precedence gap)
- **Severity:** Minor
- **File/sides:** `_shared.ts:40`–`:42` (Dialogue Override "resume the phase … never skip ahead" once the user "explicitly signals to proceed") vs `office-hours.ts:236`/`:277` (escape hatch triggered by "just do it").

**Quotes.**
- `_shared.ts:40` "keep discussing until the user **explicitly signals to proceed. Then resume the phase exactly where you paused; never skip ahead.**"
- `office-hours.ts:236` "Trigger this ONLY on an explicit skip signal … (**'just do it,'** 'skip the questions,' 'stop asking, just write it')."

**Why it's borderline.** After the agent answers a mid-interview question in prose (Dialogue Override), a user reply of "ok, just do it" matches the escape-hatch's verbatim example *and* reads as a "signal to proceed" under Dialogue Override. The two rules diverge: Dialogue Override → resume the next interview question; escape hatch → fire (ask 2 more, then jump to Phase 3). No precedence rule disambiguates "proceed with the questions" from "skip the questions." Most phrasings ("let's continue" vs "just write it") separate cleanly, so impact is limited.

**Fix direction.** Add one line: "After a Dialogue Override pause, 'proceed/continue' resumes the next question; only an explicit *stop-asking* signal fires the escape hatch."

---

## IN-7 — design-consultation Q2 offers a shortcut option (E) without the PREAMBLE-required Completeness framing
- **Taxonomy:** F (seam: skill body vs PREAMBLE AskUserQuestion Format)
- **Severity:** Minor
- **File/sides:** `_shared.ts:31` (AskUserQuestion Format / Completeness rule) vs `design-consultation.ts:150` (Q2 options).

**Quotes.**
- `_shared.ts:31` "Include `Completeness: X/10` for each option **only when the decision weighs a shortcut against a complete implementation** … always prefer the complete option over shortcuts."
- `design-consultation.ts:150` "**Options:** A) Looks great — generate the preview page. … E) Skip the preview, just write DESIGN.md."

**Why it's minor.** A→E (skip the preview, which the skill calls its most persuasive artifact, `:349`) is a shortcut-vs-complete fork, so the PREAMBLE would call for Completeness scoring and a complete-preferred nudge. The skill's conversational ethos otherwise makes this low-stakes, but the formats are technically inconsistent.

**Fix direction.** Either mark E as a shortcut with a Completeness note per the PREAMBLE, or add "design forks are exploratory — Completeness scoring N/A" to the skill so the omission is intentional, not a silent format break.

---

## IN-8 — onboard PAUSE points have no "user asks a question here" branch
- **Taxonomy:** B (missing state)
- **Severity:** Minor
- **File/sides:** `src/core/templates/workflows/onboard.ts` — `:172`, `:254`, `:392` (PAUSE points) and `:561` ("Pause for acknowledgment … but don't over-pause"). onboard does **not** embed PREAMBLE, so no Dialogue Override applies.

**Quote.** `:172` "**PAUSE** - Wait for user acknowledgment before proceeding."

**Why it's minor.** onboard uses free-text acknowledgment PAUSEs, not AskUserQuestion menus, and is explicitly conversational with graceful-exit handling, so a user question at a PAUSE is naturally answerable. But there is no written instruction to answer-then-resume, so a rigid agent could treat a mid-PAUSE question as "not an acknowledgment" and re-prompt. Low risk because there is no menu to loop on.

**Fix direction.** One line in Guardrails: "If the user asks a question at a PAUSE, answer it, then resume the phase where you paused." (Or embed PREAMBLE for the Dialogue Override, consistent with the expert skills.)

---

## Files reviewed with no dialogue-flow findings
- **`experts/investigate.ts`** — embeds PREAMBLE; its AskUserQuestion points (Phase 1 context, 3-strike `:129`, blast-radius `:174`) are covered by the global Dialogue Override; "proceed if the user is AFK" (`:125`) is a no-message case, not an answer-and-advance violation. Gating chain (Iron Law → Phase 1 red-loop gate → hypotheses) is internally consistent. No re-creation of the office-hours bug.
- **`experts/codebase-design.ts`** — pure vocabulary reference, no question flow; embedded PREAMBLE machinery is inert but harmless.
- **`experts/navigator.ts`** — `disableModelInvocation: true` map; no question flow; embedded PREAMBLE inert.
- **`workflows/explore.ts`** — free-form "stance, not a workflow"; no AskUserQuestion state machine; does not embed PREAMBLE but has no question flow to break. `/prototype` exception stated consistently in both copies.
- **`workflows/feedback.ts`** — linear draft→approve→submit; explicit-confirmation guardrails are self-consistent; no question-back state to miss.

(Excluded per scope: openspec→rasen branding staleness; pure style/duplication such as the two near-identical explore templates.)

---

## Summary
- **Critical: 1** (IN-1)
- **Major: 2** (IN-2, IN-3)
- **Minor: 5** (IN-4, IN-5, IN-6, IN-7, IN-8)
- **Total: 8**
