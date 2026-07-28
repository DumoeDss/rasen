## Why

Rasen's CLI localization currently supports English and Japanese, leaving Simplified Chinese users with English output even though Chinese documentation already exists. Adding a canonical `zh-cn` locale now also closes the `rasen pipeline` gap where localized help still leads to hard-coded English runtime output.

## What Changes

- Add Simplified Chinese as a supported CLI locale with canonical ID `zh-cn` for persisted configuration, `RASEN_LANG`, catalogs, help, completion descriptions, telemetry, and existing localized profile/config/workflow surfaces.
- Auto-detect Simplified Chinese aliases such as `zh-CN`, `zh_CN.UTF-8`, `zh-SG`, `zh-Hans`, and bare `zh`, while keeping Traditional Chinese locales unsupported and falling back to English.
- Localize all ten `rasen pipeline` subcommands' Rasen-owned human output, prompts, warnings, and error framing in English, Japanese, and Simplified Chinese through one command-boundary formatter.
- Localize package-owned pipeline descriptions in human views while preserving user-authored text and all JSON fields, IDs, enum values, paths, diagnostics, classifier semantics, and raw package descriptions.
- Extend catalog completeness, locale parsing, configuration, command behavior, failure-path, E2E, and package-content verification to cover all three locales.
- Update the CLI localization invariants, specifications, and public English and Chinese documentation without renaming the existing `docs/zh/` route or adding Traditional Chinese support.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `profiles`: Expand persisted CLI language, automatic locale resolution, picker/help/config/completion localization, expert metadata, and locale catalog requirements from English/Japanese to English/Japanese/Simplified Chinese.
- `workflow-library`: Extend Rasen-owned workflow presentation to Simplified Chinese while preserving user-authored workflow content and locale-neutral machine contracts.
- `change-creation`: Require new command and flag descriptions to remain complete across all supported CLI locale catalogs, including `zh-cn`.
- `opsx-pipeline-registry`: Localize human-facing output for all ten pipeline subcommands and package-owned pipeline descriptions while preserving JSON and classifier behavior across locales.

## Impact

- Affects CLI locale/config types and schemas, JSON catalogs, Commander help, completion description lookup, pipeline command rendering, built-in pipeline presentation, and associated tests.
- Adds `src/locales/zh-cn.json` to build and npm package output; no runtime dependency or package format change is required.
- Updates `AGENTS.md`, four capability specs through delta specifications, and focused English/Chinese CLI documentation.
- The active `slice3-daemon-residency` change currently states an English/Japanese-only catalog requirement; its integration must adopt the three-locale completeness contract when rebased or landed after this change.
