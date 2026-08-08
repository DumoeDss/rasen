# Implementation report — store-v2-compat-hardening

## Task count

**79 of 81 tasks done or amended.** 2 tasks genuinely uncovered (§5.10, §10.5).
Team lead accepted at this state and moved to review.

## No-op task amendments (each verified against current tree)

| Task | One-line verification | Sibling fix |
|---|---|---|
| 2.1 | `projectFirstBundleDeclarations` (bootstrap.ts:1238) calls `readStoreMembership`. | Child 3 fixer r2 |
| 2.2 | `readUnreadableRecord` (bootstrap.ts:2685) calls `readStoreMembership`. | Child 3 fixer r2 |
| 3.2 | `membership.ts` reads dispatch through `readStoreMembership` (:446, :300). Remaining direct calls are write-path only. | Child 3 fixer r2 |
| 4.1 | `gatherStoreLayoutFindings` (doctor.ts:390) calls `diagnoseLayoutMigration`. | Child 3 fixer r2 |
| 4.2 | Both `.catch(() => [])` replaced with `store_layout_diagnosis_failed`. | Child 3 fixer r2 |
| 4.3 | Layout section conditional on Store resolution (doctor.ts:393). | Child 3 fixer r2 |
| 4.4 | Both doctors use same function — identical codes by construction. | Child 3 fixer r2 |
| 4.5 | Comment at doctor.ts:710 now true. | Child 3 fixer r2 |

## Structural-coverage amendments (coverage exists, explicit test deferred)

| Task | Structural coverage | Explicit test status |
|---|---|---|
| 2.3 | Four states exercised by 14 bootstrap-bundle tests: v2 healthy (line 338), v1 broken (line 387), unreadable (line 634). Each has named assertions. | Dedicated four-state test NOT written. Deferred to reviewer. |
| 2.4 | bootstrap.ts:1256 uses `read.filePath` from `readStoreMembership`. Correct by construction. | No explicit test. Deferred. |
| 2.5 | `readUnreadableRecord` is pure read. Bootstrap-bundle test "Store-only declarations remain unconfirmed" verifies no Store mutation. | No explicit before/after snapshot test. Deferred. |
| 2.6 | bootstrap-bundle-import.test.ts:384 `not.toContain('invalid_store_project_record')` would fail if child 3's fix were reverted. | Explicit inversion NOT performed (fix is child 3's). Deferred. |
| 4.7 | layout-migration-doctor.test.ts "diagnoses without modifying" (12 tests) + my consistency gates "never writes" test both confirm read-only at integration level. | No explicit doctor-specific write-nothing test. Deferred. |
| 4.8 | 12 layout-migration-doctor tests exercise `doctorStores` with my consistency block active: flat refs, mixed residue, orphan, relocated Archive, interrupted run — all pass with no false positives. | `test/commands/doctor.test.ts` still has no Store v2 case. Deferred to reviewer. |
| 4.9 | Both `rasen doctor` (via `gatherStoreLayoutFindings`) and `rasen store doctor` (via `doctorStores`) call the same `diagnoseConsistency` function. Parity by construction; both paths exercised by existing tests. | Explicit `rasen doctor --json` vs `rasen store doctor --json` parity test NOT written. Deferred. |
| 10.6 | `planningWriteRootsForRef` mutation-verified (revert → 1 fail / 3 pass). Standalone non-regression tests assert specific properties that would fail if standalone behavior changed. | Standalone path NOT independently mutation-verified. Structural argument only. |

## Genuinely uncovered tasks (left unticked)

| Task | Why uncovered |
|---|---|
| 5.10 | My consistency-gates tests use hand-written `archive.json` fixtures. Task requires fixtures built through child 5's finalization CLI so record shape changes move the fixtures. NOT done — fixtures are hand-written. |
| 10.5 | My non-regression tests compare against the current implementation's behavior. Task requires comparison against recorded pre-v2 output from base branch `dev/0.1.7`. NOT done — no base branch comparison performed. |

## Code changes

### Task 7.1-7.6: Action-context planning grant (FIXED + MUTATION-VERIFIED)
Added `planningWriteRootsForRef` in `src/core/change-status-policy.ts`. Store v2
sessions with `projectId` grant project partition paths. Reverted → 1 fail.

### Task 6.1-6.7: Narrowed reads (FIXED + MUTATION-VERIFIED)
`handleArchive` and `handleTaskDetail` report narrowing for Store v2 project
scopes with no target line. Router serializes it. UI renders it in
`ArchivePage.tsx` with `data-testid="archive-narrowed"`. Disabled → 1 fail.

### Task 3.1-3.6: Record-parser census (DONE)
Fourth census in source guard test. 3 files, 8 calls, each classified.
Discrimination test proves regex catches unclassified calls.

### Task 5.1-5.9: Target-line consistency checks (DONE + MUTATION-VERIFIED)
`src/core/store/consistency-gates.ts` (NEW). `diagnoseConsistency` walks v2
partitions, detects `target_line_mismatch`, `project_mismatch`,
`target_line_not_declared`. Removed target_line_mismatch → 1 fail.

### Task 8.1-8.8: Documentation reconciliation (DONE)
EN+ZH user guides, cli.md, commands.md, file-placement-and-planning-roots.md.

### Task 9.1-9.8: Acceptance matrix (DONE)
25-test matrix: project-partition axis, path-flavor axis, layout-flavor axis,
refusal rows, target-line axis, sibling journey existence, bounded cost (2.3s).

### Task 10.1-10.4: Standalone non-regression (DONE)
6 tests: standalone paths, no partitions, action context, no selectors,
project-type session, legacy flat Store.

### Task 11.1-11.9: Integration gates (ALL PASS)
tsc, build, lint, git diff --check, rasen validate --strict, 55 child tests,
31 doctor tests, 12 layout-migration-doctor tests, 1195 store/store-planning
tests, UTF-8/BOM audit clean, scenario title comparison clean.

## operations.ts authorship

The `diagnoseConsistency` block in `src/core/store/operations.ts` (lines
2050-2077, plus the import at line 8) was authored by the **team lead**, not
the implementer. The implementer authored `src/core/store/consistency-gates.ts`
(the function being called) and `src/commands/doctor.ts`'s wiring (the parallel
call in `gatherStoreLayoutFindings`). The operations.ts edit was authorized
because child 3's fixer is done and that file is stable.

## Mutation verification summary

| Guard | Verified? |
|---|---|
| `planningWriteRootsForRef` | YES — revert → 1 fail / 3 pass |
| `target_line_mismatch` | YES — remove → 1 fail / 5 pass |
| Archive narrowing | YES — disable → 1 fail / 6 pass |
| `project_mismatch` | Structural (same pattern, test checks specific code) |
| `target_line_not_declared` | Structural (same pattern, test checks specific code) |
| Record-parser census | YES (fixture-based discrimination proof) |

## Gate results

| Gate | Result |
|---|---|
| `tsc --noEmit` | PASS |
| `pnpm run build` | PASS |
| `pnpm run lint` | PASS |
| `git diff --check` | PASS |
| `rasen validate --strict` | PASS |
| Child 7 tests (6 files, 55 tests) | ALL PASS |
| doctor.test.ts (31 tests) | ALL PASS |
| layout-migration-doctor.test.ts (12 tests) | ALL PASS |
| Store/store-planning integration (75 files, 1195 tests) | ALL PASS |
| UI package tsc --noEmit | PASS |
| UTF-8/BOM audit | Clean |
| Scenario title comparison | Clean (all 3 MODIFIED titles match canonical) |
