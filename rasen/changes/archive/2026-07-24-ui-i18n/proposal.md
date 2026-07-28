## Why

The `language` config key already exists (`src/core/config-keys.ts`, group "Appearance") and is the CLI's locale source of truth — but the web UI ignores it. Every UI string is hardcoded English, and the ConfigPage already renders a working `language` row whose `putKey` write changes only the CLI's language, not the UI the user is looking at. The user's ask is to close that gap: the UI should honor the same `language` key, and switching it in Config should re-localize the UI live, without a reload.

## What Changes

- **The UI renders in the config-selected language.** A new UI-local i18n module reads the existing `language` config key (via the config API the UI already uses) and renders the whole app — shell, navigation, every page, every dialog — in that locale. The CLI's `language` key is reused as-is; no new config key is added and the config registry / config HTTP API are not widened (presentation data stays UI-local, per the `packages/ui/src/config/labels.ts` discipline).
- **Changing `language` in Config re-localizes the UI live.** After a successful `putKey('language', …)` write, the UI swaps its active message bundle and re-renders in the new language with no full page reload — the core of the user's request.
- **`auto` detects the browser language; unsupported locales fall back to English.** Because the UI runs in a browser, `auto` resolves from `navigator.language` / `Intl` (NOT the CLI's Node `execSync`/env-var path). A detected locale the UI has no catalog for falls back to English.
- **Missing translations fall back to English, never blank.** A key absent from a non-English catalog renders the English entry — never a raw key path and never blank — mirroring the CLI's `config-diagnostic-localization` fallback discipline.
- **Locales shipped: `en` and `zh-cn` full; `ja` partial.** `ja` ships at least the app framework and high-traffic strings; any gap is documented as accepted-known in the design rather than silently mixing languages mid-screen.
- **Language names in the dropdown are localized in-script** (English, 日本語, 简体中文, Auto) — a minor presentation detail of the existing enum row.
- The UI i18n module + catalogs live entirely in `packages/ui/src/` (the package is standalone, not a workspace member, and cannot import the CLI's `src/locales/`).

## Capabilities

### New Capabilities

- `ui-i18n`: The web UI renders in the language selected by the existing `language` config key, re-localizes without a reload when that key changes, resolves `auto` from the browser environment, and falls back to English for any unsupported or missing translation — so the UI and CLI share one locale source of truth and never render blank or raw-key text.

### Modified Capabilities

<!-- None. The `language` config key and its registry entry are unchanged (we reuse, not widen). The ConfigPage's existing enum row already writes via putKey; no requirement of config-ui-package changes. -->

## Impact

- **Code**: New `packages/ui/src/i18n/` module (locale resolver, message catalog type, `t()` with `{placeholder}` interpolation mirroring the CLI's `formatLocaleMessage`, a Preact locale store/provider with a `useT()`/`useLocale()` hook). New UI message catalogs under `packages/ui/src/i18n/` (or `packages/ui/src/locales/`). Hardcoded English strings extracted to catalog keys across `packages/ui/src/components/**`, `packages/ui/src/canvas/**`, `packages/ui/src/config/{labels,controls}.ts`, and error/loading fallbacks. The ConfigPage refreshes the locale store after a successful `language` write. The provider mounts near the app root (`packages/ui/src/app.tsx`) so the whole tree re-renders on locale change.
- **APIs / wire surface**: None. Reads use the existing `listConfig` / `getKey('language')`; writes use the existing `putKey`. No new config key, no new endpoint, no `label` field on the registry.
- **Dependencies**: None added. The UI is already Preact + zustand + vite; i18n is implemented with these (a tiny catalog + hook, no i18n framework dependency).
- **Build / test / dev**: `pnpm dev` / `pnpm build` (vite), `pnpm test` (vitest + jsdom), `pnpm typecheck` (tsc --noEmit), all run inside `packages/ui/` (independent install — not a workspace member, not reachable via `pnpm --filter`). New tests cover locale resolution, the `auto` browser-detection path, the fallback discipline, and live re-localization on `putKey`.
- **CLI**: Untouched. The CLI locale system (`src/utils/locale.ts`, `src/locales/`, `src/core/cli-locale.ts`) is the dependency we build on top of, not something to duplicate or edit.

## Scope addition — Fast keepalive preset retired (mid-implementation, per user decision)

During implementation a concurrent session half-removed the keepalive **Fast (100s) beat preset** from `KeepaliveBeatControl.tsx` (the `<button data-testid="keepalive-preset-fast">`, the `FAST_PRESET = 100` constant, and the `'fast'` active-state branch), leaving the component doc-comment and two tests inconsistent and breaking catalog parity. The user decided to **retire the Fast preset entirely** (keep only the Economy 270s preset) and fold that completion into this change. Accordingly this change ALSO:

- updates the `KeepaliveBeatControl` doc-comment to advertise a single preset;
- removes the orphaned `keepalive.preset_fast` / `keepalive.preset_fast_title` keys from the `zh-cn`/`ja` catalogs (they were never in `en`) so all three catalogs stay at key-for-key parity (253 each);
- drops the "writes the fast preset" test and rewrites the preset selection-state test to assert only the Economy button.

This is a behavior change beyond pure i18n. **Follow-up (NOT in this change):** the `keepalive-beat-config` main spec still describes "two built-in presets" and needs a delta update to reflect the single-preset reality. Recorded as task 10.4.
