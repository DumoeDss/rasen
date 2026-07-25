## Why

Retention is modeled as the lifecycle step between shipping and archiving, but the installed workflow set does not consistently make that step available. Profiles that include `rasen-ship` without `rasen-auto` can omit `rasen-retain`, the always-generated `rasen-retro` compatibility wrapper can be left without its backing report runner, and goal code pipelines currently archive immediately after shipping without applying the selected retention policy.

## What Changes

- Make the ship workflow declare the retention runner as a required workflow so profile dependency closure installs `rasen-retain` whenever `rasen-ship` is available.
- Keep the temporary `rasen-retro` compatibility wrapper usable in every profile where init or update generates it by ensuring its backing retention runner and report sidecar are present.
- Change the code-producing goal pipelines from `ship → archive` to `ship → retain → archive`, while leaving the research-only report tail unchanged.
- Keep profile retention modes behavioral rather than selectable workflow membership: `off` still installs the required runner and completes as a no-op, while `report` and `codify` select exactly one branch at execution time.
- Align dependency-graph, profile closure, pipeline preflight, generated skill content, documentation, and regression coverage with the corrected lifecycle.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `workflow-library`: Declare the retention runner as a real required workflow of shipping and expose the resulting transitive dependency consistently.
- `cli-init`: Generate a usable retention runner and its sidecars for profiles that install shipping or the temporary retro compatibility surface.
- `cli-update`: Reconcile existing installations to the corrected retention dependency closure without pruning a still-required runner.
- `opsx-ship-command`: Define retention as the post-ship lifecycle step that precedes any later archive action.
- `goal-loop-workflow`: Run retention between ship and archive in code-producing goal pipelines.
- `opsx-goal-command`: Present and execute the corrected goal pipeline tail while preserving the research-only report path.
- `opsx-retro-command`: Keep the temporary direct-invocation wrapper operational by guaranteeing access to the canonical retain report branch.

## Impact

Affected areas include the built-in workflow registry, profile dependency resolution, init/update skill materialization, goal pipeline YAML, ship/goal/retro skill templates, generated-skill parity fixtures, dependency-graph and profile-install tests, pipeline tests, and lifecycle documentation. No external dependency, configuration migration, or breaking profile-format change is required; existing profiles gain the missing internal runner through dependency closure.
