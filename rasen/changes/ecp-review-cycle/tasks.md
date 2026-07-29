## 1. Committed Domain Result Enrichment (Acceptance #2)

- [x] 1.1 Add optional `actor: ActorRef` and `actorAttestation: EvidenceRef` fields to `CommittedDomainResult` interface in `src/core/change-run/internal/record.ts`
- [x] 1.2 Extend the Zod `ResultSchema` in `record.ts` with optional `actor` and `actorAttestation` validation (use `ActorRefSchema` and `EvidenceRefSchema` from `contracts.ts`)
- [x] 1.3 Extend the `commit-action-result` stimulus in `src/core/change-run/internal/reducer.ts` with optional `actor` and `actorAttestation` fields; pass them through to the committed `CommittedDomainResult` in the `commit-action-result` case
- [x] 1.4 Verify the 3 TS errors in `review-cycle-runtime.ts` are resolved (`npx tsc --noEmit`)

## 2. Reconciler Bounded-Loop Execution (Acceptance #1, #6)

- [x] 2.1 Add a bounded-loop pass to `reconcile()` in `src/core/change-run/internal/reconciler.ts` between the atomic succeeded-set computation and the atomic classification pass: for each `bounded-loop` node whose `requires` are met, call `projectReviewCycleProgress(plan, loop, record)`, map `clean` to succeeded-set, `exhausted` to escalate candidate, `ready` to admit candidate with descriptor nodeId/admissionKind/access
- [x] 2.2 Guard `finishCandidate()` so a bounded-loop with remaining work (ready/waiting/failed) never allows premature finish — check ALL plan nodes (atomic + bounded-loop) are in the completed set
- [x] 2.3 Extend `ReconcilerNextAction.admit` to carry an optional `input.reviewCycle` payload (round, phase, openFindingIds) for the facade to pass to the agent action
- [x] 2.4 Extend `collectSettleStimuli` in `facade-runtime.ts` to pass the reviewCycle input payload through to `buildAction` when building the action for a bounded-loop admit candidate

## 3. Failure-First Guard Tests (Acceptance #3, #4, #5)

- [x] 3.1 Write a test that submits a malformed review result (wrong contract string, missing required fields) and asserts rejection with `malformed_review_cycle_result` before Record mutation
- [x] 3.2 Write a test that submits a same-actor fixer + verifier re-review and asserts rejection with `review_cycle_actor_separation` before Record mutation
- [x] 3.3 Write a test that submits a clean review result while an open Major finding exists and asserts the ReviewCycle does not reach `clean` (ship guard)
- [x] 3.4 Write a test that a malformed triage result (missing open finding disposition) is rejected before commit

## 4. Pre-Commit Validation Wiring (Acceptance #3, #4)

- [x] 4.1 In `facade-runtime.ts` `complete()` method, call `validateReviewCycleCompletion(deps.plan, record, request)` after `verifyCompletion` but BEFORE building the commit stimulus; surface the error without committing if validation throws
- [x] 4.2 Pass `request.actor` and `request.actorAttestation` through to the `commit-action-result` stimulus in `complete()`
- [x] 4.3 Verify the existing E2E test `runs finding -> fix -> independent re-review and persists actor truth` in `review-cycle-runtime.test.ts` now passes (reconciler admits bounded-loop phases)

## 5. Happy-Path and Cap Tests (Acceptance #1, #2, #6)

- [x] 5.1 Verify the existing E2E test `escalates at the round cap and never finishes clean with an open Major` in `review-cycle-runtime.test.ts` passes (maxIterations=1 → exhausted → escalated terminal)
- [x] 5.2 Write a test that a clean round-1 review (no findings) immediately reaches `clean`, the bounded-loop contributes to succeeded, and the Run finishes as completed
- [x] 5.3 Write a test that the lowerer test `REVIEW_CYCLE_V2` fixture in `lowerer.test.ts` now passes (v2 definition lowers to a valid runtime plan with bounded-loop)
- [x] 5.4 Write a test verifying hierarchical identity: round, phase, finding, actor, evidence are reconstructable from the immutable plan + canonical Record alone (decode the Record, replay events, assert state matches projection)

## 6. Recovery and Fault-Injection Tests (Acceptance #7)

- [x] 6.1 Write a crash-before-commit test: admit a review-phase action, do NOT complete it, simulate restart (create fresh facade with same store+plan), assert resume surfaces the active action as a wait (not re-admitted)
- [x] 6.2 Write a crash-after-commit test: complete a review-phase action, simulate restart BEFORE the settle runs, assert resume projects the correct next phase (triage) and admits it
- [x] 6.3 Write an ack-loss test: action is admitted and granted but agent never starts, simulate restart, assert the action stays active and the Run is `running` (waiting for completion)
- [x] 6.4 Write a mid-fix-reviews boundary test: complete review + triage + fix, restart, assert the re-review phase is admitted with the correct round/phase/actor context from the Record

## 7. Built-in Migration Routing (Acceptance #9)

- [x] 7.1 Extend `normalizeV1` in `src/core/pipeline-registry/definition.ts` to detect stages with `loop.kind === 'review-cycle'` and produce a `BoundedLoop` root node + `CompositeDeclaration` with 4 AtomicStage phases (review, triage, fix, re-review) instead of an AtomicStage
- [x] 7.2 Extend `normalizeV1` to detect stages with `verifyPolicy: 'adaptive'` and absorb the verify into a BoundedLoop ReviewCycle body (same 4-phase declaration, verify capability becomes review phase capability)
- [x] 7.3 Extend `lowerV2ReviewCyclePlanInput` in `src/core/change-run/internal/lowerer.ts` to handle `AtomicStage` root nodes alongside BoundedLoop and Finish (lower them with the same logic as the v1 path)
- [x] 7.4 Write a test that `bug-fix` pipeline YAML normalizes to a v2 definition with a BoundedLoop and lowers to a valid mixed plan (atomic propose/apply + bounded-loop + atomic ship/archive) — **fix(ecp-review-cycle): Major-1 `808fe02f`**
- [x] 7.5 Write a test that `small-feature` pipeline YAML normalizes to a v2 definition with the same BoundedLoop body shape and lowers correctly — **fix(ecp-review-cycle): Major-1 `808fe02f`**
- [x] 7.6 Verify `analyzeReconcilerSupport` returns `supported: true, reason: 'supported_v2_review_cycle'` for both migrated built-ins — **verified: `pipeline show bug-fix --json` reports `availableEngines: ['legacy','reconciler']`**

## 8. Projection Parity — Review-Cycle View Section (Acceptance #10)

- [x] 8.1 Add a `review-cycle/1` section type to the projector (`src/core/change-run/internal/projector.ts`): when the plan contains a bounded-loop, call `projectReviewCycleProgress` and emit the section with round, phase, outcome, findings, actors, waitReason, maxRounds
- [x] 8.2 Extend `ChangeRunViewSection` in `contracts.ts` to include the `review-cycle` section schema (additive — alongside the existing `root-dag` section)
- [x] 8.3 Update CLI `pipeline status` (`src/commands/pipeline.ts`) to render the review-cycle section data (round, phase, findings, actors) from the `ChangeRunView`
- [x] 8.4 Verify Management API `GET /api/v1/runs` and `GET /api/v1/runs/<changeId>/<runId>` return the review-cycle section from the same `projectRunView` call (no separate projection) — **fix(ecp-review-cycle): Major-2 `31f7f91e` persists plan to `plan.json`; management API loads it**
- [x] 8.5 Write a parity test that CLI, Management API, and Operations consume the same fixture's `ChangeRunView` and all see the same review-cycle section data — **fix(ecp-review-cycle): `31f7f91e` updated parity test to assert section IS present**

## 9. Canvas Constrained View and Safe Config (Acceptance #11)

- [x] 9.1 Update `packages/ui/src/canvas/V2NodePanel.tsx` to display BoundedLoop body details: 4 phases (review/triage/fix/re-review), max rounds, clean/exhausted exit outcomes
- [x] 9.2 Update `packages/ui/src/canvas/StageNode.tsx` BoundedLoop card badge to show "Review Cycle" instead of generic "Preserved"
- [x] 9.3 Expose maxRounds as a configurable scalar in the detail panel (saved to the pipeline YAML's `loop.maxRounds`); do NOT enable shape editing (no add/remove/reorder phases)
- [x] 9.4 Verify the Canvas reflects execution support status correctly: a definition with a BoundedLoop and complete capability bindings shows as reconciler-supported; a definition missing capability bindings shows as not supported and does NOT present a Run action

## 10. rasen-review-cycle Thin Launcher (Acceptance #12)

- [x] 10.1 Rewrite the skill instructions in `src/core/templates/workflows/review-cycle.ts`: remove prompt-owned round counter, phase sequencing, max-rounds enforcement, author!=verifier checking, and escalation ladder logic
- [x] 10.2 Add instructions for launching the canonical Run (`rasen pipeline start` / `rasen pipeline resume`), projecting progress from `ChangeRunView` review-cycle section, and composing per-phase agent briefs from canonical state
- [x] 10.3 Verify the skill still delegates each review pass to `rasen-review` and still composes the orchestration brief for role-isolated dispatch
- [x] 10.4 Write a test verifying the skill instructions do NOT contain prompt-owned mechanical state (round counter variable, phase transition logic, max-rounds checking code)

## 11. Real Dogfood (Acceptance #8)

- [x] 11.1 Run a real local Change through the ReviewCycle: start a Run, have the review phase produce a real Major finding, complete triage/fix with a different actor, complete re-review with an independent verifier, reach clean — **DONE: Full CLI-driven cycle. RunId `run:b23b2c...`, 6 ActionIds, finding F1 (major) resolved, outcome clean. Same-actor rejection confirmed. See result.md for evidence.**
- [x] 11.2 Record the dogfood evidence: revision (`9a262d84`), RunId, ActionId for each phase, actor identityDigests (reviewer/fixer/verifier all distinct), evidence refs, and the final ChangeRunView projection (round=1, phase=re-review, outcome=clean) — **DONE: all recorded in result.md**
- [x] 11.3 Write the dogfood result to the slice `result.md` at `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/review-cycle-vertical-closure/result.md`

## 12. Regression and Cross-Platform Verification

- [x] 12.1 Run `npx vitest run test/core/change-run/` — verify all 328 prior passing tests still pass plus the new tests (target: 0 regressions)
- [x] 12.2 Run `npx tsc --noEmit` — verify zero type errors (the 3 prior errors in `review-cycle-runtime.ts` are fixed)
- [x] 12.3 Run `npx vitest run` (full suite) — verify no regressions across the entire test suite
- [x] 12.4 Verify Windows CI path handling: all new code uses `path.join()` / `path.resolve()` for file paths, no hardcoded separators
- [x] 12.5 Run the UI build (`pnpm --filter @atelierai/rasen-ui build`) — verify Canvas changes compile without errors
