## Context

Six generic expert skills — `review`, `cso`, `qa`, `qa-only`, `benchmark`, `design-review` — were absorbed from Matt Pocock's grills as full-featured **standalone** tools. Each does more than report: it auto-fixes, commits, calls `AskUserQuestion`, spawns adversarial subagents, and self-saves reports under `.rasen/*-reports/` and `~/.rasen/projects/`. The auto / review-cycle / verify pipeline, however, dispatches them as **role-isolated leaf reviewer workers** (orchestration `_orchestration.ts` Step B/C/D/E): a reviewer must be report-only, non-author, no-spawn, and hand off through the change directory. The two contracts collide on the common path (audit findings RV-1..RV-5, RV-8, RV-9, SH-3, all verified against current source 2026-07-09; line numbers drifted ≤8 lines, content exact).

The user mandate ("重中之重"): do not mechanically patch every collision. For each absorbed behavior, ask *"does this genuinely benefit rasen's role-isolated pipeline?"* — KEEP (in which mode) / ADAPT (how it degrades when dispatched) / CUT (harmful or 缝合怪 residue, remove). 宁可删功能也不留缝合怪.

Constraints: edit only TS templates under `src/core/templates/experts/**` plus one sentence in `workflows/_orchestration.ts` Step B; `.claude/skills/*` are gitignored generated artifacts. Every generated `SKILL.md` that embeds the PREAMBLE regenerates → parity golden master hashes recomputed by hand (no `-u` mechanism).

## Goals / Non-Goals

**Goals:**
- One canonical severity vocabulary (Blocker/Major/Minor/Trivial) with an explicit per-expert mapping; experts self-map in dispatched mode so the loop never guesses.
- A single, self-triggering **dispatched (report-only) mode** contract in the PREAMBLE that turns off fix/ask/commit/subagent for the generic experts when they run as orchestrated leaf workers.
- One report-file convention that eliminates the double-write / "never ran" false negative, and a Step B text that matches reality.
- cso Phase 2 ↔ Phase 5 self-consistency (RV-8); denied-edit honesty (RV-9).
- A complete KEEP/ADAPT/CUT adjudication of every grills behavior with rationale (below).

**Non-Goals:**
- Verify/ship seams WF-1/7/8, and the "Never read source code" scoping RV-6/RV-7/SH-1/SH-2 — child #2 (`prompt-audit-fixes-verify-ship`). This change DEFINES the severity vocabulary; child #2 aligns verify verdict + ship gate to it (interface note below).
- Orchestration Step E/H text and the death-taxonomy — child #3 (`prompt-audit-fixes-orchestration`). This change touches ONLY the Step B report-contract sentence.
- Store path resolution (WF-3/WF-9) — child #6.
- codex.ts P1/P2 + GATE: not in Step B's generic-expert list nor the parallelGroup; its scale only meets others in ADVERSARIAL_STEP display-merge (cosmetic). Left alone per the audit's non-finding note.

## Decisions

### D1 — Canonical vocabulary = Blocker/Major/Minor/Trivial, defined in the PREAMBLE (RV-1, RV-2)

Blocker/Major/Minor/Trivial is already the **consumer** vocabulary (review-cycle Step E.1, review-cycle-workflow spec, opsx-orchestration spec: "no Blocker/Major open → clean"). The gap is purely producer-side. Definitions carried in a new PREAMBLE section:

- **Blocker** — must not ship: wrong behavior on a common path, data loss/corruption, exploitable security hole, a failing test/gate, or a spec requirement missing.
- **Major** — should not ship without an explicit decision: wrong behavior on a plausible path, a significant regression.
- **Minor** — ship-able friction/quality; recorded as accepted-known, never silently dropped.
- **Trivial** — cosmetic/nit.

**Per-expert mapping (the mapping table).** The producer normalizes, not the consumer — the LEAD does not carry the PREAMBLE, so putting the table in `_orchestration` Step D would be out of scope AND wrong-sided. Instead, in dispatched mode each expert **self-maps and tags every finding with a canonical severity** (written into `<skill>-report.md`):

| Expert (native scale) | → Blocker | → Major | → Minor | → Trivial |
|---|---|---|---|---|
| review `CRITICAL` / `INFORMATIONAL` | CRITICAL naming data-loss/security/corruption/crash on common path | other CRITICAL (correctness); INFORMATIONAL naming data-loss/security/silent-corruption | INFORMATIONAL (default) | pure nit/style |
| cso `CRITICAL \| HIGH \| MEDIUM` (+conf N/10) | CRITICAL | HIGH | MEDIUM | (cso drops <MEDIUM by design) |
| qa / qa-only `critical/high/medium/low/cosmetic` | critical | high | medium / low | cosmetic |
| benchmark `REGRESSION/WARNING/OK` + `Grade A–F` | REGRESSION crossing a hard budget (FAIL row) | REGRESSION (timing/size) | WARNING | OK; grade-only deltas |
| design-review impact `high/medium/polish` + `A–F` | (rare) high-impact broken/unusable UI | high impact | medium | polish |
| codex `[P1]/[P2]` (display-only, not gate-consumed) | P1 | P2 | — | — |

Content overrides label where they disagree (RV-1's canonical case: a data-corruption item review filed as INFORMATIONAL maps to Major, not Minor). Alternative considered — make review emit canonical severity natively and delete critical/informational: rejected, the two-pass CRITICAL/INFORMATIONAL split is review.ts's exploration structure and is useful standalone; tagging preserves it while satisfying the loop.

### D2 — Dispatched vs standalone mode, self-triggered from the existing dispatch prompt (RV-4, RV-5, SH-3)

New PREAMBLE section **"Dispatched vs standalone mode."** Trigger without a new plumbing dependency: every orchestrated dispatch prompt already ends with *"Do only this one unit of work — do NOT spawn subagents of your own; the LEAD owns all orchestration"* (Step B, `_orchestration.ts:50`). The PREAMBLE states: **if your invocation instructs you to do one unit of work / not spawn subagents / that a LEAD owns orchestration, you are a dispatched leaf worker → dispatched mode.** Otherwise (a human invoked you directly) → standalone mode.

Dispatched mode (report-only), for review/cso/qa/qa-only/benchmark/design-review:
- **No AUTO-FIX / no code edits.** Findings route through the LEAD's Step E triage to a non-author fixer.
- **No AskUserQuestion.** No interactive user at a leaf worker; ASK-class items are reported as unresolved findings for LEAD triage.
- **No git commit.** The LEAD/ship owns commits; concurrent commits on the shared index clobber (known project incident).
- **No self-spawned subagents.** Preserves the flat-hierarchy accounting the LEAD depends on.
- **Write the canonical `<skill>-report.md`** in the change dir, with canonical severities, then return.

Standalone mode keeps the richer behavior where D3 adjudicates KEEP. Chosen over a new explicit `MODE:` token in Step B because (a) the token is child #3's `_orchestration` territory, (b) the existing language is already unambiguous and present in every dispatch. Interface note: child #3 MAY add an explicit `MODE: dispatched (report-only)` token to Step B for belt-and-suspenders; this contract works without it.

### D3 — The adjudication table (KEEP / ADAPT / CUT)

Each absorbed behavior, adjudicated against "genuinely benefits rasen's role-isolated pipeline":

| # | Behavior (source) | Verdict | Rationale |
|---|---|---|---|
| 1 | qa fix loop — test→fix→verify (`qa.ts` Phase 8) | **ADAPT** — KEEP standalone, SUPPRESS dispatched | Genuinely useful for a solo dev running `/qa`. Dispatched, a reviewer that fixes collapses author≠verifier; findings must route to a non-author fixer (RV-4). |
| 2 | qa commit-per-fix (`qa.ts` Phase 8c) | **ADAPT** — KEEP standalone, CUT dispatched | Atomic per-fix commits help standalone. Dispatched, concurrent `git commit` on the shared index interleaves/clobbers; LEAD/ship owns commits (RV-4). |
| 3 | qa clean-tree STOP gate (`qa.ts` ~34-48) | **ADAPT** — KEEP standalone, CUT dispatched | Standalone needs a clean tree for atomic commits. Dispatched it is actively harmful: the diff-under-review + siblings' in-flight edits make the tree legitimately dirty; a clean-tree STOP would abort every dispatched run (RV-4). |
| 4 | design-review fix loop + commit + clean-tree gate (`design-review.ts` ~33-47, 120-132) | **ADAPT** — KEEP standalone, SUPPRESS/CUT dispatched | Identical reasoning to qa (#1-3). It is a fix+commit skill, not a read-only reviewer (RV-4). |
| 5 | review Fix-First AUTO-FIX (`review.ts` Step 5b) | **ADAPT** — KEEP standalone, SUPPRESS dispatched | Fix-First is review.ts's whole ethos standalone. Dispatched, auto-applying edits makes the reviewer the fixer and mutates the diff mid-review, defeating the loop's independent re-review (RV-5). |
| 6 | review AskUserQuestion batching (`review.ts` Step 5c) | **ADAPT** — KEEP standalone, CUT dispatched | Batched ASK is good UX standalone. Dispatched, there is no interactive user at a leaf worker — it blocks/fails; ASK-class items become reported unresolved findings (RV-5c). |
| 7 | ADVERSARIAL_STEP always-dispatch-subagent (`_shared.ts` ~1317, 1357) | **ADAPT** — KEEP standalone, CUT the subagent dispatch dispatched | The 精华 of adversarial review is fresh-context independence. Dispatched, a leaf worker spawning a subagent breaks flat-hierarchy (SH-3); and that independence is ALREADY supplied structurally by the pipeline (verify parallel-reviewer fan-out + non-author re-review). So the subagent dispatch is 糟粕 here — cut it, delegate independence to the LEAD. |
| 8 | TEST_COVERAGE generate+commit tests (`_shared.ts` ~1256) | **ADAPT** — KEEP standalone, CUT dispatched | Generating+committing AUTO-FIX tests helps standalone. Dispatched it mutates the diff mid-review and makes the reviewer an author (SH-3 case 2); coverage gaps become reported findings, test generation routes through LEAD triage to a non-author fixer. |
| 9 | Self-saved report paths `.rasen/*-reports/` + `~/.rasen/projects/` (cso/qa/qa-only/benchmark/design-review) | **ADAPT** — KEEP standalone, redirect dispatched | Cross-session trend/history (cso trend, benchmark trend, qa outcome) is a real standalone feature. Dispatched, dual paths cause the "never ran" false negative and divergent reports; write ONLY `<skill>-report.md` in the change dir (RV-3, D4). |
| 10 | cso Phase 7 Remediation Roadmap AskUserQuestion (`cso.ts` ~311) | **ADAPT** — KEEP standalone, CUT dispatched | Same as #6 — no interactive user dispatched. |
| 11 | cso Phase 8 JSON self-save (`cso.ts` ~322-332) | **ADAPT** — KEEP standalone (`.json`), redirect dispatched | Same as #9; dispatched writes `cso-report.md` (markdown, canonical severities). |
| 12 | review two-axis parallel `Agent` workers (`review.ts` ~115) | **ADAPT** — KEEP standalone (optional), CUT dispatched | Standalone the two-axis fan-out is an optional optimization. Dispatched it is another leaf-worker spawn → flat-hierarchy break; run the two axes inline. |
| 13 | review Greptile triage AskUserQuestion (`review.ts` ~208) | **ADAPT** — KEEP standalone, CUT dispatched | Greptile interaction is a standalone-only, user-facing flow; no user dispatched. |

No behavior is a pure KEEP-everywhere or pure CUT-everywhere except the subagent-dispatch of #7/#12 (cut only in dispatched). Nothing is deleted from standalone use — the "取其精华去其糟粕" here is *modal*: the same skill keeps its power for a human and sheds the pipeline-hostile parts when orchestrated.

### D4 — Report-file convention (RV-3)

One convention: **dispatched mode → the expert itself writes ONLY the canonical `<skill>-report.md` in the change directory** (`review-report.md`, `cso-report.md`, `qa-report.md` for qa AND qa-only, `benchmark-report.md`, `design-review-report.md`), with canonical severities. The worker verifies the file exists before `DONE` (it no longer *also* writes it — that was the divergence source). Standalone mode keeps the native `.rasen/*-reports/` + `~/.rasen/projects/` paths untouched.

Step B edit (the one `_orchestration.ts` sentence in scope): replace the false *"print findings to the conversation and save NOTHING; the worker … is responsible for ALSO writing"* with: the generic experts, **when dispatched, run report-only** (see PREAMBLE) and **write their findings to the canonical `<skill>-report.md` in the change directory themselves** (not their standalone `.rasen/*-reports/` paths); the worker verifies the report is present before returning. These files are what `ship`'s pre-flight, the resume cross-check, and `retro` consume. (Only review.ts truly saved nothing before; the claim was factually wrong for the other five.)

### D5 — cso probe/exclusion alignment (RV-8)

Make Phase 2 assessment agree with Phase 5 hard exclusions:
- **Auth brute-force / rate-limit (A04 probe):** KEEP the probe; NARROW hard-exclusion #1 to *"generic DoS / resource exhaustion / rate limiting — EXCEPTION: missing brute-force protection or rate limiting on authentication / security-sensitive endpoints IS reportable."* Brute-force on `/login` is a real, CVE-class vuln.
- **Audit logging (A09 probes):** DROP the "authorization failures logged? / admin actions audit-trailed?" probes from Phase 2 to agree with exclusion #16 (absence-of-logging is intentionally out of cso's zero-noise scope). Aligns Phase 2 down to Phase 5, rather than widening low-signal findings.
- **Generic-DoS STRIDE probe ("Can the component be overwhelmed?"):** DROP / annotate as assessed-for-context-not-reported, matching exclusion #1's generic-DoS half.

This is the split "取其精华去其糟粕": keep the security-relevant probe (auth brute-force), drop the low-signal ones (generic audit logging, generic DoS).

### D6 — Denied-edit honesty (RV-9)

Add one clause (PREAMBLE, near the dispatched-mode section, since freeze/guard can hit any editing skill): if an Edit/Write is **denied** — e.g. an active `/freeze` or `/guard` boundary and the target is outside it — the fix did NOT land; report it as an un-applied finding (`[BLOCKED: freeze/guard] file:line — proposed fix`), **never** `[AUTO-FIXED]`, and never silently drop it. Precedence is already correct (the hook wins); the gap was the Fix-First flow assuming edits always succeed. Primarily bites standalone (dispatched mode does no AUTO-FIX at all), but applies to standalone qa/design-review fix loops too.

## Risks / Trade-offs

- [Mode mis-detection: a standalone run that happens to include "do one unit of work" phrasing degrades to report-only] → Trigger keys on the *conjunction* of one-unit-of-work + no-spawn + LEAD-owns-orchestration, which is the exact Step B dispatch signature; a human rarely types all three. Child #3's optional explicit token removes residual ambiguity.
- [Cutting the adversarial subagent (#7) dispatched loses a review pass] → Independence is re-provided by the pipeline (parallel reviewers + mandatory non-author re-review); the adversarial *checklist content* can still run inline if desired. Net: no loss of coverage, gain of flat-hierarchy integrity.
- [Parity hash churn across many PREAMBLE-embedding templates] → Expected and bounded; the tasks tail rebuilds, regenerates, runs `test/core/templates/`, and hand-pastes only the moved hashes after confirming ONLY expected templates moved.
- [Shared working tree has another session's rebrand/externalize edits] → Never stage non-change files; ship uses explicit pathspec + `git show --stat`; whole-file rebrand bundling accepted per the office-hours-dialogue-override precedent and logged.

## Migration Plan

Pure prompt-template change; no data/runtime migration. Rollback = revert the commit and regenerate. Deploy = `pnpm build` → `node dist/cli/index.js update` → parity suite green with hand-pasted hashes.

## Open Questions

- Should dispatched mode run the adversarial checklist **inline** (fresh-eyes lost, checklist kept) or omit it entirely (rely wholly on pipeline independence)? Leaning omit to save leaf-worker context; revisit if verify coverage regresses. Recorded as accepted default, not a blocker.
- Interface handshake with child #2: the canonical vocabulary + mapping table is defined HERE (PREAMBLE); verify verdict-scale unification and ship-gate severity alignment consume it in `prompt-audit-fixes-verify-ship`. If child #2 needs the mapping in a non-PREAMBLE location (e.g. a verify skill that doesn't embed PREAMBLE), it references this capability rather than re-declaring the scale.
