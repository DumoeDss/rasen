## Why

ECP-1 proved the deterministic BoundedLoop/ReviewCycle kernel: a built-in composite runs through the reconciler with hierarchical identity, domain results, actor separation, recovery, and cross-plane projection. But the kernel has only ever consumed one composite shape — the 4-phase ReviewCycle — and the Canvas cannot author a composite. ECP-2 closes that gap: a user declares a constrained Custom Composite in the Canvas, embeds it as a `CompositeRef` in a Pipeline, saves, and runs it through the SAME deterministic reconciler as built-ins. This proves the kernel is not a ReviewCycle special case and unblocks GoalLoop (ECP-3) and FanOut/Join (ECP-4), which all depend on the same composite execution contract.

## What Changes

- The lowerer inlines a root-level `CompositeRef` node's declaration body (AtomicStage sub-DAG) into the runtime plan as atomic nodes with hierarchical paths, so the reconciler executes a custom composite through the same atomic admission, workspace lock, finish-guard, and recovery machinery as any root-level stage — no privileged built-in path.
- The runtime plan gains a `composite` body kind alongside the existing `review-cycle` body kind, allowing a `BoundedLoop` to wrap a custom declaration body (AtomicStage DAG + declared outcomes) rather than only the ReviewCycle 4-phase shape. The reconciler's bounded-loop pass calls a generic composite-body progress projector for `composite` bodies and `projectReviewCycleProgress` for `review-cycle` bodies.
- Canvas authoring of a constrained Custom Composite: the user creates a `CompositeDeclaration` (inputs/artifacts/outcomes + body graph), references it from the root via `CompositeRef` or `BoundedLoop`, maps ports between declaration and body, folds/expands the composite for navigation, edits scalar fields (capability, limits, outcomes), and deletes it. `CompositeRef`, `BoundedLoop`, and declarations become editable kinds (ECP-1 made only `AtomicStage`/`Gate`/`Choice`/`Finish` editable; BoundedLoop was view-only with maxRounds configurable).
- Static validation at prepare/lower rejects recursion, nested loop, general cycle, missing exit, illegal port mapping, capability mismatch, and budget/limit overrun for custom-authored shapes. The Definition v2 validators already implement these checks; ECP-2 extends the prepare-time `supportsV2ReviewCycleRuntime` gate into a general `supportsV2ExecutableRuntime` that admits plans with root-level `CompositeRef` nodes and custom `BoundedLoop` bodies, and proves the validators fire correctly on Canvas-authored input.
- A custom Composite and an isomorphic built-in fixture (equivalent stages, same DAG topology) produce the same immutable plan category and run through the same validate/lower/reconcile/persist/project contract — proven by a test fixture pair.
- Export/import round-trip: Canvas save/detail/export then re-import yields an unchanged semantic digest. The existing `semanticCanonicalizeDefinition` already strips `provenance`/`canvas`/`position`/`sourcePath`; ECP-2 asserts digest stability for custom composite definitions.
- The projector emits a `composite/1` section alongside the existing `root-dag/1` (and optional `review-cycle/1`) section, drilling into the composite declaration, body nodes, port mappings, and current outcome from the one `ChangeRunView`.
- Recovery at quiescent boundaries between inlined composite body stages is deterministic — the same plan + Record always produces the same next action. Fault-injection tests cover crash-before-commit and crash-after-commit at composite body stage boundaries.
- A real dogfood: a non-built-in, Canvas-authored Custom Composite completes success, failure, and recovery via the reconciler, recorded with revision, RunId, ActionId, actor, and evidence refs.

## Capabilities

### New Capabilities

- `executable-custom-composite`: The canonical Custom Composite execution vertical — lowerer CompositeRef inlining, runtime plan composite body kind, Canvas authoring (create/reference/fold/expand/edit/delete), static validation for custom-authored shapes, built-in/custom isomorphism, export/import digest stability, composite drill-down projection, and recovery at composite body stage boundaries.

### Modified Capabilities

_(None — the prepare-time gate generalizes from `supportsV2ReviewCycleRuntime` to `supportsV2ExecutableRuntime` as an implementation detail, but no ReviewCycle spec-level requirement changes. The lowerer's ReviewCycle-specific path, runtime behavior, projection, and recovery semantics are preserved unchanged.)_

## Impact

- **Pipeline registry** (`src/core/pipeline-registry/definition.ts`): the `supportsV2ReviewCycleRuntime` gate widens to `supportsV2ExecutableRuntime`, admitting root-level `CompositeRef` and custom `BoundedLoop` bodies.
- **Core runtime** (`src/core/change-run/internal/`): lowerer gains CompositeRef inlining and composite-body BoundedLoop lowering; runtime-plan gains `composite` body kind alongside `review-cycle`; reconciler bounded-loop pass branches on body kind; projector gains `composite/1` section.
- **Canvas** (`packages/ui/src/canvas/`): `V2_EDITABLE_NODE_KINDS` expands to include `CompositeRef` and `BoundedLoop`; V2NodePanel gains declaration editor, port mapping, fold/expand; draft.ts gains declaration CRUD operations.
- **Wire types** (`packages/ui/src/api/types.ts`, `src/core/management-api/wire-types.ts`): no new types — `WireCompositeDeclaration` and `WireCompositeRefNode` already exist; only the Canvas editing surface changes.
- **Tests**: isomorphism fixture pair, export/import round-trip, static validation rejection matrix, composite-body recovery fault injection, cross-plane parity, real dogfood evidence.
