## 1. Runtime plan composite body kind

- [x] 1.1 Add `RuntimePlanCompositeBody` and `RuntimePlanCompositeStage` types to `runtime-plan.ts` (kind: 'composite', declarationId, stages with hierarchicalPath/profilePath/admissionKind/workspace/requires, outcomes map)
- [x] 1.2 Widen `RuntimePlanBoundedLoopNode.body` union to `RuntimePlanReviewCycleBody | RuntimePlanCompositeBody`
- [x] 1.3 Add `RuntimePlanCompositeBodyInput` and `RuntimePlanCompositeStageInput` to the input types; widen `RuntimePlanNodeInput.body` union
- [x] 1.4 Extend `validateBoundedLoop()` in `createRuntimePlan()` with a `body.kind === 'composite'` branch: validate at least one stage, unique hierarchical paths, acyclic body-internal requires, non-empty outcome keys
- [x] 1.5 Extend the `builtNodes` map in `createRuntimePlan()` to build `RuntimePlanCompositeBody` stages from input (mapping profilePath/admissionKind/workspace/requires)
- [x] 1.6 Write failure-first unit tests: composite body with zero stages rejected; duplicate hierarchical paths rejected; cyclic body-internal requires rejected; empty outcome key rejected
- [x] 1.7 Write happy-path unit test: a valid composite-body bounded-loop input produces a frozen `RuntimePlanBoundedLoopNode` with `body.kind === 'composite'`

## 2. Lowerer — CompositeRef inlining

- [x] 2.1 Add `compositeRefBody()` helper in `lowerer.ts`: resolve declaration, validate body is AtomicStage-only flat DAG, collect body stages with hierarchical paths (`root:<ref-id>/<stage-id>`)
- [x] 2.2 Implement entry-stage mapping: body stages with no incoming body-internal connections inherit the CompositeRef's root-level `requires`; body-internal connections translate `from.node`/`to.node` to hierarchical paths
- [x] 2.3 Implement exit-stage mapping: the body's terminal stages (whose outcome ports are not consumed by another body stage) satisfy the CompositeRef's root-level dependents — lower these terminal stages' paths as the dependency for root nodes that `requires` the CompositeRef
- [x] 2.4 Add a `CompositeRef` branch to `lowerV2ReviewCyclePlanInput()` that calls the inlining helpers and pushes atomic `RuntimePlanNodeInput` entries
- [x] 2.5 Write failure-first lowerer tests: CompositeRef referencing missing declaration rejected; body containing non-AtomicStage node rejected; body with cyclic connections rejected; missing frozen capability binding for a body stage rejected
- [x] 2.6 Write happy-path lowerer test: a CompositeRef with a 3-stage body produces 3 atomic RuntimePlanNodeInput entries with correct hierarchical paths and dependency mappings

## 3. Lowerer — composite-body BoundedLoop

- [x] 3.1 Extend `reviewCycleBody()` detection: if the declaration body is NOT ReviewCycle-shaped (lacks 4 `reviewCyclePhase` AtomicStages), route to a new `compositeLoopBody()` helper instead
- [x] 3.2 Implement `compositeLoopBody()`: collect body AtomicStages in topological order, produce `RuntimePlanCompositeStageInput` entries with profilePath `declaration:<id>/node:<stage-id>`, resolve exit mapping from loop.exits to body outcomes
- [x] 3.3 Push a `bounded-loop` `RuntimePlanNodeInput` with `body.kind === 'composite'` and the resolved stages/outcomes
- [x] 3.4 Write lowerer test: a BoundedLoop with a non-ReviewCycle declaration body (2 AtomicStages + Finish) produces a composite-body bounded-loop node
- [x] 3.5 Write lowerer test: a BoundedLoop with ReviewCycle-shaped body still produces a review-cycle body node (ECP-1 regression guard)

## 4. Composite-body progress projection

- [x] 4.1 Create `composite-runtime.ts` with `projectCompositeBodyProgress(plan, loop, record)`: iterate body stages per iteration in topological order, check committed action state, determine ready/waiting/failed/clean/exhausted
- [x] 4.2 Implement body-outcome derivation: when all body stages in an iteration have succeeded results, derive the body's terminal outcome from the body's Finish node or terminal stages' declared outcomes
- [x] 4.3 Implement loop-exit mapping: map the body outcome to the loop's exit mapping; exit → terminal with exit outcome; continue → next iteration; maxIterations reached without exit → exhausted
- [x] 4.4 Implement next-ready-stage computation: the topologically earliest body stage with satisfied dependencies and no committed succeeded action is the admit candidate
- [x] 4.5 Return the same `ready | waiting | failed | clean | exhausted` result shape as `projectReviewCycleProgress` so the reconciler's switch logic is shared
- [x] 4.6 Write unit tests for projectCompositeBodyProgress: first stage ready on start; waiting when stage active; clean when exit outcome produced; exhausted at maxIterations; failed when a body stage fails

## 5. Reconciler composite-body pass

- [x] 5.1 Add `loop.body.kind` branch in the bounded-loop pass of `reconcile()`: call `projectCompositeBodyProgress` for `'composite'` bodies, `projectReviewCycleProgress` for `'review-cycle'` bodies
- [x] 5.2 Ensure the composite-body admit candidate carries the correct nodeId, occurrence, admissionKind, workspace access, and a `composite` payload (loopPath, round, stagePath) for the facade
- [x] 5.3 Write reconciler tests: composite-body loop first-stage admitted; mid-iteration waiting; exit outcome triggers succeeded-set add; exhausted triggers escalate; mixed plan (atomic + composite-body bounded-loop + finish) completes in order

## 6. Prepare-time gate generalization

- [x] 6.1 Rename `supportsV2ReviewCycleRuntime` to `supportsV2ExecutableRuntime` in `definition.ts`; preserve the ReviewCycle body shape check as one branch
- [x] 6.2 Add `CompositeRef` root node support: a CompositeRef is executable if its declaration body contains only AtomicStage nodes (flat DAG)
- [x] 6.3 Add custom BoundedLoop body support: a BoundedLoop is executable if its declaration body is ReviewCycle-shaped OR contains only AtomicStage nodes
- [x] 6.4 Update the `prepare()` return: `executionMode: 'reconciler'` when `supportsV2ExecutableRuntime` returns true
- [x] 6.5 Write gate tests: pure-atomic plan still legacy; ReviewCycle plan still reconciler; CompositeRef plan reconciler; composite-body BoundedLoop plan reconciler; plan with Choice/FanOut/Join still unavailable

## 7. Static validation for custom-authored shapes

- [ ] 7.1 Write failure-first prepare tests proving existing validators fire on Canvas-authored custom shapes: COMPOSITE_RECURSION (A→B→A), NESTED_LOOP (BoundedLoop in body), GRAPH_CYCLE (cyclic body connection), MISSING_EXIT (unmapped body outcome), PORT_MISMATCH (type mismatch in body connection), CAPABILITY_MISSING (unknown capability in body AtomicStage)
- [ ] 7.2 Write happy-path prepare test: a valid custom composite definition (CompositeRef + declaration + 3-stage body) prepares successfully with `executionMode: 'reconciler'`
- [ ] 7.3 Write prepare test: a composite-body BoundedLoop with unreachable exit (exit names an outcome the body cannot produce) is rejected with UNREACHABLE_EXIT

## 8. Canvas authoring — editable kinds and declaration CRUD

- [ ] 8.1 Expand `V2_EDITABLE_NODE_KINDS` in `draft.ts` to include `CompositeRef` and `BoundedLoop`
- [ ] 8.2 Add draft functions: `addDeclaration`, `updateDeclaration`, `removeDeclaration` (with reference guard), `addBodyStage`, `removeBodyStage`, `updateBodyStage`, `addBodyConnection`, `removeBodyConnection`
- [ ] 8.3 Extend `V2NodePanel.tsx` with a CompositeRef panel: declaration dropdown (lists custom declarations), inputs/artifacts/outcomes summary, "open declaration" affordance
- [ ] 8.4 Extend BoundedLoopDetails in `V2NodePanel.tsx`: for non-ReviewCycle bodies, show body stages list, exit mapping editor (outcome → continue/exit dropdown), and maxIterations
- [ ] 8.5 Add a declaration editor sub-panel: inputs list (add/remove/rename name+type), artifacts list, outcomes list, body graph navigator
- [ ] 8.6 Constrain the body palette: when editing a declaration body, only AtomicStage is available (CompositeRef, BoundedLoop, Choice, FanOut, Join hidden from palette)
- [ ] 8.7 Write Canvas unit tests: create declaration → reference from root → save round-trip; delete referenced declaration blocked; body palette constraint enforced

## 9. Canvas — fold/expand and port mapping

- [ ] 9.1 Add fold/expand toggle to CompositeRef nodes in `layout.ts`: folded renders single card with declaration name + outcome ports; expanded renders body stages inline within bounding box
- [ ] 9.2 Store fold state as a display preference in the node's `canvas` metadata (non-semantic, stripped by `semanticCanonicalizeDefinition`)
- [ ] 9.3 Add port-mapping display in V2NodePanel when CompositeRef is selected: show root-level connection → declaration input/artifact/outcome port mapping
- [ ] 9.4 Add Canvas connection guard: validate that connections touching a CompositeRef match the declaration's port contract (mirror of server-side `validateTypedPorts`)
- [ ] 9.5 Write Canvas tests: fold/expand toggles display without altering definition; port mapping shows correct ports; invalid connection rejected with feedback

## 10. Projection — composite drill-down section

- [ ] 10.1 Add `buildCompositeSection()` to `projector.ts`: iterate inlined composite body nodeIds, read committed action state, produce `composite/1` section with stages (path, status, capability, actor), declarationId, compositePath, outcome, and optional loop fields (round, maxIterations)
- [ ] 10.2 Extend `buildSections()` to call `buildCompositeSection` when the plan contains inlined composite nodes (detect via hierarchical path containing a CompositeRef or composite-body BoundedLoop prefix)
- [ ] 10.3 Write projector tests: composite section shows body stage states correctly; loop fields present for composite-body BoundedLoop; section absent for pure ReviewCycle plan; terminal Run shows empty stages

## 11. Isomorphism — built-in vs custom fixture pair

- [ ] 11.1 Create test fixture `test-linear-builtin`: a v1 pipeline with 3 stages (propose → apply → ship) that normalizes to root-level AtomicStages
- [ ] 11.2 Create test fixture `test-linear-custom`: a v2 definition with a CompositeDeclaration wrapping the same 3 AtomicStages, referenced from root via CompositeRef
- [ ] 11.3 Write isomorphism test: both fixtures prepare, lower, and produce runtime plans with equivalent structure (same atomic node count, same dependency graph shape, same finish outcome)
- [ ] 11.4 Write isomorphism test: for the same Record state, both plans produce the same reconcile() admit candidates (same nodeIds modulo hierarchical path, same admission kind)
- [ ] 11.5 Write isomorphism test: both plans project the same root-dag section structure

## 12. Export/import round-trip — digest stability

- [ ] 12.1 Construct a `DefinitionSourceV2` with a custom CompositeDeclaration including `canvas`, `position`, `provenance`, `sourcePath` metadata
- [ ] 12.2 Compute `semanticCanonicalizeDefinition(definition)` → digest A
- [ ] 12.3 Simulate export (JSON serialize) → re-import (JSON parse) → re-prepare → compute `semanticCanonicalizeDefinition` → digest B
- [ ] 12.4 Assert digest A === digest B; assert `canvas`/`position`/`provenance`/`sourcePath` are absent from both canonical forms
- [ ] 12.5 Write round-trip test with a BoundedLoop + custom declaration body (verify loop exits and limits survive round-trip)

## 13. Recovery — composite body stage fault injection

- [ ] 13.1 Write crash-before-commit test: composite body stage A admitted, crash before completion committed → resume → A still active, B not admitted
- [ ] 13.2 Write crash-after-commit test: composite body stage A completion committed, crash before B admitted → resume → B admitted, A not re-admitted
- [ ] 13.3 Write mid-composite recovery test: 3-stage composite body, stages A+B committed, crash → resume → C admitted, A and B in succeeded set
- [ ] 13.4 Write composite-body BoundedLoop recovery test: iteration 1 stage A committed, crash → resume → iteration 1 continues with stage B; iteration boundary recovery (all stages in iteration 1 done, crash → resume → iteration 2 stage A admitted)

## 14. Real dogfood

- [ ] 14.1 Author a non-built-in Custom Composite in the Canvas (or construct programmatically): a declaration with 2-3 AtomicStage body stages referencing real capabilities, referenced from root via CompositeRef
- [ ] 14.2 Run the custom composite against a real Change via the reconciler; record success path (all stages complete → Run completes)
- [ ] 14.3 Record failure path (one body stage fails → Run does not reach completed terminal)
- [ ] 14.4 Record recovery path (interrupt mid-body-stage → resume → completes from correct point)
- [ ] 14.5 Capture evidence: revision, RunId, ActionId, actor, evidence refs for all three paths

## 15. Full suite and type safety

- [ ] 15.1 Run `pnpm tsc --noEmit` — zero errors
- [ ] 15.2 Run full test suite — all existing tests green (ECP-1 regression)
- [ ] 15.3 Run `pnpm build` — build succeeds
- [ ] 15.4 Verify CLI reads `dist/` for dogfood (build before CLI tests)
