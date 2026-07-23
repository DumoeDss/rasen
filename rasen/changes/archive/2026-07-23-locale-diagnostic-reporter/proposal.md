## Why

Four config diagnostics — a skill/CLI version mismatch warning, an expert-selection migration notice, and two `getGlobalConfig()` load-time warnings (retired `delivery` key, invalid JSON) — always print hardcoded English via `reportConfigDiagnostic()`'s no-reporter fallback, even though `en`/`ja`/`zh-cn` catalog entries already exist for every one of these diagnostic keys. Non-English users only ever see localized config output from the `config`/`profile` commands, which are the only two callers that currently wire a locale-aware reporter. This is a pure wiring gap, not a missing-content gap.

## What Changes

- Relocate `formatConfigDiagnostic` and `createConfigDiagnosticReporter` from `src/commands/config-messages.ts` (a commands-layer file) into a new core-layer module, since core files (`root-selection.ts`, `update.ts`, `global-config.ts`) cannot import from `commands/` without a layering violation, and `config-diagnostics.ts` must stay a locale-neutral primitive (documented intent, and importing locale resolution there would recreate a real dependency cycle: `cli-locale.ts` → `global-config.ts` → `config-diagnostics.ts`).
- Wire `checkSkillVersionGuard` (`root-selection.ts`) and `expertSelectionMigration` (`update.ts`) to pass an explicit locale-aware reporter, matching the pattern already used by `config.ts`/`profile.ts`.
- Make `getGlobalConfig()`'s own two diagnostics (`deliveryRetired`, `invalidGlobalJson`) locale-aware by default whenever a caller omits `options.reporter` — benefiting every current and future caller of `getGlobalConfig()`, not just these two call sites — using locale data already available in scope at each call site (never importing `cli-locale.ts` from `global-config.ts`, which would recreate a tight, recursion-prone two-file cycle).
- Preserve the existing English-fallback safety net: any failure resolving locale or looking up a catalog entry falls back to the current hardcoded `diagnostic.fallback` text exactly as today.
- No message/catalog text changes. No new config keys. Pure interconnect fix.

## Capabilities

### New Capabilities
- `config-diagnostic-localization`: Config and CLI diagnostics render in the session's resolved CLI locale wherever a locale-aware reporter can be constructed, falling back to English when it cannot.

### Modified Capabilities
<!-- none: skill-version-guard is itself an unarchived pending capability in a sibling change (delivery-reliability-version-guard) and has no mainline spec yet to modify -->

## Impact

- `src/commands/config-messages.ts`: `formatConfigDiagnostic`/`createConfigDiagnosticReporter` move out (re-exported for existing importers).
- New module: `src/core/config-diagnostic-locale.ts` (locale-aware reporter factory, core-layer).
- `src/core/root-selection.ts`, `src/core/update.ts`: explicit reporter wiring at the two named call sites.
- `src/core/global-config.ts`: default-reporter construction inside `getGlobalConfig()` for its two internal diagnostics.
- Tests: `test/commands/config-messages.test.ts` and coverage near existing `root-selection`/`update` tests.
