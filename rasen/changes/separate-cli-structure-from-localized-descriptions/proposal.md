## Why

CLI help and completion descriptions currently use English prose as locale-catalog keys and duplicate that prose across Commander registration, the completion registry, and locale files. This makes copy edits structural changes, permits the help and completion surfaces to drift, and requires special English-prefix parsing for dynamic descriptions; the unreleased branch gives us an opportunity to replace that coupling before it becomes a compatibility burden.

## What Changes

- Introduce one catalog-backed CLI presentation contract for root help, command descriptions, option descriptions, generated help labels, and shell completion descriptions.
- Make the root-inclusive CLI registry describe machine-facing command structure only; derive human-copy slots from canonical command paths and keep aliases attached to their canonical commands.
- Resolve English baseline copy, the selected locale overlay, and runtime interpolation values into an immutable presentation before rendering Commander help or shell completion scripts.
- Preserve command names, option names, aliases, accepted values, identifiers, paths, and shell snippets as stable machine contracts across locales.
- Replace English-prose lookup and dynamic prefix parsing with semantic catalog structure and validated placeholders.
- Require all shipped locale catalogs to cover the same CLI presentation slots with matching placeholders and non-empty copy, while retaining an English runtime fallback for a missing selected-locale entry.
- **BREAKING** Remove human descriptions from unresolved command and flag definitions; completion generators accept only resolved presentation data.
- **BREAKING** Replace the exported module-level Commander `program` singleton with a factory that returns a fresh, fully localized program instance.

## Capabilities

### New Capabilities

- `cli-help-presentation`: Defines catalog-backed, locale-aware CLI help presentation shared by Commander and shell completion renderers, including root help, aliases, runtime interpolation, fallback, and consistency guarantees.

### Modified Capabilities

- `cli-completion`: Changes the command registry from a description-bearing completion model to a root-inclusive structure model and requires completion generators to consume resolved presentation data.

## Impact

- Affects CLI construction and public exports in `src/cli/`, command registration in `src/cli/index.ts` and `src/commands/`, completion registry/types/generators in `src/core/completions/`, and all supported locale catalogs in `src/locales/`.
- Replaces existing description-localization helpers, root-option description bookkeeping, duplicated alias entries, and hardcoded Commander help copy.
- Requires updates to registry parity, locale completeness, Commander help, shell completion, and CLI end-to-end tests.
- Changes the package-level TypeScript surface currently re-exporting the Commander `program` instance.
- Adds no runtime dependency and preserves English, Japanese, and Simplified Chinese as the supported CLI locales.
