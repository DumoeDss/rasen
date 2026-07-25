## Context

Rasen currently exposes three overlapping retention entry paths:

- `full-feature` explicitly runs `ship → retain → archive`, and `auto-command` directly requires the internal `retain-command` workflow.
- `rasen-ship` is independently selectable and always points the user to `rasen-retain` as the post-ship retention step, but `ship-command` declares no workflow dependency on the runner.
- `rasen-retro` is generated outside the selectable workflow catalog for every configured tool during its migration window, but the wrapper delegates to the report branch and does not carry its own `report.md` sidecar.

The goal measure/evaluate pipelines add a fourth inconsistency: their code-producing tail is still `ship → archive`, so the goal driver both omits the retain stage at runtime and lacks `retain-command` in its transitive dependency graph. The profile's `retention` value only chooses `off`, `report`, or `codify`; it is not workflow membership and must not be used as a substitute for dependency closure.

## Goals / Non-Goals

**Goals:**

- Make every generated retention entry path usable without requiring `auto-command` to be selected.
- Represent shipping's dependency on the canonical retention runner in the built-in workflow registry.
- Run retention explicitly before archive in code-producing goal pipelines.
- Preserve one canonical `rasen-retain` implementation and its existing `off | report | codify` dispatch.
- Keep profile snapshots free of the internal `retain-command` ID while making the effective install set complete.
- Preserve resume safety when a goal run crosses the pipeline update.

**Non-Goals:**

- Removing the temporary `rasen-retro` compatibility wrapper in this change.
- Making `rasen-retro` selectable or model-invokable.
- Changing the profile definition format or the meaning of any retention mode.
- Adding retention to the research-only goal pipeline, which produces a report rather than shipping and archiving code.
- Redesigning `archive.timing` or making standalone `rasen-ship` execute retention inline; standalone ship continues to hand off to the installed retention step through its post-ship guidance.
- Generalizing install closure over every stage owner of every required pipeline; this change fixes the concrete retention dependency using the existing strong workflow-dependency mechanism.

## Decisions

### 1. Declare `ship-command → retain-command` as a strong workflow dependency

`ship-command` will add `requires.workflows: ['retain-command']`. This is the durable semantic edge: a selected ship workflow promises a retention next step, so the runner must be co-installed through the same workflow closure used by init, update, drift detection, execution preflight, and dependency presentation.

The existing direct `auto-command → retain-command` edge remains. It describes `full-feature`'s own explicit retain stage and guarantees that auto's install set remains complete even though required pipeline stage owners are not generally install roots. Duplicate paths converge through the selection set and do not generate duplicate artifacts.

Alternative considered: infer the dependency by scanning ship instructions for the string `rasen-retain`. Rejected because generated artifacts and dependencies must be tracked by stable identities, not prose matching.

### 2. Treat the temporary retro wrapper's backing runner as an explicit compatibility install root

`rasen-retro` is intentionally outside the workflow catalog, so it cannot declare a normal `requires.workflows` edge. While init/update continue to materialize that wrapper for every configured tool, the shared desired-install-set seam will add the exact `RETENTION_RUNNER_WORKFLOW_ID` as a compatibility dependency. The stored profile remains unchanged and continues to omit internal workflow IDs.

The runner must flow through ordinary skill generation so `SKILL.md`, `report.md`, and `codify.md` are copied together and update's unselected-artifact cleanup sees the same desired set. The implementation will reuse the existing exact wrapper and runner constants; it will not add prefix, glob, or content-based detection. This compatibility root is removed together with the wrapper when the announced migration window ends.

Alternative considered: copy `report.md` into `rasen-retro` and leave `rasen-retain` absent. Rejected because it duplicates canonical retention material and still leaves profiles containing `rasen-ship` unable to perform `codify`.

### 3. Reuse the full-feature retain-stage shape in code-producing goal pipelines

`goal-loop-measure` and `goal-loop-evaluate` will insert:

```yaml
- id: retain
  skill: rasen-retain
  role: reviewer
  requires: [ship]
  model: sonnet
```

Their archive stage will require `retain`, producing `ship → retain → archive`. Reusing the full-feature stage identity, role, and model keeps pipeline execution, reports, and run-state vocabulary consistent. `goal-loop-research` remains `iterate → report`.

The workflow dependency graph already computes transitive strong closure through required pipelines and declared workflow dependencies. Once goal pipelines include the retain stage and ship declares its dependency, the graph will expose `retain-command` under `goal-command` without a goal-specific special case.

Alternative considered: rely on ship's textual post-run suggestion while the goal LEAD advances directly to archive. Rejected because the pipeline DAG is authoritative; guidance emitted inside one stage cannot insert an omitted stage.

### 4. Make retention-mode freezing apply to any canonical retain stage

The LEAD remains the sole run-state writer. Before dispatching a stage whose canonical ID is `retain`, shared orchestration resolves the effective retention mode only when run-state has no frozen value, records that value, and dispatches the worker with the frozen mode. Resume always uses the recorded value. This behavior is stage-identity based rather than restricted to the `full-feature` pipeline, so goal and future pipelines receive the same idempotent branch selection.

The retain worker continues to execute exactly one branch and never writes run-state itself. Existing legacy `retro → retain` migration remains scoped to old full-feature state and is not repurposed for goal runs.

Alternative considered: let each retain worker re-read the active profile on every attempt. Rejected because a profile edit during an interrupted codify/report run could switch branches and make resume non-deterministic.

### 5. Migrate in-flight goal runs from observed stage completion, not profile configuration

For a goal measure/evaluate run created before this change:

- ship done and archive not done: retain is the new pending frontier and runs before archive;
- archive already done: the newly introduced retain stage is recorded as skipped with a legacy-completed reason, preserving the completed run instead of running retention after archive;
- earlier stages incomplete: the run follows the new DAG normally when it reaches the tail.

No completion is inferred from the retention mode or from the absence of a learned skill. The migration is bounded to the two affected built-in goal pipeline names and exact stage IDs.

### 6. Verify one desired set across generation, cleanup, preflight, and presentation

Tests will cover the registry edge, transitive dependency graph, named/custom profile installation without `auto-command`, init and update sidecar materialization, cleanup preservation, goal pipeline order, execution preflight, generic retention freezing, and legacy goal run migration. Generated-template parity hashes and lifecycle documentation will be refreshed only where content changes.

Path assertions will use `path.join` and temporary project roots so the new coverage remains valid on POSIX and Windows.

## Risks / Trade-offs

- [Every profile temporarily installs `rasen-retain` because every profile receives the retro wrapper] → Treat this as an explicit, documented migration dependency and remove both together at the end of the compatibility window; the internal runner remains absent from stored profile membership.
- [The ship and auto dependency paths both reach `retain-command`] → Rely on the existing set-based deterministic closure and add a regression assertion that only one generated directory is produced.
- [An in-flight goal run may observe a changed tail after upgrade] → Apply the exact stage-status migration above and test ship-done/archive-pending and archive-done cases separately.
- [Shared orchestration wording may drift between auto and goal] → Put canonical retain-stage handling in the shared orchestration body and keep driver-specific summaries descriptive only.
- [Retention `off` appears to install an apparently unused runner] → Preserve the distinction between availability and behavior: dependency closure installs the runner, while `off` remains a successful runtime no-op.

## Migration Plan

1. Add the registry and compatibility desired-set dependencies without changing persisted profiles.
2. Update goal pipeline definitions and shared orchestration/run-state handling.
3. Regenerate skill outputs and parity fixtures.
4. Run focused registry, profile, init/update, pipeline, run-state, and template tests, followed by type checking and the broader suite in proportion to failures found.
5. Existing projects receive the runner on their next `rasen update`; rollback restores the old registry/pipeline definitions and removes only artifacts tracked as generated and no longer desired.

## Open Questions

None. The temporary universal compatibility dependency ends with the already-announced `rasen-retro` migration window; deciding that release is outside this change.
