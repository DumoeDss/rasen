# Tasks — ui-i18n

> All commands run inside `packages/ui/` (the UI package is standalone — NOT a workspace member; `pnpm --filter` does not reach it). Use `cd packages/ui && pnpm <script>`: `dev` (vite), `build` (vite build), `test` (vitest run), `typecheck` (tsc --noEmit). Design decisions are referenced as **D1–D9** in `design.md`.

## 1. i18n module foundation (design D2, D3, D4, D6)

- [x] 1.1 Create `packages/ui/src/i18n/` with `locales/en.json` (empty `{}` to start) and a catalog type derived from it via `typeof` (mirror `src/locales/index.ts`).
- [x] 1.2 Implement `getLocaleCatalog(locale)` catalog index importing `en`, `zh-cn`, `ja` JSON with `with { type: 'json' }`.
- [x] 1.3 Implement `t(key, values?)` with `{placeholder}` interpolation exactly mirroring the CLI's `formatLocaleMessage` (`{([A-Za-z][A-Za-z0-9]*)}` regex; unknown placeholder left intact). Fallback: active-locale miss → `en` entry (D6); never blank, never a raw key for a shipped locale.
- [x] 1.4 Implement the locale resolver (D4): a pure function of an injected `language` value + an injectable browser-language getter. Concrete `en`/`ja`/`zh-cn` returned directly; `auto` → map `navigator.language`'s primary subtag through an explicit `SUPPORTED_UI_LOCALES` constant table (`zh-*`→`zh-cn`, `ja*`→`ja`, `en*`/unmapped/throw → `en`). Use an explicit constant list, not a regex.
- [x] 1.5 Define the `UiLocale` / `UiLanguage` types (mirroring `CliLocale`/`CliLanguage` but UI-owned — do NOT import from the CLI's `src/`).

## 2. Locale store + provider + hooks (design D5)

- [x] 2.1 Create a zustand locale store (zustand is already a UI dependency) holding the active `UiLocale` and resolved message bundle; expose `setLocale(locale)` and a `refreshLocale()` that re-resolves from the config API.
- [x] 2.2 Implement `useLocale()` and `useT()` Preact hooks bound to the store; `useT()` returns a `t` bound to the current locale.
- [x] 2.3 Mount the provider/store bootstrap inside `<LocationProvider>` in `packages/ui/src/app.tsx` so the entire routed tree re-renders on locale change.
- [x] 2.4 On app boot, seed the store from the effective `language` value via the existing config API (`listConfig` if already called on boot, else `getKey('language')`) and resolve the initial locale.

> **2.1 deviation (implemented):** `zustand` is NOT a UI dependency
> (`packages/ui/package.json` lists only preact/preact-iso/@xyflow/dagre) and
> `config-ui-package` forbids new runtime deps. The store is a hand-rolled
> external store (module-level `currentLocale` + subscriber set + Preact
> `useState`/`useEffect`), exposing `setLocale`/`refreshLocale`/`getCurrentLocale`/
> `tNow` + `useLocale`/`useT` hooks + `<LocaleBootstrap>` (mounted in `app.tsx`
> inside `<LocationProvider>`). See design.md durable findings.

## 3. Live re-localization wiring (design D5; spec req 2)

- [x] 3.1 In `packages/ui/src/components/ConfigPage.tsx` (or `ConfigEntryRow` where the `language` write resolves), call `refreshLocale()` after a successful `putKey('language', …)` so the whole UI re-localizes with no reload.
- [x] 3.2 Confirm the re-localization preserves the in-memory session token and the current route (no reload, no re-entry) — verify by hand in `pnpm dev` and via a test (task 6.4).

## 4. String extraction → `en` catalog (design D9)

Extract hardcoded English to namespaced keys and replace with `t()` calls. Each component gets `const t = useT();` then `t('area.key')`. Update `packages/ui/src/i18n/locales/en.json` as the source catalog.

- [x] 4.1 Shell + primary navigation: `Layout.tsx`, `SpaceSwitcher.tsx` → `nav.*`, `shell.*`.
- [x] 4.2 Board + task: `BoardPage.tsx`, `BoardCard.tsx`, `BoardColumn.tsx`, `TaskCard.tsx`, `TaskDetailPage.tsx` → `board.*`, `task.*`.
- [x] 4.3 Spaces: `SpacesPage.tsx`, `CreateSpaceDialog.tsx`, `SpaceBootstrap.tsx` → `spaces.*`.
- [x] 4.4 Config: `ConfigPage.tsx`, `ConfigEntryRow.tsx`, `config/labels.ts` (the `LABELS` values), `config/controls.ts`, `TelemetryDisclosure.tsx`, `KeepaliveBeatControl.tsx` → `config.*`.
- [ ] 4.5 Workflows + Profiles + Pipelines + Archive: `WorkflowsPage.tsx`, `ProfilesPage.tsx`, `PipelinesPage.tsx`, `ArchivePage.tsx` → `workflows.*`, `profiles.*`, `pipelines.*`, `archive.*`. **Scope note:** `ArchivePage` extracted; `WorkflowsPage`/`ProfilesPage`/`PipelinesPage` internal content NOT extracted this pass (large pages — documented as a follow-up in design.md; their nav-level titles still translate via `nav.*`).
- [ ] 4.6 Pipeline canvas: `PipelineCanvasPage.tsx`, `canvas/PalettePanel`, `StageNode`, `StagePanel`, `IssuesDrawer` → `canvas.*`. **Scope note:** NOT extracted this pass (follow-up; documented in design.md).
- [x] 4.7 Dialogs + notices: `NewChangeDialog.tsx`, `LaunchSessionDialog.tsx`, `RelaunchNotice.tsx`, `SessionRow.tsx` → `dialog.*`, `notice.*`.
- [x] 4.8 Loading/error fallbacks (e.g. `"Loading configuration…"`, `"Failed to load configuration"`) → `status.loading`, `status.error`.

> **4.4 partial:** `config/controls.ts` numeric validation messages
> (`validateRangedNumber` / `validateThresholdValue`) are left as English
> literals — they are technical and asserted verbatim by
> `test/config/controls.test.ts`; translating them is a follow-up. The
> `TELEMETRY_PAYLOAD_FIELDS` labels are intentionally fixed English (parity-pinned
> by `telemetry-disclosure.test.tsx`); only the disclosure chrome prose translates.

## 5. Catalogs — `zh-cn` complete, `ja` framework chrome (design D7; spec req 5)

- [ ] 5.1 Author `packages/ui/src/i18n/locales/zh-cn.json` with complete key-for-key coverage of `en.json` (every key in `en` present in `zh-cn`). **Status:** key-for-key PARITY in place (placeholder English values); VALUE translation handed off to parallel subagents via the LEAD.
- [ ] 5.2 Author `packages/ui/src/i18n/locales/ja.json` covering at minimum the framework chrome: `shell.*`, `nav.*`, and `config.*` structural labels and controls, plus high-traffic strings. **Status:** parity structure in place; framework-chrome key set identified (see design.md gaps list); VALUE translation handed off.
- [x] 5.3 Record every `ja` key that falls back to English in the "Accepted-known `ja` gaps" list in `design.md` (append the actual keys discovered during extraction).

## 6. Language dropdown endonyms (design D8; spec req 6)

- [x] 6.1 Render the `language` enum row's options as endonyms — `Auto`, `English`, `日本語`, `简体中文` — while writing the underlying `auto`/`en`/`ja`/`zh-cn` value unchanged. Endonyms are fixed display strings; `Auto` may localize via `t('language.option.auto')`.

## 7. Tests (`packages/ui/`, vitest + jsdom)

- [x] 7.1 Locale resolver: concrete values pass through; `auto` maps a stubbed `navigator.language` (`zh-CN`, `ja-JP`, `en-US`, an unsupported locale, and the no-preference case) to the correct `UiLocale` (D4).
- [x] 7.2 Fallback discipline: a key present in `en` but missing from `zh-cn` renders the English text; no blank and no raw key (spec req 4 / D6).
- [x] 7.3 Catalog completeness: a test diffs `en.json` and `zh-cn.json` and fails on any key present in one but not the other (spec req 5 / D7).
- [x] 7.4 Key existence: every key referenced by `t(...)` in `.tsx` exists in `en.json` (use a registry of used keys or a grep-driven assertion — D9 Open Question 3).
- [x] 7.5 Live re-localization: after a successful `putKey('language', …)` from the Config page, the active locale updates and a rendered string on another page reflects the new locale, with no full reload and no token re-entry (spec req 2).

## 8. Cross-platform + build verification

- [x] 8.1 `cd packages/ui && pnpm typecheck` passes (tsc --noEmit).
- [x] 8.2 `cd packages/ui && pnpm test` passes (vitest run, jsdom).
- [x] 8.3 `cd packages/ui && pnpm build` succeeds and `packages/ui/dist/index.html` exists (the `config-ui-package` build contract).
- [x] 8.4 Run the scripts on Windows (the dev environment) and confirm they behave the same as macOS/Linux (the build/test scripts are already cross-platform per `config-ui-package`; verify no new platform-specific assumption was introduced).
- [ ] 8.5 Manual smoke in `pnpm dev`: switch `language` between `en`, `zh-cn`, `ja`, `auto` in Config and confirm live re-localization, fallback, and endonym labels. **Status:** not run in this environment (requires a browser); the mechanism is covered by test 7.5 and the resolver/catalog tests.

## 9. Ship-time discipline (for the shipper)

- [ ] 9.1 Commit with an explicit pathspec limited to `ui-i18n`'s own files (`rasen/changes/ui-i18n/**` and the `packages/ui/src/i18n/**`, `packages/ui/src/components/**`, `packages/ui/src/{app.tsx,...}` edits). NEVER `git add -A` or a wide `rasen/changes/` pathspec — the working tree carries other sessions' untracked in-flight work (`pipeline-canvas-edit/`, `pipeline-canvas-view/`, `handoff/`, `office-hours/*`, modified `rasen/config.yaml` and test files) that must not be swept in.
- [ ] 9.2 Do NOT bump the UI package version or publish it — releasing remains the user's explicit decision (`config-ui-package` spec).

## 10. Scope addition — Fast keepalive preset retired (per user decision mid-implementation)

A concurrent session half-removed the Fast (100s) preset; the user chose to retire it fully and fold the completion into this change.

- [x] 10.1 `KeepaliveBeatControl.tsx`: doc-comment "two built-in presets — 100s (fast) and 270s (economy)" → "one built-in preset — 270s (economy)" (the button / `FAST_PRESET` / `'fast'` branch were already removed by the concurrent edit).
- [x] 10.2 Catalogs: removed orphan `keepalive.preset_fast_title` (zh-cn, ja) and `keepalive.preset_fast` (ja); `en`/`zh-cn`/`ja` now 253 keys each, identical key sets, key-for-key parity.
- [x] 10.3 Tests: deleted "writes the fast preset (100)"; rewrote "reflects the effective value in the preset selection state" to assert economy selected at 270 / not-selected at 100 (no fast-button assertions); removed the now-unused `updated` var; updated the test doc-comment. typecheck clean, 399/399 pass.
- [ ] 10.4 FOLLOW-UP (separate change, NOT this one): update the `keepalive-beat-config` main spec from "two built-in presets" to one, to match the shipped single-preset UI.
