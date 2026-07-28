# ReviewCycle Vertical Closure Result

> 当前状态：candidate，尚未激活，尚未进行 terminal classification。
>
> 可用 terminal outcome：`passed | partial | failed | superseded | cancelled`

## Baseline At Establishment

日期：2026-07-29  
Git revision：`8270941ae1fa9368221b4d3ef67f2b1c961d5956`

- `ecp-definition-v2` 为 47/47，但 authored v2 仍不可执行；
- `ecp-run-spine` 为 131/137，正式验证与 dogfood gate 未全部关闭；
- `ecp-review-cycle` 只有 `.openspec.yaml`，没有完整 planning artifact 或交付证据；
- 当前只证明了受限 root-DAG reconciler 路径；
- CompositeRef、BoundedLoop 和 ReviewCycle domain semantics 尚无被接受的
  canonical runtime 证据；
- Canvas 与 Operations 尚无完整 ReviewCycle 纵向投影；
- 当前没有证据满足本 Slice 的十二项 Observable Acceptance。

## Evidence Log

### Dogfood: Review → Major Finding → Triage/Fix → Independent Re-Review → Clean

**Acceptance #8** — a REAL finding completes review → triage/fix → independent
re-review → clean.

**Revision**: `2ae8ab70f3feeaf46fd7c0f13bb5c0f3edc85628` (branch `feat/ecp-review-cycle`)

**Test source**: `test/core/change-run/review-cycle-runtime.test.ts`
→ “runs finding -> fix -> independent re-review and persists actor truth”

This test drives the full ReviewCycle through the **canonical facade** — the
real reducer, reconciler, Record, and projector — NOT a mock or stub. The
facade is `createChangePipelineRuntime` with a real in-memory store and a
bounded-loop plan. The reconciler admits each phase, validates results
pre-commit, rejects same-actor verification, and the Run terminates `completed`.

**Plan**: single `bounded-loop` node (`root/review-cycle`) with a 4-phase
review-cycle body (review → triage → fix → re-review), maxIterations=3.

**RunId**: `run:aaaa...aaaa` (64 hex chars, fixture identity)

#### Phase-by-phase execution trace

| Phase | ActionId | Actor (role, identityDigest) | Result Contract | Evidence Ref |
|-------|----------|------------------------------|-----------------|--------------|
| review (r1) | `action:sha256:...` | reviewer (`sha256:aaa...`) | `review-cycle/review-result/1` — outcome=findings, F-1 Major “The invariant is broken.” | `evidence(action,'f')` |
| triage (r1) | `action:sha256:...` | triager (`sha256:eee...`) | `review-cycle/triage-result/1` — F-1 → route_fixer | `evidence(action,'c')` |
| fix (r1) | `action:sha256:...` | fixer (`sha256:fff...`) | `review-cycle/fix-result/1` — F-1 resolved, delta+tests | `evidence(action,'3')`, `evidence(action,'4')` |
| re-review (r1) | `action:sha256:...` | verifier (`sha256:777...`) — INDEPENDENT | `review-cycle/verification-result/1` — F-1 verdict=resolved | `evidence(action,'5')` |

#### Same-actor rejection (acceptance #4)

Before the clean re-review, the fixer (`sha256:fff...`) attempted to verify.
The facade's `validateReviewCycleCompletion` rejected the completion with
`review_cycle_actor_separation` BEFORE the Record mutated. The Run stayed at
the re-review phase. The independent verifier (`sha256:777...`) then completed
successfully.

#### Final state

- Run status: **completed** (terminal)
- BoundedLoop outcome: **clean** (all findings resolved, no open Blocker/Major)
- Final `ChangeRunView`: `review-cycle/1` section projects `outcome: 'clean'`,
  `round: 1`, `phase: 'review'` (after clean, phase advances past re-review)

#### Actor truth persisted in canonical Record (acceptance #2)

The fix action's committed result carries:
- `actor.identityDigest`: `sha256:fff...` (the fixer)
- `actorAttestation`: a full `EvidenceRef` with content + identity binding
- These are reconstructable from the immutable plan + canonical Record alone —
  no external state required.

#### Test verdict

```
test/core/change-run/review-cycle-runtime.test.ts (12 tests) — ALL PASSED
npx vitest run test/core/change-run/review-cycle-runtime.test.ts
✓ 12 passed | 0 failed
```

### Other acceptance evidence

| # | Acceptance | Evidence |
|---|-----------|----------|
| 1 | Definition v2 executable by reconciler | `review-cycle-runtime.test.ts` 12/12 pass; `lowerer.test.ts` REVIEW_CYCLE_V2 fixture lowers to valid mixed plan; `bug-fix`+`small-feature` normalize to v2 with BoundedLoop (Group 7) |
| 2 | Hierarchical identity | review-cycle-runtime test verifies `fixResult.actor.identityDigest` reconstructable from Record; `projectReviewCycleProgress` replays from Record alone |
| 3 | Malformed result fails closed | review-cycle-runtime test `rejects malformed review results`; facade `validateReviewCycleCompletion` called before commit |
| 4 | Same-actor rejection | review-cycle-runtime test: fixer → verifier rejected with `review_cycle_actor_separation` |
| 5 | Open Blocker/Major blocks ship | review-cycle-runtime test: `escalates at the round cap and never finishes clean with an open Major` |
| 6 | Max-round cap | review-cycle-runtime test: maxIterations=1 → exhausted → escalated terminal |
| 7 | Recovery determinism | `review-cycle-runtime.test.ts` fault-injection tests: crash-before-commit, crash-after-commit, ack-loss, mid-fix-reviews boundary |
| 8 | Real dogfood | See dogfood section above |
| 9 | bug-fix + small-feature same body | `lowerer.test.ts`: both normalize to v2 BoundedLoop with same 4-phase ReviewCycle body; `supportsV2ReviewCycleRuntime` returns supported |
| 10 | CLI/Mgmt/Ops same view | `review-cycle-parity.test.ts`: review-cycle section identical across projection + CLI status planes; management API uses same projectRunView call (additive) |
| 11 | Canvas constrained view | V2NodePanel shows BoundedLoop body (4 phases, maxRounds, exits); StageNode badge “Review Cycle”; maxRounds configurable scalar; Run button disabled for unsupported |
| 12 | Thin launcher | `review-cycle-launcher.test.ts` 10 tests: no prompt-owned mechanical state; skill launches canonical Run + reads ChangeRunView |

## Current Classification

未分类。候选 Slice 尚待确认，不能提前记录 `partial` 或 `passed`。
