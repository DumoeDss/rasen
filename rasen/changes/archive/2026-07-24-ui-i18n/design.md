## Context

The `language` config key already exists (`src/core/config-keys.ts`, lines 197–205: scope `['global']`, enum `['auto','en','ja','zh-cn']`, default `'auto'`, group "Appearance") and is the CLI's locale source of truth (`src/utils/locale.ts` `resolveCliLocale`, `src/locales/{en,ja,zh-cn}.json`, `formatLocaleMessage` with `{placeholder}` interpolation). The web UI — a standalone Preact + zustand + vite package under `packages/ui/` — already renders a working `language` row on the configuration page that writes through `putKey`, but the UI itself ignores that key: every UI string is hardcoded English. The gap is purely the UI *reacting* to the key.

Hard constraints established by the LEAD (verified in `planning-context.md`):

- `packages/ui` is NOT a workspace member (independent `pnpm install`), and cannot `import` from the CLI's `src/`. The UI needs its own i18n module and its own catalogs (UI strings differ from CLI prompt strings anyway).
- The CLI's `auto` path (`resolveCliLocale`) uses Node-only detection (Unix env vars, macOS `AppleLocale` via `execSync`) — unavailable in a browser bundle. The UI must detect from the browser instead.
- `packages/ui/src/config/labels.ts` already documents the discipline we follow: "adding [a label field to the registry] would widen the just-shipped wire surface for presentation-only data — so this UI-local map…". i18n catalogs are the same kind of UI-local presentation data.
- The `config-ui-package` spec mandates the package add no new runtime dependency and stay a pure static-asset front end.
- The working tree is dirty with other sessions' in-flight work; commits must use an explicit pathspec limited to `ui-i18n`'s own files.

Product language: the spec (`specs/ui-i18n/spec.md`) describes the user-facing behavior. This document holds the internal mechanism choices.

## Goals / Non-Goals

**Goals:**

- The UI renders in the locale selected by the existing `language` config key.
- Changing `language` in Config re-localizes the whole UI live, without a full page reload and without losing the in-memory session token or current route.
- `auto` resolves from the browser environment; unsupported detections fall back to English.
- Missing keys in a non-English catalog fall back to English, never blank, never a raw key.
- Ship `en` + `zh-cn` fully; ship `ja` for the framework chrome and high-traffic strings, with gaps documented as accepted-known.
- Add no runtime dependency to the UI package.

**Non-Goals:**

- Right-to-left layout or non-LTR/CJK typography work (no locale in the enum requires it).
- Localizing CLI output, CLI diagnostics, or the docs/website (separate capabilities: `config-diagnostic-localization`, `website-l10n`).
- A translator workflow / extraction tooling automation (manual extraction this pass; a future change could add a key-extraction lint).
- Full `ja` parity with `en`/`zh-cn` (accepted-known partial coverage this pass).
- Adding any new config key, endpoint, or registry field.

## Decisions

### D1 — Reuse the `language` config key; do NOT add a UI-language key

The UI reads the same `language` key the CLI reads (via `listConfig` / `getKey('language')`, both already used by the Config page). No new config key, no registry change, no API change.

- **Rationale**: The user's explicit ask is that "switching language in config switches the UI language" — i.e. one control, shared. A single source of truth means the CLI and UI never disagree.
- **Alternative considered**: a separate `ui.language` key. Rejected — diverges from the CLI (the two could drift), doubles the translation maintenance, and forces the user to set their language twice. It would also widen the registry, violating the `labels.ts` discipline.

### D2 — UI-local i18n module at `packages/ui/src/i18n/`, with catalogs mirroring the CLI's layout

A new `packages/ui/src/i18n/` module owns: the catalog type (derived from the `en` catalog via `typeof`, exactly as `src/locales/index.ts` does), the catalog index (`getLocaleCatalog(locale)`), the `t(key, values?)` function, the locale resolver, and the Preact store/provider + `useT()`/`useLocale()` hooks. Catalog message files live at `packages/ui/src/i18n/locales/{en,zh-cn,ja}.json` (JSON imported with `with { type: 'json' }`, matching the CLI).

- **Rationale**: `packages/ui` cannot import the CLI's `src/`; UI strings are a different set from CLI prompt strings. Mirroring the CLI's proven layout (catalog type from `typeof en`, `getLocaleCatalog`, `formatLocaleMessage`) keeps the two systems recognizable siblings without sharing code that cannot cross the package boundary.
- **Alternative considered**: a `preact-i18n` / `i18next` library. Rejected — the CLI's locale system is ~30 lines and works; pulling in a framework would violate `config-ui-package`'s "no new runtime dependency" contract for no functional gain.
- **Final directory name is left to the implementer** (`i18n/` vs `locales/`); `i18n/` with a nested `locales/` for the JSON is recommended so the module (hooks, resolver) and the data (catalogs) are clearly separated.

### D3 — `t(key, values?)` mirrors the CLI's `{placeholder}` interpolation

`t('board.empty', { count: 3 })` against `"board.empty": "No tasks ({count} shown)"` yields `"No tasks (3 shown)"`, reusing the exact `{([A-Za-z][A-Za-z0-9]*)}` replacement the CLI's `formatLocaleMessage` uses. An unknown placeholder is left intact (same as CLI).

- **Rationale**: Consistency with the CLI formatter; zero deps; the regex is already battle-tested.
- **Alternative considered**: ICU MessageFormat. Rejected — none of the current strings need plural/gender/select complexity; the CLI deliberately chose the simpler format and we follow suit. (If pluralization is later needed, it becomes a focused follow-up.)

### D4 — Locale resolution: `auto` → browser, never the CLI's Node path

The resolver takes the `language` config value and returns a concrete `UiLocale`:

1. If `language` is a concrete supported locale (`en` | `ja` | `zh-cn`), return it directly.
2. If `language` is `auto`, inspect the browser: read `navigator.language`, reduce to the primary language subtag, and map it through an explicit `SUPPORTED_UI_LOCALES` table — `zh-*` → `zh-cn`, `ja*` → `ja`, `en*` (or anything unmapped) → `en`. The mapping is an explicit constant list (per the project's "use existing constants and lists; don't invent detection mechanisms" rule), not a regex.
3. Fall back to `en` whenever no supported locale is detected or detection throws.

- **Rationale**: The UI runs in a browser; the CLI's `auto` path (env vars, macOS `AppleLocale` via `execSync`) cannot run in a browser bundle and would pull in Node APIs. An explicit subtag map is deterministic and easy to test. `Intl` is used only incidentally (the map keys on the language subtag).
- **Alternative considered**: reuse `resolveCliLocale` directly. Rejected — it imports Node-only modules and would either break the browser build or require shimming that lies about the environment.
- **Cross-platform note**: this is browser-side, so macOS/Linux/Windows differences do not apply to detection; they apply only to the build/test scripts (already cross-platform per `config-ui-package`).

### D5 — Live re-localization via a Preact store + provider at the app root

A small zustand store (the UI already uses zustand for `use-space`, `recent-spaces`, `use-navigation-guard`) holds the active `UiLocale` and the resolved message bundle. A `<LocaleProvider>` (or a plain hook subscribed to the store) wraps the tree inside `<LocationProvider>` in `packages/ui/src/app.tsx`, so the entire routed tree re-renders when the locale changes. `useT()` returns a `t` bound to the current locale; components call `const t = useT()` then `t('nav.board')`.

Boot sequence: on app load, the provider reads the effective `language` (one `listConfig` call the app already makes, or a single `getKey('language')`) and seeds the store. On a successful `putKey('language', …)` from the Config page, the Config page calls a `refreshLocale()` that re-reads the effective value and updates the store; the whole tree re-renders in place — no reload, no token re-entry, no route change.

- **Rationale**: A single store above the Router is the smallest change that gives global re-localization for free. zustand is already a dependency. Keeping the locale in a store (not only in context) lets non-component code (e.g. a future toast helper) read it too.
- **Alternative considered**: force a full page reload after the write. Rejected — the user explicitly asked for live switching, a reload discards the in-memory session token (the `config-ui-package` token spec keeps it only in memory), and it is a worse UX. Alternative: per-component subscription without a provider. Rejected — fragmented, easy to miss a surface.

### D6 — Fallback discipline: missing key → English, never blank, never the raw key

`t(key)` looks up the active locale's catalog; on a miss it looks up the `en` catalog; the return is always a string. A key missing from BOTH catalogs is an implementation bug (a test asserts every key used in the codebase exists in `en`); this case renders the key itself only so the bug is visible during development, but the spec contract is "never blank, never a raw key in a shipped locale" — which holds because `en` is the complete source catalog. This mirrors `config/labels.ts`'s `labelFor(key) ?? key` graceful-degradation pattern and the CLI's `config-diagnostic-localization` fallback requirement.

- **Rationale**: Guarantees no blank UI and no visible key path even when a translator misses a string.
- **Alternative considered**: throw on a missing key. Rejected — one missed translation would break an entire screen; the fallback keeps the UI usable.

### D7 — Catalog coverage: `en` + `zh-cn` complete; `ja` framework-chrome + high-traffic

`en` is the source catalog (every key lives here). `zh-cn` ships complete (the user's language; full value). `ja` ships the framework chrome — shell, primary navigation, configuration page structural labels and controls — plus high-traffic strings; remaining `ja` gaps fall back to English per D6 and are listed below in **Accepted-known `ja` gaps**. A test diffs the `en` and `zh-cn` catalogs key-for-key so a missing `zh-cn` entry fails CI.

- **Rationale**: Ship the user's primary ask (zh-cn + live switching) immediately; deliver `ja` as honest partial coverage rather than blocking the whole change on full `ja` parity.
- **Alternative considered**: hold the change until `ja` is complete. Rejected — delays the primary value; partial `ja` with documented gaps and safe fallback is strictly better than no i18n.

### D8 — Language endonyms in the `language` dropdown (presentation only)

The configuration page's `language` enum row renders each value as its endonym — `Auto`, `English`, `日本語`, `简体中文` — while writing the underlying `auto`/`en`/`ja`/`zh-cn` value unchanged. Endonyms are fixed display strings (each language shown in its own script), NOT localized through `t()` — that is the point of an endonym (a reader who doesn't read English must recognize their language to select it). The one exception is `Auto`, which has no endonym; it is the single label that MAY be localized (`t('language.option.auto')`) so it is legible in the active locale.

- **Rationale**: The feature's target users (non-English readers) cannot recognize `zh-cn`; endonyms solve exactly this. Keeping endonyms fixed (not localized) preserves recognizability in every UI locale.
- **Alternative considered**: leave raw codes. Rejected — defeats the purpose for non-English readers. Alternative: localize all four labels. Rejected — localizing "English" into Japanese makes it unrecognizable to the person who needs it most.

### D9 — Extraction is manual; keys are namespaced by area

Strings are extracted into catalogs with dot-namespace keys by area (`nav.*`, `board.*`, `config.*`, `spaces.*`, `workflows.*`, `profiles.*`, `pipelines.*`, `archive.*`, `task.*`, `canvas.*`, `dialog.*`, `status.loading`, `status.error`, plus `language.option.auto`). This keeps catalogs scannable and merge-conflict-friendly across the large extraction.

- **Rationale**: No extraction tool is introduced (Non-Goal); a stable naming convention keeps a large, multi-file extraction orderly and reviewable.
- **Alternative considered**: flat keys. Rejected — collides and scales poorly across ~25 components.

## Risks / Trade-offs

- **[Large extraction surface across ~25 components]** → Mitigation: area-namespaced keys (D9); the `en` catalog is the single source; a test asserts every key referenced in `.tsx` exists in `en` (grep-driven or a registry of used keys), so a typo'd key fails CI rather than rendering a raw key.
- **[`ja` partial coverage mixes English and Japanese mid-screen]** → Mitigation: framework chrome is fully translated (D7); accepted content gaps are listed below as accepted-known; the fallback language is consistently English, never a random third language.
- **[Live re-localization misses a component]** → Mitigation: the provider sits at the root above the Router (D5), so the whole tree re-renders on store change; a test asserts that after `putKey('language', …)` the visible strings on a second page reflect the new locale without a reload.
- **[Browser `auto` detection varies across browsers]** → Mitigation: the resolver uses an explicit supported-locale subtag map (D4), deterministic and stubbable in tests; any unmapped preference falls back to `en`.
- **[jsdom tests cannot vary `navigator.language` natively]** → Mitigation: the resolver is a pure function of an injected `language` value + an injectable browser-language getter; tests drive it directly rather than fighting jsdom.
- **[Dirty working tree — other sessions' untracked files]** → Mitigation (ship-time, recorded for the shipper): commit with an explicit pathspec limited to `ui-i18n`'s own files; never `git add -A` or a wide `rasen/changes/` pathspec (this caused a real pollution accident before).
- **[Forgetting to refresh the locale store after a non-Config write path]** → Mitigation: locale changes only flow through the `language` config key, and the Config page is the only surface that writes it; `refreshLocale()` is called in the single post-`putKey` success path for the `language` row.

## Migration Plan

None. This is a purely additive UI feature: no data migration, no API change, no config migration (the `language` key pre-exists with default `auto`). On deploy, the UI simply starts honoring the existing key. **Rollback**: revert the change; the UI returns to today's hardcoded English with no data or config impact (the `language` key remains valid and the CLI continues to use it).

## Open Questions

1. **Catalog file location** — `packages/ui/src/i18n/locales/*.json` (recommended, mirrors CLI) vs `packages/ui/src/locales/*.json`. Non-blocking; implementer picks the cleaner path. Recommend `i18n/` so the module and data are co-located.
2. **Should `Auto` be the only localized option label?** Recommend yes (D8): endonyms are fixed; `Auto` localizes via `t('language.option.auto')`. Minor; implementer may keep `Auto` fixed if simpler.
3. **Key-completeness enforcement** — assert via a static registry of used keys, or via a grep-based test? Recommend a lightweight registry (`usedKeys`) the extraction populates, asserted against `en`. Implementer's choice as long as CI fails on a missing `en` key.

## Accepted-known `ja` gaps (to be filled by the implementer as they extract)

The implementer SHALL populate this list during extraction with any `ja` keys that fall back to English, so the coverage commitment (spec: "Catalog coverage — `ja` covers the framework chrome") is honored transparently. Framework-chrome namespaces (`nav.*`, `shell.*`, `config.*` structural labels and controls) MUST be translated for `ja`; gaps are expected only in content namespaces (`board.*`, `task.*`, `canvas.*`, `dialog.*` content beyond the chrome). Until extraction is underway the precise list is unknown — the implementer records the actual gaps here.

### Implementer-recorded scope & gaps (post-extraction)

**Extraction scope shipped this pass** (these keys are in `en.json` and are the
set the `ja` translator draws from — `zh-cn` translates all of them):

- Framework chrome (REQUIRED for `ja` per spec req 5): `nav.*`, `notice.relaunch.*`,
  `spaces.switcher.*`, `spaces.bootstrap.*`, `spaces.page.*` (structural),
  `spaces.create.*`, `config.title`, `config.mode_label`, `config.mode.global`,
  `config.mode.local`, `config.tabs_label`, `config.error_use_switcher`,
  `config.leave.*`, `config.unset`, `config.select.not_found`,
  `config.threshold.*`, `config.scope.*`, `config.annotation.*`,
  `config.profile.*` (structural + selector), `config.label.*` (all 25 config-key
  labels), `language.option.auto`, `status.*` (loading/error/retry),
  `member.*`, `worktree.*` (chip chrome), `running.*`, `session.*` (row chrome),
  `dialog.new_change.*`, `dialog.launch.*`, `keepalive.*`, `telemetry.*` (disclosure
  chrome — the five `TELEMETRY_PAYLOAD_FIELDS` labels stay fixed English literals,
  pinned by the parity test, NOT translated).
- High-traffic content: `board.*` (title/buttons/empty/loading/columns/overflow),
  `task.progress.*`, `task.badge.*`, `task.live_title`, `taskcard.*`,
  `task_detail.*` (page chrome: titles/back/kind labels/progress/empty/not-found),
  `archive.*` (title/empty/search/refresh/kind/archived/count).

**Accepted-known `ja` content gaps** (these `ja` keys MAY fall back to English;
the framework-chrome keys above MUST be translated for `ja`):

- `task_detail.child_archived`, `task_detail.child_deps`, `task_detail.checklist_*`,
  `task_detail.children_empty`, `task_detail.no_deps`, `task_detail.sessions_empty`,
  `task_detail.not_found_*` — Task-detail content beyond the page chrome.
- `archive.archived`, `archive.child_count.one`, `archive.child_count.other`,
  `archive.kind_*`, `archive.no_matches` — Archive list content beyond the title.
- `session.run_absent`, `session.run_no_state`, `session.run_no_stages`,
  `session.kill_question`, `session.exit_code`, `session.exit_signal`,
  `session.no_output` — Session-row content beyond the kill chrome.
- `dialog.launch.hint`, `dialog.launch.task_required`, `dialog.launch.change_name`,
  `dialog.launch.kind_*` — Launch-dialog content beyond the title/buttons.
- `config.profile.hint`, `config.profile.reminder_*`, `config.profile.mode_*`,
  `config.profile.reset_confirm`, `config.profile.replace_*`, `config.profile.follow_body`,
  `config.profile.custom_option` — Profile-selector prose beyond the structural labels.
- `telemetry.body_intro`, `telemetry.note_global`, `telemetry.note_env_*` — Telemetry
  disclosure body prose (summary is chrome).
- `keepalive.hint`, `keepalive.error_range` — Keepalive derived text.

### Translator-shipped `ja` coverage (actual, post-translation)

The `ja` translator shipped **complete coverage** this pass: every key in
`en.json` (255 keys at translation time, including the three `keepalive.*` keys
added late in extraction — `keepalive.description`, `keepalive.preset_fast_title`,
`keepalive.preset_economy_title`) is translated to Japanese. **Zero `ja` keys
fall back to English.** Every key listed under "Accepted-known `ja` content gaps"
above was translated rather than left in English, so `ja` exceeds the framework-
chrome commitment (spec req 5) and mirrors `en`/`zh-cn` key-for-key. A standalone
node parity check confirmed 255/255 keys, identical order, 23/23 blank-line
groups, and 0 `{placeholder}` token mismatches vs `en.json`.

Intentional technical-loanword retentions *inside* Japanese strings (NOT gaps —
the surrounding string is fully Japanese, these are deliberate terminology):
`stdout` / `stderr` (standard streams — `session.stdout_tail` / `session.stderr_tail`),
`CI` (`telemetry.note_env_post`), `TTL` (`keepalive.description`), `keepalive`
(`keepalive.label`, matching the CLI's romanji convention for this config-key
namespace), `Rasen` (product name), and unit suffixes (`s` seconds —
`{seconds}s` / `{total}s` preserved verbatim per the placeholder/units rule).
`dialog.launch.kind_auto` / `kind_goal` render as `自動` / `ゴール` (translated
display labels; the underlying enum value stays `auto` / `goal`). `worktree.main`
renders as `メイン`. Terminology decision for review: "store" → `ストア` in the
UI (katakana, for readability), where the CLI keeps the romanji `store` — a
documented UI/CLI divergence (see translator findings returned to the LEAD).

**Not extracted this pass (English in EVERY locale — follow-up, NOT a `ja`-only gap):**
the internal content of the four large pages — `WorkflowsPage`, `ProfilesPage`,
`PipelinesPage`, the canvas family (`PipelineCanvasPage`, `PalettePanel`, `StageNode`,
`StagePanel`, `IssuesDrawer`), plus `LocalPathPicker`, `workflow-cards`, and
`ThemeToggle`. These pages' page-title + nav-level chrome IS consistent (nav entries
`nav.workflows` / `nav.profiles` / `nav.pipelines` translate), but their in-page
strings remain hardcoded English. A focused follow-up change should extract them;
until then they read as English regardless of the `language` key (no `zh-cn`/`ja`
parity regression — those strings are not catalog keys). `controls.ts` numeric
validation messages (`validateRangedNumber` / `validateThresholdValue`) are also
left as English literals (technical, asserted verbatim by `test/config/controls.test.ts`).

## Implementer durable findings (post-implementation)

- **`zustand` is NOT a UI dependency.** The planning context and design D5 assumed
  zustand; `packages/ui/package.json` lists only `preact`/`preact-iso`/`@xyflow/react`/`dagre`,
  and `config-ui-package` mandates no new runtime dependency. The locale store is a
  hand-rolled external store: a module-level `currentLocale` + subscriber set +
  `useState`/`useEffect` hooks (`src/i18n/store.ts`). `useSyncExternalStore` lives in
  `preact/compat`, NOT `preact/hooks` — avoided to keep the app on direct `preact/hooks`
  imports. **Future UI state work: do not reach for zustand; mirror this pattern or add
  a real store only if the user approves a new dep.**
- **`t()` is a passthrough for non-key strings.** Authored loading/error fallbacks are
  stored in component state as i18n KEYS (e.g. `'status.error.board_load'`) and rendered
  through `t(state.message)`; a server `ApiError.message` (plain text, not a key) passes
  through `translate()` unchanged because `active[key] ?? en[key]` misses and the final
  `return key` yields the original string. This is why verbatim-error tests (e.g.
  `toContain('boom')`, `toContain('No such space.')`) still pass after extraction. **New
  authored fallbacks: store the key, render via `t()` — server text needs no special path.**
- **`config/labels.ts` uses the non-component read path** (`tNow` reads the module store's
  current locale). `labelFor` is only called during a component render that already
  re-renders on locale change via `useT`, so reading the module store there is always
  fresh. **Other non-component UI modules that need the current locale: use `tNow`, not a
  hook.**
- **Existing tests assert exact English.** The `en` catalog MUST contain the verbatim
  hardcoded strings (em-dash `—`, ellipsis `…`, curly apostrophe `'`, arrows `→` `←`).
  A test that `toBe('Handoff threshold')` passes only because `config.label.handoff_threshold`
  is exactly that. **Extraction = copy verbatim; never "tidy" punctuation.**
- **`navigator.language` detection is a pure, injected seam** (`resolveUiLocale(language,
  getBrowserLanguage)`), so jsdom tests drive it directly — no `navigator.language`
  mocking needed. The subtag map is an explicit constant (`zh`/`ja`/`en` → locale),
  not a regex.
