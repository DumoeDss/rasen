## Why

Two small but user-visible defects in generated output:

1. **Fish tab-completion pollutes command and argument positions with local file paths.** Typing `rasen <TAB>` suggests subcommands *and* every file/directory in the cwd. The Fish generator never disables Fish's default filename fallback, so completion is noisy exactly where a path is never valid. (This is not, as first suspected, a completion-library version problem — Rasen hand-rolls its own completion scripts.)
2. **Generated `SKILL.md` frontmatter can be invalid YAML.** When a built-in skill's `description` contains a `: ` (colon-space) sequence — e.g. rasen-audit's "…Experimental: parses an internal transcript format." — the value is emitted as an *unquoted* YAML scalar, which strict YAML parsers reject as a nested mapping. Editors with strict frontmatter validation (Zed) flag the file as an error. Two of the shipped skills (`rasen-audit`, `rasen-office-hours-command`) are affected today.

Both defects live in the code that *generates* artifacts, so every user's `rasen init`/`update` reproduces them until fixed.

## What Changes

- **Fish completion suppresses filename fallback by default.** The generated Fish script disables Fish's automatic file completion for `rasen`, then re-enables filename completion only where a path is genuinely accepted (the `path` positional type on `init`/`update`/`migrate`). Subcommand and non-path argument positions stop suggesting local paths.
- **Generated `SKILL.md` frontmatter is always valid YAML.** Frontmatter scalar values (description, name, license, compatibility, metadata) that contain YAML-significant characters — most importantly `: ` — are quoted so strict parsers accept them. This applies to built-in skills, not just user-authored ones. Regenerating fixes `rasen-audit` and `rasen-office-hours-command`.
- No behavior change to Zsh, Bash, or PowerShell completion (only Fish exhibits the filename-fallback defect), and no change to the *content* of any frontmatter value (only its quoting when required).

## Capabilities

### New Capabilities
- `skill-frontmatter-yaml-safety`: Generated `SKILL.md` YAML frontmatter is valid YAML for every skill; scalar values containing YAML-significant characters are quoted so strict parsers and editors accept them.

### Modified Capabilities
- `cli-completion`: The Fish completion script no longer offers local filesystem paths at command or non-path argument positions, while still completing files where a path argument is accepted.

## Impact

- **Code**
  - `src/core/completions/generators/fish-generator.ts` — emit a command-level "no files" directive and force-files only for `path` positionals.
  - `src/core/shared/skill-generation.ts` and `src/core/shared/yaml.ts` — quote frontmatter scalars when unsafe as YAML plain scalars.
- **Generated output** — regenerated Fish completion scripts; regenerated `SKILL.md` files for the two affected skills (description line becomes quoted). Diff for other skills is unchanged.
- **Tests** — `test/` coverage for the Fish generator and skill-frontmatter generation.
- **No API, dependency, or config changes.** No breaking changes.
