## 1. Fish completion: stop offering local paths

- [ ] 1.1 In `src/core/completions/generators/fish-generator.ts`, emit a single command-level `complete -c rasen -f` (no-files) directive in `generate()`, before the top-level and per-command completions.
- [ ] 1.2 In `generatePositionalCompletion`, change `case 'path'` from a no-op to emit `complete -c rasen -n '<condition>' -F` (force files) so `init`/`update`/`migrate` still complete filesystem paths.
- [ ] 1.3 Update `test/core/completions/generators/fish-generator.test.ts`: assert the generated script contains the global no-files directive, that a `path` positional emits a force-files (`-F`) completion, and that non-path positions do not rely on the filename fallback.

## 2. Frontmatter: quote YAML-unsafe scalars

- [ ] 2.1 In `src/core/shared/yaml.ts`, add `yamlScalar(value)`: return the value unquoted when it is safe as a YAML plain scalar, otherwise return `quoteYamlValue(value)`. Encode the plain-scalar safety rules from design D2 as one documented predicate (empty; leading/trailing whitespace; control/newline/tab; `: ` or trailing `:`; ` #`; leading YAML indicator char; bool/null/number-looking).
- [ ] 2.2 In `src/core/shared/skill-generation.ts`, change the built-in path of the `scalar()` helper to use `yamlScalar(value)` (i.e. `escapeFrontmatter ? quoteYamlValue(value) : yamlScalar(value)`); leave the user-authored always-quote path unchanged.
- [ ] 2.3 Add unit tests for `yamlScalar` (new `test/core/shared/yaml.test.ts` or existing suite): the `: ` case quotes; a leading-indicator case quotes; ordinary prose (with em-dash, parens, commas) stays unquoted; round-trip through a strict YAML parser yields the original value.
- [ ] 2.4 In `test/core/shared/skill-generation.test.ts`, add a guard test that parses the frontmatter of every generated built-in `SKILL.md` with the strict `yaml` parser and fails on any parse error; assert `rasen-audit`'s description round-trips to the authored text.

## 3. Regenerate and verify

- [ ] 3.1 `pnpm build`, then run `rasen update` in this repo to regenerate the committed `.claude/skills/**/SKILL.md`; confirm only `rasen-audit` and `rasen-office-hours-command` frontmatter change (beyond version stamps) and both now parse cleanly.
- [ ] 3.2 Regenerate Fish completion (`node bin/rasen.js completion generate fish`) and confirm `rasen <TAB>` no longer lists cwd files while `rasen init <TAB>` still completes files (manual check + generator test coverage from 1.3).
- [ ] 3.3 Run `pnpm lint`, `pnpm exec tsc --noEmit`, and the focused suites (`test/core/completions/generators/fish-generator.test.ts`, `test/core/shared/skill-generation.test.ts`, `test/core/shared/yaml.test.ts`), then the full `pnpm test`.
- [ ] 3.4 Confirm cross-platform safety: the Fish change is Fish-only (Unix), the frontmatter change does no path manipulation; verify the Windows CI matrix passes and no path separators were hard-coded.
