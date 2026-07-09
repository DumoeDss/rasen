## Why

`rasen update` and `rasen init` never install the goal-loop family: the four `rasen-goal*` skill directories and the `/rasen:goal` command payload are silently omitted from every project. The goal templates were registered in the generation pipeline (and pinned by parity tests) when goal-loop shipped, but their workflow IDs were never added to the profile-system registries. Under the default `full` profile the goal skills are filtered out by the workflow filter, so the feature is unreachable for end users even though its code exists.

## What Changes

- Register the four goal-loop workflow IDs (`goal-plan`, `goal-iterate`, `goal-report`, `goal-command`) in `ALL_WORKFLOWS` so the `full` profile installs them.
- Add the goal skill-directory mappings to both copies of `WORKFLOW_TO_SKILL_DIR` (`profile-sync-drift.ts` and `init.ts`): `goal-plan`→`rasen-goal-plan`, `goal-iterate`→`rasen-goal-iterate`, `goal-report`→`rasen-goal-report`, `goal-command`→`rasen-goal`.
- Add `goal-command` to `COMMAND_IDS` so the `/rasen:goal` command payload is generated and detected.
- Update/extend affected tests to cover goal deployment (post-`update` the four `rasen-goal*` dirs and the goal command payload appear) and any registry-membership assertions.

No template source files are edited, so no parity-hash movement is expected.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `opsx-goal-command`: the goal command and skill templates are registered not only in the generation pipeline but also in the profile-system registries, so `rasen update`/`init` under the `full` profile actually install the four goal skill directories and the goal command payload.

## Impact

- `src/core/profiles.ts` (`ALL_WORKFLOWS`)
- `src/core/profile-sync-drift.ts` (`WORKFLOW_TO_SKILL_DIR`)
- `src/core/init.ts` (local `WORKFLOW_TO_SKILL_DIR` copy)
- `src/core/shared/tool-detection.ts` (`COMMAND_IDS`)
- Affected tests under `test/core/` (profile/registry membership, update/init deployment).
- Downstream behavior that auto-recovers once registered: the `custom` profile picker (`src/commands/config.ts`) offers goal options, profile-sync-drift covers goal dirs, and `removeUnselectedSkillDirs` correctly cleans goal dirs under non-`full` profiles.
