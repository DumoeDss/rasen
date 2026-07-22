# Design — store becomes a configuration scope (W1)

## Context

Authoritative design: `rasen/office-hours/ui-config-and-library-redesign.md` §W1 + Premises (ratified 2026-07-22; forks are chosen, do not re-litigate). Verified current state:

- `ResolvedSpace = { type, id, name, root }` (`src/core/config-api/project-addressing.ts:31`); a store and a project both resolve to a planning root whose config is `readProjectConfig(root)` → `<root>/rasen/config.yaml`.
- The `store:` pointer is read by `readStorePointer` (`src/core/project-config.ts:882`); `classifyOpenSpecDir` (`project-config.ts:937`) pairs it with `hasPlanningShape`. Root selection (`src/core/root-selection.ts:429-439`) treats both-present as a warned no-op: `ignored-store-pointer` notice, local root wins.
- Layered resolvers today are two-layer (project > global): `resolveEffectiveConfig` / `resolveHandoffThresholdLayers` / `resolveModelConfigLayers` (`src/core/effective-config.ts`), `resolveAutopilotGatePolicy` / `resolveAutopilotSelectionPolicy` (`src/core/project-config.ts:1087,1135`), `resolveStageRuntimeConfig` / `resolveStageHandoffConfig` (`src/core/pipeline-registry/types.ts:449,588`, pure — layers passed in).
- Registry: 25 keys in `src/core/config-keys.ts`; `ConfigScope = 'global' | 'project'` (line 19). 8 global-only, 3 project-only, 14 dual.
- Config HTTP API addresses projects via `?project=` (`src/core/config-api/router.ts:141-159`); the management route group already resolves `?space=` via `resolveSpaceSelector` (`project-addressing.ts:94`). The UI's ConfigPage stubs out store spaces (`packages/ui/src/components/ConfigPage.tsx:70-77`).
- Store registry reads are async (`listRegisteredStores`, `src/core/store/registry.ts:422`, fs/promises).

## Goals / Non-Goals

**Goals:**
- `store: <id>` + local planning shape = configuration inheritance; notice changes from *ignored* to *inheriting*.
- Resolution chain `env > project > store > global > built-in` in every layered resolver, with `store` in every source vocabulary.
- Registry scope vocabulary gains `store` (14 dual keys and 3 project-only keys gain it; 8 global-only unchanged).
- Wire: `scopeValues { global?, store?, project? }`; minimal API surface so W2 can render store spaces and inherited values: `?space=` addressing on config endpoints + `scope: "store"` writes for store spaces + the contributing store ref in responses.
- CHANGELOG callout for the both-present behavior change.

**Non-Goals:**
- Any UI change (W2). `packages/ui` is untouched; the store-space stub stays until W2.
- Transitive inheritance (explicitly excluded by the ratified design — one hop).
- A CLI `--scope store` flag or new CLI store-addressing surface. Inside a store root the CLI's `--scope project` already addresses the store's own config file; that stays as-is.
- Wildcard (`featureFlags`) scope changes — global-only, untouched (W3's enabler child grows wildcards).
- `--store` / `--project` root-addressing flags — unchanged (declared assumption in the design doc).

## Decisions

### D1 — The inheritance edge is resolved by one async helper; the layered resolvers stay sync and take the store root as a parameter

New exported helper (in `src/core/effective-config.ts`, beside its consumers):

```ts
resolveConfigStoreLayer(projectRoot: string | null | undefined):
  Promise<{ storeId: string; storeRoot: string } | null>
```

Rules, in order:
1. No `projectRoot` → null.
2. `classifyOpenSpecDir(projectRoot)`: no planning shape, or no pointer, or malformed pointer → null (a config-only pointer repo needs no store layer — its root already resolves TO the store; malformed degrades like `deriveSpaceFromCwd` does).
3. `projectRoot` is itself a registered store's root (canonical comparison against `listRegisteredStores`) → null. This is the no-transitivity rule made mechanical: when the root IS a store, its own `store:` field is ignored; it also kills the self-pointing edge case (`storeRoot === projectRoot` duplicating layers).
4. Pointer names a registered store → `{ storeId, storeRoot: canonical store root }`. Unregistered → null (inheritance inactive, degrade; the notice layer reports it, see D5).

The store registry read is async, so the helper is async — but the existing layer resolvers are sync and deliberately pure (`resolveStageHandoffConfig`'s doc comment: "callers resolve the values"). Keeping them sync avoids an async ripple through pipeline resolution. So:

- `resolveEffectiveConfig(options)` gains `store?: { storeId: string; storeRoot: string } | null` in options.
- `resolveHandoffThresholdLayers(projectRoot?, storeRoot?)` and `resolveModelConfigLayers(projectRoot?, storeRoot?)` gain an optional second parameter.
- `resolveAutopilotGatePolicy(config, noGateFlag, globalConfig?, storeConfig?)` and `resolveAutopilotSelectionPolicy(config, autoSelectFlag, autoComposeFlag?, globalConfig?, storeConfig?)` gain an optional trailing `storeConfig` (a `ProjectConfig | null` read from the store root). Optional params keep every existing call site compiling and behaving identically (no store = today's behavior).
- Async call sites (`src/commands/pipeline.ts:253,808`, `src/commands/config.ts`, the config API router) `await resolveConfigStoreLayer(projectRoot)` once and pass the result down. `resolveHandoffThresholdReport` (`src/core/agent-context.ts:494`) becomes async and resolves the layer itself (its only caller, `src/commands/agent.ts:66`, is already async).

**Alternative rejected**: making the layer resolvers async — touches every pipeline-resolution call site and breaks the pure/sync design of `resolveStageHandoffConfig`. Also rejected: a sync duplicate of the store-registry read — two parsers for one registry file is drift waiting to happen.

### D2 — The store layer is read with `readProjectConfig(storeRoot)`; no new parser, no new validation tier

A store's own config is the same `rasen/config.yaml` shape. `readProjectConfig` already does resilient field-by-field validation (invalid values dropped with warnings), so the store layer needs no re-validation pass (unlike the raw global JSON read). In `resolveEffectiveConfig`, the store value for a key is read only when `definition.scopes.includes('store')`, mirroring the project-layer guard. Precedence merge order per key: env-override, then project, then store, then global, then default. `ConfigSource` gains `'store'` (`'default' | 'global' | 'store' | 'project' | 'env-override'`).

### D3 — When the addressed space IS a store, the store root occupies the store layer and the project layer is empty

`resolveEffectiveConfig({ store: { storeId, storeRoot } })` with no `projectRoot`: `scopeValues.project` stays undefined, `scopeValues.store` holds the store's own values, effective source for a value set there is `'store'`. One file, two roles: the same `rasen/config.yaml` is "Local" when the store is the active space and "the inherited layer" when a member project resolves. Writes for a store space go through `updateProjectConfigKey(storeRoot, key, value)` — the existing comment-preserving document-tree writer works on any root that has a `rasen/config.yaml`; only key validation differs (validated against the `store` scope).

**Note**: the CLI running inside a store root keeps reporting that root's own values as source `project` (it addresses the root as its local project scope). This is today's behavior and stays; only space-addressed API reads present a store root as the `store` scope. Accepted asymmetry — W1 does not add CLI store addressing.

### D4 — Registry: `ConfigScope` gains `'store'`; scope-list edits are data-only

`ConfigScope = 'global' | 'store' | 'project'`. Entries: the 14 `['global','project']` keys → `['global','store','project']`; `schema`, `archive.timing`, `archive.destination` → `['store','project']`; the 8 global-only keys unchanged. `findConfigKeyDefinition` / `findWildcardDefinition` / `validateConfigKeyPath` already take a scope parameter and need no logic change — `validateConfigKeyPath(key, 'store')` works as soon as the data lists the scope. The wildcard `featureFlags` entry stays `['global']`, so `findWildcardDefinition('featureFlags', 'store')` correctly returns undefined. The registry round-trip test gains a store-scope leg that validates store-scoped entries against the project config schema (a store's config file IS that shape).

### D5 — Root-selection notice: `ignored-store-pointer` splits into inheriting vs unregistered

In `resolveNearestOrDeclaredRoot`'s planning-shape branch (`root-selection.ts:431-439`), a well-formed pointer now resolves the registry (the function is already async) and emits one of two notice kinds replacing `ignored-store-pointer`:

- `inheriting-store-config { filePath, storeId }` — pointer names a registered store: "…declares store '<id>'; planning stays local and configuration inherits from that store."
- `inactive-store-pointer { filePath, storeId }` — pointer names an unregistered store: a warning that the declaration currently has no effect and how to register.

The notice must not claim inheritance that won't happen — that is why registration is checked at notice time. Wiring: `RootSelectionNotice` union (`root-selection.ts:78`), the default reporter (`:93`), `formatPipelineRootSelectionNotice` (`src/commands/pipeline-messages.ts:273`), the `PipelineMessages` key table, and the three locale catalogs (`src/locales/{en,zh-cn,ja}.json` — replace `ignoredStorePointerWarning` with the two new keys). A malformed pointer alongside planning shape stays silent exactly as today (value is undefined in that branch).

### D6 — Config API: `?space=` addressing added beside `?project=`; `scope: "store"` writes only for store spaces

Reads (`GET /api/v1/config`, `GET /api/v1/config/<key>`) and writes (PUT/DELETE):

- New optional `space` selector (query or body, same `project:`/`store:` grammar, resolved via the existing `resolveSpaceSelector`). Present together with `project` → 400 `bad_request` (one addressing mode per request). Omitted both → launch-project fallback, unchanged.
- `space=project:<id>` → behaves like `?project=` plus nothing extra (the inheritance layer applies to ALL project-addressed reads automatically — see below).
- `space=store:<id>` → store context: resolve entries per D3; responses report the space's store as the store-layer contributor.
- Every project-addressed read (old `?project=`, new `space=project:`, and the launch-project fallback) awaits `resolveConfigStoreLayer(projectRoot)` and passes it to resolution, so `scopeValues.store` appears wherever inheritance is active — `?project=` clients get the new field without opting in (additive JSON, byte-compat otherwise).
- List and single-key responses gain `store: { id: string; root: string } | null` — the store contributing the store layer (the inherited store for a project context; the space's own store for a store context). W2 needs the id for "继承自 store <id>" and the space-switch link.
- Writes: `scope` accepts `"store"`. Valid only when the addressed space is a store (store-space Local writes). A `store`-scope write addressed at a project (or with no space) → 400 `invalid_scope` with a fix pointing at addressing the store space. Conversely `scope: "project"` addressed at a store space → 400 `invalid_scope` (fix: use `"store"`). Global writes are space-independent, unchanged.
- `validateWriteKey`'s wrong-scope hinting (`router.ts:283-301`) generalizes from the binary other-scope guess to "the scopes this key IS settable in".

**Alternative rejected**: reusing `scope: "project"` to mean "local" at a store space — it would make the wire's source labels lie (`store` on read, `project` on write) and would break the registry's scope-membership validation story.

### D7 — Pipeline/policy layer shapes gain store members with the established naming

- `ModelConfigLayers` gains `storeRoles?` / `storeDefault?`; `ModelSource` gains `'store-role' | 'store-default'`; `resolveStageRuntimeConfig` slots them between project and global.
- `HandoffConfigLayers` gains `storeThreshold?` / `storeRoles?`; `ResolvedStageHandoffConfig['source']` gains `'store-role' | 'store-config'`; `resolveStageHandoffConfig` slots them between project and global (role beats scalar within the scope, as with the other two scopes).
- `ResolvedGatePolicy.source` / `ResolvedSelectionPolicy.source` gain `'store'`; run-state's recorded `gatePolicy.source` enum (`src/core/pipeline-registry/run-state.ts:145`) gains `'store'` (additive; old run-states parse unchanged).
- `HandoffThresholdSource` (agent-context) gains `'store'`.
- Template prose: `src/core/templates/workflows/auto.ts` §0.5/§0.6 precedence sentences insert the store layer ("project config > store config (when the project declares `store:` and keeps local planning) > global config"). The `rasen-auto` golden-master hash in `test/core/templates/skill-templates-parity.test.ts:159` is recomputed from the test's failure output.

### D8 — Compatibility is a documented behavior change, not a migration

A both-present project starts inheriting. No config file is rewritten, no flag gates it; the root-selection notice fires on every run with new wording, and `CHANGELOG.md` gets an Unreleased entry calling it out (a project that wants the old effective values removes the `store:` line or overrides keys locally — project layer always wins over store). Version untouched (user standing order).

## Risks / Trade-offs

- **[Async edge creep]** Call sites that forget to resolve the store layer silently lose inheritance for their surface. → Mitigation: the helper is the only way to get a store layer; tasks enumerate every call site (router, config command, pipeline command, agent-context); tests assert the store layer at each surface.
- **[Registry read per request]** The config API now reads the store registry on project-addressed requests. It already does comparable registry reads (`resolveProjectSelector`) per request; the store registry is a small file. Accepted.
- **[Both-present projects change behavior]** A user relying on the ignored state (unlikely — it warned on every run) sees new effective values only for keys the store sets and the project doesn't. → Mitigation: notice + CHANGELOG (D8); project layer always wins.
- **[Notice-time registry check adds I/O to root resolution]** Only on the rare both-present path; the function is already async and does registry work in its pointer-repo branch. Accepted.
- **[Locale key rename]** Dropping `ignoredStorePointerWarning` for two new keys requires all three catalogs in lockstep or format() falls back. → Mitigation: single task covering the type table, key list, and all three JSON files; pipeline-messages test updated alongside.

## Migration Plan

Pure additive code change; no data migration. Rollback = revert the commit. Old run-state files parse (source enum widened, not narrowed); old API clients ignore the new `store` response field and never send `scope: "store"`.

## Open Questions

None blocking. Two deliberate deferrals recorded in the ratified design: per-store `featureFlags` (stays global-only) and doc-facing wording if the `store:` dual meaning proves hard to explain (fallback `configStore:` key — only if implementation-stage docs work surfaces real confusion; code-wise the branch is one classification already shared by init/doctor/spaces).
