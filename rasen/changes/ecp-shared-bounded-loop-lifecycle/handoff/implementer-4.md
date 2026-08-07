# Implementer handoff: shared bounded-loop lifecycle (implementer 4)

## Why this handoff exists

The child-local implementation and validation work is complete, but task 7.3 also asks for Windows and Linux/macOS CI-lane results. The active Slice plan gives child Changes local delivery only and creates one PR after all four serial children finish, so those remote results cannot exist truthfully at this stage. I stopped with 47/48 tasks evidenced and left only that parent-portfolio delivery check open.

## Workflow and isolation

- Worked only in `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle`.
- Branch remained `wip/ecp-shared-bounded-loop-lifecycle-resume` at/after migration commit `050fc84332b26a75a07f441efd6b235842f89e1e`.
- Read and followed `rasen-apply-change`, all Change context files, implementer 1/2/3 handoffs, and the active Direction Slice spec/plan/result.
- Did not commit, ship, archive, or mutate Rasen run-state.
- Preserved the three migrated untracked directories: `test-engine-product-surface-tmp/`, `test-pipeline-e2e-complex-tmp/`, and `test-validate-enriched-tmp/`.

## Completed implementation audit and correction

The migrated implementation already contained the complete shared lifecycle kernel, domain adapters, strategy/recovery paths, human-required wait/control path, projection, CLI/API/UI surfaces, and matrix tests described by implementer 3. I inspected the committed code rather than trusting the handoff and found one remaining semantic contradiction:

- Authored v2 validation and runtime-plan decoding both rejected a loop whose `budget` was below `maxActions`.
- That made the independently declared `budgetLimit` unreachable under the specified unit-cost accounting, contradicting the Change design and the explicit budget-before-action scenario.

This pass therefore:

- removed only the loop-local `budget >= maxActions` constraint in `src/core/pipeline-registry/definition.ts` and `src/core/change-run/internal/runtime-plan.ts`;
- retained the pre-existing Record-global limit constraint unchanged;
- added Definition coverage proving a smaller loop budget is accepted and sealed;
- added runtime-plan coverage proving the independent budget survives decoding;
- added direct fail-closed coverage for a live policy-free bounded-loop plan (`unsupported_runtime_plan`);
- updated the stale reconciler pass comment so it describes the shared closed lifecycle decision union rather than hard-coded clean/exhausted behavior;
- marked 47 tasks complete and recorded exact verification evidence in `tasks.md`.

## Validation evidence

- Final `pnpm run build`: passed.
- Final focused Definition/runtime-plan/lowerer/lifecycle run: 5 files, 165/165 passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm --dir packages/ui run typecheck`: passed.
- `pnpm run lint`: exit 0; one pre-existing warning in untouched `test/core/change-run/facade-settle-completeness.test.ts` for an unused eslint-disable directive.
- Full applicable ChangeRun directory (excluding the owner of a preserved migrated temp directory): 64 files, 568/568 passed.
- Full pipeline-registry plus relevant Management API run/control files: 20 files, 619/619 passed.
- Full `test/commands/pipeline.test.ts`: 101/101 passed, including both new lifecycle CLI cases.
- Full UI suite: 57 files, 609/609 passed. Existing jsdom navigation/scroll warnings were non-failing.
- Earlier focused cross-plane/core run: 22 files, 490/490 passed.
- `node bin/rasen.js validate ecp-shared-bounded-loop-lifecycle --strict`: valid.
- `git diff --check`: passed (only the repository's LF-to-CRLF checkout warnings were printed).
- Rasen apply progress: 47/48.

The first monolithic repository-wide command exceeded the tool's 10-minute limit without a failure summary. It left no orphan process after cleanup. The affected suites were then split by subsystem and every applicable returned shard above passed. The three fixed-directory owner tests were intentionally not rerun because the parent task required their migrated outputs to remain preserved.

## Remaining work

1. Task 7.3 remote portion only: after the parent portfolio opens its single PR, confirm the Windows CI lane and normal Linux/macOS lanes are green. Local Windows path-sensitive CLI/API tests passed.
2. The LEAD owns the next workflow decision, run-state update, review stage, commit, and delivery.

No implementation defect or child-local test failure remains known.
