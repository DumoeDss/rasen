## Why

Half the space model has no configuration story: a store space shows a "coming soon" notice in the Config UI, and a project that declares `store: <store-id>` while keeping its own planning root gets a warning that the declaration is *ignored* — a dead state. Yet to the config layer a store and a project are the same kind of thing (both resolve to a planning root whose config is `<root>/rasen/config.yaml`), so teams cannot share configuration through a store even though every mechanical piece already exists. This change (W1 of the ratified ui-config-redesign design) makes the store a real configuration scope; the Config page UI that displays it is the next child (W2).

## What Changes

- **The `store:` pointer combined with a local planning shape gains meaning: configuration inheritance.** Today that combination is a warned no-op (`ignored-store-pointer`). After this change it means "my planning stays local, my configuration inherits from store X", and the root-selection notice changes from *ignored* to *inheriting*. A `store:` pointer with **no** local planning shape keeps its current pointer-repo semantics exactly (root redirects to the store; no separate store layer — the config already IS the store's, by root identity).
- **No transitivity.** Inheritance is one hop: a store's own `store:` field, if any, never contributes a second layer.
- **The configuration resolution chain becomes `env > project > store > global > built-in default`** in every layered resolver: effective-config resolution, handoff-threshold layers, model-config layers, and the autopilot gate/selection policy resolvers. Value sources gain a `store` member everywhere sources are reported (effective view, agent-context threshold report, run-state gate policy, pipeline stage views).
- **The config-key registry gains the `store` scope**: the 14 `['global','project']` keys become `['global','store','project']`; the 3 `['project']` keys (`schema`, `archive.timing`, `archive.destination`) become `['store','project']`; the 8 machine-level global-only keys are unchanged.
- **Wire shape**: `scopeValues` goes from `{ global?, project? }` to `{ global?, store?, project? }`; wire `ConfigSource` gains `'store'`; config list/get responses additionally report which store supplies the store layer (or null).
- **Config HTTP API space addressing (minimal surface for W2)**: config endpoints additionally accept the management API's `?space=` selector (`project:<id>` / `store:<id>`). When the addressed space IS a store, `scopeValues.project` is undefined, `scopeValues.store` holds the store's own values, and Local writes (`scope: "store"`) land in the store's own `rasen/config.yaml` through the same comment-preserving write path. A `store`-scope write addressed at a project space is rejected — a project edits its inherited store's values by switching space, not through a third write mode. Existing `?project=` addressing keeps working byte-compatibly.
- **Compatibility callout (CHANGELOG)**: a project currently in the both-present state (local planning shape + `store:` pointer) begins inheriting configuration where it previously did not. Not silent — the root-selection notice fires on every run and its wording changes. Version stays untouched.
- **Out of scope (W2, next child)**: all Config page UI — inherited-value display, read-only store rows, the page-level scope control. This change delivers backend + wire + registry + the minimal API surface only.

## Capabilities

### New Capabilities

- `store-config-inheritance`: the inheritance edge itself — what `store:` + local planning shape means, the pointer-repo case staying unchanged, no transitivity, degradation for unregistered/malformed pointers, and the changed root-selection notice.

### Modified Capabilities

- `config-resolution`: the effective-resolution precedence chain gains the store layer (`env > project > store > global > default`); `scopeValues` and sources gain `store`; resolution can address a store root directly (store space: store layer only, no project layer).
- `config-key-registry`: scope vocabulary becomes `global | store | project`; the 14 dual-scope keys and 3 project-only keys gain `store`; validation accepts the `store` scope.
- `config-http-api`: `?space=` addressing on config endpoints; `scope: "store"` writes for store spaces; list/get responses carry `scopeValues.store` and the contributing store reference; sources include `store`.
- `autopilot-gate-policy`: gate-policy precedence becomes flag > project > store > global > default.
- `autopilot-selection-policy`: selection-policy precedence becomes flags > project > store > global > default.
- `pipeline-handoff-config`: the handoff config resolution order gains `store-role` and `store-config` layers between the project and global config layers.
- `opsx-pipeline-registry`: the machine-config model layer gains store (`project-role > project-default > store-role > store-default > global-role > global-default`).
- `cli-agent-context`: the handoff threshold report resolves project, then store, then global, then default, and reports `store` as a source.

## Impact

- **Core**: `src/core/config-keys.ts` (scope type + registry entries), `src/core/effective-config.ts` (store layer in `resolveEffectiveConfig` / `resolveHandoffThresholdLayers` / `resolveModelConfigLayers`, new inheritance-edge resolver), `src/core/project-config.ts` (`resolveAutopilotGatePolicy` / `resolveAutopilotSelectionPolicy` store layer), `src/core/pipeline-registry/types.ts` (`ModelConfigLayers` / `HandoffConfigLayers` / source vocabularies), `src/core/pipeline-registry/run-state.ts` (gate-policy source enum), `src/core/root-selection.ts` (notice kind + wording), `src/core/agent-context.ts` (threshold report).
- **API**: `src/core/config-api/router.ts` (space addressing, store scope writes), `src/core/config-api/wire-types.ts`, `src/core/config-api/serialize.ts`.
- **CLI display**: `src/commands/config.ts` (effective view / editor pick up the store layer), `src/commands/pipeline.ts` (threads the store layer into stage views), `src/commands/agent.ts`, `src/commands/pipeline-messages.ts` + `src/locales/{en,zh-cn,ja}.json` (new notice message, `store` source label).
- **Templates**: `src/core/templates/workflows/auto.ts` §0.5/§0.6 precedence prose (gate/selection policy) — requires updating the golden-master hash in `test/core/templates/skill-templates-parity.test.ts`.
- **Docs**: `CHANGELOG.md` unreleased entry with the both-present compatibility callout. No version bump.
- **Tests**: config-keys round-trip, effective-config, config-api router/serialize, project-config policy resolvers, pipeline-registry types, agent-context, root-selection notice, locale catalogs.
