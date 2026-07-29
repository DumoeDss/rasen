## Context

CLI help copy currently crosses several shallow modules. `CommandDefinition` and `FlagDefinition` mix machine-facing structure with English descriptions; the completion registry, shared flags, Commander registration, and locale catalogs repeat that copy; `localizeDescription()` uses English prose as an identifier; and the dynamic tools description is recovered by parsing an English prefix. Root help is outside the registry, while several command registration modules read descriptions back from the registry and others define their own text.

This produces two coupled sources of truth: the imperative Commander tree used for parsing and the description-bearing completion registry used for shell rendering. Existing parity tests protect much of their machine structure, but copy can still drift because help and completion resolve it through different paths. The exported module-level Commander `program` is also mutated during `runCli()`, so repeated construction under different locales in one process is not isolated.

The change is intentionally breaking because it is based on an unreleased branch. The supported locales remain English, Japanese, and Simplified Chinese, and existing machine contracts remain stable.

## Goals / Non-Goals

**Goals:**

- Make locale catalogs the only source of package-owned CLI help and completion copy.
- Keep the root-inclusive CLI registry limited to command, option, alias, positional, and completion structure.
- Resolve one immutable presentation that Commander and all shell generators can consume.
- Derive ordinary copy locations from canonical command paths rather than storing manual translation IDs.
- Support validated runtime interpolation without parsing source-language prose.
- Construct a fresh, fully localized Commander program for every caller.
- Preserve locale-neutral core behavior and the required `adoptLegacyMachineData()` then locale-resolution ordering.
- Fail before rendering or installation when package-owned structure or English presentation data is invalid.

**Non-Goals:**

- Generating Commander actions, hooks, parsers, defaults, or conflicts from a new declarative CLI DSL.
- Localizing machine-facing command names, aliases, flag names, accepted values, IDs, paths, JSON fields, or shell snippets.
- Replacing the existing locale system or adding ICU MessageFormat or another i18n dependency.
- Changing runtime diagnostics, prompts, or command result localization outside CLI help and completion presentation.
- Adding generic catalog, Commander, or renderer ports before a second implementation requires those seams.

## Decisions

### 1. Use a root-inclusive structure-only registry

`CLI_REGISTRY` will contain a root command node and recursively describe visible canonical commands, options, aliases, and positional completion metadata. Unresolved command and option types will not contain `description`, `descriptionKey`, or another human-copy identifier. Root-owned flags such as `--no-color` will no longer require a separate completeness list.

Aliases such as `store ls` will be represented on their canonical command node rather than as duplicate command definitions. Hidden compatibility commands that differ in behavior remain independent hidden commands; a behavioral redirect is not treated as an alias merely because its user intent is similar.

Ordinary catalog locations are derived from the canonical tree, for example `cli.root.commands.init.options.tools.description`. This keeps one machine identity instead of maintaining both `name` and a manually synchronized translation ID.

Alternative considered: attach stable description IDs to every command and option. This would preserve copy identity across moves, but it would make the registry presentation-aware and introduce another drift source. Command movement is rare and already requires deliberate catalog and completion review, so path-derived identity provides better locality.

Alternative considered: derive the completion model directly from Commander. Commander does not carry all Rasen completion semantics, and doing so would couple completion generation to action registration and command construction. The existing structure parity seam is retained instead.

### 2. Mirror canonical CLI structure in locale catalogs

The existing English-prose-keyed `commandDescriptions` and separate dynamic template bucket will be replaced by a semantic `cli` catalog subtree. It will contain:

- semantic Commander chrome labels, including help headings and generated help/version descriptions;
- root, command, and option descriptions arranged by canonical command structure;
- templates with placeholders where descriptions include runtime facts.

Catalogs contain only canonical commands; aliases reuse the canonical resolved copy. Repeated options use path-local catalog entries by default so context-specific wording remains possible and the registry stays structure-only. Where identical wording is a product invariant, tests compare the explicit catalog slots rather than introducing copy references into machine structure.

English is the complete baseline. The selected locale overlays matching leaves, after which runtime values are interpolated. Shipped locales continue to require identical keys and placeholder sets in CI, so runtime English fallback is defensive rather than permission to ship incomplete translation coverage. Missing or empty English copy is always an internal error.

Alternative considered: preserve a flat prose-to-prose map. Although direct object lookup is inexpensive, prose is not a stable identifier and copy edits should not change schema identity.

### 3. Place resolution behind one deep presentation module

The central module exposes a small interface:

```ts
resolveCliPresentation({ locale, facts? }): ResolvedCliPresentation
```

Its implementation owns registry validation, English and selected-locale overlay, placeholder validation, typed runtime fact collection/overrides, interpolation, alias projection, and immutable resolved-tree construction. Callers do not receive catalog keys or perform fallback.

Unresolved and resolved types remain distinct. `ResolvedCliPresentation` contains non-empty descriptions for the root, every renderable command and option, Commander chrome, and any metadata required by renderers. Completion generators cannot accept unresolved registry data.

The module is deep because one interface hides behavior reused by Commander help, four shell adapters, completion generation and installation, and locale tests. Copy changes remain local to catalogs; topology changes remain local to the registry; rendering concerns remain local to adapters.

Dependencies are in-process. Locale selection stays outside the resolver: callers pass a `CliLocale`, preventing config-reading recursion and making tests deterministic. Package constants and discovered tool IDs are represented as typed facts, with test overrides where needed; no generic interpolation map is exposed to routine callers.

### 4. Validate and interpolate templates explicitly

Dynamic descriptions such as available tool IDs, the default schema, and the default store workspace directory use normal catalog templates. Interpolation occurs only after locale overlay. Values are inserted unchanged so machine identifiers remain stable across locales.

The resolver validates that selected and English templates use the same placeholder set and that all required facts are available. Empty descriptions, unresolved placeholders, duplicate canonical identities, alias collisions, and missing English slots produce typed internal errors carrying the affected semantic path. No regex or source-language prefix matching is used to choose a message.

Alternative considered: make each definition's `description` a function. That would leak locale and runtime behavior into structural data, complicate serialization and tests, and force every renderer to execute presentation logic.

### 5. Replace the exported program singleton with a factory

The package will stop exporting a module-level `program` instance and expose a factory such as:

```ts
createProgram({ locale, facts? }): Command
```

`runCli()` preserves the required order:

1. adopt legacy machine data;
2. resolve the CLI locale once;
3. create a fresh program with that locale;
4. parse the supplied arguments.

Command and option registration remains imperative and omits package-owned help copy. `createProgram()` builds the complete Commander tree, resolves the presentation once, applies it once, and returns the finished instance. Tests and library callers receive isolated instances, so applying Japanese to one program cannot affect a later English program.

This is a deliberate package-level breaking change because `src/index.ts` currently re-exports `program`. A compatibility singleton is not retained because it would preserve mutation lifetime and ordering ambiguity.

Alternative considered: keep the singleton and apply English at import time, then apply the selected locale during `runCli()`. That performs duplicate work, resolves presentation over mutable state, and retains cross-test and cross-locale contamination.

### 6. Keep Commander adaptation private and preflight before mutation

A private Commander adapter compares the completed Commander tree with the resolved root-inclusive presentation before setting descriptions. It validates visible commands, canonical aliases, options, and positionals, builds an application plan, and only applies descriptions and help chrome after preflight succeeds. Framework tokens such as Commander heading strings are mapped explicitly to semantic catalog fields inside this adapter.

Commander remains a concrete in-process dependency. There is no public `CommanderPort`: only one implementation exists, and tests can cheaply construct real `Command` objects. The adapter is an internal seam of the presentation module, not another interface callers must learn.

Generated help/version options are Commander chrome rather than ordinary application commands. Their semantic copy is catalog-owned, while the adapter owns their framework-specific mapping.

### 7. Make shell generators adapters over resolved presentation

`CompletionGenerator.generate()` will accept `ResolvedCliPresentation` or its resolved command projection, never raw `CommandDefinition[]`. Locale selection, fallback, alias policy, and interpolation happen before the shell adapter. Each generator continues to own only shell syntax, escaping, static choices, positional routing, and dynamic completion invocation.

Completion generation and installation snapshot the locale and resolved presentation once per operation so the script and accompanying installer messages cannot observe different locales.

The four existing shell generators are real adapters at the resolved-presentation seam. A generic future renderer interface is not introduced until another caller needs behavior beyond the existing generator contract.

### 8. Preserve imperative command registration

Commander registration continues to define parsing, actions, lazy imports, hooks, defaults, conflicts, and hidden compatibility behavior. Moving these into the structure registry would enlarge its interface until it reproduced Commander and would obscure the presentation-focused seam.

Structure duplication between Commander and the registry remains an intentional trade-off, guarded by root-inclusive parity tests and the adapter preflight. Full declarative action registration can be reconsidered separately if topology drift becomes a demonstrated recurring problem.

### 9. Replace shallow localization tests with seam-level tests

Tests will be reorganized around observable interfaces rather than layered over the old prose lookup helpers:

- catalog key, placeholder, and non-empty parity for all shipped locales;
- root-inclusive registry and Commander parity, including aliases and root flags;
- English baseline and selected-locale overlay behavior;
- typed runtime interpolation preserving machine values;
- missing-copy, placeholder, alias, and Commander mismatch errors before output;
- fresh English, Japanese, and Simplified Chinese programs without cross-instance mutation;
- all shell generators consuming resolved presentation;
- localized CLI and completion end-to-end behavior.

Tests for `localizeDescription()`, English prefix parsing, and direct English descriptions on unresolved definitions will be removed rather than retained beside the new seam.

## Risks / Trade-offs

- [Risk] Mirroring command paths in all locale catalogs increases repeated option copy. → Keep repetition explicit to preserve contextual translation; use equality tests only where shared wording is a product invariant.
- [Risk] The registry and imperative Commander tree can drift. → Validate the full visible tree before applying copy and retain root-inclusive parity tests.
- [Risk] Runtime English fallback could hide an incomplete shipped translation. → Keep catalog key, placeholder, and non-empty parity as release-blocking tests for every supported locale.
- [Risk] Moving all registration into a factory touches many command modules and may expose hidden import-time assumptions. → Migrate command groups incrementally behind one `buildProgram()` path and add fresh-instance regression tests before removing the singleton.
- [Risk] A malformed dynamic template could break help and completion generation. → Validate placeholders and facts before returning resolved presentation or writing a completion script.
- [Risk] Removing exported `program` breaks library consumers. → Document `createProgram()` as the replacement; no compatibility layer is kept on the unreleased branch.
- [Risk] Commander applies some help behavior through framework-generated surfaces. → Keep explicit Commander v14 mappings in one adapter and verify root and nested help through integration tests.
- [Risk] Large catalog and registry migrations can accidentally alter machine values. → Compare command, option, alias, positional, and accepted-value structure before and after; keep machine-contract assertions locale-independent.

## Migration Plan

1. Introduce root-inclusive unresolved and resolved CLI presentation types and a structure-only registry while retaining existing runtime behavior behind temporary internal adapters.
2. Add the semantic `cli` subtree to English, Japanese, and Simplified Chinese catalogs, including dynamic placeholders and Commander chrome; add structural, placeholder, and non-empty validation.
3. Implement the presentation resolver and typed internal errors, then cover overlay, interpolation, alias, and failure behavior at its interface.
4. Change shell generators and completion generation/installation to consume one resolved presentation snapshot.
5. Refactor Commander assembly into a fresh `createProgram()` path, add private preflight/application logic, and remove package-owned descriptions from registration sites.
6. Move root flags and canonical aliases into the registry and update parity and end-to-end tests.
7. Remove the exported singleton, English prose lookup helpers, dynamic prefix parsing, root-option description lists, old catalog sections, and obsolete tests.
8. Run build, type checking, lint, focused locale/completion/CLI tests, the complete test suite with the repository's isolated-shell environment, and package dry-run verification for published catalogs.

Because this is an unreleased breaking refactor, rollback is a source revert rather than a data migration. No persisted user configuration or project file format changes.

## Open Questions

- Whether the resolved shell-generator input should be the whole `ResolvedCliPresentation` or a narrower resolved command projection will be decided during implementation based on which choice avoids duplicating root/alias policy across generators.
- Whether Commander-generated default/choice metadata needs additional semantic chrome fields will be determined by auditing actual Commander v14 help output before the old catalog sections are removed.
