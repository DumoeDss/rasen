## 1. Baseline and Regression Test

- [x] 1.1 Run the focused profile and terminal-text tests plus typecheck and lint to record the clean baseline.
- [x] 1.2 Add a `rasen profile new` regression test with `process.stdout.rows = 12`, preserving the full choice count while expecting a seven-row page, and confirm it fails before production changes.

## 2. Terminal Height and Page-Size Policy

- [x] 2.1 Implement defensive `resolveTerminalRows()` stream handling with `rows` precedence, `getWindowSize()` fallback, and invalid/throwing normalization.
- [x] 2.2 Add utility tests for direct rows, fallback rows, precedence, unavailable values, invalid values, and throwing stream accessors.
- [x] 2.3 Implement and test the pure workflow picker page-size policy for fallback, lower bound, terminal budget, and choice-count upper bound.

## 3. Shared Picker Integration

- [x] 3.1 Add one workflow picker options builder that constructs choices once and snapshots terminal height once.
- [x] 3.2 Route named-profile creation and the shared interactive profile editor through the options builder without changing choice metadata, shortcuts, localization, dependency state, or persistence.
- [x] 3.3 Update `rasen profile`, `rasen config profile`, and unavailable-height regression coverage so page size and complete choice count are asserted independently.

## 4. Verification

- [x] 4.1 Run focused tests, typecheck, lint, and build; confirm no dependency, lockfile, locale catalog, or unintended generated-file changes.
- [x] 4.2 Smoke-test the built CLI in approximately 12-, 24-, and 50-row TTYs across English, Japanese, and Simplified Chinese, including navigation and cancellation cleanup where the environment permits interactive verification.
- [x] 4.3 Run the full test suite with `ZSH` removed and classify any failure as change-related or pre-existing.

## 5. Review and Completion

- [x] 5.1 Review the final implementation, tests, specs, and repository statuses for scope, test isolation, and preserved machine contracts.
- [x] 5.2 Run strict change validation and record verification results and any residual risks in this task artifact.

## Execution Results

- Baseline: `test/utils/terminal-text.test.ts`, `test/commands/profile.test.ts`, and `test/commands/config-profile.test.ts` passed 59 tests; typecheck and lint passed.
- Red regression: the 12-row `rasen profile new team` path failed deterministically twice with `pageSize` 45 instead of 7 while retaining all 45 choices.
- Final focused suite: 3 files, 83 tests passed.
- Typecheck: `pnpm exec tsc --noEmit` passed.
- Lint: `pnpm lint` passed.
- Build: `pnpm run build` passed without tracked `dist/`, dependency, lockfile, or locale-catalog changes.
- Full suite: `env -u ZSH pnpm test` passed 186 files with 3609 tests passed and 10 skipped.
- PTY smoke: rows 12 in English, Japanese, and Simplified Chinese; rows 24 in English; and rows 50 in English all exposed instructions, reached the final `workflow-review` expert, and exited cleanly after declining save. Rows 12/24 did not render the full list initially; rows 50 did. Ctrl+C exited 130 with the cancellation message.
- Review: independent review found one Minor test-isolation issue around ambient `getWindowSize()`; the helper now isolates both height sources and verifies 7-row fallback followed by 19 rows on the next 24-row opening. Re-review result: CLEAN.
- Change validation: `rasen validate fix-profile-picker-terminal-height --strict` passed.
- Diagnostics note: changed production files report no Zed diagnostics. Project-wide Zed diagnostics also report pre-existing/unscoped entries from ignored test files and `node_modules`; repository typecheck, lint, focused tests, and full suite remain green.
- Residual risks: prompt-time resize remains intentionally snapshot-based, and extremely narrow terminals can wrap the question or instructions beyond the fixed five-row reserve.
