## Context

The executable kernel now prepares both authored v1 and v2 into one immutable v2 semantic definition, lowers ReviewCycle, GoalLoop, Choice, FanOut/Join, Gate, Finish, and bounded Composite bodies, and projects canonical Runs. The prerequisite `ecp-shared-bounded-loop-lifecycle` also made a complete `lifecycle.version: 1` policy mandatory on authored v2 loops and independently closed strategy failure/resume accounting plus truthful research report-tail completion.

The remaining authoring split is observable in production:

- `scaffoldPipeline()` writes `PIPELINE_DEFINITION_VERSION`, which is still the v1 constant and emits a flat `stages` document.
- the fresh Canvas and not-found recovery paths seed `{ version: 1, stages: [] }`;
- all seven package manifests are authored v1, although six Change-level pipelines prepare as reconciler-executable plans;
- `pipeline show` returns early for authored v2 and prints raw JSON, while Management inventory/detail returns `stages: []`; v1 receives a build order, effective stage policy, localized text, bounded-loop detail, and engine selection;
- v2 capability bindings are exact, but policy stages are synthesized with review-oriented placeholders, so an authored role, gate, verification policy, and workspace intent cannot be shown or frozen faithfully;
- the v1 normalizer leaves `legacyRuntimeOwner: prompt-owned-v1` markers in its semantic projection. Merely changing `version` in package YAML would therefore lose execution policy or preserve v1 compatibility payloads as an accidental second language.

The Change must preserve registry precedence, config overrides, trusted capability admission, exact digest behavior, cross-platform package safety, one reconciler owner, and the shared lifecycle contract. It follows the serial portfolio boundary: blank-v2 defaulting belongs here, full Canvas editing belongs to child 3, and end-to-end vertical dogfood belongs to child 4.

## Goals / Non-Goals

**Goals:**

- Make v2 the only newly authored public default while retaining v1 read/prepare/save compatibility.
- Give AtomicStage and supported built-in orchestration nodes enough closed execution metadata for faithful capability binding, policy resolution, lowering, inspection, and configuration overrides.
- Reauthor exactly six Change-level package built-ins as native v2 without `legacy` or `legacyRuntimeOwner` payloads.
- Seal explicit shared lifecycle policies and exact strategy capability bindings into every built-in bounded loop.
- Make CLI, registry, Management API, save/export, and blank-definition consumers agree on one authored definition and one execution view.
- Preserve semantic and package digest determinism on Windows, Linux, and macOS.
- Keep `auto-decompose` visibly and deliberately v1 for the 0.3.0 Issue/Dispatch boundary.

**Non-Goals:**

- Canvas panels or gestures for CompositeRef, BoundedLoop lifecycle, Choice, FanOut/Join, Gate, Finish, declarations, typed outcomes, or capability selection; child 3 owns that parity.
- The final blank-Canvas-to-Run success/resume/fail-closed proof; child 4 owns it.
- Session process execution, worker reuse enforcement, real handoff/reuse limits, or agent lifecycle; ECP-7 owns them.
- Decompose lowering, Issue Execution Plan, Dispatch, portfolio scheduling, multi-Change execution, or migration of `auto-decompose`.
- Nested loops, recursive Composite calls, arbitrary script nodes, remote runtimes, or release closure.

## Decisions

### D1: One canonical v2 blank factory and serializer define new authoring

Add a public core `createBlankPipelineDefinitionV2(name, source)` factory that returns a valid, intentionally empty envelope with stable `id`, `sourceId`, empty typed contracts/declarations, and an empty root graph. `pipeline init` uses it and the Management/UI blank-draft contract mirrors its exact fields. The UI keeps a browser-safe mirror, but a shared fixture and parity test pin it to the core factory so the two packages cannot silently diverge. Child 3 may extend the draft through editing operations; it does not change the seed contract.

Replace the v1-only scaffold serialization path with one `serializeAuthoredPipelineDefinition(preparedOrV2)` seam used by init, save, export, and package staging. V2 serialization canonicalizes object keys and all semantically unordered identity sets with the same comparison rules used by preparation, normalizes line endings to LF, writes UTF-8 with a final newline, and never serializes a normalized v1 definition as if it had been authored at v2. Preparing serialized v2 must reproduce the same source, capability, and plan digests.

Alternative considered: keep `PIPELINE_DEFINITION_VERSION = 1` and change only the emitted number. Rejected because the v1 scaffold body is not a valid v2 envelope and because version-only migration does not establish serializer/digest parity.

### D2: AtomicStage carries a closed execution declaration separate from capability identity

Extend authored v2 AtomicStage with a versioned execution object:

```ts
interface AtomicStageExecutionV1 {
  version: 1;
  role: StageRole;
  workspace: { access: 'none' | 'read' | 'write' };
  leadReview?: boolean;
  verifyPolicy?: VerifyPolicy;
  runtime?: AgentRuntime;
  model?: string;
  effort?: string;
  sandbox?: string;
  sessionReuse?: 'none' | 'stage' | 'run-planner' | 'review-thread';
  handoff?: StageHandoff;
}
```

The exact field types reuse existing registry schemas and constants. Capability `{id, version}` continues to state what may run; `execution` states how this node participates in a Change Run. A `Gate` node separately names one AtomicStage `target`, a closed set of decision `outcomes`, and an exact outcome-to-`proceed | fail | escalate` disposition map. That Gate node is the sole authored gate authority: `execution.gate` is rejected rather than retained as a second source. Preparation validates the full objects and includes them in source/plan meaning. The profile resolver combines Gate presence with the existing stage-instance/project/store/global override chain, stamps accurate provenance, and preserves `sessionReuseAuthored`; it does not choose or enforce the Session-layer limits deferred to ECP-7.

Workspace access is explicit rather than inferred from role. Review and judge nodes normally author `read`, fix/work/ship/archive author `write`, and evaluator nodes remain definitionally `none`. This prevents a role rename from changing locking/effect semantics.

Alternative considered: keep synthesizing all v2 policies from node shape. Rejected because current synthesis labels root stages as review-oriented defaults, drops gates and adaptive verification, and cannot produce a truthful execution view.

### D3: Built-in capability versions are immutable pins, not a floating alias

Every v2 built-in AtomicStage and lifecycle strategy names the exact trusted catalog descriptor version (the installed workflow content digest). ReviewCycle fix phases pin the internal write-capable `rasen-review-fix`; GoalLoop judge phases pin the internal read-only `rasen-goal-judge`. Capability descriptors advertise closed phase contracts, and preparation rejects a phase whose capability, role, or workspace access is incompatible. The six manifests therefore freeze the capabilities whose adapters and result/evidence contracts the plan uses. A named build/test helper verifies the explicit built-in manifest list against the package capability catalog and fails with the node path when a bundled skill changes without updating its pin.

Effective workflow installation and execution enablement close transitively over capability owners reached through every selected workflow's `requires.pipelines`, including Composite declaration bodies, bounded-loop strategies, conditional members, tails, and v1 decompose children. These dependency-only units may be installed without becoming selectable profile roots. The selectable built-in upgrade baseline excludes every id in `INTERNAL_BUILTIN_WORKFLOW_IDS` generically.

No `latest`, `installed`, wildcard, or self-authored descriptor is introduced. Updating a bundled skill and its built-in pin is one reviewed semantic change and changes the capability and plan digests as expected.

Alternative considered: resolve a symbolic `package-current` token during preparation. Rejected because the same authored bytes could compile to different capabilities without an explicit source revision.

### D4: One prepared execution view serves registry, CLI, API, and launch policy

Introduce a pure `projectPreparedPipelineExecutionView(prepared, catalog, overrides)` boundary. It topologically projects logical node/stage identity, requirements, capability, role, workspace access, Gate-node/effective gate, verification policy, runtime/model/handoff provenance, loop policy, and engine support. V1 feeds the boundary through its compatibility adapter; v2 feeds it directly from its execution declarations, Gate targets, and frozen capability bindings.

`pipeline list/show --json`, localized `show`, Management inventory/detail, and launch profile construction consume this projection. V2 no longer returns early as raw JSON or exposes an empty `stages` array. The full authored v2 definition and preparation digests remain available beside the execution view, and the opaque runtime plan stays private. Root and declaration paths remain distinct; configuration keys for migrated root stages retain the public logical ids (`propose`, `apply`, and so on).

Alternative considered: teach each product surface to walk the v2 graph. Rejected because that recreates multiple build-order, policy, and capability interpretations.

### D5: The six manifests are authored from an explicit semantic matrix

Define one constant list, not a directory glob:

```text
bug-fix
small-feature
full-feature
goal-loop-measure
goal-loop-evaluate
goal-loop-research
```

Each manifest becomes a complete Definition v2 document with stable source identity, typed root outcomes, exact capabilities, execution declarations, explicit targeted Gate/Choice/FanOut/Join/Finish nodes where applicable, and built-in Composite declarations for ReviewCycle or GoalLoop bodies. Review fix and goal judge are separate phase-compatible capabilities, not role-swapped uses of a generic prompt. Normalized v1 output is used only as a comparison oracle during migration; no `legacy`, `legacyStageId`, or `legacyRuntimeOwner` field is copied into authored v2.

The matrix preserves:

- `bug-fix`: propose -> apply -> adaptive ReviewCycle -> ship -> archive;
- `small-feature`: propose -> apply -> standard verify -> ReviewCycle -> ship -> archive;
- `full-feature`: office-hours/propose/apply, conditional expert FanOut/Join, ReviewCycle, ship/retain/archive, required/optional membership and existing concurrency/budget behavior;
- measure/evaluate: define-goal -> typed goal loop -> ship/retain/archive;
- research: define-goal -> typed research loop -> report-only tail.

The lowerer recognizes these shapes from typed v2 declarations, not pipeline names or v1 `legacy.loop` payloads. `goalCycleVariant`, FanOut membership/limits/join target, Join membership/outcomes, and ReviewCycle/GoalLoop phase tags become validated authored fields because native built-ins rely on them.

Alternative considered: generate v2 manifests at runtime from v1. Rejected because it would keep v1 as the authored product truth and preserve the warning/default split this Change is closing.

### D6: Built-in lifecycle policies are explicit and domain-specific

Every ReviewCycle/GoalLoop manifest authors all loop-local limits, lifecycle thresholds, trigger dispositions, strategy budget, and exact strategy capability.

- Review loops and measure/evaluate goal loops may route iteration-limit and stall triggers to one bounded strategy attempt; blocked routes to `human-required`; action/budget and exhausted strategy remain explicit non-success terminal dispositions.
- Review strategy binds the package `rasen-review-cycle` capability; Goal strategy binds `rasen-goal-iterate`. Their prompts/contracts must be verified to consume the closed strategy invocation and produce `bounded-loop/strategy-result/1`; if they do not, the implementer must update the capability contract before a manifest can reference it.
- Ordinary ReviewCycle fixes bind `rasen-review-fix` with write access, while the independent re-review remains `rasen-review` with read access. Ordinary GoalLoop judgments bind `rasen-goal-judge` with read access and an actor distinct from the work Action author.
- Research keeps domain satisfaction distinct from reporting. Normal iteration exhaustion exits with `max-rounds-exhausted` so the authored report tail can run truthfully; a strategy path may be used for stall recovery, and its exhausted disposition remains a non-success reportable exit. Safety/action/budget failures do not masquerade as a successful report.

The prerequisite's canonical occurrence-aware strategy accounting and narrow research-tail guard are invariants; this Change only authors policies that consume them.

Alternative considered: author `maxAttempts: 0` everywhere to preserve compatibility-normalized behavior. Rejected because the Direction contract requires explicit frozen strategy bindings after the shared lifecycle lands and because a zero strategy ladder would leave the newly delivered public contract unused by its own built-ins.

### D7: `auto-decompose` is an explicit compatibility fixture outside the migration set

`pipelines/auto-decompose/pipeline.yaml` remains byte-identical v1. A separate named `PIPELINE_V1_COMPATIBILITY_FIXTURES` registry entry labels it `issue-dispatch-0.3.0`; list/show/API expose that boundary alongside the ordinary v1 compatibility warning. Tests compare its bytes to the pre-Change fixture and prove it is absent from the six-item migration list.

This preserves current `$rasen-auto auto-decompose` portfolio orchestration without pretending a Change-level reconciler owns multi-Change planning.

Alternative considered: reauthor only the post-decompose tail in v2. Rejected because one manifest would then mix two execution owners and obscure which Record owns the portfolio.

### D8: Verification is semantic-matrix first

Verification proceeds in this order:

1. Blank-v2 factory, schema, canonical serializer, cross-platform line/path handling, and digest invariance.
2. Execution declaration and targeted Gate validation through all three reconciler terminal dispositions, phase-capability compatibility, pipeline-derived install/enablement closure, capability pin failures, override/provenance resolution, host-aware route/bridge preflight, and shared execution-view parity.
3. One table over the explicit six built-ins covering authored version, forbidden legacy fields, capability pins, nodes/declarations, build order, loop policy, engine support, and immutable plan decode.
4. Pairwise semantic comparisons against the pre-migration v1 prepared plans for public stage order, gates, roles, verification policy, parallel membership, goal variants, and tails; digest equality is not required because authored meaning intentionally changes.
5. Focused real reconciler journeys for each built-in shape, with full restart/dogfood deferred only where child 4 explicitly owns the final vertical proof.
6. CLI/API/init/save/export/package/Canvas-blank projection parity, exact v1 compatibility coverage, and `auto-decompose` byte/exclusion checks.

## Risks / Trade-offs

- **[Capability pins churn when bundled skills change]** -> Make mismatch a path-addressed build failure and update manifest plus expected digests in the same reviewed change.
- **[Execution metadata accidentally designs ECP-7]** -> Limit it to already-recorded policy facts and authored reuse intent; do not choose or enforce handoff/reuse limits or worker behavior.
- **[Native v2 built-ins diverge from familiar stage configuration keys]** -> Preserve logical ids and run all project/store/global override precedence tests against v1 and v2 views.
- **[Research non-success tail is presented as success]** -> Assert goal satisfaction, lifecycle outcome, report eligibility, and final Record outcome independently.
- **[Blank v2 draft is valid but visually empty until child 3]** -> Keep the seed minimal and truthful; do not add hidden nodes or silently fall back to v1.
- **[Full-feature migration exposes lowerer assumptions previously hidden by v1 normalization]** -> Add failure-first typed FanOut/Join metadata validation and plan-shape tests before changing the manifest.
- **[Large fixture churn hides a version-only migration]** -> Reject authored legacy markers, compare semantic matrices, and inspect the lowered execution view for every built-in.

## Migration Plan

1. Land the blank factory, canonical serializer, execution declaration schema, and shared execution-view projection while all package manifests remain v1.
2. Make profile resolution/lowering consume native v2 execution declarations and close typed Goal/FanOut/Join metadata gaps behind focused fixtures.
3. Migrate ReviewCycle built-ins, then GoalLoop built-ins, then `full-feature`, running the semantic matrix after each group.
4. Switch CLI init and Canvas empty-draft seeds to v2, update save/export/package/detail/list/show projections, and retain v1 compatibility tests.
5. Assert the six-item migration list, `auto-decompose` fixture bytes/label, strict Change validation, and all affected root/UI suites.

Rollback keeps the new v2 read/serializer/view contracts but can restore the six manifest files and blank seeds to v1. Already saved authored v2 user definitions remain readable and executable; no Run or user source is rewritten in place.

## Open Questions

None block planning. The implementer must verify the exact current capability digests and the two strategy skills' advertised invocation/result compatibility immediately before editing manifests; those values are repository facts deliberately captured by failing tests rather than guessed in this design.
