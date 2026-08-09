## Context

Rasen's ordinary autonomous path is spec-driven: even `small-feature` creates proposal, design/spec, and task artifacts before implementation. The existing `goal-loop-evaluate` Pipeline has the right two-phase execution shape—work followed by an independently staffed judgment—but its `define-goal` stage writes `goal-plan.md`, its `rasen-goal-iterate` skill assumes that file, and its delivery tail includes retention. Reusing that Pipeline directly would therefore violate the requested separate, spec-free lifecycle.

The canonical Change Run runtime already supplies most of the deep mechanism needed here. `CanonicalRunRecord.inputs` is immutable persisted JSON, a goal loop lowers to a two-phase bounded loop, the profile resolver separates implementer and reviewer bindings, GoalCycle rejects a worker judging its own round, the reconciler deterministically reconstructs the next action, and only a satisfied GoalCycle can complete. However, the current CLI does not thread launch inputs into the Run, hashes only a launch-key string, the v1 goal-loop lowerer hard-codes `rasen-goal-iterate`, and the generic evaluate result does not prove that a judgment covers the frozen task bar or comes from a new critic on every round.

The built-in Pipeline remains backed by a lightweight Change identity so existing Run storage, evidence, resume, delivery, and archive mechanisms remain available. That technical container is not a spec lifecycle: a task-loop run never creates or later upgrades to proposal, design, delta-spec, tasks, or goal-plan artifacts.

## Goals / Non-Goals

**Goals:**

- Add one built-in `task-loop` Pipeline selected explicitly through `rasen-auto` and no new public command.
- Freeze a directly inspectable task contract before round one and preserve it unchanged through resume.
- Run role-separated builder and fresh-critic phases against real artifacts and raw evidence.
- Reuse Canonical Run, GoalCycle, Reconciler, profile resolution, ship, and archive rather than duplicating their state machines.
- Make `satisfied` the only delivery-enabling outcome and surface exhaustion, blockage, cancellation, and launch conflicts honestly.
- Keep registry, workflow installation, generated skills, localization, and Windows behavior in parity with existing built-ins.

**Non-Goals:**

- Adding `rasen loop`, a user-invokable `rasen-task-loop` command, or a second general-purpose orchestration entry.
- Classifying tasks into `task-loop`, auto-escalating into it, or falling back/converting from it to any spec-driven Pipeline.
- Replacing the general goal-loop Pipelines or changing their goal-plan contract.
- Building a new generic TaskCycle engine or a family of quality-bar adapters in v1.
- Adding retention, roadmap/direction, decomposition, proposal review, or spec verification stages to `task-loop`.
- Treating `--no-gate` as permission to bypass safety, workspace, evidence, delivery, or terminal-outcome guards.

## Decisions

### 1. Design-it-twice comparison selects a deep TaskLoop Module over both direct reuse and a new engine

Three architectures were compared:

| Design | Module / Interface shape | Advantages | Rejection or selection rationale |
|---|---|---|---|
| Minimal reuse | Reuse `goal-loop-evaluate`, `goal-plan.md`, `rasen-goal-iterate`, and the existing tail | Lowest initial source change | Rejected: creates a planning artifact and planner gate, assumes spec-like context, adds retention, and makes the allegedly separate loop a configured form of the goal workflow. |
| Default-caller optimized | Add a deep internal TaskLoop Module for task contract/judgment rules; pass canonical inputs through the existing GoalCycle/Reconciler Interface; add a task-specific internal workflow | One public selector; strong Depth and Leverage; task semantics remain local while mature scheduling, actor binding, replay, and delivery are reused | **Selected.** It is the smallest architecture that mechanically meets every invariant. |
| Flexible engine | Add a separate TaskCycle state machine plus `BarAdapter`, `ArtifactAdapter`, and judge-strategy Interfaces | Could support future measured, comparative, visual, or remote variants independently | Rejected for v1: duplicates bounded-loop state, plan lowering, projection, resume, and terminal logic; the adapter seams are hypothetical and increase caller and test surface before a second real implementation exists. |

The selected Module owns a compact task-specific contract and validation policy. Its public-in-process Interface consists of functions equivalent to `decodeTaskLoopInput`, `taskLoopActionInput`, `validateTaskLoopCompletion`, and `assertTaskLoopMayDeliver`. Its Implementation delegates phase sequencing and event reduction to GoalCycle. This gives the default caller one simple route while keeping policy out of the generic engine.

### 2. Freeze the quality contract in canonical launch inputs, not a repository planning artifact

The `rasen-auto` LEAD derives the task contract before starting the Run and supplies it under `inputs.taskLoop`:

```json
{
  "format": "task-loop-input/1",
  "goal": "the observable result to produce",
  "artifactTargets": ["workspace-relative path, URL, or named runtime target"],
  "bar": [
    {
      "id": "portable-stable-id",
      "criterion": "a directly checkable pass condition",
      "evidenceHint": "the file, command, render, measurement, or comparison that proves it"
    }
  ],
  "constraints": ["scope, platform, safety, or format constraint"]
}
```

The decoder requires a non-empty goal, at least one target, a non-empty bar, unique bounded criterion IDs, and non-empty criterion/evidence descriptions. Local targets are resolved against the project root with Node's path APIs and must remain inside the authorized workspace; URL/runtime targets stay opaque to the core and are inspected by the assigned tools. The contract is stored in `CanonicalRunRecord.inputs`, participates in `digestLaunchIntent`, and is exposed as a redacted/structured status section. It is never reconstructed from prose on resume.

The auto driver uses a bounded UTF-8 JSON file in the resolved ephemera directory to bridge this input to the existing `rasen pipeline start` command through a hidden internal option. This avoids shell quoting and command-length hazards on Windows without creating a new command or an authoritative planning artifact. `pipeline start` parses and validates the JSON before binding or admitting work, passes the same canonical value to the runtime context and start request, and removes no user-authored file.

If the deterministic Run already exists, the facade compares the requested launch-intent digest with the persisted `launchRequestDigest`. Equal input is an idempotent reuse; different Pipeline or task input fails with `launch_request_conflict`. Thus Pipeline selection, goal, targets, constraints, and bar cannot drift after initialization.

### 3. Reuse GoalCycle as the execution engine but dispatch a task-specific internal skill

Add a built-in `task-loop` Pipeline with this semantic DAG:

```text
iterate [goal/evaluate bounded loop: build -> judge] -> ship -> archive
```

The `iterate` stage uses a new internal `rasen-task-loop` skill, `role: implementer`, no dependencies, `loop.kind: goal`, an evaluate gate, the existing default bounded budget, and a `task-loop-run.json` compatibility projection name. `ship` and `archive` are the existing skills and have no Pipeline gate; `retain` is deliberately absent. The no-gate directive is still recorded by auto, but cannot weaken terminal or permission checks.

The v1 Pipeline normalizer must lower a goal loop using the stage's declared capability instead of the current hard-coded `skill:rasen-goal-iterate`. Existing goal Pipelines continue to declare that skill and therefore lower identically. Profile resolution continues to map work to an implementer/workspace-write action and judge to a reviewer/read-only action; no new runtime role or adapter is needed.

The `rasen-task-loop` workflow is internal, not directly user-invokable. During work it receives the frozen contract plus only the prior round's largest gap/pass condition, edits the real targets, runs relevant checks, and returns material tree/evidence references without declaring success. During judge it receives the frozen contract, real target locations, relevant references, and raw evidence—but not the builder's reasoning, summary, or design justification—and returns the existing strict evaluate-judge result shape.

### 4. Add task-specific mechanical judgment checks around the generic evaluate result

Generic GoalCycle validation remains unchanged for other pipelines. For a `task-loop` plan, the TaskLoop Module additionally enforces:

- the judge actor differs from the round's builder and from every prior task-loop judge actor;
- the returned criterion IDs match the frozen bar exactly, with no omissions, additions, or duplicates;
- every criterion contains non-empty, target-related evidence and the committed action carries raw evidence references;
- `satisfied: true` is valid only when every frozen criterion is satisfied and `gaps` is empty;
- `satisfied: false` carries exactly one largest material gap and an explicit, testable next-round pass condition;
- a completion cannot mutate or replace the task contract.

The existing GoalCycle result contract remains the wire format so its reducer, stall comparison, replay, and ship guard retain Leverage. TaskLoop errors use stable codes such as `task_loop_input_missing`, `task_loop_input_invalid`, `task_loop_bar_unprovable`, `task_loop_critic_reused`, `task_loop_bar_mismatch`, and `task_loop_false_satisfaction`; actor self-review keeps the existing `goal_cycle_actor_separation` code.

The reconciler enriches only task-loop goal-cycle action inputs with the frozen task contract. A work action also receives the prior largest gap; a judge action receives no work-result narrative. The canonical Record remains the source of truth. A human-readable `task-loop-report.md` may be projected into the resolved evidence directory after a valid judge completion for ship/archive consumption, but it is derived, contains the contract digest, round, criteria, and raw evidence references, and cannot back-drive or alter the Run.

### 5. Make all non-satisfied stops terminal and non-converting

A valid satisfied judgment marks the loop node successful, making `ship` ready; successful ship then makes `archive` ready. An exhausted budget reconciles to an escalated `task_loop_exhausted` terminal. A failed phase or genuine external/permission/dependency blocker reconciles to a blocked/escalated terminal with the original cause and largest gap. User cancellation remains the canonical cancelled terminal. Repeated non-progress remains visible through the existing stall streak and reaches the bounded exhaustion path; it is never reinterpreted as success.

`assertTaskLoopMayDeliver` is checked at both completion and delivery boundaries. It requires a valid task-loop input, a mechanically valid satisfied judgment for its exact bar, and no cancelled/blocked/exhausted terminal. Neither the auto driver nor ship/archive templates contain a fallback branch from these outcomes. Resume returns the same terminal status and does not create a new Change, switch Pipeline, or produce spec artifacts.

### 6. Keep selection explicit and make the built-in visible everywhere ordinary Pipelines are visible

`task-loop` is registered under `pipelines/task-loop/pipeline.yaml`, so `rasen pipeline list`, `show`, validation, profile resolution, and execution preflight use ordinary registry behavior. Preflight rejects legacy/prompt-owned execution and requires the reconciler because canonical frozen inputs and terminal guards are part of the contract.

The `rasen-auto` template documents both explicit forms and strips a leading `task-loop` selector exactly like other known Pipelines. `task-loop` is not added to keyword classification and does not change the default `small-feature` policy. The auto built-in declares the task-loop Pipeline and internal skill in its strong dependency closure. The skill template export, generated-skill parity registry/hashes, init/update generation, and English/Japanese/Simplified-Chinese messages are updated by explicit name lists, not filename pattern discovery.

### 7. Preserve deterministic resume and inspectable progress

The Run view/status projection adds a task-loop section containing the contract digest and safe contract fields, current round/phase, effective budget, builder and critic actor identities, latest criterion results, raw evidence references, largest gap/pass condition, stall state, and terminal outcome. It does not expose builder reasoning to a critic dispatch. The sealed RuntimePlan plus Canonical Record fully determines the next action; completed phases are never re-admitted.

Compatibility projections are read-only. Missing or stale projections never change the canonical outcome. Resume on Windows, macOS, and Linux resolves files with `path.join`/`path.resolve`, accepts paths containing spaces and non-ASCII characters, and does not depend on `/dev/null`, shell redirection, slash-specific assertions, or POSIX-only process semantics.

### 8. Dependency boundaries stay narrow

- **In-process dependencies:** TaskLoop contract/judgment validation, Pipeline lowering, GoalCycle reduction, and Reconciler projection are direct Module calls because they define atomic correctness.
- **Local-substitutable dependencies:** Pipeline Registry, filesystem RunStore, Git workspace observation, and evidence projection retain existing adapters and temp-repository test doubles.
- **Remote-but-owned dependencies:** Claude/Codex dispatch continues through existing native or exec-bridge runtime adapters; the new Module depends only on actor attestations and structured completions.
- **True external dependencies:** task-specific browsers, URLs, services, or benchmark tools are artifact evidence sources, not core TaskLoop dependencies.

## Risks / Trade-offs

- **[A critic identity can be fresh while its model context is accidentally contaminated]** → enforce a new actor identity each round, construct judge prompts only from the frozen contract and real artifacts, and test that builder narrative fields are absent from judge action input.
- **[Natural-language criteria may be syntactically valid but not genuinely inspectable]** → require an evidence hint per criterion, refuse clearly unprovable/empty bars before work, and require raw evidence per completed criterion; ambiguous bars block rather than silently soften.
- **[Reusing GoalCycle could leak goal-workflow assumptions]** → dispatch the declared task skill, condition task rules on the exact built-in plan identity/input contract, and retain regression tests for all existing goal-loop variants.
- **[Canonical input plumbing changes Run idempotency]** → use the existing launch-intent digest helper, compare persisted/requested digests before reuse, and test same-input reuse versus changed-input conflict.
- **[A derived evidence report could drift from the canonical Record]** → stamp it with the launch contract digest and generate it only from committed events; status and delivery guards continue to trust the Record, never the report.
- **[No planner stage means the LEAD's initial bar could be weak]** → make bar quality visible before admission and fail preflight when no evidence-backed criterion can be formed; users can revise before the Run starts, not during it.
- **[The bounded default may stop before a difficult task satisfies the bar]** → display the effective budget, preserve the largest gap/evidence on `exhausted`, and require a new explicit run rather than converting the active one.

## Migration Plan

1. Add task contract/input validation and launch-digest conflict coverage without changing existing empty-input Runs.
2. Make goal-loop lowering honor the declared stage skill and prove existing goal Pipelines lower identically.
3. Add the TaskLoop Module, action-input projection, judgment/actor checks, status projection, and terminal guards behind the `task-loop` identity.
4. Register the internal skill and built-in Pipeline, then update auto guidance/dependencies, localization, generation/parity lists, and evidence-aware ship guidance.
5. Run focused unit, registry, workflow-template, canonical runtime, CLI, resume, terminal, and Windows-safe end-to-end tests, followed by the repository typecheck/test gates required by the branch.

Rollback removes the built-in Pipeline and internal workflow first, making new selection unavailable, while leaving existing sealed Runs and canonical records readable. The additive input/status fields remain backward-compatible; existing goal and spec-driven Pipelines continue unchanged. No data migration or external dependency rollout is required.

## Open Questions

None for v1. A separate TaskCycle or generalized bar-adapter API should be reconsidered only after a second concrete loop type demonstrates a seam that GoalCycle plus the TaskLoop Module cannot serve cleanly.
