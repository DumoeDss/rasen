# Fix report r1 — store-v2-compat-hardening (child 7)

Fixer: independent agent (did not author implementation or review).

## Findings summary

| Finding | Severity | Status | Discriminated |
|---|---|---|---|
| MEDIUM-1: Missing storeRef resolution check (task 5.4) | Medium | FIXED | YES (revert 1 fail / 10 skip) |
| MEDIUM-2: Consistency diagnosis error asymmetry (doctor.ts) | Medium | FIXED (by lead) | N/A |
| MEDIUM-3: Task-detail narrowing not in UI types/render | Medium | FIXED (by lead) | N/A |
| LOW-1: v2 broken catalog state not tested (task 2.3) | Low | FIXED | Structural (asserts specific diagnostic code) |
| LOW-2: Consistency gates walk Archive entries only | Low | FIXED (not acceptable — implemented) | YES (revert 2 fail / 1 pass / 8 skip) |

## MEDIUM-1 — storeRef resolution check

**File:** `src/core/store/consistency-gates.ts`

The module read only filenames from `.rasen-store/target-lines/*.yaml` and never read catalog content. Task 5.4 and the spec both require: "a target-line catalog whose declared Store ref does not resolve."

**Implementation:**
- Added `readTargetLineCatalogs()` which reads each catalog YAML content, parses it, and extracts the `storeRef` field. Replaces the old `readDeclaredTargetLineIds()` which only read filenames.
- Added `gitRefResolves()` — a filesystem-based ref resolution check that looks for the ref in loose refs (`.git/refs/heads/main`) and packed refs (`.git/packed-refs`). Handles gitfile pointer (`.git` as a file). Read-only, no subprocess.
- In `diagnoseConsistency()`, after reading catalogs, each catalog's `storeRef` is resolved. If it doesn't resolve, a `target_line_ref_unresolved` finding is emitted naming the catalog ID, the ref, and the path.
- The module remains purely read-only — `gitRefResolves` uses only `fs.readFile`, no network, no subprocess.

**Test fixture fix:** The existing `writeTargetLineCatalog` test helper wrote `storeRef` as a YAML object (`storeRef:\n  ref: ...\n  repo: ...`), which does not match the real `StoreTargetLineCatalogV1` schema (`storeRef` is a plain string). Fixed to write `storeRef: refs/heads/main` as a string. Added `setupGitRef` helper to create `.git/refs/heads/main` so existing tests pass.

**Discrimination:** Mutated `const resolves = true` (skipping the check). Test "reports a target-line catalog whose declared storeRef does not resolve" failed: `expected undefined to be defined`. Restored: all 11 green.

## LOW-1 — v2 broken catalog state test

**File:** `test/core/store/bootstrap-bundle-import.test.ts`

Task 2.3 requires proving each of four states: v1 healthy, v1 broken, v2 healthy, v2 broken. The v2 broken state was not tested.

**Implementation:** Added test "a broken v2 project catalog degrades and reports invalid_project_catalog, not invalid_store_project_record." Writes invalid content (`version: 2\nprojectId: [broken\n`) directly to the v2 catalog path. Asserts the report:
1. Is degraded
2. Contains `invalid_project_catalog` (the v2 dispatcher code)
3. Does NOT contain `invalid_store_project_record` (the v1-era code)

**Discrimination:** Structural. The v2 dispatcher in `membership-layout.ts:93-119` catches the parse error and emits `invalid_project_catalog`. If the dispatcher were reverted to `readStoreProjectRecord` (v1 parser), the diagnostic code would be `invalid_store_project_record`. The test asserts the specific code, so it discriminates.

## LOW-2 — Active Change consistency checks

**File:** `src/core/store/consistency-gates.ts`

The spec says: "an Archive entry or active Change whose recorded project disagrees" and "a Change or Archive entry naming a target line." The implementation walked Archive entries only. The reviewer said active Changes carry no `targetLineId`/`projectId`.

**Assessment: NOT acceptable.** Active Changes carry a v2 identity in `.openspec.yaml` that includes both `projectId` and `targetLineId` (`ChangeMetadataIdentityV2Schema` at `change-metadata/schema.ts:46-55`). The spec explicitly names active Changes alongside Archive entries.

**Implementation:** Added `checkActiveChanges()` function that:
1. Walks `rasen/projects/<projectId>/changes/<changeId>/` directories (skipping `archive`)
2. Reads each Change's `.openspec.yaml`
3. Parses the optional `identity` object (v2 identity)
4. Checks `project_mismatch` (recorded vs holding partition) and `target_line_not_declared` (recorded vs catalog set)
5. Findings prefix with "Active Change" to distinguish from Archive findings

Added 3 tests: project mismatch, undeclared target line, and consistent identity (no findings).

**Discrimination:** Disabled `checkActiveChanges()` call entirely. Both active Change tests failed (project mismatch and undeclared target line); consistent-identity test passed. 2 fail / 1 pass / 8 skip. Restored: all 11 green.

## Gate results

| Gate | Result | Notes |
|---|---|---|
| `tsc --noEmit` | PASS | |
| `pnpm run build` | PASS | |
| `git diff --check` | PASS (CRLF warnings only) | Standard autocrlf noise |
| NUL/BOM/U+FFFD sweep | CLEAN | All 3 changed files byte-swept |
| Child 7 consistency gates (11 tests) | ALL PASS | |
| Child 7 bootstrap-bundle-import (15 tests) | ALL PASS | |
| doctor.test.ts (31 tests) | ALL PASS | |
| layout-migration-doctor.test.ts (12 tests) | ALL PASS | |
| store-v2-acceptance-matrix + standalone-non-regression + planning-path-source-guard (25 tests) | ALL PASS | |
| UI tsc --noEmit | PASS | (MEDIUM-3 lead fix compiles) |
| `rasen validate store-v2-compat-hardening --strict` | PASS | |
| Broad store/ + management-api/ | Running in background | Specific affected suites all pass |

## Environmental failures (never reported)

`config.test.ts` (1) and `config-editor.test.ts` (4) — known environmental, excluded.

## Notes for the shipper

1. **Test fixture format fix:** `writeTargetLineCatalog` in `store-v2-consistency-gates.test.ts` now writes `storeRef` as a plain string (matching the real schema), not as a YAML object. The old format was incorrect but undetectable because the code only read filenames.

2. **New finding codes:** `target_line_ref_unresolved` (from catalog storeRef check) is a new code produced by `diagnoseConsistency`. Both `rasen doctor` and `rasen store doctor` will now surface this code. The code matches the existing error code used by `resolveLocator` in `target-lines.ts`.

3. **Active Change walk is additive:** The `checkActiveChanges` function reads `.openspec.yaml` from active Change directories. It only checks Changes with a v2 `identity` field; pre-v2 Changes (no identity) are skipped. No false positives on consistent Stores.

4. **LOW-2 resolved as NOT acceptable → implemented:** The reviewer flagged this as "likely acceptable." Active Changes DO carry `projectId` and `targetLineId` in their v2 identity, and the spec explicitly includes them. Implemented rather than amended.
