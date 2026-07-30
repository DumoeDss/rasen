## Why

The BoundedLoop kernel and deterministic reconciler have been proven by ReviewCycle (ECP-1) and Custom Composite (ECP-2), but the three goal-loop built-ins (`goal-loop-measure`, `goal-loop-evaluate`, `goal-loop-research`) still run entirely under prompt-owned mechanical state. A LEAD agent counts rounds, enforces caps, tracks stall/blocked streaks, appends to `goal-run.json`, and decides when to exit — all the invariants the reconciler was built to own. GoalLoop is the second real BoundedLoop consumer: it proves the loop lifecycle (admit/round/cap/stall/recovery/terminal) is genuinely generic, not ReviewCycle-specific, and it lets a user run a measure, evaluate, or research goal with a deterministic spine that can explain baseline, current result, threshold, remaining budget, and why it continues, completes, stalls, or exhausts.

## What Changes

- Three domain reducers (Measure, Evaluate, Research) are added as a new `goal-cycle` body kind, mirroring the ReviewCycle domain-reducer + adapter pattern: typed result contracts, Zod validation, fail-closed transitions, and a pure event reducer that shares identity/limits/recovery/terminal mechanics with ReviewCycle without merging domain schemas.
- The reconciler gains a `goal-cycle` branch in its bounded-loop pass (alongside `review-cycle` and `composite`): it projects goal progress, emits the correct admit for the next work or judge phase, maps `satisfied` to the succeeded set and `exhausted` to escalate, and guards finish so a goal loop with remaining work never premature-finishes.
- The runtime plan type (`runtime-plan.ts`) and lowerer accept a `goal-cycle` body kind with a 2-phase body (work → judge) parameterized by variant (`measure` | `evaluate` | `research`).
- The three goal built-in pipelines migrate from prompt-owned `loop: { kind: goal }` to reconciler-owned BoundedLoop + `goal-cycle` body — real Runs, not prompt simulations.
- A `goal/1` projector section emits score/evaluation/gaps/stall/blocked/round/budget/termination + report tail from the one `ChangeRunView`.
- Pre-commit validation in the facade rejects malformed goal results, wrong-phase completions, and measure results that cannot be parsed, so the Record never mutates on invalid input.
- The legacy `goal-run.json` becomes a compatibility projection derived from the canonical Record — it cannot back-drive a new Run.
- `rasen-goal` thins to a completion preset/launcher: it selects the variant, reads `goal-plan.md` for gate configuration, starts the canonical Run, and projects progress. It owns no round/phase/budget state.
- `rasen-auto` thins to selection/launch strategy only: it does not own goal-loop mechanics.
- Fault-injection tests cover crash-before-commit, crash-after-commit, and ack loss at work/judge quiescent boundaries.

## Capabilities

### New Capabilities

- `executable-goal-loop`: The canonical GoalLoop execution vertical — three domain reducers (Measure/Evaluate/Research), reconciler goal-cycle body admission, goal-cycle runtime adapter, pre-commit validation (malformed/wrong-phase fail closed), cap-to-exhausted mapping, hierarchical identity reconstruction, recovery at quiescent boundaries, built-in migration, goal projection, and constrained Canvas view.

### Modified Capabilities

- `goal-loop-workflow`: The `rasen-goal` skill becomes a thin launcher/compatibility projection of the canonical Run. It selects the variant, reads `goal-plan.md`, starts the canonical Change Run, and projects the `goal/1` section. Mechanical progression (round advancement, work→judge sequencing, cap enforcement, stall detection, exit policy) moves to the reconciler. The `rasen-auto` skill similarly thins to selection/launch only for goal-loop pipelines.

## Impact

- **Core runtime** (`src/core/change-run/internal/`): new `goal-cycle.ts` (domain reducer), new `goal-cycle-runtime.ts` (runtime adapter), reconciler gains `goal-cycle` branch, `runtime-plan.ts` gains goal-cycle body type, lowerer gains goal-cycle lowering path, facade-runtime gains goal-cycle pre-commit validation, projector gains `goal/1` section.
- **Pipeline registry** (`src/core/pipeline-registry/`): definition normalization routes goal-loop v1 `loop.kind: goal` to v2 BoundedLoop + goal-cycle body; `analyzeReconcilerSupport` admits goal-cycle body stages; resolver prepares capability bindings for goal work/judge phases.
- **Built-in pipelines** (`pipelines/goal-loop-{measure,evaluate,research}/pipeline.yaml`): v1 YAML unchanged, but normalizer produces v2 BoundedLoop + goal-cycle body for reconciler-engine Runs.
- **CLI** (`src/commands/pipeline.ts`): start/status/resume/complete projects goal path, round, phase, score, budget from one view.
- **Management API** (`src/core/management-api/`): runs endpoint projects the same `ChangeRunView` goal section; `goal-run.json` read path becomes compatibility projection.
- **Canvas** (`packages/ui/src/canvas/`): constrained view of goal-cycle BoundedLoop (variant, phases, maxRounds, gate type).
- **Skills** (`src/core/templates/workflows/`): `goal-command.ts` thinned to launcher; `_orchestration.ts` goal-loop Step L mechanical state removed; `auto.ts` goal-loop references removed.
- **Tests**: domain-reducer transition tests (failure-first), fault-injection recovery matrix, cross-plane parity tests, real CLI Run evidence.
