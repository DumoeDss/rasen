# Read-caller inventory (re-derived against current tree)

Task 1.1: Re-run child 3's caller census verbatim against the CURRENT tree.
Line numbers in `proposal.md` and `design.md` are as of proposal time; `src/`
was being edited concurrently. This census trusts the re-run.

## Census 1: flat path helpers

```
grep -rn "specsDir(\|changesDir(\|inRepoArchiveDir(" src/ --include=*.ts
```

Results match `planning-path-source-guard.test.ts` EXPECTED_FLAT_HELPER_CALLS.
No new sites since child 3.

## Census 2: literal Store v2 segment arrays

```
grep -rn "\['rasen', 'projects'" src/ --include=*.ts
```

Confined to `src/core/store/planning-layout-v2.ts` (7 hits). No new sites.

## Census 3: direct planning joins

```
DIRECT_PLANNING_JOIN regex
```

Matches `planning-path-source-guard.test.ts` EXPECTED_DIRECT_JOINS.
New entries since proposal time:
- `src/core/store/consistency-gates.ts`: count 1, classification `scope-seam`.
  This is child 7's consistency-gates module; it reads project partitions.

## Census 4: single-layout record parser calls

```
grep -rn "readStoreProjectRecord(" src/ --include=*.ts
```

| File | Count | Classification | Reason |
|---|---|---|---|
| `membership-layout.ts` | 1 | layout-dispatcher | Calls v1 parser as the v1 arm of `readStoreMembership`. Correct dispatch. |
| `membership.ts` | 3 | legacy-write-path-adapter | Write-path state verification. For v2 Stores, writes route through `migration-ops-v2.ts`; these calls are only reached for legacy flat Stores. Reads (`resolveProjectMembership`, `listStoreMembers`) were migrated to `readStoreMembership` by child 3. |
| `migration-ops.ts` | 4 | migration-source-reader | Reads v1 records as migration source data. Correct for migration. |
| `project-records.ts` | 0 (definition) | ��� | Defines the function; not a call site. |

## Tasks 1.3/2.1/2.2: bootstrap.ts read sites — ALREADY FIXED

The team lead's guidance is confirmed: both `projectFirstBundleDeclarations`
(bootstrap.ts:1238) and `readUnreadableRecord` (bootstrap.ts:2685) now call
`readStoreMembership` from `membership-layout.ts`. Child 3's fixer migrated
these in round 2. The bootstrap comments at lines 1233-1235 and 2675-2678
document why layout dispatch is necessary. Tasks 2.1 and 2.2 are no-ops.

## Task 3.2: membership.ts classification — AMENDED

The team lead's guidance is confirmed: `membership.ts` is no longer a frozen
legacy adapter for reads. `resolveProjectMembership` (line 446) and
`listStoreMembership` (line 300) dispatch through `readStoreMembership` from
`membership-layout.ts`. The three remaining `readStoreProjectRecord` calls
(lines 846, 923, 939) are in the write path (upsert/verify state) and only
reached for legacy flat Stores. Classification: `legacy-write-path-adapter`.

## `parseArchivedRef` — already v2-aware

Child 5 made `parseArchivedRef` v2-aware. Dropped from scope per team lead.

## Doctor gap (§4) — ALREADY FIXED by child 3's fixer

The proposal described `rasen doctor` as not calling `diagnoseLayoutMigration`.
Child 3's fixer added `gatherStoreLayoutFindings` (doctor.ts:390) which calls
`diagnoseLayoutMigration` with proper `store_layout_diagnosis_failed` error
handling. Both `.catch(() => [])` patterns for layout diagnosis are gone. The
doctor comment at line 710-711 is now true — `rasen doctor` does aggregate the
same layout checks as `rasen store doctor`. Tasks 4.1-4.5 are no-ops.

The operations.ts `.catch(() => [])` for layout diagnosis (line 2027 in the
proposal) is also gone — replaced with `store_layout_diagnosis_failed` at
operations.ts:2030-2047.

## change-status-policy.ts defect (§7) — CONFIRMED REAL, FIXED

`planningDirectoriesOf(root)` at line 125 joins `root/rasen/specs` and
`root/rasen/changes`. `buildActionContext:225` feeds it
`session.planning.root` which for a Store v2 session is the Store checkout
root. Fixed by adding `planningWriteRootsForRef` which derives the project
partition path (`rasen/projects/<projectId>/specs` and `changes`) for Store
sessions with a `projectId`.

## Doctor narrowed-aggregation gap — CONFIRMED REAL, FIXED

`doctor.ts:712` still has `.catch(() => [])` for `diagnoseMigrationDrift`. This
is the OLDER detector (pointer/manifest drift), not the layout diagnosis. Task
4.6 says to keep `diagnoseMigrationDrift` reporting alongside, so this is
correct — the `.catch(() => [])` on `diagnoseMigrationDrift` is pre-existing
and intentional (migration drift is best-effort, never breaks doctor).

## Task 8.6: Docs left untouched (recorded decision)

`docs/concepts.md`, `docs/glossary.md`, `docs/team-workflow.md`, and their zh
twins are NOT stale. They describe the in-project layout the accepted design
explicitly preserves. Editing them would document Store mode as the default,
which it is not. This is the correct omission, not an oversight.

## Task 8.7: Locale strings — verified clean

`grep -n "rasen/changes\|rasen/specs\|rasen/design-docs" src/locales/*.json`
returns empty. No locale string needs reconciliation.

## Task 8.8: Documentation sweep — recorded

`grep -rn "rasen/changes/\|rasen/specs/" docs/` returns ~40 hits. All describe
the standalone/in-project layout (concepts.md, commands.md standalone sections,
artifact-workflow-guide.md, codex-workflow-integration.md, audit reports). None
describe the Store v2 layout incorrectly. The Store-specific references in
cli.md (lines 1713-1714, 2207) and commands.md (line 520) have been conditioned
with standalone/Store-v2 annotations.

