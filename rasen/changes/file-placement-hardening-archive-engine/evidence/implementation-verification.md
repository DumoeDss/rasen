# Archive engine implementation verification

Date: 2026-07-31
Host actually run: Windows
Local task state: 40/41; native Windows/macOS/Linux CI task 7.6 remains open
for `file-placement-hardening-closure`.

## Equivalent consumer integration

`test/core/archive-consumer-integration.test.ts` extracts the authoritative
apply command required by generated single, bulk, and in-ship templates and
executes the real `ArchiveCommand` for each consumer plus direct CLI against
equivalent fixtures.

The comparison covers:

- exact cleaner delete/preserve results;
- staged absorbed/preserved handoff outcomes;
- unchanged contained probe bytes and recorded commit;
- recursive quality metadata;
- independently re-hashed evidence inventory;
- completed journal phase and actual disposed paths;
- normalized transaction/time-bound ship-log and accounting fields.

Result: PASS, 1/1 integration test.

## Named fault matrix

`test/core/archive-fault-matrix.test.ts` maps every task 7.1 fault to a named
injection and asserts operation/path/code report fields, active or target tree
bytes, archive/journal state, truthful cleaner progress, and deterministic
retry or deterministic blocking.

| Required fault | Injection / phase | Verified outcome |
| --- | --- | --- |
| source drift | source fingerprint revalidation, `ESTALE` | active current bytes retained; no stage/final; repeated result stable; repaired source completes |
| target race | unrelated final appears after planning, `EEXIST` | target byte-identical; no journal written into it; repeated result stable; removal permits apply |
| `EXDEV` | stage-to-final rename | invariant failure retains `EXDEV`; active/ephemera exact; stage journal resumes |
| `EPERM` | stage-to-final rename | no fallback; exact sources; stage journal resumes |
| `EACCES` | stage-to-final rename | no fallback; exact sources; stage journal resumes |
| `EIO` | stage-to-final rename | no fallback; exact sources; stage journal resumes |
| copy failure | exclusive payload copy, `EIO` | partial owned stage journaled; exact sources; retry rebuilds stage |
| staged-tree mismatch | copied proposal corrupted, `ESTALE` | mismatch journaled; exact sources; retry rebuilds stage |
| sidecar read failure | sidecar read, `EACCES` | stable blocked plan; zero mutation; clean replan completes |
| sidecar schema failure | future/wrong malformed sidecar | stable blocked plan; intent bytes unchanged; explicit fix replans |
| Git failure | confirmed-state adapter, `EIO` | both Git facts remain error, no guessed values, zero mutation |
| evidence hash drift | accounting evidence resolver, `ESTALE` | published failed journal; active retained; actual cleaning recorded; retry completes |
| journal failure | first exclusive journal temp open, `EIO` | owned failed journal retained; exact sources; stage rebuild resumes |
| publish failure | stage-to-final rename, `ENOSPC` | no fallback/clobber; exact sources; stage journal resumes |
| accounting failure | atomic ledger adapter, `EIO` | published journal, active retained, no false ledger, actual cleaning recorded |
| cleaner partial failure | second candidate apply, `EIO` | only first deletion recorded/on disk; second preserved; retry applies untouched candidate |
| active-source removal failure | source-last recursive remove, `EACCES` | active tree exact; verified accounting retained; retry removes source and completes |

Result: PASS, 17/17 fault/recovery tests.

## Explicit path semantics

`test/core/archive-path-semantics.test.ts` passes `path.win32` and
`path.posix` directly. It does not infer semantics from the Windows host.
Coverage includes drive letters, case identity, separators, relative
sidecar/probe syntax, lexical and resolved containment, modeled symlink escape,
same-parent stage/final/journal identity, and date-prefixed collision matching.

Result: PASS, 6/6 path-semantic tests. These pure checks are not represented as
native macOS/Linux filesystem evidence.

## Complete affected verification

Command:

`pnpm exec vitest run test/core/archive.test.ts test/core/archive-engine.test.ts test/core/archive-consumer-integration.test.ts test/core/archive-fault-matrix.test.ts test/core/archive-path-semantics.test.ts test/core/archive-accounting.test.ts test/core/archive-ephemera.test.ts test/core/ephemera-cleaner.test.ts test/core/templates test/commands/ship.test.ts test/commands/work.test.ts test/core/management-api/archive.test.ts test/core/management-api/archive-api.test.ts`

Result: PASS, 21 files and 216/216 tests.

Additional gates:

- `pnpm exec tsc --noEmit --pretty false`: PASS.
- `pnpm lint`: PASS.
- `pnpm build`: PASS.
- `node bin/rasen.js validate file-placement-hardening-archive-engine --json`:
  PASS, 1 valid change and 0 issues.
- `git diff --check`: PASS; only line-ending conversion warnings.

The known no-summary repository-wide suite was not repeated and is not claimed
as passing.

## Round 1 review remediation verification

The initial results above predate the canonical round 1 report. The remediation
upgraded new plans and journals to version 2 and supersedes the earlier
stage-to-final rename and recursive source-removal descriptions.

Implemented transaction contract:

- `--dry-run --save-plan` durably stores the canonical-hash plan envelope and
  returns `archive-v1:<transaction>:<hash>`; `--apply-plan` loads that exact
  plan without root resolution, validation, prompting, spec preparation, or
  replanning and is also the only recovery command.
- Final publication uses an exclusive directory reservation, exclusive payload
  copy/rehash, and atomic no-replace `.rasen-archive-published.json` marker.
- Journal v2 records transformed phase fingerprints plus per-spec,
  per-cleaner, and source claim/removal progress. Cleaner and spec mutation
  intent is flushed before each destructive syscall.
- Active-source removal uses a transaction-owned sibling quarantine and
  guarded bottom-up unlink/rmdir. It never recursively removes the active
  path. Prepared spec deletion uses the same full-tree authority boundary.
- Generated single, bulk, and in-ship consumers execute intent-template,
  complete external intent, saved preview, and exact-token apply. They contain
  no external spec-sync command or second plain archive apply.

Round 1 focused command:

`pnpm exec vitest run test/core/archive-engine.test.ts test/core/archive-consumer-integration.test.ts test/core/archive-fault-matrix.test.ts test/core/archive-path-semantics.test.ts test/core/archive-accounting.test.ts test/core/archive-ephemera.test.ts test/core/ephemera-cleaner.test.ts test/core/archive.test.ts test/core/templates/archive-engine-consumers.test.ts test/core/templates/skill-templates-parity.test.ts`

Result: PASS, 10 files, 155 passed and 1 POSIX-only case skipped on the Windows
host. The skipped case asserts native `0711` directory and executable-file
semantics and remains part of closure-owned task 7.6.

Round 1 complete affected command:

`pnpm exec vitest run test/core/archive.test.ts test/core/archive-engine.test.ts test/core/archive-consumer-integration.test.ts test/core/archive-fault-matrix.test.ts test/core/archive-path-semantics.test.ts test/core/archive-accounting.test.ts test/core/archive-ephemera.test.ts test/core/ephemera-cleaner.test.ts test/core/templates test/commands/ship.test.ts test/commands/work.test.ts test/core/management-api/archive.test.ts test/core/management-api/archive-api.test.ts`

Result: PASS, 21 files, 236 passed and 1 POSIX-only case skipped on the Windows
host.

The first attempt found that the four new archive registry flags lacked locale
presentation copy, which made global CLI presentation preflight terminate all
spawned subcommands before dispatch. Complete English, Japanese, and Simplified
Chinese descriptions plus a focused presentation golden now cover
`save-plan`, `apply-plan`, `intent-template`, and `intent-file`. Root,
`archive`, and `work migrate` help all exit 0 after build, and standalone
`test/commands/work.test.ts` passes 20/20. The full stack, original failing test
names, classification, and resolution are recorded in `handoff/fixer-1.md`.
The final post-fix archive-focused command including the standalone work suite
also passes: 11 files, 175 passed and 1 POSIX-only case skipped on Windows.

Additional round 1 gates:

- `pnpm exec tsc --noEmit --pretty false`: PASS.
- `pnpm lint`: PASS.
- `pnpm build`: PASS.
- `node bin/rasen.js validate file-placement-hardening-archive-engine --json`:
  PASS, 1 valid change and 0 issues.
- `git diff --check`: PASS; line-ending conversion warnings only.

The exact finding-to-regression map is in `handoff/fixer-1.md`. Native
macOS/Linux execution is not claimed here and task 7.6 remains open.
