# Tasks: cli-locale-workflow-list-skill-title-fixes

## 1. Locale auto-detection (design D1)

- [x] 1.1 Extend `resolveCliLocale()` in `src/utils/locale.ts`: classify each Unix env value as supported / portable (`C`|`POSIX`) / unsupported-language / no-language-information, returning early for the first three and falling through to the next key for the last; add `readOsLocale?: () => string | undefined` to `ResolveCliLocaleOptions`
- [x] 1.2 Add the macOS OS-locale probe (silent `execSync('defaults read -g AppleLocale')`, `try/catch`, memoized per process) used only when platform is `darwin`, `language` is `auto`, and no env key determined a language; wire the default probe in `resolveCliLocale` while keeping injection for tests
- [x] 1.3 Extend `test/utils/locale.test.ts`: GUI-launch case (no env vars, OS locale `ja_JP` → `ja`), probe failure fallback (→ `Intl` → `en`), `LC_ALL=C` → `en`, `LANG=UTF-8` falls through to OS probe, `LANG=fr_FR` → `en`, unchanged Windows and `RASEN_LANG` behavior; verify `test/core/cli-locale.test.ts` still passes

## 2. Workflow registry junk-entry hygiene (design D2)

- [x] 2.1 Add a shared OS-junk predicate (dot-prefixed names, case-insensitive `thumbs.db` / `desktop.ini`) and apply it in `loadWorkflowCatalog()` (`src/core/workflow-registry/registry.ts`) before the is-directory check
- [x] 2.2 Apply the same predicate in the `loadWorkflowSourceTree()` walk (`src/core/workflow-registry/loader.ts`) so junk files never enter `files[]`, digests, or exported packages
- [x] 2.3 Add tests: `.DS_Store` in the library dir produces no invalid record and no list row (human and `--json`); a stray `notes.txt` still produces an invalid record; a `.DS_Store` inside a workflow source tree is excluded from files/digest/export

## 3. `workflow list` column alignment (design D3)

- [x] 3.1 Replace tab-separated rows in `src/commands/workflow-library.ts` with space-padded columns (`padEnd`), computing id and source-label widths across all rendered groups and invalid records per invocation
- [x] 3.2 Add tests in `test/commands/workflow-library.test.ts`: mixed id lengths align, output contains no tab characters, grouping/`--all`/JSON output unchanged

## 4. Manifest `skill:` presentation block (design D4)

- [x] 4.1 Add the `skill:` block to `WorkflowManifestSchema` in `src/core/workflow-registry/manifest.ts` (strict object: required `name`, optional `category`, optional `tags`, all `FrontmatterScalarSchema`; no `enabled` field)
- [x] 4.2 Carry `title` (and optional `category`/`tags`) on `WorkflowDefinition` (`src/core/workflow-registry/types.ts`) and populate it from `skill.name` in `validateWorkflowDirectory()` (`src/core/workflow-registry/validator.ts`); keep digest computation untouched
- [x] 4.3 Update the `command_field_ignored` warning to recommend migrating the title to `skill:`; confirm a manifest carrying both blocks installs with the warning and the honored title
- [x] 4.4 Add validator tests: title accepted and exposed, `skill.enabled` rejected, unknown fields in the block rejected, control characters in `skill.name` rejected, digest unchanged by presence/absence of the block beyond manifest content

## 5. Display-title consumption (design D5)

- [x] 5.1 Use `definition.title ?? definition.skill.template.name` as the user-workflow display name and `short` value in the profile picker (`src/commands/profile-editor.ts`)
- [x] 5.2 Expose `title` in `rasen workflow list --json` entries and in `rasen workflow show` output (`src/commands/workflow-library.ts`), keeping title-less entries distinguishable and human list columns machine-value only
- [x] 5.3 Add tests: picker renders the declared title untranslated across locales while the stored value stays the workflow id; JSON carries the title verbatim; fallback to skill name when the block is absent

## 6. Documentation and verification

- [x] 6.1 Document the `skill:` block in the workflow authoring docs (`docs/`, mirrored by the website sync) and note the macOS `auto` locale behavior where locale configuration is documented
- [x] 6.2 Run `pnpm lint`, `pnpm exec tsc --noEmit`, and the focused test files, then `pnpm test`; confirm locale-catalog parity and vocabulary-sweep suites pass
- [x] 6.3 Validate the change (`rasen validate cli-locale-workflow-list-skill-title-fixes`) and re-run `rasen workflow list` / `rasen profile new` against a junk-seeded fixture library to confirm the reported symptoms are gone
