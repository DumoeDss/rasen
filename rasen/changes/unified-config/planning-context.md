# Planning Context — unified-config portfolio

## User intent (verbatim)
"我们当前的rasen配置不是很方便，尤其当前有很多配置项，比如no-gate,context自动handoff阈值等。我希望增加一个统一配置的入口" → office-hours 收敛为：统一配置层 + CLI 内置 config JSON API + `rasen config ui` + monorepo 可选 UI 包（平台毛坯房规格，配置页为首个模块）。用户拍板：B 方案（毛坯房）+ monorepo，"不装ui的就可以使用cli配置"。

## Established codebase facts (from LEAD's office-hours research — verify paths, do not re-derive)
- Machine-global config: `~/.rasen/config.json`, loaded via `src/core/global-config.ts` (`getGlobalConfig`/`saveGlobalConfig`), schema `src/core/config-schema.ts` (`GlobalConfigSchema`, zod passthrough). `rasen config set` only accepts known keys `profile|delivery|workflows|featureFlags` (`KNOWN_TOP_LEVEL_KEYS`, config-schema.ts:45); `proactive`/`repoMode` need `--allow-unknown`.
- Per-project config: `<project>/rasen/config.yaml`, `ProjectConfigSchema` in `src/core/project-config.ts:25`. All ~10 options hand-edit only. `rasen config --scope project` explicitly rejected ("not yet implemented", `src/commands/config.ts:219-225`).
- Gate: `autopilot.gates on|off` in project config, per-run `--no-gate` override, resolver `resolveAutopilotGatePolicy` (`src/core/project-config.ts:773`).
- Context handoff threshold: **NOT a config key today** — occupancy computed by `src/commands/context.ts` / `src/core/agent-context.ts`, thresholds live in skill prose + pipeline `handoff` config; only per-invocation `--limit`. Must be promoted to a real config key (project-level, with global fallback) before any UI can expose it.
- Telemetry opt-out: env-only (`RASEN_TELEMETRY=0`, `DO_NOT_TRACK`); `src/telemetry/config.ts` shares `~/.rasen/config.json` (key `telemetry`).
- Config command: `src/commands/config.ts` (path/list/get/set/unset/reset/edit/profile), registered `src/cli/index.ts:352`.
- No web frontend exists; `website/` is a Fumadocs docs site only. Only TUI: `rasen view`, `src/ui/`.
- Repo history: a stray root `pnpm-workspace.yaml` once broke `pnpm run` and was deleted — monorepo work must reintroduce workspace config deliberately without breaking single-package workflows.

## Decomposition plan + dependency rationale
1. **unified-config-layer** (no deps) — `--scope project` read/write for config.yaml; promote scattered options to formal keys (autopilot.gates, new handoff-threshold key, telemetry enable/disable, proactive, repoMode → KNOWN keys); no-arg `rasen config` interactive editor (grouped keys, current values, source annotation global|project|default|env).
2. **unified-config-api** (depends on 1) — in-CLI localhost HTTP JSON API exposing the unified layer (list/get/set with scope + source metadata); `rasen config ui` command: starts server, serves UI static assets if the optional UI package is resolvable, else prints install hint. API contract is the future management platform's foundation — document it.
3. **unified-config-ui-pkg** (depends on 2) — monorepo: root stays the main `rasen` package; add `packages/ui` (or similar) as separately-published optional package of pure static build output; platform-shell scope: routing/layout skeleton + typed API client + config page as first module. Release/CI dual-publish changes must stay version-agnostic (version bumps are the user's call — hard rule).

## Constraints / decisions already made
- UI is optional: CLI-only users lose nothing. API lives in CLI, UI package is static assets only — zero config logic duplication.
- Platform pre-building restraint: shell only (routing, layout, API client); do NOT pre-build kanban/task/session-supervision state management.
- Version discipline: never bump major/minor; release-adjacent changes read version from package.json.
- Serial execution 1→2→3 (dependency edges + overlapping touch-sets).

## Durable findings appended by workers
(append below; decisions and discovered constraints only)

### unified-config-layer planner (2026-07-16)
- **API-sibling contract locked (design D5):** `resolveEffectiveConfig({ projectRoot? })` in new `src/core/effective-config.ts` returns `EffectiveConfigEntry[]` — `{ definition, value, source: 'default'|'global'|'project'|'env-override', scopeValues: { global?, project? } }`. It plus `updateProjectConfigKey()` (new, in project-config.ts) and `saveGlobalConfig()` are the complete in-process surface the HTTP API child wraps; no command-layer logic needed. `projectRoot` is an explicit parameter (not cwd-derived) precisely so the API can serve any registered project.
- **Key registry is the second reusable module (design D1):** new `src/core/config-keys.ts` declarative table (key, scopes, type/enum, validator, default, description, group) — the API/UI siblings should derive their form schema from it, not re-declare keys.
- **handoff.threshold precedence decision (design D2):** config layers slot BELOW pipeline YAML (stage > role > pipeline > project config > global config > default 0.5), threshold only — maxRelays/stallLimit stay pipeline/default. Verified only `pipelines/goal-loop-research` declares a handoff block, so the config key is effective in practice everywhere. `resolveStageHandoffConfig` stays pure: config values passed in as an optional arg, callers do the I/O.
- **Telemetry constraint discovered:** `isTelemetryEnabled()` (src/telemetry/index.ts) is synchronous while src/telemetry/config.ts is async — the toggle uses a memoized sync `readFileSync` of ~/.rasen/config.json, failing open to enabled. `telemetry.anonymousId`/`noticeSeen` are machine-managed, marked not-settable in the registry.
- **Project YAML writes must be comment-preserving:** no programmatic write path to rasen/config.yaml existed; D4 mandates `yaml` `parseDocument` (document-tree edit), never object re-serialization. Free-form fields (context, rules, quality-rules, references) stay hand-edit-only — excluded from registry/editor/API alike.
- **Store/project-flag routing deliberately out of scope for child 1:** `--scope project` uses nearest-root resolution; explicit project-id addressing is deferred to the API sibling (which takes project ids).

### unified-config-layer reviewer (2026-07-16, round 1: 0B/2M/6m/5t)
- **`--scope` parses on the parent `config` command** — any subcommand not routed through `runScoped` silently accepts `--scope project` while acting globally (round-1 M1; fixed in-loop). API sibling: route EVERY endpoint through explicit scope resolution, never assume.
- **Constraint parity is manual:** global values validate via zod (GlobalConfigSchema) only; registry `validate` fns enforce at project scope + editor. config-keys.ts and GlobalConfigSchema must be kept in sync by hand — API sibling should validate through the registry for BOTH scopes to close the gap.
- **`getGlobalConfig()` does no schema validation on read** — hand-edited invalid values (e.g. `handoff.threshold: 5`) propagate silently into resolution. The config-api sibling inherits this; consider read-time validation or API-side clamping.

### unified-config-api planner (2026-07-16)
- **API contract locked (design D2, normative for ui-pkg child):** `/api/v1/` — GET health | GET config (list) | GET/PUT/DELETE config/<key> | GET projects. Wire shape = `EffectiveConfigEntry` with `definition.validate` replaced by serializable `constraints` (`{type, enumValues?, range?}`) + per-entry `warnings[]` for invalid on-disk values (reviewer finding (c) answered by reporting, never clamping/rewriting). Uniform errors `{ error: { code, message, fix? } }` (codes: unknown_key, invalid_value, scope_required, not_settable, project_not_found, unauthorized). Writes scope-EXPLICIT (required field, no default), registry-validated for BOTH scopes (closes MIN1 parity gap on the API side).
- **MIN4 answered:** API global writes use minimal-diff raw-file semantics (read raw JSON → apply target key only → GlobalConfigSchema validate → save), never getGlobalConfig()-merge — spec has a regression scenario (never-set keys stay absent, source annotations stay `default`). CLI adopting the same helper is a flagged follow-up, out of scope.
- **Project addressing:** `?project=<projectId|absolute root>` resolved via machine project registry (id match, then canonical-root match, else 404 project_not_found); omitted = launch project (nullable); project-scope write with no resolvable project errors, never falls back to global. `GET /api/v1/projects` returns `{projectId, name, root}` — the platform's project-switcher seed. Store namespace deliberately excluded from v1.
- **Security posture:** 127.0.0.1-only bind, ephemeral port (--port to pin), per-session `crypto.randomBytes(32)` bearer token delivered via URL **fragment**, zero CORS headers, `application/json` required on mutations (CSRF/DNS-rebind defenses). Jupyter-class local posture; no cookies/TLS/daemon.
- **Exit-hang constraint designed in (D6):** server tracks sockets in a Set and force-destroys them on SIGINT/SIGTERM (`server.close()` alone waits on browser keep-alives = the historical ~10s hang class), 2s guard timer + process.exit backstop; browser opener spawned detached + unref'd (no npm `open` package).
- **UI-pkg contract for child 3 (D7):** package name lives in ONE constant module (working name `@atelierai/rasen-ui`, final name = user decision); resolution = createRequire-from-CLI-install probe then sibling-directory probe (pnpm isolated global layout); asset contract = statics under `dist/`, entry `dist/index.html`, served with index-fallback + no-store. Absent package → API fully usable, `/` serves built-in install-hint page.
- **Capability layout decision:** child 2 delta specs are ADDED-only in two new capabilities (`config-http-api`, `config-ui-command`) — deliberately no second delta stacked on cli-config's Command Structure requirement (child 1's unarchived delta already modifies it; stacking would create archive-order conflicts). Child 3 should follow the same pattern (own capability, no cli-config delta).
- **No new dependencies:** Node built-in `http` + hand-rolled router; body cap 64KB.

