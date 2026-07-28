# Review Report — pr88-rf-authority (C5 / M6)

**Reviewer:** adversarial, evidence-based (not the author)
**Stage:** verify
**Date:** 2026-07-27
**Scope:** `src/core/management-api/session-launch-context.ts`, `test/core/management-api/session-launch-context.test.ts`, `test/core/session-runtime-context-e2e.test.ts`, two spec deltas under `rasen/changes/pr88-rf-authority/specs/`.

## Verdict: CLEAN

No Blocker, Major, Minor, or Trivial findings. The implementation faithfully realizes the locked M6 resolution with no detectable seam, regression, or scope leak.

## Scope check

`git diff --name-only` returns exactly three files:
- `src/core/management-api/session-launch-context.ts`
- `test/core/management-api/session-launch-context.test.ts`
- `test/core/session-runtime-context-e2e.test.ts`

No C1/C2/C3/C4 file touched (bootstrap.ts, project-config.ts, file-state.ts, import.ts, membership.ts, project-records.ts, run-state.ts, init.ts, pipeline.ts, portfolio-state.ts, catalog.ts, project-knowledge-home.ts, knowledge-bundle/*, registry.ts, effective.ts, git.ts all clean). The spec deltas are untracked new files under the change directory, as expected for rasen delta authoring.

## Findings (count by severity)

- **Blocker: 0**
- **Major: 0**
- **Minor: 0**
- **Trivial: 0**

## Evidence

### 1. Eligibility rule is Store-record-ONLY

`storePermitsProject` (`session-launch-context.ts:81-88`) now has exactly two statements: resolve membership, return `membership !== null`. The OR-arm (`readStorePointer` → `hasStoreDeclaration` → `storeBindingDeclarationFrom` → `resolveStoreBinding` → `rootsEqual`) is gone from the authority path. A grep for `rootsEqual` across the file shows its only remaining use at line 268 — inside the `if (!storePermitsProject)` branch, purely to classify the rejection message. No residual authority path exists.

### 2. Declaration helpers are diagnostic-only, NOT removed

All five helpers remain imported and used ONLY in the post-rejection classifier (`session-launch-context.ts:256-279`):
- `readStorePointer` — already read at line 246 for the malformed-pointer pre-check (unchanged); reused at line 263 for classification.
- `hasStoreDeclaration` — line 263, gates the classification binding resolution.
- `storeBindingDeclarationFrom` — line 265, bridges pointer → declaration for the resolver.
- `resolveStoreBinding` — line 264, resolves the declaration to a store root.
- `rootsEqual` — line 268, compares resolved root to the session's store root.

The classifier sets a boolean `declarationNamesThisStore` and selects one of two message templates. It cannot re-grant eligibility — it runs only after `storePermitsProject` returned `false`, and the branch unconditionally returns `{ ok: false, ... }`.

### 3. No new wire `code` enum

`code: 'execution_not_member'` at line 276 is unchanged from the pre-diff code. The git diff adds zero new `code:` values. The legacy-migration marker is a stable substring inside `message` (`"legacy declaration-only install"`), exactly as the proposal/tasks require. No wire-types or UI consumer ripple.

### 4. No auto-grant / no auto-rewrite

The rejection branch (lines 256-279) performs zero writes. It reads the declaration only to choose a message. The `writeStoreProjectRecord` calls in the test file are all in test setup (creating the post-migration shape), never in the code under test. The malformed-pointer pre-check at lines 247-254 is also read-only and unchanged.

### 5. Tests — flipped, new, and fixed

**Flipped OR-arm tests (2):**
- `session-launch-context.test.ts:344` — "rejects a project whose declaration names this Store but has no membership record, with a migration repair". Asserts `ok:false`, `status:409`, `code:'execution_not_member'`, message contains `'legacy declaration-only install'` AND the exact repair command `rasen store add-project declared-member-id --store declared-store`. Pre/post-asserts that no Store record was written. Non-trivial.
- `session-launch-context.test.ts:383` — "rejects a uid-only durable declaration when the Store record is missing, with a migration repair". Same fixture as the old durable-declaration test (mints permanent identity via `upgradeStoreIdentity`), now asserts `ok:false` + legacy marker + repair command naming `durable-member-id`/`durable-store`. Non-trivial.

**New classification test (1):**
- `session-launch-context.test.ts:437` — "the rejection distinguishes a declaration pointing here from one pointing elsewhere or absent". Three cases against the same Store with no record: (A) declaration → here-store gets the legacy marker; (B) declaration → other-store gets the plain message with "does not name this Store"; (C) no declaration at all gets the same plain message. Asserts marker present in A, absent in B and C. Strongly distinguishes the two diagnostic paths.

**New happy-path test (1):**
- `session-launch-context.test.ts:484` — "accepts a project whose Store record and declaration both agree on this Store". Writes both the Store record and the declaration, asserts `ok:true` with full `planningSpace` and `execution` shape. Meaningful, not weakened.

**Fixed existing tests (6 in session-launch-context + 2 in e2e = 8):**
Each previously-passing Store+project happy-path test gained a `writeStoreProjectRecord` call in setup so it still reaches `ok:true` under the new authority rule: tests at lines 90, 125, 499, 546, 667, 778 (session-launch-context) and 85, 165 (e2e). All eight assertions remain full-shape `toMatchObject`/`toEqual` checks on `planningSpace` + `execution`, not weakened to `ok:true`-only.

**No residual old-arm assertion:** a grep for "declaration.*vouch|OR-arm|declaration-only" across all `*.test.ts` files returns only (a) comments documenting the removal and (b) assertions of the new rejection shape. No test still asserts that a declaration alone grants `ok:true`.

### 6. Two-direction invariant preserved

`listProjectStoreCandidates` lives in `src/core/store/membership.ts:446`. That file is NOT in the diff (confirmed: `git diff -- src/core/store/membership.ts` is empty). The function's doc-comment still reads "every Store it declares a hint for, UNION every locally available Store whose records include it" and its body still iterates `hints` (the declared direction) and merges in locally recorded members. Discovery (project → store) remains a union; only eligibility (store → project) became record-only. The two questions are correctly separated.

### 7. Spec delta title check — both verbatim

- `session-runtime-context` delta title: "Choosing a project to work on in a Store session is validated before the session starts" — matches canonical `rasen/specs/session-runtime-context/spec.md:211` character-for-character. ✓
- `store-project-membership` delta title: "A Store records each member project in its own file, keyed by project identity" — matches canonical `rasen/specs/store-project-membership/spec.md:8` character-for-character. ✓

### 8. C2 collision check — no overlap

C2's committed delta (`rasen/changes/pr88-rf-locks/specs/store-project-membership/spec.md`) modifies exactly two requirement titles:
1. "Adding membership writes each repository in a defined order and reports what still needs repair"
2. "A project carries portable locator hints for the Stores it belongs to"

C5 modifies a DIFFERENT title in the same capability: "A Store records each member project in its own file, keyed by project identity". No title overlap. The two deltas touch disjoint requirement titles within `store-project-membership`, so archive-time sync will merge cleanly.

### 9. Spec delta scenario coherence

**session-runtime-context (MODIFIED):** The old accepting scenario "A project the Store records only by its own declaration is a valid choice" is replaced by the new rejection scenario "A project the Store does not record is rejected even when its own declaration names this Store". The four other scenarios retain their titles; the "A project the Store does not have as a member is rejected" scenario is sharpened to drop the declaration-as-authority framing and add the diagnostic-distinction guarantee. Body text is rewritten to declare the Store record the sole vouching authority and the declaration a locator. Coherent and internally consistent.

**store-project-membership (MODIFIED):** All five original scenarios are preserved with their titles; one new scenario "A declaration alone does not establish Session eligibility" is appended. Body text sharpens the "single authority" clause to explicitly state that no other source (including the declaration) shall confer membership or eligibility, and that the declaration may shape the diagnostic but not decide eligibility. Coherent and consistent with the session-runtime-context delta.

### 10. Focused tests

`pnpm vitest run test/core/management-api/session-launch-context.test.ts test/core/session-runtime-context-e2e.test.ts` → **2 files passed, 33 tests passed** (0 failures, 0 skips). Duration ~12s.

### 11. TypeScript

`pnpm exec tsc --noEmit` → exit 0, no output. Clean.

## Notes for the archive stage (C6), not findings against this delta

- The `session-runtime-context` MODIFIED delta inverts one scenario (old accepting scenario becomes a rejecting one with a new title). This is semantically correct — the old title ("is a valid choice") cannot be kept when the behavior is now rejection. The rasen archive sync replaces the entire MODIFIED requirement body + scenarios wholesale, so this scenario rename is handled by full replacement. C6's archive rehearsal (`rasen archive --json --yes`) will confirm the sync merges cleanly; flag this only if the rehearsal surfaces a scenario-preservation guard.
