## 1. Contract and Baseline

- [x] 1.1 Create the proposal, design, and delta specifications that fix the `zh-cn` locale contract, pipeline scope, content-ownership boundary, and active-change integration note
- [x] 1.2 Run the locale, config, catalog, help/completion, and pipeline focused test baseline and record any pre-existing failures
- [x] 1.3 Run baseline typecheck, lint, build, and the full test suite with `ZSH` removed; record any pre-existing failures
- [x] 1.4 Capture representative pipeline JSON shapes and current package locale entries before implementation

## 2. Locale and Configuration Contract

- [ ] 2.1 Add `SUPPORTED_CLI_LOCALES`, derive locale/language types, and update global config, Zod schema, config registry, and API metadata for exact persisted `zh-cn`
- [ ] 2.2 Implement script- and region-aware Simplified Chinese locale normalization while preserving Unix and Windows precedence behavior
- [ ] 2.3 Add table-driven locale, CLI locale, config round-trip/strictness, effective-config, and config API tests for `zh-cn`

## 3. Catalog, Help, and Completion Integration

- [ ] 3.1 Add English and Japanese pipeline message and built-in pipeline metadata catalog sections with stable keys and placeholders
- [ ] 3.2 Add the complete `src/locales/zh-cn.json` catalog using the agreed terminology while preserving placeholders and machine fragments
- [ ] 3.3 Register the Simplified Chinese catalog statically and generalize Commander help localization for every non-English supported locale
- [ ] 3.4 Generalize command-description completeness lookup from Japanese-specific to locale-parameterized behavior and update the pipeline group description consistently
- [ ] 3.5 Generalize catalog and command-registry tests across all supported locales, including workflow, expert, built-in pipeline, root-option, installer, config-diagnostic, and dynamic tools-description coverage

## 4. Pipeline Human Presentation

- [ ] 4.1 Add a typed `pipeline-messages` formatter covering labels, summaries, empty/not-found states, prompts, warnings, validation results, and error framing
- [ ] 4.2 Migrate pipeline `list`, `show`, `agents`, and `classify` human output to the formatter without changing classifier semantics or JSON serialization
- [ ] 4.3 Migrate all `resume` human branches, including portfolio, absent/invalid/legacy run-state, interrupted/escalated state, and worker warnings
- [ ] 4.4 Migrate pipeline `init`, `validate`, `import`, `export`, and `delete` results, prompts, warnings, cancellation, and error framing
- [ ] 4.5 Localize package built-in descriptions by provenance while preserving same-name project/user overrides and the existing enumerable JSON shape
- [ ] 4.6 Localize the pipeline command action error boundary and remove remaining direct English framing from the full pipeline call path

## 5. Behavior and Compatibility Tests

- [ ] 5.1 Add English/Japanese/Simplified Chinese pipeline formatter and command tests for representative success, empty, not-found, confirmation, validation, warning, and failure paths across all ten subcommands
- [ ] 5.2 Add pipeline JSON parity, classifier equality, built-in/user content ownership, provenance, and store/root-selection regression tests
- [ ] 5.3 Add Simplified Chinese profile, config, workflow-library, completion, and telemetry success/failure smoke coverage while preserving user content and machine values
- [ ] 5.4 Reproduce legacy config migration diagnostics in profile/completion paths and add localized command-owned reporting only if direct English leakage is observed
- [ ] 5.5 Add built-CLI E2E coverage for Chinese root/profile/pipeline help, persisted `zh-cn`, dynamic tool IDs, and representative human output after a fresh build
- [ ] 5.6 Verify path-sensitive and locale-resolution tests remain cross-platform, including Windows runtime locale behavior and real `ENOTDIR` failure fixtures

## 6. Specifications and Documentation

- [ ] 6.1 Update `AGENTS.md` localization invariants for English, Japanese, Simplified Chinese, alias/exclusion rules, pipeline human formatting, and JSON preservation
- [ ] 6.2 Update `docs/cli.md` and `docs/workflow-packages.md` with the three-locale contract, auto detection, completion regeneration, and pipeline boundaries
- [ ] 6.3 Update only the relevant `docs/zh/cli.md` and `docs/zh/multi-language.md` sections using the agreed CLI terminology and without unrelated cleanup
- [ ] 6.4 Validate the change artifacts and confirm archived artifacts and the unrelated active daemon change remain unmodified

## 7. Release Verification and Review

- [ ] 7.1 Run all focused locale/config/catalog/command tests and fix change-related failures
- [ ] 7.2 Run fresh build, built CLI E2E, typecheck, lint, and the complete test suite with `ZSH` removed
- [ ] 7.3 Run manual Chinese and Japanese CLI smoke tests for help, config, and representative pipeline commands
- [ ] 7.4 Verify `npm pack --dry-run --json` includes all three compiled locale catalogs and run the package version check without publishing
- [ ] 7.5 Run an independent review cycle focused on locale parsing, Chinese terminology, placeholders, machine contracts, and direct English failure output; resolve change-related findings
- [ ] 7.6 Review final parent and `local_docs` repository status separately, record final validation results, and ensure no unrelated user work was changed
