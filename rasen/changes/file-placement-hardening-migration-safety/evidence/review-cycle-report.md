# Review-cycle report - file-placement-hardening-migration-safety

- Branch: `fix/pr121-file-placement-hardening`
- Authoritative baseline: `04cea87ae5bea9af2d90f526455b6ea513cd57e8`
- Current diff fingerprint: `PENDING_LEAD_FINGERPRINT`
- Fingerprint ownership: the LEAD owns replacement in run-state; this reviewer did not compute or substitute it.
- Reviewer: `/root/migration_safety_reviewer`
- Fixer: `/root/migration_safety_fixer_r1`
- Non-author confirmation: confirmed. The Round 2 reviewer is not the fixer and performed report-only review.

## Cycle summary

| Round | Disposition | Severity at round end | Summary |
| --- | --- | --- | --- |
| 1 | FINDINGS | 2 Blocker, 2 Major, 1 Minor | Missing discard revalidation; incorrect Windows manifest identity; `specs/` traversal; ownership filtering after unrelated `lstat`; incomplete preserved projection on cleaner abort. |
| Fix 1 | Handoff supplied | N/A | `/root/migration_safety_fixer_r1` implemented the five requested corrections and supplied focused/integration/tooling evidence. |
| 2 | FINDINGS | 1 Blocker, 1 Major | Discard fingerprints, `specs/` pruning, aborted projection, and filter-before-`lstat` behavior are confirmed. ESM `node:path` namespace identity leaves default Windows manifest and scoped ownership matching case-sensitive. |
| Fix 2 | Handoff supplied | N/A | `/root/migration_safety_fixer_r1` replaced path-object identity inference with an explicit shared path-identity flavor and supplied production-default regressions. |
| 3 | CLEAN | 0 Blocker, 0 Major, 0 Minor, 0 Trivial | The two Round 2 findings are confirmed resolved; the explicit POSIX override and pre-`lstat` filtering behavior remain correct. |

## Original findings and final disposition

1. **Blocker - destructive discard source revalidation:** resolved. File and directory fingerprints are planned, serialized, recomputed, and compared before deletion; absent/error/drift paths do not discard the source.
2. **Blocker - Windows/POSIX manifest identity:** resolved in Round 3. Production defaults now derive explicit identity flavor from `process.platform`; Windows folds listed manifest names and the POSIX override remains case-sensitive.
3. **Major - `specs/` subtree traversal:** resolved. The subtree is pruned before child inspection/recursion, with byte-preservation coverage supplied.
4. **Major - scoped ownership filtering after `lstat`:** resolved in Round 3. Filtering precedes per-entry `lstat`, and native Windows active/archive identity now uses the explicit case-insensitive flavor.
5. **Minor - aborted cleaner preserved projection:** resolved. Candidates are explicitly projected as preserved with `cleaning-aborted`.

## Round 2 remaining findings

### Blocker - default Windows manifest recognition is still case-sensitive

`src/core/ephemera-cleaner.ts:287-293` selects Windows folding by object identity. In ESM, the namespace imported by `import * as path` is not `path.win32`; default calls at `src/core/ephemera-cleaner.ts:315-319` and `src/core/ephemera-cleaner.ts:595-600` therefore miss differently cased manifests and can delete otherwise eligible ephemera instead of aborting.

### Major - default Windows scoped owner matching is still case-sensitive

`src/core/work-migration.ts:582-603` repeats the same identity test, and discovery passes namespace `path` at `src/core/work-migration.ts:626-650`. A request for `foo` can omit on-disk `Foo` or `2026-07-31-Foo` on Windows. The ordering fix prevents unrelated `lstat` blockers but does not restore native Windows owner identity.

## Test evidence supplied

- Round 2 focused cleaner/migration tests: **86/86 passed**.
- Affected integration tests: **20/20 passed**.
- `pnpm lint`: reported passing.
- `pnpm build`: reported passing.
- Change validation: reported passing.
- Full repository suite: not rerun after its prior no-summary hang.
- Native macOS/Linux filesystem matrix: not supplied.
- Reviewer-run tests: none, per report-only constraints.

## Round 2 disposition

**FINDINGS**

The cycle cannot close while the remaining Blocker and Major are open.

## Round 3 final re-review

- Fixer: `/root/migration_safety_fixer_r1`
- Confirmed by: `/root/migration_safety_reviewer`
- Non-author confirmation: confirmed; reviewer and fixer are distinct, and the reviewer remained report-only.
- Findings: none.

### Resolutions confirmed

1. Production-default Windows cleaner manifest identity now uses an explicit native flavor derived from `process.platform`; no ESM namespace comparison remains.
2. Production-default scoped active/archive owner identity uses the same explicit flavor before per-entry `lstat`.
3. Explicit POSIX override remains case-sensitive.
4. The helper does not infer identity from separators or delimiters, and all repository consumers use either the native default or a semantic flavor override.

### Final-round evidence supplied

- `pnpm exec vitest run test/core/ephemera-cleaner.test.ts test/core/work-migration.test.ts`: **88/88 passed**.
- `pnpm exec vitest run test/core/archive-ephemera.test.ts test/core/archive-accounting.test.ts test/commands/work.test.ts`: **20/20 passed**.
- `pnpm lint`: passed.
- `pnpm build`: passed.
- `node dist/cli/index.js validate file-placement-hardening-migration-safety --json`: passed.
- `git diff --check`: passed with line-ending conversion warnings only.
- Full repository suite: not rerun because of the known no-summary hang.
- Reviewer-run tests: none, per report-only constraints.

## Final disposition

**CLEAN**

All Round 1 and Round 2 findings are resolved and independently confirmed. No Blocker, Major, Minor, or Trivial finding remains in the configured three-round review surface.

## Durable findings

1. Platform identity must be represented explicitly; do not infer Windows/POSIX semantics by comparing an ESM `node:path` namespace object with `path.win32` or `path.posix`.
2. Every future destructive migration action must carry a serialized source fingerprint and fail closed when it is absent, unreadable, unstable, or mismatched.
3. Scope/protected-subtree filters must run before filesystem inspection or recursion.
4. The interactive work command still needs to apply the exact displayed `WorkMigrationPlan` instead of replanning after confirmation.
5. Archive output must surface cleaner source signals, blockers, completeness, and effective preserved paths.
6. The repository-wide test hang and native macOS/Linux filesystem matrix remain closure gates.
