## 0. Ground rules

- [ ] 0.1 Stage with explicit pathspecs only. Never `git add -A`.
- [ ] 0.2 Use `path.join()` / `path.resolve()` for every path, in source and in tests. No hardcoded separators.
- [ ] 0.3 Do not touch any finding outside {B3, B4, M1, M2, M11}. Other findings belong to sibling children.
- [ ] 0.4 Do NOT edit `rasen/specs/store-bootstrap/spec.md` or its Purpose line. The Purpose update is child C6 (finding M12). This change reconciles code to existing spec; no delta spec is authored.
- [ ] 0.5 Baseline truth (do not regress these): `pnpm run lint` PASS, TypeScript `pnpm build` PASS. Two known-pre-existing pipeline-test failures (counts-delegated / child-out-of-enum) are NOT this child's regressions — they belong to C3. Run focused vitest, not full `pnpm test`, except in C6.

## 1. M11 — Metadata probe at the routing seam (do FIRST; B4 reuses the helper)

`bootstrap.ts:2933-2938` swallows every exception to `null` then routes on
`existsSync(getStoreMetadataDir(root))` (modern dir only). A corrupt legacy-only
`.openspec-store/store.yaml` misroutes to Project-first and can report
`origin: project, state: complete`.

- [ ] 1.1 In `src/core/store/foundation.ts`, add a new export
  `probeStoreMetadataState(storeRoot: string): Promise<StoreMetadataProbe>` where
  `StoreMetadataProbe` is a discriminated union:
  - `{ kind: 'absent' }` — neither `getStoreMetadataPath` nor
    `getLegacyStoreMetadataPath` exists as a file.
  - `{ kind: 'valid'; metadata: StoreMetadataState; path: string }` — the first
    existing file (modern first, legacy second, via the existing
    `resolveReadableStoreMetadataPath`) parses successfully.
  - `{ kind: 'unreadable'; path: string; failure: unknown }` — a metadata file
    exists at one or both locations but parsing threw. `path` names the file that
    exists (prefer modern when both exist; otherwise legacy).
  Reuse `pathIsFile`, `readStoreMetadataState`, and
  `resolveReadableStoreMetadataPath` — do NOT duplicate the location logic.
- [ ] 1.2 In `src/core/store/bootstrap.ts` `buildBootstrapReport` (around line
  2933), replace `readOptionalStoreMetadataState(root).catch(() => null)` and
  the `fs.existsSync(getStoreMetadataDir(root))` check with a single
  `probeStoreMetadataState(root)` call. Routing becomes:
  - `valid` → `buildStoreFirstReport(input, root)` (unchanged behavior).
  - `unreadable` → return a blocked report naming `probe.path` and the failure
    (reuse the existing `blocked()` / `unreadableState()` helpers used elsewhere
    in bootstrap.ts). Do NOT fall through to `buildProjectReport`.
  - `absent` → `buildProjectReport(input)` (unchanged behavior).
- [ ] 1.3 Confirm `buildStoreFirstReport` (bootstrap.ts:2524-2529) already
  handles corrupt modern metadata by returning blocked. It does — no change
  needed there, but verify the path still works after the routing change.
- [ ] 1.4 Test: extend `test/core/store/bootstrap-obtain.test.ts` (or a new file
  `bootstrap-metadata-probe.test.ts` in the same directory if the obtain file
  is too narrow) with three cases at the routing seam:
  - **absent**: no modern or legacy metadata → Project-first report (existing
    behavior, regression-protected).
  - **valid legacy-only**: write valid metadata at
    `.openspec-store/store.yaml` only → Store-first report succeeds.
  - **unreadable legacy-only**: write garbage at
    `.openspec-store/store.yaml` only, no modern dir → report is `blocked`,
    names the legacy file, does NOT report Project-first.
  - **unreadable modern**: write garbage at `.rasen-store/store.yaml` → report
    is `blocked`, names the modern file. (This already worked via
    `buildStoreFirstReport`'s own try/catch; assert it still does after the
    routing change.)
- [ ] 1.5 Gate: `pnpm exec vitest run test/core/store/bootstrap-obtain.test.ts`
  green (plus the new file if you added one).

## 2. M2 — Thread `globalDataDir` through `registerExistingStore`

`operations.ts:945-1071` always uses the default registry path; the three
bootstrap call sites at 1635, 1824, 2607 drop `BootstrapInput.globalDataDir`.

- [ ] 2.1 In `src/core/store/operations.ts`, extend
  `RegisterExistingStoreInput` (line 222) to extend `StorePathOptions`:
  ```ts
  export interface RegisterExistingStoreInput extends StorePathOptions {
    path?: string;
    id?: string;
    allowCreateIdentity?: boolean;
    type?: RegistryEntryType;
  }
  ```
  (Or add `globalDataDir?: string` directly if extending is undesirable — but
  `StorePathOptions` is the established pattern, see `RegisterStoreInput`,
  `ResolveRegisteredStoreInput`, etc. in registry.ts.)
- [ ] 2.2 Inside `registerExistingStore`, every call that currently takes an
  implicit default registry path — `readStoreRegistryState()`,
  `commitStoreRegistration({ ... })`, `findRegistryEntryKeys(...)`,
  `isRegisteredAtPath(...)` — now receives the `StorePathOptions` derived from
  `input`:
  ```ts
  const pathOptions: StorePathOptions =
    input.globalDataDir !== undefined ? { globalDataDir: input.globalDataDir } : {};
  ```
  Follow the exact pattern already used at `bootstrap.ts:1932-1933` and
  `bootstrap.ts:2499-2500` (and `migration-ops.ts:401`, `:824`, `:1004`).
- [ ] 2.3 In `src/core/store/bootstrap.ts`, update the three call sites to pass
  `globalDataDir`:
  - line 1635 (obtain Store flow): `registerExistingStore({ path: location.path, globalDataDir: input.globalDataDir })`
  - line 1824 (present-unregistered → register): `registerExistingStore({ path: entry.root, globalDataDir: input.globalDataDir })`
  - line 2607 (Store-first apply, register own checkout): `registerExistingStore({ path: canonicalRoot, globalDataDir: input.globalDataDir })`
  (`input` is `BootstrapInput` which already extends `StorePathOptions`, so
  `input.globalDataDir` is the source of truth.)
- [ ] 2.4 Test: in `test/core/store/` (new file
  `register-existing-store-data-dir.test.ts` or extend an existing operations
  test), add the A≠B three-path test:
  - Set `globalDataDir = A`. `registerExistingStore({ path: storeRoot, globalDataDir: A })`.
    Assert A's `registry.yaml` has the entry; default XDG's does not.
  - Set `globalDataDir = B`. Register a second store via
    `registerExistingStore({ path: storeRoot2, globalDataDir: B })`.
    Assert B's registry has it; A's is unchanged; default still empty.
  - Without `globalDataDir` (default XDG path). Register a third store.
    Assert default registry has it; A and B are unchanged.
  Three disjoint registries, three disjoint writes — proves the option threads.
- [ ] 2.5 Gate: `pnpm exec vitest run test/core/store/` green.

## 3. B3 — Clone through an exclusive staging directory

`bootstrap.ts:1508-1548` `cloneWithCleanupGuard` records
`targetExistedBefore = fs.existsSync(target)` then deletes target on failure if
previously absent. Two processes racing on the same absent target → B can delete
A's successful checkout.

- [ ] 3.1 Rewrite `cloneWithCleanupGuard` in `src/core/store/bootstrap.ts` to
  use a staging directory:
  - Compute `stagingPath = <target> + '.rasen-stage.' + process.pid + '.' + crypto.randomBytes(6).toString('hex')`.
    Same filesystem as target (sibling), so `fs.rename` is atomic.
  - Clone into `stagingPath` (not `target`). On clone failure: `rm -rf
    stagingPath` only (this txn's exclusive dir). NEVER touch `target`.
  - On clone success: return `{ ok: true, stagingPath }`. Do NOT publish yet —
    the B4 verify step runs against `stagingPath` before the publish rename.
  - Remove the `targetExistedBefore` return value; the new return type is
    `{ ok: true; stagingPath: string } | { ok: false }`.
  - Remove the `bootstrap_obtain_target_preserved` diagnostic code (the
    pre-existing-target branch no longer exists — the target is never touched
    until the atomic publish).
- [ ] 3.2 The publish step (atomic `fs.rename(stagingPath, target)`) is a new
  helper, used by BOTH Store obtain and Project obtain after their respective
  identity checks pass:
  - `fs.rename(stagingPath, target)` — on success, the publish is complete.
  - On `EEXIST` (or any error indicating target now exists): another process
    won the race (or the target appeared between location selection and
    publish). Fail closed: keep the staging dir for inspection, push a
    diagnostic naming both paths and an `rm -rf <stagingPath>` command for
    cleanup. Do NOT attempt to delete target.
  - On other rename errors (cross-device, permissions): same — keep staging,
    report, do not delete target.
- [ ] 3.3 Update `obtainAbsentStore` (bootstrap.ts:1563-1657) to call the new
  publish helper AFTER the B4 identity check (added in §4) passes, then call
  `registerExistingStore` against the published `location.path`.
- [ ] 3.4 Update the Project obtain block (bootstrap.ts:2710-2740) to use the
  same staging-clone → identity-verify (M1) → publish → register flow. The
  current direct clone into `location.path` is replaced; the cleanup guard
  behavior moves into the staging step.
- [ ] 3.5 Remove the now-dead `targetExistedBefore` branch and its test
  (`test/core/store/bootstrap-obtain.test.ts:290-319` — the
  "guard cleans up a self-created directory when the clone fails" test). Replace
  with a new test asserting the staging-dir cleanup behavior (clone failure →
  staging dir removed, target never created).
- [ ] 3.6 Keep the existing "pre-existing target survives" test
  (`bootstrap-obtain.test.ts` ~260-288 — the one using
  `bootstrap_obtain_target_preserved`). The behavior changes: the clone now goes
  into a staging sibling; the pre-existing target is NEVER touched at any step.
  Rewrite the assertions to check the target is untouched AND no staging dir
  remains after the run.
- [ ] 3.7 Test (NEW, the cross-process regression the review demands): two
  concurrent `cloneWithCleanupGuard` calls (or two `obtainAbsentStore`
  invocations) targeting the same absent path, driven in parallel via
  `Promise.all`. Both use separate staging dirs. Assert:
  - Exactly one publish rename succeeds; the winner's target exists.
  - The loser's rename fails EEXIST; the loser's staging dir is preserved
    (inspection) OR cleaned up by the loser's own `rm -rf` — assert one or the
    other deterministically given the test's own orchestration.
  - The winner's target contains a valid git checkout; neither process deleted
    the other's work.
  (Use two local file:// remotes seeded via `makeRemoteStore` and real
  `Promise.all` concurrency. The OS-level rename atomicity is the
  correctness anchor.)
- [ ] 3.8 Gate: `pnpm exec vitest run test/core/store/bootstrap-obtain.test.ts`
  green.

## 4. B4 — Verify Store clone identity before register

`bootstrap.ts:1626-1655` registers the clone then marks it `verified` without
re-reading metadata. A wrong/swap remote is registered as the expected Store.

- [ ] 4.1 In `src/core/store/bootstrap.ts` `obtainAbsentStore`, between the
  successful clone (now into `stagingPath`) and `registerExistingStore`, add an
  identity verification block that mirrors the Project-side pattern at
  bootstrap.ts:2720-2740:
  ```ts
  // Identity verification (canonical spec: "A mismatched checkout writes
  // nothing"). Re-read the clone's Store metadata and compare its permanent
  // UID against what the project declared. Missing/unreadable/mismatch →
  // fail closed; the staging dir is left in place for inspection.
  if (entry.uid !== undefined) {
    const probe = await probeStoreMetadataState(stagingPath);
    if (probe.kind === 'absent') { /* fail closed */ }
    else if (probe.kind === 'unreadable') { /* fail closed */ }
    else { /* valid: compare storeMetadataUid(probe.metadata) vs entry.uid */ }
  }
  ```
  Use the existing `storeUidsMatch` / `storeMetadataUid` helpers from
  `src/core/store/foundation.ts` and `src/core/store/identity-types.ts`.
- [ ] 4.2 Failure handling for ALL three fail-closed branches (absent,
  unreadable, mismatch):
  - `entry.action = 'obtain-failed'`
  - Push a diagnostic with `severity: 'error'`,
    `code: 'bootstrap_obtain_identity_mismatch'` (reuse the existing code from
    the Project side), message naming both expected and found (or
    "missing"/"unreadable"), and `target: 'store.uid'`.
  - Push a second diagnostic with `severity: 'warning'`,
    `code: 'bootstrap_obtain_clone_identity_unverified'` naming the staging
    path and an `rm -rf <stagingPath>` command (the user may want to inspect
    before deleting).
  - Do NOT call `registerExistingStore`. Registry is zero-write.
  - Do NOT delete `stagingPath` (keep for inspection).
  - Return `'obtain-failed'`.
- [ ] 4.3 Only when identity verifies (or `entry.uid === undefined`, the rare
  alias-only path) does the flow proceed to the publish rename (§3.3) and then
  `registerExistingStore`.
- [ ] 4.4 Tests in `test/core/store/bootstrap-obtain.test.ts` (the cases the
  review demands):
  - **wrong-UID**: declare Store with `uid: A` in the project; clone remote
    whose metadata has `uid: B`. Assert `entry.action === 'obtain-failed'`,
    the registry at `globalDataDir` is empty (zero-write), the staging dir
    exists at the reported path, and the target path does NOT exist (no
    publish).
  - **missing-UID**: declare Store with `uid: A`; clone a remote whose Store
    metadata file is entirely absent (no `.rasen-store/store.yaml`, no
    `.openspec-store/store.yaml`). Assert the same fail-closed shape.
  - **unreadable-metadata**: declare Store with `uid: A`; clone a remote whose
    `.rasen-store/store.yaml` is corrupt YAML. Assert the same fail-closed
    shape; the diagnostic names the corrupt file.
  - (No-expected-UID path: assert that obtaining a remote with no declared UID
    still succeeds and registers via `allowCreateIdentity`. Regression-protects
    the legacy bootstrap-creates-identity flow.)
- [ ] 4.5 Gate: focused vitest on `bootstrap-obtain.test.ts` green.

## 5. M1 — Project obtain treats missing/unreadable identity as fail-closed

`bootstrap.ts:2725-2740` only rejects an explicit mismatch; missing or
unreadable cloned `projectId` still registers.

- [ ] 5.1 In the Project obtain block (now restructured to use the staging flow
  from §3.4), expand the identity check. After successful clone and before
  publish:
  - Re-read the cloned project config via the existing `readProjectConfig`
    helper. If the read throws or returns `null`:
    - `project.action = 'obtain-failed'`
    - Diagnostic `code: 'bootstrap_obtain_identity_unreadable'` (or reuse the
      existing `bootstrap_project_identity_unreadable` from the membership
      verify path — bootstrap.ts around line 2904-2911), naming the clone path
      and reporting "could not be read".
    - Keep the staging dir in place (inspection). Registry zero-write.
    - `continue`.
  - If config is readable but `projectId` is `undefined`:
    - Same fail-closed shape. Diagnostic code
      `bootstrap_obtain_identity_missing`.
  - If `normalizeProjectIdentity(clonedProjectId) !==
    normalizeProjectIdentity(project.projectId)`:
    - Existing mismatch branch — unchanged behavior, just restated in the new
      flow.
- [ ] 5.2 Tests (the cases the review demands for the project side):
  - **wrong-ID**: Store records project as `X`; cloned project declares `Y`.
    Fail closed; registry zero-write; target absent.
  - **missing-ID**: cloned project's config has no `projectId`. Fail closed.
  - **unreadable-config**: cloned project's `rasen.config.yaml` is malformed
    (or `project.yaml` — whichever `readProjectConfig` reads). Fail closed.
- [ ] 5.3 Gate: `pnpm exec vitest run test/core/store/bootstrap-obtain.test.ts`
  green.

## 6. Integration and review readiness

- [ ] 6.1 Run `pnpm run lint` and `pnpm build` (TypeScript). Both must pass.
- [ ] 6.2 Run the focused suite for everything this child touches:
  `pnpm exec vitest run test/core/store/ test/commands/store.test.ts`.
  Confirm no regressions beyond the two known pipeline-test failures owned by
  C3 (which this child does not touch anyway).
- [ ] 6.3 Verify no canonical spec file under `rasen/specs/` is modified by
  this child (`git diff --name-only rasen/specs/` should be empty for this
  child's commits). The Purpose update is C6's job.
- [ ] 6.4 Verify the `store-bootstrap` spec requirements cited in proposal.md
  still read exactly as cited (no incidental edits):
  - Line 34-38 (machine state unreadable → blocked)
  - Line 360-371 (failed retrieval cleanup provably safe)
  - Line 395-399 (mismatched checkout writes nothing)
- [ ] 6.5 Commit with explicit pathspec covering ONLY:
  `src/core/store/bootstrap.ts`, `src/core/store/operations.ts`,
  `src/core/store/foundation.ts`, and the test files this child authored or
  modified. No `git add -A`, no wide `rasen/changes/` pathspec.
