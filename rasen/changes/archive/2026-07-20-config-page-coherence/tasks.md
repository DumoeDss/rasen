## 1. Config layer: schemas and registry (foundation)

- [x] 1.1 In `src/core/global-config.ts`, extend `GlobalConfig` with an optional `autopilot?: { gates?: 'on'|'off'; selection?: 'classify'|'manual'|'compose' }` block, extend `handoff?` with an optional `roles?` map (per-role dual-form thresholds for planner/implementer/reviewer/fixer/shipper), and add an optional `models?: { default?: string; roles?: { planner?: string; implementer?: string; reviewer?: string; fixer?: string; shipper?: string } }` block. Global config is a raw JSON parse/merge, so no zod gate — validation happens on read where consumed.
- [x] 1.2 In `src/core/project-config.ts`, extend `ProjectConfigSchema.handoff` with an optional `roles` object reusing the pipeline registry's per-role threshold shape (`thresholdSchema`), add an optional `models` object (`default` string + per-role string map), and extend the resilient `parseProjectConfigContent` to parse `handoff.roles.<role>` and the `models` block field-by-field (drop-with-warning per invalid field, siblings survive) — mirroring the existing `handoff.threshold` handling.
- [x] 1.3 In `src/core/config-keys.ts`, change `autopilot.gates` and `autopilot.selection` scopes from `['project']` to `['global', 'project']`. Update the `handoff.threshold` description if needed to reference per-role overrides.
- [x] 1.4 In `src/core/config-keys.ts`, add the ten per-role threshold entries `handoff.roles.<role>` (type `threshold`, both scopes, group `Workflow`, `validateThreshold`) AND the six model entries `models.default` + `models.roles.<role>` (type `string`, both scopes, group `Workflow`, non-empty required, NO enum — free model ids), each with a per-key description.
- [x] 1.5 Update `test/core/config-keys.test.ts` so the registry↔schema round-trip covers the promoted autopilot keys at global scope, the five per-role handoff keys, and the six `models.*` keys at both scopes; run it and confirm parity holds.

## 2. Autopilot resolvers gain a global layer

- [x] 2.1 In `src/core/project-config.ts`, extend `resolveAutopilotGatePolicy` to accept the global config value and insert the global layer: precedence `flag > project > global > default`. Extend `ResolvedGatePolicy.source` to `'flag' | 'project' | 'global' | 'default'` (the layer that produced the value); update the JSDoc precedence text.
- [x] 2.2 In `src/core/project-config.ts`, extend `resolveAutopilotSelectionPolicy` the same way (`flag(s) > project > global > default`); extend its `source` union and JSDoc.
- [x] 2.3 Update every call site of the two resolvers to pass the global config; grep for consumers switching on `.source === 'config'` and update them (run-state recording, `/rasen:auto` display). Update the `src/core/pipeline-registry/run-state.ts:134-135` comment.
- [x] 2.4 Add/extend unit tests for both resolvers covering: global-only default honored, project beats global, flag beats both, absent-in-both falls to built-in default, invalid value falls through.

## 3. Per-role handoff threshold resolution

- [x] 3.1 In `src/core/pipeline-registry/types.ts`, extend `HandoffConfigLayers` with optional `projectRoles?` / `globalRoles?` (role→threshold maps) and extend `ResolvedStageHandoffConfig.source` with `'project-role'` and `'global-role'`.
- [x] 3.2 In `resolveStageHandoffConfig`, insert the two new layers into the threshold precedence and the `source` provenance chain: `... pipeline > project-role > project-config > global-role > global-config > preset > default`, keying the role layers by the stage's role.
- [x] 3.3 In `src/core/effective-config.ts`, extend `resolveHandoffThresholdLayers` to also return `projectRoles` (from `projectConfig.handoff?.roles`) and `globalRoles` (from the re-validated `globalConfig.handoff?.roles`, dropping invalid role thresholds with a warning like the scalar path).
- [x] 3.4 Add unit tests to the pipeline-handoff resolution suite covering every new scenario in the `pipeline-handoff-config` delta (project role beats project scalar; global role beats global scalar; project role beats global role; config beats preset with per-role; absolute form per-role).

## 4. Per-role agent model resolution

- [x] 4.1 In `src/core/pipeline-registry/types.ts`, add a `ModelConfigLayers` type `{ projectRoles?: Partial<Record<role,string>>; projectDefault?: string; globalRoles?: Partial<Record<role,string>>; globalDefault?: string }` and extend `resolveStageRuntimeConfig` to accept an optional `modelLayers` param, inserting the machine layers into the MODEL field only: `stage.model > pipeline.agents[role].model > project role > project default > global role > global default > runtime default`. Extend `ResolvedStageRuntimeConfig.source` (or add a model-specific source) so the config-layer origin is reportable; leave runtime/sandbox/effort resolution unchanged.
- [x] 4.2 In `src/core/effective-config.ts`, add `resolveModelConfigLayers(projectRoot)` (sibling of `resolveHandoffThresholdLayers`) reading and re-validating the project and global `models` blocks (drop non-string role/default values with a warning) into a `ModelConfigLayers`.
- [x] 4.3 Thread `modelLayers` through `resolveStageHandoffConfig`'s internal `resolveStageRuntimeConfig` call so the model-preset (handoff/reuse threshold) layer keys off the machine-config-resolved model, and through `src/commands/pipeline.ts` `toStageView`/`show` so `rasen pipeline show --json` reports the resolved stage model with its source.
- [x] 4.4 Add unit tests covering every scenario in the `opsx-pipeline-registry` delta: global base applies; per-role beats base within a scope; project beats global; pipeline role default beats machine config; stage model wins; unrecognized id used as-is; `pipeline show --json` reflects the machine-config model.

## 5. HTTP API: pipelines inventory endpoint

- [x] 5.1 In `src/core/config-api/wire-types.ts`, add `WirePipeline` / `WirePipelineStage` shapes (`{ name, description, stages: [{ id, role, skill, gate }] }`, gate as `false|true|'vet'`).
- [x] 5.2 In `src/core/config-api/router.ts`, add a GET-only `/api/v1/pipelines` route (405 on other methods, token-guarded like the rest) that loads pipelines via the shared registry loader (`listPipelinesWithInfo` + `loadPipelineByName`) against the launch project root and returns the trimmed gate projection — no pipeline logic in the handler.
- [x] 5.3 Add config-api router tests: authorized GET returns gated-stage metadata with `'vet'` distinguishable, non-GET → 405, missing token → 401.

## 6. UI: group order, per-role controls, gates inventory

- [x] 6.1 In `packages/ui/src/config/grouping.ts`, move `Autopilot` and `Workflow` to the front of `GROUP_ORDER`; update `grouping.test.ts` order assertions.
- [x] 6.2 In `packages/ui/src/api/types.ts` and `api/client.ts`, add the `getPipelines()` client call and its response types mirroring the wire shapes.
- [x] 6.3 Add a read-only gates-inventory panel component rendered in the Autopilot group: lists pipelines and their gated stages, badging `gate: 'vet'` as always-pausing (not disableable by gates-off) distinctly from ordinary `true` gates; no editing controls.
- [x] 6.4 Ensure the per-agent keys render under the Workflow group beside their base: the five `handoff.roles.<role>` keys as dual-form threshold controls beside `handoff.threshold`, and the five `models.roles.<role>` keys as text inputs (with a datalist of known model-preset ids, free text accepted) beside `models.default` — each scope-explicit, presented per-agent. Verify autopilot keys now render editable at global scope.
- [x] 6.5 Add UI tests: group order, gates panel vet-badging, per-role threshold control rendering, per-role model control rendering (datalist suggestions + free-text acceptance).

## 7. Governance-text parity

- [x] 7.1 Update `src/core/templates/workflows/auto.ts` gate-policy (L34) and selection-policy (L38) precedence text to `flag > project config > global config > built-in default`.
- [x] 7.2 Update `src/core/templates/workflows/auto.ts` runtime/model table text (L78) so the effective-model resolution names the machine `models.*` config layer (per-role then base, project ahead of global) as a default source below the pipeline `agents.<role>` role default and above the session/runtime default.
- [x] 7.3 Update `docs/autopilot.md:10` and `docs/zh/autopilot.md:9` precedence statements to include the global layer.
- [x] 7.4 Update the two handoff chains that OMIT the config layers to include the project/global scalar AND per-role config layers: `src/core/templates/workflows/_orchestration.ts:255` and `docs/opsx-workflow-guide.md:215`.
- [x] 7.5 Regenerate the affected `.claude/skills/*/SKILL.md` mirrors from the templates (build → skill regeneration step); do NOT hand-edit the generated files. Verify the generated text matches the updated templates.
- [x] 7.6 Reconcile any duplicate copies in the `.claude/worktrees/config-ui/` tree (or confirm with the LEAD which tree the change lands in) so no stale precedence text remains. NOTE: the apply-time briefing explicitly instructed "do NOT touch" `.claude/worktrees/config-ui/` — confirmed it is a separate git worktree (own branch `feat/unified-config-ui`, own history), not a copy this implementer should reconcile into. This change lands entirely in the main tree; the worktree's own precedence text (if any) is that branch's separate concern, to be resolved by whoever owns/merges it. Deferred to the LEAD's tree-selection decision, not left undone by oversight.

## 8. Verification

- [x] 8.1 Run the full test suite (root + packages/ui) and confirm green, including the config-keys round-trip, resolver, handoff-resolution, model-resolution, config-api, and UI tests.
- [x] 8.2 Manually exercise `rasen config set autopilot.gates off --scope global`, `rasen config set handoff.roles.reviewer 0.7 --scope global/project`, `rasen config set models.default sonnet --scope global`, `rasen config set models.roles.reviewer fable --scope project`, and `rasen pipeline show <name> --json` to confirm the resolved per-role model and threshold appear end-to-end; spot-check the UI page order, gates panel, and per-role controls.
- [x] 8.3 Run `rasen validate config-page-coherence` and confirm the change and delta specs validate before archiving.
