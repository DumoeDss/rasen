## 1. Wire Contract and Model Suggestions

- [x] 1.1 Add `effectiveEffort: WireEffectiveValue<string | null>` to the standalone UI pipeline-stage mirror and update every typed collection/detail pipeline fixture with representative value/source pairs, including a null runtime-default case.
- [x] 1.2 Append `gpt-5.6-luna` and `gpt-5.6-terra` to the shared `KNOWN_MODEL_IDS` datalist source without removing existing suggestions, and extend control tests to pin preset parity, suggestion presence on both Pipelines model surfaces, and unchanged acceptance/write-through of an arbitrary non-empty custom id.

## 2. Pipelines Effort Controls

- [x] 2.1 Extend the exact `MATRIX_ROLES` key map and Pipelines config fixture for `efforts.default` plus all five `efforts.roles.<role>` entries, then add an Effort column/cell that reuses the compact defaults writer, registry-provided enum constraints, source badge, active-scope unset, and store-inherited behavior.
- [x] 2.2 Add `StageEffortControl` beside the existing stage gate/model controls, using the exact `pipelines.<pipeline>.efforts.<stage>` instance entry and wildcard template domain, `scopeValues[writeScope]` for the editing choice, `useInstanceWriter` for active-scope Inherit deletion, and post-write server refresh while displaying `effectiveEffort.value` and `.source` separately.
- [x] 2.3 Make compact config-entry state updates identity-safe for wildcard families by matching `instanceKey` before the fixed definition key and adding a returned absent-shape instance when needed, so stage writes do not replace sibling instances that share the family definition.
- [x] 2.4 Adjust only the existing Defaults/stage grid styles needed for the additional column/control, preserving the current Configure disclosure and single-column responsive breakpoint with no new advanced surface.

## 3. Localization

- [x] 3.1 Add the new Effort, Inherit, effective-value, and runtime-default strings to `en`, `zh-cn`, and `ja`, reuse existing keys where their meaning already matches, and keep model ids, effort values, config paths, and provenance identifiers untranslated.
- [x] 3.2 Extend UI catalog coverage to assert every new Pipelines effort key is present and non-empty in all three locales and that Simplified Chinese/Japanese labels do not silently fall back to English.

## 4. Focused Behavior and API Verification

- [x] 4.1 Extend `pipelines-page.test.tsx` to verify the six-row Model/Effort matrix, project/global scoped effort writes, role-effort clear/inheritance re-rendering, and preservation of the existing handoff-free Configure surface.
- [x] 4.2 Add stage-control tests for all six select choices, server-reported effective value/source, project-scope set, Inherit delete, a shadowed Global-scope instance, identity-safe wildcard sibling updates, and the pipeline-list refresh that reveals the lower winning source.
- [x] 4.3 Extend management API inventory/detail tests to pin additive `effectiveEffort` value/source output for configured and absent effort without altering or duplicating backend precedence logic.
- [x] 4.4 Run the focused UI component/config/i18n suites and management API pipeline suite, then run the UI/root typechecks and the repository's standard validation command; record any unrelated pre-existing failure separately.
