# Review Report — pr88-rf-validation (commit a245503a)

**Reviewer**: verify-stage agent (author != verifier)
**Date**: 2026-07-27
**Commit**: `a245503a` — "fix(validation): reject credential remotes before obtain, report backup debris degraded, normalize project identity at comparisons (PR#88 M9/M5/M10)"
**Verdict**: findings (0 Blocker, 0 Major, 3 Minor, 3 Trivial)

## Scope check

13 files — matches the expected set exactly:

| File | Category |
|---|---|
| `rasen/changes/pr88-rf-validation/specs/store-scoped-learned-skills/spec.md` | spec delta |
| `src/core/store/bootstrap.ts` | M9 |
| `src/core/store/git.ts` | M9 |
| `src/core/learned-skills/catalog.ts` | M5 |
| `src/core/learned-skills/effective.ts` | M5 |
| `src/core/learned-skills/resolve.ts` | M5 |
| `src/core/knowledge-bundle/import.ts` | M10 |
| `src/core/project-registry.ts` | M10 |
| `test/core/store/bootstrap-obtain.test.ts` | M9 test |
| `test/core/store/git-redaction.test.ts` | M9 test |
| `test/core/learned-skills/catalog-backup.test.ts` | M5 test |
| `test/core/knowledge-bundle/import.test.ts` | M10 test |
| `test/core/project-registry.test.ts` | M10 test |

No out-of-scope files. C1's staging/verify/publish logic, C2's lock code, C3's run-state/init/pipeline/portfolio-state, and C5's session-launch-context are untouched.

## Delta title check

PASS. Delta title `### Requirement: Mutating a Store's catalog preserves ownership and never leaves a half-written result` matches canonical `rasen/specs/store-scoped-learned-skills/spec.md:143` verbatim. The delta MODIFIED body preserves the original requirement body word-for-word and appends two coherent sentences about recoverable debris. The new scenario ("A read between the kill and the next mutation reports the catalog as degraded") is consistent with the existing scenarios.

## Verification gates

- `pnpm exec tsc --noEmit` — PASS (zero errors)
- Focused vitest (7 files): `bootstrap-obtain`, `git-redaction`, `catalog-backup`, `effective`, `import`, `export`, `project-registry` — **163 passed, 1 skipped, 0 failed**

## M9 assessment

**Correct.** `assertCredentialFreeRemote(remote, 'store.pointer')` is the FIRST statement inside `cloneWithCleanupGuard`'s try block (bootstrap.ts:1527), before `cloneRepository`. The thrown `StoreError` is caught by the existing catch, which pushes diagnostics via `diagnosticsFor` and returns `{ ok: false }`. `buildStagingPath` runs before the try but only computes a string — no directory is created, so the cleanup `fs.rmSync(stagingPath, { force: true })` is a no-op.

`assertCredentialFreeRemote` is REUSED from `src/core/store/remote.ts:57-72` — NOT duplicated.

`git.ts:181-182` defense-in-depth: `rawMessage.split(remote).join(redactRemote(remote))` replaces every occurrence of the raw remote in git's error output with the redacted form. `split`/`join` uses literal string matching (not regex), so special characters are safe. The `StoreError` is constructed with only `safeMessage` — stderr is never included.

Tests cover: https with userinfo, https with token-only userinfo, git+https with token, https with password-only, credential-free SSH (not rejected), credential-free https (not rejected), multi-declaration, and git error redaction defense-in-depth.

## M5 assessment

**Correct at the primary path.** `StoreCatalogRead` gains `recoverableBackups: string[]`. `readStoreCatalog` detects `LEARNED_SKILL_BACKUP_PREFIX` entries BEFORE the `isOsJunkEntryName` filter, collects them, and excludes them from `records`. Staging dirs (`LEARNED_SKILL_STAGING_PREFIX`) are NOT collected — they fall through to `isOsJunkEntryName`.

`effective.ts:596-612` switches to `readStoreCatalog`. When `recoverableBackups.length > 0`, the Store is pushed `status: 'unavailable'` with a diagnostic, and the loop `continue`s — NEVER `status: 'member'` with empty catalog. The `continue` correctly skips to the next store candidate without triggering the catch block.

`resolve.ts:71-73` fallback updated with `recoverableBackups: []` — compiles and handles the unresolved-store case.

`loadStoreCatalog` (catalog.ts:393) correctly discards the field — convenience wrapper stays backward-compatible.

**However** — the M5 invariant ("recoverable data treated as absent") is only enforced at the effective-materialization path. Two other read paths silently ignore `recoverableBackups` (see Minor 2 and Minor 3 below).

## M10 assessment

**Correct at the 5 identified comparison points.** All comparisons in `import.ts` (lines 1108, 1138-1140) and `project-registry.ts` (lines 338-339, 467-469, 549-550) now normalize both sides via `normalizeProjectIdentity`. The registry KEEPS the original string for display — only comparisons changed. `projectManifest` (import.ts:391) stamps `project.ref.projectId` onto the published manifest, so the verify check at import.ts:877 (`verified.record.manifest.owner.projectId !== store.projectId`) compares same-case values and is NOT affected.

Import paths verified: `../store/project-records.js` from `knowledge-bundle/import.ts`, `./store/project-records.js` from `project-registry.ts` — both correct, no circular deps (confirmed: `project-records.ts` does not import from either module).

---

## Findings

### Minor 1 — `place()` sibling-pruning uses strict comparison, inconsistent with normalized `sameIdEntries` filter

**File**: `src/core/project-registry.ts:323`
**Severity**: Minor

The `sameIdEntries` filter (line 337-339) now uses `normalizeProjectIdentity` to find case-different entries. But the `place()` function's internal sibling-pruning loop (line 323) still uses strict `!==`:

```typescript
if (projects[otherPath].projectId !== projectId) continue;
```

**Failure scenario**: Entry A at path1 has `projectId = 'AAAAAAAA-...'` (uppercase). Entry B at path2 has `projectId = 'aaaaaaaa-...'` (lowercase) — e.g., from a pre-fix registration. User registers path3 (a worktree of path1) with any case. The normalized `sameIdEntries` filter finds both A and B. `place()` is called with entry A's uppercase projectId. The pruning loop compares entry B's lowercase projectId against the uppercase `projectId` — strict `!==` returns true, so entry B is skipped. Entry B survives as a stale duplicate until gc (which does normalize at line 549-550).

**Impact**: The normalization fix introduces a behavioral inconsistency — the filter recognizes case-different entries as same-project, but the pruning loop doesn't collapse them. No data loss, no fail-closed violation. The stale entry is eventually collected by gc.

**Fix**: Change line 323 to normalize both sides:
```typescript
if (normalizeProjectIdentity(projects[otherPath].projectId) !== normalizeProjectIdentity(projectId)) continue;
```

### Minor 2 — Export path silently ignores `recoverableBackups`

**File**: `src/core/knowledge-bundle/export.ts:759-767`
**Severity**: Minor

`projectCatalog()` (export.ts:208) calls `readStoreCatalog`, which now returns `recoverableBackups`. The export consumer (line 759-767) checks `catalog.unreadable` but does NOT check `catalog.recoverableBackups`:

```typescript
const catalog = dependencies.readCatalog(home);
if (catalog.unreadable.length > 0) { ... throw ... }
// No check for catalog.recoverableBackups
```

**Failure scenario**: A project catalog has backup debris from a killed project-scope mutation. The export silently produces a bundle missing the backed-up records — an incomplete bundle reported as success. This is the same "recoverable data treated as absent" class that M5 fixes for the effective-materialization path.

**Impact**: Non-destructive (no data loss), but the user gets an incomplete bundle without warning. The M5 proposal scopes the fix to `effective.ts:596`, but the invariant ("recoverable data treated as absent") applies to the export path too.

**Fix**: After the `unreadable` check, add:
```typescript
if (catalog.recoverableBackups.length > 0) {
  throw new KnowledgeBundleExportError(
    'knowledge_bundle_catalog_degraded',
    `Project catalog has a recoverable backup directory (${catalog.recoverableBackups.join(', ')}); run a learned-skill mutation to restore it before exporting.`,
    { recoverableBackups: catalog.recoverableBackups }
  );
}
```

### Minor 3 — `rasen knowledge list/show` silently ignores `recoverableBackups`

**File**: `src/commands/knowledge.ts:638-640, 691-694`
**Severity**: Minor

Both `knowledge list` (line 638) and `knowledge show` (line 691) call `readCanonicalLearnedSkillCatalog` and iterate over `catalog.records` and `catalog.unreadable`, but do NOT check `catalog.recoverableBackups`.

**Failure scenario**: A Store with backup debris appears as having zero records in `rasen knowledge list` — the user sees no indication that records are recoverable. Same "recoverable data treated as absent" class.

**Impact**: Misleading display, non-destructive. The user might conclude their records are permanently lost when they're actually recoverable.

**Fix**: After the `unreadable` check in each command, surface `recoverableBackups` as a warning or degraded-status row.

### Trivial 1 — git-redaction test invokes `cloneRepository` four times per assertion

**File**: `test/core/store/git-redaction.test.ts:965-988`
**Severity**: Trivial

The first test case calls `cloneRepository(remote, target)` four separate times — once per `expect(...).rejects.toThrow(...)` assertion — instead of catching the error once and asserting multiple properties on it:

```typescript
await expect(cloneRepository(remote, target)).rejects.toThrow(/<redacted>/);
await expect(cloneRepository(remote, target)).rejects.toThrow(/Failed to clone/);
await expect(cloneRepository(remote, target)).rejects.not.toThrow(/secret/);
await expect(cloneRepository(remote, target)).rejects.not.toThrow(/user:secret/);
```

**Impact**: Functionally correct (the mock persists across calls), but wasteful and unconventional. A single `try/catch` with four `expect` calls on the caught error would be cleaner.

### Trivial 2 — Missing `?token=abc` false-positive regression test

**File**: `test/core/store/bootstrap-obtain.test.ts`
**Severity**: Trivial

Tasks.md item 1.4 asks for a regression-protection test verifying that `https://host/repo.git?token=abc` (token in query string, not userinfo) is NOT falsely rejected by `assertCredentialFreeRemote`. This test was not added. The existing parser handles it correctly (the URL has empty userinfo), but a regression-protection test would guard against future changes to `remoteCarriesCredentials`.

### Trivial 3 — M10 registry tests only exercise the path-exact match

**File**: `test/core/project-registry.test.ts:734-776`
**Severity**: Trivial

The two added registry tests register at the SAME path with different cases, which triggers the path-exact match (line 331-334) BEFORE the normalized `sameIdEntries` filter. The normalization at `findWorktreeDuplicateEntries` (line 467-469) and `gcProjectRegistry` (line 549-550) is not directly tested with case-different UUIDs at DIFFERENT paths. The import test indirectly exercises the `sameIdEntries` normalization via the full import flow, but the worktree-duplicate and gc paths are untested for this case.

---

---

## Re-review — fixer's uncommitted working-tree changes (round 2)

**Date**: 2026-07-27 (round 2)
**Verdict**: clean — all 6 prior findings resolved, 0 new findings
**Gates**: `pnpm exec tsc --noEmit` PASS; focused vitest (5 files) — 85 passed, 1 skipped, 0 failed

The fixer applied uncommitted changes addressing all 6 findings from round 1. Scope: 5 modified files + 2 new test files. No C1/C2/C3/C5 logic touched.

### Minor 1 — RESOLVED

`src/core/project-registry.ts:321-329`: The `place()` sibling-pruning loop now normalizes both sides:

```typescript
if (
  normalizeProjectIdentity(projects[otherPath].projectId) !==
  normalizeProjectIdentity(projectId)
)
  continue;
```

Both sides normalized. Comment updated to explain the rationale. The inconsistency with the `sameIdEntries` filter is eliminated.

**Regression test**: `test/core/project-registry.test.ts` — "M10 normalization: registerProject place() prunes a case-different sibling worktree duplicate". Seeds a main entry (lowercase UUID) and a legacy worktree-keyed entry (uppercase UUID), re-registers the main path, asserts the worktree sibling is pruned in the same write. Test passes.

### Minor 2 — RESOLVED

`src/core/knowledge-bundle/export.ts:766-791`: New `knowledge_bundle_catalog_degraded` error code + guard. When `catalog.recoverableBackups ?? []` is non-empty, throws `KnowledgeBundleExportError` before any staging file is opened.

- `?? []` defensive default: correctly handles pre-M5 test mocks that omit the field without weakening the guard for real catalogs.
- Fires BEFORE `readBaseProjectCommit` and any file staging — nothing is written.
- `details.recoverableBackups` carries a semicolon-joined string of the dir names.
- Does NOT touch or weaken the credential-free path (M9).

**Regression test**: `test/core/knowledge-bundle/export-degraded.test.ts` (3 tests):
1. Rejects with `knowledge_bundle_catalog_degraded`, asserts `opened === 0` and no output file.
2. Succeeds when `recoverableBackups` is empty (regression protection).
3. Error details carry the recoverable dirs.

### Minor 3 — RESOLVED (locale-key deferred to C6)

`src/commands/knowledge.ts`: Both `list` and `show` now collect and surface `degraded` scopes.

- **list**: Adds `degraded` array; JSON output includes `degraded: [{ scope, recoverableBackups }]`; human path prints a "Catalog degraded — recoverable backup debris:" section with repair hint. Empty-catalog check now includes `degraded.length === 0` so a degraded catalog is NOT reported as empty.
- **show**: When the requested id is not found AND there are degraded scopes, surfaces `code: 'catalog_degraded'` with dirs in details, with a human-readable explanation appended to the not-found message.

**Locale-key assessment**: **Acceptable as deferred for C6.** The inline English strings are:
1. In a NEW code path (degraded reporting), not modifications of existing localized strings.
2. Clearly marked with comments noting they're unlocalized and referencing the effective-materialization path.
3. The alternative (not reporting degraded at all) is worse than English-only reporting.

C6 (the docs/localization closure child) is the designated owner for moving these to `knowledge-messages.ts` and adding locale keys. This is Trivial-severity deferred debt, not a finding against this fix.

### Trivial 1 — RESOLVED

`test/core/store/git-redaction.test.ts`: Both test cases refactored to call `cloneRepository` once and catch once, asserting multiple properties on the single caught error's `.message`. Clean.

### Trivial 2 — RESOLVED

New `test/core/store/remote.test.ts` (18 tests): Thorough parser discrimination suite covering credential detection (4 cases), credential-free passes (8 cases), and the `?token=abc` false-positive trap (4 cases + redaction no-op + userinfo contrast). The contrast case (`https://abc@host` IS rejected) makes the test meaningful — it proves the parser discriminates by position (userinfo vs query), not by substring.

### Trivial 3 — RESOLVED

`test/core/project-registry.test.ts` (2 new tests):
1. "findWorktreeDuplicateEntries detects a case-different UUID across worktree/main paths" — exercises `findWorktreeDuplicateEntries` normalization (line 467-469) AND `gcProjectRegistry` normalization (line 549-550) with seeded case-different entries.
2. "registerProject place() prunes a case-different sibling worktree duplicate" — exercises the Minor 1 fix at the `place()` pruning loop.

Both tests use real git worktrees and seeded legacy entries with case-different UUIDs.

### New findings from fixer's changes

**None.** All 6 prior findings genuinely resolved. No new issues introduced.

### Scope check (round 2)

Modified files: `src/core/project-registry.ts`, `src/core/knowledge-bundle/export.ts`, `src/commands/knowledge.ts`, `test/core/store/git-redaction.test.ts`, `test/core/project-registry.test.ts`.
New files: `test/core/store/remote.test.ts`, `test/core/knowledge-bundle/export-degraded.test.ts`.

No C1 (bootstrap staging/verify/publish), C2 (file-state/membership/project-config locks), C3 (run-state/init/pipeline/portfolio-state), or C5 (session-launch-context) files touched.
