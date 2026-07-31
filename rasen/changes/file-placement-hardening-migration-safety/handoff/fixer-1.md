# Fixer handoff — review-cycle round 1

## Scope and role

- Role: independent fixer for the five findings in `evidence/review-report.md`.
- Worktree: `OpenSpec-code-wt-pr121-review`.
- No run-state, Store-root routing, archive-engine behavior, commit, push, ship,
  or archive operation was changed.
- This handoff records authored fixes and test evidence only. A different
  reviewer must re-review the delta; this fixer does not self-certify it.

## Fixes

1. **Destructive migration source drift**
   - Added additive, serialized `sourceFingerprint` data to planned destructive
     actions.
   - File fingerprints bind filesystem identity (`dev`, `ino`, `mode`, size,
     mtime, and ctime) plus SHA-256 content.
   - Directory fingerprints bind the root identity plus a deterministic
     recursive tree hash containing every child path, type, identity, file
     content hash, and symlink target. Traversal verifies that directory child
     names and entry identities stay stable while the fingerprint is read.
   - `applyWorkMigration` recomputes the fingerprint immediately before
     `unlink`/recursive `rm`. Drift returns a non-discard `conflict` with
     `ESTALE`; inspection errors return `failed`; absence returns
     `already-absent`. A destructive action with no planned fingerprint fails
     closed.
   - Deterministic injected races cover a same-byte file replacement, a
     changed-byte file replacement, and a newly added directory child. Every
     test asserts surviving disk bytes and that the outcome is not
     `discarded`.

2. **Platform-native manifest identity**
   - Added explicit/injectable `path.win32` versus `path.posix` matching through
     `sourceManifestNameMatches` and the `classifyEphemera`/`cleanEphemera`
     path-flavor seam.
   - Manifest names are case-insensitive under win32 and case-sensitive under
     POSIX. A real-filesystem uppercase `PACKAGE.JSON` test exercises both
     semantics on the Windows host.

3. **Forbidden review-material subtree**
   - Added `specs/` to a directory-pruning set and skip it before per-child
     `lstat` or recursion.
   - A real-filesystem test places `review-report.md` and `ship-log.md` below a
     nested `specs/` tree, applies another valid migration action, and verifies
     the complete subtree hash and individual bytes are unchanged.

4. **Scoped ownership before inspection**
   - Active names and date-prefixed archive names are now matched against
     `--change` before per-entry `lstat` and work-directory scanning.
   - Active and archived tests inject each of `EACCES`, `EPERM`, and `EIO` for
     unrelated entries. The scoped plan stays complete, applies the owned
     action, contains no unrelated blocker, and preserves unrelated bytes.

5. **Effective preserved projection on cleaner abort**
   - Otherwise valid deletion candidates are projected into `preserved` and
     `preservedEntries` when the plan aborts, with explicit
     `cleaning-aborted` reason and the plan's abort detail.
   - `discarded` remains empty. Tests cover both the direct classification plan
     and `cleanEphemera` result while asserting original disk bytes.

## Verification

- `pnpm exec vitest run test/core/ephemera-cleaner.test.ts test/core/work-migration.test.ts`
  - PASS: 2 files, 86/86 tests.
- `pnpm exec vitest run test/core/archive-ephemera.test.ts test/core/archive-accounting.test.ts test/commands/work.test.ts`
  - PASS: 3 files, 20/20 tests.
- `pnpm lint`
  - PASS.
- `pnpm build`
  - PASS.
- `node dist/cli/index.js validate file-placement-hardening-migration-safety --json`
  - PASS: 1 change valid, 0 issues.
- `git diff --check`
  - PASS; output contained only repository line-ending conversion warnings.
- The known-hanging repository-wide suite was intentionally not re-run in this
  fix turn, per the dispatch brief.

## Remaining risks

- Actual macOS/Linux filesystem execution remains the closure child's matrix
  gate. The explicit win32/POSIX comparison tests pass on Windows, but they are
  not a substitute for native filesystem runs.
- Node exposes pathname-based deletion rather than an identity-conditioned
  unlink/rm primitive. Apply performs complete revalidation directly adjacent
  to deletion, but the irreducible syscall boundary is not a filesystem
  transaction or lock.
- The previously observed full-suite hang remains open and is not represented
  as a pass.
- `src/commands/work.ts` still belongs to the root-routing/closure owner for
  carrying the exact displayed plan into apply; this fixer did not expand into
  that surface.

## Eliminated hypotheses

- **Content hashing alone is sufficient for destructive files:** eliminated by
  the same-byte replacement case; filesystem identity must also match.
- **A directory root stat is sufficient:** eliminated by the new-child race; a
  recursive, content-bearing tree fingerprint is required.
- **Filtering scoped discoveries after collecting entries is harmless:**
  eliminated because per-entry `lstat` can fail before the ownership filter.
- **Ignoring report-shaped filenames is enough to protect specs:** eliminated
  because arbitrary nested names can match migration patterns; the subtree must
  be pruned before descent.
- **Lowercasing every manifest name is cross-platform-safe:** eliminated because
  it makes POSIX identity incorrectly case-insensitive.
- **An empty `discarded` array fully reports an aborted clean:** eliminated
  because valid candidates otherwise disappear from both public disposition
  projections despite being preserved on disk.

## Durable findings

- Any future destructive migration action must carry a planned source
  fingerprint; compatibility should be preserved by failing closed when older
  callers omit it, never by deleting without it.
- Ownership filters belong before all per-entry filesystem operations, and
  protected review-material directories belong in traversal pruning rather
  than filename classification.
- Case identity is a filesystem/platform policy and should remain injectable in
  tests instead of being inferred from the host under test.
