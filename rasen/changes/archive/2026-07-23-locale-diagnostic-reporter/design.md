## Context

`reportConfigDiagnostic()` (`src/core/config-diagnostics.ts`) is the single choke point every config/CLI diagnostic passes through. It prints `diagnostic.fallback` (hardcoded English, via `console.error`/`console.warn`) whenever the caller doesn't supply a `reporter`. A locale-aware reporter exists — `createConfigDiagnosticReporter()` in `src/commands/config-messages.ts` — but only two commands (`config`, `profile`) wire it. Four other call sites never pass a reporter and are permanently English:

1. `checkSkillVersionGuard` (`src/core/root-selection.ts:728`, key `skillVersionMismatch`)
2. `expertSelectionMigration` (`src/core/update.ts:200`, key `expertSelectionMigration`)
3. `deliveryRetired` (`src/core/global-config.ts:324`, inside `getGlobalConfig()`)
4. `invalidGlobalJson` (`src/core/global-config.ts:347`, inside `getGlobalConfig()`, JSON parse-failure branch)

This is not an oversight with no explanation — it reflects a real, already-solved constraint. `getCliLocale()` (`src/core/cli-locale.ts`) resolves the session locale FROM the global config's `language` field:

```ts
export function getCliLocale(): CliLocale {
  return resolveCliLocale({
    language: getGlobalConfig({ reporter: () => {}, persistMigrations: false }).language ?? 'auto',
  });
}
```

It deliberately passes a no-op `reporter` and `persistMigrations: false` — a silent, side-effect-free probe read — because locale resolution itself depends on reading config, and any diagnostic *about* that same config read cannot yet know the locale it should render in. The import graph is `cli-locale.ts` → `global-config.ts` → `config-diagnostics.ts`. `config-diagnostics.ts`'s own doc comment calls it locale-neutral, with `fallback` existing "for programmatic callers that do not provide a reporter" — i.e. it is intentionally a dependency-free primitive, not meant to know about locale at all.

Two consequences follow:
- `config-diagnostics.ts` must not import `cli-locale.ts` (or anything that transitively resolves locale) — doing so would either recreate a 3-file cycle through `global-config.ts`, or force every diagnostic-reporting call to pay for a hidden locale-bootstrap.
- `global-config.ts` must not import `cli-locale.ts` directly either — that's a tight 2-file cycle (`global-config.ts` ↔ `cli-locale.ts`) that only stays acyclic today because `cli-locale.ts`'s one call site explicitly overrides `reporter`/`persistMigrations`. Adding a second, less careful edge between these two files is a landmine for a future edit to reintroduce infinite recursion.

Separately, `createConfigDiagnosticReporter`/`formatConfigDiagnostic` currently live in `src/commands/config-messages.ts`, a commands-layer file. `root-selection.ts`, `update.ts`, and `global-config.ts` are core-layer, and core never imports from `commands/` anywhere in this codebase today (verified by grep) — importing `config-messages.ts` from any of them would be a new layering violation. Core files *do* already import directly from `src/locales/` elsewhere (`src/core/completions/description-localization.ts`, `src/core/workflow-chain.ts`), so locale-catalog access from core is an established, safe pattern — the factory functions are just one layer too high today.

## Goals / Non-Goals

**Goals:**
- All four call sites render diagnostics in the session's resolved CLI locale when one can be determined.
- `getGlobalConfig()`'s own two diagnostics become locale-aware for every current and future caller that omits `options.reporter` — not just a fix scoped to two named call sites.
- No NEW direct import edge into the config/locale cycle pair; the one transitive module-graph cycle this introduces is verified inert on three static grounds (see D3) — no module-eval-time cross-reads, no runtime re-entry, load-safe bindings.
- English fallback is preserved byte-for-byte as the safety net when locale/catalog resolution fails.

**Non-Goals:**
- No changes to any locale catalog text (`en`/`ja`/`zh-cn` JSON files) — all four diagnostic keys already have entries.
- No new config keys.
- No change to `config`/`profile`'s existing reporter wiring (already correct).
- No attempt to retroactively localize every `getGlobalConfig()` caller's *other* behavior — only the two diagnostics `getGlobalConfig()` itself emits.

## Decisions

### D1: Relocate the reporter factory to a new core-layer module, not into `config-diagnostics.ts`

New file: `src/core/config-diagnostic-locale.ts`. It imports `ConfigDiagnostic`/`ConfigDiagnosticReporter` types from `./config-diagnostics.js`, `getCliLocale` from `./cli-locale.js`, `getLocaleCatalog`/`formatLocaleMessage` from `../locales/index.js`, and `CliLocale` from `../utils/locale.js`. It exports `formatConfigDiagnostic(diagnostic, locale = getCliLocale())` and `createConfigDiagnosticReporter(locale = getCliLocale())`, moved verbatim (same behavior) from `config-messages.ts`.

`config-diagnostics.ts`, `cli-locale.ts`, `locales/index.ts`, and `utils/locale.ts` never import the new module, so among *these four* it sits strictly above all of them with no cycle. This does not, by itself, make the new module cycle-free with respect to every future importer — see D3, which adds `global-config.ts` as a fifth module importing it and reintroduces a transitive (not direct) cycle through `cli-locale.ts`. That cycle is real but provably inert; D3 documents why.

`src/commands/config-messages.ts` re-exports both names from the new module (`export { formatConfigDiagnostic, createConfigDiagnosticReporter } from '../core/config-diagnostic-locale.js';`) so `config.ts`, `profile.ts`, and `profile-editor.ts` need no changes.

**Alternative considered**: add the locale-aware default directly inside `config-diagnostics.ts`. Rejected — contradicts that module's documented locale-neutral contract and reintroduces the 3-file cycle risk described above.

**Alternative considered**: import `config-messages.ts` directly from the three core files. Rejected — core does not depend on commands/ anywhere today; this would be a new, one-off layering violation for no structural benefit over D1.

### D2: `checkSkillVersionGuard` / `expertSelectionMigration` — explicit per-call-site wiring

Both files sit outside the `cli-locale.ts` ↔ `global-config.ts` cycle (neither is imported by either of those two), so they can safely import `createConfigDiagnosticReporter` from the new core module and pass it explicitly:

```ts
reportConfigDiagnostic({ key: 'skillVersionMismatch', ... }, createConfigDiagnosticReporter());
```

`getGlobalConfig()` and `getCliLocale()` both already swallow every internal error and never throw (`getGlobalConfig`'s try/catch returns `DEFAULT_CONFIG` on any failure; `getCliLocale` has no code path that throws), so `createConfigDiagnosticReporter()` cannot itself throw here. `checkSkillVersionGuard` already wraps its whole body in try/catch (existing best-effort contract); `expertSelectionMigration`'s call site gets no additional try/catch since none is needed.

### D3: `deliveryRetired` / `invalidGlobalJson` — default reporter inside `getGlobalConfig()`, without importing `cli-locale.ts`

Per the proposal's priority (fix the helper's default behavior first), `getGlobalConfig()` builds its own reporter when `options.reporter` is `undefined`, so every caller that omits a reporter — not just these two keys — benefits automatically, including future diagnostics added to this function.

To avoid re-creating the `global-config.ts` ↔ `cli-locale.ts` cycle, locale is derived from data already in scope at each site, using `resolveCliLocale` from `src/utils/locale.ts` (a zero-dependency leaf module `global-config.ts` already partially imports) — never `getCliLocale()`:

- `deliveryRetired` (line ~324): `merged.language` has already been resolved a few lines earlier in the same function. Use `resolveCliLocale({ language: merged.language })`.
- `invalidGlobalJson` (line ~347): the file failed `JSON.parse`, so no `language` field is available. Use `resolveCliLocale({})` — environment/OS-based detection only, the same graceful degradation `resolveCliLocale` already performs when no explicit language is given.

Both sites then call the D1 module's `createConfigDiagnosticReporter(locale)` with this **explicit** locale argument — never relying on that function's own `= getCliLocale()` default. `global-config.ts` never imports `./cli-locale.js` *directly* — that specific edge is genuinely absent. It does, however, import `config-diagnostic-locale.ts` (D1), which itself imports `cli-locale.ts`, which imports `global-config.ts` — a real, transitive three-file cycle at the ES module graph level (`global-config.ts` → `config-diagnostic-locale.ts` → `cli-locale.ts` → `global-config.ts`). This cycle is not eliminated; it is present and provably inert, verified on three grounds rather than assumed:

1. **No module-eval-time cross-reads.** All three modules only reference each other's exports from inside function bodies invoked after the module graph has finished loading — none of them reads another cyclic module's binding at top-level/import time, which is the only way an ESM cycle actually breaks.
2. **Explicit locale arguments prevent runtime recursion.** Every call site in `global-config.ts` passes `resolveCliLocale(...)` as an explicit `locale` argument to `createConfigDiagnosticReporter(locale)`, never invoking its `= getCliLocale()` default. `getCliLocale()` (and therefore `getGlobalConfig()`) is consequently never re-entered from inside `getGlobalConfig()`'s own execution — the specific hazard this design is guarding against.
3. **Hoisted function declarations + ESM live bindings make the cycle load-safe.** `getCliLocale`, `createConfigDiagnosticReporter`, and `getGlobalConfig` are all function declarations/exports resolved via live bindings; by the time any of them is actually called, the whole cycle has finished initializing, so there is no temporal-dead-zone or "used before defined" failure mode here.

Net effect: the direct-import constraint holds, but "cycle risk structurally eliminated" overstates it — the honest claim is "cycle present, verified inert."

```ts
const reporter = options.reporter ?? safeDefaultReporter(resolveCliLocale({ language: merged.language }));
reportConfigDiagnostic({ key: 'deliveryRetired', ... }, reporter);
```

where `safeDefaultReporter(locale)` wraps `createConfigDiagnosticReporter(locale)` construction in try/catch, falling back to `undefined` (i.e. `reportConfigDiagnostic`'s existing English `console.warn/error` path) on any unexpected failure — see D4.

**Alternative considered**: have `getGlobalConfig()` call `getCliLocale()` directly. Rejected — recreates the exact cycle `cli-locale.ts` was written to avoid, and is fragile: it works today only because `cli-locale.ts`'s call passes an explicit no-op reporter; a second, careless call site (this one) would have no such override and risks infinite recursion the moment `getGlobalConfig()`'s default path itself tries to resolve locale by calling `getGlobalConfig()` again.

### D4: Failure safety net

Every new reporter-construction call (D2 and D3) is wrapped so a thrown error falls back to the pre-existing `reportConfigDiagnostic(diagnostic)` no-reporter path (hardcoded English `diagnostic.fallback`) rather than propagating. This is defense-in-depth on top of D2/D3's already-provable-safe design (per D2, D3 above, none of these paths can currently throw) — it protects against a *future* change to `resolveCliLocale`/`getLocaleCatalog` introducing a throw without silently breaking every diagnostic call site.

### D5: Spec ownership — new capability, not a MODIFY of `skill-version-guard`

`checkSkillVersionGuard`'s owning capability, `skill-version-guard`, has no mainline spec yet — it is itself an unarchived pending delta in a sibling change (`rasen/changes/delivery-reliability-version-guard/specs/skill-version-guard/spec.md`). A `MODIFIED Requirements` delta in this change would have nothing in `rasen/specs/skill-version-guard/spec.md` to modify against and may fail validation or conflict at archive time depending on which change lands first. No mainline capability (`cli-config`, `global-config`, `config-loading`, `config-resolution`) currently owns "diagnostics render in the resolved locale" either — it is a genuine, previously-unspecified cross-cutting behavior spanning four different command surfaces.

This change adds one new capability, `config-diagnostic-localization`, covering the cross-cutting locale/fallback contract. It does not re-specify `skill-version-guard`'s own mismatch-detection/debounce behavior (already specified there) — only that when it does report, it does so in the resolved locale.

## Risks / Trade-offs

- [Risk] A future edit adds a fifth `reportConfigDiagnostic()` call site inside `global-config.ts` without following the D3 pattern, silently landing back on English. → Mitigation: D3's helper is a single local function (`safeDefaultReporter`) intended to be reused for any future in-function diagnostic in `global-config.ts`, not inlined per call site.
- [Risk] Relocating exports out of `config-messages.ts` could break an import path some file assumes is stable. → Mitigation: re-export from `config-messages.ts` (D1) keeps every existing import path working unchanged; only new call sites import the new module directly.
- [Risk] `resolveCliLocale({})` (no explicit language, used for the JSON-parse-failure path) still depends on `process.env`/`os` state being consistent — acceptable, since this exactly matches `resolveCliLocale`'s existing "auto" behavior used elsewhere in the codebase when no language is known.

## Migration Plan

Pure additive/wiring change, no data migration. Deploys as a normal patch: relocate module, add explicit reporter wiring at four call sites, add tests. Rollback is a plain revert — no persisted state changes shape.
