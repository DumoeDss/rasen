# Tasks: store-identity-auto-migrate

## 1. Core: `backfillStoreMembershipUid` writer

- [ ] 1.1 Add `backfillStoreMembershipUid(projectRoot, { id, uid })` to `src/core/project-config.ts`. It reads the existing `storeMemberships` array, finds entries where `entry.uid === undefined && entry.id === match.id`, sets their `uid`, and writes back via the private `writeStoreMembershipHints`. Returns `{ configPath, changed }`. Wrapped in the same `withOwnerAwareFileLock` + `machineLockPath` pattern as `appendStoreMembershipHint` (project-config.ts:2237).
- [ ] 1.2 Export it from the module's public surface.
- [ ] 1.3 Test in `test/core/project-config-store-memberships.test.ts`:
  - Backfills a uid into an identityless `{ id: "store-a" }` entry → entry becomes `{ uid, id: "store-a" }`.
  - No-op when no matching entry exists (`changed: false`).
  - Preserves other entries, comments, and field ordering (yaml AST round-trip).
  - Does not modify a hint that already has a uid.

## 2. Core: `migrateAllStoreIdentities` batch primitive

- [ ] 2.1 Create `src/core/store/identity-migration.ts` with the types from design D3 (`MigrateAllStoreIdentitiesInput`, `StoreIdentityMigrationEntry`, `StoreIdentityMigrationProject`, `StoreIdentityMigrationResult`).
- [ ] 2.2 Implement `migrateAllStoreIdentities`:
  - Read the machine store registry (`readStoreRegistryState`); return empty result when null.
  - List store entries (`listStoreRegistryEntries`). For each:
    - Read metadata via `readOptionalStoreMetadataState(entry.backend.local_path)` in try/catch → skip on failure with reason.
    - Skip stores that already have a uid (`storeMetadataUid`).
    - Mint a uid (`mintStoreUid`); when `apply`, write via `writeStoreMetadataState` + verify read-back.
  - When `apply`: for each upgraded store, enumerate registered projects (`readProjectRegistryState`) and call `backfillStoreMembershipUid` for projects whose `storeMemberships` has a matching alias entry.
  - When `apply` and `input.projectRoot` is set: call `upgradeStoreIdentity({ id, uid, apply: true, projectRoot })` for each upgraded store to handle the `store:` declaration.
  - Trigger the registry re-key via `updateStoreRegistryState((current) => current ?? registryBefore, pathOptions)`; record `registryRekeyed` and `registryBlockedBy` from the result.
  - Build `suggestedCommits` via `renderSuggestedCommit`, grouping files by repository (store repos + project repos).
- [ ] 2.3 Add a `formatStoreIdentityMigrationSummary(result)` function that returns human-readable lines (upgraded stores with uids, skipped stores with reasons, re-key status, suggested commits). Locale-neutral fallback strings; locale keys added in task 6.
- [ ] 2.4 Test in `test/core/store/identity-migration.test.ts` (new file):
  - **Acceptance test (HARD gate)**: fixture with 2 identityless stores + 1 identified store + a project with `storeMemberships` entries for the identityless stores. Run `migrateAllStoreIdentities({ apply: true })`. Assert:
    - Both stores gained uids in `.rasen-store/store.yaml`.
    - Project `storeMemberships` entries now carry uids.
    - `readProjectConfig` on the project does NOT emit `storeMembershipsWithoutIdentity` (use a reporter that collects diagnostics; assert the key is absent).
    - Registry is re-keyed to v2 (`registry.version === 2`).
  - **Unresolvable store**: add a registry entry whose `local_path` does not exist. Assert it is skipped with reason, the other stores are still upgraded, and `registryBlockedBy` names the missing store.
  - **Preview mode**: run with `apply: false` (or omitted). Assert nothing is written; result reports what would happen.
  - **Idempotent**: run twice with `apply: true`. Second run reports all stores as `already-had-identity`, no writes.
  - **Dogfood fixture**: a store with readable metadata at a real path is upgraded normally (no special-casing).

## 3. CLI: `store upgrade-identity --all`

- [ ] 3.1 In `src/commands/store.ts`, modify the `upgrade-identity` command registration (line 1480) to accept `--all` as an alternative to `<id>`. When `--all` is set, `id` becomes optional and the command delegates to a new `upgradeIdentityAll` method.
- [ ] 3.2 Implement `upgradeIdentityAll(options)`: calls `migrateAllStoreIdentities({ apply: options.apply === true && options.dryRun !== true })`, formats via `formatStoreIdentityMigrationSummary` (human) or `printJson` (JSON). No `projectRoot` passed (the `--all` flag is store-centric).
- [ ] 3.3 Update `src/core/completions/command-registry.ts` to add the `--all` flag to the `upgrade-identity` completion entry.
- [ ] 3.4 Test in `test/commands/store-identity-cli.test.ts`:
  - `rasen store upgrade-identity --all --dry-run` previews without writing.
  - `rasen store upgrade-identity --all --apply` writes and reports.
  - `rasen store upgrade-identity --all --json` outputs valid JSON.
  - `rasen store upgrade-identity <id> --apply` (existing single-store flow) still works unchanged.

## 4. Hook: `rasen update` runs the migration

- [ ] 4.1 In `src/core/update.ts`, add a private `runStoreIdentityMigration(projectPath: string)` method (design D3). Calls `migrateAllStoreIdentities({ apply: true, projectRoot: projectPath })`, formats the summary, catches all errors as best-effort warnings.
- [ ] 4.2 Call it as step 18 in `execute()`, after `offerMultiProjectUpdate` (after line 579), gated on `!this.onlyThis`:
  ```
  if (!this.onlyThis) {
    await this.runStoreIdentityMigration(resolvedProjectPath);
  }
  ```
- [ ] 4.3 Add `displayStoreIdentityMigrationSummary(result)` that prints the summary lines (or a single dim "All registered stores carry a permanent identity." when nothing needed migration).
- [ ] 4.4 Test in `test/core/update-store-identity-migration.test.ts` (new file):
  - **Acceptance test (HARD gate)**: set up a temp `globalDataDir` with identityless stores + a project with identityless `storeMemberships`. Run `UpdateCommand.execute(projectPath)` with `onlyThis: false`. Assert the warning is not emitted during a subsequent `readProjectConfig` of the project.
  - `onlyThis: true` does NOT run the migration (the hook is gated).
  - Migration failure does not abort the update (mock `migrateAllStoreIdentities` to throw; assert the update completes and a warning is printed).

## 5. Warning dedup + message update

- [ ] 5.1 In `src/core/config-diagnostics.ts`, add a module-level `Set<ConfigDiagnosticKey>` for per-process dedup of `output: 'warn'` diagnostics. The default (no-reporter) path of `reportConfigDiagnostic` checks the set before emitting to `console.warn`. Export `_resetConfigDiagnosticDedup` for tests.
- [ ] 5.2 Update the `storeMembershipsWithoutIdentity` locale entry in `src/locales/en.json`, `zh-cn.json`, `ja.json` to point at `rasen update` instead of `rasen store upgrade-identity <store> --apply`.
- [ ] 5.3 Test: parse a config with identityless `storeMemberships` entries multiple times in one process; assert the warning is emitted exactly once. Assert `_resetConfigDiagnosticDedup` re-enables it.

## 6. Locale entries

- [ ] 6.1 Add locale keys for the batch-migration summary in `en` / `zh-cn` / `ja`:
  - `storeIdentityMigration.upgraded` — "Upgraded N store(s): ..."
  - `storeIdentityMigration.skipped` — "Skipped N store(s): ..."
  - `storeIdentityMigration.alreadyIdentified` — "N store(s) already carry a permanent identity."
  - `storeIdentityMigration.rekeyed` — "Re-keyed the machine store registry by permanent identity."
  - `storeIdentityMigration.rekeyBlocked` — "Registry re-key blocked by: ..."
  - `storeIdentityMigration.allIdentified` — "All registered stores carry a permanent identity."
  - `storeIdentityMigration.suggestedCommit` — "Commit these files in <repo>: ..."

## 7. Validate + finalize

- [ ] 7.1 Run `pnpm test` — all existing tests pass (no regression in `store list`, `doctor`, single-store `upgrade-identity`, `update`).
- [ ] 7.2 Run `pnpm tsc --noEmit` — type-clean.
- [ ] 7.3 Manual smoke test: in a scratch project with an identityless store + identityless `storeMemberships`, run `rasen store upgrade-identity --all --dry-run` then `--apply`, confirm the warning is gone on the next command.
- [ ] 7.4 Confirm the acceptance gate: the `storeMembershipsWithoutIdentity` warning does not fire after `migrateAllStoreIdentities` runs.
