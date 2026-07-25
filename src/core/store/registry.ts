import * as fs from 'node:fs/promises';

import {
  getStoreMetadataPath,
  getStoreMetadataDir,
  copyForwardLegacyStoreMetadata,
  downgradeStoreRegistryToV1,
  findRegistryEntryByUid,
  findRegistryEntryKeys,
  listStoreRegistryEntries,
  readStoreRegistryState,
  readOptionalStoreMetadataState,
  registryKeyFor,
  resolveGitStoreBackendConfig,
  storeMetadataUid,
  updateStoreRegistryState,
  validateStoreId,
  validateStoreSelector,
  writeStoreMetadataState,
  type RegistryEntryType,
  type StoreBackendConfig,
  type StoreGitBackendConfig,
  type StoreMetadataState,
  type StorePathOptions,
  type StoreRegistryEntry,
  type StoreRegistryEntryState,
  type StoreRegistryState,
} from './foundation.js';
import { StoreError } from './errors.js';
import { isAllDigitAlias, isValidStoreUid, storeUidsMatch } from './identity-types.js';
import {
  storeAliasNumeric,
  storeAliasRenamed,
  storeRegistryRekeyBlocked,
} from './identity-diagnostics.js';
import type { StoreDiagnostic } from './errors.js';
import * as path from 'node:path';
import { FileSystemUtils } from '../../utils/file-system.js';

export interface RegisterStoreInput extends StorePathOptions {
  id: string;
  localPath: string;
  remote?: string;
  branch?: string;
  cwd?: string;
}

export interface ResolveRegisteredStoreInput extends StorePathOptions {
  id: string;
  /** Registry namespace to resolve from; absent means store (compat default). */
  type?: RegistryEntryType;
}

export interface GetRegisteredStoreInput extends ResolveRegisteredStoreInput {
  expectedBackend?: StoreGitBackendConfig;
}

export interface UnregisterStoreInput extends StorePathOptions {
  id: string;
  /** Registry namespace to unregister from; absent means store (compat default). */
  type?: RegistryEntryType;
  expectedBackend?: StoreGitBackendConfig;
  beforeCommit?: (entry: RegisteredStoreEntry) => Promise<void>;
}

export type ListRegisteredStoresOptions = StorePathOptions;

export interface RegisteredStoreEntry extends StoreRegistryEntry {
  storeRoot: string;
}

/**
 * A removed registration, plus the store entries that kept the registry
 * alias-keyed after the removal, so `unregister` and `remove` report the
 * pending identity upgrades exactly as `register` and `setup` do.
 */
export interface StoreUnregistration extends RegisteredStoreEntry {
  rekeyBlockedBy: string[];
}

export interface ResolvedStore {
  id: string;
  storeRoot: string;
  backend: StoreGitBackendConfig;
  /**
   * The Store's permanent identity, when it has one. Absent for a Store whose
   * metadata predates identities. A caller that must RE-RESOLVE this Store
   * later passes `uid ?? id`: the display name alone is ambiguous the moment
   * two Stores share it, which is precisely when the identity was used to name
   * it in the first place. Display, messages, and recorded declarations use
   * `id`.
   */
  uid?: string;
}

export interface StoreRegistrationCommit extends ResolvedStore {
  metadataCreated: boolean;
  registryUpdated: boolean;
  alreadyRegistered: boolean;
  /** The Store's permanent identity; absent for legacy metadata. */
  uid?: string;
  /** True when the registry entry's display alias was updated in place. */
  aliasRenamed: boolean;
  /** The display alias the entry carried before a rename, for reporting it. */
  previousId?: string;
  diagnostics: StoreDiagnostic[];
}

export interface CommitStoreRegistrationInput extends StorePathOptions {
  id: string;
  backend: StoreGitBackendConfig;
  writeMetadataIfMissing: boolean;
  /** Registry namespace to commit into; absent means store. */
  type?: RegistryEntryType;
  /**
   * The identity this checkout is expected to carry. Verified BEFORE any
   * write, so a mismatch fails having written nothing (design D6).
   */
  expectedUid?: string;
}

export function getStoreRootForBackend(backend: StoreBackendConfig): string {
  switch (backend.type) {
    case 'git':
      return backend.local_path;
  }
}

function normalizePathForComparison(targetPath: string): string {
  try {
    return FileSystemUtils.canonicalizeExistingPath(targetPath);
  } catch {
    // Nonexistent (e.g. stale) paths still deserve a resolved compare;
    // aligns with the operations.ts sibling fallback.
    return path.resolve(targetPath);
  }
}

/**
 * Conflict checks key on the `(type, id)` / `(type, canonical path)` pair
 * (design D2): a store and a project sharing an id or a path are never a
 * conflict with each other — only entries of the SAME type collide. The
 * `store_id_conflict` / `store_path_conflict` codes stay stable across both
 * namespaces; only the message/fix text is namespace-aware, and the project
 * namespace's id-conflict fix names the taken id with a concrete `--as`
 * example (task 2.2).
 */
export function assertNoRegisteredStoreConflict(
  registry: StoreRegistryState | null,
  type: RegistryEntryType,
  id: string,
  backend: StoreGitBackendConfig,
  uid?: string
): void {
  const nextPath = normalizePathForComparison(getStoreRootForBackend(backend));
  const noun = type === 'project' ? 'Project' : 'Store';
  const entries = listStoreRegistryEntries(registry ?? { version: 1, stores: {} });
  const sameNameCount = entries.filter(
    (candidate) => candidate.type === type && candidate.id === id
  ).length;

  for (const entry of entries) {
    if (entry.type !== type) {
      continue;
    }

    const entryPath = normalizePathForComparison(getStoreRootForBackend(entry.backend));

    if (entry.id === id && entryPath === nextPath) {
      continue;
    }

    // One checkout per store IDENTITY: keyed on the permanent identity rather
    // than on whichever display name the store carries right now.
    if (uid !== undefined && entry.uid !== undefined && storeUidsMatch(entry.uid, uid)) {
      if (entryPath !== nextPath) {
        throw new StoreError(
          `A store with this permanent identity is already registered as '${entry.id}' at ${getStoreRootForBackend(entry.backend)}. One checkout per store identity is supported on this machine.`,
          'store_id_conflict',
          {
            target: 'store.id',
            // By identity, not by name: the incumbent may share its display
            // name with another store, which would make the suggested
            // unregister ambiguous.
            fix: `Run rasen store unregister ${entry.uid ?? entry.id} first to move this identity to a different checkout.`,
          }
        );
      }
      continue;
    }

    // In the STORE namespace a repeated display alias is no longer a conflict
    // once identities can tell the two apart: a store is identified by its
    // permanent identity and the repeat is resolved by the arity rules. The
    // project namespace keeps its (type, id) uniqueness untouched.
    if (entry.id === id && type === 'store' && uid !== undefined && entry.uid !== undefined) {
      continue;
    }

    if (entry.id === id) {
      // Naming ONE incumbent would be a lie once several share the display
      // name, and `unregister <name>` would then be ambiguous itself — so the
      // message counts them and the fix names what actually works: a checkout
      // that carries its own permanent identity may share a display name.
      const where =
        sameNameCount > 1
          ? `${sameNameCount} registered stores already use the name '${id}'.`
          : `${noun} '${id}' is already registered at ${getStoreRootForBackend(entry.backend)}. One checkout per ${type} id is supported on this machine.`;
      throw new StoreError(where, 'store_id_conflict', {
        target: 'store.id',
        fix:
          type === 'project'
            ? `'${id}' is already taken in the project namespace. Rerun with --as <id>, for example --as ${id}-2.`
            : sameNameCount > 1
              ? // `unregister <name>` would itself be ambiguous here, so the
                // escape hatch has to be the identity, not the name.
                `${sameNameCount} registered stores already use this display name, so unregistering it by name is ambiguous. Name the permanent identity of the one you mean (rasen store list shows each), or choose a different name.`
              : uid === undefined
                ? // Neither side carries an identity, so the display name is
                  // all there is to tell them apart: one checkout per name.
                  `Use the existing registration, or run rasen store unregister ${id} first to switch this id to a different checkout.`
                : // This checkout carries an identity but the registered one
                  // does not, so they cannot be told apart yet.
                  `Use the existing registration, or run rasen store unregister ${id} first. Two stores may share a display name once each carries a permanent identity — give the registered one its own with rasen store upgrade-identity ${id} --apply.`,
      });
    }

    if (entryPath === nextPath) {
      throw new StoreError(
        `${noun} path is already registered as '${entry.id}'.`,
        'store_path_conflict',
        {
          target: 'store.root',
          fix: `Use the existing '${entry.id}' registration or choose a different path.`,
        }
      );
    }
  }
}

function withRegisteredStore(
  registry: StoreRegistryState | null,
  type: RegistryEntryType,
  id: string,
  backend: StoreGitBackendConfig,
  uid?: string
): StoreRegistryState {
  assertNoRegisteredStoreConflict(registry, type, id, backend, uid);

  // The registry is identity-keyed exactly when every store entry has an
  // identity. Registering a store that has none yet moves it back to the
  // alias-keyed form rather than inventing one — a mixed fleet is a supported,
  // indefinite state (design D7).
  let current = registry;
  if (type === 'store' && !uid && current?.version === 2) {
    const downgraded = downgradeStoreRegistryToV1(current);
    if (downgraded.collisions.length > 0) {
      throw new StoreError(
        `Registering '${id}' without a permanent identity would collapse the registry onto display names, and these names are shared by more than one store: ${downgraded.collisions.join(', ')}.`,
        'store_id_conflict',
        {
          target: 'store.registry',
          fix: `Run rasen store upgrade-identity ${id} --apply first so this store keeps its own identity.`,
        }
      );
    }
    current = downgraded.state;
  }

  const version = current?.version ?? 1;
  const stores: Record<string, StoreRegistryEntryState> = { ...(current?.stores ?? {}) };

  if (type === 'store' && version === 2 && uid) {
    // Keyed by the unchanged permanent identity, so an alias rename rewrites
    // only the entry's display name (design D11).
    stores[registryKeyFor(type, id, { version, uid })] = { id, backend };
  } else if (type === 'store' && uid) {
    // A v1 registry still keys by alias, so renaming the alias of an
    // already-registered checkout must drop the stale key rather than leave
    // the same checkout registered twice.
    const previousAlias = findV1AliasForCheckout(current, backend);
    if (previousAlias !== null && previousAlias !== id) {
      delete stores[previousAlias];
    }
    stores[registryKeyFor(type, id)] = { backend };
  } else {
    // Never inject a `type` key onto a store entry (byte-stability, task 1.4).
    stores[registryKeyFor(type, id)] = type === 'project' ? { type, backend } : { backend };
  }

  return {
    version,
    stores: Object.fromEntries(
      Object.entries(stores).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    ),
  };
}

/**
 * The v1 alias key currently registered for a checkout. Path-compared
 * canonically so a Windows drive-letter or separator difference never hides
 * the rename.
 */
function findV1AliasForCheckout(
  registry: StoreRegistryState | null,
  backend: StoreGitBackendConfig
): string | null {
  if (!registry || registry.version !== 1) return null;
  const wantedPath = normalizePathForComparison(getStoreRootForBackend(backend));

  for (const [key, entry] of Object.entries(registry.stores)) {
    if ((entry.type ?? 'store') !== 'store') continue;
    if (normalizePathForComparison(getStoreRootForBackend(entry.backend)) === wantedPath) {
      return key;
    }
  }
  return null;
}

/**
 * Type-aware registry lookup (mirrors the write path's `registryKeyFor`
 * seam): resolves the `(type, id)` key, and when it misses but the OTHER
 * namespace has an entry for the same id, the diagnostic hints the flag
 * that would find it instead of reporting a flatly "unknown" id.
 */
function getRegisteredStoreOrThrow(
  registry: StoreRegistryState | null,
  type: RegistryEntryType,
  id: string
): StoreRegistryEntry & { key: string } {
  // A permanent identity is exact and never consults the alias index — and it
  // is the only way to name one of two Stores that share a display name, so
  // every lookup surface accepts it, not just `--store`.
  if (type === 'store' && isValidStoreUid(id)) {
    const byUid = findRegistryEntryByUid(registry, id);
    if (byUid) {
      return {
        id: byUid.id,
        type,
        key: byUid.key,
        uid: byUid.uid,
        backend: byUid.entry.backend,
      };
    }
    throw new StoreError(`Unknown store '${id}'.`, 'store_not_found', {
      target: 'store.id',
      fix: 'Run rasen store list to see the registered stores and their permanent identities.',
    });
  }

  const matches = findRegistryEntryKeys(registry, type, id);

  if (matches.length === 0) {
    const noun = type === 'project' ? 'project' : 'store';
    const otherType: RegistryEntryType = type === 'project' ? 'store' : 'project';
    const hasOtherType = findRegistryEntryKeys(registry, otherType, id).length > 0;

    throw new StoreError(`Unknown ${noun} '${id}'`, 'store_not_found', {
      target: 'store.id',
      fix: hasOtherType
        ? `'${id}' is registered as a ${otherType}, not a ${noun}. ${otherType === 'project' ? 'Rerun with --project-namespace.' : 'Rerun without --project-namespace.'}`
        : 'Run rasen store list to see registered stores.',
    });
  }

  if (matches.length > 1) {
    const rendered = matches
      .map((match) => `${match.uid ?? '(no identity)'} at ${getStoreRootForBackend(match.entry.backend)}`)
      .join('; ');
    throw new StoreError(
      `The name '${id}' matches ${matches.length} registered stores: ${rendered}. A name is a display alias, not an identity.`,
      'store_alias_ambiguous',
      {
        target: 'store.id',
        // A placeholder, never a candidate: naming one here would pick for the
        // user on a command that then unregisters or deletes it.
        fix: 'Name the permanent identity of the one you mean instead of the display name (rasen store list shows each identity).',
      }
    );
  }

  const match = matches[0]!;
  return {
    id,
    type,
    key: match.key,
    ...(match.uid !== undefined ? { uid: match.uid } : {}),
    backend: match.entry.backend,
  };
}

/** Same checkout: type, canonical path, and branch — remote excluded. */
function sameCheckout(
  actual: StoreGitBackendConfig,
  expected: StoreGitBackendConfig
): boolean {
  return (
    actual.type === expected.type &&
    normalizePathForComparison(actual.local_path) ===
      normalizePathForComparison(expected.local_path) &&
    actual.branch === expected.branch
  );
}

function storeBackendsMatch(
  actual: StoreGitBackendConfig,
  expected: StoreGitBackendConfig
): boolean {
  return sameCheckout(actual, expected) && actual.remote === expected.remote;
}

function assertExpectedRegisteredBackend(
  id: string,
  actual: StoreGitBackendConfig,
  expected: StoreGitBackendConfig | undefined
): void {
  if (!expected || storeBackendsMatch(actual, expected)) return;

  throw new StoreError(
    `Store '${id}' changed before cleanup completed.`,
    'store_registry_changed',
    {
      target: 'store.registry',
      fix: 'Retry the cleanup command after reviewing the current store registration.',
    }
  );
}

function withoutRegisteredStore(
  registry: StoreRegistryState | null,
  type: RegistryEntryType,
  id: string,
  expectedBackend?: StoreGitBackendConfig
): { next: StoreRegistryState; removed: StoreRegistryEntry } {
  const removed = getRegisteredStoreOrThrow(registry, type, id);
  assertExpectedRegisteredBackend(id, removed.backend, expectedBackend);
  const stores = { ...(registry?.stores ?? {}) };
  delete stores[removed.key];

  return {
    removed,
    next: {
      version: registry?.version ?? 1,
      stores: Object.fromEntries(
        Object.entries(stores).sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
      ),
    },
  };
}

/**
 * Read-only identity verification. Runs BEFORE any write in
 * `commitStoreRegistration` (design D6), so a mismatch fails having written
 * nothing: no metadata, no registry entry.
 */
async function verifyStoreIdentity(
  storeRoot: string,
  id: string,
  input: { writeIfMissing: boolean; expectedUid?: string }
): Promise<{ metadata: StoreMetadataState | null; uid?: string }> {
  const metadata = await readOptionalStoreMetadataState(storeRoot);
  const uid = storeMetadataUid(metadata);

  if (input.expectedUid !== undefined && !storeUidsMatch(uid, input.expectedUid)) {
    throw new StoreError(
      `The checkout at ${storeRoot} carries store identity ${uid ?? '(none)'}, not the expected ${input.expectedUid}. Nothing was written.`,
      'store_uid_mismatch',
      {
        target: 'store.metadata',
        fix: 'Register the checkout that carries the expected identity, or correct the identity you asked for.',
      }
    );
  }

  if (!metadata) {
    if (!input.writeIfMissing) {
      throw new StoreError(
        `Registered store '${id}' is missing metadata at ${getStoreMetadataPath(storeRoot)}`,
        'store_metadata_missing',
        {
          target: 'store.metadata',
          fix: `Create ${getStoreMetadataPath(storeRoot)} or rerun "rasen store register <path>".`,
        }
      );
    }
    return { metadata: null };
  }

  // The metadata id and the id being registered must agree. A rename is
  // performed by editing the store's own metadata and re-registering it: the
  // registry entry then follows the metadata, keyed by the unchanged identity
  // (design D11). No command rewrites the metadata alias, so there is no
  // caller-supplied exemption from this check.
  if (metadata.id !== id) {
    throw new StoreError(
      `Store metadata id '${metadata.id}' does not match registered id '${id}'`,
      'store_metadata_id_mismatch',
      {
        target: 'store.metadata',
        fix: 'Repair the local registry or store metadata so the ids match.',
      }
    );
  }

  return { metadata, ...(uid !== undefined ? { uid } : {}) };
}

export async function commitStoreRegistration(
  input: CommitStoreRegistrationInput
): Promise<StoreRegistrationCommit> {
  const id = validateStoreId(input.id);
  const type = input.type ?? 'store';
  const backend = input.backend;
  const storeRoot = getStoreRootForBackend(backend);
  const diagnostics: StoreDiagnostic[] = [];

  // Verification first, writes second (design D6). Nothing below this line
  // runs when the checkout is not the store the caller asked for.
  const verified = await verifyStoreIdentity(storeRoot, id, {
    writeIfMissing: input.writeMetadataIfMissing,
    ...(input.expectedUid !== undefined ? { expectedUid: input.expectedUid } : {}),
  });

  let metadataCreated = false;
  let isRerun = false;
  let registryUpdated = false;
  let aliasRenamed = false;
  let previousId: string | undefined;
  let uid = verified.uid;
  let registryKey: string | undefined;

  try {
    if (!verified.metadata) {
      // Registration records an identity; it never mints one. Only explicit
      // store CREATION (`store setup`) and `store upgrade-identity` do that.
      await writeStoreMetadataState(storeRoot, { version: 1, id });
      metadataCreated = true;
    } else {
      // Metadata exists — if it lives only under the legacy `.openspec-store/`
      // name, copy it forward to `.rasen-store/` (copy-only; legacy untouched).
      await copyForwardLegacyStoreMetadata(storeRoot);
    }

    if (isAllDigitAlias(id) && metadataCreated) {
      diagnostics.push(storeAliasNumeric({ id }));
    }

    const registry = await readStoreRegistryState({
      globalDataDir: input.globalDataDir,
    });
    const existingMatch =
      uid !== undefined ? findRegistryEntryByUid(registry, uid) : null;
    const aliasMatch = findRegistryEntryKeys(registry, type, id).find(
      (candidate) =>
        normalizePathForComparison(getStoreRootForBackend(candidate.entry.backend)) ===
        normalizePathForComparison(storeRoot)
    );
    const existing = existingMatch?.entry ?? aliasMatch?.entry;
    registryKey = existingMatch?.key ?? aliasMatch?.key;
    const existingBackend = existing?.backend as StoreGitBackendConfig | undefined;
    aliasRenamed = existingMatch !== null && existingMatch !== undefined && existingMatch.id !== id;
    if (aliasRenamed && existingMatch) {
      // The only rename path Phase A has (design D11) — say so, or the entry's
      // display name changes with the command reporting nothing at all.
      previousId = existingMatch.id;
      diagnostics.push(
        storeAliasRenamed({
          from: existingMatch.id,
          to: id,
          ...(uid !== undefined ? { uid } : {}),
        })
      );
    }
    // Same checkout = a rerun for an already-registered store (the 1.3
    // reporting contract), whether or not the observed remote changed;
    // only a remote change needs the registry write (the refresh).
    isRerun = existingBackend !== undefined && sameCheckout(existingBackend, backend);
    const upToDate =
      isRerun &&
      !aliasRenamed &&
      existingBackend !== undefined &&
      storeBackendsMatch(existingBackend, backend);

    if (!upToDate) {
      const update = await updateStoreRegistryState(
        (current) =>
          withRegisteredStore(current, type, id, backend, uid),
        { globalDataDir: input.globalDataDir }
      );
      // The registry stayed alias-keyed because some store has no permanent
      // identity yet: the command that ran the mutation says which ones,
      // rather than leaving the refusal invisible (spec: "the command reports
      // which entries need the identity upgrade first").
      if (update.blockedBy.length > 0) {
        diagnostics.push(storeRegistryRekeyBlocked({ blockedBy: update.blockedBy }));
      }
      registryUpdated = true;
    }
  } catch (error) {
    if (metadataCreated) {
      // A concurrent registration may have read our metadata as
      // pre-existing and committed against it - never delete metadata a
      // committed registry entry depends on.
      const current = await readStoreRegistryState({
        globalDataDir: input.globalDataDir,
      }).catch(() => null);
      const stillReferenced =
        (uid !== undefined && findRegistryEntryByUid(current, uid) !== null) ||
        findRegistryEntryKeys(current, type, id).length > 0 ||
        (registryKey !== undefined && current?.stores[registryKey] !== undefined);
      if (!stillReferenced) {
        await fs.rm(getStoreMetadataPath(storeRoot), { force: true });
        await fs.rmdir(getStoreMetadataDir(storeRoot)).catch(() => undefined);
      }
    }

    throw error;
  }

  return {
    id,
    storeRoot,
    backend,
    metadataCreated,
    registryUpdated,
    alreadyRegistered: isRerun,
    aliasRenamed,
    ...(previousId !== undefined ? { previousId } : {}),
    ...(uid !== undefined ? { uid } : {}),
    diagnostics,
  };
}

export async function registerStore(
  input: RegisterStoreInput
): Promise<ResolvedStore> {
  const id = validateStoreId(input.id);
  const backend = await resolveGitStoreBackendConfig(
    {
      localPath: input.localPath,
      ...(input.remote !== undefined ? { remote: input.remote } : {}),
      ...(input.branch !== undefined ? { branch: input.branch } : {}),
    },
    input.cwd
  );
  const storeRoot = getStoreRootForBackend(backend);

  const committed = await commitStoreRegistration({
    id,
    backend,
    writeMetadataIfMissing: true,
    ...(input.globalDataDir ? { globalDataDir: input.globalDataDir } : {}),
  });

  return {
    id: committed.id,
    storeRoot: committed.storeRoot,
    backend: committed.backend,
  };
}

export interface RegistrySnapshot {
  /** null = the registry is unreadable; [] = empty or absent. */
  entries: StoreRegistryEntry[] | null;
  unreadable: boolean;
}

/**
 * One registry read serving every consumer in a command.
 */
export async function readRegistrySnapshot(
  options: { globalDataDir?: string } = {}
): Promise<RegistrySnapshot> {
  try {
    const registry = await readStoreRegistryState(options);
    return {
      entries: registry ? listStoreRegistryEntries(registry) : [],
      unreadable: false,
    };
  } catch {
    return { entries: null, unreadable: true };
  }
}

/**
 * COMPAT reader. Returns registry rows without resolving identity, health, or
 * declaration arity — so it can answer "which stores are registered here?" but
 * never "which store is this, and can I use it right now?". That question has
 * exactly one answer: `resolveStoreBinding()` in `store/identity.ts`.
 *
 * A guard test (`test/core/store/identity-boundaries.test.ts`) asserts no Phase
 * A file imports this. The remaining consumers are retired by their owning
 * sibling change:
 *
 * - `learned-skills/context.ts` — `store-aware-learned-skills-integration`
 * - `management-api/spaces.ts` — `unified-session-runtime-context`
 * - `management-api/session-launch-context.ts` — `unified-session-runtime-context`
 * - `store/operations.ts` (`listStores`) — none; listing IS its job.
 *
 * Each of those children MUST add its file to the guard test's list when it
 * migrates, or the ban silently stops covering it.
 */
export async function listRegisteredStores(
  options: ListRegisteredStoresOptions = {}
): Promise<RegisteredStoreEntry[]> {
  const registry = await readStoreRegistryState(options);

  if (!registry) {
    return [];
  }

  return listStoreRegistryEntries(registry).map((entry) => ({
    ...entry,
    storeRoot: getStoreRootForBackend(entry.backend),
  }));
}

export async function getRegisteredStore(
  input: GetRegisteredStoreInput
): Promise<RegisteredStoreEntry> {
  const id = validateStoreSelector(input.id);
  const type = input.type ?? 'store';
  const registry = await readStoreRegistryState({
    globalDataDir: input.globalDataDir,
  });
  const entry = getRegisteredStoreOrThrow(registry, type, id);
  assertExpectedRegisteredBackend(entry.id, entry.backend, input.expectedBackend);

  return {
    ...entry,
    storeRoot: getStoreRootForBackend(entry.backend),
  };
}

export async function unregisterStoreRegistration(
  input: UnregisterStoreInput
): Promise<StoreUnregistration> {
  // A permanent identity is a legitimate way to name what to remove — and the
  // only one that works when two Stores share a display name.
  const id = validateStoreSelector(input.id);
  const type = input.type ?? 'store';
  let removed: StoreRegistryEntry | undefined;

  const update = await updateStoreRegistryState(
    async (registry) => {
      const result = withoutRegisteredStore(registry, type, id, input.expectedBackend);
      const removedEntry = {
        ...result.removed,
        storeRoot: getStoreRootForBackend(result.removed.backend),
      };
      await input.beforeCommit?.(removedEntry);
      removed = result.removed;
      return result.next;
    },
    { globalDataDir: input.globalDataDir }
  );

  if (!removed) {
    const noun = type === 'project' ? 'project' : 'store';
    throw new StoreError(`Unknown ${noun} '${id}'`, 'store_not_found', {
      target: 'store.id',
      fix: 'Run rasen store list to see registered stores.',
    });
  }

  return {
    ...removed,
    storeRoot: getStoreRootForBackend(removed.backend),
    rekeyBlockedBy: update.blockedBy,
  };
}

export async function resolveRegisteredStore(
  input: ResolveRegisteredStoreInput
): Promise<ResolvedStore> {
  // The operand may be a display name or a permanent identity — `adopt` and
  // `add-project` are exactly where a user must say WHICH store, so an
  // identity has to work here.
  const selector = validateStoreSelector(input.id);
  const type = input.type ?? 'store';
  const registry = await readStoreRegistryState({
    globalDataDir: input.globalDataDir,
  });

  if (!registry) {
    throw new StoreError('No store registry found', 'no_store_registry', {
      target: 'store.id',
      fix: 'Register a store with rasen store register <path>, then select it with --store <id>.',
    });
  }

  const entry = getRegisteredStoreOrThrow(registry, type, selector);
  const backend = entry.backend;
  const storeRoot = getStoreRootForBackend(backend);
  // Everything past resolution speaks the RESOLVED display name, never the
  // selector the user typed: verifying the checkout's metadata against a uid
  // would report a metadata/registry mismatch that does not exist, and tell
  // the user to repair two files that are both correct.
  await verifyStoreIdentity(storeRoot, entry.id, { writeIfMissing: false });

  return {
    id: entry.id,
    storeRoot,
    backend,
    ...(entry.uid !== undefined ? { uid: entry.uid } : {}),
  };
}
