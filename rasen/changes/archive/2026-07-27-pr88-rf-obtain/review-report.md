# Review Report — pr88-rf-obtain (C1)

**Reviewer role**: verifier (author != verifier)
**Date**: 2026-07-27
**Scope**: B3, B4, M1, M2, M11 (bootstrap obtain/register correctness & safety)
**Files in scope** (exactly 6, confirmed):
- `src/core/store/bootstrap.ts`
- `src/core/store/foundation.ts`
- `src/core/store/operations.ts`
- `test/core/store/bootstrap-obtain.test.ts`
- `test/core/store/bootstrap-metadata-probe.test.ts` (new)
- `test/core/store/register-existing-store-data-dir.test.ts` (new)

## Verification gates

| Gate | Result |
|---|---|
| Focused vitest (3 files / 40 tests) | **PASS** (40/40 in 42.6s) |
| `pnpm exec tsc --noEmit` | **PASS** (no output) |
| `pnpm run lint` | **PASS** (no output) |
| Scope boundary | **PASS** — child touched only its 6 files; no canonical spec modified (`git diff --name-only rasen/specs/` empty) |

## Per-finding assessment

### B3 — Clone through exclusive staging directory + atomic publish — **PASS**

- `cloneWithCleanupGuard` rewritten to clone into per-call staging sibling (`<target>.rasen-stage.<pid>.<rand>`); on failure only staging is `rm -rf`'d; `target` is never touched at this stage (`bootstrap.ts:1515-1539`).
- `publishStagedCheckout` (`bootstrap.ts:1565-1599`) does `fs.promises.rename(staging, target)`; on `EEXIST|ENOTEMPTY` reports `bootstrap_obtain_publish_lost_race`; on other errors reports `bootstrap_obtain_publish_failed`; in both cases the staging dir is LEFT IN PLACE (never deleted by the loser).
- The cross-process race regression test exists (`bootstrap-obtain.test.ts:1178-1183`, "exactly one publish succeeds when two obtains race on the same target") and passes — uses real `Promise.all` concurrency with two distinct remotes targeting the same path.
- Old `targetExistedBefore` proof and `bootstrap_obtain_target_preserved` diagnostic are removed everywhere (verified: zero references in `src/` or `test/`).
- Existing "pre-existing target WITH content survives" test still works because `selectBootstrapLocation` refuses non-empty dirs before clone runs.

### B4 — Store clone identity verification, zero-write on mismatch — **PASS**

- Identity gate at `bootstrap.ts:1690-1720` runs after clone (into staging) but BEFORE publish and register. Reuses `probeStoreMetadataState` (the M11 helper) — exactly as the proposal demanded.
- Missing/unreadable/mismatch all push `bootstrap_obtain_identity_mismatch` (error) + `bootstrap_obtain_clone_identity_unverified` (warning naming staging path + `rm -rf` command), return `'obtain-failed'`. Target is never created (no publish). Registry is zero-write.
- Alias-only path (`entry.uid === undefined`) correctly SKIPS the check and proceeds to publish + register.
- Tests: wrong-UID, missing-UID, unreadable-metadata, alias-only success — all present and green. Registry zero-write is asserted by reading the registry file and confirming neither uid nor alias appears.

### M1 — Project obtain fail-closed for missing/unreadable/mismatch — **PASS with Minor finding**

- Identity gate at `bootstrap.ts:2839-2875` runs after clone (into staging) but BEFORE publish. Fail-closed outcome is correct for all three cases (mismatch, missing, unreadable). Target is never created. Registry is zero-write.
- Tests: wrong-ID, missing-ID, unreadable-config — all present and green (asserting `action === 'obtain-failed'`, target absent, diagnostic code present).
- **Gap**: see Minor 1 below — the "unreadable" branch is unreachable in practice; the test passes because the fail-closed outcome is the same as for "missing".

### M2 — `globalDataDir` threaded through `registerExistingStore` — **PASS**

- `RegisterExistingStoreInput extends StorePathOptions` (`operations.ts:222`).
- Inside `registerExistingStore` (`operations.ts:948-1103`), `pathOptions` is derived from `input.globalDataDir` and threaded into `readStoreRegistryState(pathOptions)` (twice), `commitStoreRegistration({ ..., ...pathOptions })`, and `mutationPayload(..., pathOptions)`. `findRegistryEntryKeys` and `isRegisteredAtPath` are pure in-memory operators on the already-loaded registry state — they correctly take no path options (the planner was over-cautious here).
- All three bootstrap.ts call sites (now at lines 1739, 1931, 2717 after diff) pass `globalDataDir: input.globalDataDir` via the conditional spread pattern already used elsewhere.
- A≠B three-path test (`register-existing-store-data-dir.test.ts`) proves disjoint registries for A, B, and default. Physical paths asserted disjoint too.

### M11 — Metadata probe at the routing seam — **PASS**

- `probeStoreMetadataState` (`foundation.ts:826-847`) returns the discriminated union `{absent}|{valid}|{unreadable}`. Reuses `resolveReadableStoreMetadataPath` (modern-first-then-legacy) — does NOT duplicate precedence. Reuses `pathIsFile` and `parseStoreMetadataState`.
- Routing in `buildBootstrapReport` (`bootstrap.ts:3078-3101`): `valid` → Store-first; `unreadable` → blocked report via `unreadableState(probe.path, probe.failure)`; `absent` → Project-first. No fallthrough.
- Five probe tests (absent, valid-modern, valid-legacy-only, unreadable-legacy-only, unreadable-modern) — all green.

## Findings

### Minor 1 — M1 identity check: dead try/catch, misleading diagnostic on corrupt config

**Location**: `src/core/store/bootstrap.ts:2839-2846`

```ts
let clonedProjectId: string | undefined;
let clonedConfigReadable = true;
try {
  const clonedConfig = readProjectConfig(result.stagingPath);
  clonedProjectId = clonedConfig?.projectId;
} catch {
  clonedConfigReadable = false;
}
```

**Failure scenario**: `readProjectConfig` (`src/core/project-config.ts:679-704`) has its own internal try/catch that swallows every error (YAML parse failure, file IO error, schema invalid) and returns `null`. It NEVER throws. Therefore:

1. The `catch` block here is unreachable; `clonedConfigReadable` always remains `true`.
2. For a cloned remote whose `openspec/config.yaml` is corrupt YAML, `readProjectConfig` returns `null` → `clonedProjectId = null?.projectId = undefined` → the `clonedProjectId === undefined` branch fires.
3. The diagnostic reads `"does not declare a project identity"` — but the actual condition is "config exists but cannot be parsed". The user is sent looking for a missing `projectId` field when the real problem is a corrupt file.
4. The "unreadable config" test (`bootstrap-obtain.test.ts` ~line 1058) passes anyway because both branches produce `action: 'obtain-failed'` with the same diagnostic code. The test does not assert on the message text or the `reason` string, so the conflation is invisible to the suite.

The fail-closed **invariant** holds — this is not a correctness regression. The cost is (a) dead branches that look like they handle the case but don't, and (b) a misleading user-facing diagnostic for the specific "corrupt YAML" scenario (which the proposal and tasks.md §5.1 explicitly distinguished from the missing-config case).

**Suggested fix**: either (a) detect unreadable config explicitly by checking `fs.existsSync(configPath)` before invoking `readProjectConfig` and treating "file exists but readProjectConfig returned null" as the unreadable case, or (b) introduce a `readProjectConfigOrThrow` variant that exposes the parse failure and use it here. Either way, also extend the corrupt-config test to assert the specific `reason` text (or a distinct diagnostic code) so the dead-branch regression is caught going forward.

### Minor 2 — Windows false-positive on `publishStagedCheckout` when target is a pre-existing empty directory

**Location**: `src/core/store/bootstrap.ts:1565-1599` (`publishStagedCheckout`)

**Failure scenario**: `selectBootstrapLocation` (`bootstrap.ts:610-612`) explicitly accepts an empty pre-existing target directory as `usable`. On POSIX, `rename(2)` onto an empty directory silently replaces it, so the publish succeeds. On Windows, `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING` cannot replace an existing directory (even an empty one); `fs.rename` fails with `EEXIST`.

The current code treats any `EEXIST|ENOTEMPTY` as "another process published first" and reports `bootstrap_obtain_publish_lost_race`. On Windows with a pre-existing empty target (and no race at all), the user sees a misleading "another process published first" warning, and bootstrap reports failure. The staging dir is kept (no data loss), and manual remediation is possible via the printed `rm -rf` command.

The implementer explicitly flagged this; impact is bounded:
- No data loss (staging dir preserved).
- The scenario is uncommon (empty pre-existing target dir on Windows).
- POSIX behavior is unaffected.

**Suggested fix**: before publishing, if `fs.existsSync(target)` and the directory is empty, either remove it first (`fs.rmdirSync(target)`) or use `fs.rmSync(target, { recursive: true, force: true })` and then rename. Alternatively, narrow the `EEXIST` diagnostic to "another process published first OR the target pre-existed as an empty directory (Windows)" so the message is not actively misleading.

### Trivial 1 — Stale JSDoc on `obtainAbsentStore`

**Location**: `src/core/store/bootstrap.ts:1602-1607` (the function-level comment block above `obtainAbsentStore`).

The comment still reads:

> "The cleanup proof (`fs.existsSync` recorded BEFORE the clone) and the cleanup decision are in THIS function — the proof does not cross a module boundary where a future change could consume it without establishing it."

This describes the OLD design (B3's pre-fix `targetExistedBefore` proof). The new design uses an exclusive staging directory and never records an existence proof; the data-destruction guarantee now comes from "this txn only ever deletes its own staging dir". The comment lies about how safety is proven.

**Suggested fix**: rewrite the paragraph to describe the staging-dir design (the new `cloneWithCleanupGuard` JSDoc at line 1500-1514 already says it correctly; the `obtainAbsentStore` comment should align).

## Verdict

Findings (3): 0 Blocker / 0 Major / 2 Minor / 1 Trivial. None block ship — the fail-closed invariants hold across B3/B4/M1/M2/M11, the cross-process race is genuinely closed, and the test coverage matches the review's demands. The two Minor findings are about misleading diagnostics in edge cases (corrupt project config on either platform; empty pre-existing target on Windows), not about correctness of the primary invariants. The Trivial finding is a stale comment.

---

## Re-review (fixer delta for Minor 2 + Trivial 3)

**Minor 1 status**: accepted-deferred (not in this fix delta).
**Fixer delta scope**: `publishStagedCheckout` rewrite + new `tryClearEmptyTargetDir` / `isPublishBlockedCode` helpers (Minor 2); `obtainAbsentStore` JSDoc rewrite (Trivial 3); +2 new tests.

### Re-review gates

| Gate | Result |
|---|---|
| Focused vitest (3 files / **42 tests**) | **PASS** (42/42 in 54.2s — +2 vs. prior 40) |
| `pnpm exec tsc --noEmit` | **PASS** (no output) |
| Empirical `fs.promises.rmdir` safety check | **PASS** — `rmdir` on a non-empty dir fails `ENOTEMPTY` (verified on this host) |

### Minor 2 — `publishStagedCheckout` empty-dir recovery — **RESOLVED**

**Location**: `src/core/store/bootstrap.ts:1577-1645` (rewritten `publishStagedCheckout`), plus new helpers `isPublishBlockedCode` (`:1654-1658`) and `tryClearEmptyTargetDir` (`:1669-1680`).

**Safety analysis** (the critical question: can content ever be destroyed?):

The recovery path uses `fs.promises.rmdir(target)` — NOT `fs.rm({recursive:true,force:true})`. This is the correct primitive:

1. `stat(target)` must confirm target IS a directory (files are never touched).
2. `readdir(target)` must return zero entries (non-empty returns false → fall through to race-loser diagnostic, content untouched).
3. `rmdir(target)` is the ONLY destructive call, and POSIX `rmdir(2)` / Windows `RemoveDirectory` FAIL with `ENOTEMPTY` / `ERROR_DIR_NOT_EMPTY` on a non-empty directory. **Verified empirically on this host**: `fs.promises.rmdir` on a dir with one file returns `ENOTEMPTY`.

Therefore: even if another process fills `target` between the `readdir` check and the `rmdir` call (the only TOCTOU window), the `rmdir` FAILS → caught → `tryClearEmptyTargetDir` returns false → falls through to the existing `bootstrap_obtain_publish_lost_race` diagnostic. **No content can be lost.**

**Race-loser behavior preserved for non-empty target**: a non-empty `target` makes `tryClearEmptyTargetDir` return false at the `readdir` check (entries.length > 0), skipping the retry and falling through to the unchanged `bootstrap_obtain_publish_lost_race` diagnostic.

**EPERM/EEXIST/ENOTEMPTY coverage**: `isPublishBlockedCode` gates on all three codes. The fixer's correction is accurate — Windows `MoveFileEx` directory-over-directory surfaces as `EPERM` (`ERROR_ACCESS_DENIED`) on current Win11/Node combinations, not just `EEXIST`. All three codes trigger the empty-dir recovery; any other code goes straight to `bootstrap_obtain_publish_failed` without attempting recovery (no behavioral change for genuine I/O errors).

**Retry-after-clear logic**: if the retry rename still fails with a blocked code (another process snuck in between our `rmdir` and our retry), the function correctly falls through to the race-loser diagnostic rather than looping. If the retry fails with a non-blocked code, it reports `bootstrap_obtain_publish_failed` with a "after clearing an empty target directory" qualifier. Both paths leave the staging dir in place. No infinite loop, no double-clear.

### Trivial 3 — Stale JSDoc on `obtainAbsentStore` — **RESOLVED**

**Location**: `src/core/store/bootstrap.ts:1682-1701`.

The JSDoc now correctly describes the staging-dir exclusivity design (B3), the identity verification (B4), the atomic publish (B3), and the `globalDataDir` threading (M2). The stale `fs.existsSync recorded BEFORE the clone` language is gone. The new text accurately reflects the actual data-destruction guarantee.

### New tests — both meaningful

**Test 1** (`bootstrap-obtain.test.ts:1207`, "obtains successfully when target is a pre-existing empty directory"):
- Pre-creates an EMPTY target dir, runs apply, asserts `action === 'obtained'`, `.git` + `.rasen-store` exist in target, NO `bootstrap_obtain_publish_lost_race` diagnostic fires, no staging leftover.
- On POSIX: rename silently replaces empty dir → test validates the end-to-end contract (empty target → obtained) and the "no false race diagnostic" assertion catches a future regression where the recovery might accidentally emit the race-loser warning.
- On Windows: rename fails EPERM → recovery clears empty dir → retry rename succeeds → the "no race-loser diagnostic" assertion is the key signal that the recovery worked silently.
- This is NOT trivially passing — it pins down a cross-platform contract that the recovery is silent on success.

**Test 2** (`bootstrap-obtain.test.ts:1244`, "still loses the race when target is a pre-existing NON-empty directory"):
- Pre-creates a NON-empty target with user content, asserts `action === 'not-acted'`, `bootstrap_obtain_target_refused` diagnostic, user content byte-identical.
- This test doesn't exercise `publishStagedCheckout` directly — `selectBootstrapLocation` refuses non-empty targets before the clone runs. It's a regression-protect test for the upstream guard, documenting that the empty-dir recovery does NOT weaken the refusal of a directory with content. Meaningful as a boundary marker.

### No new findings from the fix delta.

## Final verdict — CLEAN

All three original findings addressed (Minor 2 + Trivial 3 resolved by the fixer; Minor 1 accepted-deferred). No new findings introduced by the fix delta. The fail-closed / zero-write / race-closed invariants from the primary review remain intact. **C1 is clear to ship.**
