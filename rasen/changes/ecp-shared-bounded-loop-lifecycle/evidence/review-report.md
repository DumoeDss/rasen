# Pre-Landing Review: ecp-shared-bounded-loop-lifecycle

Base: `origin/dev/0.2.0@a1306828a23b2c4adc0db81f92b09498a5e92710`  
Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`  
Reviewed HEAD: `050fc84332b26a75a07f441efd6b235842f89e1e` plus the implementer-4 working-tree delta  
Mode: dispatched, report-only, independent verifier  
Greptile: skipped because no PR exists

## Outcome

`REVIEW VERDICT: BLOCKED - Blocker:2 Major:0 Minor:0 Trivial:0`

**DONE_WITH_CONCERNS.** The shared reducer, v1 normalization, independent loop limits, latest-attempt replay, exact WaitId decisions, canonical projection, and UI forward-compatibility controls are substantially implemented. Two required lifecycle paths remain non-executable: a research GoalLoop cannot finish its truthful exhausted report tail, and unsuccessful strategy actions do not consume or advance the strategy-attempt lifecycle.

## Scope check

**Scope Check: CLEAN within the assigned child scope.**

- Reviewed the shared bounded-loop lifecycle source, adapters, reconciler/facade integration, projection, Operations read/control surface, relevant tests, and the Change/Direction authority chain.
- The migrated branch contains a much larger shared-session recovery commit. Store migration, unrelated documentation, other Changes, and preserved test-output directories were explicitly excluded from this child review as instructed.
- No Canvas authoring/default-v2 migration was introduced. The UI wire/read projection is additive and the unknown-future lifecycle-version test proves controls are suppressed for an unrecognized contract.
- The only unchecked task is remote PR CI lane 7.3. The two findings below instead contradict tasks 3.1-3.4 and 4.6, which are currently marked complete.

## Standards axis

No independent maintainability, security, or UI-design finding was found beyond the two spec-path defects below.

**Standards count:** 0 findings.

## Spec axis

### Blocker 1: the generic Goal ship guard rejects the required research exhausted-report completion path

**Classification:** `[Blocker][ASK]`  
**Files:** `src/core/change-run/internal/facade-runtime.ts:561-590`, `src/core/change-run/internal/goal-cycle.ts:567-578`, `src/core/change-run/internal/reconciler.ts:267-285`  
**Requirement:** `specs/executable-goal-loop/spec.md:51-55`; `design.md` D2/D7 research-tail contract

The lifecycle reducer and reconciler intentionally treat an `exit` disposition as loop completion, add the loop node to the succeeded set, and allow its authored tail. After that tail completes, however, `facade-runtime.ts` applies `assertGoalCycleMayShip` to every completed Record containing a GoalCycle bounded loop. `assertGoalCycleMayShip` rejects every goal state whose domain outcome is not `satisfied`.

For the required research case, the final judge is deliberately unsatisfied, `iterationLimit` maps to `exit/max-rounds-exhausted`, and the report-only tail must finish without claiming success. When the report tail tries to settle the Run as completed, the facade throws `goal_cycle_ship_guard` before committing the final Record. The loop can therefore make the tail eligible but the Run cannot complete that tail, directly contradicting the scenario in the delta spec.

Required resolution:

- Make the completion guard distinguish a truthful research lifecycle `exit` followed by the report-only tail from a domain-success ship path, while retaining the satisfied/clean guard for actual success delivery.
- Add a facade-level regression test that drives a research GoalLoop through final unsatisfied judge -> `exit/max-rounds-exhausted` -> report-tail completion and asserts the canonical Record finishes with the goal still unsatisfied and lifecycle outcome preserved.
- Re-open task 4.6 until that end-to-end test passes. The current unit tests only prove `assertGoalCycleMayShip` rejects exhausted state in isolation; no report-tail completion test covers the new exception.

### Blocker 2: failed or resumed-blocked strategy actions never advance the strategy-attempt counter

**Classification:** `[Blocker][ASK]`  
**Files:** `src/core/change-run/internal/bounded-loop-lifecycle.ts:741-752,820-822`, `src/core/change-run/internal/reconciler.ts:777-795`, `src/core/change-run/internal/reducer.ts:1052-1079`  
**Requirement:** `specs/ecp-bounded-loop-lifecycle/spec.md:71-83,103-115`; tasks 3.1-3.4

`applyDisposition` counts only strategy actions whose result status is `succeeded`. Consequently:

- A failed strategy Action is terminal at the Action level but is not counted as an attempt. The reducer derives `attempt = completedAttempts + 1` again, the reconciler re-admits the same strategy-attempt node path with a new occurrence, and `strategyExhausted` is never selected from `maxAttempts`. Repeated failures consume loop/global action ceilings instead of the separately bounded strategy allowance.
- A blocked strategy Action is returned as `waiting`. Ordinary resume removes the exact wait but leaves the Action state `blocked`; the next reduction still returns `waiting`, now without a live WaitId. No fresh strategy occurrence is admitted, leaving the Run stranded.
- The public `strategyAttempts` projection has the same success-only count, so it also understates consumed attempts.

This violates the closed, separately bounded strategy lifecycle and deterministic exhaustion contract on normal operational failure/wait paths. It can produce silent same-attempt retries, the wrong terminal reason, or a wait-free deadlock.

Required resolution:

- Define and implement one closed status matrix for successful, failed, and blocked/resumed strategy Actions. Every logical strategy invocation must either authorize exactly one recovery (success), advance to the next bounded attempt/`strategyExhausted` (failure), or resume through a fresh replay-safe occurrence (blocked), without reusing the logical attempt or waiting without a wait.
- Derive the strategy counter and projection from that same logical-attempt model, not successful results alone.
- Add reducer/facade tests for failed strategy attempt 1 -> attempt 2, final failed attempt -> `strategyExhausted` exactly once, blocked strategy -> exact resume -> fresh attempt, and restart replay of each state.

**Spec count:** 2 findings (2 Blocker).

## Coverage review

```text
SHARED BOUNDED-LOOP LIFECYCLE COVERAGE
======================================
[covered] v1 source immutability + explicit normalized policy
[covered] v2 lowering and policy-free fail-closed validation
[covered] independent maxActions and budget admission limits
[covered] latest committed domain attempt after blocked retry/restart
[covered] structured progress/blocker fingerprints
[covered] successful strategy -> one recovery -> material/unchanged outcome
[covered] human-required exact WaitId decision and canonical refresh
[covered] cross-plane lifecycle projection and unknown-version UI suppression

[BLOCKED] research unsatisfied lifecycle exit -> report tail -> final completion
[BLOCKED] failed strategy -> next logical attempt -> exact strategy exhaustion
[BLOCKED] blocked strategy -> exact resume -> fresh strategy occurrence
```

Per dispatched review instructions, this verifier did not rerun tests. The implementer-4 handoff reports build PASS, core tests 126/126, UI typecheck PASS, and UI component tests 4/4. Those suites do not contain the two missing end-to-end paths above; task 4.6 is marked complete despite the absent research-tail regression.

## Durable findings for downstream slices

1. Do not reauthor built-ins to depend on research `exit/max-rounds-exhausted` until the final-completion guard is made lifecycle-aware and covered at facade level.
2. Treat strategy attempt identity and terminal status as one shared kernel contract before adding default strategies; success-only accounting is not a safe base for built-in policy.
3. Canvas authoring/default-v2 migration remains correctly outside this child and can stay sequenced after the kernel blockers close.

## Final status

`REVIEW VERDICT: BLOCKED - Blocker:2 Major:0 Minor:0 Trivial:0`

Pre-Landing Review: 2 issues (2 critical, 0 informational). Both are required-path lifecycle defects and must be resolved before this Change is review-clean.
