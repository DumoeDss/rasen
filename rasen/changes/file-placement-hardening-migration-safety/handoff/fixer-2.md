# Fixer handoff — review-cycle round 3

## Scope and role

- Role: fixer for the two remaining Round 2 path-identity findings.
- Evidence read:
  - `evidence/review-report.md`, Round 2 delta re-review.
  - `evidence/review-cycle-report.md`, Round 2 remaining findings.
- No run-state, archive-engine, Store-root routing, commit, push, ship, or
  archive operation was changed.
- This fixer authored the delta but does not certify it. A non-author reviewer
  must confirm the two resolutions.

## Fixes

1. **Explicit shared path-identity policy**
   - Added `src/core/path-identity.ts` with the semantic
     `PathIdentityFlavor = 'win32' | 'posix'`.
   - `NATIVE_PATH_IDENTITY_FLAVOR` derives directly from
     `process.platform === 'win32'`; it does not inspect `node:path` objects,
     separators, or delimiters.
   - `foldPathIdentity` and `pathIdentityEquals` centralize case folding:
     win32 is case-insensitive and POSIX remains case-sensitive.

2. **Cleaner production default**
   - `sourceManifestNameMatches`, recursive source-signal classification, and
     `cleanEphemera` now consume the explicit flavor.
   - Default calls use `NATIVE_PATH_IDENTITY_FLAVOR`; tests may pass `'win32'`
     or `'posix'` directly.
   - Added a Windows-only real production-default regression that calls
     `cleanEphemera(ephemeraDir)` with uppercase `PACKAGE.JSON`. It asserts the
     source signal aborts cleaning, the otherwise deletable state is reported
     preserved, and its bytes remain unchanged.
   - The existing cross-platform test now uses explicit semantic overrides and
     confirms POSIX does not case-fold the uppercase manifest.

3. **Scoped active/archive owner production default**
   - `archiveNameMatches` and `pathsEqualForPlatform` now accept the explicit
     flavor and default from `process.platform`.
   - `discoverChangeDirs`, `planWorkMigration`, and the compatibility wrapper
     carry an optional flavor override without inferring semantics from a path
     namespace object.
   - Added a Windows-only real production-default plan regression with on-disk
     `Foo` and `2026-07-31-Foo` for requested `foo`. It proves both owners are
     selected and then inspected.
   - The same test first uses the explicit POSIX override and proves both
     differently cased owners are filtered before either owner `lstat`.
   - Helper regressions now pass `'win32'` / `'posix'` rather than path objects.

## Verification

- `pnpm exec vitest run test/core/ephemera-cleaner.test.ts test/core/work-migration.test.ts`
  - PASS: 2 files, 88/88 tests.
- `pnpm exec vitest run test/core/archive-ephemera.test.ts test/core/archive-accounting.test.ts test/commands/work.test.ts`
  - PASS: 3 files, 20/20 tests.
- `pnpm lint`
  - PASS.
- `pnpm build`
  - PASS.
- `node dist/cli/index.js validate file-placement-hardening-migration-safety --json`
  - PASS: 1 change valid, 0 issues.
- `git diff --check`
  - PASS; only repository line-ending conversion warnings were emitted.
- The known-hanging full repository suite was intentionally not run.

## Remaining risks

- Native macOS/Linux filesystem execution remains the closure child's matrix
  gate. Explicit POSIX identity tests pass on Windows but do not replace those
  native runs.
- The previously observed full-suite hang remains open and is not represented
  as a pass.
- The unchanged, documented pathname deletion syscall boundary from fixer
  round 1 remains a platform limitation; this narrow fix does not alter
  destructive-action sequencing.

## Eliminated hypotheses

- **The ESM `node:path` namespace is identity-equivalent to the active
  implementation (`path.win32` or `path.posix`):** eliminated by the Round 2
  runtime evidence; semantic identity must not be inferred from object
  equality.
- **An explicit `path.win32` helper test proves the production default:**
  eliminated because the broken default passed a different namespace object.
  Regressions must call the actual default entry point on Windows.
- **A separator or delimiter can safely identify case policy:** eliminated
  because syntax and filesystem identity are distinct policies, and the
  dispatch explicitly prohibits that proxy.
- **Filter-before-`lstat` is complete without native case identity:** eliminated
  because a safely ordered filter can still omit the requested Windows owner.
- **POSIX can share Windows folding for convenience:** eliminated because
  differently cased names remain distinct POSIX identities.

## Durable findings

- Filesystem case identity is semantic configuration, not a property inferred
  from an imported module object's identity.
- Production-default regressions must invoke the default API path; explicit
  override tests alone cannot validate default selection.
- Ownership filtering needs both correct ordering and the correct native
  identity policy before any filesystem inspection.
