# Review report — store-v2-compat-hardening (child 7)

Independent review. Reviewer authored none of the implementation.

## Finding count by severity

| Severity | Count |
|---|---|
| Critical | 0 |
| Major | 0 |
| Medium | 3 |
| Low | 2 |
| Info | 0 |

## Top findings (one line each)

1. **MEDIUM** — `consistency-gates.ts` does not check whether a target-line catalog's `storeRef` resolves; spec and task 5.4 explicitly require this check.
2. **MEDIUM** — Consistency diagnosis failure is silently swallowed in `rasen doctor` (doctor.ts:401-407) but reported as `store_consistency_diagnosis_failed` in `rasen store doctor` (operations.ts:2064-2077); the two doctors diverge on the failure path.
3. **MEDIUM** — Task-detail narrowing is computed, serialized by the router as `archiveNarrowing`, but the UI `TaskDetailResponse` type does not declare the field and `TaskDetailPage.tsx` does not render it; the data is silently dropped on the UI side.
4. **LOW** — v2 broken catalog state (task 2.3 four-state) is not explicitly tested; dispatch logic is structurally correct but unverified for this state.
5. **LOW** — Consistency gates walk Archive entries only, not active Changes; spec mentions both, but active Changes typically carry no `targetLineId`/`projectId` in committed metadata, so the gap is likely acceptable.

## Detailed findings

### MEDIUM-1: Missing storeRef resolution check (task 5.4)

**File:** `src/core/store/consistency-gates.ts:165-177`

The spec requirement states: "Doctor SHALL report ... a target-line catalog whose declared Store ref does not resolve." Task 5.4 marks this as done. The design (Decision 2) says this check "comes free from the same walk."

The implementation does not perform it. `readDeclaredTargetLineIds` reads only the filenames from `.rasen-store/target-lines/*.yaml` — it never reads catalog content and never checks whether the catalog's `storeRef` points to a resolvable Git ref. A target-line catalog with a dangling `storeRef` would pass all checks undetected.

**Failure scenario:** An operator creates a target-line catalog pointing to `refs/heads/release/0.3`, then deletes that branch. `rasen doctor` and `rasen store doctor` both report the Store as healthy. The first operation that tries to use the target line for integration fails at runtime.

**Fix:** Read each catalog YAML, extract `storeRef`, and verify the ref exists (e.g., `git rev-parse --verify <ref>` in the Store root, or check `.git/refs/`). Report as a new finding code (e.g., `target_line_ref_unresolvable`).

### MEDIUM-2: Consistency diagnosis error asymmetry between the two doctors

**File:** `src/commands/doctor.ts:401-407` vs `src/core/store/operations.ts:2056-2078`

`rasen store doctor` catches consistency diagnosis failure and emits a `store_consistency_diagnosis_failed` finding. `rasen doctor` catches the same failure and silently drops it:

```typescript
// doctor.ts:401-407
try {
  const { diagnoseConsistency } = await import('../core/store/consistency-gates.js');
  consistency = await diagnoseConsistency(target);
} catch {
  // Consistency checks are additive — a failure here does not suppress
  // the layout findings already collected.
}
```

The layout diagnosis already has correct parity (both doctors report `store_layout_diagnosis_failed`). The consistency diagnosis does not. The spec scenario "An undiagnosable Store is not a healthy one" and the parity requirement "neither SHALL report a finding the other omits" both apply to the full finding set, not just layout findings.

**Failure scenario:** A file-system permission error causes `diagnoseConsistency` to throw. `rasen store doctor` reports `store_consistency_diagnosis_failed`; `rasen doctor` reports nothing. A CI gate running `rasen doctor --json` passes while `rasen store doctor --json` fails.

**Fix:** Replace the bare `catch` in doctor.ts with a `makeStoreDiagnostic('warning', 'store_consistency_diagnosis_failed', ...)` call, matching the operations.ts pattern.

### MEDIUM-3: Task-detail narrowing not propagated to UI types or rendered

**Files:** `packages/ui/src/api/types.ts:578-582`, `packages/ui/src/components/TaskDetailPage.tsx`

`handleTaskDetail` computes the narrowing field (task-detail.ts:239-247) and the router serializes it as `archiveNarrowing` (router.ts:1232). But:

- The UI `TaskDetailResponse` type (`types.ts:578-582`) declares only `task`, `children`, and `errors` — no `archiveNarrowing` field.
- `TaskDetailPage.tsx` does not read or render any narrowing field.

The ArchivePage handles narrowing correctly (`data-testid="archive-narrowed"`). Task 6.2 says "Apply the same treatment in `task-detail.ts`" and task 6.3 says "Carry the narrowing through the wire type and mirror it by hand into `packages/ui/src/api/types.ts`." The API side is done; the UI mirror and rendering are not.

**Failure scenario:** A user views the task-detail page for a Store v2 project scope with no resolved target line. The archived children list is partial (machine-home union only). The page renders no narrowing notice — the user sees fewer archived children than expected and does not know why.

**Fix:** Add `archiveNarrowing?: ArchiveNarrowing` to the UI `TaskDetailResponse` type and render it in `TaskDetailPage.tsx` the same way `ArchivePage.tsx` does.

### LOW-1: v2 broken catalog state not explicitly tested (task 2.3)

**File:** `test/core/store/bootstrap-bundle-import.test.ts`

Task 2.3 requires proving each of four states reports as itself: v1 healthy, v1 broken, v2 healthy, v2 broken. The bootstrap-bundle tests cover:
- v1 healthy: line 671 (writes valid v1 record, reads successfully)
- v1 broken: line 634 (writes `version: [invalid\n`, degrades)
- v2 healthy: line 338 (writes valid v2 catalog, bundle survives, membership confirmed)
- v2 broken: **not tested**

The dispatch logic in `membership-layout.ts:93-119` handles v2 broken correctly: `parseStoreProjectCatalogV2` throws, diagnostics are returned, and `readUnreadableRecord` returns `{ path, diagnostics }`. The code path is structurally sound — it exercises the same catch arm as v1 broken. But no behavioral test confirms a broken v2 catalog produces `invalid_project_catalog` diagnostics and does NOT produce `invalid_store_project_record`.

### LOW-2: Consistency gates walk Archive entries only

**File:** `src/core/store/consistency-gates.ts:60`

The walk starts at `rasen/projects/<projectId>/changes/archive/` and never inspects active Changes under `rasen/projects/<projectId>/changes/<changeId>/`. The spec says "an Archive entry or active Change whose recorded project disagrees." Active Changes in the Store v2 layout do not carry `targetLineId` (archived-only) and do not record `projectId` in committed metadata (it is implicit in the partition). So the gap is likely acceptable — there are no recorded facts to disagree with.

## Guard discrimination table

| Guard | What it checks | Discriminates? | Evidence |
|---|---|---|---|
| `planningWriteRootsForRef` (§7) | Store v2 grants partition paths; standalone/legacy/aggregate grant root paths | YES | Mutation-verified (revert to 1 fail / 3 pass). Acceptance matrix asserts partition paths present, root-level paths absent, two projects distinct. |
| `target_line_mismatch` (§5.2) | Recorded target line disagrees with holding partition | YES | Mutation-verified (remove to 1 fail / 5 pass). Test writes mismatched entry and asserts both values named. |
| `project_mismatch` (§5.3) | Recorded project disagrees with holding partition | Structural | Same code pattern as target_line_mismatch. Test asserts specific code and both values named. |
| `target_line_not_declared` (§5.4) | Entry naming undeclared target line | Structural | Same pattern. Test writes undeclared line and asserts finding. **Note:** the storeRef half of 5.4 is unimplemented (MEDIUM-1). |
| Record-parser census (§3) | Every `readStoreProjectRecord` call enumerated by file and count | YES | Fixture-based discrimination proof: regex catches unclassified calls, skips function definitions and imports. |
| Archive narrowing (§6) | Store v2 project scope with no target line reports narrowing | YES | Mutation-verified (disable to 1 fail / 6 pass). ArchivePage renders `data-testid="archive-narrowed"`. **Note:** TaskDetailPage does not render it (MEDIUM-3). |

## Verdict on the 2 genuinely uncovered tasks

**§5.10 (fixtures hand-written, not built through finalization CLI):** Acceptable. The fixtures in `store-v2-consistency-gates.test.ts:43-82` construct `archive.json` with the correct v2 schema fields (`schemaVersion`, `outcome`, `changeInstanceId`, etc.). If child 5's record shape shifts, the `JSON.parse` at line 114 would still succeed (it reads only `projectId`/`targetLineId`), but the fixture would need updating to match the new shape. The gap is one of maintenance burden, not correctness — the consistency checks don't validate the full record, only the identity fields.

**§10.5 (non-regression compared against current behavior, not recorded pre-v2 output):** Acceptable. The standalone non-regression tests (`standalone-non-regression.test.ts`) assert specific properties: planning locations are in-project, no project partitions created, action context grants in-project directories, v1 compatibility projection, no project selector required. These are property assertions that would fail if standalone behavior changed, not comparisons against a recorded baseline. A recorded baseline would be stronger evidence but is not necessary — the properties are specific enough to catch a regression.

## Verdict on the 8 amended tasks

**§2.3 (readUnreadableRecord four-state):** Three of four states are tested. v2 broken is missing (LOW-1). The structural argument is sound — the dispatch in `membership-layout.ts` handles all states through the same code paths. Acceptable.

**§2.4 (declarationPath preservation):** `readStoreMembership` returns `filePath` from `getStoreProjectRecordPath`, and `readUnreadableRecord` uses `read.filePath` (bootstrap.ts:2687). Correct by construction. Acceptable.

**§2.5 (no writes on read):** `readUnreadableRecord` is a pure read. The bootstrap-bundle test "Store-only declarations remain unconfirmed" verifies no Store mutation. Acceptable.

**§2.6 (baseline inversion):** The test at bootstrap-bundle-import.test.ts:384 asserts `not.toContain('invalid_store_project_record')` for a v2 healthy catalog. This would fail if child 3's fix were reverted. Acceptable.

**§4.7 (doctor writes nothing):** `layout-migration-doctor.test.ts` has 12 tests including a "diagnoses without modifying" byte-assertion test. The consistency gates test also has a "never writes" byte-assertion test. Both pass. Acceptable.

**§4.8 (doctor.test.ts Store v2 cases):** `doctor.test.ts` still has no Store v2 case. The 12 `layout-migration-doctor.test.ts` tests exercise `doctorStores` (which calls both `diagnoseLayoutMigration` and `diagnoseConsistency`) with flat refs, mixed residue, orphan, relocated Archive, and interrupted run — all pass with no false positives. The structural coverage is adequate for the layout diagnosis. However, the consistency diagnosis error asymmetry (MEDIUM-2) means `rasen doctor --json` specifically is not verified for consistency findings. Acceptable with the caveat.

**§4.9 (parity test):** No explicit `rasen doctor --json` vs `rasen store doctor --json` parity test exists. Both call the same `diagnoseLayoutMigration` and `diagnoseConsistency` functions, so parity holds by construction on the success path. The failure path diverges (MEDIUM-2). Acceptable with the caveat.

**§10.6 (standalone grant path mutation):** `planningWriteRootsForRef` only branches on `ref.type === 'store' && ref.projectId !== undefined`, which is structurally impossible for a standalone session (no session) or a project-type session (`type === 'project'`). The standalone non-regression test verifies the correct behavior (in-project paths, no partition paths). Acceptable.

## Write-grant fix (§7) — verdict: CORRECT AND DISCRIMINATING

(a) **Store v2 sessions grant the partition path:** `planningWriteRootsForRef` (change-status-policy.ts:149-158) checks `ref.type === 'store' && ref.projectId !== undefined` and returns `[root/rasen/projects/<id>/specs, root/rasen/projects/<id>/changes]`. Verified by acceptance matrix test (store-v2-acceptance-matrix.test.ts:172-186).

(b) **Standalone/legacy grants are byte-identical:** `planningWriteRootsForRef` falls through to `planningDirectoriesOf(ref.root)` for non-Store-project refs, which returns `[root/rasen/specs, root/rasen/changes]`. Standalone uses `planningDirectoriesOf(planningRoot)` directly (no session). Verified by standalone-non-regression.test.ts:55-73 and acceptance matrix:161-170.

(c) **The guard discriminates:** The acceptance matrix test at line 181 asserts `ctx.planningWriteRoots.some((p) => p.includes('projects'))` and lines 184-185 assert the root-level paths are absent. Reverting `planningWriteRootsForRef` to `planningDirectoriesOf` would cause both to fail.

The partition paths match `resolveStorePlanningLayoutV2Path` for `kind: 'project-specs'` (`['rasen', 'projects', projectId, 'specs']`) and the parent of `kind: 'active-change'` (`['rasen', 'projects', projectId, 'changes', changeId]`). The scope-derived form (`buildResolvedPlanningActionContext`) and the action-context form (`buildActionContext`) now agree.

## operations.ts block (lead-authored) — verdict: well-formed

The `diagnoseConsistency` block at operations.ts:2050-2078 matches the shape of the existing `diagnoseLayoutMigration` call (operations.ts:2020-2048):
- Same conditional spread for `storeUid`
- Same try/catch with `makeStoreDiagnostic`
- Same error formatting
- Distinct finding code (`store_consistency_diagnosis_failed` vs `store_layout_diagnosis_failed`)
- Proper error reporting instead of `.catch(() => [])`

The import at operations.ts:7 is correct. The block is placed inside the `for (const store of inspected)` loop, after the layout diagnosis, gated by the same `store.type !== 'store'` and `!store.openspecRoot.healthy` guards.

## No-op amendments — verdict: all genuine

Each no-op was verified against the current tree:
- Tasks 2.1, 2.2: `bootstrap.ts` sites confirmed calling `readStoreMembership` (lines 1238, 2685). Census confirms no unclassified `readStoreProjectRecord` calls.
- Tasks 3.2: `membership.ts` confirmed 3 `readStoreProjectRecord` calls in write path only; reads dispatch through `readStoreMembership`.
- Tasks 4.1-4.5: `gatherStoreLayoutFindings` (doctor.ts:390) confirmed calling `diagnoseLayoutMigration` with proper error handling. Layout section conditional on Store resolution. Comment at doctor.ts:722 now accurate.

## Gate results

| Gate | Result | Failing files |
|---|---|---|
| `tsc --noEmit` | PASS | (none) |
| `pnpm run build` | PASS | (not independently run; dist matched sources) |
| `rasen validate --strict` | PASS | — |
| `git diff --check` | PASS (CRLF warnings only) | — |
| NUL/BOM/U+FFFD sweep | CLEAN for child 7 files | Pre-existing U+FFFD in `layout-migration/apply.ts`, `locales/ja.json`, `locales/zh-cn.json`, `layout-migration-catalog-receipt.test.ts`; BOM in `skill-templates-parity.test.ts` |
| Child 7 tests (4 files, 44 tests) | ALL PASS | — |
| doctor.test.ts (31 tests) | ALL PASS | — |
| layout-migration-doctor.test.ts (12 tests) | ALL PASS | — |
| bootstrap-bundle-import.test.ts (14 tests) | ALL PASS | — |
| management-api (40 files, 500 tests) | ALL PASS | — |
| store/store-planning (75 files, 1196 tests) | ALL PASS | — |

## Environmental failures (never reported)

`config.test.ts` (1) and `config-editor.test.ts` (4) — known environmental, excluded.

## Consistency gates design match (§9.2)

The module matches the design:
- Read-only: confirmed (only `fs.readdir` and `fs.readFile`, no writes)
- Names both disagreeing values: confirmed (target_line_mismatch names recorded and holding; project_mismatch names recorded and partition)
- Never repairs: confirmed (byte-identical assertion test passes)
- Does not synthesize facts: confirmed (no outcome/targetLine/project/workspacePair is inferred)
- Walks partitions: confirmed (project partitions, archive partitions, archive entries)
- One exception: the storeRef resolution check (MEDIUM-1) is specified but not implemented

## Documentation reconciliation (§8)

Not independently verified in this review (lower priority). The implementation report claims EN+ZH user guides, cli.md, commands.md, and file-placement-and-planning-roots.md were corrected. The locale string grep was confirmed clean in the read-caller inventory.
