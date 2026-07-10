## Context

Two work items ship together in this change.

**Item 1 — retire noun commands.** `rasen change ...` and `rasen spec ...` have been deprecated for several releases; both already print runtime deprecation warnings via `preAction` hooks steering users to verb-first commands. The `change` group lives inline in `src/cli/index.ts` (~lines 331-391); the `spec` group is registered by `registerSpecCommand` in `src/commands/spec.ts`. Both are thin wrappers over the `ChangeCommand`/`SpecCommand` classes that the verb-first `rasen show` command also uses.

**Item 2 — fix red CI.** `main` run 29086744907 (commit 486daf0) is red on every OS leg with three independent, pre-existing defects (not caused by item 1). They must be green for the PR to merge, so they are fixed here.

### Research findings (verified in this worktree)

**(a) Verb-first parity.** `ShowCommand.execute` (`src/commands/show.ts:39-57, 79-101`): with no item name and interactive, it prompts for type (change/spec) then item, delegating to `ChangeCommand.show`/`SpecCommand.show` — a *superset* of the noun `change show`/`spec show` (which only pick within one type). `ValidateCommand` (`src/commands/validate.ts:92-190`) has its own interactive selection covering all/changes/specs/item. So verb-first interactive selection equals-or-exceeds the noun paths; nothing is lost. The specs already cover this: cli-show "Top-level show command" and cli-validate "Top-level validate command". The **one** capability that existed only on the noun path is the `--long` flag on `change list`/`spec list` (`ChangeCommand.list`, `SpecCommand.list` — human-readable title + counts); `rasen list` (backed by `ListCommand`, `src/core/list.ts`) lacks it, so it is ported.

**(b) Why doctor D4 fails only on POSIX CI.** The D4 tests (`test/commands/doctor.test.ts:445-579`) redirect `HOME`/`USERPROFILE`/`LOCALAPPDATA`/`APPDATA` to a fixture home and rely on the CLI's startup `adoptLegacyMachineData()`. But the test helpers hardcode the **win32** old-scheme path: `oldDataDir()` returns `fixtureHome/AppData/Local/rasen`. Production `oldSchemeDataDir` (`src/core/global-config.ts:271-279`) resolves that path only on win32; on POSIX it returns `fixtureHome/.local/share/rasen`. So on POSIX CI the fixture legacy dir is created at a path the code never probes → no lingering/pending note is produced → the assertions on `'Legacy data dir'` / `'Relocation pending'` / `'left behind'` get empty output and fail. The **production code is correct on both platforms**; the test's fixture path is win32-only. Introduced by cba4073 (feat machine-home relocate); the POSIX break has existed since then.

**(c) Why artifact-workflow fails only on Windows CI.** The archive.timing tests (`test/commands/artifact-workflow.test.ts:855-903`) assert `json.archive.archiveDir` equals a raw `path.join(tempDir, 'rasen', 'changes', 'archive')`. But `status` derives `archiveDir` from `root.path`, which `resolveRootForCommand` canonicalizes via `FileSystemUtils.canonicalizeExistingPath` (`src/core/root-selection.ts:138-144, 279, 451`) — expanding Windows 8.3 short segments. On Windows CI, `os.tmpdir()` contains a short segment (e.g. `RUNNER~1`) that the CLI expands to the long form, so the strings differ and `toEqual` fails. On local Windows (short username, no `~1`) and on POSIX (no 8.3 names) they coincide, so it passes there. The sibling workDir tests already avoid this by using the `canonical()` helper (`test:12`) / `normalizePaths` + `toContain`; the archive.timing tests were added by a93ccf9 and missed the later canonical-alignment sweep (f529b25). **Production output is correct**; the test assertion is not canonicalized.

**(d) Telemetry notice pollution (genuine product bug).** `maybeShowTelemetryNotice` (`src/telemetry/index.ts:170-191`) writes the first-run notice with `console.log` → **stdout**. For non-`--json` text commands the `preAction` guard (`src/cli/index.ts:132-135`) still lets it run, so the notice prepends to command stdout. `spec.test.ts:58-68` spawns `node bin/rasen.js spec show auth` via bare `execSync` (no `RASEN_TELEMETRY=0`, unlike the `run-cli.ts` helper), so on a dev machine with telemetry enabled and the notice unseen, the notice pollutes captured stdout and the raw-passthrough assertion fails. CI sets `CI=true` → telemetry disabled → notice suppressed → passes. This is a real defect: a human notice must never share stdout with command output.

## Goals / Non-Goals

**Goals:**
- Remove the `rasen change` and `rasen spec` command groups entirely (wrappers, completions, docs, tests) while preserving every capability via verb-first commands.
- Port `--long` to `rasen list` so no capability is dropped.
- Make CI green on all legs by fixing the true causes: platform-aware D4 fixtures, canonicalized archive.timing assertions, and the telemetry-notice-to-stderr product fix.
- Keep verb-first error/hint output free of now-dead command suggestions.

**Non-Goals:**
- No version bump (stays 0.1.1); no CHANGELOG version-heading edits.
- No change to telemetry data collection, opt-out semantics, or notice wording (only the output stream changes).
- No re-architecture of `ChangeCommand`/`SpecCommand`; `.show` stays as the verb-first delegate.
- Not converging with upstream, which keeps the noun groups (accepted divergence; precedent browse→chrome-use).

## Decisions

1. **Remove wrappers, keep classes.** Delete the inline `change` group from `src/cli/index.ts` and the `registerSpecCommand` call + definition from `src/commands/spec.ts`. Keep `ChangeCommand.show` and `SpecCommand.show` (delegated to by `ShowCommand`). The now-orphaned `ChangeCommand.list`/`ChangeCommand.validate` and `SpecCommand.list`/`SpecCommand.validate` (plus any private helpers they alone use) are removed as dead code, verified by typecheck + a repo-wide reference sweep. `buildValidationBullets` / validation-constant strings that survive get their `rasen change show` suggestions rewritten to `rasen show`.

2. **Port `--long` into `ListCommand`, not by resurrecting the noun path.** Add `--long` to the top-level `rasen list` command in `src/cli/index.ts` and a `long` option to `ListCommand.execute` that renders title + counts for both changes and specs modes. The `--json` payload is unchanged (`--long` affects only the text rendering). This satisfies cli-list "Detailed listing with --long".

3. **Fix D4 tests to be platform-aware, not the production code.** Change the test's `oldDataDir()`/config-dir helpers to compute the platform-correct old-scheme path (win32 → `AppData/Local/rasen` & `AppData/Roaming/rasen`; POSIX → `.local/share/rasen` & `.config/rasen`), mirroring `oldSchemeDataDir`/`oldSchemeConfigDir`. `newRoot()` stays `fixtureHome/.rasen` (same on all platforms). Justification for touching test not product: the production probe is already correct cross-platform (design-b); the defect is purely the test hardcoding win32 fixtures.

4. **Canonicalize the archive.timing assertions.** Wrap the expected `archiveDir` in the existing `canonical()` helper (`FileSystemUtils.canonicalizeExistingPath`), matching the workDir tests. Justification: the CLI's canonicalization of `root.path` is intended contract (design-c); the test simply failed to mirror it.

5. **Move the telemetry notice to stderr (the real cause-fix).** Change `console.log` → `console.error` in `maybeShowTelemetryNotice`. This makes stdout clean for both text and `--json` commands regardless of telemetry state, and is the durable fix behind the `spec.test.ts` local failure. Because item 1 removes the noun `spec` commands, `spec.test.ts` is deleted/migrated too — but the stderr fix is kept because the same bug would recur for any text command spawned without telemetry isolation (e.g. a migrated `rasen show <spec>` test). The `preAction` `!json` guard stays as defense-in-depth.

6. **Test migration.** Delete the four noun interactive tests and `spec.test.ts` (their behavior is covered by verb-first `show`/`validate` tests). Audit `change-initiative-link.test.ts` for noun usage: migrate any surviving-logic assertions to verb-first invocation; delete if it only exercised the removed surface. No net loss of coverage for surviving code.

7. **Spec hygiene.** cli-change fully retired (all requirements REMOVED → capability deleted at archive). cli-spec keeps only the capability-independent "JSON Schema Definition" requirement (the Zod modeling verb-first `show --json` relies on); its command-surface requirements are REMOVED. cli-show/cli-validate MODIFIED to drop dead `rasen change show`/`rasen spec show` suggestions. cli-list gains the `--long` requirement. telemetry gains the stderr scenario.

## Risks / Trade-offs

- **Orphan-method removal risk.** Deleting `ChangeCommand.list`/`.validate` and `SpecCommand.list`/`.validate` could hit a shared private helper still used by `.show`. Mitigation: remove only after a reference sweep + `tsc` typecheck + full suite; if a helper is shared, keep it and remove only the public methods.
- **Muscle-memory breakage.** Users typing `rasen change show` now get an unknown-command error instead of a deprecation redirect. Accepted: the commands have warned for several releases, and the error is self-explanatory; migration lines are in the delta specs. No hidden alias is added (unlike `experimental`→`init`) because the verb-first names are short and the redirect period has already elapsed.
- **`--long` scope creep.** Porting `--long` adds surface to `rasen list`. Justified by the explicit directive to preserve noun-only capabilities; kept minimal (text-rendering only, JSON untouched).
- **D4 test still single-platform per run.** After the fix each leg exercises only its own platform's old-scheme path (a Linux run never tests the win32 branch). That is inherent to env-driven path resolution and acceptable — the matrix as a whole covers both branches, and the production resolver is unit-tested separately.
- **Cross-worktree tmp/registry noise.** The machine's `~/.rasen` and legacy `AppData/Local/rasen` carry unrelated test-leak dirs (see memory); the D4 tests are fully sandboxed under their own fixture home, so this does not affect them.
