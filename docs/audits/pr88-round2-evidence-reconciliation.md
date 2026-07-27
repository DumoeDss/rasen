# PR #88 Round-2 Evidence Reconciliation

Shared evidence artifact for the `pr88-af-*` round-2 fix children. This is the
single portfolio-level evidence artifact the acceptance review (M5) requires:
each round-2 child is listed with its finding IDs, commit SHA, review verdict,
test count, and review-report path so a reviewer can independently verify every
claim without trusting self-reported PASS/CLEAN.

**Old `pr88-rf-*` ledgers are NOT re-audited.** The round-1 `pr88-rf-*` archived
task ledgers had unchecked items and were declared PASS/CLEAN; the acceptance
review explicitly forbids retroactively faking historical checkmarks
("不要事后伪造历史勾选"). Those ledgers stand as historical artifacts of an
insufficient round. This artifact establishes the round-2 baseline instead.

---

## Round-2 Portfolio Evidence Table

| # | Child | Findings | Commit(s) | Review verdict | Tests (isolated) | Review-report |
|---|---|---|---|---|---|---|
| 1 | `pr88-af-lock-atomicity` | B1, B2 | `2f0d834b`, `1e62007c` | r1: 0B/1M/3m/1t → r2: CLEAN (0B/0M) | 35 pass / 2 POSIX-skip | [review-report](../../rasen/changes/pr88-af-lock-atomicity/work/review-report.md) |
| 2 | `pr88-af-catalog-backup` | B3 | `c618e6ae` | r1: 0B/0M/2m/1t → r2: CLEAN | 57 pass (18 mutate + 39 knowledge) | [review-report](../../rasen/changes/pr88-af-catalog-backup/work/review-report.md) |
| 3 | `pr88-af-remote-credentials` | B4 | `34987ed0` | CLEAN (0B/0M/0m/0t) | 21 pass / 0 fail | [review-report](../../rasen/changes/pr88-af-remote-credentials/work/review-report.md) |
| 4 | `pr88-af-store-identity-concurrency` | B5, B6, M3, M4 | `ce303361`, `0baaa5b3` | 0B/0M/1m (M3-1 sameOwner → fixed in `0baaa5b3`) | 102 pass / 1 POSIX-skip | [review-report](../../rasen/changes/pr88-af-store-identity-concurrency/work/review-report.md) |
| 5 | `pr88-af-bootstrap-obtain` | B7, M1 | `af9ae2b3` | r1: 0B/0M/2m → r2: CLEAN (m1 SHA-256 content-digest resolved) | 57 pass (44 obtain + 13 bundle-import) | [review-report](../../rasen/changes/pr88-af-bootstrap-obtain/work/review-report.md) |
| 6 | `pr88-af-bundle-transactions` | B8, M2 | `010c0947` | r1: 0B/1M/5m/1t → r2: CLEAN | 66 pass / 1 skip | [review-report](../../rasen/changes/pr88-af-bundle-transactions/work/review-report.md) |
| 7 | `pr88-af-evidence-chain` | M5, Minor 1–5 | (this child) | — | — | — |
| 8 | `pr88-af-ci-required-gate` | M7, M6 | `9caabf5f` | CLEAN (0B/0M/0m/0t) | 42 pass (25 basic + 17 validate) | [review-report](../../rasen/changes/pr88-af-ci-required-gate/work/review-report.md) |

### How each claim is verified

- **Commit SHA:** `git log --oneline <sha> -1` on `feat/pr88-review-fixes` — each
  commit is a narrow-pathspec commit containing exactly that child's files.
- **Review verdict:** open the review-report path; each was produced by a
  dispatched reviewer (author ≠ verifier) — reviewer-1, reviewer-3, or reviewer-6.
- **Test count:** each ship-log records the isolated test run (full suite skipped
  per M6). Tests were empirically confirmed red-on-pre-fix (`728688ba`) and green
  after the fix, independently re-verified by the reviewer.
- **Review-report path:** review-report files live under
  `C:\Users\Sayo\.rasen\projects\autonomy-ladder-1e42477e\changes\pr88-af-<child>\work\`.
  The relative links above resolve from the repo root.

### Child #5 (bootstrap-obtain) status

Shipped as `af9ae2b3`. Round 1 returned 0 Blocker / 0 Major / 2 Minor; the
meaningful Minor (m1 — stat-only M1 binding defeatable by a same-size +
mtime-matching swap on NTFS) was resolved in round 2 by adding a SHA-256
content digest as the authoritative binding alongside the stat. Re-review:
CLEAN. 57 pass. Review-report from reviewer-1 at
`...pr88-af-bootstrap-obtain/work/review-report.md`.

### Round-2 reviewed head

The round-2 acceptance review examined head `728688ba` on `feat/pr88-review-fixes`.
The round-2 fix portfolio (`pr88-af-*`) builds on top of that head. The original
PR head was `c4e54285` (round-1 fixes); the roadmap previously mis-recorded this
as the current head — corrected.

---

## M6 — Test Stability Investigation (pr88-af-ci-required-gate)

**Scope:** partial investigation of the root test suite instability reported in the PR #88 acceptance review (M6). Our review named three symptoms: CLI subprocess non-exit, Windows EPERM teardown cascade, and 10s test timeouts, observed at scale (4-worker ~95 failures).

### What was fixed (determinable, locally verifiable)

Three known-flaky CLI-spawning test files used bare `fs.rm(dir, { recursive: true, force: true })` in their `afterEach`/`afterAll` teardown — no EPERM retry. On Windows, a just-exited CLI subprocess can leave file handles locked for a few hundred milliseconds; the bare `fs.rm` hits EPERM immediately and fails, causing the teardown to error out. In a multi-worker vitest run this cascades: the failed teardown leaves temp directories that interfere with subsequent test isolation.

**Fix:** switched all three files to the existing `cleanupTempPathAsync` helper (`test/helpers/temp-cleanup.ts`), which retries on EPERM/EBUSY/ENOTEMPTY with `maxRetries: 15, retryDelay: 200ms` (bounded — a genuinely stuck handle surfaces as a thrown error, not an infinite hang).

| File | Changed site | Was | Now |
|---|---|---|---|
| `test/cli-e2e/basic.test.ts` | `afterAll` (temp dir cleanup) | `fs.rm(dir, { recursive: true, force: true })` | `cleanupTempPathAsync(dir)` |
| `test/commands/validate.test.ts` | `afterEach` ×2 + inline `finally` | `fs.rm(testDir/isoRoot, { recursive: true, force: true })` | `cleanupTempPathAsync(testDir/isoRoot)` |
| `test/commands/validate.enriched-output.test.ts` | `afterEach` | `fs.rm(testDir, { recursive: true, force: true })` | `cleanupTempPathAsync(testDir)` |

**No subprocess leak was found.** The shared CLI helper (`test/helpers/run-cli.ts`) already has robust child tracking (`activeCliChildren` set), `terminateProcessTree()` with platform-specific kill (`taskkill /t /f` on Windows), `child.unref()`, stream destruction on both `close` and `error`, and a timeout-kill fallback. All direct-spawn test files (`daemon-lifecycle.test.ts`, `ui-launch-stale-replace.test.ts`, `kill-tree.test.ts`, `threshold-schemes-api.test.ts`, `file-state.test.ts`) already have proper `afterEach` child cleanup and use `cleanupTempPathAsync` for temp dirs.

### What remains known-open

1. **Suite-wide stability at 4-worker scale** — the three file-level fixes address the most common EPERM teardown cascade sites, but the full suite has ~48 files using `fs.rmSync` in teardown. 34 of those already use the `cleanupTempPath`/`cleanupTempPathAsync` helper. The remaining bare-`fs.rmSync` sites are in non-CLI-spawning tests (lower EPERM risk) and were not changed to keep the diff minimal and focused on the known-flaky pattern.

2. **CLI subprocess non-exit (native fetch keep-alive)** — this root cause was already identified and fixed in a prior change (`node-fetch-hangs-cli-exit`): the telemetry fire-and-forget path was changed from native `fetch` (undici keep-alive socket) to `node:https` with `agent: false` + guard timer. The fix is in the codebase. No further action on this front.

3. **`daemon-lifecycle.test.ts` local `runCli` has no timeout** — the file's local `runCli()` helper (not the shared `runCLI`) spawns a CLI child and waits for `close` without a timeout or kill fallback. If a daemon command hangs, the test hangs. This is a narrow integration-test concern (the commands it invokes — `daemon start/stop/status` — are designed to exit quickly) and was not changed to avoid altering test semantics. Flagged for future hardening.

### Per-file duration guidance

Known-slow tests that consistently approach or exceed the default 10s vitest timeout:

| File | Test | Timeout | Guidance |
|---|---|---|---|
| `test/cli-e2e/basic.test.ts` | "shows Simplified Chinese pipeline help..." | 20s (explicit) | Spawns 12+ CLI subprocesses sequentially for per-subcommand help. Keep the explicit `20_000` override. |
| `test/cli-e2e/basic.test.ts` | "initializes with --tools all option" | 25s (explicit) | Runs `rasen init --tools all` which writes many skill files. Keep the explicit `25_000` override. |
| `test/cli-e2e/basic.test.ts` | "uses the language persisted..." | default 10s | Runs 5 CLI invocations sequentially. Approaches but does not consistently exceed 10s. Monitor. |
| `test/commands/daemon-lifecycle.test.ts` | all tests | default 10s | Spawns real daemon + HTTP probe loops. Could approach 10s on slow CI. Consider explicit timeout if flaky. |

### Frontier — NOT claimed by this change

- **"3 consecutive green on real Windows CI"** — this sign-off requires actual GitHub Actions CI runs on `windows-latest`, which this session cannot perform. The trigger fix (M7) and the EPERM-retry fixes (M6) are necessary conditions, but proving the suite is stable at scale requires CI evidence. Flagged as frontier for the maintainer to verify after merging.
