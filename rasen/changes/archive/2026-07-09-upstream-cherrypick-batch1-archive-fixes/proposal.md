## Why

Two upstream `archive` bug fixes from the v1.5 sync are worth carrying into the fork because both are correctness holes in a command we run constantly:

- **`5956a8e` — `archive` exit code on validation failure (#1311).** In human (non-`--json`) mode, `rasen archive <change> -y` returned exit code 0 when validation blocked the archive and nothing was written. Scripts and CI could not tell a blocked archive from a successful one. The `--json` path was already correct (it throws `ArchiveBlockedError`, caught by `printJsonFailure` which sets `exitCode = 1`); this was an asymmetry between the two modes for the same failure.
- **`7e21cc5` — archive scenario drift (#1246 / #1252).** When two changes each MODIFY the same requirement, archiving the second with a *stale* MODIFIED block silently dropped scenarios the first change had already added to the main spec. `buildUpdatedSpec` replaced the requirement block wholesale without checking that the incoming block still contained every scenario present in the current spec.

Both fixes apply almost cleanly on the fork; the only adaptation is dropping the upstream `.changeset/*.md` hunk (changesets were removed during the rasen fork).

## What Changes

- **Exit code (from `5956a8e`).** Set `process.exitCode = 1` at the three human-mode abort points in `ArchiveCommand.run()` before `return null`: delta-spec validation failure, spec-rebuild failure, and rebuilt-spec validation failure. Legitimate user cancellations (declining a confirmation, selecting no change) stay exit 0 by design.
- **Scenario drift (from `7e21cc5`).** In `buildUpdatedSpec`, after a MODIFIED block matches an existing requirement, compare the scenarios in the current (main-spec) block against the incoming block; if the incoming block omits any scenario the current spec still has, throw a descriptive error and abort the archive rather than dropping scenarios. Adds `parseScenarioBlocks` / `findMissingCurrentScenarios` helpers plus a `ScenarioBlock` interface to `specs-apply.ts`.
- **Tests.** Port the upstream regression tests into `test/core/archive.test.ts`: exit-code isolation in `beforeEach`/`afterEach`, three blocked-archive exit-code cases plus a no-leak success case (from `5956a8e`), and the stale-MODIFIED scenario-drift case (from `7e21cc5`).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `cli-archive`: the archive command now sets a non-zero exit code when it blocks in human mode (parity with `--json`), and aborts a spec rebuild when a stale MODIFIED block would drop scenarios currently present in the main spec.

## Impact

- **Source:** `src/core/archive.ts` (three `process.exitCode = 1` lines), `src/core/specs-apply.ts` (scenario-drift guard + helpers).
- **Tests:** `test/core/archive.test.ts` (+~250 lines of regression coverage).
- **Verification:** `pnpm build`; `pnpm vitest run test/core/archive.test.ts`. This is a self-contained, single-area fix — targeted unit tests are sufficient (simple).
- **Delivery:** local ship (commit only, pathspec-scoped to this change's files); no push, no tag. Portfolio pushes once at the end.
- **Dependency edge:** `store-fix` (child D) depends on this change because both edit `archive.ts` / `archive.test.ts`; D's upstream diffs are cut against the post-`5956a8e` blob.
