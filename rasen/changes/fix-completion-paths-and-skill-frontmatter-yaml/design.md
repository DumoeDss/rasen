## Context

Two independent generation-side defects, both reproduced by every `rasen init`/`update`:

1. **Fish completion filename noise.** `src/core/completions/generators/fish-generator.ts` emits `complete -c rasen …` entries for subcommands, flags, and positionals, but never tells Fish to stop completing filenames. Fish's default is: if no completion for a command applies (or even alongside ones that do), suggest files from the cwd. So `rasen <TAB>` lists subcommands *and* local paths, and every non-path argument position is similarly polluted. The `path` positional case is currently an intentional no-op that *relies* on this default (comment: "Fish automatically completes files").

   Zsh, Bash, and PowerShell do not have this defect: the Zsh generator only calls `_describe` at the command position and only emits `_files`/`_default` for explicit positionals; Bash builds `COMPREPLY` explicitly and uses `compgen -f` only for the `path` type; PowerShell returns explicit `CompletionResult`s. So the fix is Fish-only.

2. **Unquoted frontmatter scalars can be invalid YAML.** `generateSkillContent` (`src/core/shared/skill-generation.ts`) has a `scalar()` helper that quotes values only when `escapeFrontmatter` is true, and `escapeFrontmatter` is set (in `getSkillTemplates`) only for user-authored skills (`definition.source === 'user'`). Built-in skills emit `description`, `name`, `license`, `compatibility`, and metadata values verbatim/unquoted. A YAML plain scalar may not contain `: ` (colon-space); `rasen-audit` and `rasen-office-hours-command` both do ("Experimental: parses…", "validate demand reality before building. …: …"), so their generated frontmatter is rejected by strict YAML parsers. Confirmed: 2 of 34 installed `SKILL.md` files fail to parse under the `yaml` package (the same strict family Zed's language server uses); the error is `Nested mappings are not allowed in compact mappings`.

## Goals / Non-Goals

**Goals:**
- Fish completion never offers local paths at the command position or at non-path argument positions, and still completes files where a path argument is accepted.
- Every generated `SKILL.md` frontmatter parses under a strict YAML parser, for built-in and user-authored skills alike.
- Minimal diff: no change to the *content* of any frontmatter value, and no re-quoting of values that are already YAML-safe (keeps existing tests and committed generated files stable).

**Non-Goals:**
- Redesigning the completion architecture or the command registry.
- Changing Zsh/Bash/PowerShell completion behavior.
- Switching frontmatter emission to a full YAML serialization library.
- Force-completing files for path-valued *flags* (e.g. `--out`, `--projects-dir`); see Risks.

## Decisions

### D1 — Fish: suppress filename fallback globally, force files only for path arguments

Emit one command-level directive in the generated script that disables Fish's filename fallback for `rasen`, then re-enable filenames explicitly for the `path` positional type.

- In `FishGenerator.generate()`, add a single `complete -c rasen -f` line (Fish's `--no-files`) up front, before the per-command completions. This is the documented Fish idiom for a command whose arguments are not filenames by default.
- In `generatePositionalCompletion`, change `case 'path'` from a no-op to emit `complete -c rasen -n '<condition>' -F` (`--force-files`), which overrides the global `-f` for exactly the `init`/`update`/`migrate` path argument.

Rationale: this is the standard Fish pattern and localizes the fix to the generator. The set of path-accepting commands is already encoded in the command registry via `positionalType: 'path'`, so we rely on that explicit lookup rather than matching command names.

**Alternatives considered:**
- *Add `-f` only to the top-level `__fish_rasen_no_subcommand` completions.* Rejected: fixes only the command position; non-path argument positions (e.g. after `rasen show`) would still show files, and Fish's fallback is command-scoped, so a single global directive is both simpler and more complete.
- *Detect path-valued flags and force files on them too.* Rejected for scope: the registry does not currently mark which value-flags are paths, and the reported symptom is about positions where paths are never valid. Treated as a non-goal.

### D2 — Frontmatter: quote scalars only when unsafe as a YAML plain scalar

Introduce a `yamlScalar(value)` helper in `src/core/shared/yaml.ts` that returns the value unquoted when it is safe as a YAML plain scalar, and otherwise returns `quoteYamlValue(value)` (the existing double-quote-and-escape function). Use it for the built-in emission path in `generateSkillContent`; leave the user-authored path (`escapeFrontmatter === true`, always-quote) unchanged.

Concretely, the `scalar()` helper becomes `escapeFrontmatter ? quoteYamlValue(value) : yamlScalar(value)`.

A value is treated as needing quoting when any hold: it is empty; it has leading/trailing whitespace; it contains a control character, newline, tab, `: ` (colon-space) or a trailing `:`; it contains ` #` (space-hash); it begins with a YAML indicator character (`!&*?|>%@\`"'#,[]{}` or a leading `-`/`:`/`?` that starts a token); or it would be misread as a YAML bool/null/number. These are the plain-scalar constraints from the YAML spec, encoded as one small documented predicate with direct unit tests — not an open-ended heuristic.

Rationale:
- **Minimal churn.** Safe values (`rasen-explore`, `rasen`, `MIT`, `Requires rasen CLI.`) stay unquoted, so the many existing tests asserting `name: rasen-…` / `author: rasen` and the committed generated `SKILL.md` files are unaffected. Only the two offending description lines gain quotes.
- **Robust and uniform.** New or edited built-in descriptions that happen to contain `: ` are handled automatically; the defect cannot silently reappear.
- **Reuses existing escaping.** `quoteYamlValue` already emits valid double-quoted YAML (escapes `\`, `"`, `\n`, `\r`); no new escaping logic.

**Alternatives considered:**
- *Always quote every frontmatter scalar (drop the `escapeFrontmatter` distinction).* Deterministic and heuristic-free, but re-quotes all 34 generated files and breaks a broad set of tests that assert `name: rasen-<x>` / `author: rasen` unquoted. Rejected: disproportionate churn for a small fix.
- *Serialize frontmatter with the `yaml` library's `stringify`.* Most robust in principle, but reflows the entire frontmatter block format (key order, quoting style, spacing) across every file — far larger diff and risk than the defect warrants.
- *Hand-edit the two skill template descriptions to remove `: `.* Rejected: treats a symptom, leaves the generator able to reintroduce invalid YAML, and degrades the wording.

## Risks / Trade-offs

- **[Fish: path-valued flags lose implicit file completion]** After the global `-f`, value-flags such as `--out <path>` or `--projects-dir <dir>` no longer trigger Fish's filename completion (they emit `-r` for "requires parameter", not `-F`). → Mitigation: accepted as a non-goal; these were never explicitly typed as paths, and the far more common noise (files at every subcommand/argument position) is eliminated. A follow-up can add a path-flag marker to the registry if demand appears.
- **[YAML predicate under-quotes and lets invalid YAML through]** A missed edge case in the safety predicate could leave an unsafe value unquoted. → Mitigation: a generation-time guard test parses every generated built-in `SKILL.md` frontmatter with the strict `yaml` parser and fails on any error; plus targeted unit tests for the predicate (including the `: ` case).
- **[YAML predicate over-quotes and churns files]** Too-aggressive quoting would add quotes to currently-safe values and produce diff/test noise. → Mitigation: the predicate is conservative and covered by a "safe values stay unquoted" unit test; the full-suite run surfaces any unexpected frontmatter change.
- **[Regeneration required to fix installed skills]** Existing installs keep the invalid frontmatter until `rasen update` runs. → Mitigation: this is inherent to generated output; the version stamp already prompts users to update, and the repo's own committed skills are regenerated as part of this change.

## Migration Plan

1. Implement D1 and D2 with tests.
2. `pnpm build`, then regenerate this repo's dogfooding skills via `rasen update` so the committed `.claude/skills/**/SKILL.md` reflect the fix (the two affected files change; others change only by version stamp, if at all).
3. Regenerate/verify Fish completion output.
4. No rollback complexity: both changes are localized to generators; reverting the two source edits fully restores prior behavior.

## Open Questions

- None blocking. (Whether to later mark path-valued flags for Fish file completion is deferred, per the non-goal above.)
