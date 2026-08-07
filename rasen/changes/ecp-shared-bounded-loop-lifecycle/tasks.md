## 1. Definition and immutable plan contract

- [x] 1.1 Add failing Definition v2 tests for a missing, partial, contradictory, and impossible bounded-loop lifecycle policy, including stable diagnostic codes and JSON Pointer paths.
- [x] 1.2 Add the versioned lifecycle policy, trigger dispositions, strategy binding, and typed outcome schemas to the public Definition v2 `BoundedLoop` contract.
- [x] 1.3 Implement complete static validation for positive safe-integer limits and thresholds, zero-or-positive strategy attempts, capability/disposition consistency, complete lifecycle exits, and deterministic multi-error ordering.
- [x] 1.4 Add failing compatibility tests proving v1 review and goal loops materialize explicit policies without rewriting source or inventing a strategy capability.
- [x] 1.5 Implement conservative v1 lifecycle normalization and include the materialized policy in semantic canonicalization and source/plan digests.
- [x] 1.6 Add failing lowerer and runtime-plan codec tests for `maxIterations`, `maxActions`, `budget`, thresholds, strategy binding, and every lifecycle disposition.
- [x] 1.7 Extend the runtime bounded-loop plan node and codec to preserve the complete normalized limits and lifecycle policy, with fail-closed handling for unsupported live policy-free plan formats.
- [x] 1.8 Update only lifecycle-sensitive definition, normalization, lowering, and digest fixtures; verify current authored v1 built-in sources remain byte-for-byte unchanged.

## 2. Shared lifecycle reducer

- [x] 2.1 Add table-driven failing tests for the closed lifecycle decision union across domain completion, ready, waiting, every loop-local limit, stall, blocker, strategy, human-required, exit, escalation, failure, and cancellation.
- [x] 2.2 Introduce the pure bounded-loop lifecycle module and domain-snapshot adapter boundary without importing ReviewCycle or GoalLoop result unions into the shared reducer.
- [x] 2.3 Implement stable loop-scoped action accounting and pre-admission checks so ordinary phases, retries, strategy actions, and recovery actions consume independent action and budget allowances.
- [x] 2.4 Add failing progress-fingerprint tests for initial baselines, equal progress, material progress, stable ordering/de-duplication, and exclusion of actor/prose fields.
- [x] 2.5 Implement program-derived progress fingerprints and deterministic stall streak reconstruction from the frozen plan and committed Record.
- [x] 2.6 Add failing blocker tests for same/different semantic blockers, changed prose/evidence, threshold admission, and reset after material success.
- [x] 2.7 Implement the typed `bounded-loop/blocked/1` result contract, canonical blocker fingerprints, and same-blocker streak reconstruction.
- [x] 2.8 Implement one stable latest-attempt selector ordered by committed attempt ordinal and ActionId, then replace first-match loop action reads with it.

## 3. Strategy, waits, and canonical controls

- [x] 3.1 Add failing identity and reducer tests for distinct strategy-attempt and strategy-recovery paths, independent counters, and replay-safe trigger consumption.
- [x] 3.2 Add the frozen strategy invocation and `bounded-loop/strategy-result/1` contracts, then admit strategy actions through existing capability, action, evidence, and settle boundaries.
- [x] 3.3 Implement one recovery iteration per completed strategy attempt and verify material change by comparing program-derived pre/post recovery fingerprints.
- [x] 3.4 Implement strategy-exhausted selection exactly once, including strategies triggered at the normal iteration cap without incrementing `maxIterations`.
- [x] 3.5 Add failing Record, reducer, and control tests for canonical `human-required` waits, exact WaitId decisions, stale/replayed decisions, evidence, retry, escalate, and cancel.
- [x] 3.6 Extend wait and transition contracts for `human-required`; commit retry/escalate decisions before clearing the wait and admit retry as a fresh attempt.
- [x] 3.7 Add reconciler tests proving infrastructure waits retain existing semantics and are not counted as domain blockers.

## 4. Domain adapters remain separate

- [x] 4.1 Add failing ReviewCycle adapter tests for stable unresolved Blocker/Major plus accepted-known progress material, clean/continue intent, and latest-attempt blocked recovery.
- [x] 4.2 Refactor ReviewCycle to supply domain snapshots to the shared reducer while retaining review/triage/fix/re-review validation, actor separation, finding state, and clean ship guards.
- [x] 4.3 Replace ReviewCycle-owned round-cap escalation with sealed lifecycle decisions and add iteration-limit strategy, terminal, wait, and restart cases.
- [x] 4.4 Add failing GoalLoop adapter tests for measure direction/score progress, evaluate/research stable gaps, satisfaction, and latest-attempt blocked recovery.
- [x] 4.5 Refactor GoalLoop to supply variant-specific domain snapshots while retaining work/judge schemas, actor separation, score/gap state, and satisfaction semantics.
- [x] 4.6 Remove GoalLoop-owned stall and synthetic budget decisions after parity is proven, and add iteration-limit strategy plus truthful research report-tail tests.
- [x] 4.7 Adapt generic Composite bounded-loop bodies to the same lifecycle boundary using stable completed-stage/result material without adding nested-loop behavior.
- [x] 4.8 Add paired ReviewCycle/GoalLoop reducer matrices proving identical mechanical inputs yield shared lifecycle decisions while their domain results and reducers remain distinct.

## 5. Reconciler integration and recovery

- [x] 5.1 Replace the reconciler's ReviewCycle/GoalLoop hard-coded exhausted branches with exhaustive handling of the shared lifecycle decision union.
- [x] 5.2 Enforce loop-local admission atomically before action commit and preserve Record-global limits as independently named outer failures.
- [x] 5.3 Add end-to-end blocked→resume→fresh-attempt→success tests for ReviewCycle and every GoalLoop variant, including restart after each committed boundary.
- [x] 5.4 Add end-to-end stall→strategy→material recovery and stall→strategy→unchanged→strategy-exhausted tests for review, goal, and generic Composite loop fixtures.
- [x] 5.5 Add human-required retry/escalate, cancellation during each lifecycle state, crash-before/after-commit, acknowledgement-loss, and fresh-process replay journeys.
- [x] 5.6 Prove reports and `goal-run.json` remain derived compatibility projections by testing that edits to them cannot alter resume or lifecycle decisions.

## 6. Projection and product surfaces

- [x] 6.1 Add failing projector and wire-contract tests for the complete versioned `bounded-loop-lifecycle/1` section and its association with separate review/goal sections by loop path.
- [x] 6.2 Implement lifecycle projection from immutable plan plus canonical Record, including used/max limits, fingerprints, streaks, strategy, waits, typed outcomes, and cancellation.
- [x] 6.3 Update pipeline validate/show JSON and localized text tests, then expose authoritative lifecycle diagnostics and the exact normalized/sealed policy without rewriting v1 sources.
- [x] 6.4 Update pipeline status and Management API tests, then pass through the same lifecycle sections without reading launcher or compatibility state.
- [x] 6.5 Add shared UI wire types and Operations component tests for review, goal, and generic loop lifecycle panels, human controls, truthful non-success exits, missing old sections, and unknown future versions.
- [x] 6.6 Implement Operations lifecycle rendering and canonical control refresh while leaving Canvas authoring and draft serialization unchanged.
- [x] 6.7 Add cross-plane parity tests proving CLI, Management API, and Operations expose the same canonical lifecycle fields and do not duplicate counters.

## 7. Verification and scope guard

- [x] 7.1 Run the focused definition, pipeline-registry, runtime-plan, lowerer, lifecycle reducer, ReviewCycle, GoalLoop, reconciler, projector, CLI, API, and Operations test files serially after one build.
- [x] 7.2 Run repository typecheck, lint, and the full applicable unit/integration suite serially, recording any pre-existing failures separately from this Change.
- [ ] 7.3 Run the affected path-sensitive CLI/API tests on Windows and the Windows CI lane, using `path.join()` or `path.resolve()` in new cross-platform expectations; confirm the normal Linux/macOS CI lanes remain green.
- [x] 7.4 Audit the final diff to confirm no Canvas authoring, built-in v2/default migration, Session executor, Issue/Dispatch/portfolio, release-audit, or writable auto-run/goal-run lifecycle state entered this Change.

## Verification evidence (2026-08-01, Windows)

- Build and type safety: root build and `tsc --noEmit` passed; UI typecheck passed.
- Lint: exit 0 with one pre-existing warning in untouched `test/core/change-run/facade-settle-completeness.test.ts` (unused eslint-disable directive).
- ChangeRun suite: 64 files, 568/568 tests passed; the preserved `test-engine-product-surface-tmp/` owner was not rerun.
- Pipeline registry and relevant Management API suite: 20 files, 619/619 tests passed.
- Pipeline CLI suite: 101/101 tests passed, including lifecycle JSON Pointer diagnostics and exact normalized-policy display.
- UI suite: 57 files, 609/609 tests passed; jsdom's existing navigation/scroll warnings remained non-failing.
- Three migrated temporary-output directories remain present as requested. Their owner tests were excluded from reruns; migration evidence recorded build, core 126/126, UI typecheck, and UI component 4/4 before this pass.
- Task 7.3 is intentionally still open: local Windows path-sensitive CLI/API coverage passed, but the Windows/Linux/macOS CI-lane confirmation belongs to the parent portfolio's single PR delivery and cannot be truthfully claimed by this local-only child Change.
- Review-cycle round 1 blocker closure: failed strategies now consume one logical attempt and advance to exact exhaustion; blocked strategies exact-resume through fresh occurrences with canonical occurrence-aware waits; execution and projection share the same attempt accounting.
- Research GoalLoop closure: a non-success lifecycle `exit` may settle only a completed research tail, while measure/evaluate and ordinary success delivery retain the satisfied guard. The final Record and lifecycle projection remain exhausted/iteration-limit rather than satisfied.
- Round 1 focused regression: bounded lifecycle + facade GoalCycle tests passed 63/63; Record/reducer/projector/domain guard tests passed 37/37; root `tsc --noEmit` and build passed.
