# Planning Context — ui-i18n

> Seed for the planner. Everything here was verified by the LEAD against the
> codebase before you started — research only what is MISSING, do not re-derive
> these facts. Append durable new findings (decisions, constraints, gotchas)
> to this file after you propose.

## User intent (verbatim)

为 web ui 增加 i18n 多语言,在 config 中切换语言时,也切换 ui 的语言。

(Add multi-language i18n to the web UI; when the language is switched in
config, the UI language switches too.)

## The load-bearing architectural fact

**A `language` config key already exists and is the single source of truth for
CLI locale. The UI must REUSE it — do NOT add a new config key.**

- `src/core/config-keys.ts` (lines 197–205): key `language`, scope `['global']`,
  type `enum`, `enumValues: ['auto', ...SUPPORTED_CLI_LOCALES]` =
  `['auto', 'en', 'ja', 'zh-cn']`, default `'auto'`, group `"Appearance"`.
- `src/utils/locale.ts`: `SUPPORTED_CLI_LOCALES = ['en','ja','zh-cn']`,
  `CliLocale`, `CliLanguage = 'auto' | CliLocale`, `resolveCliLocale({language})`,
  `parseCliLocale()`. `resolveCliLocale` honors `RASEN_LANG` env, then the
  `language` config, then `auto` → system locale detection (Unix env vars,
  macOS `AppleLocale`, fallback `Intl` → `en`).
- CLI catalogs: `src/locales/{en,ja,zh-cn}.json` + `src/locales/index.ts`
  (`getLocaleCatalog`, `formatLocaleMessage(template, values)` — `{placeholder}`
  interpolation). `src/core/cli-locale.ts`: `getCliLocale()` reads global config.

The user's "switch language in config → switch UI language" is satisfied by
having the UI read the SAME `language` key and re-localize when it changes.

## UI package facts (packages/ui — Preact, NOT React)

- Framework: **Preact** (`import { Fragment } from 'preact'`, `preact/hooks`,
  `preact-iso` router). State: **zustand** (`store/use-space.ts`,
  `store/recent-spaces.ts`, `store/use-navigation-guard.ts`). Build: **vite**.
  Tests: **vitest** + jsdom.
- `packages/ui` is a STANDALONE package — it is NOT part of the workspace and
  cannot `import` from the CLI's `src/`. So the UI needs its OWN i18n module +
  its own catalogs (UI strings differ from CLI prompt strings anyway). Candidate
  home: `packages/ui/src/i18n/` (catalogs + `t()` + locale store) or
  `packages/ui/src/locales/`.
- Config HTTP client: `packages/ui/src/api/client.ts`. Relevant calls:
  - `listConfig(space?)` → effective config entries (the `language` value is in
    this response — this is how the UI reads its own locale).
  - `getKey(key, space?)`, `putKey(key, {scope,value}, space?)`,
    `deleteKey(key, scope, space?)`.
- `packages/ui/src/components/ConfigPage.tsx` ALREADY renders every config key
  generically via `<ConfigEntryRow>` (grouped by tabs via `config/grouping.ts`).
  The `language` row (group "Appearance") ALREADY EXISTS and already writes via
  `putKey` when changed. **What is missing is NOT a language picker — it is the
  UI REACTING to that key.** All UI strings are currently hardcoded English.
- `packages/ui/src/config/labels.ts`: a UI-local `LABELS` map of config-key →
  human label (e.g. `language: 'Language'`), with `labelFor(key)` fallback to the
  dot-path. These labels are themselves user-facing strings → candidates for i18n.
- `packages/ui/src/app.tsx` is the root; `packages/ui/src/main.tsx` is the entry.
  Locale should be provided near the root so the whole tree re-renders on change.

## Components with hardcoded strings to extract (non-exhaustive — confirm by grep)

`Layout.tsx`, `SpacesPage.tsx`, `ConfigPage.tsx`, `ConfigEntryRow.tsx`,
`BoardPage.tsx`, `PipelinesPage.tsx`, `WorkflowsPage.tsx`, `ProfilesPage.tsx`,
`ArchivePage.tsx`, `TaskDetailPage.tsx`, `PipelineCanvasPage.tsx`,
`SpaceSwitcher.tsx`, `NewChangeDialog.tsx`, `LaunchSessionDialog.tsx`,
`CreateSpaceDialog.tsx`, `KeepaliveBeatControl.tsx`, `TelemetryDisclosure.tsx`,
`SpaceBootstrap.tsx`, `RelaunchNotice.tsx`, `SessionRow.tsx`, `TaskCard.tsx`,
`BoardCard.tsx`, `BoardColumn.tsx`, canvas `PalettePanel/StageNode/StagePanel/IssuesDrawer`,
`config/labels.ts`, `config/controls.ts`. Also error/loading fallback strings
(e.g. `"Loading configuration…"`, `"Failed to load configuration"`).

## Design direction (proposal should validate/refine, not blindly copy)

1. **UI i18n module** (`packages/ui/src/i18n/`): catalog type, `t(key, values?)`
   mirroring CLI `formatLocaleMessage` (`{placeholder}` interpolation), a locale
   resolver that maps the config `language` value (`auto`|`en`|`ja`|`zh-cn`) to a
   concrete UI locale — `auto` → detect from `navigator.language`/`Intl` (browser,
   NOT the CLI's Node execSync path), fallback `en`. Ship `en` + `zh-cn` catalogs
   fully; `ja` to the extent feasible (at least framework + high-traffic strings;
   document any gaps as accepted-known rather than silently mixing languages).
2. **Locale store/provider**: hold active locale + message bundle; expose a
   `useT()`/`useLocale()` hook (Preact). Seed from `listConfig` (or
   `getKey('language')`) on app load. After a successful `putKey('language', …)`
   in ConfigPage, refresh the store so the whole UI re-renders in the new language
   WITHOUT a full page reload (this is the user's core ask).
3. **Extract strings** across components into catalog keys; replace hardcoded
   English with `t('…')` calls.
4. **Language control display**: the existing enum row shows raw values
   (`auto`,`en`,`ja`,`zh-cn`). Optionally localize the language NAMES in the
   dropdown (each language shown in its own script: English, 日本語, 简体中文,
   Auto) — minor, call it out in design.
5. **Fallback discipline**: a missing key in a non-`en` catalog must fall back to
   `en` (never render blank or a raw key path to the user) — mirror
   `config/labels.ts`'s graceful-degradation pattern.

## Build / test / dev commands (CONFIRM against packages/ui/package.json)

- UI is served by the management API server (the CLI serves the built UI dist).
- Dev/build/test live under `packages/ui/` (independent `pnpm install` there — it
  is NOT a workspace member). Likely `pnpm --filter` does NOT reach it; `cd
  packages/ui && pnpm <script>`. Verify exact script names (build / test / dev /
  typecheck) from its `package.json`. Tests run under vitest + jsdom.

## Constraints & gotchas

- **DIRTY WORKING TREE**: the repo has unrelated in-flight work — untracked
  `rasen/changes/pipeline-canvas-edit/`, `pipeline-canvas-view/`, `handoff/`,
  `office-hours/*`, modified `rasen/config.yaml`, modified test files, and
  deleted `keepalive-beat-config/` files. This change MUST NOT touch any of
  those. At ship time the implementer/shipper MUST commit with an explicit
  pathspec limited to `ui-i18n`'s own files (never a wide `git add -A` /
  `rasen/changes/` — that sweeps up others' untracked work; this caused a real
  accident before).
- **`add-zh-cn-cli-locale` is an in-flight (un-archived) change** that added the
  CLI locale system now live in `src/`. It is a DEPENDENCY we build on, not
  something to duplicate. UI i18n should not edit CLI locale files.
- Cross-platform: the UI runs in a browser, so locale detection uses browser APIs
  (`navigator.language`, `Intl`), NOT the CLI's Node `execSync`/env-var path.
- Keep the wire surface stable: do NOT add a `label` field to the config registry
  or widen the config API for this — presentation-only data stays UI-local (the
  `labels.ts` header documents this discipline explicitly).
- Product-language rule (rasen/config.yaml): write specs in user-facing behavior
  language; put internal mechanisms in design.md/tasks.md.

## Durable findings appended by the planner (after propose)

- **`packages/ui/package.json` scripts confirmed** (all run inside `packages/ui/`,
  standalone — NOT a workspace member, `pnpm --filter` does NOT reach it):
  `dev` = `vite`, `build` = `vite build`, `test` = `vitest run`,
  `typecheck` = `tsc --noEmit`. `prepublishOnly` chains typecheck→test→build.
  Dev/deps: preact + preact-iso + zustand + vite + vitest + jsdom + @xyflow/react.
  No i18n library — add none (the `config-ui-package` spec mandates no new runtime dep).
- **Capability decision: ONE new capability `ui-i18n`**, NO modified capabilities.
  `config-ui-package` (the UI package's home spec) has NO locale requirement today,
  and i18n is cross-cutting across every UI surface, so it gets its own capability
  (mirrors how CLI localization is its own `config-diagnostic-localization`).
  `config-diagnostic-localization` is CLI-side only (CLI diagnostics in CLI locale)
  — the sibling to mirror for the English-fallback discipline, NOT a shadow risk.
  Do NOT widen `config-key-registry` or `config-http-api` (the `labels.ts` header is
  the exact precedent for UI-local presentation data).
- **Provider mount point**: inside `<LocationProvider>` in `packages/ui/src/app.tsx`,
  above the `<Router>` — gives whole-tree re-render on locale change (design D5).
- **Pattern to mirror for the i18n module**: `src/locales/index.ts` — catalog type
  via `typeof en`, `getLocaleCatalog(locale)`, and `formatLocaleMessage`'s exact
  `{([A-Za-z][A-Za-z0-9]*)}` interpolation. Copy the shape, not the file (packages/ui
  cannot import the CLI's `src/`).
- **`navigator.language`/`Intl` only** for `auto` resolution (browser bundle);
  the CLI's `resolveCliLocale` Node path (env vars, macOS `AppleLocale` via
  `execSync`) CANNOT run in the browser — do not import it into the UI.
- **`rasen validate ui-i18n` passes, 0 issues**; `rasen status` reports
  `isComplete: true` for all four planning artifacts.
