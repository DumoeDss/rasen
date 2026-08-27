# Proposal: harden-temp-teardown-and-surface-archive-blockers

## Why

`Test (windows-pwsh-shard-2)` fails intermittently on content that passes
elsewhere. Investigation on 2026-08-27 found two distinct causes, one proven and
one only half-visible because the test throws its own evidence away.

**Proven.** `test/core/session-host/host.test.ts` tears down with a bare
`fs.rmSync(root, { recursive: true, force: true })` and no retries, and failed CI
with `ENOTEMPTY: directory not empty, rmdir '...\rasen-session-host-vBvBZa\state\session-host'`.
This repository already knows bare `rmSync` is not enough on Windows: it ships
`test/helpers/temp-cleanup.ts`, whose `cleanupTempPathAsync` retries exactly
`EPERM`/`EBUSY`/`ENOTEMPTY`/`EMFILE`/`ENFILE`, and whose comment records that
`fs.rmSync`'s own `maxRetries` "does not reliably retry ... on Windows
(empirically confirmed: it surfaces immediately rather than backing off)". The
helper exists; this suite does not use it.

**Half-visible.** `test/core/archive-consumer-integration.test.ts` failed on
`expect(preview.archive.plan.complete).toBe(true)`, which renders as
`expected false to be true` and names nothing. `plan.complete` is a conjunction
of four conditions, and the plan carries a `blockers` array in the SAME parsed
payload, each entry holding an operation, a path, and the errno code. The
assertion reads the boolean and discards the diagnosis, so a CI-only failure
cannot be root-caused without re-running it.

Measured context, so the fix is not mistaken for a shard fix: the three shards
are balanced (231 files each; 25/24/23 min), so shard-2 is not overloaded. What
differs is exposure — 241 of the 250 test files that call recursive `rmSync` do
not use the hardened helper, and shard-2 carries the most of them (89, against
71 and 78) — amplified by Windows taking 24 min where macOS takes 10 on the very
same file set. shard-2 is the likeliest to lose the race, not a different kind of
thing.

## What Changes

- `session-host/host.test.ts` tears down through `cleanupTempPathAsync`, the
  helper already used by the session-cache suites.
- The archive-consumer assertion reports `plan.blockers` (operation, path, errno)
  and the three sibling conditions when `complete` is false, so the next
  occurrence identifies itself from the CI log alone.
- `KNOWN_SLOW_TEST_WEIGHTS_MS` gains measured entries for both files, which are
  absent today and therefore weighted from source size: 1.9s implied against
  67.3s measured for archive-consumer (~35x under) and 7.4s against 37.1s for
  session-host (~5x). This is recorded as latent skew, NOT as the cause of these
  failures — the shards measure balanced.

Non-goals: the repo-wide sweep of the other 240 unhardened teardowns, and any
change to archive-engine behaviour. Only the two files that actually failed are
touched, plus the weights table.

## Capabilities

### New Capabilities

(none — test hardening and diagnostics only; no shipped behaviour changes)

### Modified Capabilities

(none)

## Impact

- `test/core/session-host/host.test.ts` — teardown only.
- `test/core/archive-consumer-integration.test.ts` — assertion diagnostics only;
  the same conditions still gate the test.
- `vitest.config.ts` — two weight entries.
- No `src/` changes.
