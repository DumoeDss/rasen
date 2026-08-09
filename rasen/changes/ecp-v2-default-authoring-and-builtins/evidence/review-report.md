# Pre-Landing Review: ecp-v2-default-authoring-and-builtins

- Base: `origin/dev/0.2.0` (`a1306828a23b2c4adc0db81f92b09498a5e92710`)
- Reviewed branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`
- Mode: independent, report-only successor review
- Verdict: **CHANGES REQUIRED**

| Severity | Count |
| --- | ---: |
| Blocker | 0 |
| Major | 5 |
| Minor | 0 |
| Trivial | 0 |

## Findings

### 1. [Major] Authored v2 `Gate` nodes are decorative; runtime gates come from a different contract

**Locations:** `src/core/pipeline-registry/definition.ts:172`, `src/core/pipeline-registry/definition.ts:1391`, `src/core/change-run/internal/lowerer.ts:59`, `src/core/change-run/internal/lowerer.ts:663`, `src/core/change-run/internal/lowerer.ts:754`, `pipelines/bug-fix/pipeline.yaml:89`

`GateNode` types and validates only `outcomes`; it does not model the `target` field authored by the built-ins. The native lowerer then skips every `Gate` node and synthesizes a gate from `AtomicStage.execution.gate`, assigning `${stageId}-gate` and the default decision/outcome policy. Consequently, changing an authored Gate's id, target, or outcomes does not change the runtime plan. The existing native-v2 fixture hides this split authority because its authored Gate id happens to equal the synthesized id.

This contradicts the change's closed typed language and native Gate-lowering requirements. Gate enforcement still exists, so this is not classified as a release-blocking absence of safety, but the authored v2 graph is not the authority it claims to be.

**Required fix:** choose one authoritative contract. Either type, validate, connect, and lower explicit Gate nodes, or remove explicit Gate nodes and document `AtomicStage.execution.gate` as the sole v2 gate construct. Add mutation tests proving that changing/removing the authoritative gate changes or invalidates the runtime plan.

### 2. [Major] Management API projections ignore the real host and can disagree with CLI execution

**Locations:** `src/core/management-api/pipelines.ts:59`, `src/core/management-api/pipelines.ts:364`, `src/core/management-api/pipelines.ts:549`, `src/commands/pipeline.ts:2888`, `src/core/pipeline-registry/types.ts:613`

Both management list and detail projections pass a hard-coded `{ runtime: 'unknown', source: 'unknown' }`, whereas the CLI detects and passes the real host. A read-only reproduction under a Codex host projected the built-in `bug-fix` `propose` stage as `claude` / `legacy-default` / `legacy-fallback` through the management path, but as `codex` / `host` / `native` through the host-aware path.

That violates the design's single prepared execution view and the HTTP API's runtime/config provenance parity: the same prepared pipeline reports materially different execution policy depending on the surface used to inspect it.

**Required fix:** inject or detect the same request-scoped host for management API projections and pass it into the shared projection. Add CLI/API parity tests for both Codex and Claude hosts, including provenance and dispatch mode.

### 3. [Major] Native-v2 selection skips runtime-route and bridge-availability preflight

**Locations:** `src/core/pipeline-registry/prepared-registry.ts:138`, `src/core/pipeline-registry/execution-validation.ts:281`, `src/core/pipeline-registry/execution-validation.ts:336`, `src/core/pipeline-registry/execution-validation.ts:342`, `src/commands/pipeline.ts:945`

`selectForExecution` calls the host-aware execution validator only when the authored version is v1. V2 definitions therefore skip its unsupported-route and required-bridge checks. A read-only reproduction selected native-v2 `bug-fix` on Codex with `planner: claude` and an unavailable Claude probe: selection still returned `resolved`, the probe count remained zero, and the shared view declared `exec-bridge` / `claude-print`.

The v2 projection can therefore identify a required bridge while execution admission fails to verify that the bridge exists. This regresses v1 preflight behavior and leaves CLI execution policy inconsistent with its own shared view.

**Required fix:** preflight the resolved native-v2 policy stages before Run creation, rejecting unsupported routes and probing every required bridge. Cover Codex-to-Claude and Claude-to-Codex unavailable-bridge cases.

### 4. [Major] Built-in ReviewCycle binds its write-capable `fix` phase to a report-only review capability

**Locations:** `pipelines/bug-fix/pipeline.yaml:45`, `pipelines/small-feature/pipeline.yaml:32`, `pipelines/full-feature/pipeline.yaml:32`, `src/core/templates/experts/_shared.ts:49`, `src/core/templates/experts/review.ts:142`, `src/core/pipeline-registry/definition.ts:2580`

All three migrated ReviewCycle bodies pin `review`, `triage`, `fix`, and `re-review` to `skill:rasen-review`. The dispatched `rasen-review` contract explicitly requires report-only behavior and forbids code edits, while the ReviewCycle specification requires the isolated `fix` phase to be write-capable. Remapping the phase's control outcomes to `fixed` does not alter the pinned skill's behavioral contract.

The loop can consequently reach `fix` with a capability that is required not to fix anything; current package/oracle tests verify pins and phase shapes but not capability-semantic compatibility.

**Required fix:** bind `fix` to a write-capable fixer/apply capability, or introduce a versioned phase-aware capability whose dispatched instructions explicitly support the fix role. Validate phase/capability compatibility and add an execution-contract test that demonstrates a fix-phase edit followed by an independent re-review.

### 5. [Major] Built-in GoalLoop binds the authoritative `judge` phase to the student capability that forbids judging

**Locations:** `pipelines/goal-loop-measure/pipeline.yaml:22`, `pipelines/goal-loop-evaluate/pipeline.yaml:22`, `pipelines/goal-loop-research/pipeline.yaml:22`, `src/core/templates/workflows/goal-iterate.ts:15`, `src/core/templates/workflows/goal-iterate.ts:101`, `src/core/pipeline-registry/definition.ts:2594`

Every migrated GoalLoop body pins both `work` and `judge` to `skill:rasen-goal-iterate`. That skill defines itself as the implementer/student and explicitly says not to declare the gate satisfied because a measure command or fresh reviewer owns the authoritative judgment. Relabeling its outcomes for `goalCyclePhase: judge` does not turn it into an independent judge.

This breaks the specified work/judge separation and authoritative-judge invariant even though structural loop tests pass.

**Required fix:** introduce and pin an exact judge/evaluator capability, or define a versioned phase-aware GoalLoop capability with explicit read-only judge semantics. Add tests that assert different work/judge capability contracts and prove only the judge emits the gate result.

## Candidate disposition and verification

- **Malformed v2 decompose child:** cleared. The default helper is permissive for v2 children, but the only product call supplies `loadPrepared`, which fully prepares the child; focused tests cover duplicate ids and disabled capability diagnostics.
- **Bounded-loop strategy contract:** no additional defect found in the invocation/result schema or reconciler decoding during this pass.
- Focused registry/API validation: **70/70 passed** across `execution-validation.test.ts`, `prepared-registry.test.ts`, and `pipelines-api.test.ts`.
- Focused built-in/loop regression matrix: **46/46 passed** across seven built-in audit/runtime/strategy files. These passes demonstrate that the five semantic gaps above are not currently covered by the existing assertions.
- The full repository suite and remote parent-PR CI were not rerun in this successor review.
