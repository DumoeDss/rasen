## Why

The config page has grown incoherent: Autopilot settings (`autopilot.gates`, `autopilot.selection`) can only be set per-project, so on the global page they show read-only with no way to set a machine-wide default — contradicting Rasen's own "global default, project overrides" model that every other axis follows. Handoff tuning exposes a single `handoff.threshold` even though the orchestrator already tunes handoff per agent role. And `autopilot.gates` is a bare on/off toggle that never shows WHICH gates exist or where the mandatory `vet` gate sits, so a user cannot see what "gates on" actually governs. The result reads as a flat, unordered list rather than a coherent control surface.

## What Changes

- **Global-with-project-override for autopilot keys.** `autopilot.gates` and `autopilot.selection` become settable at BOTH global and project scope (today project-only). Project continues to win over global; global wins over the built-in default. The resolvers gain a global layer: `flag > project > global > default`.
- **Per-role handoff thresholds in machine config.** New `handoff.roles.<role>` keys (`planner`, `implementer`, `reviewer`, `fixer`, `shipper` — the closed role set) at both global and project scope, mirroring what pipeline YAML already accepts. A role-specific machine threshold wins over the scalar `handoff.threshold` at the same scope tier; the scalar key stays for the un-tuned common case.
- **Per-role agent model in machine config.** New `models.default` (base model for all roles) and `models.roles.<role>` (five per-role overrides) keys at both scopes — so a user can express "reviewer uses fable, everyone else uses sonnet" as machine config rather than hand-editing every pipeline. Model ids are free strings, soft-validated against the model-presets registry (a known id gets a preset; an unknown id is accepted, never rejected — new models appear constantly). A per-role model wins over the base; both slot below pipeline `agents.<role>` and above the session/runtime default in the model resolution chain, and surface in `rasen pipeline show --json` and the `/rasen:auto` runtime resolution.
- **Group reorder.** The config page surfaces the `Autopilot` and `Workflow` groups at the top of the page, ahead of Profile/Behavior/Telemetry/etc.
- **Gates inventory.** A new read-only `GET /api/v1/pipelines` endpoint exposes each pipeline's stages with their gate kind (`false` / `true` / `vet`). The Autopilot group renders a gates inventory panel showing which gates exist per pipeline and marking every `vet` gate as "always pauses — cannot be disabled by gates-off".
- **Governance-text parity.** Every template/skill/spec/doc that states the autopilot precedence as "flag > project config > default" is updated to include the global layer, in this same change.

No breaking changes: existing configs (scalar `handoff.threshold`, project-only autopilot keys) keep working unchanged; no key renames; project still wins over global everywhere.

## Capabilities

### New Capabilities
<!-- None — this change extends existing config capabilities rather than introducing new ones. -->

### Modified Capabilities
- `config-key-registry`: `autopilot.gates`/`autopilot.selection` scopes expand from `['project']` to `['global', 'project']`; new `handoff.roles.<role>` registry entries (five fixed roles) and new `models.default` + `models.roles.<role>` entries (base + five roles) settable at both scopes, with registry↔schema round-trip parity.
- `opsx-pipeline-registry`: the effective stage model resolution incorporates machine config layers (`models.roles.<role>` then `models.default`, project ahead of global) below pipeline `agents.<role>` and above the runtime default; `rasen pipeline show --json` reflects the resolved model.
- `config-http-api`: `autopilot.*` keys are now writable at global scope through the API; new read-only `GET /api/v1/pipelines` endpoint returning the per-pipeline gates inventory.
- `config-ui-package`: `Autopilot` and `Workflow` groups render at the top; per-role threshold AND per-role model controls beside the base handoff threshold / base model, presented per-agent; a gates-inventory panel in the Autopilot group marking the `vet` gate as always-pausing.
- `autopilot-gate-policy`: effective gate policy precedence gains a global config layer — `flag > project > global > default`.
- `autopilot-selection-policy`: effective selection policy precedence gains a global config layer — `flag(s) > project > global > default`.
- `pipeline-handoff-config`: the stage handoff resolution chain slots per-role project/global config thresholds below their scalar counterparts (project role > project scalar > global role > global scalar), between the pipeline layer and the model-preset layer.

## Impact

- **Config layer**: `src/core/config-keys.ts` (registry entries + scopes), `src/core/project-config.ts` (schema + `resolveAutopilotGatePolicy`/`resolveAutopilotSelectionPolicy` gain a global layer; new `models` block), `src/core/global-config.ts` (`GlobalConfig` gains `autopilot` block, per-role `handoff.roles`, and a `models` block), `src/core/effective-config.ts` (`resolveHandoffThresholdLayers` returns per-role layers; new `resolveModelConfigLayers`), `src/core/pipeline-registry/types.ts` (`resolveStageHandoffConfig` chain + `HandoffConfigLayers`; `resolveStageRuntimeConfig` gains model config layers).
- **HTTP API**: `src/core/config-api/router.ts` (new `/api/v1/pipelines` route reusing the pipeline registry loader), `serialize.ts`/`wire-types.ts` as needed.
- **Pipeline resolution**: `src/commands/pipeline.ts` (`toStageView`/`show` thread model config layers so `pipeline show --json` reflects the resolved model).
- **UI**: `packages/ui/src/config/grouping.ts` (GROUP_ORDER), `controls.ts`/`ConfigEntryRow.tsx` (per-role threshold + model rows; model as a text input with a datalist of known preset ids), a new gates-inventory panel component in the Autopilot group, `api/client.ts`/`api/types.ts`.
- **Governance text**: `src/core/templates/workflows/auto.ts` (autopilot precedence + the runtime/model table text at L78; + generated `.claude/skills/rasen-auto/SKILL.md`), `docs/autopilot.md`, `docs/zh/autopilot.md`, `src/core/pipeline-registry/run-state.ts` comment, resolver JSDoc + `source` type unions in `project-config.ts`; the two handoff chains that omit the config layers (`_orchestration.ts`, `docs/opsx-workflow-guide.md`).
- **Tests**: `test/core/config-keys.test.ts` (registry↔schema round-trip for new keys incl. `models.*`), the pipeline runtime/handoff resolution suites (per-role model + threshold layers), config-api router tests (new endpoint + global autopilot writes), `packages/ui` tests (`grouping.test.ts` order assertion, new panel/control tests).
- **Out of scope**: version bumps and UI package republish (a separate user decision).
