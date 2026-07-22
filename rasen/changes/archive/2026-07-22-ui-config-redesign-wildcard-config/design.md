## Context

W3-enabler of the ratified `rasen/office-hours/ui-config-and-library-redesign.md`. Current machinery (verified in code, post-W1):
- `config-keys.ts`: `findWildcardDefinition(rootKey, scope)` matches only a root-key wildcard entry; `validateConfigKeyPath` hardcodes the family rule "exactly two segments" with a boolean-specific rejection message. `featureFlags` is the only wildcard entry (global-only, boolean, group Advanced, default false).
- `effective-config.ts:199`: `if (definition.wildcard) continue;` — set family instances are invisible to effective resolution, the API, and the UI (CLI `config list` prints the raw config dump, so instances do print there).
- `config-api/router.ts` `validateWriteKey`: any two-segment path whose root is a wildcard family is rejected `not_supported` ("not exposed via the config API in v1") before validation — a code-level carve-out with no spec text pinning it.
- W1 landed the three-scope chain: `resolveEffectiveConfig` merges env > project > store > global > default with per-key scope gating; store layer via `resolveConfigStoreLayer`; the registry requirement (W1's pending ADDED text) makes the registry the single source of key knowledge for CLI set/unset, the editor, the HTTP API, and effective resolution.
- Note the design doc calls the target "three-segment families"; the actual paths are four dot segments with two placeholders (`pipelines.<name>.gates.<stage>`). The machinery is therefore built pattern-shaped, not segment-counted.

## Goals / Non-Goals

**Goals:**
- One wildcard mechanism serving arbitrary fixed-shape families; `featureFlags` re-expressed through it with zero behavior change.
- The three `pipelines.*` families registered, validated, storable, resolvable, and API-addressable at global/store/project scope.
- Set instances visible as first-class effective-config entries so W3's page (and any API client) can read them per scope.

**Non-Goals:**
- No consumer semantics: nothing reads these families into gate/model/handoff decisions yet (W3 wires the `autopilot.gates` mask, model chain slot, and handoff chain slot).
- No UI work of any kind; no new endpoints; no Pipelines page.
- No `featureFlags` scope widening (stays global-only — design doc open question 2 explicitly deferred).
- No pipeline/stage existence validation (see D3).
- No CLI flag changes (`--scope store` stays absent; store-layer instances are written via the API or by running the CLI at the store root, per W1's accepted asymmetry).

## Decisions

**D1 — Families are pattern templates in the registry, and `featureFlags` migrates onto the mechanism.**
A wildcard registry entry gains a canonical pattern (`featureFlags.<name>`, `pipelines.<name>.gates.<stage>`): a fixed-length dot-path where literal segments must match exactly and `<placeholder>` segments accept validated identifiers. Matching replaces both the root-key lookup and the hardcoded two-segment rule: a candidate path matches a family iff segment count equals the pattern's and every literal segment matches; the rejection message for a wrong-shape path names the family's pattern (the old boolean-specific message survives only for `featureFlags`, generalized). `featureFlags` keeps its serialized `key: 'featureFlags'` (wire compatibility — the UI and tests key on it); new families use the full pattern string as their `key` since no compatibility exists to preserve. Alternative rejected: a parallel special case per family (the current shape) — three more families would mean four bespoke branches, and W3's registry additions should be table rows, not code.

**D2 — Family value semantics reuse existing types exactly.**
`gates` → enum `['on','off']` (the same vocabulary as `autopilot.gates`, which W3 redefines into a mask over these); `models` → string validated like `models.default` (non-empty, no allow-list); `handoff` → the dual-form `threshold` type (same `thresholdSchema` path as `handoff.threshold`). New families declare **no default value**: an unset instance is *absent* — W3's mask semantics need "no override" to be distinguishable from any concrete value, and defaulting per-instance values would fabricate entries for every conceivable (pipeline, stage) pair. `featureFlags` keeps its default (false) unchanged. Group: `Pipelines` (new group string; in W2's tab map it is unmapped and lands in the trailing bucket until W3 claims the keys for the Pipelines page — accepted transient, three read-only template rows plus any set instances).

**D3 — Placeholder segments validate structurally, never by existence.**
A placeholder accepts a conservative identifier (`[A-Za-z0-9_-]+`; non-empty by construction of the dot-split). No check that the pipeline or stage exists: config validation must stay a pure registry operation — pipeline resolution is space-dependent (`project > user > package`), so a global write for a pipeline that exists only in one project would be wrongly rejected, and the config layer would grow a dependency on the pipeline registry. Precedent: `featureFlags.<typo>` is accepted silently today. W3's UI writes only real (pipeline, stage) pairs it renders; a hand-typed CLI instance with a typo is inert config, exactly like a typo'd feature flag.

**D4 — Instance enumeration: union of set instances across contributing layers.**
`resolveEffectiveConfig` continues to emit the family *template* entry (definition metadata, no effective value — what the UI renders read-only today), and additionally emits one entry per instance path set in any layer the family's scopes admit: keys are collected from the raw global config, the store layer, and the project layer under the family's pattern, then each instance resolves through the standard chain (env layer never applies — no env override maps to a family instance). Each instance entry carries the full instance path in a new `instanceKey` field (wire: additive optional field on the serialized entry; the `definition` stays the family's), its per-scope raw values, and the winning source. Values failing the family's type validation at a layer are reported as warnings and skipped, mirroring the existing invalid-on-disk handling. Alternative rejected: replacing the template entry with instances — the template is what documents the family's existence when nothing is set.

**D5 — API: instances are ordinary keys; the v1 carve-out is lifted for every family.**
`validateWriteKey` routes an instance path to its family (pattern match), checks the requested scope against the family's scopes (wrong-scope errors name the settable scopes, exactly like fixed keys), validates the value against the family's type/constraints, and lets the generic dot-path write plumbing land it (`writeGlobalConfigKeyMinimalDiff` / `updateProjectConfigKey` already write arbitrary paths — validation was the only gate). Write/unset responses re-resolve by instance key. `featureFlags.<name>` becomes API-writable too (global scope only): keeping the carve-out for one family while lifting it for three others would preserve the special case D1 just removed; the CLI-vs-API asymmetry had no spec text pinning it and the "use the CLI instead" fix message becomes obsolete. GET of an unset but well-formed instance returns the absent shape (no value, empty scope values) rather than 404 — the path is valid; nothing is set.

**D6 — Storage: a typed `pipelines` block in both config schemas.**
Global config gains `pipelines?: Record<string, { gates?: Record<string, 'on'|'off'>; models?: Record<string, string>; handoff?: Record<string, ThresholdValue> }>` (**merge point: W6's worktree adds a `ui` block to the same global schema — LEAD reconciles, both additive**); project/store planning-root config parses the same block resiliently (invalid leaves dropped with warnings, like `handoff.roles`). W1's registry round-trip test discipline extends to family instances: a set instance must round-trip through the schema of each scope its family declares. The `pipelines` block name inside `config.yaml` does not collide with the `rasen/pipelines/` directory (different namespace entirely) — the doc comment says so where the block is declared.

## Risks / Trade-offs

- [Instance entries surface on the Config page before W3 gives them a home] → Transient by construction: the `Pipelines` group is unmapped in W2's tab map, so templates and instances land in the trailing bucket until W3 claims them. Nothing is hidden; nothing breaks.
- [Lifting the featureFlags API carve-out changes API behavior W2's UI may assume] → The UI renders wildcard entries read-only (`definition.wildcard` → readonly control) and never issues family writes; lifting a server-side rejection for requests the UI never sends is safe. The UI gaining flag-editing controls is future work, not W2's or this child's.
- [A `pipelines:` block hand-written with unknown sub-keys (not gates/models/handoff)] → Parsed resiliently: unknown sub-keys are ignored with a warning, never a hard error — consistent with every other config parse path.
- [Enumerating instances from three layers adds file reads to list resolution] → No new reads: `resolveEffectiveConfig` already reads all three layers; enumeration walks the already-parsed objects.
- [W2 runs in parallel and both touch wire shapes] → Different files (`src/core/config-api/wire-types.ts` here; `packages/ui/src/api/types.ts` in W2). The UI mirror gains `instanceKey` in W3, not W2 — W2 must not pre-mirror it (recorded in the findings log; keeps the touch-sets disjoint).

## Open Questions

- None blocking. (Whether `featureFlags` should someday gain store scope stays deferred — design doc OQ2; nothing here forecloses it.)
