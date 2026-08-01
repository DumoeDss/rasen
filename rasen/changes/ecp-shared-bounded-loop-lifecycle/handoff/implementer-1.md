# Implementer handoff: shared bounded-loop lifecycle

## Why this handoff exists

The implementer context compacted while the first runtime integration step was in progress. Per the parent task's hard handoff rule, I stopped before starting projection, UI, or test work, completed the atomic reducer integration far enough to restore a green production build, and recorded the remaining work here.

## Verification at handoff

- `pnpm run build` passes (2026-08-01, about 19 seconds).
- No focused or full tests have been run yet.
- `tasks.md` remains intentionally unchecked (status was 0/48 before implementation).
- No commit, archive, run-state mutation, or shipping action was performed.

## Implemented so far

### Definition, validation, lowering, and capability resolution

- `src/core/pipeline-registry/definition.ts`
  - Added the authored v2 bounded-loop lifecycle contract, typed exits, strategy policy, and diagnostics.
  - Added structural/semantic/capability checks for loop limits, thresholds, strategy configuration, lifecycle exits, and strategy capability bindings.
  - Added lifecycle outcomes to output-contract/path resolution.
  - v1 compatibility normalization now materializes bounded `maxActions`, `budget`, thresholds, and explicit exit dispositions without changing authored v1 source or inventing a strategy capability.
- `src/core/change-run/internal/runtime-plan.ts`
  - Runtime bounded loops now carry `limits`, `lifecycle`, and optional `strategyProfilePath`; decoding fails closed when required lifecycle data is absent or invalid.
- `src/core/change-run/internal/lowerer.ts`
  - All bounded-loop lowering paths preserve limits/lifecycle and derive the strategy profile path.
- `src/core/pipeline-registry/profile-resolver.ts`
  - Authored v2 strategy capability bindings/policy stages are resolved at `root:<loop>/strategy`.
- `src/core/pipeline-registry/execution-plan-internal.ts`
  - Expected support-node IDs include authored v2 strategy bindings.

### Shared lifecycle kernel and domain adapters

- Added `src/core/change-run/internal/bounded-loop-lifecycle.ts` with:
  - closed lifecycle decision/snapshot types;
  - strict decoders for `bounded-loop/blocked/1` and `bounded-loop/strategy-result/1`;
  - deterministic latest-attempt selection (`attemptOrdinal`, then `ActionId`);
  - program-derived progress/blocker fingerprints and reconstructed streaks;
  - deterministic strategy action identity;
  - a first shared pure reducer for ready/wait/completion/limits/stall/blocker/strategy/exit decisions.
- `review-cycle-runtime.ts`, `goal-cycle-runtime.ts`, and `composite-runtime.ts`
  - Latest-action reads use the shared selector.
  - Added domain snapshot adapters whose material progress excludes prose/actor/evidence noise.
  - Runtime max-iteration reads now use `loop.limits.maxIterations`.
- `projector.ts` and `runtime-context.ts` were minimally updated for the new runtime-plan limits shape only; lifecycle projection is not implemented.

### Reconciler, durable wait, and canonical record seam

- `src/core/change-run/internal/reconciler.ts`
  - The bounded-loop pass now calls the shared reducer and maps closed decisions to admit/strategy/human/escalate/fail/cancel/wait behavior.
  - Strategy admission metadata and domain snapshot/candidate helpers were added.
  - The old domain-owned bounded-loop dispatch remains inside a temporary block comment immediately after the new reducer call; remove it once parity work is complete.
- `src/core/change-run/contracts.ts` and `internal/waits.ts`
  - Added the durable `human-required` wait contract with exact action/loop/blocker/evidence context and `retry`/`escalate` controls.
- `src/core/change-run/internal/record.ts`
  - Added canonical `HumanDecisionCommitted` transitions.
- `src/core/change-run/internal/reducer.ts`
  - Added and decoded `await-human-required`, `decide-human`, and `fail` stimuli.
  - Human wait admission replaces the corresponding domain-blocked wait.
  - Retry records evidence-bound durable intent and removes the wait; escalation records the decision and terminal transition atomically.

## Critical remaining integration work

1. Wire `facade-runtime.ts`:
   - Map reconciler `await-human-required` and `fail` outputs to reducer stimuli.
   - Translate public controls explicitly instead of casting `ChangeRunControlRequest` to `RunStimulus`.
   - Route a decision addressed to a human-required wait to `decide-human`, preserving optional evidence; keep gate decisions separate.
2. Make human retry consumable by the shared lifecycle reducer:
   - Find the latest `HumanDecisionCommitted` for the blocked action.
   - A post-result `retry` must permit exactly a fresh deterministic domain attempt instead of immediately recreating the human wait from the still-latest blocked result.
   - An escalation is already terminalized by the canonical reducer.
3. Complete strategy recovery semantics:
   - Current successful strategy results can lead to another strategy attempt instead of one recovered domain iteration plus material-progress comparison.
   - Enforce strategy attempt cap and material progress before returning to normal loop flow.
4. Add the `bounded-loop-lifecycle/1` projection and emit one section per loop.
   - Include state, used/max counters, progress/blocker fingerprints and streaks, strategy state, exact wait identity, and typed terminal outcome.
   - Update CLI status/show/validate surfaces, management API contract fixtures, Operations UI types/rendering/i18n.
5. Decide and test `budget` accounting explicitly.
   - The definition currently rejects `budget < maxActions`, and runtime cost is one per action, so `maxActions` ordinarily fires before budget. This follows the design's "budget must admit maxActions" invariant but leaves budget operationally redundant until non-unit cost exists. Preserve this fact in tests or adjust the design/implementation deliberately; do not silently change it.
6. Remove duplicated domain lifecycle ownership after parity:
   - Goal still maintains stall/cap compatibility state.
   - Old reconciler domain dispatch is commented, not deleted.
7. Update existing v2 fixtures:
   - Authored BoundedLoop fixtures now need complete `limits` and `lifecycle` fields.
   - Runtime-plan fixtures using direct `maxIterations` need the new `limits`/`lifecycle` shape.
8. Add focused tests for all 48 task requirements, run impacted suites, then run the full suite and check tasks only when evidence supports them.

## Known implementation cautions

- Preserve the dirty worktree: many unrelated/other-slice changes pre-existed this implementer.
- The current production TypeScript build is green; use it as the baseline before the next edits.
- `record.ts` transition evidence intentionally stores evidence digests, while the wait/control contract stores full `EvidenceRef` objects.
- Infrastructure retry/resume behavior must remain unchanged; human-required waits must never become ordinary resumable waits.
- Authored v1 normalization must remain compatibility-only and must not mutate authored source or create strategy capability requirements.

