# Handoff: ecp-v2-default-authoring-and-builtins — reviewer #1

## Original intent

Perform a report-only `rasen-review` of Child 2, `ecp-v2-default-authoring-and-builtins`, against the explicit base `origin/dev/0.2.0`. The branch also contains independently reviewed Child 1 work, so inspect the cumulative integration surface but classify Child 2 contract, integration, scope, and test gaps only. Do not edit product or tests. When complete, write only the canonical `evidence/review-report.md` and return exact severity counts plus a verdict.

The product-level intent is to finish ECP 0.2.0 before Issue 0.3.0, with this slice making v2 the default authored/built-in pipeline form while preserving behavior and execution/read-plane parity.

## Position

Pipeline: direction-selected ECP 0.2.0 slices. Completed stages: Child 1 implementation/review and Child 2 implementation. Current stage: Child 2 review (Standards + Spec Review substantially complete; focused code/test verification remains).

## Done / Remaining

Done:

- Read the entire `.codex/skills/rasen-review/SKILL.md`, `checklist.md`, `greptile-triage.md`, and `design-checklist.md`.
- Read the complete Child 2 proposal, design, tasks, all seven delta specs, and `handoff/implementer-3.md`.
- Read repository-level `README.md` and `test/AGENTS.md`; no root design-system or TODO authority file was present.
- Established the explicit review base and branch: `origin/dev/0.2.0@a1306828`; working branch `wip/ecp-shared-bounded-loop-lifecycle-resume@050fc843` plus uncommitted Child 2 changes.
- Reviewed the main Child 2 definition/serializer/registry/lowering/profile projection/management API/new-change/UI changes and existing implementation evidence.
- Closed the interrupted `full-feature` capability check: `qa-report-only` deliberately uses unified `rasen-qa` with an explicit report-only/non-UI dispatch instruction. The templates and tests document this migration, so it is not a finding.
- Made no product, test, branch, stash, run-state, or worktree changes.

Remaining:

- Confirm and severity-grade the authored `Gate` semantic mismatch described below with a focused test or source trace.
- Confirm whether the Management API's hard-coded unknown host can actually diverge from CLI/launch projections under Codex and Claude hosts; add a small read-only reproduction if practical.
- Decide whether native-v2 selection's bypass of `validatePipelineForExecution` is an intentional kernel boundary or a real fail-closed regression; trace the final dispatch boundary and tests.
- Inspect remaining built-in manifests/oracle assertions and strategy workflow prompt changes for Child 2-specific behavior regressions.
- Check the exported default `validateDecomposeChildPipelines` behavior for malformed v2 children and decide whether it is public-contract relevant.
- Run only bounded, focused tests needed to substantiate findings; the implementer already reports the broad suites green.
- Write `rasen/changes/ecp-v2-default-authoring-and-builtins/evidence/review-report.md`, verify it exists, and return exact Blocker/Major/Minor/Trivial counts and verdict.

## Key decisions (and why)

- Treat this as a cumulative integration review but do not re-report Child 1 findings unless Child 2 creates a new cross-slice regression; this is the dispatch contract.
- Use `origin/dev/0.2.0` as the review base even though the branch contains Child 1, and attribute findings to Child 2 semantics rather than raw diff ownership.
- Do not flag `qa-report-only -> rasen-qa`: `src/core/templates/workflows/auto.ts`, `_orchestration.ts`, and `test/core/templates/qa-unified.test.ts` explicitly establish the unified skill plus report-only dispatch mode.
- Provisional high-confidence candidate: authored `Gate` nodes appear decorative rather than authoritative. `GateNode` has outcomes but no typed target, parser validation ignores manifest `target`, root lowering skips `Gate`, and runtime gates instead come from `AtomicStage.execution.gate` with a synthesized `${stageId}-gate` id. This conflicts with the change's claims of explicit native-v2 Gate lowering and a closed typed language. Likely Major unless a later execution path proves the authored Gate is authoritative.
- Provisional candidate: `src/core/management-api/pipelines.ts` projects native-v2 execution with `MANAGEMENT_HOST = { runtime: 'unknown', source: 'unknown' }`, whereas CLI show/launch use `detectHostRuntime()`. On Codex this may display Claude/legacy-default facts while launch freezes Codex/host facts, contrary to the inspection/launch parity contract. Likely Major if reproduced.
- Provisional candidate: `freezeProductionPreparedPipelineRegistry.selectForExecution` skips `validatePipelineForExecution` for authored v2. That validation contains unsupported-route and bridge-binary preflight checks used by v1. Determine whether the LEAD dispatch boundary performs an equivalent preflight before classifying.
- Provisional lower-priority candidate: default `validateDecomposeChildPipelines` returns success for any top-level `version: 2` child without authoritative preparation; the product path injects `loadPrepared`, so impact may be limited to the exported helper contract.

## Dead ends & gotchas

- The cumulative base diff is very large because it includes migration and Child 1; raw file count is not a useful Child 2 scope signal. Review the uncommitted Child 2 delta and its stated contracts, then trace integration into Child 1.
- `git show HEAD:pipelines/full-feature/pipeline.yaml` shows the pre-Child-2 authored v1 source, while the working-tree file is the new v2 source. Use `Get-Content`/`git diff` for Child 2 working-tree behavior and `git show origin/dev/0.2.0:<path>` only for baseline comparisons.
- `qa-report-only` is a stage identity/mode, not a separate installed `rasen-qa-only` capability anymore. Searching only by stage name misleadingly suggests a wrong skill mapping.
- The reported broad test evidence is in `handoff/implementer-3.md`; do not rerun the entire 6,822-test suite unless a focused failure calls that evidence into question.

## Eliminated hypotheses

- Hypothesis: the full-feature migration accidentally maps `qa-report-only` to the mutating UI QA skill. Ruled out by `test/core/templates/qa-unified.test.ts:48-54`, `src/core/templates/workflows/auto.ts:148`, and `src/core/templates/workflows/_orchestration.ts:61`, which require unified `rasen-qa` with explicit report-only/non-UI dispatch. Current best hypothesis: there is no capability-mapping defect here.
- Hypothesis: `preflightPreparedDefinitionExecution`'s v2 `pipeline: null as unknown as PipelineYaml` was introduced by Child 2. Ruled out by history/diff inspection; it predates this slice and new callers branch on source kind. Do not report it as Child 2.

## Working set

Primary change artifacts:

- `rasen/changes/ecp-v2-default-authoring-and-builtins/{proposal.md,design.md,tasks.md}`
- `rasen/changes/ecp-v2-default-authoring-and-builtins/specs/*/spec.md`
- `rasen/changes/ecp-v2-default-authoring-and-builtins/handoff/implementer-3.md`

Primary implementation/test surfaces already inspected:

- `src/core/pipeline-registry/definition.ts`
- `src/core/pipeline-registry/prepared-execution-view.ts`
- `src/core/pipeline-registry/profile-resolver.ts`
- `src/core/pipeline-registry/production.ts`
- `src/core/change-run/lowerer.ts`
- `src/core/management-api/pipelines.ts`
- `src/commands/pipeline.ts`
- `src/core/new-change.ts`
- `pipelines/*/pipeline.yaml`
- `test/core/change-run/lowerer-native-v2.test.ts`
- `test/core/pipeline-registry/builtins.test.ts`
- `test/core/pipeline-registry/builtin-migration-oracle.test.ts`
- `test/fixtures/builtin-pipeline-migration-oracle.ts`

Useful focused searches:

- `rg -n "kind === 'Gate'|case 'Gate'|gateInput|execution\.gate" src test`
- `rg -n "MANAGEMENT_HOST|detectHostRuntime|projectPreparedPipelineExecutionView" src test`
- `rg -n "validatePipelineForExecution|selectForExecution|dispatchMode.*unsupported|probe.*bridge" src test`
- `rg -n "validateDecomposeChildPipelines|loadDecomposeChildCompatibilitySource|loadPrepared" src test`

## Next action

Trace one authored v2 built-in containing both a `Gate` node and an `AtomicStage.execution.gate` through `readPipelineDefinitionV2` and `lowerV2ReviewCyclePlanInput`; then write a focused read-only test/reproduction showing whether removing or corrupting the authored Gate leaves the lowered gate unchanged. Use that evidence to lock the first finding's severity before moving to the Management API host-parity check.
