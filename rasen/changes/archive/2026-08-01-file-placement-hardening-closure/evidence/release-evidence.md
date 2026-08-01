# Closure release evidence

Date: 2026-08-01

Saved PR-head baseline: `04cea87ae5bea9af2d90f526455b6ea513cd57e8`

Code/test delivery head: `4a07e3f508fcd6e24f62a5acb83eb5ef387c4863`

Branch: `fix/pr121-file-placement-hardening`

Package: `0.1.6`

This is delivery evidence. It does not authorize merge or archive.

## Complete local repository gate

The authoritative fresh frozen run passes:

- snapshot: `evidence/fresh-final-test-snapshot.json`, 85,609 bytes, raw
  SHA-256 `6ab0d484e04e9f9f91cc6a43b01e8ef12d07e3d116cda0666f59875de035ef21`;
- exact manifest/union: 341 assignments, 341 unique report paths, no missing,
  extra, duplicate, or intersecting paths;
- frozen size/SHA drift: zero files;
- partitions: eight of eight shell exits 0 and parseable standard JSON reports
  with `success=true`;
- aggregate: 1,492/1,492 suites and
  `5,946 = 5,912 passed + 34 pending + 0 failed + 0 todo`.

For snapshot auditability, `partitions[].count` means the total denominator
`N=8`, not the number of files; per-partition counts are the top-level
`partitionCounts` values or each `files.length`. `manifestSha256` is SHA-256 of
the raw UTF-8/LF bytes of `evidence/test-manifest.txt`, including its trailing
newline. `snapshotSha256` is SHA-256 of UTF-8 compact `JSON.stringify` output
for the snapshot object with only `snapshotSha256` omitted and no trailing
newline. The raw pretty-printed snapshot-file hash is the distinct `6ab0...`
value recorded above.

The eight raw report paths, byte lengths, hashes, commands, elapsed times, and
per-partition counts are recorded in `evidence/direct-partition-results.md`.
That report also preserves the P4/P6/P8 failure/fix history and excludes the
three inconclusive P2 transports. The pre-freeze
`6,050 = 6,012 passed + 38 pending` aggregate is invalid/superseded because
that mutable sequence had 62 duplicated and 62 missing paths.
`evidence/test-partitions.md` is explicitly invalid/superseded pre-freeze
history; accepted membership comes only from the frozen snapshot's
`partitions[].files` and the matching fresh raw reports.

No custom runner, cleanup helper, or bespoke/manual process termination was
used. Process cleanliness is `NOT EVALUATED`.

## Focused behavioral gates

Archive group:

```text
pnpm exec vitest run test/core/archive.test.ts test/core/archive-engine.test.ts test/core/archive-consumer-integration.test.ts test/core/archive-fault-matrix.test.ts test/core/archive-path-semantics.test.ts test/core/archive-accounting.test.ts test/core/archive-ephemera.test.ts test/core/templates/archive-engine-consumers.test.ts test/core/templates/skill-templates-parity.test.ts --maxWorkers=1 --minWorkers=1
```

Exit 0 in 104.4 s; 9/9 files; 143 passed and 1 expected POSIX-only skip on
Windows; 0 failed.

Migration/root/session group:

```text
pnpm exec vitest run test/core/ephemera-cleaner.test.ts test/core/work-migration.test.ts test/commands/work.test.ts test/core/management-api/sessions-api.test.ts test/core/management-api/sessions-space.test.ts test/core/completions/command-registry.test.ts --maxWorkers=1 --minWorkers=1
```

Exit 0 in 56.4 s; 6/6 files; 153/153 tests passed; 0 failed.

CI workflow contract:

```text
pnpm exec vitest run test/ci-workflow-contract.test.ts --maxWorkers=1 --minWorkers=1
```

Exit 0 in 2.4 s; 1/1 file; 3/3 tests passed.

## Delivery-time portability verification

The second remote delivery run,
https://github.com/DumoeDss/rasen/actions/runs/30652214877, exposed test-only
platform assumptions after the product had already failed closed:

- Windows Node 20 could not recreate a just-unlinked pathname while the
  fingerprint reader still held the old object open, so the fault injector
  produced `source-remove` / `EPERM` before the intended identity check.
- macOS `/var` versus `/private/var` and Windows temporary-directory aliases
  split the archive fixture's lexical path from the product-canonicalized path.
- `path.join('D:', 'nowhere')` was absolute on Windows but relative on POSIX.

Commit `4a07e3f508fcd6e24f62a5acb83eb5ef387c4863` changes only the three affected
test files. It moves the same-byte replacement to guarded deletion's fourth
`lstat`, after the fingerprint handle closes; canonicalizes the existing
archive fixture directory; and uses a platform-native absolute bare root.
The `source-remove` / `ESTALE` fail-closed assertion is unchanged.

Independent Node `20.19.0` verification passed all three files:
3/3 files and 103/103 tests (`32 + 51 + 20`), exit 0. The exact fault case
passed 1/1, the full fault matrix passed 32/32, and the independent
`canonicalizeExistingPath` probe passed 2/2. Independent review was CLEAN with
0 Blockers, 0 Majors, and 0 Minors.

## Derived-surface contract sweep

- `src/core/archive-consumer-invocation.ts` contains the required
  intent-template, saved dry-run plan, same-token apply, and source-last
  workflow contracts.
- Archive, bulk-archive, and ship workflow sources use the engine consumer
  path. Remaining matches for post-hash mutation language are explicit
  prohibitions, not executable stale instructions.
- `rasen-sync-specs` matches are limited to its general help/sync workflow;
  archive consumers do not invoke external spec sync.
- Additive archive/work flags are present in command registration, help,
  completions, localization, and schema surfaces.
- Archive consumer and skill-template parity are covered by the passing
  archive focused group. No unclassified stale-token match remains.

## Build, validation, and compatibility

| Gate | Exact command | Outcome |
| --- | --- | --- |
| build | `pnpm run build` | exit 0; 11.7 s |
| typecheck | `pnpm exec tsc --noEmit --pretty false` | exit 0; 8.2 s |
| lint | `pnpm run lint` | exit 0; 24.0 s |
| closure strict validation | `node bin/rasen.js validate file-placement-hardening-closure --type change --strict --json --no-interactive` | exit 0; 1/1 valid, 0 issues |
| main specs strict validation | `node bin/rasen.js validate --specs --strict --json --no-interactive` | exit 0; 208/208 valid, 0 failed; INFO-only long-text suggestions |
| root help | `node bin/rasen.js --help` | exit 0 |
| archive help | `node bin/rasen.js archive --help` | exit 0; existing forms plus additive flags present |
| work help | `node bin/rasen.js work --help` | exit 0; existing forms present |
| migrate help | `node bin/rasen.js work migrate --help` | exit 0; additive migration flags present |

A final semantic compatibility probe exited 0 and confirmed package/CLI
version `0.1.6`, package engine `>=20.19.0`, runtime Node `v24.14.0`, existing
archive/work/context/agent forms, additive archive/work flags, and hidden
`experimental -> init` compatibility alias. An earlier probe exited 1 only
because it textually expected `>=20.19` instead of the semantically equivalent
and stricter-looking `>=20.19.0`; the corrected semantic check found no product
issue.

## Diff and path inventory

- `git diff --check`: exit 0; only Git line-ending conversion warnings.
- relative to the saved PR-head baseline, the delivered code/test tree plus
  closure evidence contains 157 changed tracked deliverable paths; all 157 are
  classified in `evidence/changed-path-inventory.md`.
- the delivery series is
  `c231a8ca1d024a31a3957f2f4b9a1909a574a9a2` (implementation),
  `827e4101c32295817d27808e034bd1408ca1db8b` (PR-wide EOF whitespace), and
  `4a07e3f508fcd6e24f62a5acb83eb5ef387c4863` (portable test fixtures).
- seven untracked `.rasen/changes/.../ephemera/*.json` invocation-state paths
  are explicitly excluded from deliverables and untouched.
- `git ls-files -- .rasen`: 0 paths; no tracked `.rasen` ephemera.
- the retired unsafe runner and process-ownership helper are absent.
- no package version or dependency change is present; package version remains
  `0.1.6`, the Node floor remains `>=20.19.0`, and runtime validation used Node
  `v24.14.0`.

## Remote delivery gates

The code/test delivery head is pushed and PR #121 is updated. Third-run native
recovery is complete:

- Linux Node floor: SUCCESS,
  https://github.com/DumoeDss/rasen/actions/runs/30653983123/job/91233748963;
- macOS Node floor: SUCCESS,
  https://github.com/DumoeDss/rasen/actions/runs/30653983123/job/91233749015;
- Windows Node floor: SUCCESS,
  https://github.com/DumoeDss/rasen/actions/runs/30653983123/job/91233748984.

The same run completed successfully:

- general Linux, macOS, Node 24, and all three Windows-shard jobs: SUCCESS;
- required `Test` aggregate: SUCCESS,
  https://github.com/DumoeDss/rasen/actions/runs/30653983123/job/91235591079;
- required `All checks passed`: SUCCESS,
  https://github.com/DumoeDss/rasen/actions/runs/30653983123/job/91235591135.

The separate Docs site run also passed:
https://github.com/DumoeDss/rasen/actions/runs/30653982777.
Archive remains an on-merge action and has not been performed.

See `handoff/delivery.md` for the unchecked delivery fields.
