# Planning context — config-page-coherence

## User intent (verbatim, 2026-07-20)
"当前的配置页面看着乱七八糟的，没有条理性，1. 关于配置，应该是有个全局配置，然后各项目可以覆盖配置。当前的全局配置有些配置无法修改，比如Autopilot。 2. handoff.threshold怎么只有一个选项？应该不同的agent可以单独配置threshold啊。 3. 把Autopilot和Workflow放到最上方 4. autopilot.gates应该展示有哪些gates，以及强制gate在哪里。"

Four asks:
1. **Global-with-project-override as the universal model.** Autopilot keys (`autopilot.gates`, `autopilot.selection`) are currently `scopes: ['project']` only (src/core/config-keys.ts:161-177) so the global page shows them read-only. User wants them settable globally with per-project override.
2. **Per-role handoff thresholds.** `handoff.threshold` is a single dual-form key (config-keys.ts:198). User wants per-agent-role configuration (roles: planner, implementer, reviewer, fixer, shipper). Pipeline YAML already supports `handoff.roles[<role>]`; machine config (global/project) does not expose it.
3. **Group order.** UI `GROUP_ORDER` (packages/ui/src/config/grouping.ts) currently Profile, Behavior, Autopilot, Telemetry, Project, Archive, Workflow, Advanced. User wants Autopilot and Workflow at the top.
4. **Gates visibility.** `autopilot.gates` should show WHICH gates exist and where the mandatory gate is. Facts: gates live in pipeline stage metadata (`gate: true` ordinary, `gate: 'vet'` ALWAYS pauses regardless of policy — the hard carve-out). Today neither the config HTTP API nor the UI exposes pipeline/stage info; `rasen pipeline show <name> --json` has it CLI-side.

## Verified current-state facts
- Registry: src/core/config-keys.ts `CONFIG_KEY_REGISTRY`; scopes drive both CLI `config set` and HTTP API writes; UI renders read-only when the launch scope can't set the key.
- Resolution: src/core/effective-config.ts — env-override > project > global > default. The orchestration-side handoff resolution is a 7-layer union (stage > role > pipeline > project-config > global-config > preset > default) built in the unified-config portfolio — per-role machine keys must slot into this chain coherently (likely: project.roles > global.roles at the same tier as today's project/global scalar, role-specific beating scalar within a tier). Design decision for the planner: exact precedence + whether `handoff.roles.<role>` is a wildcard family (like featureFlags) or five fixed keys (roles are a closed set — fixed keys likely simpler and registry-validatable).
- Autopilot policy resolution: src/core/project-config.ts `resolveAutopilotGatePolicy`/`resolveAutopilotSelectionPolicy` currently read project config only; adding global scope means these resolvers (and the /rasen:auto skill docs' "flag > project config > default" chains) gain a global layer: flag > project > global > default. The rasen-auto skill markdown text describing precedence must be updated in the same change (governance parity) — check templates under src/core/templates/ for the auto workflow text.
- API: src/core/config-api/ (router/serialize/wire-types). Item 4 needs a new read-only endpoint, e.g. GET /api/v1/pipelines → per pipeline: name, stages [{id, gate: true|'vet'|false, skill, role}], so the UI can render a gates inventory marking vet as "always pauses (cannot be disabled)". Keep handlers logic-free (reuse the pipeline registry loader CLI uses).
- UI: packages/ui — grouping.ts GROUP_ORDER reorder (item 3, trivial); ConfigEntryRow renders per-key controls; item 4 wants an explanatory gates panel in the Autopilot group; item 2 wants five role threshold controls beside the base one (threshold control kind already exists: `--threshold`).
- Tests: root suite (config-keys round-trip test asserts registry↔schema parity — new keys must be added to BOTH GlobalConfigSchema/ProjectConfigSchema and registry), config-api router tests, packages/ui tests (59; grouping.test.ts asserts order — will need updating for item 3).
- UI package now at 0.1.1 published; another publish after this change is a separate user decision.

## Constraints / decisions already made
- Backward compatible: existing configs (scalar handoff.threshold, project-only autopilot keys) keep working; no breaking key renames. Project continues to win over global everywhere.
- "全局配置+项目覆盖" is the user's stated model — apply it to autopilot.* (and audit other project-only keys: archive.timing/archive.destination/project.schema — planner should propose which of these genuinely stay project-only, e.g. project.schema/projectId are inherently per-project; archive.* likely also global-able but do NOT expand scope beyond what's justifiable; state rationale per key).
- Item 4 is read-only display (no gate editing in UI).
- Scope: config layer + config-api + packages/ui + governance text parity (skills/templates that state the precedence chains). CLI `rasen config` command surface may need `--scope global` acceptance for the newly global keys (should fall out of registry scopes).
- Version bumps/publish: out of scope.

## Delivery
Single change, small-feature pipeline. Gate policy: ON (default — user reviews proposal at the propose gate). Ship local on dev/0.1.5.

## Planner findings (durable, 2026-07-20)

Artifacts written: proposal.md, design.md, tasks.md (7 groups, 27 tasks), and 6 delta specs. `rasen validate config-page-coherence` passes.

Key decisions (see design.md for rationale):
- **D1 per-role key shape:** `handoff.roles.<role>` (bare threshold, NOT `.threshold` suffix) — mirrors pipeline YAML `HandoffRolesSchema` exactly. Five FIXED registry entries per scope (10 total), not a wildcard. Value type = existing dual-form `threshold`.
- **D2 handoff chain slotting:** per-role machine layers slot as role-beats-scalar within each scope tier. Chain grows 7→9: stage > pipe-role > pipe-scalar > **project-role > project-scalar > global-role > global-scalar** > preset > default. `HandoffConfigLayers` gains `projectRoles/globalRoles`; `source` union gains `project-role`/`global-role`.
- **D3 scope expansion:** ONLY `autopilot.gates`/`autopilot.selection` go global+project. `archive.*` stays project-only (repo-layout property, user didn't ask, unjustified scope creep). `schema`/`projectId` inherently per-project.
- **D4 autopilot resolvers:** add a `globalConfig` param to `resolveAutopilotGatePolicy`/`resolveAutopilotSelectionPolicy`; insert global layer `flag > project > global > default`. `source` union: `'config'` splits into `'project'`/`'global'` — task 2.3 must grep consumers switching on `.source === 'config'`.
- **D5 endpoint:** new GET-only `/api/v1/pipelines`, token-guarded, reuses `listPipelinesWithInfo`+`loadPipelineByName`; returns trimmed StageView `{name,description,stages:[{id,role,skill,gate}]}` (gate=false|true|'vet'). Launch-root only (open question: `project` selector deferred).
- **D7 governance parity:** `.claude/skills/*/SKILL.md` are GENERATED from `src/core/templates/workflows/*.ts` via skill-templates.ts — edit templates + REGENERATE, never hand-edit mirrors. The two handoff chains at `_orchestration.ts:255` and `docs/opsx-workflow-guide.md:215` OMIT config layers entirely — must add project/global scalar AND per-role. Full stale-text inventory is in the Explore sweep (auto.ts:34/38, docs/autopilot.md:10, docs/zh/autopilot.md:9, project-config.ts resolver JSDoc+source unions, run-state.ts:134-135, both autopilot specs, config-keys.ts:161/170, config-key-registry spec:27).

Dropped from proposal during planning: config-resolution is NOT modified — the per-role-vs-scalar layering lives in `resolveStageHandoffConfig` (pipeline-handoff-config), not `resolveEffectiveConfig`; the new role keys just follow the existing generic env>project>global>default rule as ordinary registry keys.

Watch-out: a parallel worktree exists at `.claude/worktrees/config-ui/` with duplicate copies of all governance files (task 7.6 / LEAD coordination on which tree the change lands in).

## Planner findings — scope extension: per-role MODEL config (2026-07-20, gate-approval)

User approved proposal at the gate WITH scope extension: per-agent config must cover MODEL too (e.g. "reviewer用fable，其他用sonnet"). Extended all artifacts.

- **D8 key-shape decision (KEY):** per-role model uses a DEDICATED `models` block — `models.default` (base, string) + `models.roles.<role>` (5 keys, string), both scopes, group `Workflow`. NOT a unified `agents.<role>.{model,handoffThreshold}` restructure and NOT mirroring pipeline's `agents.<role>.model`. Three reasons: (1) user's "其他用sonnet" REQUIRES a base default that a role-only shape can't express — `models.default` gives it directly; (2) keeps the unshipped `handoff.threshold`/`handoff.roles.<role>` family intact (no restructure, D1 mirror preserved); (3) machine config exposes ONLY model (not runtime/sandbox/effort), so a flat `models` block is more ergonomic than `agents.<role>.model` and doesn't imply the other runtime fields are machine-settable. `models.default`+`models.roles.<role>` is symmetric with the handoff scalar+roles family.
- **Model validation:** FREE STRING, no enum. Mirrors stage `model: z.string().min(1)` + `resolveModelPreset` (src/core/model-presets.ts) substring match where unknown→no preset. MODEL_PRESETS match substrings: haiku, opus-4/sonnet-5/sonnet-4-6/fable/mythos (1M window), gpt-5 (272K, has absolute thresholds). UI = text input + datalist of known ids, never rejects.
- **Model precedence (mirrors D2 slotting):** stage.model > pipeline agents[role].model > project models.roles.<role> > project models.default > global models.roles.<role> > global models.default > runtime default. NO stage/pipeline base-default (base is machine-config-only).
- **Consumers:** `resolveStageRuntimeConfig(stage, pipeline, modelLayers?)` — new optional param, MODEL field only. New `resolveModelConfigLayers(projectRoot)` in effective-config.ts (sibling of resolveHandoffThresholdLayers). Must thread through (a) resolveStageHandoffConfig's internal runtime call so preset layer keys off effective model, and (b) pipeline.ts toStageView/show so `pipeline show --json` reflects it. /rasen:auto Step A.1 reads pipeline show → inherits it for free. Governance: auto.ts:78 runtime/model table text (task 7.2).
- **Owning spec:** NEW delta `opsx-pipeline-registry` (ADDED requirement, model resolution + pipeline show). Chosen because no existing testable requirement states the stage runtime/model precedence (resolveStageRuntimeConfig stage>agent>default is not spec'd), and opsx-pipeline-registry owns `pipeline show`. pipeline-handoff-config left untouched by model (out of its handoff scope).
- **UI grouping decision:** per-role model + threshold BOTH in `Workflow` group (per-agent presentation), NOT a new "Agents" group — respects user's explicit "Autopilot和Workflow放到最上方" (only two groups named).

Artifacts now: proposal (6→7 modified capabilities), design (+D8, D6 updated), 7 delta specs (added opsx-pipeline-registry; extended config-key-registry + config-ui-package), tasks (7→8 groups, ~30 tasks; new group 4 model resolution). `rasen validate config-page-coherence` passes.
