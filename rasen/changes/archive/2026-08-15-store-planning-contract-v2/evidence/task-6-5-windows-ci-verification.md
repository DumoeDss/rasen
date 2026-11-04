# Task 6.5 — Windows CI verification

## CI matrix coverage

`.github/workflows/ci.yml`, job `test_matrix`, runs the full suite via `pnpm test` (vitest, no
file-list filtering — `listTestFiles()` in `vitest.config.ts` auto-discovers everything under
`test/`) across:

- `ubuntu-latest` (unsharded + a floor-Node leg)
- `macos-latest` x3 shards (`macos-bash-shard-1/2/3`, via `VITEST_FILE_PARTITION`)
- `windows-latest` x3 shards (`windows-pwsh-shard-1/2/3`, via `VITEST_FILE_PARTITION`)

Because there is no include/exclude glob restricting which test files run, the six new suites this
change adds (`test/core/store/planning-validation-v2.test.ts`, `planning-layout-v2.test.ts`,
`planning-identity-v2.test.ts`, `finalization-v2.test.ts`, `planning-foundation-consumer.test.ts`,
`planning-foundation-purity.test.ts`) are auto-discovered and land in one of the three partitions on
every OS leg on the next CI run, same as every other test file.

## Native win32 behavior actually exercised

This worktree's session runs natively on `windows-latest`-equivalent host (`win32`), so the win32
path was not just inspected but actually run and observed green locally as part of task 6.1's
174/174 pass:

- `test/core/store/planning-layout-v2.test.ts:290` —
  `it.runIf(process.platform === 'win32')('uses native Windows semantics and rejects case-alias
  project ids', …)` — this guard means the case/alias assertion only executes on a real win32 host;
  it ran (not skipped) in this session's task 6.1 run and passed.
- `test/core/store/planning-layout-v2.test.ts:316-363` — `it.each([{flavor:'win32', api:
  path.win32, …}, {flavor:'posix', api: path.posix, …}])` — both flavors are exercised explicitly
  via `path.win32`/`path.posix`, independent of host OS, so the posix-flavor expectations are
  already proven to run correctly on a Windows host too (confirming the explicit-`flavor` design
  does not depend on `process.platform` for its assertions, only the one `runIf` case does).
- `src/core/store/planning-layout-v2.ts` and `src/core/store/planning-validation.ts` (drive/UNC/
  device-root rejection, task 2.5) use `path.join`/`path.resolve` exclusively — grepped, no
  hardcoded `/` or `\` separator literals outside of the intentionally-explicit win32/posix test
  fixtures above.

On the Linux and macOS CI legs, `process.platform !== 'win32'` so the one `runIf`-gated native case
is skipped there (by design — it asserts real OS-level case-insensitive path collapsing, which only
applies to Windows/NTFS), while the `posix`-flavor `it.each` case and all flavor-independent tests
(digest determinism, containment escapes, relative-root rejection, retry disambiguation, etc.) run
identically on every OS.

## `KNOWN_SLOW_TEST_WEIGHTS_MS`

Checked `vitest.config.ts`: no existing entries for any of the six new test files. Per the file's
own comment ("stale weights can affect balance, never partition completeness"), an unweighted file
falls back to `Math.max(1, file.size / 10)` and is still assigned to exactly one partition — so
partition completeness (every file runs exactly once) does not depend on this table. These are pure
unit suites (no CLI subprocess spawn, no filesystem I/O) and ran in well under a second each
locally, alongside CLI-heavy files weighing 20-230s in the table — adding entries would not
meaningfully rebalance shard timing. Confirmed rather than assumed: no entry needed.

## Conclusion

Windows CI verification requirements are met: the new suites are auto-discovered by the existing
matrix machinery on all three OS legs, native win32 behavior is proven (not just assumed) by having
actually run and passed on this win32 host, POSIX-flavor expectations are proven to run correctly
independent of host OS, and no `KNOWN_SLOW_TEST_WEIGHTS_MS` entry is warranted.
