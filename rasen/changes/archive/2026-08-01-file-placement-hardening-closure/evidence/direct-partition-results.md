# Final direct partition results

Date: 2026-08-01

Saved baseline and current committed HEAD: `04cea87ae5bea9af2d90f526455b6ea513cd57e8`

Tree under evaluation: that commit plus the uncommitted closure implementation

## Authoritative frozen protocol

`evidence/fresh-final-test-snapshot.json` freezes all 341 discovered
`test/**/*.test.ts` files before partition 1. For every path it records the
byte length, SHA-256, and assigned partition. The deterministic partition
counts are `43, 43, 43, 43, 43, 42, 42, 42`.

- raw snapshot file: 85,609 bytes; SHA-256
  `6ab0d484e04e9f9f91cc6a43b01e8ef12d07e3d116cda0666f59875de035ef21`;
- snapshot-declared manifest SHA-256:
  `144d2e51bf03e05443fc70f9e1ecdb44a1ebc53e28f3dfc35ec460e651fc2b6a`;
- snapshot-declared canonical-content SHA-256:
  `1b6a03a720da5688b3e370076049de0d7bdb9fb67924736ba658563a3b0d4f09`.

The raw-file hash and the canonical-content hash intentionally describe
different representations and are not interchangeable.

The snapshot fields are reproducible as follows:

- `partitions[].count` is the total partition denominator `N=8` paired with
  that entry's `index`; it is not a file count. Per-partition file counts are
  the top-level `partitionCounts` values or each `partitions[].files.length`.
- `manifestSha256` is SHA-256 over the raw bytes of `evidence/test-manifest.txt`
  encoded as UTF-8 with LF line endings and one trailing newline.
- `snapshotSha256` is SHA-256 over UTF-8 bytes of compact
  `JSON.stringify(snapshot)` after omitting only the `snapshotSha256` property,
  with no trailing newline.
- the raw snapshot SHA-256 above hashes the complete pretty-printed JSON file,
  including its `snapshotSha256` property, and therefore remains distinct.

Partitions ran directly and sequentially with one Vitest worker. The command
form for partition `N` was:

```powershell
$env:VITEST_MAX_WORKERS='1'
$env:VITEST_FILE_PARTITION='N/8'
pnpm exec vitest run --reporter=json --outputFile=rasen/changes/file-placement-hardening-closure/evidence/fresh-final-partition-N-vitest.json --silent
```

Each shell had a 480,000 ms outer bound. Acceptance required shell exit 0, a
parseable report with `success=true`, every file passing, zero failed tests,
and reconciled totals. No custom runner, cleanup helper, or bespoke/manual
process termination was used. Process cleanliness is `NOT EVALUATED`.

## Authoritative results

| Part | Elapsed | Files | Suites | Tests (pass / pending / fail / todo) | Bytes | Raw report SHA-256 | Result |
| ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 1/8 | 208.8 s | 43 | 103 | 243 (243 / 0 / 0 / 0) | 88,048 | `b0e495e8ab6eeec884cc489afaf4395401d59fb705872ca0537947ff8db7bef1` | PASS |
| 2/8 | 234.3 s | 43 | 139 | 532 (528 / 4 / 0 / 0) | 180,225 | `cdf449f864c7cf9f6e529b19e81f91a39617964648d1b936a9060c58f0eea1c3` | PASS |
| 3/8 | 222.5 s | 43 | 216 | 908 (901 / 7 / 0 / 0) | 315,455 | `0bb6e2e5d6a34097864d76bbde5ad1571e37ca3aee2fe2b89842b2af30e7bd48` | PASS |
| 4/8 | 215.4 s | 43 | 209 | 815 (814 / 1 / 0 / 0) | 284,922 | `b284a2e8710cb69f1df2cac64e4501345300608ef69ff216a0b961df9aaf67a5` | PASS |
| 5/8 | 234.5 s | 43 | 242 | 935 (929 / 6 / 0 / 0) | 315,702 | `2e58e6676cea55f68d43a602578b0f247301b3b182378769632be134414a337d` | PASS |
| 6/8 | 235.6 s | 42 | 284 | 1,407 (1,395 / 12 / 0 / 0) | 502,934 | `32a3633930db1b41c051ad2bbe88345293b8150156fd744af894263344b24109` | PASS |
| 7/8 | 253.0 s | 42 | 148 | 477 (476 / 1 / 0 / 0) | 171,086 | `08b35688b8c8f2219924dbfea7f578dbb037f75a4427620798b2428a0be5d5bf` | PASS |
| 8/8 | 242.7 s | 42 | 151 | 629 (626 / 3 / 0 / 0) | 221,780 | `76478de29b84c24e2619b57d537ab22f4af183495e100cda2ab3388cf0ffc8d2` | PASS |

The corresponding paths are exactly
`evidence/fresh-final-partition-{1,2,3,4,5,6,7,8}-vitest.json`.

## Coverage and count reconciliation

The frozen snapshot and all eight reports were parsed together after P8:

- snapshot assignments: 341; unique assigned paths: 341;
- report paths: 341; unique report paths: 341;
- snapshot/report missing paths: none; extra paths: none;
- duplicate paths: none; every pairwise partition intersection: empty;
- frozen path length/SHA drift after P8: 0 of 341;
- union: exactly the frozen 341-file manifest;
- suites: `1,492 / 1,492` passed;
- tests: `5,946 = 5,912 passed + 34 pending + 0 failed + 0 todo`.

The complete local test-result gate is therefore **PASS**. This is a
test-result conclusion only; process cleanliness remains `NOT EVALUATED`.

## Superseded pre-freeze results

The earlier direct sequence assigned partitions from mutable on-disk file
sizes while reviewed fixes were still changing test files. Combining its
reports produced 341 assignments but only 279 unique paths: 62 paths were
duplicated and 62 were missing. Its previously computed aggregate
`6,050 = 6,012 passed + 38 pending` is therefore **INVALID / SUPERSEDED** and
must not be cited as repository-wide coverage. All pre-freeze successes and
failures are excluded from the authoritative aggregate above.

Three earlier P2 transports also remain `INCONCLUSIVE` and excluded: direct
`pnpm test` attempts ended exit 0 at 271.0 s and 262.7 s without a retained
final summary, and a dot-reporter attempt ended exit 0 at 293.2 s with its
summary displaced from retained output.

## Retained P4/P6/P8 failure and fix history

Historical reports were not overwritten:

| Part | Stage and diagnosis | Raw report | SHA-256 | Historical outcome |
| ---: | --- | --- | --- | --- |
| 4/8 | initial Windows legacy-lock sharing-window failure | `evidence/direct-partition-4-vitest.json` | `e517528f88f6835bbd9631bc52968fb7d2472e7985e35571e14589334eef396f` | exit 1; 619 pass, 1 fail, 7 pending |
| 4/8 | reviewed bounded Windows-only lock retry | `../file-placement-hardening-windows-lock-contention/evidence/partition-4-after-fix-vitest.json` | `6bc2a4917df61aacdfbfa147e444d62fddb59ea5bb82050d03f1607640adf6a5` | exit 0; 637 pass, 4 pending |
| 6/8 | initial archive compatibility regression | `evidence/direct-partition-6-vitest.json` | `f43203c80ec4e89f677b439a34d0146f054ac1b8295ef757c51e861f0f4dbe82` | exit 1; 1,103 pass, 5 fail, 4 pending |
| 6/8 | reviewed compatibility remediation | `evidence/direct-partition-6-after-fix-vitest.json` | `bd2955ac745b156b600aaf773bcb90fc2be568cb5a86634fd03bf996568f0888` | exit 0; 1,395 pass, 12 pending |
| 8/8 | initial static guard false-positive on an interface method | `evidence/direct-partition-8-vitest.json` | `277bddfa67bd6cdb3f052f9465c9a25034ceeb1a151adb864447200b73062412` | exit 1; 625 pass, 1 fail, 3 pending |
| 8/8 | semantically equivalent interface-property correction | `evidence/direct-partition-8-after-fix-vitest.json` | `4eaf9a79c72a8602870b7ade48a674ec8f44011e82816598d16d852d9f4d92b3` | exit 0; 626 pass, 3 pending |

These artifacts preserve the defect/remediation trail. The fresh frozen P4,
P6, and P8 reports—not these historical reruns—supply the final aggregate.
