> **Dependency note**: implemented in the MAIN tree, gated on `ui-config-redesign-store-scope` (W1) being review-clean there (W1's three-scope chain is the substrate; it is already landed in code). May run in parallel with `ui-config-redesign-config-page` (W2) only if the LEAD confirms the cohort — the touch-sets are disjoint by design (this child: `src/core/**` + tests; W2: `packages/ui/**`). Backend machinery ONLY: no UI, no Pipelines endpoints, no gate-mask/model/handoff consumer semantics (those are W3's).
>
> **Merge point**: `src/core/global-config.ts` gains a `pipelines` block while W6's worktree adds a `ui` block to the same schema — both additive; LEAD reconciles at merge.

## 1. Family pattern machinery (config-keys.ts)

- [x] 1.1 Add the pattern descriptor to wildcard registry entries: a canonical fixed-shape template with literal and `<placeholder>` segments (design D1). Implement one matcher — segment count equal, literals exact, placeholders validated as `[A-Za-z0-9_-]+` — and derive `featureFlags`'s existing two-segment global-only behavior from it (serialized `key: 'featureFlags'` unchanged for wire compatibility; the boolean-nested-keys rejection message generalizes to name the family pattern).
- [x] 1.2 Register the three `pipelines.*` families: `pipelines.<name>.gates.<stage>` (enum `on`/`off`), `pipelines.<name>.models.<stage>` (non-empty string via the existing model-id validator), `pipelines.<name>.handoff.<stage>` (existing dual-form `threshold` type) — all `scopes: ['global','store','project']`, group `Pipelines`, no default value.
- [x] 1.3 Generalize `validateConfigKeyPath` and `findWildcardDefinition` callers onto the matcher: family instance paths validate per family scopes; wrong-shape paths reject naming the pattern; unknown referents accepted (structural validation only, design D3). Keep `NOT_SETTABLE_KEYS` handling and fixed-key behavior byte-identical.
- [x] 1.4 Unit tests in `test/core/` for the matcher and validation: all four families × (valid instance, wrong shape, bad placeholder charset, wrong scope, bad value), plus featureFlags regression cases asserting identical accept/reject behavior to before (including the store-scope rejection W1's delta pins).

## 2. Storage schemas

- [x] 2.1 `src/core/global-config.ts`: add the typed `pipelines` block (`Record<name, { gates?/models?/handoff? per-stage records }>`) to the global config type and schema; unknown sub-keys ignored with a warning, never a hard error. Note in a doc comment that the block name shares nothing with the `rasen/pipelines/` directory namespace.
- [x] 2.2 `src/core/project-config.ts`: parse the same `pipelines` block resiliently on planning-root `rasen/config.yaml` (serving both project and store layers), dropping invalid leaves with warnings like `handoff.roles` does.
- [x] 2.3 Extend the registry↔schema round-trip test: one set instance per family round-trips through the schema of every scope the family declares (global JSON and planning-root YAML — build any expected paths with `path.join`). Do not add registry key-count assertions (portfolio rule).

## 3. Effective resolution

- [x] 3.1 `src/core/effective-config.ts`: replace the wildcard `continue` with template-entry emission plus instance enumeration (design D4) — collect set instance paths under each family's pattern from the raw global record, store layer, and project layer (scope-gated), resolve each through the standard precedence, and emit entries carrying a new `instanceKey` field alongside the family `definition`. Invalid on-disk instance values report warnings and are skipped, mirroring existing handling.
- [x] 3.2 Wire the field through `src/core/config-api/serialize.ts` and `src/core/config-api/wire-types.ts` as an additive optional `instanceKey` on the serialized entry. Do NOT mirror it into `packages/ui/src/api/types.ts` — that mirror lands with W3 (keeps the W2 parallel touch-sets disjoint).
- [x] 3.3 Effective-config tests: instance present in one/multiple layers with correct source precedence; no instances → templates only; store-layer instance via an active store layer; absent ≠ defaulted for `pipelines.*`; featureFlags template entry unchanged.

## 4. Config API

- [x] 4.1 `src/core/config-api/router.ts`: rework `validateWriteKey` — remove the v1 `not_supported` carve-out; route instance paths through the family matcher; wrong-scope errors name the family's settable scopes (same shape as fixed keys); malformed shapes 400 naming the pattern. Update `respondWithReResolvedEntry` to re-resolve by instance key. Single-key GET: well-formed unset instance returns the absent shape, not `unknown_key`.
- [x] 4.2 Router tests: list includes set instances (project, store-space, and global cases); PUT/DELETE instance paths in each declared scope incl. the unset-reverts-to-wider-layer case; `featureFlags.<name>` PUT now succeeds at global and rejects other scopes naming `global`; malformed path and bad-value rejections; absent-shape GET.
- [x] 4.3 `src/commands/config.ts`: verify (expected no-op) that `config get/set/unset` handle the new families through the registry path, and that the interactive editor keeps family templates non-editable exactly as today; add a CLI-level test for `config set pipelines.<n>.gates.<s>` at project scope via a temp planning root.

## 5. Verification

- [x] 5.1 Full suite from the repo root (`node build.js` first for the CLI build); isolate-rerun any Windows CLI-spawn EBUSY/10s flakes before treating them as regressions; confirm the Windows CI matrix implications are covered (all test paths built with `path.join`, no hardcoded separators).
- [x] 5.2 Grep-verify the boundary: no reads of `pipelines.*` config reach `pipeline-registry/`, stage resolvers, or template prose in this change (consumer wiring is W3's), and `packages/ui/**` has zero diffs.
- [x] 5.3 From the repo root: `rasen validate ui-config-redesign-wildcard-config --strict`.
