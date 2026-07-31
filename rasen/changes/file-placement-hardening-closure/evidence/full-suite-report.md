# Repository-wide test gate report

Date: 2026-08-01

Saved baseline and current committed HEAD: `04cea87ae5bea9af2d90f526455b6ea513cd57e8`

Tree under evaluation: that commit plus the uncommitted closure implementation

Package version: `0.1.6`

## Final local status

The repository-wide **test-result gate passes** on a fresh frozen snapshot and
eight direct, sequential, one-worker Vitest partitions:

- exact frozen manifest: 341 files;
- exact partition union: 341 unique files;
- pairwise intersections, missing paths, extra paths, and post-freeze file
  drift: all empty/zero;
- suites: 1,492 passed of 1,492;
- tests: `5,946 = 5,912 passed + 34 pending + 0 failed + 0 todo`;
- all eight shell exits: 0; all eight standard JSON reports:
  `success=true`; all counts reconcile.

The authoritative protocol, per-partition elapsed times, raw paths, byte
lengths, SHA-256 values, and coverage proof are in
`evidence/direct-partition-results.md`. The frozen inventory is
`evidence/fresh-final-test-snapshot.json`; the accepted raw reports are
`evidence/fresh-final-partition-{1,2,3,4,5,6,7,8}-vitest.json`.

Snapshot audit semantics are exact: every `partitions[].count` is the total
denominator `N=8`, while per-partition file counts are `partitionCounts` or
each `files.length`. `manifestSha256` hashes the raw UTF-8/LF bytes of
`evidence/test-manifest.txt`, including its trailing newline.
`snapshotSha256` hashes UTF-8 compact `JSON.stringify` output for the snapshot
object with only `snapshotSha256` omitted and no trailing newline. The raw
pretty-printed snapshot-file SHA-256 is separately
`6ab0d484e04e9f9f91cc6a43b01e8ef12d07e3d116cda0666f59875de035ef21`.

No custom runner, cleanup helper, or bespoke/manual process termination was
used in the accepted sequence. Process cleanliness is `NOT EVALUATED`; it is
not promoted to a pass or fail from shell exit and test summaries. Native
Ubuntu, macOS, and Windows recovery CI URLs/results remain pending delivery.

## Superseded direct sequence

The pre-freeze direct sequence is historical only. Its membership changed as
reviewed fixes changed test-file sizes: the combined reports contained 341
assignments but only 279 unique paths, with 62 duplicates and 62 missing
paths. The old numeric aggregate `6,050 = 6,012 passed + 38 pending` is
**INVALID / SUPERSEDED** and excluded from acceptance.

`evidence/test-partitions.md` is also labeled throughout as invalid/superseded
pre-freeze history. It is not the accepted manifest; accepted membership comes
only from the frozen snapshot's `partitions[].files` and matching raw reports.

The initial P4, P6, and P8 failures and their fixed reports remain immutable,
hash-addressed history in `evidence/direct-partition-results.md`. Three P2
transport attempts that exited 0 without a retained final summary remain
`INCONCLUSIVE` and excluded.

## Retired-runner incident history

The earlier custom kill-capable bounded runner was retired after independent
safety review found unsafe PID-reuse, unbound-root, stale-owner, cleanup, and
POSIX assumptions. `evidence/runner-safety-review.md` is the authoritative
review. Its reports under `evidence/partition-*.json` remain incident artifacts
only and contribute nothing to the final gate.

The runner history included:

- partition summaries that looked successful but rested on an invalid process
  ownership premise;
- an initial partition 5 failure in the Zed audit test caused by host
  `LOCALAPPDATA` leakage, followed by a narrow test-only environment isolation
  correction;
- adoption and termination of two pre-existing Vite processes from another
  workspace after an ancestor-PID reuse edge case;
- a later PID-reuse cleanup error and a runner crash before report creation;
- a monolithic `pnpm test` attempt that reached its outer limit without a
  Vitest summary and supplied no acceptance evidence.

All classifications from that runner are **SUPERSEDED**, including apparent
passes. The runner and its ownership helper are absent from the final tree.

## Acceptance boundary

Local acceptance is limited to the reconciled test-result evidence above plus
the focused, static, validation, build, typecheck, lint, compatibility, diff,
and inventory checks in `evidence/release-evidence.md`. It does not claim local
process cleanliness or native remote recovery success, and it authorizes no
commit, push, PR update, or archive action.
