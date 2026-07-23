## 1. Known-workflows baseline (global config)

- [x] 1.1 Add optional `knownBuiltInWorkflows?: string[]` to the `GlobalConfig` type in `src/core/global-config.ts`; ensure read tolerates its absence and write round-trips it.
- [x] 1.2 Add a helper (in `src/core/profiles.ts` or a small module) returning the current built-in *workflow* ids (catalog `kind !== 'expert'`, `source === 'built-in'`) — the baseline source of truth.
- [x] 1.3 Write the baseline whenever a selection is persisted: `applyProfileState` (`src/commands/profile-editor.ts`), `rasen init`, and existing-user migration (`src/core/migration.ts` / update's migrate path). Set it to the current built-in workflow ids at save time.

## 2. Surface new built-in workflows on `rasen update`

- [x] 2.1 In `src/core/update.ts`, after resolving `desiredWorkflows` via `resolveProjectWorkflowSelection`, compute `newBuiltIns = currentBuiltInWorkflowIds − knownBuiltInWorkflows` and then `surface = newBuiltIns − desiredSet`. Seed `knownBuiltInWorkflows` (silently, no note) when the field is absent, then skip surfacing on that run.
- [x] 2.2 Scope the note to frozen selections: `full`/`core` resolve against the live catalog and will have an empty `surface` set — verify no note fires for them. For a project override (no per-selection save event), apply the conservative fallback from design D2/OQ1 (default: same baseline rule via the user-wide baseline; do not nag).
- [x] 2.3 Print the localized note directing the user to `rasen profile`, added through the existing update diagnostic/message path (respect resolved locale; user-authored workflow names untranslated).
- [x] 2.4 Confirm `update` never rewrites `config.workflows` / the override list as part of this (stored selection unchanged).

## 3. Profile editor discoverability + faithful checked state

- [x] 3.1 In `runInteractiveProfileEditor` (`src/commands/profile-editor.ts`), before the picker, print a localized line naming built-in workflows available but not in `currentState.workflows`; print nothing when none are unselected.
- [x] 3.2 Add the message(s) to the profile message tables (`src/commands/profile-messages.ts`) for each supported locale.
- [x] 3.3 Do NOT change the `checked` computation in `workflowChoices`; confirm an unselected, non-required built-in still renders unchecked.

## 4. Tests

- [x] 4.1 Unit test (profiles/profile-editor): a built-in workflow absent from the stored `custom` selection and required by nothing renders **unchecked** in `workflowChoices` (locks D4 faithfulness).
- [x] 4.2 Unit test: `getProfileWorkflows('custom', stored)` excludes a catalog-new built-in, and `resolveDesiredWorkflowSelection` does not install it — the frozen-selection root cause, regression-locked.
- [x] 4.3 Update-command test: with a `custom` selection whose baseline predates a new built-in, `update` surfaces the note and leaves `config.workflows` unchanged; with the workflow already in the baseline (deliberate deselection), no note; `full` profile installs it with no note.
- [x] 4.4 Global-config test: `knownBuiltInWorkflows` round-trips; a config missing it reads without error and is seeded on first `update` with no note that run.
- [x] 4.5 Editor test: the available-but-unselected line names an unselected built-in and is absent when every built-in is selected.

## 5. Verification

- [x] 5.1 Run the full test suite (Windows: isolate any CLI-spawning EBUSY flakes per known guidance); confirm no regressions.
- [x] 5.2 `node bin/rasen.js validate --change update-sync-new-workflows --strict` passes; delta specs sync cleanly.
- [x] 5.3 Manual smoke: simulate a stored `custom` selection lacking `audit`, run `update`, confirm the note appears and `rasen-audit` is not installed until selected via `rasen profile`.
