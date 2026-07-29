## 1. Domain reducer (goal-cycle.ts)

- [x] 1.1 Define typed result contracts: `GoalWorkResult`, `ResearchWorkResult`, `MeasureJudgeResult`, `EvaluateJudgeResult`, `ResearchJudgeResult` with `contract` discriminator strings
- [x] 1.2 Write Zod schemas for all five result types with strict-object validation, SAFE_ID regex for ids, DIGEST regex for tree hashes, and bounded string fields
- [x] 1.3 Implement `decodeGoalCycleResult(phase, variant, value)` — switch on phase (work|judge) + variant (measure|evaluate|research) to parse and validate the correct contract
- [x] 1.4 Implement `GoalCycleState` interface (round, phase, outcome, variant, lastScore, lastSatisfied, lastGaps, stallStreak, eventCount, lastActor, judgeActor, workerActor)
- [x] 1.5 Implement `applyGoalCycleEvent(state, event, maxIterations)` — pure transition function: work→judge advance, judge→satisfied or judge→next-round-work, stall streak increment, round cap to exhausted
- [x] 1.6 Implement `initialGoalCycleState(variant)`, `reduceGoalCycleEvents(events, maxIterations, variant)`, `GoalCycleDomainError` class
- [x] 1.7 Write failure-first unit tests: malformed work result rejected, malformed judge result per variant rejected, wrong-variant result rejected, zero-delta work increments stall, same-actor work+judge rejected by reducer
- [x] 1.8 Write happy-path unit tests: measure satisfied (score ≥ threshold), evaluate satisfied (gaps empty), research satisfied, exhausted at maxIterations, multi-round progression with score tracking

## 2. Runtime plan types (runtime-plan.ts)

- [x] 2.1 Add `RuntimePlanGoalCyclePhase` interface (phase: 'work'|'judge', profilePath, admissionKind, workspace)
- [x] 2.2 Add `RuntimePlanGoalCycleBody` interface (kind: 'goal-cycle', variant, phases)
- [x] 2.3 Extend `RuntimePlanBoundedLoopNode.body` union to include `RuntimePlanGoalCycleBody`
- [x] 2.4 Add `RuntimePlanGoalCyclePhaseInput` and `RuntimePlanGoalCycleBodyInput` for the plan builder
- [x] 2.5 Extend `validateBoundedLoop` to validate goal-cycle body: exactly 2 phases (work, judge), variant in measure|evaluate|research, each phase has valid admissionKind and profilePath
- [x] 2.6 Extend `createRuntimePlan` body-building switch to construct goal-cycle body nodes from input

## 3. Runtime adapter (goal-cycle-runtime.ts)

- [x] 3.1 Implement `goalCycleInvocationPath(loopPath, round, phase)` and `goalCycleInvocation(plan, loop, round, phase)` — hierarchical path derivation, parallel to review-cycle
- [x] 3.2 Implement `eventsFromRecord(plan, loop, record)` — iterate rounds×phases, find committed actions, extract events
- [x] 3.3 Implement `projectGoalCycleProgress(plan, loop, record)` — returns `GoalCycleProgress` (ready|waiting|failed|satisfied|exhausted)
- [x] 3.4 Implement `locateGoalCycleInvocation(plan, nodeId)` — find descriptor for a given nodeId
- [x] 3.5 Implement `validateGoalCycleCompletion(plan, record, request)` — pre-commit validation: correct phase, valid result, same-actor rejection
- [x] 3.6 Write unit tests for projectGoalCycleProgress: empty record → ready round 1 work, after work commit → ready judge, after judge not-satisfied → ready next round work, after judge satisfied → satisfied, at cap → exhausted

## 4. Reconciler integration

- [x] 4.1 Add `goal-cycle` case in the reconciler's bounded-loop `body.kind` switch (alongside review-cycle and composite): call `projectGoalCycleProgress`, map satisfied→succeeded, exhausted→escalate, ready→admit candidate
- [x] 4.2 Extend `BoundedLoopAdmitCandidate.bodyKind` to include `'goal-cycle'`
- [x] 4.3 Extend the admit payload builder for goal-cycle candidates: carry `{ loopPath, round, phase, variant }` in the input
- [x] 4.4 Verify finishCandidate already handles goal-cycle (satisfied contributes to succeeded set; remaining work blocks finish)
- [x] 4.5 Write reconciler integration tests: goal-cycle plan + empty record → work admit; after work+judge commit satisfied → finish eligible; after exhausted → escalate

## 5. Lowerer and definition normalization

- [x] 5.1 Add `isGoalCycleShaped(definition, loop)` — detect BoundedLoop whose declaration body has 2 AtomicStages tagged with `goalCyclePhase` ('work', 'judge')
- [x] 5.2 Extend `lowerV2ReviewCyclePlanInput` (or extract a shared lowerer body) to lower goal-cycle BoundedLoops: produce `body: { kind: 'goal-cycle', variant, phases }` from the declaration
- [x] 5.3 Extend the definition normalizer to detect v1 `loop: { kind: goal }` stages and produce a BoundedLoop + CompositeDeclaration with 2 AtomicStages (work tagged `goalCyclePhase: 'work'`, judge tagged `goalCyclePhase: 'judge'`)
- [x] 5.4 Set the variant from `loop.gate.kind` (measure→measure, evaluate→evaluate); detect research variant from pipeline name or `workProduct: prose` declaration
- [x] 5.5 Extend `analyzeReconcilerSupport` to include goal-cycle body stages in expected capability bindings (parallel to review-cycle phases and composite stages)
- [x] 5.6 Write lowerer tests: v1 goal-loop-measure YAML → v2 plan with goal-cycle body; v1 goal-loop-research → research variant + report-only tail

## 6. Projection (goal/1 section)

- [x] 6.1 Implement `buildGoalSection(loop, progress, record)` — emit `{ kind: 'goal', version: 1, loopPath, variant, round, phase, outcome, lastScore?, lastGaps, stallStreak, budget, waitReason }`
- [x] 6.2 Wire `buildSections` in `projector.ts` to detect goal-cycle bounded-loops and emit the goal section alongside root-dag
- [x] 6.3 Write projection tests: goal section shape for in-progress Run (round 2, judge phase, lastScore), terminal satisfied Run, terminal exhausted Run

## 7. Facade pre-commit validation

- [x] 7.1 Wire `validateGoalCycleCompletion` into `facade-runtime.ts` `complete()` method, called after `verifyCompletion` but before the commit stimulus — parallel to `validateReviewCycleCompletion`
- [x] 7.2 Add defense-in-depth completion guard for goal-cycle bounded-loops: when a goal-cycle Run reaches a completed terminal, assert the goal-cycle outcome is `satisfied` (parallel to `assertReviewCycleMayShip`)
- [x] 7.3 Write facade tests: malformed goal result rejected before commit, same-actor work+judge rejected, valid progression commits and advances to next phase

## 8. Built-in pipeline migration

- [x] 8.1 Verify all three goal-loop v1 YAMLs normalize to v2 BoundedLoop + goal-cycle body (test via the normalizer)
- [x] 8.2 Verify goal-loop-measure produces: define-goal → goal-loop(measure) → ship → retain → archive
- [x] 8.3 Verify goal-loop-research produces: define-goal → goal-loop(research) → report (no ship/archive)
- [x] 8.4 Verify legacy engine path is unaffected: v1 YAML stages are still read correctly for non-reconciler Runs

## 9. Thin launchers

- [x] 9.1 Rewrite `goal-command.ts` (`rasen-goal`): keep variant classification + goal-plan.md reading + `rasen pipeline start`/`resume`/`status` as primary interface; remove round counter, phase sequencing, maxRounds enforcement, stall tracking, goal-run.json writing, author≠verifier checking, strategy ladder
- [x] 9.2 Update `_orchestration.ts`: remove Step L goal-loop mechanical state (round counting, gate dispatch, goal-run.json append, stall/blocked tracking); the playbook no longer owns goal-loop mechanics
- [x] 9.3 Update `auto.ts` (`rasen-auto`): remove goal-loop mechanical references; auto thins to selection/launch only
  - **Discharged by `ecp-product-closure` (ECP-5), tasks 3.1-3.6.** `auto.ts` gained the engine-resolution step (0.7) and an engine-aware Resume; `_orchestration.ts` Step E split into E.1 (canonical Run) / E.2 (legacy path). Evidence: `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/product-closure/result.md` (Section 3), guarded by `test/core/templates/orchestration-bundles.test.ts` and `test/commands/auto.test.ts`.
- [x] 9.4 Update `goal-iterate.ts` and `goal-report.ts` skills to read from `ChangeRunView` goal section instead of `goal-run.json`
  - **Verified substantively true by `ecp-product-closure` (ECP-5), task 3.9** - not re-implemented. Both templates read `sections[].kind === 'goal'`, and every `goal-run.json` reference in `src/core/templates/workflows/*.ts` is projection language or a bare artifact name. Grep evidence: `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/product-closure/result.md` ("ECP-3 task 9.4").

## 10. goal-run.json demotion

- [x] 10.1 Write a projection function `projectGoalRunJson(record, plan)` that derives the legacy per-round record array from committed goal-cycle events
- [x] 10.2 Rewire `readGoalRunDetailed()` in management API to project from the Record for reconciler-engine Runs (fallback to file read for legacy Runs)
- [x] 10.3 Verify new Runs do not read `goal-run.json` on resume (assert in tests)

## 11. Recovery fault-injection tests

- [x] 11.1 Crash-before-commit: work-phase completion never committed → action stays active → resume re-admits nothing, same action is still active
- [x] 11.2 Crash-after-commit: work-phase completion committed but settle didn't run → resume calls reconcile() which sees committed result and admits judge
- [x] 11.3 Crash-after-judge-commit: judge committed (not satisfied) but next-round work not admitted → resume admits next-round work
- [x] 11.4 Ack loss: judge action granted but agent never started → action stays active → resume surfaces the wait

## 12. Real CLI Run evidence (ECP-3 exit evidence)

- [x] 12.1 Build dist before CLI tests (the recurring lesson — stale dist runs old JS)
- [x] 12.2 Run a real CLI `goal-loop-measure` Run through multiple rounds → satisfied termination; capture RunId, ActionId, actor, evidence
- [x] 12.3 Run a real CLI `goal-loop-research` Run through multiple rounds → report tail; capture RunId
- [x] 12.4 Run a real CLI goal-loop Run to exhaustion (maxRounds) → escalated terminal; verify goal-run.json projection
- [x] 12.5 Verify all cross-layer gates: `analyzeReconcilerSupport` includes goal body stages, `preflightPreparedDefinitionExecution` passes, `resolveRuntime`/v2-cast works, `resolveRuntimeExecutionProfile` succeeds, `lowerRuntimePlan` produces goal-cycle body, `buildAction` constructs the correct action
- [x] 12.6 Verify CLI `pipeline status` projects the goal/1 section with variant, round, score, budget

## 13. Full suite and type safety

- [x] 13.1 Run full test suite (6181+ tests) — zero regressions
  - **Discharged by `ecp-product-closure` (ECP-5), task 9.1, on the integrated HEAD `3b33d5be`.** Root: 393 files / **6364 passed** / **1 failed** / 33 skipped; `packages/ui`: 56 files / **604 passed** / 0 failed. The single failure is `token-audit/zed`, pre-existing and unrelated, verified by reproducing it against the `2fcd5438` version of that test. An earlier run at a prior revision showed 6 failures: 4 were the known Windows CLI-spawn flake (each re-run in isolation and passing, and none recurred once the machine was uncontended) and 1 was a REAL regression found and fixed here (`command-registry.test.ts` — `--engine` shipped without its completion-registry entry). Evidence: `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/product-closure/result.md` (Section 9). ECP-3 could not have run this more meaningfully than the final slice can — only the integrated HEAD carries all seven slices.
- [x] 13.2 Run root tsc + UI tsc — zero type errors
  - **Discharged by `ecp-product-closure` (ECP-5), task 9.2, on the integrated HEAD `3b33d5be`.** Root `npx tsc --noEmit`: 0 errors. `packages/ui` `npx tsc --noEmit`: 0 errors. Evidence: `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/product-closure/result.md` (Section 9). ECP-3 could not have run this more meaningfully than the final slice can — only the integrated HEAD carries all seven slices.
- [x] 13.3 Run ESLint — zero lint errors on changed files
  - **Discharged by `ecp-product-closure` (ECP-5), task 9.3, on the integrated HEAD `3b33d5be`.** `pnpm lint` over `src/ test/ vitest.config.ts vitest.setup.ts`: **0 errors**, 1 warning (`facade-settle-completeness.test.ts:139`, an unused eslint-disable introduced by `27faedd3` in `ecp-settle-completeness`) — reported, not opportunistically fixed, because it is another change's line. Evidence: `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/product-closure/result.md` (Section 9). ECP-3 could not have run this more meaningfully than the final slice can — only the integrated HEAD carries all seven slices.
- [x] 13.4 Cross-platform verification: run goal-cycle tests on Windows (path separators, Node.js path module usage)
  - **Discharged by `ecp-product-closure` (ECP-5), task 9.4, on the integrated HEAD `3b33d5be`.** Everything above ran natively on Windows 11 (`win32`, Node 24.14.0) — including the whole `test/core/change-run/` suite and four real fresh-process CLI dogfood scripts, one of which is `test/dogfood-goal-cycle.mjs` driving all three goal pipelines to real terminals (`run:81b0934e…` satisfied, `run:163d87c6…` exhausted, `run:1b8e7a48…` evaluate, `run:c3583225…` research). ECP-5 task 6.5 additionally swept the whole slice diff for hardcoded separators and found none. Evidence: `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/product-closure/result.md` (Section 9). ECP-3 could not have run this more meaningfully than the final slice can — only the integrated HEAD carries all seven slices.
