# Implementer handoff: shared bounded-loop lifecycle (implementer 3)

## Why this handoff exists

The implementer-3 context compacted after the runtime/recovery and shared-ownership work reached a compile-green, focused-test-green boundary. Per the parent task's hard relay rule, I did not begin the remaining UI/API test tranche after compaction. This document records the exact completed work, evidence, eliminated hypotheses, and continuation order.

## Required context and workflow already applied

- Read `handoff/implementer-2.md` first, then `handoff/implementer-1.md`.
- Read and followed `.codex/skills/rasen-apply-change/SKILL.md` in full.
- Ran `rasen status --change ecp-shared-bounded-loop-lifecycle --json` and `rasen instructions apply ecp-shared-bounded-loop-lifecycle --json`.
- Read the proposal, design, all six delta specs, `tasks.md`, child and parent planning contexts, the Slice spec/plan, target state, gap calibration, `.openspec.yaml`, repository guidance, and `test/AGENTS.md`.
- The workflow is `spec-driven`; it was ready to apply. `tasks.md` remains intentionally unchecked because the task groups still require broader evidence.
- Preserved the already-dirty shared worktree. No commit, archive, ship, or run-state mutation was performed.

## Verification at this handoff

- `pnpm exec tsc --noEmit` passes after the latest Goal section schema and duplicate-ownership removal (2026-08-01; 20.8 seconds).
- Focused grouped run passes: 9 files, 96/96 tests:
  - `test/core/change-run/bounded-loop-lifecycle.test.ts`
  - `test/core/change-run/review-cycle-runtime.test.ts`
  - `test/core/change-run/goal-cycle-canonical.test.ts`
  - `test/core/change-run/goal-cycle.test.ts`
  - `test/core/change-run/goal-cycle-runtime.test.ts`
  - `test/core/change-run/composite-runtime.test.ts`
  - `test/core/change-run/projector.test.ts`
  - `test/core/change-run/reducer.test.ts`
  - `test/core/change-run/contracts.test.ts`
- Earlier in this pass, the six most directly impacted runtime files passed 37/37 focused tests; ReviewCycle iteration-limit recovery and GoalLoop iteration-limit recovery each passed their focused journey.
- No post-pass build, lint, full suite, UI suite, Windows lane, or remote CI run has been completed.

## Exact work completed in this pass

### 1. Strategy and deterministic recovery now use one shared lifecycle

- `src/core/change-run/internal/bounded-loop-lifecycle.ts`
  - Unified normal and deterministic recovery-path action reads.
  - Added Record-aware latest-attempt selection using canonical `ActionAdmitted` chronology. The pure ordinal/ActionId selector remains available only where no Record chronology exists.
  - Includes recovery-path blocked results in blocker reconstruction and logical next-action selection.
  - Recognizes canonical human retry and ordinary domain-blocked resume as one exactly-once fresh attempt, including recovery paths.
  - Carries the exact source blocked wait into `strategy-ready`.
  - Centralizes action/budget limit checks and applies them before strategy admission.
  - Keeps strategy output separate from proof of progress: only the recovered domain attempt and adapter-derived material can demonstrate recovery.
- `review-cycle-runtime.ts`, `goal-cycle-runtime.ts`, and `composite-runtime.ts`
  - Select latest results across normal and strategy-scoped recovery alternatives.
  - Enumerate deterministic recovery invocation paths in the locator and owned-invocation set.
  - Use an effective adapter iteration allowance for a successful iteration-limit strategy without mutating the authored maximum.
  - Validate completion against the exact recovered node while retaining logical round/phase validation.
  - Composite no longer treats a blocked stage result as success.

### 2. Canonical source-wait consumption for strategy

- `src/core/change-run/internal/record.ts`
  - Added `DomainBlockedWaitConsumedByStrategy` with exact WaitId, ActionId, strategy node, and trigger.
- `src/core/change-run/internal/reducer.ts`
  - Added `consume-domain-blocked-wait-for-strategy`.
  - Validates the exact active domain-blocked wait and exact blocked source result, commits the dedicated transition, and removes the wait.
  - Does not write `RunResumed`, so strategy consumption cannot masquerade as user-authorized ordinary retry.
- `src/core/change-run/internal/reconciler.ts`
  - Strategy candidates preserve the exact source wait.
  - Recovery admissions carry `boundedLoopRecovery` metadata; strategy admissions retain `boundedLoopStrategy` metadata.
- `src/core/change-run/internal/facade-runtime.ts`
  - Atomically consumes the exact source wait immediately before the selected strategy admission.
  - Does not consume it when workspace selection blocks the strategy.
  - Strictly decodes successful strategy results as `bounded-loop/strategy-result/1`; failed/blocked strategy actions retain ordinary result handling.

### 3. Projection and lifecycle ownership corrections

- `src/core/change-run/internal/projector.ts`
  - Wait association is exact over normal, strategy, and deterministic recovery node IDs; unrelated waits are no longer attached merely because a strategy exists.
  - A selected active wait projects `waiting` before `strategizing`.
  - Globally terminal Records do not project a loop as still running, and global limits are not mislabeled as loop-local outcomes.
  - Authored iteration usage remains capped at the authored maximum while adapters may temporarily execute the strategy-granted recovery iteration.
  - Removed Goal's duplicate synthetic `budget` and `stallStreak`; the lifecycle section is the sole owner.
- `src/core/change-run/internal/goal-cycle.ts`
  - Removed domain-owned stall calculations and state.
  - Retained variant-specific score/gap/satisfaction/round semantics.
  - Removed the hidden `maxIterations <= 100` adapter restriction so an authored max of 100 plus one recovery allowance remains representable.
- `src/core/change-run/internal/review-cycle.ts`
  - Removed the same hidden adapter-only max-100 restriction.
- `src/core/change-run/contracts.ts`
  - Added strict recognized `goal/1` wire decoding and kept unknown future Goal versions additive.
  - Added `GoalViewSection` to the recognized section union.

### 4. Tests and fixture migration completed here

- Added `test/core/change-run/bounded-loop-lifecycle.test.ts` with nine focused cases covering:
  - baseline/equal/material progress reconstruction;
  - pure latest-attempt ordering;
  - strategy result contract decoding;
  - loop-local action-limit priority before strategy;
  - exact canonical strategy wait consumption with no `RunResumed`;
  - iteration-limit strategy through a deterministic Composite recovery path;
  - malformed successful strategy rejection before mutation;
  - exact human retry, one fresh admission, and stale WaitId replay rejection;
  - exact projector wait membership with two loops.
- Added full iteration-limit strategy/recovery journeys to ReviewCycle and GoalLoop runtime tests.
- Updated Goal tests to assert domain truth while lifecycle alone projects stall/budget counters.
- Migrated the remaining identified valid runtime bounded-loop fixtures in `ui-constants-provenance.test.ts` and `ecp-composite-validation.test.ts` to complete lifecycle policy fixtures rather than relaxing fail-closed v2 decoding.

## Exact remaining work, in continuation order

1. **Finish the API/UI Goal and forward-compatibility tranche.**
   - Mirror core `GoalViewSection` in `packages/ui/src/api/types.ts`, add it to the recognized union, and add `getGoalSection`.
   - Render a separate Goal domain panel in `OperationsSection.tsx` (variant, round, phase, outcome, score, gaps) with no lifecycle counters.
   - Extend the older-run compatibility notice to Goal sections missing lifecycle projection.
   - Detect and render a localized unsupported notice for unknown future `bounded-loop-lifecycle` versions; do not expose controls for them.
   - Show human-required evidence truthfully (the current wait label shows reason/outcome but not evidence detail).
   - Add `operations.goal.*` and the unsupported-version key to en/ja/zh-cn.
   - If needed for management-wire pass-through, add an optional typed lifecycle field to the UI wire `BoundedLoop` type only; do not add Canvas controls, defaults, or draft migration.
2. **Add API/UI/contract evidence.**
   - Add known Goal/lifecycle and unknown-future-version contract fixtures.
   - Add Management API lifecycle pass-through assertions.
   - Add Operations component tests for ReviewCycle, GoalLoop, generic Composite, human controls/evidence, truthful non-success exits, missing old sections, and unknown future versions.
   - Run i18n used-key tests for all three locales.
   - Add cross-plane parity assertions for CLI, Management API, and UI canonical lifecycle fields.
3. **Complete remaining lifecycle matrices/journeys required by `tasks.md`.**
   - Shared closed-union table cases not yet represented: all limit/outcome/disposition/cancel combinations.
   - Paired ReviewCycle/GoalLoop identical-mechanics matrix.
   - Blocked-to-resume-to-success for every Goal variant and ReviewCycle with fresh-process restart at committed boundaries.
   - Stall strategy material-recovery and unchanged-to-strategy-exhausted journeys for review, goal, and Composite.
   - Human retry/escalate/cancel, crash before/after commit, acknowledgement loss, infrastructure-wait non-regression, and report-edit non-authority journeys.
4. **Finish fixture and scope audit.**
   - Search all runtime/authored `kind: 'bounded-loop'` occurrences (including double-quoted forms) and migrate only valid runtime v2 fixtures. Leave intentionally invalid diagnostics and Canvas authoring behavior scoped to their later slices.
   - Audit that no second writable lifecycle state, Session executor, Issue/Dispatch, release closure, built-in v2/default migration, or Canvas authoring change entered this Change.
5. **Remove parity scaffolding only after the broader focused set is green.**
   - Delete the large commented superseded domain-dispatch block after the shared lifecycle switch in `reconciler.ts` and clean its now-unused imports.
   - Goal duplicate stall/budget ownership has already been removed; retain only domain score/gap/satisfaction projections.
6. **Run final validation and mark evidence only.**
   - Build once, then run the full focused serial set from task 7.1.
   - Run root and UI typechecks, lint, full applicable tests, and path-sensitive Windows tests.
   - Record pre-existing failures separately.
   - Check only task boxes fully backed by inspected implementation and passing evidence; `tasks.md` is still 0/48 at this handoff.

## Partial UI state inherited at this boundary

The current worktree already contains typed/rendered `bounded-loop-lifecycle/1`, human-required wait typing, lifecycle labels in three locales, and an older-ReviewCycle compatibility notice. It does **not** yet contain the typed Goal UI panel, unknown-future lifecycle warning, human evidence rendering, or the required UI/API test coverage. Core `goal/1` strict decoding was the last production edit before this handoff and compiles.

## Durable design decisions and eliminated hypotheses

1. **Eliminated: attempt ordinal plus ActionId is sufficient everywhere.** A normal retry is a new invocation occurrence and its per-invocation ordinal resets to zero. Record-aware selection must use canonical admission chronology or it can choose a stale pre-retry action.
2. **Eliminated: a blocked Composite stage is equivalent to a completed stage.** Treating any committed stage result as success advanced the loop past an unresolved blocker; blocked remains waiting/recoverable.
3. **Eliminated: strategy success can consume a blocked wait through ordinary `RunResumed`.** That transition has user-retry semantics. Strategy uses its own exact canonical consumption fact.
4. **Eliminated: consume the blocked wait as soon as a strategy candidate exists.** Workspace selection can defer admission. Consumption occurs atomically only for the actually selected strategy action.
5. **Eliminated: strategy self-report proves progress.** Successful strategy output must decode its frozen contract, but material recovery is proven only by a distinct recovered domain attempt and adapter-derived structured progress.
6. **Eliminated: active strategy status is a safe fallback for wait association.** It can attach another loop's wait. Membership must be exact across normal/strategy/recovery node identities.
7. **Eliminated: Goal-owned stall/budget mirrors are harmless compatibility data.** They create competing lifecycle ownership and can drift; the Goal section owns only variant-specific domain truth.
8. **Eliminated: an adapter-only maximum of 100 remains valid after a max-cap recovery strategy.** The frozen authored maximum stays 100, but the adapter must represent the one strategy-scoped recovery iteration without mutating policy.
9. **Eliminated: a globally terminal Record implies a loop-local limit outcome.** Projection may show terminal lifecycle state, but it must not relabel independent Record-global failure as a loop-local action/budget/iteration exit.

## Worktree cautions

- The shared worktree contains extensive unrelated and earlier-slice changes. Do not reset, revert, or overwrite them.
- Use `apply_patch` for edits.
- Do not commit, archive, ship, or create/mutate run state from this implementation task.
- Respect the Slice boundary: shared bounded-loop lifecycle only; no Canvas authoring/default migration, Session executor, Issue/Dispatch/portfolio, release closure, or second writable lifecycle state.
