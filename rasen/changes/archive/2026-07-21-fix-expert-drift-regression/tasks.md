## 1. Product fix — closure-aware drift detection

- [x] 1.1 In `src/core/profile-sync-drift.ts`, closure-expand the desired selection inside `hasToolProfileOrDeliveryDrift`: after `toKnownWorkflows(desiredWorkflows)`, resolve the dependency closure with `resolveWorkflowSelection(catalog, known, { includeSkillDependencies: true })` (from `src/core/workflow-registry/selection.ts`), and use that expanded id set as `desiredWorkflowSet` for the deselection loops (`:129-136`, `:153-171`). Keep the forward-required checks working against the expanded set.
- [x] 1.2 Normalize ids to workflow roots the way `resolveDesiredWorkflowSelection` does (`filterKnownWorkflowRoots` before `resolveWorkflowSelection`), and confirm the deselection loops compare the resulting ids against `definition.id` like-for-like — accounting for `-command`-suffixed desired ids (`ship-command`, `auto-command`).
- [x] 1.3 Apply the same closure-expanded set to `hasProjectConfigDrift`'s trailing "installed workflows not in desired" comparison (`:262-271`) so it agrees with the deselection loops.
- [x] 1.4 Add a JSDoc contract note on `hasToolProfileOrDeliveryDrift`: `desiredWorkflows` is treated as a selection to be closed over internally; callers may pass the raw or the closure-resolved set and get the same result.
- [x] 1.5 Confirm idempotence: passing an already-closure-resolved set (as `update.ts:218` does) yields identical results and output — `rasen update` behavior and summary are unchanged.

## 2. Tests

- [x] 2.1 Re-green `test/core/command-generation/command-file-id.test.ts` ("reports drift when only a legacy suffixed file lingers"): the clean-init assertion (`:159`) should now be `false` with the raw workflow list it passes; the legacy-file assertion (`:163`) should remain `true`.
- [x] 2.2 Add a regression test asserting the production path: a `custom` profile with pipeline workflows and unlisted experts, installed via `InitCommand`, then `hasProjectConfigDrift(resolveCurrentProfileState(getGlobalConfig()).workflows, delivery)` === `false`. Also assert a genuinely orphaned expert still yields `true`.

## 3. Validate

- [x] 3.1 Run the drift/profile-sync test suites and `command-file-id.test.ts`; confirm green with no new failures.
- [x] 3.2 Run the broader suite to confirm no regression in `update`/`profiles`/`init` paths. (targeted suites green — 198 tests across update/profiles/init/named-profiles/config-profile/profile; full `pnpm test` run in progress, see DONE report)
- [x] 3.3 `rasen validate fix-expert-drift-regression --strict`. (passed: "Change 'fix-expert-drift-regression' is valid")
