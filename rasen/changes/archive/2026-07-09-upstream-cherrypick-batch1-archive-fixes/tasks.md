## 1. Pick 5956a8e — archive exit code (src)

- [x] 1.1 `git cherry-pick -n 5956a8e` (or manual). Keep the `src/core/archive.ts` hunks: three `process.exitCode = 1;` lines before `return null;` at the delta-spec validation abort (~L311, after "Validation failed. Please fix..."), the spec-rebuild abort (~L429, after "Aborted. No files were changed."), and the rebuilt-spec validation abort (~L453, after the rebuilt-spec error loop). All three apply cleanly (brand-neutral context).
- [x] 1.2 **DROP** the `.changeset/fix-archive-exit-code.md` hunk — changesets removed in the fork. If cherry-pick created the file, delete it (`rm .changeset/fix-archive-exit-code.md`) and ensure it is not staged.

## 2. Pick 5956a8e — archive exit code (tests)

- [x] 2.1 Keep the `test/core/archive.test.ts` hunks: `const originalExitCode = process.exitCode;`, `process.exitCode = undefined;` in `beforeEach`, `process.exitCode = originalExitCode;` in `afterEach`, and the new `describe('exit code on blocked archive (human mode)')` block (4 tests: delta-fail, rebuild-fail, rebuilt-validate-fail via `Validator.prototype.validateSpecContent` spy, and the exit-0 no-leak success case). All brand-neutral; apply as-is.

## 3. Pick 7e21cc5 — scenario drift (src)

- [x] 3.1 In `src/core/specs-apply.ts`, add the `ScenarioBlock` interface after `SpecsApplyOutput`. Rewrite the MODIFIED loop to capture `const currentBlock = nameToBlock.get(key)` (replacing `if (!nameToBlock.has(key))`), and after the header-mismatch check, call `findMissingCurrentScenarios(currentBlock, mod)` and throw the drift error if any scenario is missing. Add the `findMissingCurrentScenarios` and `parseScenarioBlocks` helpers after `buildSpecSkeleton`. Pre-image matches our file verbatim (~L285-297) — applies cleanly.

## 4. Pick 7e21cc5 — scenario drift (tests)

- [x] 4.1 Add the `should abort stale MODIFIED blocks that would drop current scenarios (issue #1246)` test to `test/core/archive.test.ts` (before the `should abort with a structural error when target spec hides requirements...` test). Brand-neutral; applies on the post-5956a8e tree. Order matters: apply pick 5956a8e (tasks 1-2) before this one.

## 5. Verify (simple — targeted tests sufficient)

- [x] 5.1 `pnpm build` (must succeed; specs-apply.ts is compiled into the CLI).
- [x] 5.2 `pnpm vitest run test/core/archive.test.ts` — all archive tests green, including the 4 new exit-code tests and the scenario-drift test.
- [x] 5.3 `node bin/rasen.js validate upstream-cherrypick-batch1-archive-fixes` — change delta valid.
- [x] 5.4 Confirm no files outside the touch-set (`src/core/archive.ts`, `src/core/specs-apply.ts`, `test/core/archive.test.ts`) are modified; confirm `.changeset/` was not resurrected.
