/**
 * Batch store-identity migration (change `store-identity-auto-migrate`).
 *
 * The single-store `upgradeStoreIdentity` writes the Store's own metadata uid
 * and (optionally) the project's `store:` declaration, but it does NOT touch
 * `storeMemberships` hints — so even after a successful upgrade the
 * `storeMembershipsWithoutIdentity` warning keeps firing. And the machine
 * store-registry re-key is gated on ALL stores carrying a uid, so a user must
 * manually loop every store in dependency order.
 *
 * This module provides the batch primitive that resolves both gaps: it writes
 * every store's metadata uid FIRST (so the re-key succeeds), backfills
 * `storeMemberships` hints across all registered projects, upgrades the
 * `store:` declaration of the invoking project, then triggers the registry
 * re-key. Unresolvable stores are reported-and-skipped, never deadlocking.
 *
 * Git discipline mirrors `migration-ops.ts`: writes are real but no commit is
 * ever made; `suggestedCommits` tells the user what to commit per repo.
 */
import * as path from 'node:path';

import { backfillStoreMembershipUid } from '../project-config.js';
import { readProjectRegistryState } from '../project-registry.js';
import {
  getStoreMetadataPath,
  listStoreRegistryEntries,
  readOptionalStoreMetadataState,
  readStoreRegistryState,
  storeMetadataUid,
  updateStoreRegistryState,
  writeStoreMetadataState,
  type StoreMetadataState,
  type StorePathOptions,
  type StoreRegistryEntry,
} from './foundation.js';
import {
  mintStoreUid,
  normalizeStoreUid,
  storeUidsMatch,
} from './identity-types.js';
import { getStoreRootForBackend } from './registry.js';
import { upgradeStoreIdentity } from './upgrade-identity.js';
import {
  renderSuggestedCommit,
  type SuggestedGitCommand,
} from './migration.js';
import { WORKSPACE_DIR_NAME } from '../config.js';
import { getCliLocale } from '../cli-locale.js';
import { formatLocaleMessage, getLocaleCatalog } from '../../locales/index.js';

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Implementation
// -----------------------------------------------------------------------------

/**
 * Migrates every registered store to a permanent identity, backfills
 * `storeMemberships` hints, and triggers the registry re-key. See module
 * header for the full algorithm and the ordering rationale.
 */
export async function migrateAllStoreIdentities(
  input: MigrateAllStoreIdentitiesInput = {}
): Promise<StoreIdentityMigrationResult> {
  const apply = input.apply === true;
  const pathOptions: StorePathOptions =
    input.globalDataDir !== undefined ? { globalDataDir: input.globalDataDir } : {};

  const registry = await readStoreRegistryState(pathOptions);
  if (registry === null) {
    return {
      applied: apply,
      stores: [],
      projects: [],
      registryRekeyed: false,
      registryBlockedBy: [],
      suggestedCommits: [],
    };
  }

  const entries = listStoreRegistryEntries(registry).filter((e) => e.type === 'store');
  const storeResults: StoreIdentityMigrationEntry[] = [];

  // Step 1–3: write every store's metadata uid BEFORE the registry re-key,
  // because the re-key is blocked until every store carries a uid.
  for (const entry of entries) {
    const storeRoot = getStoreRootForBackend(entry.backend);
    const metadataPath = getStoreMetadataPath(storeRoot);

    let metadata: StoreMetadataState | null;
    try {
      metadata = await readOptionalStoreMetadataState(storeRoot);
    } catch {
      storeResults.push({
        id: entry.id,
        root: storeRoot,
        uid: '',
        status: 'skipped',
        reason: 'metadata unreadable',
        filesToCommit: [],
      });
      continue;
    }

    if (metadata === null) {
      storeResults.push({
        id: entry.id,
        root: storeRoot,
        uid: '',
        status: 'skipped',
        reason: 'path missing',
        filesToCommit: [],
      });
      continue;
    }

    if (metadata.id === undefined || metadata.id.length === 0) {
      storeResults.push({
        id: entry.id,
        root: storeRoot,
        uid: '',
        status: 'skipped',
        reason: 'metadata has no display alias',
        filesToCommit: [],
      });
      continue;
    }

    const existingUid = storeMetadataUid(metadata);
    if (existingUid !== undefined) {
      storeResults.push({
        id: entry.id,
        root: storeRoot,
        uid: normalizeStoreUid(existingUid),
        status: 'already-had-identity',
        filesToCommit: [],
      });
      continue;
    }

    // Mint + (optionally) write.
    const uid = mintStoreUid();
    if (apply) {
      try {
        await writeStoreMetadataState(storeRoot, {
          version: 2,
          uid,
          id: metadata.id,
          ...(metadata.remote !== undefined ? { remote: metadata.remote } : {}),
        });
        // Verify read-back.
        const verify = await readOptionalStoreMetadataState(storeRoot);
        if (!storeUidsMatch(storeMetadataUid(verify), uid)) {
          storeResults.push({
            id: entry.id,
            root: storeRoot,
            uid,
            status: 'skipped',
            reason: 'uid written but did not read back',
            filesToCommit: [],
          });
          continue;
        }
      } catch (error) {
        storeResults.push({
          id: entry.id,
          root: storeRoot,
          uid,
          status: 'skipped',
          reason: `write failed: ${error instanceof Error ? error.message : String(error)}`,
          filesToCommit: [],
        });
        continue;
      }
    }

    const relativeMetadataPath = path.relative(storeRoot, metadataPath) || metadataPath;
    storeResults.push({
      id: entry.id,
      root: storeRoot,
      uid: normalizeStoreUid(uid),
      status: 'upgraded',
      filesToCommit: apply ? [relativeMetadataPath] : [],
    });
  }

  // Step 4: backfill storeMemberships hints across all registered projects.
  // Includes BOTH 'upgraded' and 'already-had-identity' stores — a project
  // whose hint was written before the store got its identity still carries
  // an identityless entry that fires the warning. `backfillStoreMembershipUid`
  // is idempotent so backfilling an already-complete hint is a no-op.
  const projectResults: StoreIdentityMigrationProject[] = [];
  if (apply) {
    const storesWithUid = storeResults.filter(
      (s) => s.status === 'upgraded' || s.status === 'already-had-identity'
    );
    if (storesWithUid.length > 0) {
      const projectRegistry = await readProjectRegistryState(pathOptions);
      if (projectRegistry !== null) {
        for (const [projectRoot] of Object.entries(projectRegistry.projects)) {
          for (const store of storesWithUid) {
            try {
              const result = await backfillStoreMembershipUid(projectRoot, {
                id: store.id,
                uid: store.uid,
              });
              if (result.changed) {
                const existing = projectResults.find((p) => p.root === projectRoot);
                if (existing) {
                  existing.hintsBackfilled += 1;
                } else {
                  projectResults.push({
                    root: projectRoot,
                    configPath: result.configPath,
                    hintsBackfilled: 1,
                  });
                }
              }
            } catch {
              // A project whose config is unreadable or missing is skipped
              // silently — the batch never throws on a per-project failure.
            }
          }
        }
      }
    }
  }

  // Step 5: upgrade the invoking project's store: declaration. Includes
  // 'already-had-identity' stores too — their declaration may still be in
  // alias form. `upgradeStoreIdentity` is idempotent: it is a no-op for
  // metadata that already carries a uid and only rewrites the declaration
  // when it is still in alias form (resolveUpgradableProject returns null
  // for an already-durable declaration).
  if (apply && input.projectRoot !== undefined) {
    const storesWithUid = storeResults.filter(
      (s) => s.status === 'upgraded' || s.status === 'already-had-identity'
    );
    for (const store of storesWithUid) {
      try {
        await upgradeStoreIdentity({
          id: store.id,
          uid: store.uid,
          apply: true,
          projectRoot: input.projectRoot,
          ...(input.globalDataDir !== undefined ? { globalDataDir: input.globalDataDir } : {}),
        });
      } catch {
        // Best-effort: the store: declaration upgrade is a bonus on top of
        // the metadata + membership backfill. A failure here is silently
        // skipped; the user can run `rasen store upgrade-identity <id> --apply`
        // manually for the declaration.
      }
    }
  }

  // Step 6: trigger the registry re-key. `updateStoreRegistryState` calls
  // `upgradeStoreRegistryToV2` internally on every write. By now every
  // resolvable store carries a uid; unresolvable ones still block.
  let registryRekeyed = false;
  let registryBlockedBy: string[] = [];
  if (apply) {
    try {
      const registryResult = await updateStoreRegistryState(
        (current) => current ?? registry,
        pathOptions
      );
      registryRekeyed = registryResult.state.version === 2;
      registryBlockedBy = registryResult.blockedBy;
    } catch {
      // If the registry write fails, the stores still have their uids. The
      // re-key will converge on the next mutation.
      const after = await readStoreRegistryState(pathOptions);
      registryRekeyed = after?.version === 2;
    }
  } else {
    // Preview: report what the re-key status would be.
    const after = await readStoreRegistryState(pathOptions);
    registryRekeyed = after?.version === 2;
    if (!registryRekeyed && after !== null) {
      // In preview we can't know exact blockers without reading metadata,
      // but the skipped stores are the obvious candidates.
      registryBlockedBy = storeResults
        .filter((s) => s.status === 'skipped')
        .map((s) => s.id);
    }
  }

  // Step 7: build suggested commits per repo.
  const suggestedCommits: SuggestedGitCommand[] = [];
  // One per store repo whose metadata was written.
  for (const store of storeResults.filter((s) => s.status === 'upgraded' && s.filesToCommit.length > 0)) {
    const commit = renderSuggestedCommit(
      store.root,
      store.filesToCommit,
      `chore(store): record permanent identity for ${store.id}`,
      `Record the permanent identity of store '${store.id}' in its metadata.`
    );
    if (commit) suggestedCommits.push(commit);
  }
  // One per project repo whose membership hints were backfilled. The invoking
  // project's store: declaration rewrite (step 5) touches the same config.yaml,
  // so it is covered by the same commit when both apply.
  for (const project of projectResults) {
    const configRelPath = path.relative(project.root, project.configPath) ||
      path.join(WORKSPACE_DIR_NAME, 'config.yaml');
    const commit = renderSuggestedCommit(
      project.root,
      [configRelPath],
      `chore(store): backfill store-membership identity hints`,
      `Backfill permanent identities into storeMemberships hints so the warning goes silent.`
    );
    if (commit) suggestedCommits.push(commit);
  }
  // The invoking project may have had ONLY its store: declaration upgraded
  // (step 5) without any membership backfill (e.g. the project had no
  // identityless hints but declared the store by alias). In that case add a
  // separate commit.
  if (apply && input.projectRoot !== undefined) {
    const hasProjectCommit = projectResults.some((p) => p.root === input.projectRoot);
    if (!hasProjectCommit) {
      const storesWithUid = storeResults.filter(
        (s) => s.status === 'upgraded' || s.status === 'already-had-identity'
      );
      if (storesWithUid.length > 0) {
        const configRelPath = path.join(WORKSPACE_DIR_NAME, 'config.yaml');
        const commit = renderSuggestedCommit(
          input.projectRoot,
          [configRelPath],
          `chore(store): upgrade store: declaration to durable identity form`,
          `Rewrite the project's store: declaration to name the permanent identity.`
        );
        if (commit) suggestedCommits.push(commit);
      }
    }
  }

  return {
    applied: apply,
    stores: storeResults,
    projects: projectResults,
    registryRekeyed,
    registryBlockedBy,
    suggestedCommits,
  };
}

// -----------------------------------------------------------------------------
// Summary formatting
// -----------------------------------------------------------------------------

/**
 * Human-readable summary lines for the batch migration result. Wired to the
 * `storeIdentityMigration.*` locale keys (en/zh-cn/ja) so the output is
 * localized; falls back to English when a key is missing.
 */
export function formatStoreIdentityMigrationSummary(
  result: StoreIdentityMigrationResult
): string[] {
  const locale = getCliLocale();
  const catalog = getLocaleCatalog(locale);
  const t = catalog.storeIdentityMigration as Record<string, string>;
  const fmt = (key: string, values: Record<string, string | number> = {}): string =>
    t[key] ? formatLocaleMessage(t[key], values) : '';

  const lines: string[] = [];

  const upgraded = result.stores.filter((s) => s.status === 'upgraded');
  const already = result.stores.filter((s) => s.status === 'already-had-identity');
  const skipped = result.stores.filter((s) => s.status === 'skipped');

  if (upgraded.length === 0 && already.length > 0 && skipped.length === 0) {
    lines.push(fmt('allIdentified'));
    return lines;
  }

  if (upgraded.length > 0) {
    lines.push(fmt('upgraded', { count: upgraded.length }));
    for (const store of upgraded) {
      lines.push(`  ${store.id} → ${store.uid}`);
    }
  }

  if (already.length > 0) {
    lines.push(fmt('alreadyIdentified', { count: already.length }));
  }

  if (skipped.length > 0) {
    lines.push(fmt('skipped', { count: skipped.length }));
    for (const store of skipped) {
      lines.push(`  ${store.id} (${store.reason})`);
    }
  }

  if (result.registryRekeyed) {
    lines.push(fmt('rekeyed'));
  } else if (result.registryBlockedBy.length > 0) {
    lines.push(fmt('rekeyBlocked', { stores: result.registryBlockedBy.join(', ') }));
  }

  if (result.projects.length > 0) {
    const totalHints = result.projects.reduce((sum, p) => sum + p.hintsBackfilled, 0);
    lines.push(`Backfilled ${totalHints} membership hint(s) across ${result.projects.length} project(s).`);
  }

  if (result.suggestedCommits.length > 0) {
    lines.push('');
    lines.push('Suggested commits:');
    for (const commit of result.suggestedCommits) {
      lines.push(`  [${commit.purpose}]`);
      lines.push(`    ${commit.command}`);
    }
  }

  return lines;
}
