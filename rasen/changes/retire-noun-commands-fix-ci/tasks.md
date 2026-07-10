## 1. Remove the `rasen change` command group

- [x] 1.1 In `src/cli/index.ts`, delete the `changeCmd` group (`.command('change')`, its `preAction` deprecation hook, and the `show`/`list`/`validate` subcommands ~lines 331-391). Keep the top-level `archive` command that follows.
- [x] 1.2 Remove the now-unused `import { ChangeCommand }` if no other reference remains in `index.ts` (verb-first `show` imports `ChangeCommand` inside `src/commands/show.ts`, not here).

## 2. Remove the `rasen spec` command group

- [x] 2.1 In `src/cli/index.ts`, remove the `registerSpecCommand(program)` call (~line 414) and its import (line 14).
- [x] 2.2 In `src/commands/spec.ts`, delete `registerSpecCommand` and the `spec` command definition, keeping the `SpecCommand` class and its `show` method (delegated to by `ShowCommand`).

## 3. Remove orphaned command methods (dead code)

- [x] 3.1 Sweep the repo for references to `ChangeCommand.list`, `ChangeCommand.validate`, `SpecCommand.list`, `SpecCommand.validate`. After task 1-2 they are unreferenced outside removed code.
- [x] 3.2 Delete those now-orphaned methods and any private helpers they alone use. If a helper (e.g. `buildValidationBullets`) is shared with the surviving `.show`, keep it. Verify with `npx tsc --noEmit`.
- [x] 3.3 Keep `ChangeCommand.show` and `SpecCommand.show` intact.

## 4. Sweep dead-command strings in surviving code

- [x] 4.1 Rewrite emitted `rasen change show ... --json --deltas-only` suggestions to `rasen show ... --json --deltas-only` in `src/commands/change.ts:259` (if `buildValidationBullets` survives) and `src/core/validation/constants.ts:41`.
- [x] 4.2 In `src/commands/show.ts`, rewrite the ambiguity/no-arg hints (`:174`, `:198-199`) from `rasen change show` / `rasen spec show` to `rasen show --type change|spec` / `rasen show`.
- [x] 4.3 In `src/commands/validate.ts:259`, rewrite `rasen change validate / rasen spec validate` to `rasen validate --type change|spec` (or drop the noun suggestion).
- [x] 4.4 Rewrite `rasen change list` hints in `src/commands/change.ts:56,192` to `rasen list` (only if those lines survive after task 3).

## 5. Port `--long` to `rasen list`

- [x] 5.1 Add `.option('--long', 'Show id and title with counts')` to the top-level `list` command in `src/cli/index.ts` and thread `long` into `ListCommand.execute` options.
- [x] 5.2 In `src/core/list.ts`, add a `long` option to `ListOptions` and render title + counts (delta/spec counts for changes, requirement count for specs) when `long` is set; default text output unchanged. `--json` payload unchanged.
- [x] 5.3 Add/adjust unit coverage for `rasen list --long` and `rasen list --specs --long` (text rendering), reusing existing list-test fixtures.

## 6. Remove shell completions for the noun commands

- [x] 6.1 In `src/core/completions/command-registry.ts`, delete the `change` (~line 516) and `spec` (~line 565) command entries. Add the `--long` flag to the `list` command entry.
- [x] 6.2 Grep `src/core/completions/templates/` (zsh templates) for `change`/`spec` noun entries and remove them; regenerate any snapshot fixtures if present.
- [x] 6.3 Run the completion tests (`test/**/completion*.test.ts`) and update expectations for the removed groups + new `--long`.

## 7. Sweep docs

- [x] 7.1 In `docs/agent-contract.md`, `docs/opsx-workflow-guide.md`, `docs/stores-beta/user-guide.md`, replace `rasen change ...` / `rasen spec ...` usages with the verb-first equivalents.
- [x] 7.2 Apply the same rewrites to the Chinese mirrors `docs/zh/agent-contract.md`, `docs/zh/opsx-workflow-guide.md`, `docs/zh/stores-beta/user-guide.md`. Do not introduce brand-guard tokens (`opsx`/`openspec-`/`openspec:`/`openspec/`).

## 8. Migrate / delete noun-command tests

- [x] 8.1 Delete `test/commands/change.interactive-show.test.ts`, `change.interactive-validate.test.ts`, `spec.interactive-show.test.ts`, `spec.interactive-validate.test.ts` (verb-first interactive coverage already exists in show/validate tests).
- [x] 8.2 Delete `test/commands/spec.test.ts` (exercised only the removed `rasen spec` surface).
- [x] 8.3 Inspect `test/commands/change-initiative-link.test.ts` for noun-command usage; migrate any surviving-logic assertions to verb-first invocation, or delete if it only covered the removed surface.
- [x] 8.4 Grep the whole `test/` tree for `rasen change ` / `rasen spec ` invocations and migrate/remove stragglers.

## 9. CI fix — doctor D4 (POSIX legs)

- [x] 9.1 In `test/commands/doctor.test.ts` D4 block, replace the hardcoded win32 `oldDataDir()` (and the config-dir fixture) with a platform-aware helper: win32 → `AppData/Local/rasen` & `AppData/Roaming/rasen`; POSIX → `.local/share/rasen` & `.config/rasen` (mirror `oldSchemeDataDir`/`oldSchemeConfigDir`). Keep `newRoot()` = `fixtureHome/.rasen`.
- [x] 9.2 Ensure the fixture-creation calls (`fs.mkdirSync(path.join(oldDataDir(), 'projects'), ...)`) use the platform-correct path so startup adoption engages on every leg.

## 10. CI fix — artifact-workflow archive.timing (Windows leg)

- [x] 10.1 In `test/commands/artifact-workflow.test.ts` archive.timing tests (~lines 856-894), wrap the expected `archiveDir` (`path.join(tempDir, 'rasen', 'changes', 'archive')`) in the existing `canonical()` helper so it matches the CLI's canonicalized `root.path` on Windows CI (8.3 short-name expansion).

## 11. CI/local fix — telemetry notice to stderr

- [x] 11.1 In `src/telemetry/index.ts`, change the `console.log(...)` in `maybeShowTelemetryNotice` to `console.error(...)` so the first-run notice is written to stderr. Wording, opt-out text, and `noticeSeen` persistence unchanged.
- [x] 11.2 Keep the `preAction` `!actionOpts.json` guard in `src/cli/index.ts` as defense-in-depth.
- [x] 11.3 If a telemetry-notice test asserts the stream, update it to expect stderr; add a scenario-level check if one is cheap.

## 12. Verify

- [x] 12.1 `node build.js` (or `pnpm run build`) and `npx tsc --noEmit` clean.
- [x] 12.2 `node bin/rasen.js validate retire-noun-commands-fix-ci --strict` passes.
- [x] 12.3 Confirm the noun commands are gone: `node bin/rasen.js change show x` and `node bin/rasen.js spec show x` exit as unknown commands; `node bin/rasen.js list --long` and `node bin/rasen.js list --specs --long` render titles/counts; `node bin/rasen.js show` / `validate` interactive selection still works.
- [x] 12.4 Run the full suite (`npx vitest run`) — doctor D4, artifact-workflow archive.timing, and the former spec.test area all green; no telemetry-notice stdout pollution. (Windows EBUSY flake per project memory: isolate + rerun once if it surfaces.)
