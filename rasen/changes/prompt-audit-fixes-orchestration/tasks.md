## 1. Threshold disambiguation (OR-1, SH-4 — Critical) (`workflows/_orchestration.ts`)

- [x] 1.1 In Step H preamble (~@219), state the general rule: mid-task relay → handoff threshold (0.5); cross-change re-staffing → reuse threshold (0.25, stricter) (design D1).
- [x] 1.2 In H.2 (~@223), inline-exempt planner reuse + cross-child implementer reuse: compare to the reuse threshold per Step B.1.5 / G.1.3, NOT the handoff threshold (design D1).

## 2. Worker-death taxonomy + infra revival (H.4, OR-6) (`workflows/_orchestration.ts`)

- [x] 2.1 Replace H.4's single cold-reconstruct branch (~@231) with the three-class taxonomy: (a) context death → document relay (charged); (b) infra/transient death → `SendMessage` wake the SAME agent (re-read tasks.md/git status), backoff on overload waves, consumes NEITHER maxRelays NOR stallLimit; (c) transcript lost → cold-reconstruct (only here), record degradation (design D2).
- [x] 2.2 OR-6: state that `DONE` with unticked tasks is NOT a death — `SendMessage` the same in-session worker to finish/explain, no relay charged; cold-reconstruct only if unreachable/cross-session (design D2).
- [x] 2.3 Scope F.1's "agentIds are dead handles" (~@167) to CROSS-SESSION explicitly; promote the buried "SendMessage IS transcript-resume" note (~@176) into the F.1 rule body (design D2).

## 3. Counter disambiguation (OR-9, OR-13, OR-15) (`workflows/_orchestration.ts`)

- [x] 3.1 Add the counter table near Step H (relay / review-round / strategy-attempt / goal-round / goal-stall / handoff-stall / session-relay; each with cap + trigger + independence) (design D3).
- [x] 3.2 Step E (~@107): add "a review round may span multiple relays; round cap and maxRelays are independent" (OR-15).
- [x] 3.3 H.5 (~@233): add the maxRelays asymmetry note (worker relay soft-review after N; session relay hard-stop at N — OR-13) and the goal-loop parenthetical (loopStallLimit over rounds, not stallLimit over relays — OR-9).

## 4. Run-state + loop-role + portfolio + Tier-C (`workflows/_orchestration.ts`)

- [x] 4.1 OR-2: add `"n": 1` to the `sessionHandoff` example (~@157) with a comment noting it is the H.7-capped relay generation.
- [x] 4.2 OR-7: in Step E/H, resolve each dispatched worker's handoff threshold by its ACTUAL role, not the loop stage's nominal `role` (reviewer-in-review-loop example) (design D5).
- [x] 4.3 OR-3: in Step G, state child-pipeline gate resolution under portfolio — "proceeds automatically" governs the decompose decision only; child gates resolve per parent directive (auto-continue default, or one collapsed per-child checkpoint if user requested gating); precedence parent > child gate (design D6).
- [x] 4.4 OR-14: Step D parallelGroup — under Tier C run members sequentially in one context, collect all before proceeding (design D7).

## 5. Goal-loop config holes (OR-4, OR-5, OR-10, OR-12)

- [x] 5.1 OR-4: Step L evaluate branch (~@119) + goal-command invariants — Tier-C fallback = second freshly-reset single-context pass seeded only with goal+rubric+artifact (no impl transcript); else declare goal-loop-evaluate unsupported under Tier C. No implementer self-certification (design D7).
- [x] 5.2 OR-5: Step L Inject (~@113) copies `maxRounds` (+ `loopStallLimit` if set) from goal-plan.md into `iterate.loopConfig` (design D8).
- [x] 5.3 OR-10: Step L (~@122/@124) reads `loop.runArtifact` (fallback `goal-run.json`) instead of hardcoding the filename (design D8).
- [x] 5.4 OR-12: goal-command define-goal guardrail (`goal-command.ts:92`) generalize to "confirm the goal + gate (measure command OR evaluate goal/rubric)" (design D8).

## 6. Schema/policy + PREAMBLE/LEAD scope (OR-8, OR-11, SH-5, SH-7)

- [x] 6.1 OR-8: rewrite `ReuseThresholdSchema` doc comment (`types.ts:~126`) to occupancy-ceiling language (max occupancy to take a new change; stricter/lower than handoff), consistent with G.1.3 + the "stricter than handoff" note (~@470) (design D9).
- [x] 6.2 OR-11: define `verifyPolicy: standard` (single verify pass, no loop) and `light` (skip verify on trivial diff) in auto.ts §5 (~@77), alongside `adaptive` (design D9).
- [x] 6.3 SH-5: scope the PREAMBLE `solo` "Default to action"/proactive-fix (`_shared.ts:92`) and "ANY workflow step … Never let … silently pass" (`:96/:98`) to interactive/standalone; enumerate-and-gate carve-out — dispatched leaf workers record out-of-scope issues in DONE durable-findings, do not investigate/fix (design D10).
- [x] 6.4 SH-7: add to the Step-22 opener the explicit exception — LEAD does not author WHOLE stage artifacts but MAY apply trivial inline fixes per Step E.2 (re-reviewed by a non-author) (design D10).

## 7. Regenerate, verify, parity

- [x] 7.1 `pnpm build` — fall back to `node build.js` if the pnpm workspace file is mid-flight.
- [x] 7.2 `node dist/cli/index.js update` to regenerate all skills.
- [x] 7.3 `npx vitest run test/core/templates/` — SH-5's PREAMBLE edit moves the 15 PREAMBLE-embedding expert-skill hashes that carry the edited "Repo Ownership / See Something Say Something" section (benchmark, cso, design-review, qa, qa-only, review, chrome-use, codex, investigate, navigator, office-hours, prototype, tdd, codebase-design, design-consultation) in BOTH `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES`. Hand-paste from the assertion diff.
- [x] 7.4 NOTE (coverage gap): the orchestration-playbook templates (`rasen-auto`, `rasen-review-cycle`, `rasen-goal`) and `rasen-ship` / `rasen-verify-enhanced` are NOT in the parity registries — so this change's `_orchestration.ts` / `auto.ts` / `goal-command.ts` edits are NOT hash-locked; they are verified via build success + the "teaches store selection in every deployed command template" test + apply-stage review. Do NOT expect their hashes to move (they have none). types.ts (OR-8) is not a template — no parity movement.
- [x] 7.5 Confirm ONLY the expected expert-skill hashes moved (PREAMBLE embedders); re-run `npx vitest run test/core/templates/` green.
- [x] 7.6 `node dist/cli/index.js validate prompt-audit-fixes-orchestration` passes.

## 8. Parity-registry expansion — RELAYED to child #5 (do NOT do here)

- [x] 8.1 Record in durable findings: auto/review-cycle/goal/ship/verify-enhanced templates lack parity coverage (orchestration playbook ships unverified). This is a self-contained hardening unit; relay to child #5 (parity-hardening) rather than balloon child #3. Child #2 already closed the chrome-use gap; this is the larger remaining parity debt.
