## Context

Rasen's configuration surface is a single declarative registry (`src/core/config-keys.ts` `CONFIG_KEY_REGISTRY`) whose entries drive CLI `config set`, effective-config resolution (`resolveEffectiveConfig`, `src/core/effective-config.ts`), the config HTTP API, and the web UI. A round-trip test (`test/core/config-keys.test.ts`) asserts every registry entry parses against its scope's zod schema (`GlobalConfig` in `global-config.ts`, `ProjectConfigSchema` in `project-config.ts`), so registry and schema cannot drift.

Today three incoherences motivate this change:

1. `autopilot.gates` and `autopilot.selection` are `scopes: ['project']` (config-keys.ts:161-177), so the global config page renders them read-only. `GlobalConfig` (global-config.ts:59-82) has no `autopilot` block; the resolvers `resolveAutopilotGatePolicy`/`resolveAutopilotSelectionPolicy` (project-config.ts:824-880) read project config only, with a `source: 'flag' | 'config' | 'default'` union.
2. `handoff.threshold` is one scalar key (config-keys.ts:198, both scopes). But the orchestrator already tunes handoff per role: pipeline YAML accepts `handoff.roles.<role>` (a bare threshold per role, `HandoffRolesSchema`, types.ts:102-110), consumed at layer 2 of the 7-layer `resolveStageHandoffConfig` chain (types.ts:503-565). Machine config exposes no per-role form.
3. `autopilot.gates` is a bare on/off toggle. Gate identity lives in pipeline stage metadata (`gate: false | true | 'vet'`, types.ts:331); `'vet'` ALWAYS pauses regardless of policy. Neither the HTTP API nor the UI exposes pipeline/stage info — only `rasen pipeline show --json` does (pipeline.ts).

The UI `GROUP_ORDER` (packages/ui/src/config/grouping.ts:8) is `Profile, Behavior, Autopilot, Telemetry, Project, Archive, Workflow, Advanced`.

## Goals / Non-Goals

**Goals:**
- Autopilot keys settable globally with per-project override; project still wins.
- Per-role handoff thresholds in machine config at both scopes, resolving coherently within the existing handoff chain.
- Autopilot and Workflow groups lead the config page.
- A read-only gates inventory exposed by the API and rendered in the Autopilot group, marking `vet` as always-pausing.
- Governance text (templates, generated skills, specs, docs) states the precedence chains with the global layer included — updated in this same change.

**Non-Goals:**
- Editing gates from the UI (item 4 is read-only display).
- Version bumps or republishing the UI package.
- Expanding scope of keys that are inherently per-project (`schema`, `projectId`).
- Adding per-role `maxRelays`/`stallLimit` (per-role tuning stays threshold-only, matching the pipeline schema).

## Decisions

### D1. Per-role handoff keys are five fixed registry entries keyed `handoff.roles.<role>`, not a wildcard family

The role set is closed — `planner`, `implementer`, `reviewer`, `fixer`, `shipper` (exactly `HandoffRolesSchema`). Five fixed `threshold`-typed registry entries per scope (10 entries total) are simpler than a wildcard family: they are registry-validatable, enumerable by the UI, and each round-trips through the schema. A wildcard (like `featureFlags`) would need a new validation path and can't enumerate its members for display.

The key path is `handoff.roles.<role>` (the role maps directly to a bare threshold), NOT `handoff.roles.<role>.threshold`. This mirrors pipeline YAML exactly (`handoff.roles.reviewer: 0.65`), so the config file shape, the pipeline YAML shape, and the resolution code all agree on one structure. The value type is the existing dual-form `threshold` (fraction in (0,1] or `{ remainingTokens: N }`).

Schema side: `ProjectConfigSchema.handoff` and `GlobalConfig.handoff` each gain an optional `roles` object reusing the same per-role threshold shape the pipeline registry already defines. The resilient project parser (`parseProjectConfigContent`, project-config.ts:475-493) extends to parse `handoff.roles.<role>` field-by-field (drop-with-warning per role, siblings survive), matching how it handles `handoff.threshold` today.

Alternative considered: a single `handoff.roles` object-typed key. Rejected — the registry has no object type and the UI edits one key at a time; five scalar keys render as five threshold controls with no new control kind.

### D2. Per-role machine thresholds slot into the handoff chain as role-beats-scalar within each scope tier

The current threshold precedence in `resolveStageHandoffConfig` (types.ts:515-522) is: stage > pipeline-role > pipeline-scalar > project-scalar > global-scalar > preset > default. The new per-role machine layers slot so that within each machine scope tier, role-specific beats scalar — mirroring how pipeline-role (layer 2) beats pipeline-scalar (layer 3) at the pipeline tier. The expanded chain:

1. stage `handoff.threshold`
2. pipeline `handoff.roles[<role>]`
3. pipeline `handoff.threshold`
4. **project config `handoff.roles[<role>]`** (new)
5. project config `handoff.threshold` (scalar)
6. **global config `handoff.roles[<role>]`** (new)
7. global config `handoff.threshold` (scalar)
8. model preset
9. built-in default

`HandoffConfigLayers` (types.ts:473-476) grows from `{projectThreshold, globalThreshold}` to also carry `projectRoles?` / `globalRoles?` (role→threshold maps). `resolveHandoffThresholdLayers` (effective-config.ts:161-187) populates them from `projectConfig.handoff?.roles` and the re-validated `globalConfig.handoff?.roles`. The `source` union in `ResolvedStageHandoffConfig` (types.ts:462-470) gains `project-role` and `global-role` members so provenance still names the exact layer that supplied the threshold.

Rationale: this is the only slotting that keeps the "role-specific beats scalar" invariant already true at the pipeline tier consistent at the machine tiers, and keeps project entirely ahead of global (the universal Rasen rule). It is provenance-first like the existing code.

### D3. Which project-only keys become global+project

- `autopilot.gates`, `autopilot.selection` → **both scopes.** This is the user's explicit ask and the core of the "global default, project override" model. Justified: a user wants one machine-wide autopilot posture, overridable per repo.
- `archive.timing`, `archive.destination` → **stay project-only.** Archive behavior is a property of how a specific repo manages its change history (in-repo vs external vs prune ties to that repo's layout). A machine-wide archive default is not obviously meaningful and the user did not ask for it; expanding scope we cannot justify is scope creep. Left project-only.
- `schema` → **stays project-only.** Inherently per-project (which workflow schema THIS project uses); a global default is nonsensical.
- `projectId` → not settable (machine-managed), unchanged.
- `handoff.threshold` (+ new `handoff.roles.*`) → **both scopes** (threshold already both; roles follow it).

### D4. Autopilot resolvers gain a global layer via the existing effective-config seam

`resolveAutopilotGatePolicy`/`resolveAutopilotSelectionPolicy` currently take `(projectConfig, flag)`. They need the global value too. Rather than have each resolver re-read global config, resolve the effective `autopilot.*` value through the same precedence the rest of the system uses. Two viable shapes:

- **(a)** Extend each resolver to accept an explicit `globalConfig` (or the pre-read global value) and insert the layer: `flag > project > global > default`, with `source` union gaining `'global'`.
- **(b)** Have callers pass the effective value from `resolveEffectiveConfig` and keep the resolver flag-vs-value only.

Decision: **(a)** — keep the resolvers as the single home of autopilot precedence (their existing contract; every consumer already routes through them), add a `globalConfig` parameter, insert the global layer between project and default, and extend `source` to `'flag' | 'config' | 'global' | 'default'`. Wait — the current `source` uses `'config'` for the project layer. To distinguish, the layer that produced the value becomes `'project'` or `'global'`; keep `'flag'` and `'default'`. Callers reading `.source` for display get accurate provenance. This is a small, local change to two sibling resolvers and their call sites; it does not touch the effective-config module.

### D5. New read-only `GET /api/v1/pipelines` endpoint reusing the CLI's pipeline loader

The router (config-api/router.ts) dispatches `/api/v1/*` with logic-free handlers over shared core modules. Add a `GET /api/v1/pipelines` route that calls the same registry loader the CLI uses (`listPipelinesWithInfo` + `loadPipelineByName`, pipeline-registry) against the launch project root, and returns, per pipeline: `{ name, description, stages: [{ id, role, skill, gate }] }` where `gate` is `false | true | 'vet'` — a trimmed projection of the CLI's `StageView` (pipeline.ts:89-109), carrying only what the gates inventory needs (no runtime/handoff/model detail). Read-only: GET only; non-GET → 405, matching the existing `/api/v1/config` guards. No pipeline logic is reimplemented in the handler.

Wire types (`wire-types.ts`) gain a `WirePipeline`/`WirePipelineStage` shape; the UI api client (`api/client.ts`, `api/types.ts`) gains a `getPipelines()` call.

Alternative considered: embed gate info inside the `autopilot.gates` config entry. Rejected — gates are pipeline data, not config-key data; conflating them would break the "entries come from the registry" contract and the serialize path.

### D8. Per-role agent model in machine config uses a dedicated `models` block (base + per-role), NOT a unified `agents.<role>` restructure

The user asked for per-agent MODEL config alongside the handoff threshold, framing it as "reviewer uses fable, everyone else uses sonnet". Three shapes were weighed:

- **(a) Unified `agents.<role>.{model, handoffThreshold}`** — one per-agent block. Rejected: (1) it can't express "everyone else uses sonnet" without a base default, which a role-only block lacks; (2) it forces moving the `handoff.roles.<role>` threshold keys (added earlier in THIS change) into `agents.<role>.handoffThreshold`, breaking D1's mirror of pipeline YAML's `handoff` block; (3) pipeline YAML is itself NOT unified (model lives under `agents.<role>.model`, threshold under `handoff.roles.<role>`), so there is no single "per-agent" structure to mirror.
- **(b) Mirror pipeline's `agents.<role>.model`** — machine key `agents.<role>.model`. Rejected: no base-default concept (pipeline YAML has none, but the user explicitly wants one — "其他用sonnet"); and registering only `model` under an `agents.<role>` block wrongly implies the other runtime fields (`runtime`, `sandbox`, `effort`, `sessionReuse`) are also machine-settable, which they are not in this change.
- **(c) Dedicated `models` block — CHOSEN.** Two key families: `models.default` (base model for all roles, string) and `models.roles.<role>` (five per-role overrides, string). Config file:
  ```yaml
  models:
    default: sonnet
    roles:
      reviewer: fable
  ```

Rationale for (c):
1. **Expresses the user's example directly:** `models.default: sonnet` + `models.roles.reviewer: fable` is exactly "reviewer uses fable, everyone else uses sonnet" — no need to set all five roles.
2. **Keeps D1/D2 intact:** the `handoff.threshold`/`handoff.roles.<role>` family is untouched and still mirrors pipeline YAML's `handoff` block; no restructure of unshipped work.
3. **Internally symmetric:** `models.default` + `models.roles.<role>` parallels the handoff family's scalar + `.roles.<role>` shape; the `.roles.<role>` segment is identical across both, so the two per-agent families read consistently.
4. **Deliberate divergence from pipeline `agents.<role>.model`:** machine config exposes ONLY model (not the full runtime override) and needs a base default pipeline YAML lacks; a flat `models` block is more ergonomic and doesn't imply other `agents.<role>` runtime fields are machine-settable. The two are different resolution LAYERS read by the same function from different sources — they need not share a path.

**Value type / validation:** model ids are the existing free-string form (`string` type). No hard enum — pipeline stage `model` is `z.string().min(1)` and `resolveModelPreset` does case-insensitive substring matching where an unknown id simply resolves to no preset (model-presets.ts). Machine model keys mirror that exactly: any non-empty string is accepted; the UI offers a datalist of known preset ids (`sonnet`, `fable`, `opus`, `haiku`, `gpt-5`, …) as soft suggestions, never a gate. New models must not require a code change.

**Precedence (model), mirroring D2's role-beats-scalar, project-beats-global slotting:**

1. stage `model` (stage-level override)
2. pipeline `agents.<role>.model` (pipeline role default — today's `source: 'agent'`)
3. **project config `models.roles.<role>`** (new)
4. **project config `models.default`** (new)
5. **global config `models.roles.<role>`** (new)
6. **global config `models.default`** (new)
7. runtime/session default (no model configured — the runtime picks its own; today's `source: 'default'`)

There is NO stage-level or pipeline-level `models.default` equivalent introduced — the base-default concept is machine-config-only, sitting between the pipeline role layer and the session default. `resolveStageRuntimeConfig(stage, pipeline)` gains an optional `modelLayers` parameter `{ projectRoles?, projectDefault?, globalRoles?, globalDefault? }` and inserts layers 3-6 into the MODEL field only (runtime/sandbox/effort resolution is unchanged); its `source` union gains config-layer members so `pipeline show` can report where the model came from. `resolveHandoffThresholdLayers` gets a sibling `resolveModelConfigLayers(projectRoot)` in effective-config.ts that reads and re-validates the machine `models` blocks.

**Consumers:** `resolveStageRuntimeConfig` is called by (1) `pipeline show`'s `toStageView` (pipeline.ts) — so `show --json`'s `stage.model` reflects the effective model incl. machine config; (2) `resolveStageHandoffConfig`'s internal preset lookup — which must thread `modelLayers` so the preset layer keys off the effective model; and (3) the `/rasen:auto` Step A.1 runtime resolution, which reads `pipeline show` — so it inherits the machine model layer for free once `show` threads it. Governance parity: the auto skill's runtime/model table text (auto.ts:78 — "Pipeline stages may also set … model …; invocation role flags override those defaults") must name the machine `models.*` config layer as a default source below pipeline agents. Owning spec: `opsx-pipeline-registry` (it governs `pipeline show` and stage resolution) gets a new ADDED requirement for machine-config model resolution — there is no existing testable requirement stating the model precedence today.

### D6. UI: group reorder + gates panel + per-role rows

- **Group order:** move `Autopilot` and `Workflow` to the front of `GROUP_ORDER` (grouping.ts): `['Autopilot', 'Workflow', 'Profile', 'Behavior', 'Telemetry', 'Project', 'Archive', 'Advanced']`. `grouping.test.ts` order assertion updates accordingly.
- **Gates inventory panel:** a new read-only component rendered in the Autopilot group, fed by `getPipelines()`. It lists pipelines and their gated stages, badging each `gate: 'vet'` stage as "Always pauses — cannot be disabled by gates-off" and `gate: true` stages as ordinary gates. Purely presentational; no writes.
- **Per-role threshold and model rows:** the five `handoff.roles.<role>` keys and the six `models.*` keys (`models.default` + five `models.roles.<role>`) are registry entries in the `Workflow` group, so they render automatically — thresholds as dual-form threshold controls (the `--threshold` control kind already exists) beside the base `handoff.threshold`, and models as string controls beside the base `models.default`. All eleven keys live in `Workflow` (kept in the user's named top-two groups rather than inventing a third), presented per-agent so each role's model + threshold read together as "per-role overrides of the base". The only new UI touch is the model control: a text input with a `datalist` of known preset ids (soft suggestions from the model-presets registry) — free text, no rejection. No new threshold control kind.

### D7. Governance-text parity is in-scope and mechanical

The Explore inventory identified every prose statement of the autopilot precedence. `.claude/skills/*/SKILL.md` are GENERATED from `src/core/templates/workflows/*.ts` via `skill-templates.ts` — so edit the template `.ts` sources and REGENERATE (build → `rasen update` / the skill-build step), never hand-edit the generated mirrors. Must-update set (becomes factually wrong): `src/core/templates/workflows/auto.ts:34,38` (+ regenerate `rasen-auto/SKILL.md`), `docs/autopilot.md:10`, `docs/zh/autopilot.md:9`, `project-config.ts` resolver JSDoc + `source` unions, `run-state.ts:134-135` comment, the two autopilot spec files, `config-keys.ts` scope declarations, `config-key-registry` spec enumeration. The two handoff chains that OMIT the config layers (`_orchestration.ts:255`, `docs/opsx-workflow-guide.md:215`) should also gain the project/global (and now per-role) config layers for completeness. The `vet` carve-out statements are orthogonal and stay as-is.

Note: a parallel worktree at `.claude/worktrees/config-ui/` holds duplicate copies; the implementer working there must apply the same edits in that tree (or the change lands in the main tree — coordination owned by the LEAD).

## Risks / Trade-offs

- **[Chain grows from 7 to 9 layers → harder to reason about]** → The two new layers preserve the existing invariant (role beats scalar; project beats global), and `source` provenance names the exact producing layer. Scenarios in the pipeline-handoff-config delta pin every new layer's behavior.
- **[Registry↔schema round-trip breaks if a role key is added to only one side]** → The existing round-trip test enforces parity; adding the 10 new entries to both the registry AND both schemas is a single task with the test as the gate.
- **[Generated skills drift if templates edited without regeneration]** → Task order regenerates skills after template edits; parity is verifiable by diffing generated output.
- **[New endpoint reads pipelines from the launch project root only]** → Consistent with how the config API's project addressing already works; the gates inventory is informational and the launch root is the natural scope. Per-project pipeline inventory via the `project` selector can be a follow-up if needed.
- **[`source: 'config'` → `'project'`/`'global'` rename in autopilot resolvers could surprise a consumer switching on the string]** → Grep consumers of `.source` for the autopilot resolvers; the values are display-only today. Update the run-state comment and any assertion.

## Migration Plan

Backward compatible; no data migration. Existing configs (project-only autopilot keys, scalar `handoff.threshold`) parse and resolve identically — the new layers only add resolution paths that were previously absent (they fall through to the same defaults). Rollback is a code revert; no persisted format changes (new keys are additive optional fields).

## Open Questions

- Should the gates inventory endpoint accept the `project` selector (per-project pipeline overrides) or is launch-root-only sufficient for v1? Leaning launch-root-only; revisit if project-local pipelines are common.
- Confirm whether any non-display consumer switches on the autopilot resolver `source` string before renaming `'config'` → `'project'`/`'global'` (implementer to grep at apply time).
