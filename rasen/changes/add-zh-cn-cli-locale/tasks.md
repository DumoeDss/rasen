## 1. Contract and Baseline

- [x] 1.1 Create the proposal, design, and delta specifications that fix the `zh-cn` locale contract, pipeline scope, content-ownership boundary, and active-change integration note
- [x] 1.2 Run the locale, config, catalog, help/completion, and pipeline focused test baseline and record any pre-existing failures
- [x] 1.3 Run baseline typecheck, lint, build, and the full test suite with `ZSH` removed; record any pre-existing failures
- [x] 1.4 Capture representative pipeline JSON shapes and current package locale entries before implementation

## 2. Locale and Configuration Contract

- [x] 2.1 Add `SUPPORTED_CLI_LOCALES`, derive locale/language types, and update global config, Zod schema, config registry, and API metadata for exact persisted `zh-cn`
- [x] 2.2 Implement script- and region-aware Simplified Chinese locale normalization while preserving Unix and Windows precedence behavior
- [x] 2.3 Add table-driven locale, CLI locale, config round-trip/strictness, effective-config, and config API tests for `zh-cn`

## 3. Catalog, Help, and Completion Integration

- [x] 3.1 Add English and Japanese pipeline message and built-in pipeline metadata catalog sections with stable keys and placeholders
- [x] 3.2 Add the complete `src/locales/zh-cn.json` catalog using the agreed terminology while preserving placeholders and machine fragments
- [x] 3.3 Register the Simplified Chinese catalog statically and generalize Commander help localization for every non-English supported locale
- [x] 3.4 Generalize command-description completeness lookup from Japanese-specific to locale-parameterized behavior and update the pipeline group description consistently
- [x] 3.5 Generalize catalog and command-registry tests across all supported locales, including workflow, expert, built-in pipeline, root-option, installer, config-diagnostic, and dynamic tools-description coverage

## 4. Pipeline Human Presentation

- [x] 4.1 Add a typed `pipeline-messages` formatter covering labels, summaries, empty/not-found states, prompts, warnings, validation results, and error framing
- [x] 4.2 Migrate pipeline `list`, `show`, `agents`, and `classify` human output to the formatter without changing classifier semantics or JSON serialization
- [x] 4.3 Migrate all `resume` human branches, including portfolio, absent/invalid/legacy run-state, interrupted/escalated state, and worker warnings
- [x] 4.4 Migrate pipeline `init`, `validate`, `import`, `export`, and `delete` results, prompts, warnings, cancellation, and error framing
- [x] 4.5 Localize package built-in descriptions by provenance while preserving same-name project/user overrides and the existing enumerable JSON shape
- [x] 4.6 Localize the pipeline command action error boundary and remove remaining direct English framing from the full pipeline call path

## 5. Behavior and Compatibility Tests

- [x] 5.1 Add English/Japanese/Simplified Chinese pipeline formatter and command tests for representative success, empty, not-found, confirmation, validation, warning, and failure paths across all ten subcommands
- [x] 5.2 Add pipeline JSON parity, classifier equality, built-in/user content ownership, provenance, and store/root-selection regression tests
- [x] 5.3 Add Simplified Chinese profile, config, workflow-library, completion, and telemetry success/failure smoke coverage while preserving user content and machine values
- [x] 5.4 Reproduce legacy config migration diagnostics in profile/completion paths and add localized command-owned reporting only if direct English leakage is observed
- [x] 5.5 Add built-CLI E2E coverage for Chinese root/profile/pipeline help, persisted `zh-cn`, dynamic tool IDs, and representative human output after a fresh build
- [x] 5.6 Verify path-sensitive and locale-resolution tests remain cross-platform, including Windows runtime locale behavior and real `ENOTDIR` failure fixtures

## 6. Specifications and Documentation

- [x] 6.1 Update `AGENTS.md` localization invariants for English, Japanese, Simplified Chinese, alias/exclusion rules, pipeline human formatting, and JSON preservation
- [x] 6.2 Update `docs/cli.md` and `docs/workflow-packages.md` with the three-locale contract, auto detection, completion regeneration, and pipeline boundaries
- [x] 6.3 Update only the relevant `docs/zh/cli.md` and `docs/zh/multi-language.md` sections using the agreed CLI terminology and without unrelated cleanup
- [x] 6.4 Validate the change artifacts and confirm archived artifacts and the unrelated active daemon change remain unmodified

## 7. Release Verification and Review

- [x] 7.1 Run all focused locale/config/catalog/command tests and fix change-related failures
- [x] 7.2 Run fresh build, built CLI E2E, typecheck, lint, and the complete test suite with `ZSH` removed
- [x] 7.3 Run manual Chinese and Japanese CLI smoke tests for help, config, and representative pipeline commands
- [x] 7.4 Verify `npm pack --dry-run --json` includes all three compiled locale catalogs and run the package version check without publishing
- [x] 7.5 Run an independent review cycle focused on locale parsing, Chinese terminology, placeholders, machine contracts, and direct English failure output; resolve change-related findings
- [x] 7.6 Review final parent and `local_docs` repository status separately, record final validation results, and ensure no unrelated user work was changed

## Execution Results

- Baseline focused suite: 19 files, 452 tests passed. Baseline typecheck and build passed; lint had one pre-existing restricted type import in `profile-editor.ts`, and the baseline full suite had one timing failure in `management-api/supervisor.test.ts` (3479 passed, 10 skipped).
- Final focused suite: 22 files, 599 tests passed, including all ten pipeline subcommands, transitive root/preflight notices, forced-delete JSON parity, content ownership, locale aliases, config, profile, workflow, completion, and telemetry paths.
- Final project gate: fresh build passed; built CLI E2E passed 25/25; typecheck passed; lint passed; full suite passed 186 files with 3585 tests passed and 10 skipped.
- Locale contract: `zh-cn`, `zh-CN`, `zh_CN.UTF-8`, `zh-SG`, `zh-Hans`, and bare `zh` resolve to `zh-cn`; `zh-TW`, `zh-HK`, `zh-MO`, and core `zh-Hant` remain unsupported. Extension/private-use subtags do not override the core script/region decision.
- Catalogs: `en`, `ja`, and `zh-cn` each contain 728 string leaves with matching keys and placeholders. Simplified Chinese terminology received an independent content review.
- Pipeline contract: all ten human command paths use the typed English/Japanese/Simplified Chinese formatter; package descriptions localize by provenance; project/user overrides, classifier semantics, JSON fields, IDs, enums, paths, digests, raw descriptions, and raw diagnostics remain stable.
- Package verification: `npm pack --dry-run --json` includes `dist/locales/en.json`, `dist/locales/ja.json`, and `dist/locales/zh-cn.json`; `check:pack-version` passes after making the existing guard compatible with npm 11 scoped filenames and scoped install paths. No publish was performed.
- Review cycle: three rounds reached CLEAN. Round 1 found 3 Major and 1 Minor issues; round 2 confirmed those fixes and found one stale test expectation; round 3 and the post-cycle delta verifier reported no open findings.
- Repository safety: the parent branch contains only the intended change. The independent `local_docs` branch commits only `ai/AGENTS.md`; the user-owned untracked investigation and plan files remain unchanged.
