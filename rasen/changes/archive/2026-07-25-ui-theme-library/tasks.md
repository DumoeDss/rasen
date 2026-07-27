## 1. Manifest Contract and Built-ins

- [x] 1.1 Add shared accepted/rejected JSON fixtures and implement the root and
  self-contained UI version-1 manifest decoders with closed fields, portable
  IDs, typed token definitions, mode rules, effect allow-list, and actionable
  validation details.
- [x] 1.2 Add checked-in Editorial and CRT JSON manifests, prove both decoders
  accept them, and map their normalized token sets closely to the current light,
  dark, and CRT visual values.
- [x] 1.3 Refactor theme-owned CSS to consume the stable token map and implement
  `scanlines`, `uppercase-headings`, `terminal-navigation`, and
  `uppercase-metadata` as explicit application-owned effects with tests that
  switching clears previous tokens and effects.

## 2. Global Configuration and Theme Storage

- [x] 2.1 Add additive `ui.theme` schema/type/default handling and preserve
  `ui.pinnedSpaces` plus unknown `ui` fields in global config loading and saving
  tests.
- [x] 2.2 Register `ui.theme` as a global-only Appearance string with the
  portable-ID constraint, labels/descriptions, and CLI/config-API round-trip,
  invalid-value, and invalid-scope tests.
- [x] 2.3 Implement the root theme-library boundary for machine-data directory
  resolution, fresh validated listing, skipped-entry diagnostics, built-in and
  case-insensitive collision protection, and symlink/path containment.
- [x] 2.4 Implement the 256 KiB validate-first atomic installer with normalized
  JSON, explicit temporary-file cleanup, no-overwrite semantics, and failure
  tests that prove the library and preference stay unchanged.
- [x] 2.5 Cover native path construction and case/collision behavior on Windows,
  macOS, and Linux, and ensure the storage test suite runs in the existing
  Windows CI matrix using `path.join`/`path.resolve` expectations.

## 3. Authenticated Theme API

- [x] 3.1 Add exact-depth `GET /api/v1/themes` routing with bearer/loopback,
  trailing-slash, identity-header, fresh-read, read-only, and standard error
  envelope tests.
- [x] 3.2 Add streaming `POST /api/v1/themes/import` routing with content-type
  and 256 KiB enforcement, stable validation/conflict/persistence error codes,
  and unauthorized/unsupported-method/deeper-suffix tests.
- [x] 3.3 Extend the UI API client with typed catalog/import calls and tests for
  successful responses, stable error details, authentication, and malformed
  wire data.

## 4. Theme Runtime and Startup

- [x] 4.1 Implement the UI theme runtime to merge explicit bundled built-ins
  with revalidated imported manifests, normalize over Editorial, and apply only
  mapped tokens and named root effects.
- [x] 4.2 Replace the localStorage startup path with bounded pre-render
  initialization that reads effective global `ui.theme` and the catalog in
  parallel, applies the valid configured theme before mount, and always renders
  Editorial on timeout, API, decode, missing-theme, or compatibility failure.
- [x] 4.3 Add adaptive color-scheme listening, fixed light/dark behavior, live
  activation, complete previous-theme cleanup, and first-frame/fallback tests.

## 5. Config Theme Experience and Localization

- [x] 5.1 Add a Global-mode General > Appearance theme control that lists
  built-in/imported metadata, preserves and marks an unavailable configured ID,
  hides in Local mode, writes through the generic config API, and activates a
  successful selection live.
- [x] 5.2 Add the JSON file-picker import interaction with progress, catalog
  refresh without auto-selection, and recoverable inline states for size,
  schema/version, token/effect, identifier conflict, and persistence failures.
- [x] 5.3 Add complete English, Simplified Chinese, and Japanese catalog entries
  for theme controls, built-in metadata, state, warnings, and recovery; store
  error categories/details so visible errors re-localize live and test English
  fallback.
- [x] 5.4 Remove `ThemeToggle` from the shell, remove its test-only CSS and all
  `rasen-ui-theme-variant` reads/writes, and update shell/startup tests to prove
  a stale localStorage value cannot override global configuration.

## 6. Verification

- [x] 6.1 Run focused root tests for manifest validation, global config,
  registry/config API, storage/import, and management routing, fixing all
  failures.
- [x] 6.2 Run the UI unit/integration suite for bootstrap, fallback, live
  switching, Config interaction, import, and localization, then run the UI
  production build and verify `dist/index.html` plus bundled manifest assets.
- [x] 6.3 Run the change validator and the repository's applicable typecheck,
  lint, and CI-equivalent checks, and document any unrelated pre-existing
  failure with reproducible evidence.

## Verification Evidence

- Root focused theme/config/API suites: 18 tests passed; the broader focused
  config set also passed 210 tests after updating additive-default assertions.
- UI full suite: 44 files, 413 tests passed. Existing jsdom
  `window.scrollTo`/navigation-not-implemented stderr remained non-failing.
- Root build, TypeScript `--noEmit`, and ESLint passed.
- UI typecheck and production build passed; `dist/index.html` exists and the
  emitted entry contains the bundled version-1 Editorial and CRT manifests.
- `rasen validate ui-theme-library --json`: 1 passed, 0 failed, no issues.
- Reproducible repository concern: monolithic root `pnpm test` emitted no
  assertion verdict before a 300-second shell bound, then again before a
  600-second bound with `VITEST_MAX_WORKERS=2` (the Windows CI worker count).
  The theme-focused root suites complete normally, and no in-scope assertion
  failure was observed. The full suite was not restarted after the LEAD
  requested preserving this timeout as the final concern.
