## Context

ECP-1 shipped a deterministic root-DAG + BoundedLoop Change Run spine. The reconciler executes mixed atomic + bounded-loop plans, the lowerer bridges Definition v2 + execution profile to the private runtime plan, the projector emits `root-dag/1` and `review-cycle/1` sections from one `ChangeRunView`, and recovery at quiescent boundaries is deterministic. The ReviewCycle is the only composite shape the kernel has ever consumed: the lowerer's `reviewCycleBody()` hard-codes the 4-phase ReviewCycle body check, `validateBoundedLoop()` in `runtime-plan.ts` accepts only `body.kind === 'review-cycle'`, and the reconciler's bounded-loop pass calls `projectReviewCycleProgress()` unconditionally.

The Canvas can view a BoundedLoop and configure `maxRounds`, but cannot author a composite: `V2_EDITABLE_NODE_KINDS` excludes `CompositeRef` and `BoundedLoop` from shape editing, and there is no UI for creating or editing a `CompositeDeclaration`. A user cannot declare a custom composite body, reference it, or map ports between declaration and body.

## Goals / Non-Goals

**Goals:**
- A root-level `CompositeRef` node is lowered into the runtime plan by inlining its declaration's AtomicStage body as atomic nodes with hierarchical paths — the reconciler executes them through the same admission, workspace lock, finish-guard, and recovery machinery.
- A `BoundedLoop` whose body declaration is NOT the ReviewCycle 4-phase shape is lowered and executed through a generic composite-body lifecycle (body DAG executes in topological order each iteration; declared outcomes map to loop exits).
- Canvas authors a constrained Custom Composite: create declaration, reference from root, fold/expand, edit scalars, delete — with port mapping between declaration contract and body graph.
- Static validation at prepare/lower rejects recursion, nested loop, general cycle, missing exit, illegal port mapping, capability mismatch, and budget/limit overrun for custom-authored shapes — using the existing Definition v2 validators.
- A custom Composite and an isomorphic built-in fixture produce the same immutable plan category and pass through the same validate/lower/reconcile/persist/project contract.
- Export/import round-trip yields an unchanged semantic digest.
- The projector emits a `composite/1` drill-down section from the one `ChangeRunView`.
- Recovery at quiescent boundaries between inlined composite body stages is deterministic.
- A real dogfood completes success, failure, and recovery via the reconciler.

**Non-Goals:**
- GoalLoop (ECP-3).
- Choice/FanOut/Join/full-feature parallel (ECP-4).
- Product closure / release (ECP-5).
- Recursive Composite call, nested loop, user-provided executable code, arbitrary scripting.
- Modifying ReviewCycle domain semantics (review-cycle.ts reducer, actor separation, ship guard).
- Auto-decompose / Issue dispatch.
- Custom capability packaging, versioning, or trusted catalog distribution.

## Decisions

### D1: CompositeRef lowering — inline declaration body as atomic nodes

The lowerer (`lowerV2ReviewCyclePlanInput` in `lowerer.ts`) gains a branch for root-level `CompositeRef` nodes. For each `CompositeRef` at root scope, the lowerer:

1. Resolves the referenced `CompositeDeclaration` from `definition.declarations`.
2. Validates that the declaration's body graph contains only `AtomicStage` nodes (no nested `CompositeRef`, `BoundedLoop`, `Choice`, `FanOut`, `Join`). The Definition v2 validators already reject recursion, nested loop, and cycles; this is an additional lower-time guard that the body is a flat AtomicStage DAG.
3. Inlines each body AtomicStage as a runtime plan atomic node with:
   - `hierarchicalPath`: `root:<composite-ref-node-id>/<body-stage-id>`
   - `requires`: translated from body-internal connection `from.node` IDs to the same hierarchical path prefix, plus the CompositeRef's own root-level `requires` mapped to the body's entry stages (stages with no incoming body-internal connections).
   - `admissionKind`, `workspace`, `gate`: from the frozen execution profile at path `declaration:<declaration-id>/node:<body-stage-id>`.
4. The CompositeRef node itself does NOT appear as a runtime plan node — it is dissolved into its inlined children, exactly as a built-in v1 stage normalizes to a v2 AtomicStage. The succeeded-set logic in the reconciler needs no change: when all inlined body stages succeed, the CompositeRef's root-level dependents see their `requires` satisfied because the dependents' `requires` references the CompositeRef's root path, which the lowerer maps to the last body stage's path.

**Entry/exit mapping:** The CompositeRef's root-level incoming connections (from other root nodes to the CompositeRef) determine which body stages are "entry" stages (body stages with no incoming body-internal connections inherit the CompositeRef's root-level `requires`). The CompositeRef's root-level outgoing connections determine the "exit" — the body's terminal stages (stages whose declared outcomes are not consumed by another body stage) produce the control-flow signal that satisfies the CompositeRef's root-level dependents. The lowerer translates this by making the body's terminal stages the dependency for the CompositeRef's root-level dependents.

**Alternative considered:** Represent the CompositeRef as a pseudo-node in the runtime plan with its own admission/reconciliation logic. Rejected because it would require a second reconciliation pass, breaking the single-pass atomic succeeded-set invariant. Inlining preserves the single-pass topology.

### D2: Runtime plan composite body kind — general BoundedLoop body

The runtime plan types (`runtime-plan.ts`) gain a `RuntimePlanCompositeBody` alongside the existing `RuntimePlanReviewCycleBody`:

```
RuntimePlanCompositeBody = {
  kind: 'composite',
  declarationId: string,
  stages: readonly RuntimePlanCompositeStage[],
  outcomes: Readonly<Record<string, string>>,  // body outcome → loop exit outcome
}

RuntimePlanCompositeStage = {
  nodeId: NodeId,
  hierarchicalPath: string,
  profilePath: string,
  admissionKind: RuntimePlanAdmissionKind,
  workspace: RuntimePlanWorkspace,
  requires: readonly NodeId[],  // body-internal dependencies
}
```

The `RuntimePlanBoundedLoopNode.body` union widens to `RuntimePlanReviewCycleBody | RuntimePlanCompositeBody`. The `validateBoundedLoop()` function in `createRuntimePlan()` gains a branch for `body.kind === 'composite'` that validates:
- At least one stage exists.
- All `hierarchicalPath` values are unique and well-formed.
- Body-internal `requires` form a DAG (acyclic).
- Declared `outcomes` keys are non-empty.

The lowerer produces a composite body for a `BoundedLoop` whose declaration is NOT ReviewCycle-shaped (i.e., the declaration lacks the 4 `reviewCyclePhase`-tagged AtomicStages). For ReviewCycle-shaped declarations, the existing `review-cycle` body kind path is preserved unchanged.

**Alternative considered:** Unify all bounded-loop bodies into a single generic shape and project ReviewCycle as a specialization. Rejected for this slice because it would change the ReviewCycle runtime path that ECP-1 proved, violating "build on ECP-1's kernel; do not redo it." The composite body is an additive sibling.

### D3: Composite-body progress projection

A new pure function `projectCompositeBodyProgress(plan, loop, record)` in a new `composite-runtime.ts` (parallel to `review-cycle-runtime.ts`) determines the current state of a composite-body bounded loop:

1. For each iteration (1..maxIterations), for each body stage in topological order, check whether a committed succeeded action exists for that stage's nodeId.
2. If all body stages in an iteration have succeeded results, the iteration's outcome is derived from the body's Finish node or the terminal stages' declared outcomes (the body's terminal outcome that was produced).
3. The loop's exit mapping determines whether the outcome maps to `exit` (loop terminates) or `continue` (loop proceeds to next iteration).
4. If the outcome maps to an exit, the loop is terminal with that exit's outcome string.
5. If maxIterations is reached without an exit outcome, the loop is exhausted.
6. If body stages remain unexecuted in the current iteration, the next ready stage (topologically earliest with satisfied dependencies) is the admit candidate.

This function is pure: it reads only the frozen plan and committed Record, just like `projectReviewCycleProgress`.

The reconciler's bounded-loop pass (`reconcile()` in `reconciler.ts`) branches on `loop.body.kind`:
- `'review-cycle'`: calls `projectReviewCycleProgress` (unchanged).
- `'composite'`: calls `projectCompositeBodyProgress`.

Both map to the same `ReviewCycleProgress`-like result shape (`ready | waiting | failed | clean | exhausted`) so the reconciler's succeeded-set, admit-candidate, and escalate logic is shared.

### D4: Prepare-time gate generalization

The `supportsV2ReviewCycleRuntime(definition)` function in `definition.ts` is renamed and generalized to `supportsV2ExecutableRuntime(definition)`. It admits a plan as reconciler-executable when:

1. All root nodes are `AtomicStage`, `Gate`, `Choice`, `Finish`, `CompositeRef`, or `BoundedLoop` (same as before plus `CompositeRef`).
2. Every `CompositeRef` root node references a declaration whose body graph contains only `AtomicStage` nodes (flat DAG — no nested `CompositeRef`, `BoundedLoop`, `Choice`, `FanOut`, `Join`).
3. Every `BoundedLoop` root node either:
   a. Has a ReviewCycle-shaped body (the existing check), OR
   b. Has a declaration body containing only `AtomicStage` nodes (composite body kind).
4. At least one root node is a `CompositeRef` or `BoundedLoop` (the gate must not admit a pure atomic plan that the v1 path already handles — though this is an efficiency concern, not a correctness one).

The Definition v2 static validators (`validateIdentitiesAndReferences`, `validateGraphCycles`, `validateCompositeRecursion`, `validateLoopsAndLimits`, `validateCapabilities`, `validateTypedPorts`, `validateOwnerTerminalOutcomes`) are unchanged — they already validate custom-authored shapes correctly because they operate on the general Definition v2 type system, not on ReviewCycle-specific assumptions.

### D5: Canvas authoring — extend editable kinds and declaration editor

The Canvas changes in `packages/ui/src/canvas/`:

1. **`V2_EDITABLE_NODE_KINDS`** (in `draft.ts`) expands to include `CompositeRef` and `BoundedLoop`. This makes them full editing citizens: the Canvas can create, select, patch, rename, connect, and delete them.

2. **V2NodePanel** (in `V2NodePanel.tsx`) gains:
   - **CompositeRef panel**: shows the referenced declaration id (editable via dropdown of available declarations), the declaration's inputs/artifacts/outcomes (read-only summary), and a "Open declaration editor" affordance.
   - **BoundedLoop panel (extended)**: the existing ReviewCycle maxRounds editor is preserved. For non-ReviewCycle bodies, shows the body declaration's stages (read-only list), the exit mapping (editable: outcome → continue/exit), and maxIterations.
   - **Declaration editor** (new sub-panel or section): when the user creates or opens a declaration, shows inputs (name/type/required), artifacts (name/type), outcomes (list), and the body graph (nodes + connections). The body graph editing is constrained: only `AtomicStage` nodes may be added to a custom declaration body (no nested `CompositeRef`, `BoundedLoop`, `Choice`, `FanOut`, `Join` — enforced by the palette and connection guards).

3. **Draft operations** (in `draft.ts`): new functions `addDeclaration`, `updateDeclaration`, `removeDeclaration`, `addBodyStage`, `removeBodyStage`, `updateBodyStage`, `addBodyConnection`, `removeBodyConnection`. These operate on the `WirePipelineDefinitionV2.declarations` array.

4. **Fold/expand**: the layout (`layout.ts`) renders a `CompositeRef` node with a fold/expand toggle. Folded shows a single card with the declaration name and outcome ports. Expanded shows the body stages inline (read-only sub-graph) within the composite's bounding box. This is a visual projection of the same Definition — no second graph state.

5. **Port mapping**: when a CompositeRef is selected, the panel shows the mapping between root-level connection ports and the declaration's declared inputs/artifacts/outcomes. The Canvas's connection guard validates that connections match the declaration's port contract (the server-side `validateTypedPorts` already checks this; the Canvas mirrors the check for immediate feedback).

**Alternative considered:** Allow full body graph editing (add/remove/reorder body stages, nested CompositeRef). Rejected for this slice because the constrained body (AtomicStage-only flat DAG) is sufficient to prove the isomorphism and execution parity. Full body authoring with nested composites is a future enhancement.

### D6: Projection — composite drill-down section

The projector (`projector.ts`) emits a new `composite/1` section when the plan contains an inlined composite (from CompositeRef or composite-body BoundedLoop). The section is derived from the Record by iterating the inlined body nodeIds and reading their committed action state:

```
{
  kind: 'composite',
  version: 1,
  compositePath: string,       // root-level path of the CompositeRef or BoundedLoop
  declarationId: string,
  stages: [{
    path: string,              // hierarchical path
    status: 'pending' | 'active' | 'succeeded' | 'failed',
    capability?: { id, version },
    actor?: ActorRef,
  }],
  outcome: string | undefined,  // current body outcome (if terminal)
  ...(loop ? { round, maxIterations, loopOutcome } : {}),
}
```

This section is additive alongside `root-dag/1` and `review-cycle/1`. CLI, Management API, and Operations all consume the same `ChangeRunView`.

### D7: Isomorphism — test fixture pair

The isomorphism test proves that a custom CompositeRef and an equivalent root-level AtomicStage DAG produce the same runtime plan structure (same node kinds, same topological order, same dependency relationships) and run through the same validate/lower/reconcile/persist/project contract.

The fixture pair:
1. **Built-in fixture**: a v1 pipeline `test-linear` with 3 stages (propose → apply → ship), normalized to v2 root-level AtomicStages.
2. **Custom fixture**: a v2 definition with a `CompositeDeclaration` containing the same 3 AtomicStages, referenced from root via `CompositeRef`.

Both fixtures produce a runtime plan with 3 atomic nodes (plus implicit finish). The test asserts:
- Same plan structure (atomic nodes, same dependency graph).
- Same reconcile() output for the same Record state.
- Same projection structure (root-dag section with same frontier/actions).
- Export/import round-trip preserves the semantic digest for both.

### D8: Export/import round-trip — digest stability

The existing `semanticCanonicalizeDefinition` (in `definition-plan-internal.ts`) strips `provenance`, `canvas`, `position`, `sourcePath` and sorts all keys recursively. ECP-2 asserts that a custom composite definition survives Canvas save → detail → export → re-import with unchanged semantic digest. The test:

1. Author a custom composite definition in the Canvas (or construct a `WirePipelineDefinitionV2` with a custom declaration).
2. Save → read back the prepared definition → compute `semanticCanonicalizeDefinition(definition)`.
3. Export → re-import → re-prepare → compute the same canonical form.
4. Assert the two canonical forms are deep-equal (digest unchanged).

No change to `semanticCanonicalizeDefinition` itself — the test proves it works for custom-authored shapes.

### D9: Recovery — composite body stage boundaries

Recovery at quiescent boundaries between inlined composite body stages is deterministic — it is an inherent property of the kernel. The same plan + Record always produces the same next action, regardless of whether the action is a root-level AtomicStage or an inlined composite body stage. Fault-injection tests cover:

- **Crash before commit** at a composite body stage: the completion was never committed → the action stays active → resume re-admits nothing.
- **Crash after commit** at a composite body stage: the completion was committed → resume calls `reconcile()` which sees the succeeded result and admits the next body stage.
- **Crash mid-composite** (between body stages): the completed body stages are in the succeeded set → the next body stage is admitted → the composite continues from the correct point.

These mirror the ECP-1 ReviewCycle recovery tests but for composite body stages.

## Risks / Trade-offs

- **[Lowerer complexity]** CompositeRef inlining adds a new branch to the lowerer, increasing its branch count. → Mitigation: the inlining logic is a separate function from the ReviewCycle body logic; both are pure and independently testable. The lowerer's single-pass invariant is preserved — inlined nodes are atomic nodes with hierarchical paths.

- **[Runtime plan type widening]** Adding `RuntimePlanCompositeBody` to the bounded-loop body union widens the type. → Mitigation: the union is exhaustive in the reconciler's `switch (loop.body.kind)` branch; the `review-cycle` path is unchanged. The `composite` path is an additive sibling with its own pure projector.

- **[Canvas authoring scope]** Allowing users to create custom declarations introduces a new authoring surface that could produce invalid definitions. → Mitigation: the Definition v2 validators already reject all illegal shapes (recursion, nested loop, cycle, port mismatch, capability mismatch). The Canvas mirrors the server-side checks for immediate feedback. The constrained body (AtomicStage-only) limits the complexity of user-authored shapes.

- **[Isomorphism proof strength]** The isomorphism test uses a simple linear fixture, which may not exercise all composite execution paths. → Mitigation: the test proves the contract equivalence (validate/lower/reconcile/persist/project), not the behavioral equivalence of arbitrary composites. The real dogfood exercises a non-trivial custom composite with success, failure, and recovery.
