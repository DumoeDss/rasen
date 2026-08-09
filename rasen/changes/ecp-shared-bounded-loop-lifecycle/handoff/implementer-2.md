# Implementer handoff: shared bounded-loop lifecycle (implementer 2)

## Why this handoff exists

The second implementer context compacted while strategy-recovery integration was in progress. Per the parent task's hard handoff rule, I stopped at the next safe atomic boundary: all current production TypeScript compiles, the incomplete adapter recovery wiring has not been partially applied, and the durable findings and exact remaining work are recorded below.

## Required context already read

I read and followed `.codex/skills/rasen-apply-change/SKILL.md`, ran the Rasen status/apply instructions, and read the full change proposal, design, all six delta specs, tasks, both child and parent planning contexts, the slice spec/plan, and `handoff/implementer-1.md`. The change was schema `spec-driven`, ready to apply, and `tasks.md` was 0/48 before this implementation pass.

## Verification at handoff

- `pnpm exec tsc --noEmit` passes after the latest `ownedInvocations` adapter edits (2026-08-01, 12.6 seconds).
- `pnpm --dir packages/ui run typecheck` passed before the later strategy-recovery type edits; root TypeScript now also covers the current production tree.
- `pnpm run build` passed before this pass's edits (about 23 seconds); it has not been rerun afterward.
- Focused tests known green during this pass:
  - `review-cycle-runtime.test.ts` plus `goal-cycle-canonical.test.ts`: 33/33.
  - `definition.test.ts`: 98/98.
- A grouped runtime/lowering/parity run was reduced to one stale section-count expectation, which was patched but not rerun.
- A facade/reducer/CLI run was reduced to one obsolete CLI expectation, which was patched but not rerun.
- No full suite, lint, final build, or remote CI run has been completed.
- `tasks.md` remains intentionally unchecked; no commit, archive, run-state mutation, or shipping action was performed.

## Implemented in this pass

### Facade-owned public controls and canonical refresh

- `src/core/change-run/internal/facade-runtime.ts`
  - Maps reconciler `await-human-required` and `fail` candidates to reducer stimuli.
  - Replaces the invalid public-control-to-private-stimulus cast with explicit translations for resume, gate decision, human decision, workspace acceptance, escalation, and cancellation.
  - Separates gate and human-required decisions and preserves human decision evidence.
  - Enforces exact run/change identity and `expectedRecordVersion`, returning the current view in stable `record_version_conflict` errors.
  - Batches the public control transition and the next reconciled boundary atomically, commits once, and returns the canonical refreshed view/action grants.
- `src/commands/pipeline.ts`
  - Passes decoded public control envelopes to the facade; the CLI no longer owns private stimulus translation.

### Durable human retry and ordinary blocked resume

- `src/core/change-run/internal/bounded-loop-lifecycle.ts`
  - Reconstructs post-result retry intent from the latest exact `HumanDecisionCommitted retry` and consumes it once after a later `ActionAdmitted` for the same action.
  - Applies the same durable fresh-attempt rule to canonical ordinary `RunResumed` domain-blocked waits.
  - Recognizes an already-active human wait and remains waiting instead of recreating/churning it.

This corrected a broader bug than the requested human path: ordinary domain-blocked resume also previously removed its wait and then immediately reread the same latest blocked result without authorizing a fresh attempt.

### Typed lifecycle projection and surfaces

- `src/core/change-run/contracts.ts`
  - Adds strict known-version decoding for `bounded-loop-lifecycle/1`, including state, iteration/phase, limits, progress/blocker streaks, strategy state, exact wait information, and typed outcome.
  - Keeps unknown future section versions additive.
- `src/core/change-run/internal/projector.ts`
  - Emits one lifecycle section per bounded loop from the plan plus canonical Record through the shared reducer/domain adapters.
  - Projects human-required retry/escalate controls.
  - Associates review/goal compatibility sections with the same loop.
- `src/commands/pipeline.ts`
  - Human-readable status renders lifecycle state, counters, streaks, strategy, wait, and outcome.
- `packages/ui/src/api/types.ts`
  - Adds human-required waits and typed lifecycle sections/getter.
- `packages/ui/src/components/OperationsSection.tsx`
  - Renders human-required wait reasons, every lifecycle panel, strategy/counter/outcome state, and server-projected retry/escalate controls.
  - Shows an older-run compatibility notice when a review domain section exists without lifecycle projection.
- `packages/ui/src/locales/{en,ja,zh-cn}.json`
  - Adds human-required and lifecycle labels.

### Fixture migration and compatibility tests

- Added `test/core/change-run/bounded-loop-fixture.ts` with complete lifecycle/runtime loop fixtures.
- Migrated bounded-loop fixtures in review, goal, composite, lowering, definition, and parity tests to complete v2 limits/lifecycle contracts instead of weakening fail-closed runtime-plan decoding.
- Updated review parity to expect/assert a lifecycle section.
- Updated the CLI completion test to assert that the public envelope reaches the facade rather than a private cancel stimulus.

### Strategy recovery scaffolding (not complete)

- `src/core/change-run/internal/bounded-loop-lifecycle.ts`
  - Adds durable normal invocation descriptors to domain snapshots.
  - Adds deterministic recovery invocation paths (`<loop>/strategy:<attempt>/recovery/<relative normal path>`).
  - Adds helpers for strategy trigger lookup, iteration-limit allowance, recovery action lookup, and pending recovery selection.
  - Counts recovery actions against shared action/budget limits.
  - Represents a pending successful strategy as one distinct recovered domain invocation/iteration rather than accepting the strategy result as proof of material progress.
- `review-cycle-runtime.ts`, `goal-cycle-runtime.ts`, and `composite-runtime.ts`
  - Now provide their normal `ownedInvocations` in domain snapshots.

The attempted large review-adapter recovery patch failed `apply_patch` verification and therefore applied nothing. This is a safe, compile-green boundary: helper scaffolding exists, but adapters do not yet read/write recovery-path results.

## Exact critical remaining work

1. Complete strategy recovery in each domain adapter with small patches.
   - Review: import `selectLatestAttempt`, `strategyIterationLimitAllowance`, and `strategyRecoveryInvocationPath`; select latest normal/recovery result for an invocation; project/reduce through `maxIterations + iteration-limit allowance`; enumerate recovery paths in the invocation locator; validate recovered phase/round against the effective projection.
   - Goal: apply the equivalent step/round recovery selection and effective limit.
   - Composite: project stages through the effective limit and accept deterministic recovery-path alternatives in node/action selection.
   - Successful strategy output must decode `bounded-loop/strategy-result/1`; failed/blocked actions may retain ordinary failure handling.
   - Preserve structured adapter progress material as the only proof of recovery/material change.
2. Resolve the source domain-blocked wait when a strategy starts.
   - It currently can remain active alongside the strategy/recovery action and pollute status/control projection.
   - Do not reuse ordinary `resume-wait` naively: the new fresh-attempt detector would interpret that as user-authorized retry. Prefer an explicit canonical strategy-consumed wait transition/stimulus or an equivalently unambiguous record fact.
3. Enforce shared action/budget priority before admitting a strategy from a blocked disposition.
   - The current blocked branch can choose strategy/human before action/budget checks. Pending recovery does check limits first, but the initial blocked-to-strategy path needs the same centralized ordering.
4. Add facade validation for successful strategy action result contracts and finish any needed strategy/recovery metadata on reconciler candidates.
5. Fix projector wait association.
   - `buildBoundedLoopLifecycleSection` currently has a fallback where any `activeStrategy` can cause an unrelated action wait to be selected. Build the exact strategy/recovery node set and test membership instead.
   - Confirm iteration `used` semantics at authored cap while iteration-limit recovery uses a temporary effective adapter allowance.
   - Confirm terminal domain disposition mapping (`exit` versus another closed outcome) against the spec/tests.
6. Remove duplicated domain lifecycle ownership only after parity is proven.
   - Goal still has compatibility stall/budget mirrors.
   - The old reconciler domain dispatch remains in a temporary block comment immediately after the shared lifecycle switch.
7. Complete management/API/UI composition.
   - Verify whether the Operations UI needs a typed goal-specific section in addition to the lifecycle panel; currently goal sections remain additive/untyped there.
   - Add API contract fixtures and UI/i18n used-key tests.
   - The UI can submit server-projected human decisions and preserves optional evidence in the API type, but it intentionally has no evidence-upload producer; decide whether the task requires one.
8. Add missing focused lifecycle tests.
   - Pure table tests for progress/blocker streaks, limits, strategy cap/recovery, typed exits, and latest-attempt ordering.
   - Facade/reducer tests for exact human wait identity, stale record versions, evidence preservation, retry-once, escalation, and unchanged infrastructure retry.
   - Projector/contract/CLI/API/UI tests for lifecycle sections and all terminal/wait states.
   - Restart-safe end-to-end journeys for review, goal, and composite recovery.
9. Finish fixture migration by searching every authored/runtime `kind: 'bounded-loop'` occurrence; inspect at least `ecp-composite-validation.test.ts` and any UI/API fixtures surfaced by the full run.
10. Run, in order, current focused tests, root/UI typechecks, build/lint, the full suite, Windows path tests, then update only evidenced checkboxes in `tasks.md`. Perform the final scope audit and remove the legacy reconciler comment only after parity.

## Durable design decisions and eliminated hypotheses

1. **Eliminated: only human-required retry was stale.** Ordinary domain-blocked `resume-wait` also removed the wait but immediately reread the same latest blocked result. Both require a durable, exactly-once fresh-attempt fact.
2. **Eliminated: the CLI should flatten public control envelopes.** That bypasses facade ownership, cannot reliably distinguish gate decisions from human-required decisions, and fragments optimistic concurrency handling. The facade is the translation owner.
3. **Eliminated: a successful strategy result proves recovery or material progress.** The design/spec requires one distinct recovered domain attempt and structured adapter progress comparison; strategy prose/self-report is not proof.
4. **Eliminated: a standalone writable lifecycle counter/state store is required.** The lifecycle state remains reconstructed from the frozen runtime plan plus canonical Record transitions/actions/waits.
5. **Eliminated: relax the runtime-plan codec to preserve old tests.** Live policy-free v2 plans must fail closed; fixtures were migrated to explicit limits/lifecycle instead.
6. **Eliminated: a green production build means the change is near completion.** Focused tests exposed broad legacy fixture drift plus still-open strategy/recovery/runtime semantics.

## Strategy recovery model selected for continuation

- Strategy action input already persists its trigger under `agent.input.boundedLoopStrategy.trigger`.
- A successful iteration-limit strategy grants exactly one effective adapter iteration beyond the authored cap; the authored cap itself is never mutated.
- Recovery actions use deterministic strategy-attempt-scoped node paths and still count toward shared action/budget limits.
- For multi-phase review/goal or multi-stage composite, the pending recovery remains tied to the same recovered iteration until the adapter advances to the next iteration or reaches a terminal state.
- Once that recovered iteration is consumed, the shared reducer compares adapter-derived structured progress; absent material progress, it follows the next closed strategy/human/exit decision subject to attempt caps.

## Worktree cautions

- Preserve the dirty worktree and unrelated pre-existing changes; do not reset or revert them.
- Use `apply_patch` for edits.
- Do not create run state, commit, archive, or ship from this change implementation task.
- The temporary reconciler legacy block and goal compatibility fields are intentional parity scaffolding, not dead code to delete early.
