## Context

Rasen resolves one CLI locale from `RASEN_LANG`, machine-global configuration, Unix locale variables or the Windows runtime locale, and then renders Rasen-owned presentation from JSON catalogs. The current contract supports `en` and `ja`. Catalog-backed profile, config, workflow, completion, help, and telemetry surfaces are already separated from locale-neutral core data, but locale allow-lists are repeated across types, schemas, config metadata, readers, catalogs, and tests.

`rasen pipeline` has a separate gap: command and flag descriptions are catalog-backed, while all ten subcommands still render labels, summaries, prompts, warnings, and error framing directly in English. Pipeline JSON payloads and classifier results are established machine contracts, so runtime localization must not alter their shape or semantics. Built-in pipeline descriptions are Rasen-owned, but user and project pipelines are authored content that must remain verbatim, including when they override a built-in ID.

The implementation targets Node.js 20.19+, TypeScript ESM, Commander.js, and macOS, Linux, and Windows. The design follows the terminology and scope established by `local_docs/rasen-zh-cn-cli-i18n-investigation.md` and keeps English catalog meaning as the translation source of truth.

An active `slice3-daemon-residency` delta spec currently requires only English and Japanese entries for a new command surface. This change does not edit that unrelated active artifact; after this change lands, that branch must rebase and adopt the supported-locale completeness rule before integration.

## Goals / Non-Goals

**Goals:**

- Add canonical CLI locale `zh-cn` everywhere a supported persisted locale is part of the product contract.
- Normalize well-defined Simplified Chinese environment and OS aliases while excluding Traditional Chinese aliases.
- Preserve the existing locale precedence rules on Unix and Windows.
- Provide full key and placeholder parity across `en`, `ja`, and `zh-cn` catalogs.
- Extend the existing localized profile, config, workflow, completion, help, and telemetry surfaces without locale-specific formatter branches.
- Route all ten pipeline subcommands' Rasen-owned human presentation through one typed, command-boundary formatter in all three locales.
- Translate package-owned pipeline descriptions in human views only, while preserving user-authored text and machine-readable output.
- Verify failure paths, package inclusion, and English/Japanese regressions as well as Chinese success paths.

**Non-Goals:**

- Add a Traditional Chinese catalog or map `zh-TW`, `zh-HK`, `zh-MO`, or `zh-Hant` to Simplified Chinese.
- Rename `docs/zh/`, change website locale routing, or perform a repository-wide Chinese documentation cleanup.
- Localize CLI surfaces that are not currently localized in Japanese, except for the explicitly scoped pipeline command group.
- Translate user-authored workflow, profile, pipeline, skill, or command content.
- Translate IDs, JSON fields, diagnostic codes, enum values, paths, filenames, shell snippets, classifier keywords, or classifier results.
- Add Chinese keywords to pipeline classification or otherwise make classifier semantics locale-dependent.
- Redesign the completion registry's English-prose lookup seam beyond making completeness checks locale-generic.

## Decisions

### 1. Use `zh-cn` as the only persisted Simplified Chinese locale ID

`CliLocale` becomes the union derived from `SUPPORTED_CLI_LOCALES = ['en', 'ja', 'zh-cn'] as const`, and `CliLanguage` remains `'auto' | CliLocale`. Persisted config, Zod schemas, config metadata, catalog keys, filenames, and documented `RASEN_LANG` values accept the exact canonical value `zh-cn`.

External locale inputs are aliases and may use BCP 47 casing, underscores, encodings, or modifiers. Persisted config remains strict: hand-edited `zh-CN` or `zh_CN` values are unsupported and follow the existing `auto` fallback behavior rather than being rewritten.

Alternative considered: persist standard-cased `zh-CN`. Rejected because existing product enums are lowercase, the requested public contract is `zh-cn`, and accepting multiple persisted spellings would complicate schema and downgrade behavior.

### 2. Parse Chinese locale aliases by language, script, and region

Locale parsing first trims and lowercases input, converts `_` to `-`, and removes POSIX encoding and modifier suffixes before splitting the locale tag. Existing English and Japanese canonicalization remains unchanged.

For Chinese tags:

- Explicit `Hans` maps to `zh-cn`, even when the region is unusual or conflicts.
- Explicit `Hant` is unsupported, even when the region is `CN` or `SG`.
- Without a script, bare `zh`, region `CN`, and region `SG` map to `zh-cn`.
- Without a script, regions `TW`, `HK`, and `MO` are unsupported.
- Other regions are unsupported rather than guessed.

The parser uses explicit token checks, not a broad `startsWith('zh-')` rule. Table-driven tests cover accepted, rejected, mixed-case, encoded, modified, and script/region-conflict inputs.

Alternative considered: map every `zh-*` input to Simplified Chinese. Rejected because presenting Simplified Chinese to Traditional Chinese users is a worse failure than the established English fallback.

### 3. Preserve locale resolution precedence exactly

Resolution remains:

1. valid `RASEN_LANG` override;
2. explicit persisted `language`;
3. in `auto` mode on Unix, first non-empty `LC_ALL`, `LC_MESSAGES`, or `LANG`, then runtime system locale;
4. in `auto` mode on Windows, runtime system locale;
5. English fallback.

An invalid `RASEN_LANG` remains ignored so resolution continues. An unsupported but non-empty high-priority Unix locale remains authoritative and resolves to English rather than falling through to a lower-priority variable. Locale probing keeps using a silent, non-persisting global-config read to avoid recursion and premature English diagnostics.

Alternative considered: improve fallback by trying every lower-priority locale variable. Rejected because this change must add a locale without changing existing precedence behavior.

### 4. Make supported locales a low-level shared contract

`SUPPORTED_CLI_LOCALES` lives with `CliLocale` in `src/utils/locale.ts`, where config and catalog modules can import it without creating a cycle. `Language` aliases `CliLanguage` where dependency direction permits. Zod enums and config registry metadata derive from or are compile-time checked against the same tuple. `CATALOGS satisfies Record<CliLocale, LocaleCatalog>` remains the catalog exhaustiveness gate.

Tests iterate `SUPPORTED_CLI_LOCALES` for catalog and command-description completeness. Where a runtime API cannot consume the readonly tuple directly, a narrow conversion is allowed, with tests preserving equality.

Alternative considered: add `zh-cn` independently to every existing list. Rejected because the current duplication caused the omission risk this change is intended to remove.

### 5. Keep catalogs static and make English the structural source

`src/locales/zh-cn.json` is statically imported by `src/locales/index.ts`, ensuring TypeScript build output includes `dist/locales/zh-cn.json`. No filesystem-based dynamic loading is introduced.

English defines keys, placeholders, and meaning. Japanese receives the new pipeline section first, and Simplified Chinese mirrors the expanded English structure. Catalog tests compare every locale's leaf keys and placeholder sets to English, verify each catalog's `locale` metadata, and check all built-in workflow, expert, pipeline, root-option, command, flag, completion-installer, config-diagnostic, and pipeline-message entries.

Chinese terminology follows the investigation glossary, including `变更`, `提案`, `设计`, `规格`, `任务`, `工作流`, `流水线`, `阶段`, `产物`, `校验`, and `验证`. Machine fragments and placeholders remain byte-identical.

Alternative considered: derive Chinese text from Japanese or `docs/zh` wholesale. Rejected because English runtime meaning is authoritative and parts of `docs/zh` still contain historical terminology.

### 6. Generalize help and completion localization by locale

Commander help continues using default behavior for English. Every non-English supported locale applies `help.titles`, `help.helpOption`, and `help.helpCommand` from its selected catalog recursively to child commands. Unknown Commander title categories retain a safe default fallback.

`hasJapaneseDescription()` becomes a locale-parameterized completeness helper. Command and flag registration order and dynamic tool IDs remain unchanged; only descriptions vary. Generated Zsh, Fish, and PowerShell descriptions use the selected catalog, while Bash retains its existing no-description behavior.

Alternative considered: add a second `locale === 'zh-cn'` branch next to the Japanese branch. Rejected because each added locale would duplicate wiring and could drift.

### 7. Add a typed pipeline presentation boundary

A new `src/commands/pipeline-messages.ts` owns stable pipeline message keys, interpolation, list and detail labels, prompts, warnings, summaries, and error framing. Both `src/commands/pipeline.ts` and `src/commands/pipeline-library.ts` select descriptors from typed command data and render them with the resolved catalog. The top-level pipeline action error boundary also uses this formatter.

The formatter receives a locale/catalog and structured values; it does not infer a message by exact-matching or regex-transforming English prose. Raw core diagnostics remain available as detail, while Rasen-owned framing is localized. English, Japanese, and Simplified Chinese use the same control flow.

Inventory and tests cover `list`, `show`, `agents`, `classify`, `resume`, `init`, `validate`, `import`, `export`, and `delete`, including empty, not-found, confirmation, cancellation, validation, collision, referrer, portfolio, legacy run-state, interrupted, escalated, duplicate-key, and worker-handle warning branches.

Alternative considered: translate the existing final strings at the console boundary. Rejected because string matching would be fragile, would hide missing branches, and could corrupt raw diagnostic compatibility.

### 8. Localize built-in pipeline descriptions using provenance, not ID alone

Human views translate a pipeline description only when resolution provenance says its source is the package layer and the stable ID has a catalog entry. User and project pipeline names and descriptions remain verbatim, including a user or project pipeline whose ID matches a built-in.

Where `show` currently loses source information before rendering, provenance is attached as rendering-only data or a non-enumerable typed descriptor. It is not added as an enumerable JSON field. JSON output bypasses human formatting and retains the raw package description and existing shape.

Alternative considered: translate any known built-in ID. Rejected because it would mistranslate higher-precedence user or project overrides.

### 9. Treat JSON and classification as locale-neutral contracts

All pipeline `--json` branches continue serializing the existing domain results directly. Locale affects only human views. Tests compare representative English, Japanese, and Chinese payloads for field names, IDs, enum values, codes, paths, digests, raw descriptions, and diagnostic detail.

`pipeline classify` keeps the same keyword heuristic, `suggested`, `matched`, and `basis` values in every locale. Only human labels and explanatory Rasen-owned text are localized.

Alternative considered: localize JSON descriptions for built-ins. Rejected because consumers may compare raw registry data and because existing JSON is a machine contract.

### 10. Update specifications and docs without rewriting history

This change carries delta specs for `profiles`, `workflow-library`, `change-creation`, and `opsx-pipeline-registry`. Archived changes remain untouched. Main specs are synchronized only through the normal Rasen archive/sync workflow after implementation.

`AGENTS.md`, `docs/cli.md`, `docs/workflow-packages.md`, `docs/zh/cli.md`, and `docs/zh/multi-language.md` document the three-locale contract, alias behavior, Traditional Chinese fallback, completion regeneration, pipeline human localization, and machine-contract boundary. The existing `docs/zh/` route remains unchanged.

### 11. Verify in layers and commit in reviewable units

Implementation proceeds through focused locale/config tests, catalog and help integration, pipeline formatter migration, behavior/failure-path coverage, documentation, then full release verification. Baseline failures are recorded before behavior changes. Fresh build precedes E2E, and `npm pack --dry-run --json` verifies all three `dist/locales/*.json` entries without publishing.

Suggested commits are: (1) change artifacts and locale/config/parser contract, (2) catalog/help/completion integration, (3) pipeline human-output localization, (4) behavior tests and docs. Boundaries may be adjusted if tests and implementation are inseparable.

## Risks / Trade-offs

- [Chinese alias false positive maps a Traditional Chinese user to Simplified Chinese] → Parse explicit script and region tokens and maintain accepted/rejected matrix tests, including conflicts.
- [A duplicated locale allow-list omits `zh-cn`] → Centralize supported locales and enforce exhaustive catalog/config/command tests.
- [The new catalog builds locally but is absent from npm] → Use a static import, fresh build, and package dry-run file inspection.
- [Placeholder or shell snippet translation breaks runtime behavior] → Compare placeholder sets, assert exact snippets, and review machine fragments.
- [Pipeline localization changes JSON or classifier semantics] → Keep separate human and machine branches and compare locale-parametrized JSON results.
- [Built-in translation leaks onto a same-name user override] → Require package provenance and test project/user overrides with unchanged JSON shape.
- [Rare `resume` or delete warnings remain English] → Inventory direct output and add named tests for each branch before removing legacy strings.
- [Command-owned config reads emit English migration diagnostics] → Reproduce with legacy fixtures and add localized reporters only where evidence shows leakage; preserve silent locale probing.
- [Chinese catalog quality passes structural tests but reads unnaturally] → Apply the agreed glossary and perform an independent Simplified Chinese terminology review.
- [The active daemon change lands with only two catalog entries] → Record the integration dependency and require rebase/spec update to all supported locales.
- [Large catalog and pipeline diffs become hard to review] → Keep commits and formatter responsibilities narrow, and run an independent review cycle.

## Migration Plan

1. Introduce the three-locale type/config/parser contract and tests without changing the persisted default (`auto`).
2. Add and register the complete `zh-cn` catalog, generalize help/completion lookup, and build the new catalog into `dist`.
3. Move pipeline human rendering to the typed formatter while retaining existing JSON serialization and raw diagnostics.
4. Run focused and full verification, manual Chinese/Japanese smoke tests, and package dry-run verification.
5. Update specifications and public documentation in the same branch.

No config migration is required. Existing installations continue using `auto`, `en`, or `ja`; a previously hand-edited exact `zh-cn` value becomes valid after upgrade. Downgrading to an older Rasen version treats `zh-cn` as unknown and follows the existing `auto` behavior. Rollback therefore consists of reverting the release; no stored-data transformation must be undone.

## Open Questions

None. Locale identity, alias mapping, Traditional Chinese exclusion, localization scope, terminology source, and machine-contract boundaries are fixed by the investigation and this design.
