## 1. Relocate the locale-aware reporter factory to core

- [x] 1.1 Create `src/core/config-diagnostic-locale.ts` exporting `formatConfigDiagnostic(diagnostic, locale = getCliLocale())` and `createConfigDiagnosticReporter(locale = getCliLocale())`, moved verbatim from `src/commands/config-messages.ts` (importing `ConfigDiagnostic`/`ConfigDiagnosticReporter` from `./config-diagnostics.js`, `getCliLocale` from `./cli-locale.js`, `getLocaleCatalog`/`formatLocaleMessage` from `../locales/index.js`, `CliLocale` from `../utils/locale.js`)
- [x] 1.2 Remove the moved implementations from `src/commands/config-messages.ts` and replace them with a re-export: `export { formatConfigDiagnostic, createConfigDiagnosticReporter } from '../core/config-diagnostic-locale.js';`
- [x] 1.3 Verify `src/commands/config.ts`, `src/commands/profile.ts`, `src/commands/profile-editor.ts` still compile unchanged against the re-export (no import-path edits needed there)

## 2. Wire `checkSkillVersionGuard` and `expertSelectionMigration`

- [x] 2.1 In `src/core/root-selection.ts`, import `createConfigDiagnosticReporter` from `./config-diagnostic-locale.js` and pass it as the second argument to the `reportConfigDiagnostic({ key: 'skillVersionMismatch', ... })` call (~line 728)
- [x] 2.2 In `src/core/update.ts`, import `createConfigDiagnosticReporter` from `./config-diagnostic-locale.js` and pass it as the second argument to the `reportConfigDiagnostic({ key: 'expertSelectionMigration', ... })` call (~line 200)

## 3. Make `getGlobalConfig()`'s own diagnostics locale-aware by default

- [x] 3.1 In `src/core/global-config.ts`, add a small local helper (e.g. `safeDefaultReporter(locale: CliLocale): ConfigDiagnosticReporter | undefined`) that tries `createConfigDiagnosticReporter(locale)` (imported from `./config-diagnostic-locale.js`) in a try/catch, returning `undefined` on any failure so the existing English-fallback path in `reportConfigDiagnostic` takes over
- [x] 3.2 Import `resolveCliLocale` from `../utils/locale.js` alongside the existing `SUPPORTED_CLI_LOCALES`/`CliLanguage` import in `global-config.ts` — do NOT import anything from `./cli-locale.js`
- [x] 3.3 At the `deliveryRetired` call site (~line 324), when `options.reporter` is `undefined`, pass `safeDefaultReporter(resolveCliLocale({ language: merged.language }))` instead
- [x] 3.4 At the `invalidGlobalJson` call site (~line 347), when `options.reporter` is `undefined`, pass `safeDefaultReporter(resolveCliLocale({}))` instead (no `language` available — file failed to parse)
- [x] 3.5 Confirm `cli-locale.ts`'s own probe call (`getGlobalConfig({ reporter: () => {}, persistMigrations: false })`) is unaffected — its explicit `reporter: () => {}` still short-circuits before the new default-reporter logic runs, so no behavior change or recursion is introduced there

## 4. Tests

- [x] 4.1 Add/extend a test in `test/commands/config-messages.test.ts` (or a new `test/core/config-diagnostic-locale.test.ts` if that fits the relocated module better) covering `formatConfigDiagnostic`/`createConfigDiagnosticReporter` unchanged behavior after the move
- [x] 4.2 In `test/core/root-selection.test.ts`, add a test asserting the skill-version-mismatch warning renders in a non-English locale (e.g. `ja` or `zh-cn`) when the CLI locale is set accordingly, not the English fallback string
- [x] 4.3 In `test/core/update.test.ts`, add a test asserting the expert-selection migration notice renders in a non-English locale under the same condition
- [x] 4.4 Add tests for `getGlobalConfig()`'s `deliveryRetired` and `invalidGlobalJson` diagnostics rendering in a non-English locale when no `reporter` is passed and `language` is set accordingly (global-config test suite)
- [x] 4.5 Add one fallback test simulating a locale/catalog resolution failure (e.g. stub `resolveCliLocale`/`getLocaleCatalog` to throw) and assert the diagnostic still prints its English `fallback` text and the command completes normally
- [x] 4.6 Run the full test suite (`pnpm test`) and confirm no regressions in `config`/`profile` locale-aware output tests that already exist

## 5. Validation

- [x] 5.1 Run `rasen validate --change locale-diagnostic-reporter --strict` and confirm the `config-diagnostic-localization` delta spec passes
- [x] 5.2 Manually smoke-test one call site end-to-end (e.g. set CLI locale to `ja`, trigger a retired `delivery` key, confirm Japanese output) to catch anything the unit tests miss
