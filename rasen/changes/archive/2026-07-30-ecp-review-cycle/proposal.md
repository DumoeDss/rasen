## Why

The Change-level Pipeline spine has a deterministic root-DAG reconciler, but authored v2 Composite and BoundedLoop definitions cannot enter the Runtime — the reconciler only admits atomic nodes. ReviewCycle is the first real Composite: it needs hierarchical identity, a bounded loop, structured domain results, independent actor separation, safe caps, and recovery. Closing this vertical proves the Composite kernel is real, not a prompt-owned loop, and unblocks every later ECP slice.

## What Changes

- The deterministic reconciler executes `bounded-loop` plan nodes: it calls `projectReviewCycleProgress`, emits the correct `admit` for the next review/triage/fix/re-review phase, maps `clean` to completed and `exhausted` to escalated, and guards `finishCandidate` so a loop with remaining work never premature-finishes.
- `CommittedDomainResult` gains committed `actor` and `actorAttestation` fields, binding every domain result to the actor that produced it (fixes 3 existing TS errors in `review-cycle-runtime.ts` and satisfies the actor-separation invariant).
- The reducer and facade route ReviewCycle phase completions through `validateReviewCycleCompletion` before commit, so malformed results, same-actor fixer+verifier, and open-Blocker/Major findings fail closed.
- An authored v2 ReviewCycle pipeline definition (CompositeRef/BoundedLoop, 4 phases) is added as the canonical body the built-ins normalize to; `bug-fix` complex and `small-feature` route through the same ReviewCycle body.
- The projector emits a `review-cycle` view section alongside the existing `root-dag` section, so CLI, Management API, and Operations consume one `ChangeRunView` for composite path, round, phase, findings, actor, evidence, wait reason, and terminal.
- Canvas views the constrained ReviewCycle/BoundedLoop (rounds, phases, exits) and never marks an unexecutable shape as runnable.
- The `rasen-review-cycle` skill is thinned to a launcher: it selects, starts, and projects the canonical Run — it owns no second mechanical state machine.
- Fault-injection tests cover crash-before-commit, crash-after-commit, ack loss, and resume at review/fix/re-review quiescent boundaries.
- A real dogfood completes one finding through review → triage/fix → independent re-review → clean, recorded with revision, RunId, ActionId, actor, and evidence refs.

## Capabilities

### New Capabilities

- `executable-review-cycle`: The canonical ReviewCycle execution vertical — reconciler bounded-loop admission, committed actor truth, pre-commit validation (malformed/same-actor/open-Major fail closed), cap-to-exhausted mapping, hierarchical identity reconstruction, recovery at quiescent boundaries, built-in migration routing, cross-plane projection parity, and constrained Canvas view/config.

### Modified Capabilities

- `review-cycle-workflow`: The skill becomes a thin launcher/compatibility projection of the canonical Run. It selects, starts, and projects the canonical Change Run instead of owning the mechanical review/triage/fix/re-review loop state. Mechanical progression (round advancement, phase sequencing, cap enforcement, ship guard) moves to the reconciler.

## Impact

- **Core runtime** (`src/core/change-run/internal/`): reconciler, record, reducer, facade-runtime, projector — all enriched to execute and project bounded-loop ReviewCycles.
- **Pipeline registry** (`src/core/pipeline-registry/`): authored v2 ReviewCycle definition, built-in migration routing for `bug-fix` complex and `small-feature`.
- **CLI** (`src/core/change-run/`): start/status/resume/complete/control surface composite path, round, phase, findings from one view.
- **Management API** (`src/core/management-api/`): runs endpoint projects the same `ChangeRunView` section.
- **Canvas** (`packages/ui/src/canvas/`): constrained view and safe configuration of BoundedLoop.
- **Skill** (`src/core/templates/workflows/review-cycle.ts`): thinned to launcher.
- **Tests**: fault-injection recovery matrix, failure-first guard tests, cross-plane parity tests, real dogfood evidence.
