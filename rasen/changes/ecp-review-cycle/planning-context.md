# Planning Context — ecp-review-cycle (ECP-1 ReviewCycle Vertical Closure)

> LEAD-authored seed. The planner reads this FIRST, then researches only the
> integration seams it does not already cover. Append durable new findings.

## 1. User intent (verbatim)

> auto-decompose 全权由你推进完成 …/executable-composite-pipelines 任务，新建
> worktree，在 dev/0.1.6 上新建开发分支进行开发。直到任务完成。

Branch: `feat/ecp-review-cycle` (off `dev/0.1.6` @ `8270941a`). Worktree:
`OpenSpec-code-ecp-review-cycle`. Pipeline: `auto-decompose` (Tier A, claude-native,
gate policy `off (global)` — autonomous).

## 2. Scope decision (LEAD, from the Direction's own authority)

The `executable-composite-pipelines` Direction is a multi-slice program. Its README +
roadmap lock **NOW = ECP-1 ReviewCycle Vertical Closure** (the candidate first slice).
ECP-2 (Custom Composite), ECP-3 (GoalLoop), ECP-4 (FanOut/Join/full-feature),
ECP-5 (Product Closure) are explicitly **LATER / NOT NOW** and are out of scope for
this change. The full Direction is multi-version work; this change delivers ECP-1 only.

**Decompose: SKIPPED.** The slice's own `plan.md` states "本 Slice 不拆分并行代码
工作" — ReviewCycle closure is one coherent vertical across Definition / Lowerer /
Reconciler / Record / Reducer / Facade / Projection / Canvas / migration / launcher /
recovery / dogfood, all sharing one contract. It is NOT multiple independent
deliverables. Run as a single change.

## 3. Exit criteria — the 12 Observable Acceptance items

Authoritative source: `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/review-cycle-vertical-closure/spec.md`.
A finding / file / unit test alone never proves an item. Each needs real runtime +
projection + (where stated) dogfood evidence. The 12:

1. Definition v2 `CompositeRef` + `BoundedLoop` prepare/lower/executable by the
   canonical reconciler — no more `ecp_v2_runtime_unavailable`.
2. ReviewCycle uses hierarchical stable identity; round/phase/finding/actor/evidence/
   exit reconstructable from immutable plan + canonical Record.
3. malformed review/triage/fix/re-review result fails closed BEFORE commit.
4. same-actor fixer + verifier rejected.
5. open Blocker/Major present ⇒ no normal path makes ship ready.
6. max-round / stall / strategy cap ⇒ explicit exhausted/escalated, no infinite loop.
7. restart at review / fix / re-review boundaries: completed Actions not re-admitted;
   open findings + next ready action deterministic.
8. a REAL finding completes review → triage/fix → independent re-review → clean.
9. `bug-fix` complex AND `small-feature` run through the SAME ReviewCycle body.
10. CLI / Management / Operations project composite path, round, phase, findings,
    actor, evidence, wait, terminal from the SAME `ChangeRunView`.
11. Canvas can view + safely configure the constrained ReviewCycle/BoundedLoop; does
    not mark an unexecutable shape as runnable.
12. `rasen-review-cycle` is only a launcher / compatibility projection — it owns NO
    second mechanical state.

## 4. Current code state (LEAD-verified, 2026-07-29)

A prior session wrote a strong **front half + domain model** but the **execution back
half is entirely absent**. Baseline commit on this branch: `f78565fb`.

### DONE and correct (do not redo — build on it)

- **Domain reducer** `src/core/change-run/internal/review-cycle.ts` (~600 LoC):
  Zod-validated review/triage/fix/re-review result contracts; pure event state machine
  `applyReviewCycleEvent`; actor separation by `identityDigest`; ship guard
  `assertReviewCycleMayShip`; round-cap → `exhausted`; `clean` requires no open
  Blocker/Major. **6 domain tests pass.** Production quality.
- **Runtime adapter** `src/core/change-run/internal/review-cycle-runtime.ts` (~249 LoC):
  deterministic hierarchical node ids (`reviewCycleInvocationPath` /
  `deriveNodeId`); event reconstruction from committed record (`eventsFromRecord`);
  progress projection `projectReviewCycleProgress` (ready/waiting/failed/clean/exhausted);
  pre-commit validation `validateReviewCycleCompletion`. **Orphaned + 3 TS errors** —
  see MISSING #2. Logic is correct; it just is not wired and does not compile yet.
- **Definition prepare** `src/core/pipeline-registry/definition.ts`:
  `supportsV2ReviewCycleRuntime()` + `prepare()` sets `executionMode: 'reconciler'`
  for matching v2 ReviewCycle definitions (no more `ecp_v2_runtime_unavailable`).
- **Support analysis** `src/core/pipeline-registry/execution-plan-internal.ts`:
  `analyzeReconcilerSupport()` returns `supported: true, reason: 'supported_v2_review_cycle'`.
- **Lowerer** `src/core/change-run/internal/lowerer.ts`: `lowerV2ReviewCyclePlanInput()`
  lowers authored v2 BoundedLoop → `RuntimePlanNodeInput { kind: 'bounded-loop' }`;
  validates the 4-phase shape, edges, exits. v1 path untouched behind version check.
- **Runtime plan** `src/core/change-run/internal/runtime-plan.ts`:
  `RuntimePlanBoundedLoopNode`, `RuntimePlanReviewCycleBody`, `validateBoundedLoop()`
  (maxIterations 1-100, exact phase order, unique profilePaths, clean/exhausted).
- Type widenings: `resolver.ts`, `management-api/wire-types.ts` add `'reconciler'`.
- UI cosmetic: `packages/ui/src/api/types.ts`, `EngineSupportPanel.tsx` add labels.
- Test fixture: `test/core/change-run/lowerer.test.ts` adds `REVIEW_CYCLE_V2` v2
  fixture + a lowering test (currently fails — needs back half).

### MISSING — the back half (this change's implementation work)

1. **Reconciler bounded-loop execution (THE critical seam).**
   `src/core/change-run/internal/reconciler.ts` `reconcile()` currently filters for
   `atomic` nodes only (≈ line 118-120) and its `finishCandidate()` (≈ 528-532)
   immediately finishes when the atomic array is empty. It must: recognize
   `bounded-loop` nodes; call `projectReviewCycleProgress(plan, loop, record)`; on
   `ready` emit an `admit` action with the correct nodeId / profilePath /
   `input.reviewCycle` payload; on `clean` advance toward completion; on `exhausted`
   map to a terminal escalated/terminal state. Guard `finishCandidate()` so a
   bounded-loop with remaining work never premature-finishes.
2. **`CommittedDomainResult` enrichment.** `src/core/change-run/internal/record.ts`
   `CommittedDomainResult` has only `status/receiptDigest/result/evidence`. Add
   `actor` + `actorAttestation` (committed actor truth). This fixes the 3 TS errors
   in `review-cycle-runtime.ts` and is required for acceptance #2/#4.
3. **Reducer / facade wiring.** The reducer must call
   `validateReviewCycleCompletion(plan, record, request)` before committing a
   `domain-action-result` for a ReviewCycle phase (acceptance #3). The facade-runtime
   must route ReviewCycle phase completions through the project/validate cycle and
   surface ReviewCycle progress/wait/terminal.
4. **Terminal-state mapping.** Reconciler maps ReviewCycle `clean` → completed,
   `exhausted` → escalated/terminal, bound to actor + workspace revision + evidence.
5. **Authored v2 ReviewCycle pipeline definition.** No v2 YAML exists in `pipelines/`.
   Add the canonical v2 ReviewCycle definition (CompositeRef/BoundedLoop) used by the
   built-ins. (Acceptance #1, #9.)
6. **Built-in migration routing.** Route `bug-fix` complex branch AND `small-feature`
   through the same ReviewCycle body (acceptance #9). v1 built-ins normalize to the
   v2 ReviewCycle definition.
7. **CLI / Management / Operations projection.** Surface composite path, round,
   phase, findings, actor, evidence, wait reason, terminal from the ONE
   `ChangeRunView` (acceptance #10). record.ts / projector / CLI / management runs
   API / Operations view all consume it.
8. **Canvas constrained view/config.** View + safely configure the ReviewCycle
   BoundedLoop (rounds, phases, exits); never mark an unexecutable shape runnable
   (acceptance #11).
9. **`rasen-review-cycle` thin launcher.** Strip the prompt-owned mechanical state
   machine from the skill; it must only select/launch/project the canonical Run
   (acceptance #12).
10. **Restart / fault-injection tests** at the review / fix / re-review quiescent
    boundaries (acceptance #7): crash-before-commit, crash-after-commit, ack loss,
    resume — completed Actions not re-admitted, open findings + next ready action
    deterministic.
11. **Real dogfood** (acceptance #8): one real finding through
    review → triage/fix → independent re-review → clean, recorded with revision /
    RunId / ActionId / actor / evidence refs / final projection. Write it back to the
    slice `result.md`.

### Test baseline (verified)

`npx vitest run test/core/change-run/review-cycle*.test.ts test/core/change-run/lowerer.test.ts`
→ **9 passed, 3 failed**. The 3 failures are the unwritten back half (reconciler
emits zero actions for bounded-loop; 2 runtime E2E tests + 1 lowering test). Full
`test/core/change-run/` = **328 passed / 3 failed — NO regressions.** `tsc --noEmit`
has the 3 expected errors in `review-cycle-runtime.ts` (MISSING #2).

## 5. Locked decisions (from target-state.md — do not violate)

1. Mechanical progression is owned by the Reconciler. Prompt/Agent judges or produces;
   it owns NO hidden loop/retry/round/barrier/finish.
2. One Run = one truth: the canonical Run Record is the only mutable run fact.
3. Plan is frozen: Run uses immutable plan/profile/capability snapshot.
4. Top-level DAG + constrained Composite only; reject general cycles / recursion /
   nested loops.
5. Built-in and Custom are isomorphic: no hidden privileged runtime.
6. Domain reducers are separate from the generic loop lifecycle (ReviewCycle finding
   lifecycle ≠ goal lifecycle) but share identity/limits/recovery/terminal mechanics.
7. Every capability is proven vertically (Definition + Canvas + Runtime + Operations +
   real E2E).
8. Compat input is not a permanent dual track.

**Spine discipline:** if a root-DAG seam defect blocks ReviewCycle, fix it IN the
canonical seam — never create a temporary sibling runtime.

## 6. Authority pointers (read these)

- Slice spec (12 acceptance items):
  `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/review-cycle-vertical-closure/spec.md`
- Slice plan (delivery sequence, evidence to return):
  `…/slices/review-cycle-vertical-closure/plan.md`
- Target state (locked decisions, success evidence):
  `…/executable-composite-pipelines/target-state.md`
- Roadmap (ECP-1..5 order, evidence-adjusts-route rules):
  `…/executable-composite-pipelines/roadmap.md`
- Research (domain model, deterministic reconciler, migration):
  `…/executable-composite-pipelines/deterministic-pipeline-kernel-research.md`
- Completion audit (baseline facts, findings):
  `docs/audits/0.1.6-executable-composite-pipelines-completion-review-2026-07-29.md`
- Architecture (current root-DAG slice):
  `docs/architecture/executable-composite-pipelines.md`

## 7. Delivery

Local delivery (commit on `feat/ecp-review-cycle`). Baseline `f78565fb` already holds
the imported front half; the ship commit(s) capture the back half, so the review/verify
diff is cleanly the new integration work.
