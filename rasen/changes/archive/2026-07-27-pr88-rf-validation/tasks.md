## 0. Ground rules

- [ ] 0.1 Stage with explicit pathspecs only. Never `git add -A`.
- [ ] 0.2 Use `path.join()` / `path.resolve()` for every path, in source and in tests. No hardcoded separators.
- [ ] 0.3 Do not touch any finding outside {M9, M5, M10}. Other findings belong to sibling children.
- [ ] 0.4 Do NOT edit `rasen/specs/store-bootstrap/spec.md` or its Purpose line (child C6 owns that). Do NOT re-touch C1's obtain-verify logic or C2's lock code — both shipped.
- [ ] 0.5 Baseline truth (do not regress these): `pnpm run lint` PASS, TypeScript `pnpm build` PASS. Two known-pre-existing pipeline-test failures (counts-delegated / child-out-of-enum) are NOT this child's regressions — they belong to C3. Run focused vitest, not full `pnpm test`, except in C6.

## 1. M9 — Credential-bearing remotes rejected before obtain

`cloneWithCleanupGuard` (bootstrap.ts:1515) is the single clone chokepoint for
both Store obtain (`obtainAbsentStore` line 1765) and project obtain (line 2912).
It currently passes `remote` straight to `cloneRepository` without any credential
check. The normal write path uses `assertCredentialFreeRemote()` but the obtain
path bypasses it.

- [ ] 1.1 In `src/core/store/bootstrap.ts`, extend the existing import from
  `./remote.js` (currently `redactOptionalRemote`) to also import
  `assertCredentialFreeRemote`.
- [ ] 1.2 In `cloneWithCleanupGuard` (bootstrap.ts ~line 1515), add
  `assertCredentialFreeRemote(remote, 'store.pointer')` as the FIRST statement
  inside the existing `try { ... }` block, before `cloneRepository(remote,
  stagingPath)`. The thrown `StoreError` is caught by the existing catch block,
  which pushes diagnostics (the error message from
  `assertCredentialFreeRemote` already contains only `redactRemote(remote)`) and
  returns `{ ok: false }`. No staging directory exists yet at that point — the
  `fs.rmSync(stagingPath, { recursive: true, force: true })` in the catch block
  is a safe no-op (`force: true`).
- [ ] 1.3 In `src/core/store/git.ts`, import `redactRemote` from `./remote.js`.
  In `cloneRepository` (line ~160), sanitize the error message in the
  clone-failure catch block: compute
  `const rawMessage = error instanceof Error ? error.message : String(error)`
  (this is already done) and then
  `const safeMessage = rawMessage.split(remote).join(redactRemote(remote))`
  before interpolating into the `StoreError` message. This is defense-in-depth:
  the primary gate (1.2) prevents credentials from reaching git at all, but git's
  own error output echoes the URL and a future caller might bypass
  `cloneWithCleanupGuard`.
- [ ] 1.4 Test — credential-bearing remotes rejected before obtain. Add to
  `test/core/store/bootstrap-obtain.test.ts` (or a focused new file if the
  obtain test is too narrow):
  - **https with userinfo**: `https://user:pass@host/repo.git` → the Store is
    NOT cloned; the diagnostic contains the REDACTED form (`<redacted>`) and
    NOT the raw password; no `git clone` process is spawned (assert argv never
    received the raw remote — verify via a mock/spy on `cloneRepository` or
    `execFileAsync`).
  - **git+https with token**: `git+https://token@host/repo.git` → same
    rejection.
  - **Embedded token in path is NOT a false positive**: a path like
    `https://host/repo.git?token=abc` where the URL parser does not see
    userinfo → verify behavior matches `remoteCarriesCredentials` (this is a
    regression-protection test for the existing parser, not a new rejection).
  - **Ordinary SSH remote still works**: `ssh://git@host/repo.git` (the form
    `assertCredentialFreeRemote` explicitly allows) → obtain proceeds normally
    (or at least is NOT rejected for credentials).
  - **Credential-free https still works**: `https://host/repo.git` → obtain
    proceeds normally.
- [ ] 1.5 Test — error message redaction (defense-in-depth). Mock
  `cloneRepository` to throw an error whose `.message` contains the raw remote
  URL. Assert the resulting `StoreError` message contains the REDACTED form and
  NOT the raw credential.
- [ ] 1.6 Gate: `pnpm exec vitest run test/core/store/bootstrap-obtain.test.ts`
  green (plus the new file if you added one).

## 2. M5 — Recoverable backup debris reported as degraded, not empty

`readStoreCatalog` (catalog.ts:345) silently skips
`.rasen-learned-skill-backup-*` directories via `isOsJunkEntryName` (which
returns true for ALL dot-prefixed names). A killed mutation leaves such
directories behind. `loadStoreCatalog` returns only `.records`, so
`effective.ts:596` sees an empty catalog and may destructively reconcile.

- [ ] 2.1 In `src/core/learned-skills/catalog.ts`:
  - Import `LEARNED_SKILL_BACKUP_PREFIX` from `./constants.js` (catalog.ts
    already imports from constants — extend that import).
  - Add `recoverableBackups: string[]` to the `StoreCatalogRead` interface
    (catalog.ts ~line 317-326).
  - Initialize `const recoverableBackups: string[] = []` in `readStoreCatalog`.
  - In the entry loop (line ~350), BEFORE the `isOsJunkEntryName` check, detect
    backup directories:
    ```
    if (entry.isDirectory() && entry.name.startsWith(LEARNED_SKILL_BACKUP_PREFIX)) {
      recoverableBackups.push(entry.name);
      continue;
    }
    ```
  - Return `{ records, unreadable, recoverableBackups }`.
  - Update `loadStoreCatalog` to read the field and discard it (it stays a
    convenience wrapper returning only records — callers that need the
    degraded signal call `readStoreCatalog` directly).
- [ ] 2.2 In `src/core/learned-skills/effective.ts`:
  - Extend the import from `./catalog.js` (line 36) to include
    `readStoreCatalog` alongside `loadStoreCatalog`.
  - At line ~596, replace `loadStoreCatalog(storeCatalogAt(...), 'store')` with
    `readStoreCatalog(storeCatalogAt(...), 'store')`. Destructure
    `{ records: catalogRaw, recoverableBackups }`.
  - When `recoverableBackups.length > 0`, push `status: 'unavailable'` with a
    diagnostic like:
    `store '${store.id}' holds a catalog with a recoverable backup directory
    (${recoverableBackups.join(', ')}); run a learned-skill mutation to
    restore it`
    and repair `['rasen doctor']`. Do NOT push `status: 'member'` with an empty
    catalog — the Store is degraded, not empty.
  - When `recoverableBackups.length === 0`, filter/sort `catalogRaw` as before
    and push `status: 'member'` (unchanged behavior).
- [ ] 2.3 Test — degraded reporting. In `test/core/learned-skills/` (extend
  `mutate.test.ts` or a new `catalog-backup.test.ts`):
  - **Backup present, record absent**: create a catalog directory with a
    `.rasen-learned-skill-backup-<id>-<suffix>` directory (containing a valid
    manifest whose id does NOT match the backup directory name) and NO
    corresponding record directory. Call `readStoreCatalog` → assert
    `records` is empty AND `recoverableBackups` has one entry naming the
    backup directory.
  - **Effective path treats it as degraded**: same setup, call the effective
    resolution → assert the Store fact is `status: 'unavailable'`, NOT
    `status: 'member'`. The overall result status is `'degraded'`.
  - **No destructive reconcile**: same setup, assert no generated files are
    removed (no ownership records are touched).
  - **Clean catalog unchanged**: no backup directories → `recoverableBackups`
    is empty, behavior identical to before (regression protection).
- [ ] 2.4 Gate: `pnpm exec vitest run test/core/learned-skills/` green.

## 3. M10 — normalizeProjectIdentity at every comparison

Export normalizes via `normalizeProjectIdentity()` (trim+lowercase) at
`project-knowledge-home.ts:100`. Import compares strictly to the registry's
original string. Uppercase UUID → lowercase bundle → refused.

- [ ] 3.1 In `src/core/knowledge-bundle/import.ts`, add import of
  `normalizeProjectIdentity` from `../store/project-records.js`.
- [ ] 3.2 At `import.ts:1107`, change:
  `bundle.projectId !== project.ref.projectId`
  to:
  `normalizeProjectIdentity(bundle.projectId) !== normalizeProjectIdentity(project.ref.projectId)`
- [ ] 3.3 At `import.ts:1137-1138`, change each strict comparison to normalize
  both sides:
  - `storeResolution.store.projectId !== canonicalProjectId` →
    `normalizeProjectIdentity(storeResolution.store.projectId ?? '') !== normalizeProjectIdentity(canonicalProjectId ?? '')`
  - `canonicalProjectId !== project.ref.projectId` →
    `normalizeProjectIdentity(canonicalProjectId) !== normalizeProjectIdentity(project.ref.projectId)`
  (Guard against `undefined` / `null` — the surrounding `if` already checks
  for `undefined` via `canonicalProjectId === undefined`, so the normalization
  only runs when the value is a string.)
- [ ] 3.4 In `src/core/project-registry.ts`, add import of
  `normalizeProjectIdentity` from `./store/project-records.js` (it re-exports
  from the store module — verify the path).
- [ ] 3.5 At `project-registry.ts:337` (same-ID lookup):
  `entry.projectId === input.projectId` →
  `normalizeProjectIdentity(entry.projectId) === normalizeProjectIdentity(input.projectId)`
- [ ] 3.6 At `project-registry.ts:465` and `:544`:
  `mainEntry.projectId === entry.projectId` →
  `normalizeProjectIdentity(mainEntry.projectId) === normalizeProjectIdentity(entry.projectId)`
- [ ] 3.7 Test — uppercase UUID export→import roundtrip. In
  `test/core/knowledge-bundle/import.test.ts` (or export.test.ts if it has an
  import harness):
  - Register a project with an UPPERCASE UUID
    (`'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'`).
  - Export a bundle → assert `bundle.projectId` is the lowercase canonical
    form (the existing test at export.test.ts:184-229 already covers this
    side — reuse or extend it).
  - Import the SAME bundle back into a project whose registry carries the
    UPPERCASE UUID → assert import SUCCEEDS (not refused with
    `knowledge_bundle_import_project_mismatch`).
  - Also assert the catalog-drift check at import.ts:1134-1151 does not fire
    for the same case difference.
- [ ] 3.8 Gate: `pnpm exec vitest run test/core/knowledge-bundle/` green.

## 4. Final verification

- [ ] 4.1 `pnpm run lint` — no new violations.
- [ ] 4.2 `pnpm build` — TypeScript compiles.
- [ ] 4.3 Focused test sweep: `pnpm exec vitest run test/core/store/bootstrap-obtain.test.ts test/core/learned-skills/ test/core/knowledge-bundle/ test/core/store/project-records.test.ts` — all green (excluding the two known-pre-existing pipeline failures, which are NOT in these files).
- [ ] 4.4 Commit with explicit pathspec covering ONLY the files this change touched.
