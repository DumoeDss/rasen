# Review Cycle Round 3 — Fixer Handoff

## Scope and disposition

Implemented only the remaining STD/SPEC-001 recovery-integrity work in the layout-migration implementation/tests, plus this handoff. This is ready for independent confirmation; this leaf does not self-certify the finding as resolved.

## RED and design reasoning

Round 2 upgraded a legacy-v1 `createdPaths` claim to a v2 `completed` operation while both the freshly regenerated staged copy and the pre-existing destination remained present. The upgraded manifest was then durable before `publishPlan` removed staging. A crash at that write boundary made the next process call `verifyRecoveryOperationOwnership`, whose completed invariant correctly rejects both-present state.

The new discriminating vector is `test/core/store/layout-migration-apply-recovery.test.ts:1203`. It injects process death at the new `legacy-recovery-upgrade: after` checkpoint, which occurs immediately after the upgraded v2 manifest write and before `publishPlan`. At that boundary the test requires:

- the durable manifest is v2;
- the adopted target-line operation is `completed` with a digest;
- its destination exists and its staged path is absent;
- a direct `verifyRecoveryOperationOwnership(..., plan)` call succeeds;
- a **second fresh** `StoreLayoutMigration` resumes, retains/verifies the completed target line, and publishes every remaining entry.

The pre-fix round-2 transition fails those staged-absent/verifier assertions and cannot complete through the second fresh process.

## Exact durable-state transition

### Legacy-v1 adoption

`src/core/store/layout-migration/apply.ts:410-484` now performs, for each exact unique recorded destination:

1. Prove exact unique correspondence to one freshly staged immutable-plan entry.
2. Require staged and destination copies to exist with the same filesystem kind.
3. For receipts, transform staged bytes through the ordinary idempotent `published` phase using the original manifest `startedAt`.
4. Compute the planned staged digest and current destination digest and require exact equality.
5. Remove only the freshly regenerated staged copy **after** digest proof.
6. Mint the v2 operation as `completed` only after the filesystem already has the verifier-required destination-present/staged-absent state.

`src/core/store/layout-migration/module.ts:543-552` then runs `verifyRecoveryOperationOwnership` against the proposed v2 manifest and immutable plan before writing it. Only after that succeeds is the v2 upgrade written durably, followed by the injectable post-write checkpoint.

Therefore the durable transition is:

```text
legacy v1 + destination present + freshly staged proof copy present
  -> compare exact planned/destination digest
  -> remove regenerated staged proof copy
  -> verify proposed completed operation (destination only, exact digest)
  -> durably write v2 completed operation
```

No destination is removed or overwritten, pathname alone grants no ownership, and `verifyRecoveryOperationOwnership` was neither bypassed nor weakened.

### Subsequent v2 restarts

Fresh staging naturally regenerates entries even for operations already owned at their destination. `consumeDestinationOwnedStagingCopies` at `apply.ts:494-539`, called from `module.ts:526-531`, handles both completed operations and prepared-after-rename operations:

1. The existing durable operation/destination is verified first by the unchanged `verifyRecoveryOperationOwnership` call at the start of resume.
2. Freshly regenerated staged bytes are transformed through the normal receipt phase when applicable.
3. Their digest must equal the durable operation digest.
4. The regenerated staged copy is removed before the next manifest write.

`publishPlan` at `apply.ts:1032` now obtains the expected digest from a durable operation when its staged copy is intentionally absent, then re-digests and verifies the existing destination before marking/skipping it and continuing remaining entries. It never overwrites the destination.

This also preserves existing v2 prepared-after-rename resume semantics: when verification proves the prepared operation's owned copy is already at destination, regenerated staging is digest-proved and consumed before publication reconciliation.

## Files changed in round 3

- `src/core/store/layout-migration/apply.ts`
  - `reconcileLegacyCreatedPaths`: establish destination-only state before completed ownership is minted (`:410`).
  - `consumeDestinationOwnedStagingCopies`: preserve unambiguous ownership after fresh staging (`:494`).
  - `publishPlan`: safely use durable operation digest when an already-owned entry intentionally has no staged copy (`:1032`, inner publication loop near `:1085`).
- `src/core/store/layout-migration/module.ts`
  - consume regenerated copies for existing v2 destination-owned operations (`:526`).
  - verify proposed legacy upgrade before its durable write and expose the exact post-write crash boundary (`:543-552`).
- `src/core/store/layout-migration/dependencies.ts`
  - added semantic test checkpoint `legacy-recovery-upgrade: after` near `:119`.
- `test/core/store/layout-migration-apply-recovery.test.ts`
  - second-fresh-instance durable-boundary test (`:1203`).
  - consolidated fail-closed legacy matrix (`:1258`).
  - retained foreign-byte digest-mismatch vector (`:1329`).
- `rasen/changes/migrate-cross-project-coordinators-to-store-issues/handoff/review-cycle-round-3-fixer.md`
  - this handoff only.

No `.rasen/**`, review report, docs/CI/fixtures, other Change artifacts, archive/effective-root code, commit, push, PR, or archive operation was touched in round 3.

## Positive and negative matrix

### Positive

1. **Legacy v1 with non-empty `createdPaths`, crash immediately after durable v2 upgrade**
   - durable operation is completed/digest-backed;
   - destination exists, staged copy is absent;
   - verifier accepts the exact durable boundary;
   - second fresh instance resumes remaining publication;
   - existing destination is digest-verified and not overwritten;
   - final operations are completed.
2. Existing exact legacy-v1 empty/non-empty continuation, rollback, v2 prepared-operation, after-rename, no-clobber, lock-order, and round-1 vectors remain in the recovery suite.

### Negative legacy-adoption matrix

Each matrix row asserts recovery refuses, the durable manifest remains byte-identical v1/un-upgraded, and all non-staging Store bytes remain byte-identical to the pre-attempt snapshot:

1. **Missing recorded destination** -> `migration_recovery_ambiguous`.
2. **Unplanned recorded path** (foreign file) -> `migration_recovery_ambiguous`; foreign bytes remain.
3. **Duplicate recorded path** -> `migration_recovery_ambiguous`.
4. **Wrong-kind recorded content** (planned file replaced with foreign directory/file) -> `migration_recovery_ambiguous`; foreign tree remains.
5. **Receipt state/digest incompatibility** (published receipt modified to incompatible staged phase/time bytes) -> `migration_recovery_digest_mismatch`; receipt remains unchanged by adoption.
6. **Existing foreign-byte mismatch vector retained** -> `migration_recovery_digest_mismatch`; foreign destination bytes remain exact and manifest remains v1.

Staging itself is allowed to be regenerated during a failed proof attempt, so the matrix excludes `.rasen/` machine-local staging from the Store-byte snapshot while separately pinning the durable coordination manifest byte-for-byte.

## Commands and exact results

- `pnpm exec vitest run test/core/store/layout-migration-apply-recovery.test.ts -t "legacy-v1|legacy recovery"`
  - **NOT RUN**: execution required approval and approval was not granted.
- `pnpm exec tsc --noEmit`
  - **NOT RUN**: execution required approval and approval was not granted.
- `git diff --check`
  - **PASS**: exit 0, no output.
- `git diff --check origin/dev/0.1.7`
  - **PASS**: exit 0, no output.
- Full recovery suite
  - **NOT RUN**: package-script execution was not approved.
- `pnpm build`
  - **NOT RUN**: package-script execution was not approved.
- `pnpm lint`
  - **NOT RUN**: package-script execution was not approved.

No runtime, type-check, build, or lint success is claimed.

## Remaining concerns for independent confirmation

1. Run the focused legacy vectors and the complete `layout-migration-apply-recovery` suite first; the code was source-checked but not executed in this leaf.
2. Run TypeScript/build/lint. In particular, independently confirm the new checkpoint union and direct internal verifier test import satisfy repository lint/import rules.
3. Exercise the existing v2 after-rename prepared-operation matrix because fresh staging cleanup was generalized to destination-owned prepared operations to preserve their existing restart invariant.
4. Independently inspect receipt compatibility: both legacy adoption and later v2 restaging use the original manifest `startedAt`, matching publication's existing phase timestamp contract.
5. This handoff intentionally makes no reviewer verdict and does not declare STD/SPEC-001 resolved.
