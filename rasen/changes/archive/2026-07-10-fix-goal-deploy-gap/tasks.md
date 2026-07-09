## 1. Register goal workflows in the profile-system registries

- [x] 1.1 In `src/core/profiles.ts`, add `goal-plan`, `goal-iterate`, `goal-report`, `goal-command` to `ALL_WORKFLOWS` (a dedicated commented group, e.g. `// Goal-loop workflow family (opt-in)`). Do NOT add them to `CORE_WORKFLOWS`.
- [x] 1.2 In `src/core/profile-sync-drift.ts`, add to `WORKFLOW_TO_SKILL_DIR`: `'goal-plan': 'rasen-goal-plan'`, `'goal-iterate': 'rasen-goal-iterate'`, `'goal-report': 'rasen-goal-report'`, `'goal-command': 'rasen-goal'`.
- [x] 1.3 In `src/core/init.ts`, add the same four mappings to the local `WORKFLOW_TO_SKILL_DIR` copy (keep it identical to the profile-sync-drift copy).
- [x] 1.4 In `src/core/shared/tool-detection.ts`, add `'goal-command'` to `COMMAND_IDS`. Do NOT touch `SKILL_NAMES` (it is a legacy base list that already omits the fusion/review-cycle/handoff commands — out of scope).

## 2. Update and extend tests

- [x] 2.1 In `test/core/profiles.test.ts`: bump the `ALL_WORKFLOWS` length assertion from `18` to `22` and update the accompanying `it(...)` description; append the four goal IDs to the `expected` array in the "expected workflow IDs" test.
- [x] 2.2 In `test/core/profiles.test.ts`: add a positive assertion that `ALL_WORKFLOWS` contains each of `goal-plan`/`goal-iterate`/`goal-report`/`goal-command` and that `CORE_WORKFLOWS` does NOT contain them (mirrors the existing review-cycle opt-in test).
- [x] 2.3 In `test/core/shared/tool-detection.test.ts`: add an assertion that `COMMAND_IDS` contains `goal-command` (import `COMMAND_IDS` if not already).
- [x] 2.4 In `test/core/profile-sync-drift.test.ts`: add assertions that `WORKFLOW_TO_SKILL_DIR` maps the four goal IDs to their `rasen-goal*` directory names.
- [x] 2.5 Add a deployment assertion in `test/core/update.test.ts` (and/or `test/core/init.test.ts`): after running update/init in a `full`-profile project, the four skill directories `rasen-goal-plan`, `rasen-goal-iterate`, `rasen-goal-report`, `rasen-goal` exist and the `/rasen:goal` command payload exists. Use `path.join()` for all expected paths.

## 3. Build and verify deployment behavior end-to-end

- [x] 3.1 Run `pnpm build` (update/init read from `dist`, so the src changes must be compiled before verifying deployment).
- [x] 3.2 In a scratch/init'd project (or this repo), run `node dist/cli/index.js update` and assert the four `rasen-goal*` skill directories appear plus the goal command payload (`/rasen:goal`). Confirm no goal directories were removed by drift/cleanup logic.
- [x] 3.3 Run `npx vitest run test/core/profiles.test.ts test/core/profile-sync-drift.test.ts test/core/shared/tool-detection.test.ts test/core/update.test.ts test/core/init.test.ts` and confirm green.
- [x] 3.4 Run `npx vitest run test/core/templates/skill-templates-parity.test.ts` and confirm the parity hashes did NOT move (no template source was edited). If any parity hash moves, STOP and investigate before pasting — it signals an accidental template edit outside this change's surface.

## 4. Validate the change artifacts

- [x] 4.1 Run `node dist/cli/index.js validate fix-goal-deploy-gap` until clean.
