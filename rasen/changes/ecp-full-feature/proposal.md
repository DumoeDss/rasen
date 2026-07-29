## Why

ECP-1/2/3 shipped the BoundedLoop kernel via ReviewCycle, Custom Composite, and GoalLoop — three real consumers that proved deterministic admit/round/cap/recovery/terminal mechanics on the same reconciler. The remaining gap is parallelism: `full-feature` declares conditional parallel expert reviews (`parallelGroup` + `condition`), but the runtime treats them as independent atomic stages with no structured dispatch, concurrency limit, budget enforcement, or barrier semantics. Choice, FanOut, and Join exist as static Definition v2 node kinds but have no runtime execution path — the lowerer skips them, the reconciler never interprets them, and the projector cannot describe a parallel frontier.

This slice closes the gap: the reconciler executes Choice (condition → select one branch), FanOut (concurrent members under concurrency cap + budget), and Join (barrier with required/optional/fail-closed semantics). It migrates `full-feature` to a real reconciler Run and proves recovery (ready-set deterministic, Join idempotent).

## What Changes

- The runtime plan types gain three new node kinds alongside `atomic`, `bounded-loop`, and `finish`: `choice` (condition evaluation + persisted branch selection), `fan-out` (structural dispatch with concurrency cap + budget), and `join` (barrier with required/optional/fail-closed semantics).
- The lowerer extends to lower Definition v2 `Choice`, `FanOut`, and `Join` root nodes to the corresponding runtime plan nodes. FanOut members are lowered as atomic nodes tagged with their parent FanOut and `required` flag.
- The reconciler gains three new passes: a Choice pass (read committed selection, add only the selected branch to the succeeded set), a FanOut pass (resolve condition evaluation, collect member candidates with concurrency cap + budget enforcement), and a Join pass (check required/optional member outcomes, proceed/suppress/fail-closed). FanOut member candidates merge with atomic and bounded-loop candidates through the SAME `selectCompatibleAdmissions` — preserving the single-writer-per-workspace lock invariant.
- The normalizer maps v1 `parallelGroup` + `condition` to v2 `FanOut` + `Join`. `condition: always` becomes a required member; conditional stages become optional members.
- The projector emits `parallel/1` and `choice/1` view sections alongside `root-dag/1`, `review-cycle/1`, `goal/1`, and `composite/1` — all from the one `ChangeRunView`.
- Canvas shows FanOut member list, concurrency cap, budget, required/optional flags, and Join barrier state. Over-budget or illegal shapes are never marked runnable.
- `full-feature` migrates to the reconciler: a real Run flows office-hours → propose → apply → FanOut(expert reviews) → Join → review-loop → ship → retain → archive.
- Fault-injection tests cover: crash before/after FanOut condition commit, crash mid-member-execution, required member failure → Join fail-closed, optional member failure → Join suppress, restart → ready-set deterministic, Join idempotent (consumed member result not re-evaluated).

## Capabilities

### New Capabilities

- `executable-parallel-pipelines`: The canonical Choice/FanOut/Join execution vertical — reconciler choice/fan-out/join admission, concurrency cap + budget enforcement, condition evaluation persisted in the Record, barrier semantics (required/optional/fail-closed), idempotent recovery, cross-plane projection parity, and Canvas parallel authoring with legality feedback.

### New Capabilities

- `full-feature-workflow`: The `full-feature` built-in pipeline migrated to the reconciler — a real Run through Choice (if applicable) → FanOut (parallel expert reviews) → Join → ReviewCycle → ship → retain → archive, with parallel frontier visible from CLI, Management API, and Operations.

## Impact

- **Core runtime** (`src/core/change-run/internal/`): `runtime-plan.ts` (new node kinds + validators), `lowerer.ts` (Choice/FanOut/Join lowering), `reconciler.ts` (three new passes), `projector.ts` (parallel/1 + choice/1 sections), `facade-runtime.ts` (pre-commit validation for choice/fan-out results), `reducer.ts` (no change — stimuli are generic).
- **Pipeline registry** (`src/core/pipeline-registry/`): `definition.ts` (normalizer for parallelGroup → FanOut/Join), `execution-plan-internal.ts` (capability bindings for FanOut condition evaluator + members).
- **CLI** (`src/core/change-run/`): `pipeline status` renders parallel/choice sections from `ChangeRunView`.
- **Canvas** (`packages/ui/src/canvas/`): FanOut/Join/Choice node panels, concurrency/budget config, legality feedback.
- **Tests**: failure-first (required-failure → fail-closed, over-budget → reject), fault-injection recovery matrix, parity tests, real CLI dogfood.
