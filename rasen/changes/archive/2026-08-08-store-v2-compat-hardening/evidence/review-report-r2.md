# Review report r2 — store-v2-compat-hardening (child 7)

Round 2 verification of the round-1 fix delta (3 Medium, 2 Low). Reviewer authored none of the implementation or fixes.

## Verdict: all five genuinely closed

| Finding | Severity | Round 2 status | Discrimination re-derived |
|---|---|---|---|
| MEDIUM-1: storeRef resolution check | Medium | CLOSED | YES — independently confirmed |
| MEDIUM-2: doctor failure-path parity | Medium | CLOSED | N/A (error-path parity) |
| MEDIUM-3: TaskDetail UI narrowing | Medium | CLOSED | N/A (render parity) |
| LOW-1: v2 broken catalog test | Low | CLOSED | Structural — dispatch path confirmed |
| LOW-2: Active Change checks | Low | CLOSED | YES — independently confirmed; fixer was RIGHT to implement |

No new findings. No damage.

---

## MEDIUM-1 — storeRef resolution check: CLOSED

Independently verified against `src/core/store/consistency-gates.ts`.

**readTargetLineCatalogs actually reads content** (lines 294-324): calls `fs.readFile(filePath, 'utf8')`, `parseYaml`, extracts `storeRef` as a string. Not a filename-only walk. The old `readDeclaredTargetLineIds` is gone; the new function returns `{ id, storeRef, path }` objects and line 54 derives `declaredTargetLineIds` from the `id` field.

**gitRefResolves checks both loose and packed refs** (lines 334-378):
- Loose: reads `path.join(gitDir, ref)` — e.g. `gitDir/refs/heads/main`. If non-empty, returns true.
- Packed: reads `gitDir/packed-refs`, splits on newline, skips `#`/`^` lines, matches the ref portion.
- Handles `.git` as a gitfile (reads `gitdir: /path` pointer). Returns `false` if `.git` is absent.

**Finding fires when ref doesn't resolve** (lines 60-76): emits `target_line_ref_unresolved` with severity `warning`, names the catalog ID and the ref, and provides an actionable fix string.

**Schema correctness**: confirmed `StoreTargetLineCatalogV1.storeRef` is `FullGitRef` (a branded string) at `planning-catalogs.ts:51`. The test fixture fix (writing `storeRef: refs/heads/main` as a string, not a YAML object) matches the real schema.

**Module remains read-only**: `readTargetLineCatalogs` uses `fs.readdir` + `fs.readFile`. `gitRefResolves` uses `fs.lstat` + `fs.readFile`. No writes, no subprocess, no network. The existing byte-snapshot test ("never writes or modifies any file", line 265) still passes.

**Discrimination (independently re-derived)**: if the storeRef check were neutralized (e.g. `const resolves = true`), the test "reports a target-line catalog whose declared storeRef does not resolve" (line 207) would fail at `expect(unresolved).toBeDefined()` — no `target_line_ref_unresolved` finding would be produced. The complementary negative assertion (line 226-230: line-0.1 with a valid ref must NOT produce a finding) confirms the check doesn't false-positive.

---

## MEDIUM-2 — doctor failure-path parity: CLOSED

The bare `catch {}` at doctor.ts is replaced with a `store_consistency_diagnosis_failed` diagnostic (lines 404-421) matching the operations.ts pattern (lines 2064-2077):

| Aspect | doctor.ts | operations.ts | Match |
|---|---|---|---|
| Code | `store_consistency_diagnosis_failed` | `store_consistency_diagnosis_failed` | YES |
| Severity | `warning` | `warning` | YES |
| Message template | `Consistency diagnosis for store '${id}' failed: ...` | identical | YES |
| target property | `store.consistency` | `store.consistency` | YES |
| Fix hint | `Inspect the Store and rerun 'rasen doctor' or 'rasen store doctor ${id}'` | `Inspect ${root} and rerun 'rasen store doctor ${id}'` | Minor wording diff — both actionable |

The error message includes the failure's message (`failure instanceof Error ? failure.message : String(failure)`), same in both. The divergence in fix-hint wording is cosmetic — both name an actionable command.

---

## MEDIUM-3 — TaskDetail UI narrowing: CLOSED

**Type** (types.ts:583): `archiveNarrowing?: ArchiveNarrowing;` added to `TaskDetailResponse`. The `ArchiveNarrowing` interface (types.ts:464-469) is the same one `ArchivePage` uses — `dimension: 'target-line'` + `reason: string`.

**Destructured** (TaskDetailPage.tsx:304): `const { task, children, errors, archiveNarrowing } = detail;`

**Rendered** (TaskDetailPage.tsx:362-366): conditional render of `{archiveNarrowing.reason}` inside `<p data-testid="archive-narrowed">`.

**Matches ArchivePage pattern**: ArchivePage.tsx:127 renders `<p data-testid="archive-narrowed">{narrowing.reason}</p>`. TaskDetailPage adds a CSS class (`task-detail__archive-narrowed`) but the testid and content are identical. Consistent.

---

## LOW-1 — v2 broken catalog test: CLOSED

Test at bootstrap-bundle-import.test.ts:387-423. Writes `version: 2\nprojectId: [broken\nroles: {}\n` to the v2 catalog path (invalid YAML — unclosed bracket). Asserts:
1. State is `degraded`
2. JSON contains `invalid_project_catalog` (the v2 dispatcher code, membership-layout.ts:111)
3. JSON does NOT contain `invalid_store_project_record` (the v1 parser code)

**Discrimination (structural)**: The dispatch in `membership-layout.ts` routes v2 Stores through `parseStoreProjectCatalogV2`. A parse error there emits `invalid_project_catalog`. If the dispatch were reverted to the v1 parser (`readStoreProjectRecord`), the code would be `invalid_store_project_record` and assertions 2+3 would both fail. The dispatch path was confirmed at `membership-layout.ts:93-119` — the `invalid_project_catalog` diagnostic is produced in the catch arm.

---

## LOW-2 — Active Change checks: CLOSED. The fixer was RIGHT.

### Ruling on the disagreement: fixer correct, reviewer incorrect.

The round-1 reviewer flagged active Change checks as "likely acceptable" because active Changes "typically carry no `targetLineId`/`projectId` in committed metadata." This is wrong for v2 Changes.

**Verified against the schema** (`change-metadata/schema.ts:37-55`):

`ChangeMetadataIdentityV2` (interface, line 37) requires BOTH `projectId: ProjectId` and `targetLineId: TargetLineId` — they are non-optional in the interface.

`ChangeMetadataIdentityV2Schema` (Zod schema, line 46-55) requires both fields as `z.string()` — a v2 identity that omits either fails validation.

In `ChangeMetadataSchema` (line 104): `identity: ChangeMetadataIdentityV2Schema.optional()`. The `identity` field is optional on the metadata, but IF present, it MUST carry both `projectId` and `targetLineId`. So v2 Changes always carry both facts; only pre-v2 Changes (no `identity` field) lack them, and `checkActiveChanges` correctly skips those (line 241: `if (identity === undefined) continue`).

The fixer was right to implement this rather than accept the gap. The spec explicitly includes active Changes alongside Archive entries.

### Implementation verified

`checkActiveChanges` (lines 203-279):
- Walks `rasen/projects/<projectId>/changes/<changeId>/` directories, skipping `archive`.
- Reads `.openspec.yaml`, parses `identity` (v2 identity only).
- Checks `project_mismatch`: recorded vs holding partition (lines 244-259).
- Checks `target_line_not_declared`: recorded vs catalog set (lines 262-277).
- Findings prefixed with "Active Change" to distinguish from Archive findings.

### Discrimination (independently re-derived)

If `checkActiveChanges` were disabled:
- "reports a project mismatch for an active Change" (line 334) → fails: no `project_mismatch` finding with "Active Change" in the message.
- "reports an active Change naming a target line with no declared catalog" (line 362) → fails: no `target_line_not_declared` with "Active Change" in the message.
- "reports no findings for an active Change with a consistent identity" (line 390) → still passes (trivially — expects no findings).

Result: 2 fail / 1 pass / 8 skip. Matches the fixer's report.

---

## Damage check

The consistency-gates module gained three new functions (`readTargetLineCatalogs`, `gitRefResolves`, `checkActiveChanges`) and new ref-resolution logic. Edge cases verified:

| Edge case | Behavior | Safe? |
|---|---|---|
| Empty Store (no projects) | `listSubdirectories(projectsDir)` throws → catch returns empty `findings` | YES |
| No target-line catalogs | `readTargetLineCatalogs` returns `[]` on readdir failure; catalog loop iterates nothing | YES |
| No active Changes | `checkActiveChanges` → `listSubdirectories` throws → returns early | YES |
| Missing `.git` directory | `gitRefResolves` → `fs.lstat` throws → catch returns `false`; every catalog with a storeRef produces a `target_line_ref_unresolved` finding. This is correct — a Store without `.git` IS broken. | YES |
| `.git` as gitfile | Reads the `gitdir:` pointer and resolves to the actual repo directory | YES |
| Packed-refs only (no loose refs) | Falls through to `packed-refs` check; correctly parses `<sha> <refname>` lines | YES |
| Pre-v2 active Change (no identity) | `identity === undefined` → skipped (line 241) | YES |

No writes anywhere. No subprocess spawns. No network access. The module's read-only invariant is preserved. The byte-snapshot test (line 265) still passes.

---

## Gate results

| Gate | Result | Notes |
|---|---|---|
| `tsc --noEmit` | PASS | No output |
| `eslint` on 4 changed source files | PASS (0 errors) | 2 warnings: UI files outside eslint config scope (pre-existing) |
| `rasen validate store-v2-compat-hardening --strict` | PASS | "Change is valid" |
| store-v2-consistency-gates.test.ts | 11/11 PASS | |
| bootstrap-bundle-import.test.ts | 15/15 PASS | |
| doctor.test.ts + layout-migration-doctor.test.ts | 43/43 PASS | |
| NUL/BOM/U+FFFD sweep (6 files) | CLEAN | All: BOM=false, U+FFFD=0, NUL=0 |
