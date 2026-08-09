## 1. Blank v2 and canonical serialization

- [x] 1.1 Add failing core tests that `pipeline init` produces a minimal valid Definition v2 envelope with stable name/id/sourceId, empty typed contracts/declarations/root graph, LF output, and no hidden stage.
- [x] 1.2 Introduce the named core blank-v2 factory and replace the v1 `PIPELINE_DEFINITION_VERSION` scaffold dependency without changing output-directory, identifier, permission, or collision safety.
- [x] 1.3 Add failing serializer tests for v2 semantic ordering, UTF-8/final newline, YAML/JSON input, unknown authored-field retention, and prepare -> serialize -> prepare source/capability/plan digest equality.
- [x] 1.4 Implement one canonical authored-definition serializer used by init, save, export, and package staging; keep authored v1 serialization and source-version identity unchanged.
- [x] 1.5 Add Windows/POSIX path and CRLF/LF fixtures using `path.join()`/`path.resolve()` and prove equivalent v2 definitions serialize and package with equal semantic meaning.

## 2. Closed v2 execution declaration

- [x] 2.1 Add failing Definition tests for missing/partial AtomicStage execution declarations and every invalid role, workspace, verification, runtime, model/effort/sandbox, reuse, and handoff field, plus invalid Gate target/outcome/disposition metadata, with deterministic JSON Pointer diagnostics.
- [x] 2.2 Define `AtomicStageExecutionV1` by composing existing StageRole, VerifyPolicy, AgentRuntime, session-reuse, and handoff schemas/constants; require role/workspace, retain supported optional policy fields, and make targeted Gate nodes the sole authored gate authority.
- [x] 2.3 Include execution declarations in canonicalization, semantic source/plan digests, preparation output, and save/detail/export wire types without changing trusted capability authority.
- [x] 2.4 Add failing native-v2 profile tests proving exact capability pins, explicit workspace access, role/gate/verifyPolicy, config override precedence/provenance, and `sessionReuseAuthored` survive profile resolution.
- [x] 2.5 Replace review-oriented v2 policy synthesis with execution-declaration-aware resolution while leaving ECP-7 handoff/reuse limit values and worker enforcement untouched.
- [x] 2.6 Add fail-closed tests for missing, disabled, forbidden, and version-mismatched native-v2 capabilities at root, Composite body, loop phase, and strategy paths.

## 3. Typed built-in lowering metadata

- [x] 3.1 Add failing validation tests for authored ReviewCycle and GoalLoop phase tags, typed goal variant, FanOut member/condition/required fields, concurrency/budget/join target, and Join member/outcome consistency.
- [x] 3.2 Promote the already-lowered built-in metadata to validated v2 contracts without adding new node kinds, nested loops, recursive Composite, or arbitrary execution hooks.
- [x] 3.3 Add failing lowerer tests proving native v2 ReviewCycle, GoalLoop, Choice, FanOut/Join, Gate, Finish, and report/ship tails require no pipeline-name or `legacy.*` inference.
- [x] 3.4 Update profile binding and lowerer paths to consume only validated v2 metadata for native sources while preserving v1 compatibility normalization at its existing adapter boundary.
- [x] 3.5 Audit all native-v2 lowering branches for stable hierarchical/profile paths and add plan decode/replay fixtures for root, declaration, loop strategy, fan-out member, join, and finish nodes.

## 4. Shared prepared execution view

- [x] 4.1 Add failing parity tests showing authored v2 currently returns raw CLI JSON/empty API stages and define the expected shared build-order, capability, role, workspace, gate, verify, runtime/model/handoff, loop, and engine fields.
- [x] 4.2 Implement one pure prepared execution-view projector for v1 compatibility and native v2 definitions, using topological graph identities plus the same capability/policy resolution used by launch.
- [x] 4.3 Refactor registry list/detail metadata, `pipeline show` JSON/text, Management inventory/detail, and engine-support discovery to consume the shared view; remove the v2 raw-JSON/empty-stage special cases.
- [x] 4.4 Preserve full authored definition and preparation diagnostics/digests beside the execution view, and keep the compiled runtime plan opaque.
- [x] 4.5 Add project/store/global stage override tests for migrated logical ids and assert inspection facts equal the frozen launch profile under unchanged configuration.

## 5. ReviewCycle built-in migration

- [x] 5.1 Add an explicit `CHANGE_LEVEL_BUILTIN_PIPELINES` constant and failure-first package audit for exactly the six intended names, authored version 2, exact catalog pins, absence of legacy fields, and package inclusion.
- [x] 5.2 Capture semantic migration-oracle fixtures for current `bug-fix`, `small-feature`, and `full-feature` review portions: order, roles, gates, adaptive/standard verification, body phases, tails, and effective configuration ids.
- [x] 5.3 Verify `rasen-review-cycle` can consume the versioned strategy invocation and produce `bounded-loop/strategy-result/1`; update its advertised/prompt contract first if the failing contract test proves otherwise.
- [x] 5.4 Reauthor `bug-fix` as v2 propose -> apply -> adaptive bounded ReviewCycle -> ship -> archive with explicit execution declarations, lifecycle, limits, and exact capability/strategy pins.
- [x] 5.5 Reauthor `small-feature` as v2 propose -> apply -> standard verify -> bounded ReviewCycle -> ship -> archive under the same body/lifecycle contracts.
- [x] 5.6 Add paired prepared-view/lowered-plan/reconciler tests proving both pipelines retain product behavior, reviewer/fixer separation, clean ship guard, and restart determinism without `LEGACY_NORMALIZED`.

## 6. GoalLoop built-in migration

- [x] 6.1 Capture migration-oracle fixtures for measure/evaluate/research variants, gates, work/judge roles, limits, satisfaction/exhaustion meaning, and each downstream tail.
- [x] 6.2 Verify `rasen-goal-iterate` consumes the strategy invocation and produces `bounded-loop/strategy-result/1`; update the capability contract before manifest binding if required by the failing test.
- [x] 6.3 Reauthor `goal-loop-measure` as native v2 with typed measure body, explicit execution/lifecycle policy, one bounded strategy, and ship/retain/archive tail.
- [x] 6.4 Reauthor `goal-loop-evaluate` as native v2 with typed evaluate body, explicit execution/lifecycle policy, one bounded strategy, and ship/retain/archive tail.
- [x] 6.5 Reauthor `goal-loop-research` as native v2 with typed research body, explicit lifecycle/strategy, report-only tail, truthful `iterationLimit -> exit/max-rounds-exhausted`, and non-success strategy-exhausted reporting.
- [x] 6.6 Add goal matrix tests for satisfied, unsatisfied final round, stall/strategy/material recovery, strategy failure/exhaustion, blocked exact-resume, report-tail truth, fresh-process replay, and no `goal-run.json` authority.

## 7. full-feature native parallel migration

- [x] 7.1 Capture a semantic oracle for current `full-feature`: office-hours/propose/apply, six expert members, conditions, required/optional policy, concurrency/budget, collect-all Join, ReviewCycle dependency, and ship/retain/archive tail.
- [x] 7.2 Add failure-first native-v2 FanOut/Join tests for missing member, duplicate or conflicting membership, invalid cap/budget, dangling join target, and inconsistent Join outcomes.
- [x] 7.3 Reauthor `full-feature` as a complete v2 graph with exact AtomicStage policies/capability pins, typed conditional FanOut/Join, shared ReviewCycle/lifecycle/strategy, gates, and tail.
- [x] 7.4 Add prepared-view and immutable-plan parity tests for expert membership/frontier, evaluator/member bindings, workspace access, join fail-closed behavior, open Major ship guard, and engine support.
- [x] 7.5 Run focused success, optional failure, required failure, budget suppression, cancel, and restart journeys through the native v2 `full-feature` definition.

## 8. Public defaults and compatibility boundary

- [x] 8.1 Switch the fresh Canvas assemble and not-found recovery seeds to the browser-safe blank-v2 factory mirror; keep duplicate-from-existing and authored v1 editing behavior unchanged.
- [x] 8.2 Add shared fixture/parity tests for core and UI blank factories plus UI component tests proving a fresh draft is v2 and unexposed fields survive.
- [x] 8.3 Update CLI/API/localized product copy and docs so native built-ins/default authoring no longer emit the v1-normalization warning and v1 is described as compatibility input.
- [x] 8.4 Add `PIPELINE_V1_COMPATIBILITY_FIXTURES` with only `auto-decompose` and project its `issue-dispatch-0.3.0` boundary through list/show/API without modifying its manifest.
- [x] 8.5 Pin the pre-Change `auto-decompose/pipeline.yaml` bytes, assert authored version 1 and exclusion from the six-item set, and verify its current legacy portfolio resume/classification behavior remains unchanged.
- [x] 8.6 Audit the diff to confirm no Canvas primitive/loop editor parity, final vertical dogfood, Session executor, Issue/Dispatch/portfolio migration, release audit, or second writable execution state entered this Change.

## 9. Validation and delivery evidence

- [x] 9.1 Run strict Change validation and focused Definition, serializer/library/package, registry/resolver/profile/lowerer/runtime-plan, built-in, CLI, Management API, and Canvas blank-draft tests serially after one build.
- [x] 9.2 Run the six-built-in acceptance matrix asserting authored v2, no legacy markers, exact capability pins, valid prepared execution view, reconciler support, decoded immutable plan, and expected domain/parallel tail semantics.
- [x] 9.3 Run root TypeScript no-emit, build, lint, full applicable root tests, UI typecheck, and full applicable UI tests; record pre-existing failures separately.
- [x] 9.4 Run local Windows path-sensitive init/save/export/import/package/API tests and use Node path helpers in every new expectation.
- [ ] 9.5 At the parent portfolio PR, confirm required Windows CI plus normal Linux/macOS lanes are green; keep this external task open until remote evidence exists.
- [x] 9.6 Record exact fixture/digest changes, accepted limitations, unresolved findings, and child review-clean evidence for the Canvas-parity planner; do not claim the Direction Slice passed before child 4 vertical proof.

## 10. Independent review remediation

- [x] 10.1 Remove `execution.gate` from native v2 and lower gate id/outcomes/dispositions exclusively from validated Gate nodes targeting one AtomicStage.
- [x] 10.2 Make Management API inventory/detail detect or accept one request host and prove parity with the shared CLI projection on Codex and Claude hosts.
- [x] 10.3 Run native-v2 execution preflight through the shared projection before engine selection, rejecting unsupported routes and unavailable Codex/Claude bridges before a Run can be created.
- [x] 10.4 Add and pin the write-capable `rasen-review-fix` phase contract, keep re-review read-only and independent, and fail closed on incompatible phase capability/role/workspace declarations.
- [x] 10.5 Add and pin the read-only `rasen-goal-judge` phase contract for measure/evaluate/research results and preserve author != verifier separation from the work Action.
- [x] 10.6 Refresh workflow catalog fixtures and exact pins, run focused mutation/parity/preflight/phase tests plus build/typecheck, and record the remediation evidence for the parent review loop.

## 11. Round-2 review remediation

- [x] 11.1 Close effective install and execution enablement transitively over every capability owner reached through selected workflows' required pipelines, including declarations, strategies, tails, conditional members, and decompose children.
- [x] 11.2 Exclude every `INTERNAL_BUILTIN_WORKFLOW_IDS` member generically from the selectable built-in upgrade baseline while retaining dependency installation.
- [x] 11.3 Carry authored Gate `proceed | fail | escalate` dispositions through `NodeDisposition` and reconciler actions without collapsing `fail` into `escalate`.
- [x] 11.4 Correct retired authority comments and add production-catalog, future-internal-id, and three-disposition regression coverage plus Round-2 evidence.
