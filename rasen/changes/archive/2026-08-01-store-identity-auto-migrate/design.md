# Design: store-identity-auto-migrate

## Context

This design resolves the five questions from the planning context with evidence from the code. Every claim is traced to a file and line range so the apply stage can verify it.

---

## D1. Minimal writes to clear the warning

### Where the warning fires

`parseStoreMembershipList` in `src/core/project-config.ts` (lines 502–608). When any parsed `storeMemberships` hint has `hint.uid === undefined` (line 573), the boolean `identityless` is set, and after the loop the `storeMembershipsWithoutIdentity` warning is emitted (lines 597–605). The warning fires at **parse time** — before any store resolution — so backfilling the uid into the project-side hint is the only way to silence it.

### How a membership hint gains a uid

A `StoreMembershipHint` is `{ uid?: string; id?: string; remote?: string }`. The `uid` comes from the project's own `rasen/config.yaml` `storeMemberships` array — it is written there by `appendStoreMembershipHint` (project-config.ts:2215), which calls `membershipHintFor` (membership.ts:616). `membershipHintFor` includes the uid only when the store already carries one (`store.uid !== undefined`) at the time of writing.

**The gap:** if a project's `storeMemberships` hint was written when the store had no identity, the hint is `{ id: "store-alias" }` (no uid). The existing `upgradeStoreIdentity` (upgrade-identity.ts:212) writes the store-metadata uid and rewrites the `store:` declaration via `writeDurablePointer`, but does **not** touch `storeMemberships`. So even after a successful single-store upgrade, the warning keeps firing for that store's membership hints.

### The exact files a migration writes

| File | When | Git-tracked? | Purpose |
|---|---|---|---|
| `<store>/.rasen-store/store.yaml` | Store lacks a uid | Yes (in the store repo) | Records the minted permanent identity (version 2) |
| `<project>/rasen/config.yaml` | Project has a `storeMemberships` entry naming the store by alias without uid | Yes (in the project repo) | Backfills the uid so the parse-path warning goes silent |
| `~/.rasen/stores/registry.yaml` | After all resolvable stores have uids | No (machine-local) | Re-keyed from v1 (alias-keyed) to v2 (identity-keyed) |

The store-metadata write is handled by the existing `writeStoreMetadataState`. The registry re-key is handled by the existing `updateStoreRegistryState` (which calls `upgradeStoreRegistryToV2` internally). The project-config backfill requires a **new** writer because the hint dedup key changes when a uid is added (see D6).

---

## D2. WHERE `rasen update` is implemented — the hook point

### Locating the module

The update command is **`UpdateCommand` in `src/core/update.ts`** (not `src/commands/update.ts`, which does not exist). It is registered in `src/cli/index.ts:236–254` as `.command('update [path]')`, which constructs `new UpdateCommand(...)` and calls `.execute(targetPath)`.

### The execute flow

`UpdateCommand.execute()` (update.ts:159–580) runs a linear pipeline:
1. Require a rasen workspace
2. One-time migration
3–6. Read global config, resolve profile, resolve tools, check version status
7. Smart update detection (up-to-date short-circuit at line 411)
8–11. Generate skills, update tools, display summary
12–16. Detect new tools, extra workflows, version-cache refresh
17. **Multi-project offer** (`offerMultiProjectUpdate`, line 577) — gated on `!this.onlyThis`

### Chosen hook point

**Step 18: a new `runStoreIdentityMigration` call after `offerMultiProjectUpdate` (after line 579), gated on `!this.onlyThis`.**

Rationale:
- **Once per invocation.** `offerMultiProjectUpdate` creates fresh `UpdateCommand({ onlyThis: true })` instances for other projects (multi-project-update.ts:153). Those recursive calls have `onlyThis: true` and skip the hook, so the migration runs exactly once — in the top-level invocation.
- **After tool/version propagation.** The migration is independent of skill generation, but running it last means the user sees the tool-update summary first (the primary purpose of `update`) and the store-identity pass as a final reconciliation.
- **`--only-this` opts out.** Consistent with the multi-project offer: `rasen update --only-this` updates tools only, without the machine-wide migration. The default `rasen update` (what the user runs to validate the fix) triggers it.
- **Best-effort.** The hook catches all errors, emits at most a warning, and never aborts the update — mirroring `refreshProjectVersionCache` (update.ts:587–607) and `offerMultiProjectUpdate` (update.ts:620, wrapped in try/catch).

### Why not inside `offerMultiProjectUpdate`

The multi-project offer is interactive (prompts the user) and may be skipped entirely. The store-identity migration is non-interactive and should always run when the user runs a plain `rasen update`. Coupling them would mean the migration only runs when the user accepts the multi-project prompt, which contradicts the acceptance criterion.

---

## D3. Batch primitive — `migrateAllStoreIdentities`

### Module

New file: `src/core/store/identity-migration.ts`.

### Interface

```typescript
export interface MigrateAllStoreIdentitiesInput extends StorePathOptions {
  /** Apply the plan; omitted or false previews it and changes nothing. */
  apply?: boolean;
  /**
   * The project whose `store:` declaration should be upgraded too (in addition
   * to `storeMemberships` backfill across all projects). Defaults to the cwd
   * planning root when invoked from `update`; omitted when invoked from the
   * `--all` CLI flag (which is store-centric, not project-centric).
   */
  projectRoot?: string;
}

export interface StoreIdentityMigrationEntry {
  id: string;
  root: string;
  uid: string;
  status: 'upgraded' | 'already-had-identity' | 'skipped';
  /** Present when status is 'skipped'. */
  reason?: string;
  /** Store-root-relative paths the user should commit. */
  filesToCommit: string[];
}

export interface StoreIdentityMigrationProject {
  root: string;
  configPath: string;
  hintsBackfilled: number;
}

export interface StoreIdentityMigrationResult {
  applied: boolean;
  stores: StoreIdentityMigrationEntry[];
  projects: StoreIdentityMigrationProject[];
  registryRekeyed: boolean;
  /** Display aliases still blocking the re-key (unresolvable stores). */
  registryBlockedBy: string[];
  /** One per repository (store repos + project repos). */
  suggestedCommits: SuggestedGitCommand[];
}
```

### Algorithm

```
migrateAllStoreIdentities(input):
  1. registry = readStoreRegistryState(pathOptions)
     if registry is null → return empty result (no stores to migrate)
  2. entries = listStoreRegistryEntries(registry).filter(type === 'store')
  3. FOR each entry:
       a. storeRoot = entry.backend.local_path
       b. metadata = readOptionalStoreMetadataState(storeRoot) [try/catch]
          if path missing or metadata unreadable:
            → record { status: 'skipped', reason: 'path missing' | 'metadata unreadable' }
            → continue
          if metadata has no id:
            → record { status: 'skipped', reason: 'metadata has no display alias' }
            → continue
       c. existingUid = storeMetadataUid(metadata)
          if existingUid is present:
            → record { status: 'already-had-identity', uid: existingUid }
            → continue
       d. uid = mintStoreUid()
          if apply:
            writeStoreMetadataState(storeRoot, { version:2, uid, id, remote? })
            verify read-back
          → record { status: 'upgraded', uid, filesToCommit: [metadataPath] }
  4. IF apply:
       FOR each upgraded store:
         FOR each registered project (from readProjectRegistryState):
           config = readProjectConfig(projectRoot) [try/catch, skip on failure]
           IF config?.storeMemberships has an entry matching store alias with no uid:
             backfillStoreMembershipUid(projectRoot, { id: storeAlias, uid })
             record project { hintsBackfilled }
  5. IF input.projectRoot is set AND apply:
       FOR each upgraded store:
         upgradeStoreIdentity({ id: storeAlias, uid, apply: true, projectRoot })
         [this handles the `store:` declaration via writeDurablePointer]
  6. registryResult = updateStoreRegistryState(current => current, pathOptions)
     [this triggers the internal re-key attempt; returns { state, blockedBy }]
  7. suggestedCommits = build per-repo from filesToCommit (store repos + project repos)
  8. RETURN result
```

### Why the re-key ordering is handled internally

`updateStoreRegistryState` (foundation.ts:778) calls `upgradeStoreRegistryToV2` internally on every write. `upgradeStoreRegistryToV2` (foundation.ts:660) reads each store's metadata uid by path (`readEntryUid`); if ANY store lacks a uid, the re-key is refused and the blockers are named in `blockedBy`. The batch primitive writes all store metadata uids (step 3d) **before** triggering the registry write (step 6), so by the time the re-key runs, every resolvable store carries a uid. Unresolvable stores (skipped in step 3b) will still appear in `blockedBy` — the batch reports them but does not deadlock.

### CLI surface: `store upgrade-identity --all`

The existing command registration (store.ts:1480) is `<id>`. Add an alternative invocation:

```
rasen store upgrade-identity --all [--apply] [--dry-run] [--json]
```

When `--all` is passed, the `id` argument is ignored (or made optional). The command constructs a `MigrateAllStoreIdentitiesInput` and calls `migrateAllStoreIdentities`, then formats the result (human or JSON). No `projectRoot` is passed (the `store:` declaration upgrade is `update`'s concern; the `--all` flag focuses on store metadata + membership hints).

The existing single-store `rasen store upgrade-identity <id>` flow is unchanged.

### `update` hook: `runStoreIdentityMigration`

New private method on `UpdateCommand`:

```typescript
private async runStoreIdentityMigration(projectPath: string): Promise<void> {
  try {
    const { migrateAllStoreIdentities } = await import('./store/identity-migration.js');
    const result = await migrateAllStoreIdentities({
      apply: true,
      projectRoot: projectPath,
    });
    this.displayStoreIdentityMigrationSummary(result);
  } catch (error) {
    // Best-effort: never abort the update.
    console.log(chalk.yellow(
      `Warning: store identity migration could not complete (${
        error instanceof Error ? error.message : String(error)
      }). Run 'rasen store upgrade-identity --all --apply' manually.`
    ));
  }
}
```

Called after `offerMultiProjectUpdate` (step 18, gated on `!this.onlyThis`).

---

## D4. Unresolvable stores — report-and-skip

### The problem

The re-key is gated on ALL stores having uids (D3). A store whose path is gone, whose metadata is unreadable, or that is locked permanently blocks the re-key. The repro includes a dogfood fixture store (`session-context-dogfood-0725`) that exemplifies this risk.

### Resolution

**Report-and-skip at the store level; report at the re-key level.** The batch primitive:

1. **Never throws on a per-store failure.** Each store's metadata read/write is wrapped in try/catch. A failure records `{ status: 'skipped', reason }` and continues.
2. **Re-key is best-effort, not all-or-nothing.** `updateStoreRegistryState` returns `{ blockedBy }` — the batch reports these names in `registryBlockedBy` without failing. If unresolvable stores block the re-key, the registry stays in v1 form (which is still fully readable) and the user is told which stores to clean up (e.g., via `rasen store unregister <id>`).
3. **The dogfood fixture is upgraded if reachable.** If the fixture store has a real checkout with readable metadata, it gets a uid like any other — harmless and unblocks the re-key. If its path is gone, it is skipped and reported.
4. **No store is ever force-unregistered.** Unregistering is a destructive, user-initiated action. The batch reports unresolvable stores; the user decides.

### Summary output

The `displayStoreIdentityMigrationSummary` method prints:
- Upgraded stores (with their new uids)
- Already-identified stores (count only)
- Skipped stores (with reasons)
- Registry re-key status: "re-keyed" or "blocked by: <names>"
- Suggested commits (per repo)

When nothing needed migration, the summary is a single dim line: "All registered stores carry a permanent identity."

---

## D5. Warning noise — dedup and message update

### Primary fix

The auto-migration populates uids, so after `rasen update` the warning stops firing for resolvable stores. This is the main deliverable.

### Secondary fix: message update

The current warning says `run 'rasen store upgrade-identity <store> --apply'`. Since `rasen update` is now the primary remediation path, update the `storeMembershipsWithoutIdentity` locale entry in `en` / `zh-cn` / `ja` to say `run 'rasen update'` (which performs the batch migration).

### Secondary fix: per-run dedup

The warning fires from `parseStoreMembershipList`, which is called by `readProjectConfig` — and `readProjectConfig` is called multiple times per command (each call re-parses and re-warns). A process-scoped dedup ensures the warning fires at most once per invocation.

Implementation: a module-level `Set<string>` in `config-diagnostics.ts` (or `project-config.ts`) keyed by `ConfigDiagnosticKey`. The default (no-reporter) path of `reportConfigDiagnostic` checks the set before emitting. An exported `_resetConfigDiagnosticDedup` function allows tests to reset between cases.

Scope: dedup applies to `output: 'warn'` diagnostics only (not `'error'`). This is deliberately conservative — a warning that the user has already seen should not repeat within the same command, but errors remain loud.

---

## D6. The `storeMemberships` backfill — why a new writer

### The key-change problem

`storeMembershipHintKey` (project-config.ts:365) returns `uid:<uid>` when a uid is present, else `id:<alias>`. So an existing identityless entry `{ id: "rasen-store" }` has key `id:rasen-store`, while a hint carrying a uid `{ uid: "...", id: "rasen-store" }` has key `uid:...`. Calling `appendStoreMembershipHint(projectRoot, { uid, id })` would compute the new hint's key as `uid:...`, fail to match the existing `id:rasen-store` entry, and **append a duplicate** — leaving the identityless entry in place (still firing the warning) alongside the new one.

### The new writer

```typescript
export async function backfillStoreMembershipUid(
  projectRoot: string,
  match: { id: string; uid: string }
): Promise<{ configPath: string; changed: boolean }>
```

Reads the existing `storeMemberships` array via `readProjectConfig`, finds entries where `entry.uid === undefined && entry.id === match.id`, sets `entry.uid = match.uid`, and writes back via the private `writeStoreMembershipHints`. Returns `{ changed: false }` when no entry matched (the project has no membership hint for this store). Wrapped in the same owner-aware file lock as `appendStoreMembershipHint` to serialize concurrent backfills.

This is the minimal, targeted write: it adds the `uid` field to an existing entry without touching any other field, preserving comments and ordering via the yaml document AST (same approach as `writeDurablePointer` and `writeStoreMembershipHints`).

---

## D7. File map for the apply stage

| File | Change |
|---|---|
| `src/core/store/identity-migration.ts` | **NEW** — `migrateAllStoreIdentities`, types, summary formatting |
| `src/core/project-config.ts` | **NEW** `backfillStoreMembershipUid` export; warning message update is locale-side |
| `src/core/update.ts` | **MODIFY** — add `runStoreIdentityMigration` method, call it as step 18 |
| `src/commands/store.ts` | **MODIFY** — add `--all` flag to `upgrade-identity` command + `upgradeIdentityAll` method |
| `src/core/config-diagnostics.ts` | **MODIFY** — add per-run dedup for `'warn'` diagnostics + test reset |
| `src/locales/{en,zh-cn,ja}.json` | **MODIFY** — update `storeMembershipsWithoutIdentity` message; add batch-migration summary locale keys |
| `src/core/completions/command-registry.ts` | **MODIFY** — add `--all` flag to `upgrade-identity` completion entry |
| `test/core/store/identity-migration.test.ts` | **NEW** — batch primitive tests |
| `test/core/project-config-store-memberships.test.ts` | **MODIFY** — add `backfillStoreMembershipUid` tests |
| `test/commands/store-identity-cli.test.ts` | **MODIFY** — add `--all` CLI tests |
| `test/core/update-store-identity-migration.test.ts` | **NEW** — acceptance test: warning goes silent after migration |

---

## D8. Acceptance gate (from planning context)

> After this fix ships, the user rebuilds the dev-local install from this branch and re-runs `rasen update`; the `storeMembershipsWithoutIdentity` warning MUST no longer fire on the following operations.

The acceptance test (D7, last file) sets up:
1. A temp `globalDataDir` with a machine store registry containing 2 identityless stores and 1 store with an identity.
2. Each identityless store has a real checkout with version-1 metadata (no uid).
3. A registered project whose `rasen/config.yaml` has `storeMemberships: [identityless-store-a, identityless-store-b]`.
4. Run `migrateAllStoreIdentities({ apply: true })`.
5. Assert: both stores gained uids in their `.rasen-store/store.yaml`.
6. Assert: the project's `storeMemberships` entries now carry uids.
7. Assert: re-parsing the project config with `readProjectConfig` does NOT emit `storeMembershipsWithoutIdentity`.
8. Assert: the registry is re-keyed to v2.
9. Add a third store whose path does not exist → assert it is skipped, the other two are still upgraded, and the re-key reports the missing store as blocking.

This mirrors the fixture style in `test/core/store/identity.test.ts` (lines 48–100): `mkdtempSync` + `writeStoreMetadataState` + `registerStore` + `readStoreRegistryState`.
