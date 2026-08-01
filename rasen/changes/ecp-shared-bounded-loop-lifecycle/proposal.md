## Why

Rasen can execute ReviewCycle and GoalLoop through the deterministic reconciler, but their public `BoundedLoop` contract still stops at round/action/budget limits and `clean|satisfied` versus `exhausted`. Progress identity, stall, repeated blockers, strategy exhaustion, human guidance, and the reason a loop stopped remain incomplete or domain-specific, so a Run can be mechanically real while users and agents still cannot predict or explain its full lifecycle.

## What Changes

- Add one closed, programmatically validated bounded-loop lifecycle contract covering iteration/action/budget admission, stable progress and blocker fingerprints, stall and same-blocker streaks, strategy attempts, human-required suspension, cancellation/recovery, and typed outcomes.
- **BREAKING:** Authored Definition v2 `BoundedLoop` nodes must carry that complete lifecycle policy; legacy v1 inputs remain compatible because normalization materializes the policy explicitly before validation and lowering.
- Seal the lifecycle policy into the immutable runtime plan and derive its state only from the canonical Record; Markdown reports, `goal-run.json`, CLI output, API responses, and Operations remain projections rather than competing state.
- Introduce a shared lifecycle reducer/projector used by ReviewCycle and GoalLoop while keeping review findings/triage/fix/re-review and goal work/measure/evaluate/research in separate domain reducers.
- Make stalled, blocked, strategy-exhausted, human-required, failed, cancelled, and limit-exhausted paths fail closed and observable, with deterministic resume at every committed boundary and no hidden LEAD-owned counters.
- Expose the same lifecycle policy, counters, fingerprints, wait, strategy, and typed outcome through pipeline inspection and `ChangeRunView`, consumed consistently by CLI, Management API, and Operations.
- Add failure-first and recovery tests for both domain consumers, including blocked retry of the same phase, changed versus unchanged progress, independent counters, strategy budget exhaustion, human guidance, cancel, and fresh-process replay.

## Capabilities

### New Capabilities

- `ecp-bounded-loop-lifecycle`: The shared authored, compiled, executed, recovered, and projected lifecycle contract for Change-level bounded loops.

### Modified Capabilities

- `ecp-definition-preparation`: `BoundedLoop` definitions gain a complete lifecycle policy and fail closed on missing, malformed, impossible, or incomplete lifecycle limits and exit mappings.
- `executable-review-cycle`: ReviewCycle contributes review-specific progress and blocker facts to the shared lifecycle and consumes its typed decisions without merging its domain reducer into GoalLoop.
- `executable-goal-loop`: GoalLoop contributes variant-specific score/gap progress and blocker facts to the same lifecycle and uses explicit stall, strategy, human, and terminal decisions instead of local hidden mechanics.
- `opsx-pipeline-registry`: Pipeline validation and inspection expose the sealed lifecycle policy and typed outcomes used for execution.
- `pipelines-ui`: Operations renders the server-projected bounded-loop lifecycle beside domain-specific review or goal detail; Canvas authoring remains outside this Change.

## Impact

- **Definition and compilation:** `src/core/pipeline-registry/definition.ts`, execution-profile binding, lowerer, runtime-plan codecs, plan digest fixtures, and v1 compatibility normalization.
- **Canonical execution:** `src/core/change-run/internal/` lifecycle/reconciler/record/wait/facade/projector code plus the existing ReviewCycle and GoalLoop adapters and reducers.
- **Public observation:** pipeline CLI JSON/text, Management API `ChangeRunView`, shared UI wire types, and Operations presentation.
- **Tests:** Definition/lowering validation, reducer and reconciler matrices, fault/recovery and projection parity, CLI/API contracts, and focused Operations UI coverage.
- **Excluded:** Canvas authoring parity, v2 default/built-in source migration, Session executor and worker lifecycle, Issue/Dispatch/portfolio semantics, and 0.2.0 release audit.
