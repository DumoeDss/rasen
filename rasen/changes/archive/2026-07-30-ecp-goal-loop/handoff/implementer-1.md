# Handoff: ecp-goal-loop implementer-1

## Reason
Context approaching limits during full test suite wait. Implementation is substantially complete with real CLI evidence.

## Commits (9 on feat/ecp-review-cycle)
1. `3f7f068d` — goal-cycle runtime layers (domain reducer, plan types, reconciler, lowerer, projector, facade)
2. `c98ef751` — variant detection fix (reads gate kind from BoundedLoop legacy)
3. `d063968c` — domain reducer tests (22 tests)
4. `8911d520` — goal-run.json projection + lowerer tests (3 tests)
5. `e42edbe9` — goal-cycle-runtime progress tests (5 tests)
6. `0e500bfc` — thin launchers (goal-command + Step L)
7. `4fbcc79a` — task tracking update
8. `b660b043` — renderGoalLoop graceful skip + golden hash update
9. `c66de186` — Step L dispatch-mode text + final hash update

## Completed tasks (40/62)
- Groups 1-7: runtime layers fully implemented and tested
- Group 8 (8.1-8.4): built-in migration proven via real CLI Run
- Group 9 (9.1, 9.2): thin launchers committed; 9.3 auto.ts no change needed; 9.4 pending
- Group 10 (10.1, 10.3): projection function exists; 10.2 management API rewiring pending
- Group 12 (12.1, 12.5, 12.6): build, cross-layer gates, CLI status projection verified

## Remaining tasks (22/62)
- 4.5: reconciler integration unit tests (proven via CLI but not unit-tested)
- 6.3: projection unit tests (proven via CLI but not unit-tested)
- 7.3: facade unit tests
- 9.4: update goal-iterate.ts and goal-report.ts skills to read ChangeRunView
- 10.2: rewire management API readGoalRunDetailed for reconciler Runs
- 11.1-11.4: recovery fault-injection tests
- 12.2-12.4: full CLI Run through multiple rounds (measure/research/exhaustion)
- 13.1-13.4: full suite verification

## Real CLI evidence
- RunId: `run:f04fc9bb5a24b029ff121e882e5e0dac08822b0c4e8e625a68ee2e01092e94b4`
- Pipeline: `goal-loop-measure`, engine: `reconciler`, status: `running`
- Goal section: `{ variant: "measure", round: 1, phase: "work", budget: { used: 0, max: 10 } }`
- All cross-layer gates pass (analyzeReconcilerSupport, preflight, resolveRuntime, lowerRuntimePlan, buildAction)

## Type safety
- Root tsc: clean
- UI tsc: clean
- UI build: OK

## Test results (partial)
- goal-cycle.test.ts: 22/22 pass
- goal-cycle-runtime.test.ts: 5/5 pass
- goal-cycle-lowerer.test.ts: 3/3 pass
- ECP-1/ECP-2 (review-cycle, lowerer, reconciler): 52/52 pass
- Template tests: 54/54 pass
- Full suite: running (second run with all fixes, output at bvb47osd9.output)

## Key files
- NEW: `src/core/change-run/internal/goal-cycle.ts`
- NEW: `src/core/change-run/internal/goal-cycle-runtime.ts`
- MODIFIED: `src/core/change-run/internal/runtime-plan.ts`
- MODIFIED: `src/core/change-run/internal/reconciler.ts`
- MODIFIED: `src/core/change-run/internal/lowerer.ts`
- MODIFIED: `src/core/change-run/internal/facade-runtime.ts`
- MODIFIED: `src/core/change-run/internal/projector.ts`
- MODIFIED: `src/core/pipeline-registry/definition.ts`
- MODIFIED: `src/core/pipeline-registry/execution-plan-internal.ts`
- MODIFIED: `src/core/pipeline-registry/profile-resolver.ts`
- MODIFIED: `src/core/templates/workflows/goal-command.ts`
- MODIFIED: `src/core/templates/workflows/_orchestration.ts`
