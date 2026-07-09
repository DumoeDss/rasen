# Review report — prompt-audit-fixes-orchestration (child #3)

Reviewer: dispatched, report-only (author ≠ verifier). Scope: the 6 files the implementer changed
(`workflows/_orchestration.ts`, `workflows/auto.ts`, `workflows/goal-command.ts`, `experts/_shared.ts`,
`src/core/pipeline-registry/types.ts`, `test/core/templates/skill-templates-parity.test.ts`) + the 6 spec
deltas + tasks/proposal/design, checked against `audit/audit-orchestration.md` (OR-1..15) and
`audit/audit-shared.md` (SH-4/5/7).

## Verdict

**FINAL (after fix rounds 1–2): CLEAN — 0 Blocker, 0 Major, 0 Minor open, 0 Trivial open** (2 informational
notes remain, non-blocking). Minor-1, Trivial-1, and Minor-2 all RESOLVED. LEAD ruling recorded: D6
auto-continue default upheld and surfaced to the user in ship-log + run-end report as a reversible product
decision. No open Blocker/Major → review-cycle termination invariant satisfied. APPROVED — proceed.

(Round-1 opening verdict was CLEAN with 1 Minor + 1 Trivial; both fixed round 1, plus a Minor-2 prose
ambiguity fixed round 2. History below.)

## Verification performed (all green)

- `npx vitest run test/core/templates/` → **6 tests passed**.
- `node dist/cli/index.js validate prompt-audit-fixes-orchestration` → **valid**.
- Parity moved-hash set: **exactly the 15 PREAMBLE-embedding expert skills moved** in BOTH
  `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` (benchmark, chrome-use,
  codebase-design, codex, cso, design-consultation, design-review, investigate, navigator, office-hours,
  prototype, qa, qa-only, review, tdd). `careful/freeze/guard/unfreeze` correctly UNMOVED — verified they
  do NOT `import { PREAMBLE }` from `_shared.js` (grep), so the SH-5 PREAMBLE edit does not reach them.
  Orchestration playbook templates (rasen-auto/review-cycle/goal) carry no parity hashes (coverage gap,
  relayed to child #5 per task 8.1) — verified instead via build + regenerated SKILL.md greps.
- Grep spot-checks on regenerated `.claude/skills/rasen-auto/SKILL.md` (regenerated 15:02, post-edit):
  death taxonomy (4 hits), two-threshold rule (5), counter table + maxRelays asymmetry (6), and my own
  check — in-session `SendMessage` revival + `DONE`-with-unticked (2). All present → templates regenerate.

## 1. Contract fidelity — all findings implemented per D1–D11

| Finding | Decision | Status | Evidence |
|---|---|---|---|
| OR-1 / SH-4 (Critical) | D1 | ✅ | Step H preamble "Two threshold families" + H.2 inline exemption redirecting planner/cross-child reuse to reuse threshold (0.25) per B.1.5/G.1.3 |
| OR-2 | D4 | ✅ | `sessionHandoff.n:1` in Step F example + prose "a record without `n` reads as generation 1 and never advances" |
| OR-3 | D6 | ✅ (1 Minor) | Step G child-gate clause: "proceeds automatically" = decompose decision only; auto-continue default; precedence parent > child gate |
| OR-4 | D7 | ✅ | Step L evaluate Tier-C fallback (freshly-reset single-context pass, no impl transcript) + goal-command invariant |
| OR-5 | D8 | ✅ | Step L Inject copies `maxRounds`(+`loopStallLimit`) from goal-plan.md |
| OR-6 | D2 | ✅ | H.4b: DONE-with-unticked = not a death → SendMessage same worker, no relay |
| OR-7 | D5 | ✅ | Step E "Per-role threshold inside a loop stage" (reviewer-in-review-loop example) |
| OR-8 | D9 | ✅ | ReuseThresholdSchema comment rewritten to occupancy-ceiling |
| OR-9 | D3 | ✅ | H.5 parenthetical (loopStallLimit over rounds ≠ stallLimit over relays) + counter table |
| OR-10 | D8 | ✅ | `loop.runArtifact` (fallback goal-run.json) honored at Inject, Record, and Resume |
| OR-11 | D9 | ✅ | auto §5 defines `standard` + `light` alongside `adaptive` |
| OR-12 | D8 | ✅ | goal-command define-goal guardrail generalized to goal + gate (measure command OR evaluate rubric) |
| OR-13 | D3 | ✅ | maxRelays asymmetry note (soft worker-review vs hard session-stop) in table + H.5 |
| OR-14 | D7 | ✅ | Step D parallelGroup Tier-C sequential-in-context clause |
| OR-15 | D3 | ✅ | Step E.5 "a review round MAY span multiple worker relays; round cap and maxRelays are INDEPENDENT" |
| SH-5 | D10 | ✅ | PREAMBLE scope clause; flagging duty survives (→ DONE durable-findings), only autonomous investigate/fix/ask suppressed |
| SH-7 | D10 | ✅ | Opener "you do NOT author WHOLE stage outputs… Exception: MAY apply trivial inline fix per Step E.2" |
| H.4 infra-revival | D2 | ✅ | H.4a three-class taxonomy (context/infra/transcript-lost); infra revivals consume neither maxRelays nor stallLimit; wake-fail falls through to (c) |

## 2. Instruction-prose integrity (core dimension) — sound

- **Death taxonomy** — mutually exclusive & jointly exhaustive on stated SIGNALS: HANDOFF/hit-limit → (a);
  environment fault / returned-nothing + intact transcript + same session → (b); no live agent AND no
  recoverable transcript → (c); DONE-unticked → H.4b (not a death). **"Transcript intact" is decidable at
  decision time** (in-session agent handle live + transcript pointer present; cross-session ⇒ dead handle ⇒
  (c)). **Wake-failure path is stated**: "Only if the wake fails (agent unreachable / transcript gone) does
  this fall through to (c)" and H.4b "escalate to (c) ONLY if cross-session/unreachable." Labels internally
  consistent — F.1 references "H.4a(b) infra-death and H.4b unticked-`DONE`" correctly.
- **Two-threshold rule** — every re-engagement classifies unambiguously: mid-task relay → handoff (0.5);
  cross-change re-staffing (planner B.1.5, cross-child implementer G.1.3) → reuse (0.25). Grepped every
  threshold pointer in `_orchestration.ts` (lines 68/76/101/208/212/227/229/247): **no remaining sentence
  points planner reuse at the handoff threshold.** H.2 still lists "planner reuse" in its trigger set (all
  those cases need the guard) but the appended sentence explicitly redirects it to the reuse threshold.
- **Counter table** — grepped all counter tokens (maxRelays/stallLimit/maxRounds/loop.maxRounds/
  strategyAttempts/loopStallLimit/sessionHandoff.n) across the source; **every counter named anywhere maps
  to a table row with matching semantics.** No orphan counter; no shared tally.
- **SH-5 scoping** — does NOT suppress the flag duty: out-of-scope issues route to DONE durable-findings
  ("Recording it in durable-findings IS 'not letting it silently pass'"); only autonomous investigate/fix/
  ask-user is overridden. Last sentence explicitly disclaims reopening the report-only dispatched contract,
  so no conflict with child #1's expert report-file channel (in-scope findings → `*-report.md`; unrelated
  noticed issues → durable-findings — distinct channels).
- **No new unscoped absolutes / no unmapped vocab**: added absolutes carry scope ("NEVER let the
  implementer self-certify" is scoped to Tier-C evaluate; "do NOT apply the handoff threshold to a reuse
  decision"). New terms ("auto-continue checkpoint", "occupancy ceiling") are self-defined inline. Severity
  vocab stays Blocker/Major/Minor/Trivial.
- **No §5 summary-drift**: auto.ts metadata line 51 still points "verifyPolicy (section 5)"; section 5 was
  renamed in title only (still `## 5.`), now covers all three values. Cross-ref resolves.

## 3. Seam integrity — clean

- All 6 deltas use **ADDED Requirements** only (no fragile MODIFY) — consistent with the design note that
  the existing worker-reuse / handoff / gate specs do not assert the contradicted numbers.
- `expert-dispatch-contract` delta extends child #1's PREAMBLE dispatch contract and explicitly does not
  reopen report-only — no contradiction.
- **Child #1's Step B report-contract sentence (`_orchestration.ts:56`) is intact** — verified verbatim,
  not in the diff. **Child #2's evidence-chain** lives in verify-change/verify-enhanced/ship, none of which
  are in the diff. Both survive unmodified.

## Findings

### Minor-1 — auto.ts gate guardrail left textually unqualified (OR-3 residual)
`auto.ts:130` "**Always pause at gate stages — never skip human confirmation.**" is absolute. The OR-3
reconciliation lives in Step G (which explicitly names it: "reconciles the auto command's 'always pause at
gate stages', which governs a NON-portfolio run") and states precedence parent > child gate. Both are in the
same generated `rasen-auto` skill, so a reader who reaches Step G is correct. But a reader hitting the
guardrail list first gets no back-pointer to Step G. A 4-word cross-reference on line 130 (e.g.
"(non-portfolio run; child gates → Step G)") would close the residual. **Friction, not wrong-behavior** —
Step G resolves precedence unambiguously. Non-blocking.

### Trivial-1 — tasks.md 7.3 miscounts PREAMBLE embedders
Task 7.3 lists "19 PREAMBLE-embedding expert skills" including careful/freeze/guard/unfreeze. Those 4 do NOT
import PREAMBLE, so the correct moved set is **15**. The implementation is correct (15 moved, 4 unmoved);
only the task-note count is inaccurate. Documentation nit.

### Informational
- **Death-taxonomy (a)-vs-(b) boundary**: a silent "returned nothing" that is actually context exhaustion
  defaults to (b) infra-revival. This is a residual ambiguity, but explicitly documented in design Risks as
  cheap/self-correcting (a genuinely-full worker HANDOFFs on the wake turn → reclassified to (a)). No action.
- **verifyPolicy defined only in auto §5**: review-cycle/goal commands embed the playbook without §5. Fine —
  `verify` stages only run under the auto command; matches the audit's own framing and design D9's choice.

## Fix round 1 — delta re-review

Delta reviewed: `auto.ts` guardrail back-ref + tasks.md 7.3 count. Tests 6/6, zero hash movement
(expected — auto.ts parity-uncovered), validate clean (re-confirmed).

- **Minor-1 → RESOLVED.** `auto.ts:130` now reads "Always pause at gate stages — never skip human
  confirmation (for a decomposed portfolio's child-pipeline gates, this resolves per the playbook's Step G
  child-gate semantics: parent directive > child gate)." The back-ref is **correctly scoped and does NOT
  over-generalize**: it applies the exception only to "a decomposed portfolio's child-pipeline gates" and
  defers resolution to Step G; the main clause still governs top-level (non-portfolio) gates. Present in
  both regenerated artifacts (SKILL.md:380 + commands/rasen/auto.md:376).
- **Trivial-1 → RESOLVED.** tasks.md 7.3 now lists exactly the 15 embedders (benchmark, cso, design-review,
  qa, qa-only, review, chrome-use, codex, investigate, navigator, office-hours, prototype, tdd,
  codebase-design, design-consultation).

### NEW Minor-2 — Step G sentence-1 wording invites the opposite reading (surfaced by the re-review question) — RESOLVED round 2

**Round 2:** S1 reworded exactly as recommended ("…governs the decompose decision only — it does not by
itself decide how the children's pipeline gates resolve; those resolve per the parent run's gate directive
(below)"); "does NOT suppress … by default" removed. S2/D6 auto-continue default unchanged. Present in both
regenerated embedders (rasen-auto SKILL.md + rasen-review-cycle SKILL.md), tests 6/6 zero hash movement,
validate clean. LEAD upheld D6 auto-continue default and surfaced it to the user (ship-log + run-end report)
as a reversible product decision — the design-note question below is thereby dispositioned.


The re-review asked whether "no explicit gate directive → child gates still PAUSE" is preserved. **It is
NOT** — and that is deliberate, but the prose actively invites the wrong reading. Step G, sentence 1:
"'Proceeds automatically' … does NOT **suppress** the children's own pipeline gates **by default**" reads
naturally as "child gates still fire (pause) by default" — which is the exact reading the re-review posits.
Sentence 2 then says the opposite for the same case: "a parent auto run the user launched autonomously (or
that resolved decompose without a gate) treats child gates as **auto-continue checkpoints** — do NOT pause
per child." "suppress" is used in the narrow sense of *drop/ignore entirely* (distinct from *auto-continue =
record-but-don't-pause*), but that distinction is not obvious, so S1 and S2 read as contradicting on the
default. **Recommend tightening S1** to remove "suppress … by default", e.g.: "'Proceeds automatically'
governs the decompose decision only — it does not by itself decide how the children's own pipeline gates
resolve; those resolve per the parent run's gate directive (below)."

**Design note (not a fix regression):** the actual behavior — autonomous/no-directive default = auto-continue
(do NOT pause), user-requested-gating = one collapsed checkpoint per child — is the DELIBERATE D6 decision
("Chosen default = auto-continue; the 9-pause literal reading is explicitly rejected", with the surprise
trade-off recorded in design Risks). If the intended product behavior is instead "no directive → still pause
each child gate" (the re-review's expectation), that is a **D6 default reversal — a design decision for the
LEAD/user**, not something this fix round introduced. My round-1 verdict accepted D6 as written. Non-blocking
either way; flagging so the default is chosen deliberately, not by prose accident.

## Durable findings (1–3 lines)
- Parity truth: only the 15 PREAMBLE-importing expert skills carry a PREAMBLE hash; careful/freeze/guard/
  unfreeze do not import PREAMBLE (task-note "19" is wrong). Orchestration playbook templates (auto/
  review-cycle/goal/ship/verify-enhanced) remain hash-unlocked — the real remaining parity debt, relayed to
  child #5.
- OR-3 was reconciled inside Step G but the auto.ts:130 guardrail line was left unqualified; if child #5/#4
  touch auto.ts, adding a Step-G back-reference there would fully close the seam.
