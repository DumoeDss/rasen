# Review Cycle: `fix-existing-change-workspace-binding`

**Date:** 2026-08-10
**Rounds:** 1/3
**Tier:** A
**Status:** CLEAN

| Round | Findings (B/Ma/Mi/T) | Triage | Fixed by | Confirmed by (non-author) | Resolved |
|---|---:|---|---|---|---:|
| 1 | 0/1/1/0 | `ST-1/SP-1`: non-trivial identity-boundary fix; `AK-1`: accepted-known | `/root/identity_drift_fixer` | `/root/identity_drift_reviewer` | 1/1 blocking finding |

## Round 1

- **Finding:** `ST-1/SP-1` — an old create-disposition token could accept a different same-path, same-ref worktree identity on retry.
- **Fix:** read the existing workspace index before revalidation and require any recorded create-side `worktreeInstanceId` to match the live identity before carrier or index writes.
- **Regression:** bind an originally-created pair, replace the execution side with a same-ref clone, restore the original carrier bytes, retry the old token, require `workspace_plan_stale`, and prove both carriers plus the index remain byte-identical.
- **Non-author confirmation:** the independent reviewer confirmed the guard is symmetric, pre-write, preserves first-apply behavior when no identity is recorded, and directly closes the spec and standards finding.
- **Disposition:** `ST-1/SP-1` resolved. No Blocker or Major remains.
- **Accepted-known:** `AK-1` remains Minor because no repository-wide `pnpm test` attempt completed on Windows; no attempt reported an assertion failure.

## Final clean-round test evidence

- **Required scope:** Store workspace apply regressions plus the real Store v2 CLI lifecycle covering binding, show, archive dry-run eligibility, retry, drift refusal, and cleanup.
- **Rationale:** the implementation changes are confined to workspace apply/binding orchestration; these two files exercise the changed identity boundary and its downstream CLI finalization/cleanup consumers with real Git worktrees.
- **Command:** `pnpm exec vitest run test/core/store/workspace-apply.test.ts test/commands/store-v2-workspace-journey.test.ts`
- **Result:** PASS — 2 files, 21/21 tests; Vitest duration 153.45 s.
- **HEAD tree at gate:** `d2d213eb26d2ee51087b284bbb6d5f6a8a41d855` (`git rev-parse HEAD^{tree}`).
- **Uncommitted code-delta fingerprint at gate:** `d41aaa70fa7d78d26c20b809c043fd62d4aff4a2` (`git patch-id --stable` over the four implementation/test files against `origin/dev/0.1.7`).
- **Freshness note:** the gate included the live uncommitted delta, so the HEAD tree alone does not identify that content. Ship must require a matching post-commit tree gate rather than treating this pre-commit fingerprint as reusable delivery evidence.

Supporting prior evidence: the implementer reported 46/46 focused tests, build, and lint passing before the Round 1 fix; the fixer additionally reported the single workspace-apply file at 18/18 after the fix.

## Final disposition

- Blocker: 0
- Major: 0
- Minor: 1 accepted-known (`AK-1`)
- Trivial: 0

## CI fix cycle — PR #149

**Date:** 2026-08-10
**Passes:** 1/1 (ONE_SHOT)
**Status:** CLEAN
**Fix rounds after this pass:** 0

| Pass | Reviewed delta | Findings (B/Ma/Mi/T) | Triage | Fixed by | Confirmed by (non-author) | Disposition |
|---|---|---:|---|---|---|---|
| CI-fix pass 1 | `git diff HEAD -- src/core/store/layout-migration/evidence.ts` | 0/0/1/0 | `AK-1`: accepted-known; no actionable finding | PR #149 CI-fix author | `/root/identity_drift_reviewer` | CLEAN; no fix round required |

### Delta and non-author confirmation

- **Author != verifier:** confirmed. `/root/identity_drift_reviewer` did not author the CI-fix delta and independently reviewed it report-only.
- **Exact review scope:** the nine-line working-tree delta in `src/core/store/layout-migration/evidence.ts`, changing the record-derived key from `record.id ?? record.projectId` to the permanent membership authority `record.projectId` and correcting the accompanying contract comment.
- **Resolution:** no Blocker or Major was opened. The permanent project identity now consistently keys membership, adoption evidence, mapping membership checks, and machine-association filtering; the human display `id` remains reading-only.
- **Fix loop accounting:** the first CI-fix pass was CLEAN, so no triage-to-fixer dispatch and no subsequent fix or re-review round occurred.
- **Accepted-known:** `AK-1` remains the sole Minor accepted-known item. The focused CI-fix evidence does not close the earlier repository-wide-suite evidence gap.

### Supplied CI-fix gate evidence

This reviewer consumed the following implementer/LEAD-supplied evidence and did **not** rerun any command:

1. `pnpm exec vitest run test/core/store/layout-migration-catalog-receipt.test.ts -t "blocks a v1 value the stricter v2 validators reject, telling the operator what to change it to"` — PASS, 1/1 selected test.
2. `pnpm exec vitest run test/core/store/layout-migration-catalog-receipt.test.ts -t "migrates a Store whose membership record carries a human display name"` — PASS, 1/1 selected test.
3. `pnpm exec vitest run test/core/store/layout-migration-catalog-receipt.test.ts` — PASS, 8/8 tests.
4. `pnpm exec vitest run test/core/store/layout-migration-provenance.test.ts` — PASS, 10/10 tests.
5. `pnpm run lint` — PASS.

**Required scope:** the two cases that failed in CI at the permanent-identity/display-name membership boundary, their complete catalog-receipt file, the adjacent provenance suite, and lint.

**Coverage rationale:** both selected regressions deliberately separate `projectId: elftia` from display `id: Elftia` while mapping to permanent identity `elftia`, so they directly expose the bad display-key join. The full catalog-receipt file checks that restoring `projectId` does not disturb surrounding migration/catalog/receipt behavior; the provenance suite covers downstream ownership-evidence construction; lint covers the bounded TypeScript/comment edit. That scope matches the risk of this single-key correction. No broader code path changed, and repository-wide completion remains represented by `AK-1` rather than silently inferred.

### Current uncommitted delta fingerprint

- HEAD commit: `70b5a74c6e1d1a17450c2dedb916576bdcc0e9be`.
- HEAD content tree: `b853f8eefcaeb08765b8f84c7f92d5a218f87f69` (`git rev-parse HEAD^{tree}`).
- Stable patch id: `0e5437f86704cc553b67316c3a57bfd207b65430` (`git diff HEAD -- src/core/store/layout-migration/evidence.ts | git patch-id --stable`).
- Base file blob: `42357032b284155933aad9314011fd99bf271a9f` (`git rev-parse HEAD:src/core/store/layout-migration/evidence.ts`).
- Working file blob: `3622a19a30e69a1a1c34ddeefbee786957bab3e6` (`git hash-object src/core/store/layout-migration/evidence.ts`).
- Freshness note: because the reviewed CI fix is uncommitted, HEAD/tree alone does not identify it; the stable patch id plus base/working blobs bind this cycle entry to the exact reviewed delta.

### CI fix cycle disposition

- Blocker: 0
- Major: 0
- Minor: 1 accepted-known (`AK-1`)
- Trivial: 0
- Final status: **CLEAN**
