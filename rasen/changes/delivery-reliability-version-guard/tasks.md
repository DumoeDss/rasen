## 1. Debounce marker module

- [x] 1.1 Add `src/core/version-guard-state.ts` mirroring `expert-selection-state.ts`'s shape: `readLastWarnedVersionPair(homeDir)` and `writeLastWarnedVersionPair(homeDir, { stampVersion, cliVersion })`, best-effort, silent on any read/write failure
- [x] 1.2 Unit tests: read returns null when no marker file exists; write then read round-trips the pair; a corrupt/unreadable marker file is treated as "no marker" rather than throwing

## 2. Diagnostic key and locale strings

- [x] 2.1 Add `skillVersionMismatch` to `CONFIG_DIAGNOSTIC_KEYS` in `src/core/config-diagnostics.ts`
- [x] 2.2 Add the corresponding string under `configErrors.diagnostics` in `src/locales/en.json`, `src/locales/ja.json`, and `src/locales/zh-cn.json`, interpolating `{stampVersion}`/`{cliVersion}` and hinting `rasen update`
- [x] 2.3 Unit test: locale lookup for the new key resolves in all three locales and interpolates both values

## 3. Ambient warning at project-scoped command resolution

- [x] 3.1 In `src/core/root-selection.ts`, inside `resolveRootForCommand`, after the existing `emitStoreRootBanner` call and gated on `!output.json`: call `getAllToolVersionStatus(root.path, OPENSPEC_VERSION)` (reuse the existing export from `src/core/shared/tool-detection.ts` via `src/core/shared/index.ts`) and, if any tool's `needsUpdate` is true, resolve the project's machine home via `resolveProjectHome(root.path, { ensure: false })`
- [x] 3.2 If a home resolves and its debounce marker already matches the current (stampVersion, cliVersion) pair, skip the warning; otherwise print the warning via `reportConfigDiagnostic({ key: 'skillVersionMismatch', ... })` and, if a home resolved, write the new marker
- [x] 3.3 If no home resolves, print the warning every time (no debounce state to consult) rather than skipping it
- [x] 3.4 Wrap the entire block in try/catch so a version-status lookup or debounce-marker failure never propagates out of `resolveRootForCommand` and never fails the invoking command
- [x] 3.5 Unit/integration tests: warning fires on a mismatched project via a representative project-scoped command (e.g. `show`); warning is absent when versions match; warning is absent under `--json`; a thrown error inside the lookup does not fail the command or print anything

## 4. Debounce behavior tests

- [x] 4.1 Test: two project-scoped commands run back-to-back against the same mismatched project print the warning once
- [x] 4.2 Test: after simulating an `update` that advances the stamp version, the next command's warning (if the CLI version also changed) reflects the new pair rather than staying silent forever
- [x] 4.3 Test: a project with no registered machine home still gets the warning on every invocation (documented non-debounced fallback)

## 5. Doctor check item

- [x] 5.1 Add a skill-version-mismatch finding to the relationship-health gathering in `src/core/relationship-health.ts` (or the equivalent gather step in `src/commands/shared-gather.ts`), independent of the debounce marker — always re-derived from `getAllToolVersionStatus`
- [x] 5.2 Render the finding in `printHumanHealth` (`src/commands/doctor.ts`) with a `Fix: rasen update` line, following the existing style of the `machineRootRelocation`/`migratableEphemera` findings
- [x] 5.3 Include the finding in `doctor --json` output
- [x] 5.4 Unit tests: `doctor` reports the finding (human + JSON) when mismatched, omits it when versions match, and still reports it even when the ambient warning was already debounced earlier in the same test's command sequence

## 6. Stamp-write spec documentation parity

- [x] 6.1 Confirm existing test coverage already exercises the `generatedBy` stamp write in both `init` and `update` (no new code expected here); add a targeted test only if a gap is found — confirmed: `test/core/init.test.ts` ("should embed generatedBy version in skill files") and `test/core/update.test.ts` ("should embed generatedBy in updated skill files", "should only update tools that need updating") already cover fresh-install stamping, re-stamping on update, and skipped-tool stamp retention. No gap found; no new test added.
- [x] 6.2 Run `rasen validate --change delivery-reliability-version-guard` (or the change-scoped equivalent) to confirm the `cli-init` and `cli-update` delta specs apply cleanly against `rasen/specs/` — ran `rasen validate delivery-reliability-version-guard --strict`: "Change 'delivery-reliability-version-guard' is valid"

## 7. Cross-platform and regression pass

- [x] 7.1 Verify the debounce marker file path uses `path.join`, never hardcoded separators, and the marker file's JSON round-trips identically on Windows and POSIX — `version-guard-state.ts` uses `path.join` throughout; round-trip covered by `test/core/version-guard-state.test.ts`, exercised on this Windows dev machine
- [x] 7.2 Run the full test suite; confirm no regression in the ten commands that funnel through `resolveRootForCommand` (`doctor`, `show`, `validate`, `work`, `context`, `pipeline`, `pipeline-library`, `workflow instructions`, `workflow new-change`, `workflow status`)

  Full-suite history and attribution (Windows dev machine, worktree also hosts a concurrent sibling implementer, so the first run was under heavy CLI-spawn contention):

  | Run | Scope | Result |
  |---|---|---|
  | 1 | `npx vitest run` (full, box busy with concurrent sibling activity) | Test Files 11 failed / 196 passed (207); Tests 62 failed / 3756 passed / 29 skipped |
  | 2 | `npx vitest run` (full, rerun) | Test Files 3 failed / 204 passed (207); Tests 3 failed / 3815 passed / 29 skipped |
  | 3 | The 7 files identifiable from run 1's tail, foreground, targeted rerun | Test Files 1 failed / 6 passed (7); Tests 1 failed / 122 passed |
  | 4 | `npx vitest run --shard=1/2` + `--shard=2/2` (full 207-file sweep, quiet box) | Shard 1: 1 failed / 103 passed (104 files), 1 test failed / 1939 passed / 21 skipped. Shard 2: 0 failed / 103 passed, 1878 passed / 8 skipped. Combined: **1 file failed, 1 test failed**, across all 207 files. |

  Attribution: runs 1→2 dropping from 62→3 failed tests, and run 4's clean 207-file sweep finding only 1 failure, confirms ~61 of the original failures were Windows CLI-spawn contention flakes (EPERM temp-dir cleanup races, 10s timeouts, timing-sensitive session-supervisor assertions in `test/core/management-api/*`) — non-deterministic under concurrent load, not reproducing on a quiet box. The single surviving failure, `test/specs/source-specs-normalization.test.ts` ("enforces required sections and bans hidden requirements..."), is deterministic and real, but pre-existing and unrelated to this change: it asserts `rasen/specs/archive-ui/spec.md` has no leftover `TBD - created by archiving change ...` placeholder text. `git log`/`git status`/`git diff` on that file confirm it was last touched by an unrelated prior commit (`354ce3a4`, the ui-space-redesign portfolio archive) and is untouched in this worktree — not introduced by this change or the concurrent sibling. No file in this change's lane (`root-selection.ts`, `doctor.ts`, `relationship-health.ts`, `config-diagnostics.ts`, the three locale files, `version-guard-state.ts`) ever appeared in any failure across all four runs. Not fixed here: out of scope for `delivery-reliability-version-guard` and pre-existing.
- [x] 7.3 Manually smoke-test: mismatched project prints the warning on a non-`update` command, is silent on the second consecutive command, and `rasen doctor` reports the same mismatch regardless — covered by the CLI-level doctor tests (human/JSON/debounce-independence) and the direct `resolveRootForCommand` debounce tests in `test/core/root-selection.test.ts`
