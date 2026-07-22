## Why

Per-pipeline, per-stage configuration (`pipelines.<name>.gates.<stage>` etc.) is the ratified persistence model for the Pipelines page (W3 of `rasen/office-hours/ui-config-and-library-redesign.md`, Fork 3A: config-key namespace, not YAML forking). The wildcard config machinery cannot carry it: `featureFlags.<name>` is the only wildcard family, hard-limited to global scope and exactly two segments (`config-keys.ts` documents the special case), the effective-config resolver skips wildcard families entirely, and the config HTTP API rejects wildcard writes with a v1 `not_supported` carve-out. This enabler grows the machinery; the design doc calls it the largest single piece of backend work and budgets it separately from the page.

## What Changes

- **Wildcard families become pattern-described registry entries**: a family declares a fixed-shape dot-path template with placeholder segments, its settable scopes, value type/constraints, group, and description. `featureFlags.<name>` is re-expressed through the same mechanism with byte-identical behavior (global-only, boolean, two segments) — one matcher, no parallel special case.
- **Three new families registered** for W3 to consume (machinery only — no consumer semantics wired):
  - `pipelines.<name>.gates.<stage>` — enum `on | off`, scopes global/store/project
  - `pipelines.<name>.models.<stage>` — model id string (non-empty, no allow-list), scopes global/store/project
  - `pipelines.<name>.handoff.<stage>` — dual-form threshold (fraction or `{ remainingTokens: N }`), scopes global/store/project
  All three carry a new `Pipelines` display group and **no default value** — an unset instance is absent, not defaulted.
- **Placeholder segments validate structurally** (non-empty, conservative identifier charset), never against pipeline/stage existence — config validation stays decoupled from space-dependent pipeline resolution, mirroring how `featureFlags.<name>` accepts any flag name today.
- **Set family instances become visible**: effective-config resolution enumerates every instance set in any contributing layer as a first-class entry (instance key + per-scope values + standard `env > project > store > global` precedence), instead of skipping wildcard families. The family template entries remain listed as display metadata.
- **The config HTTP API serves instances**: list responses include set instances; single-key get/set/unset accept fully-qualified instance paths under each family's scopes (the v1 `not_supported` carve-out is lifted for all families, including `featureFlags`), with the same wrong-scope guidance as ordinary keys.
- **Config file schemas admit the `pipelines` block** in global config and in planning-root `rasen/config.yaml` (project and store layers), round-tripping like every registry key.
- Explicitly NOT here (W3's scope): the `autopilot.gates` mask precedence, wiring the model/handoff chain slots into stage resolvers, the Pipelines page and its endpoints, `pipeline agents` re-pointing, and any UI work.

## Capabilities

### New Capabilities

(none — the machinery belongs to the existing registry and API capabilities)

### Modified Capabilities
- `config-key-registry`: gains an ADDED-only requirement defining wildcard key families (pattern shape, per-family scopes/type/constraints, structural segment validation, the three `pipelines.*` families, `featureFlags` unified under the same mechanism unchanged). Deliberately additive — it does not touch the registry requirement W1 replaced or the key W6 adds, so it is order-independent with both pending deltas.
- `config-http-api`: gains an ADDED-only requirement making family instances first-class API keys (list visibility, get/set/unset by instance path, scope errors). Also additive against W1's pending ADDED text — no requirement is removed or modified.

## Impact

**Touched files (enumerated for the parallel-cohort decision — fully disjoint from W2's `packages/ui/**` touch-set):**
- `src/core/config-keys.ts` — family pattern descriptor + matcher, `validateConfigKeyPath` family branch generalized, three new registry entries, `findWildcardDefinition` signature evolution
- `src/core/effective-config.ts` — instance enumeration in `resolveEffectiveConfig` (union of set instances across raw global / store / project layers), instance-key field on `EffectiveConfigEntry`
- `src/core/global-config.ts` — `pipelines` block on the global config type/schema (**LEAD merge point: W6's worktree adds a `ui` block to the same schema**)
- `src/core/project-config.ts` — `pipelines` block parsed (resiliently) on planning-root config
- `src/core/config-api/router.ts` — `validateWriteKey` admits instance paths (carve-out lifted), re-resolve-by-instance-key on write responses
- `src/core/config-api/serialize.ts`, `src/core/config-api/wire-types.ts` — instance key on the wire entry
- `src/commands/config.ts` — verify-only expected (get/set/unset and the editor derive from the registry; the editor keeps family templates non-editable)
- Tests: `test/core/config-keys*`, effective-config, config-api router, global/project config schema round-trip
- **Dependency**: W1 (`ui-config-redesign-store-scope`) landed — verified in code (the store layer and three-scope registry are on main). Implementation gated on W1 review-clean, same edge as W2; W2 and this child touch disjoint files and may run in parallel if the LEAD confirms the cohort.
- Not touched: `packages/ui/**`, pipeline-registry resolvers, autopilot semantics, templates, versions.
