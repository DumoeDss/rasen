# Review Cycle: ecp-shared-bounded-loop-lifecycle

Rounds: 1/3  
Tier: A (native role-isolated fixer and non-author reviewer)  
Status: CLEAN  
Base HEAD: `050fc84332b26a75a07f441efd6b235842f89e1e`

## Final verdict

`REVIEW VERDICT: CLEAN - Blocker:0 Major:0 Minor:0 Trivial:0`

Both Round 0 Blockers are resolved in the scoped fixer delta and independently confirmed. No remaining or new Blocker/Major finding was found.

## Round history

| Round | Findings entering (B/Ma/Mi/T) | Triage | Fixed by | Confirmed by (non-author) | Resolved |
|---|---:|---|---|---|---:|
| 1 | 2/0/0/0 | Both required kernel fixes; no deferral | Round 1 fixer | Independent Round 1 reviewer (this report) | 2/2 |

## Scope check

**Scope Check: CLEAN.**

The re-review was limited to the two original findings and the requested fixer paths: `tasks.md`; `bounded-loop-lifecycle.ts`, `facade-runtime.ts`, `projector.ts`, `record.ts`, `reducer.ts`; and the two focused test files. The pre-existing implementer-4 changes in `reconciler.ts`, `runtime-plan.ts`, pipeline-registry definition code, and their tests were not re-reviewed. No source, test, task, run-state, or commit was modified by this reviewer.

## Finding closure

### Round 0 Blocker 1: research exhausted-report completion guard - RESOLVED

**Original finding:** a research GoalLoop could make its report tail eligible through a non-success lifecycle `exit`, but the generic completed-Goal guard still rejected the final Record because the domain was not satisfied.

**Fix:** `src/core/change-run/internal/facade-runtime.ts:573-615` now derives the exception only from the frozen plan plus canonical Record. The satisfied guard is skipped only when all of these facts hold:

1. the bounded GoalLoop variant is `research`;
2. the shared reducer returns `completed` with disposition `exit` and a non-domain reason;
3. an authored atomic node directly downstream of that loop has a canonical succeeded Action.

Every ReviewCycle still runs its clean guard. Measure/evaluate GoalLoops, domain-success completions, and research Runs without the complete exception conjunction still run `assertGoalCycleMayShip`.

**Verification:**

- `test/core/change-run/goal-cycle-canonical.test.ts:1124` drives unsatisfied research judge -> `exit/max-rounds-exhausted` -> successful report tail -> completed Record, while preserving goal `exhausted` and lifecycle `iteration-limit/exit` projections.
- `test/core/change-run/goal-cycle-canonical.test.ts:1217` proves a non-research lifecycle exit with a succeeded downstream node cannot bypass the satisfied guard and cannot mutate the store head.
- Existing satisfied research/measure/evaluate completion cases in the same focused suite remained green.

**Status:** RESOLVED. The exception is narrow and does not weaken ordinary success-delivery guards.

### Round 0 Blocker 2: unsuccessful strategy Actions did not advance logical attempts - RESOLVED

**Original finding:** failed strategy Actions were not consumed and could be re-admitted under the same logical attempt; blocked strategy resume could remove the wait yet leave the lifecycle waiting without a WaitId.

**Fix:**

- `src/core/change-run/internal/bounded-loop-lifecycle.ts:499-565` introduces one shared `strategyAttemptAccounting` model keyed by the stable logical strategy node path. Successful and failed terminal results consume exactly one logical attempt; active, blocked, and retry-ready remain distinct states.
- `src/core/change-run/internal/bounded-loop-lifecycle.ts:844-908` advances a failed attempt, applies `strategyExhausted` at the exact bound, and re-admits a resumed blocked Action as a new occurrence of the same logical attempt with its recorded trigger.
- `src/core/change-run/internal/record.ts:229-253` and `src/core/change-run/internal/reducer.ts:817` derive canonical occurrence from Action admission chronology, so each repeated block creates a distinct deterministic WaitId.
- `src/core/change-run/internal/projector.ts:332` consumes the same accounting model as execution, keeping projected attempt/active state consistent with reconciliation.
- Existing success and recovery paths continue to use only a succeeded logical attempt to authorize one recovery; the full focused suite kept all material-change and unchanged-recovery cases green.

**Verification:**

- `test/core/change-run/bounded-loop-lifecycle.test.ts:489-594` proves failed attempt 1 -> attempt 2 -> exact single `strategyExhausted`, including serialized Record replay and reconciler equality.
- `test/core/change-run/bounded-loop-lifecycle.test.ts:596-723` proves first and second blocked/resume cycles preserve logical attempt 1 while producing occurrences 1 and 2, distinct occurrence-aware WaitIds, and replay-identical candidates.
- `test/core/change-run/goal-cycle-canonical.test.ts:871` verifies the failed-attempt sequence through the public facade across restart, including projector counters and exactly one terminal escalation.
- `test/core/change-run/goal-cycle-canonical.test.ts:948` verifies exact WaitId resume through the facade, a fresh Action identity on the same logical strategy node, and later advancement to attempt 2.

**Status:** RESOLVED. Execution, wait identity, restart replay, and projection share one logical-attempt model.

## Coverage map

```text
ROUND 1 FIX DELTA
=================
[covered] research + canonical non-domain completed/exit + succeeded authored tail
[covered] non-research exit cannot bypass satisfied guard
[covered] ordinary domain-success Goal completion remains guarded
[covered] failed strategy consumes once and advances to next logical attempt
[covered] final failed strategy selects strategyExhausted exactly once
[covered] blocked strategy exact-resume keeps logical attempt and increments occurrence
[covered] second block/resume derives a distinct WaitId and occurrence 2
[covered] restart replay returns identical reducer/reconciler/projector state
[covered] successful strategy still authorizes one recovery only
```

## Test and gate evidence

Required verification scope: the two changed lifecycle state machines and their facade-level integration. This scope directly exercises both original production failures, the negative guard case, restart replay, second blocked/resume identity, terminal idempotence, and projection parity.

Independent reviewer command:

```text
pnpm vitest run test/core/change-run/bounded-loop-lifecycle.test.ts test/core/change-run/goal-cycle-canonical.test.ts
PASS - 2 files, 63/63 tests
```

Fixer-reported supporting evidence supplied to this reviewer:

- adjacent Record/reducer/projector/domain guard group: PASS, 37/37;
- root TypeScript no-emit check: PASS;
- root build: PASS;
- targeted ESLint: PASS;
- scoped diff check: PASS.

Reviewer also ran `git diff --check` over the eight scoped files: PASS (line-ending conversion notices only, no whitespace error).

State identity for the independent 63/63 run:

- `git rev-parse HEAD^{tree}`: `58489c46633a209d2c1761c2a4b684ad8b95cb48`
- full tracked working-tree diff hash (`git diff --binary | git hash-object --stdin`): `69862cb1ea0c3b2712a192ad07e16fb1dd6be11e`
- scoped fixer diff hash: `58dabc86d6c0ae921dd455e7613601154ac4bd64`

The additional diff hashes are recorded because the verified fixer delta is intentionally uncommitted and therefore is not represented by the HEAD tree alone.

Task 7.3 remains open for the parent PR's remote Windows/Linux/macOS CI lanes. That external delivery gate is not a remaining Round 1 code-review finding.

## Durable findings

1. Strategy retry identity must continue to derive occurrence from canonical admission chronology; fixed occurrence zero is unsafe after the first resume.
2. The research-tail exception must remain the conjunction of research variant, canonical non-domain `completed/exit`, and a succeeded authored downstream tail; variant alone is not a safe bypass.

## Final status

`REVIEW VERDICT: CLEAN - Blocker:0 Major:0 Minor:0 Trivial:0`

Pre-Landing Review: No issues found in the Round 1 fixer delta. The review cycle may terminate cleanly.
