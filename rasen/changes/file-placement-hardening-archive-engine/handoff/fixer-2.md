# Fixer handoff 2: archive-engine Round-2 remediation

Date: 2026-07-31
Role: FIXER, Round 2 final fix round
Canonical review: `evidence/review-report.md`, Round 2 (unchanged)

## Outcome

All six findings remaining after Round 2 are implemented and covered by
deterministic regressions. The archive transaction no longer deletes
unaccounted final-reservation occupants, all fingerprint/spec reads are bound
to opened filesystem objects and lossless identities, interrupted spec
publication/cleanup states reconcile only exact transaction-owned objects,
completed resume revalidates the payload and accounting, blocked previews
always carry a saved serializable plan after root/argument parsing, and
generated single/bulk/in-ship argv are executed through real Commander.

The generated-argv integration also exposed and fixed a production CLI defect:
Commander's default `validate: true` was incorrectly classified as a planning
option during `--apply-plan`, so the documented token apply command could not
run. Apply now conflicts only with an explicit negation
(`validate === false`).

No canonical review, run state, task checkbox, Store/root foundation, commit,
push, ship, or archive operation was changed. Closure-owned native matrix task
7.6 remains open.

## Finding-to-regression map

| Round-2 finding | Remediation | Primary regression |
| --- | --- | --- |
| Reserved-final retry deletes concurrent occupants | The empty final reservation is durably bound to a real-directory identity. Every copied path has a durable intent, expected payload, copied state, and observed object identity. Recovery verifies recorded entries and blocks on any unaccounted or intent-only occupant; there is no recursive reservation clear. | `archive-fault-matrix`: inject `CONCURRENT.txt` after the reservation journal becomes durable and before first payload copy; the initial race is recoverable, normal retry blocks with `EEXIST`, the concurrent bytes survive, and active remains. |
| File reads are not bound to deletion identity | Regular reads now perform `lstat -> open(O_RDONLY \| O_NOFOLLOW) -> fstat(bigint) -> handle read -> fstat(bigint) -> lstat`. `dev`, `ino`, `mode`, `size`, `mtimeNs`, and `ctimeNs` serialize as decimal strings. | `archive-fault-matrix`: deterministic pathname swap inside `readHandle` is rejected with `ESTALE`; identity and payload sizes are asserted as decimal strings. |
| Spec crash states do not reconcile | Spec create/update journal the exact claim/temp/published identities and planned hashes. Recovery accepts a pre-flush target only when it is the same hard-link object as the durable temp. Update cleanup verifies the claimed original and accepts an absent backup only after a previously durable `verified` state. | `archive-engine`: create post-link/pre-flush, update post-link/pre-flush, and update post-backup-unlink/pre-complete retries all finish with exact rebuilt bytes and no stranded claim. |
| Completed resume skips verification | Terminal resume validates the publication marker binding and digest, the verified `accounting-finalized` before/expected/observed fingerprint, the current final payload, stable `archive.json` plan/journal facts, evidence hashes, and accounting invariants before returning `complete`. | `archive-fault-matrix`: complete archive, corrupt `proposal.md`, retry same plan; result is recoverable `accounting/ESTALE` and corrupt bytes are not accepted or overwritten. |
| Pre-plan blockers bypass the immutable plan | Missing/invalid sources and timing, validation, task, sidecar/evidence, and spec-preparation failures are projected into `ArchivePlan.blockers`. Source absence skips unsafe discovery while retaining a complete plan. Saved blocked previews return the plan and token and exit nonzero. | `archive.test`: missing source with `--dry-run --save-plan --json` returns `dryRun: true`, `source: missing`, `source-lstat/ENOENT`, a canonical plan token, a persisted plan envelope, and exit code 1. |
| Generated integration substitutes direct controllers | Added one executable generated-consumer argv/completion adapter. Templates share its command examples. Integration captures its exact argv and executes intent template, saved preview, and exact-token apply through `createProgram(...).parseAsync(...)`; direct controller parity is a separate test. | `archive-consumer-integration`: single, bulk, in-ship plus empty-handoff, probe-only, multiple-probe, absent-intent, and `--skip-specs` variants all execute through real Commander. |

## Main implementation surfaces

- `src/core/archive-engine.ts`
  - handle-bound bigint file identities and reads;
  - durable final-reservation identity and per-entry copy capabilities;
  - exact spec temp/target/backup reconciliation;
  - completed marker/fingerprint/accounting verification.
- `src/core/archive.ts`
  - complete blocker projection through plan creation;
  - missing-source saved preview;
  - corrected Commander `--apply-plan` option-conflict boundary.
- `src/core/archive-consumer-invocation.ts`
  - shared generated consumer argv;
  - consumer-owned strict intent completion.
- `src/core/templates/workflows/{archive-change,bulk-archive-change,ship}.ts`
  - shared executable command examples.
- `test/core/archive-{engine,fault-matrix,consumer-integration}.test.ts` and
  `test/core/archive.test.ts`
  - deterministic Round-2 reproduction matrix.

## Verification

- Focused archive suite:
  - `pnpm exec vitest run test/core/archive-engine.test.ts test/core/archive-consumer-integration.test.ts test/core/archive-fault-matrix.test.ts test/core/archive-path-semantics.test.ts test/core/archive-accounting.test.ts test/core/archive-ephemera.test.ts test/core/ephemera-cleaner.test.ts test/core/archive.test.ts test/core/templates/archive-engine-consumers.test.ts test/core/templates/skill-templates-parity.test.ts`
  - PASS: 10 files, 169 passed, 1 POSIX-only test skipped on Windows.
- Work command:
  - `pnpm exec vitest run test/commands/work.test.ts --pool=forks --maxWorkers=1`
  - PASS: 20/20.
- Completion registry:
  - `pnpm exec vitest run test/core/completions/command-registry.test.ts`
  - PASS: 7/7.
- `npx tsc --noEmit`: PASS.
- `pnpm lint`: PASS.
- `pnpm build`: PASS.
- CLI startup:
  - `node bin/rasen.js --help`: PASS.
  - `node bin/rasen.js archive --help`: PASS; all archive transaction flags present.
  - `node bin/rasen.js work migrate --help`: PASS.
- `node bin/rasen.js validate file-placement-hardening-archive-engine --json`:
  PASS, 1/1 valid with zero issues.
- `git diff --check`: PASS; only repository line-ending conversion warnings.

## Remaining boundary

Native Windows/macOS/Linux matrix completion remains owned by
`file-placement-hardening-closure` task 7.6. This Windows run does not claim
native macOS or Linux evidence.
