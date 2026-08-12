# Review Cycle Round 2 — Fixer Handoff

## Scope

Implemented only the remaining STD/SPEC-001 legacy-v1 resume continuation. This handoff is for independent confirmation and does not self-certify the finding as resolved.

## RED evidence

Added the positive regression first in `test/core/store/layout-migration-apply-recovery.test.ts:1201` using an exact base-shaped `version: 1` manifest produced by removing `runId` and `operations` from interrupted durable evidence. The interruption occurs after a target-line destination has genuinely been renamed and recorded in non-empty `createdPaths`; recovery then runs through a fresh `StoreLayoutMigration` instance.

Against the pre-fix control flow, this vector reaches the existing failure described in the canonical review: revalidation admits the recorded target-line destination, the v1-to-v2 upgrade creates no operation, and `publishPlan` rejects it as an unrecorded destination.

I attempted the focused RED run before production edits:

- `pnpm exec vitest run test/core/store/layout-migration-apply-recovery.test.ts -t "legacy-v1 completed destinations|mismatched bytes at a legacy-v1"`
- **NOT RUN**: the harness required execution approval and did not approve the command. No runtime RED result is claimed.

## Implementation

### `src/core/store/layout-migration/apply.ts:405-491`

Added `reconcileLegacyCreatedPaths` as a narrow compatibility bridge from exact legacy-v1 pathname evidence to v2 digest-backed completed operations.

For every legacy `createdPaths` entry it now:

1. Requires exact string equality with exactly one freshly staged publication destination; duplicate, absent, or ambiguous claims fail with `migration_recovery_ambiguous`.
2. Relies on strict manifest parsing's existing Store containment check before reconciliation.
3. Requires both staged and destination content to exist and have the same filesystem kind; missing and wrong-kind states fail closed.
4. Applies the normal published receipt phase to the freshly staged receipt before comparing it, matching publication's planned receipt bytes.
5. Computes the exact staged and destination recursive/file digests with the existing `digestTree` contract.
6. Rejects mismatched bytes with `migration_recovery_digest_mismatch` without deleting or overwriting the recorded destination.
7. Mints one v2 `completed` operation carrying the new resume run id, deterministic operation id/kind, exact staged and destination identities, expected-absence precondition, and planned digest.

Legacy pathnames therefore are not blanket ownership: only exact, unique, freshly planned/staged destinations with exact bytes become completed operations.

### `src/core/store/layout-migration/module.ts:31-44,503-536`

Legacy resume now:

1. Stages and verifies the immutable plan as before.
2. Mints a distinct resume run id.
3. Reconciles every legacy recorded destination before changing the durable manifest version.
4. Writes the upgraded v2 manifest with all reconciled completed operations before entering `publishPlan`.

`publishPlan` consequently verifies and skips matching completed destinations, then prepares and publishes only remaining entries through the existing v2 operation ownership, digest, no-clobber, lock, and rollback path. Existing v2 resume is unchanged.

## Positive and negative vectors

### Positive

`test/core/store/layout-migration-apply-recovery.test.ts:1201-1226`

- Interrupts after the target-line catalog was genuinely published.
- Converts durable evidence to the exact base legacy-v1 shape with non-empty `createdPaths`.
- Restarts with a fresh Module instance and resumes.
- Requires complete publication.
- Reloads the durable upgraded manifest and requires a digest-backed completed operation for the already-published target-line destination.

### Negative

`test/core/store/layout-migration-apply-recovery.test.ts:1228-1252`

- Uses the same genuinely published, legacy-recorded target-line destination.
- Replaces it with foreign/mismatched bytes before restart.
- Requires `migration_recovery_digest_mismatch`.
- Requires the foreign bytes to remain byte-identical.
- Requires the durable manifest to remain version 1, proving no upgraded ownership evidence was persisted for mismatched content.

Existing v2 prepared-operation and recovery-state vectors remain in the same suite and were not redesigned.

## Commands and exact results

- Focused RED command listed above: **NOT RUN**, permission not approved.
- Focused post-fix command (same command): **NOT RUN**, permission not approved.
- `git diff --check`: **PASS** (exit 0, no output), run twice after edits.
- Recovery suite: **NOT RUN**, package-script execution was not approved.
- Build: **NOT RUN**, package-script execution was not approved.
- Lint: **NOT RUN**, package-script execution was not approved.

## Remaining concerns / independent checks

1. The LEAD/reviewer must execute the focused vectors, full recovery suite, build, and lint; this leaf has no runtime-test result.
2. Independently verify the receipt compatibility branch against an interrupted legacy receipt publication, because it deliberately stages the normal published receipt phase before digest comparison.
3. Independently review whether exact destination string matching is the desired strict base-manifest identity rule on all supported Windows path spellings; it intentionally refuses aliases rather than granting ownership through canonical equivalence.
4. No `.rasen/**`, review report, proposal/design/tasks/spec, fixture, docs, CI, archive code, STD/SPEC-002/003 code, commit, push, PR, or archive operation was touched in this round.

## Delta pointer

Round-2 fixer delta is limited to:

- `src/core/store/layout-migration/apply.ts`
- `src/core/store/layout-migration/module.ts`
- `test/core/store/layout-migration-apply-recovery.test.ts`
- `rasen/changes/migrate-cross-project-coordinators-to-store-issues/handoff/review-cycle-round-2-fixer.md`
