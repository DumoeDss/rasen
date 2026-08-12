# Review Cycle Round 1 — Fixer Handoff

## Scope

Implemented the three underlying reviewer findings. These changes are ready for independent re-review; this handoff does not self-certify resolution.

## STD/SPEC-001 — exact pre-change recovery manifest compatibility

Changed:

- `src/core/store/layout-migration/apply.ts:62-237`
  - Preserved the exact legacy manifest as a strict `version: 1` schema with no `runId` and no `operations`.
  - Assigned strengthened prepared-operation manifests explicit `version: 2`, with required `runId` and required `operations`.
  - Dispatches strictly on the explicit `version` value; it never infers a version from fields. Unknown versions and cross-version extra fields fail closed.
  - Retained Store-root path containment validation for both versions and run/operation ownership validation for v2.
- `src/core/store/layout-migration/apply.ts:274-373`
  - Recovery revalidation recognizes exact legacy-v1 `createdPaths` as already-published destinations, while v2 continues to use prepared operations. This makes genuine base resume reachable without weakening v2 no-clobber ownership.
- `src/core/store/layout-migration/apply.ts:894-1117`
  - Publication now accepts and returns only `PreparedRecoveryManifest` (v2), preventing new writes from accidentally emitting the legacy shape.
- `src/core/store/layout-migration/module.ts:268-327`
  - New runs emit `version: 2`.
- `src/core/store/layout-migration/module.ts:475-548`
  - A restarted legacy-v1 resume preserves base recovery behavior for existing evidence, then explicitly upgrades to v2 before new prepared operations are published.
- `src/core/store/layout-migration/index.ts:32-39`
  - Exports the explicit legacy/prepared manifest types.
- `test/core/store/layout-migration-apply-recovery.test.ts:1169-1233`
  - Added restart status/resume coverage using an exact base-shaped v1 object and strict rejection of v2-only fields under v1.
  - Added restart rollback coverage proving recorded paths are removed and preimages restored.

## STD/SPEC-002 — one effective coordination root

Changed:

- `src/core/store/layout-migration/module.ts:168-239`
  - `withPublicationLocks` now receives an explicit effective `globalDataDir` and acquires the generated-Issue batch from that exact root; Issue-batch-before-run-lock order is unchanged.
- `src/core/store/layout-migration/module.ts:332-472`
  - `status` and `recover` resolve one effective root at their public boundaries. Recovery uses it consistently for manifest load/write, immutable-plan load, generated-Issue batch acquisition, and resume/rollback persistence.
- `src/core/store/layout-migration/module.ts:475-548`
  - Resume writes the upgraded/current manifest through the same effective root.
- `test/core/store/layout-migration-apply-recovery.test.ts:1131-1167`
  - Added deterministic contention coverage where the restarted Module has no constructor root, recovery receives a custom per-call root, and an ordinary Issue lock in that root blocks resume. Releasing the same lock allows publication.

## STD/SPEC-003 — fail closed on active Change lookup errors

Changed:

- `src/core/archive.ts:283-321`
  - Exact active-Change lookup returns absent only for `ENOENT` or for a real stat that is non-directory/symlink; non-ENOENT `lstat` failures propagate before receipt lookup.
- `src/core/archive.ts:650-658,710-715`
  - Added a narrow injectable `lstat` dependency to `ArchiveCommand` for deterministic fault coverage; default behavior remains `fs.promises.lstat`.
- `test/commands/archive-legacy-coordinator.test.ts:224-269`
  - Added matching v2 receipt + real exact Change + injected `EACCES` lookup failure coverage. It asserts the operational error propagates and Store bytes remain unchanged.
  - Existing token-route conflict tests remain before root/change lookup in `ArchiveCommand.execute`, preserving their precedence.

## Verification commands and exact results

- `git diff --check`
  - **PASS** (exit 0, no output).
- `pnpm exec vitest run test/core/store/layout-migration-apply-recovery.test.ts test/commands/archive-legacy-coordinator.test.ts`
  - **NOT RUN**: execution required permission and was not approved by the harness.
- `pnpm run build`
  - **NOT RUN**: execution required permission and was not approved by the harness.
- `pnpm lint`
  - **NOT RUN**: not attempted after build/test commands were blocked by the same execution permission boundary.

## Remaining concerns / independent checks

1. Focused tests, build, and lint still need execution by the LEAD/reviewer because this leaf could not receive permission for package-script execution.
2. Independent review should specifically check TypeScript narrowing around the `RecoveryManifest` discriminated union and the injected overloaded `lstat` type.
3. Legacy-v1 rollback deliberately retains the exact base contract (`createdPaths` + `replacedFiles`) because old evidence has no operation digest/run ownership fields. New v2 manifests retain prepared-operation ownership and digest checks.
4. No `.rasen/**`, review report, run-state, fixture tree, or unrelated change artifact was edited.

## Concise re-review pointer

Review the fixer delta in:

- `src/core/store/layout-migration/apply.ts`
- `src/core/store/layout-migration/module.ts`
- `src/core/store/layout-migration/index.ts`
- `src/core/archive.ts`
- `test/core/store/layout-migration-apply-recovery.test.ts`
- `test/commands/archive-legacy-coordinator.test.ts`

The key claims to independently confirm are: strict version dispatch (v1 exact/v2 strengthened), one per-call recovery coordination root for both storage and Issue locks, and non-ENOENT exact-source lookup errors stopping receipt compatibility lookup.
