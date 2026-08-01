# Review Report: store-identity-auto-migrate

**Reviewer:** independent verifier (author != implementer)
**Date:** 2026-08-01
**Branch:** `fix/store-identity-auto-migrate-0.1.6` (uncommitted working-tree changes against `origin/dev/0.1.6`)
**Tree fingerprint:** `674563fdd6014ad4996187a0674a19192d04cd59`

---

## Part 1 — Independent Verification

### TypeScript

```
pnpm tsc --noEmit → CLEAN (zero diagnostics)
```

### HARD acceptance tests (re-run by reviewer)

```
pnpm vitest run test/core/store/identity-migration.test.ts
→ 1 file, 8 tests, 8 passed (0 failed)

pnpm vitest run test/core/update-store-identity-migration.test.ts
→ 1 file, 3 tests, 3 passed (0 failed)
```

### Regression sweep (affected areas)

```
pnpm vitest run test/core/project-config-store-memberships.test.ts test/commands/store-identity-cli.test.ts
→ 2 files, 47 tests, 47 passed (0 failed)
```

### Test-gate block

| Command | Result |
|---|---|
| `pnpm tsc --noEmit` | CLEAN |
| `test/core/store/identity-migration.test.ts` | 8/8 PASS |
| `test/core/update-store-identity-migration.test.ts` | 3/3 PASS |
| `test/core/project-config-store-memberships.test.ts` | ALL PASS (6 new backfill tests) |
| `test/commands/store-identity-cli.test.ts` | ALL PASS (3 new `--all` tests) |
| `git rev-parse HEAD^{tree}` | `674563fdd6014ad4996187a0674a19192d04cd59` |

### HARD gate — test body audit

**identity-migration.test.ts > "migrates all identityless stores, backfills hints, and silences the warning" (line 89):**

The test GENUINELY asserts the acceptance criterion:

1. **Warning fires before migration** (lines 122–127): collects diagnostics via a `ConfigDiagnosticReporter`, asserts `warningsBefore.length > 0`. This proves the fixture is correctly set up with identityless hints.

2. **Stores gain uids** (lines 137–142): reads `.rasen-store/store.yaml` for both stores, asserts `storeMetadataUid` is defined and `version === 2`.

3. **storeMemberships entries carry uids** (lines 149–155): re-reads the project config, asserts each hint has a defined `uid`.

4. **HARD GATE — warning does NOT fire after migration** (lines 157–164): resets the dedup set, then re-parses with a reporter that collects `storeMembershipsWithoutIdentity` diagnostics. Asserts `warningsAfter` equals `[]`. This is genuine — the reporter bypasses the dedup set (config-diagnostics.ts: the `if (reporter)` path returns early before checking `emittedWarnings`), so the assertion would catch the warning if any identityless entry remained.

5. **Registry re-keyed to v2** (lines 166–170): asserts `result.registryRekeyed === true`, `result.registryBlockedBy === []`, and `registry?.version === 2`.

**Verdict on test body:** The HARD gate assertions are correct and non-trivial. The test does not pass for the wrong reason.

**update-store-identity-migration.test.ts:** verifies the hook wiring (called with `{ apply: true, projectRoot }`, gated on `!onlyThis`, best-effort on throw). These are structural wiring tests, not the end-to-end warning-silence assertion — that is covered by the identity-migration.test.ts HARD gate above.

---

## Part 2 — Adversarial Diff Review

### Checklist results

| Risk | Status | Notes |
|---|---|---|
| Backfill correctness | PASS | `backfillStoreMembershipUid` matches `uid===undefined && id===match.id`, uses yaml AST round-trip, owner-aware lock. Tests verify comments/ordering preserved, no-op on already-identified, dedup-key trap avoided. |
| Batch ordering | PASS | ALL store metadata uids written in step 1–3 loop (identity-migration.ts:126–225) BEFORE registry re-key in step 6 (line 289). No mid-loop re-key. |
| Unresolvable stores | PASS | Every per-store op in try/catch; path-missing/metadata-unreadable/no-alias → skipped+reported. `registryBlockedBy` surfaces cleanly. No force-unregister. |
| Git discipline | PASS | No auto-commit anywhere. `suggestedCommits` built via `renderSuggestedCommit` per repo, mirroring `migration-ops.ts`. |
| Update hook | PASS | Gated `!this.onlyThis` (update.ts:591). Best-effort try/catch (update.ts:608–617). Recursive `onlyThis:true` sub-updates skip it. |
| Concurrency | PASS (minor) | `backfillStoreMembershipUid` uses `withOwnerAwareFileLock`. `updateStoreRegistryState` uses `acquireFileLock`. Store metadata writes use `writeFileAtomically` (temp+rename, no lock) — consistent with existing `upgradeStoreIdentity` pattern. |
| Locale completeness | PASS | All 7 `storeIdentityMigration.*` keys + `storeMembershipsWithoutIdentity` update + `all` flag help present in en/ja/zh-cn. No missing keys. |
| Idempotency | PASS | Second run: `storeMetadataUid` is defined → `already-had-identity`, no writes. Test covers this. |
| Validation criterion | See Major-1 below | Likely passes for the user's 2 identityless stores, but has a blind spot for already-identified stores with stale identityless hints. |

### Findings

---

#### Major-1: `already-had-identity` stores' membership hints are never backfilled

**File:** `src/core/store/identity-migration.ts:230`
**Severity:** Major

**Code:**
```typescript
const upgradedStores = storeResults.filter((s) => s.status === 'upgraded');
```

Step 4 (membership-hint backfill across all registered projects) only iterates over stores whose status is `'upgraded'`. Stores with status `'already-had-identity'` are excluded. This means if a store already carries a permanent uid (e.g., it was previously upgraded via single-store `rasen store upgrade-identity <id> --apply`) but a project's `storeMemberships` hint for that store was written before the store got its uid, the hint remains identityless.

**Concrete failure scenario:**
1. Store "elftia-store" has uid "abc-123" (upgraded months ago via single-store flow).
2. A project's `storeMemberships: [{ id: 'elftia-store' }]` hint was written before the store got its uid (no `uid` field).
3. User runs `rasen update`. The migration finds elftia-store is `already-had-identity`, skips backfill.
4. The project's hint for elftia-store remains identityless.
5. The `storeMembershipsWithoutIdentity` warning continues to fire — the validation criterion ("MUST no longer fire") is not met.

**Impact on the user's validation:** The planning context identifies 2 identityless stores (rasen-store, session-context-dogfood-0725) that WILL be upgraded and backfilled. The other 2 stores (elftia-store, scene-bridge-store) already have uids. If their membership hints already carry uids, the warning goes silent. If any hint is identityless (written before the store was identified), the warning persists. This cannot be determined without inspecting the user's actual project configs.

**Suggested fix (for the LEAD's fixer):** Change the filter at line 230 to include `already-had-identity` stores:
```typescript
const storesToBackfill = storeResults.filter(
  (s) => s.status === 'upgraded' || s.status === 'already-had-identity'
);
```
`backfillStoreMembershipUid` is already idempotent — it only modifies entries where `uid === undefined`, so it won't double-write entries that already carry a uid.

---

#### Minor-1: `storeIdentityMigration.*` locale keys defined but never used

**File:** `src/core/store/identity-migration.ts:382–437` (formatStoreIdentityMigrationSummary), `src/locales/{en,ja,zh-cn}.json`

The 7 `storeIdentityMigration.*` locale keys are added to all three locale files, but `formatStoreIdentityMigrationSummary` uses hardcoded English strings (`"Upgraded N store(s):"`, etc.). Neither caller (`update.ts:runStoreIdentityMigration`, `store.ts:upgradeIdentityAll`) performs locale lookup on the summary lines. The keys are dead code.

This is consistent with the existing `renderSuggestedCommit` pattern (core formatting returns English; CLI layer can localize), so it is not an i18n regression. But the locale keys serve no purpose as-is.

No crash risk: the `#110` presentation layer throws only on MISSING keys during lookup — since no code looks up these keys, there is no throw.

---

#### Minor-2: Update-hook test is not isolated from the real machine store registry

**File:** `test/core/update-store-identity-migration.test.ts:49–63`

The `vi.mock` wraps `migrateAllStoreIdentities` but delegates to the real function. When `UpdateCommand.execute()` calls the hook, the real `migrateAllStoreIdentities({ apply: true, projectRoot: testDir })` runs. Since no `globalDataDir` is passed, the function reads the REAL machine store registry (`~/.rasen` or equivalent). If the machine has identityless stores, the test writes permanent uids to them as a side effect.

The test only asserts call arguments (`expect(mockedMigrate).toHaveBeenCalledWith(...)`) and does not check store state, so the assertions are valid. But the test mutates real machine state during its first run (subsequent runs are idempotent no-ops).

**Suggested fix:** Either mock `migrateAllStoreIdentities` to return a static result (no delegation to real impl), or have `runStoreIdentityMigration` accept a `globalDataDir` override that the test sets to a temp dir.

---

#### Minor-3: Redundant registry writes in step 5

**File:** `src/core/store/identity-migration.ts:264–282`

Step 5 calls `upgradeStoreIdentity` for each upgraded store. `upgradeStoreIdentity` internally calls `updateStoreRegistryState` (upgrade-identity.ts:338), which triggers `upgradeStoreRegistryToV2` on every write. For N upgraded stores, this is N registry writes in step 5, plus 1 in step 6. Each write acquires the registry lock, reads, plans, and writes.

This is correct (the first successful write re-keys; subsequent writes are no-ops) but wasteful for stores with many entries. Not a functional issue.

---

#### Trivial-1: Preview-mode `registryBlockedBy` is approximate

**File:** `src/core/store/identity-migration.ts:304–313`

In preview mode (`apply: false`), `registryBlockedBy` is computed from skipped stores only (line 310–312), not from the actual `upgradeStoreRegistryToV2` plan. A store that exists and has metadata but was NOT upgraded (because apply is false) wouldn't appear in `blockedBy` even though it lacks a uid. The code comment acknowledges this ("In preview we can't know exact blockers"). Minor UX inaccuracy in dry-run output.

---

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 1 |
| Minor | 3 |
| Trivial | 1 |

The implementation is structurally sound: batch ordering is correct (all uids before re-key), unresolvable stores are report-and-skip, git discipline is respected (no auto-commit), the update hook is gated and best-effort, the backfill writer avoids the dedup-key trap, and the HARD acceptance test genuinely asserts the warning goes silent and the registry is re-keyed. The Major finding (already-identified stores not backfilled) is a completeness gap that may or may not affect the user's specific validation depending on whether any identified store has stale identityless hints.

VERIFY VERDICT: BLOCKED (round 1 — see re-review below)

---

## Round 1 re-review

**Date:** 2026-08-01 (same session)
**Scope:** fix delta only (implementer applied round-1 fixes to the working tree; HEAD unchanged at `674563fdd6014ad4996187a0674a19192d04cd59`, working-tree content updated)

### Independent re-verification

```
pnpm tsc --noEmit → CLEAN
pnpm vitest run test/core/store/identity-migration.test.ts
  test/core/update-store-identity-migration.test.ts
  test/core/project-config-store-memberships.test.ts
  test/commands/store-identity-cli.test.ts
→ 4 files, 59 tests, 59 passed (0 failed)
```

Test count increased from 56 to 59 (the new `already-had-identity` backfill test, plus the suite count refinement).

### Prior findings — resolution status

#### Major-1: already-had-identity stores' hints never backfilled → RESOLVED

**Fix verified at:** `src/core/store/identity-migration.ts:236–238` (step 4), `:278–280` (step 5), `:364–366` (suggested-commits).

Step 4 filter widened to `(s) => s.status === 'upgraded' || s.status === 'already-had-identity'`. Step 5 widened identically. Suggested-commits declaration-only case widened identically. `backfillStoreMembershipUid` is idempotent (only modifies `uid === undefined` entries), so backfilling already-complete hints is a no-op.

**New regression test** (`identity-migration.test.ts:222` — "backfills hints for stores that already have an identity"):
- Creates an already-identified store + a project with an identityless `storeMemberships` hint for it.
- Asserts the warning fires BEFORE migration (reporter collecting diagnostics, `warningsBefore.length > 0`).
- Runs the migration. Asserts store status is `already-had-identity` (NOT upgraded).
- Asserts the hint now carries the existing uid: `[{ uid: uidExisting, id: 'identified-store' }]`.
- **HARD GATE**: re-parses with a reporter that bypasses the dedup set (the `if (reporter)` early-return in `reportConfigDiagnostic`), asserts `warningsAfter` is `[]`. Genuine — the reporter would catch the warning if it fired.

**Step 5 safety — `resolveUpgradableProject`** (upgrade-identity.ts:170–182): returns `null` when `pointer.shape === 'durable'` (line 177). So `upgradeStoreIdentity` skips the project-pointer rewrite for already-durable `store:` declarations. An `already-had-identity` store with an alias-form declaration IS correctly rewritten to durable form. An `already-had-identity` store with a durable declaration is a complete no-op (metadata skipped, declaration skipped, only a harmless registry re-key write).

**No remaining edge cases.** Skipped stores (`status === 'skipped'`) are correctly excluded from both the step 4 and step 5 filters — they have no uid to backfill.

#### Minor-1: locale keys unused → RESOLVED

**Fix verified at:** `src/core/store/identity-migration.ts:47–48` (imports), `:399–457` (summary function).

`formatStoreIdentityMigrationSummary` now calls `getCliLocale()` → `getLocaleCatalog(locale)` → `formatLocaleMessage(template, values)` via a `fmt` helper. Six of seven `storeIdentityMigration.*` keys are wired: `upgraded`, `skipped`, `alreadyIdentified`, `rekeyed`, `rekeyBlocked`, `allIdentified`. Summary tests pin `RASEN_LANG=en` (lines 363–371) so assertions are deterministic.

The `fmt` helper guards against missing keys: `t[key] ? formatLocaleMessage(t[key], values) : ''`. No `#110` throw risk — the function never looks up a key that could be absent (all six keys exist in all three locale catalogs). Imports verified: `getCliLocale` from `cli-locale.ts`, `formatLocaleMessage`/`getLocaleCatalog` from `locales/index.ts:15,19`.

**Accepted-known remnants:** the seventh key `suggestedCommit` is defined in all three locale files but the summary function uses hardcoded `"Suggested commits:"` with a different format (`[purpose]` / `command` lines). Additionally, several detail/data lines remain hardcoded English (store names with arrows, skipped-store reasons, the backfill-count line). These are data-dependent secondary lines without corresponding locale keys. Accepted as known — consistent with the existing `renderSuggestedCommit` pattern.

#### Minor-2: update-hook test mutates real machine → RESOLVED

**Fix verified at:** `test/core/update-store-identity-migration.test.ts:50–67`.

The mock no longer delegates to the real `migrateAllStoreIdentities`. It returns a canned result: `{ applied: true, stores: [], projects: [], registryRekeyed: true, ... }` and `formatStoreIdentityMigrationSummary` returns `['All registered stores carry a permanent identity.']`. The test never reads or writes `~/.rasen`. Fully isolated.

#### Minor-3 (round 1): redundant registry writes → ACCEPTED-AS-KNOWN

Still applies: step 5's `upgradeStoreIdentity` calls trigger `updateStoreRegistryState` per store, plus step 6 triggers another. Correct but wasteful. Not a functional issue. Accepted as known — the fix is a refactor (extract the registry write to step 6 only) that doesn't affect correctness.

#### Trivial-1 (round 1): preview-mode `registryBlockedBy` approximate → ACCEPTED-AS-KNOWN

**Stated:** In preview mode (`apply: false`), `registryBlockedBy` (identity-migration.ts:325–327) only includes `status === 'skipped'` stores, not identityless stores that would be upgraded (which have `status === 'upgraded'` in preview). The preview `blockedBy` list is therefore incomplete. The code comment documents this. Decision: **accept-as-known** — it's a cosmetic dry-run inaccuracy. The user can see from the "Upgraded" section which stores need work. Fixing it would require running `upgradeStoreRegistryToV2` on a modeled state, which adds complexity for a dry-run-only path.

### New issues introduced by the fix

None at Blocker/Major/Minor severity. Two Trivial observations:

- **Trivial-2: Suggested-commit generated for potentially-unchanged `config.yaml`.** When step 5's widened filter includes `already-had-identity` stores but all declarations are already durable and all hints are already backfilled, the suggested-commits block (line 361–377) still generates a commit for the invoking project's `config.yaml`. `git add` on an unchanged file is a no-op, so this is misleading but harmless.

- **Trivial-3: Unused `suggestedCommit` locale key.** Defined in all three locale files but the summary function uses a different hardcoded format for the suggested-commits section. Dead code (as noted in accepted-known above).

### Round 1 re-review summary

| Severity | Round 1 | Round 1 re-review |
|---|---|---|
| Blocker | 0 | 0 |
| Major | 1 | 0 (resolved) |
| Minor | 3 | 0 (2 resolved, 1 accepted-known) |
| Trivial | 1 | 3 (1 accepted-known + 2 new, all accepted-known) |

All Major and Minor findings are resolved or accepted-known. No new Blocker/Major/Minor introduced by the fix.

VERIFY VERDICT: CLEAN
