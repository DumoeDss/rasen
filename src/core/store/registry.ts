import * as fs from 'node:fs/promises';

import {
  getStoreMetadataPath,
  getStoreMetadataDir,
  copyForwardLegacyStoreMetadata,
  listStoreRegistryEntries,
  readStoreRegistryState,
  readOptionalStoreMetadataState,
  registryKeyFor,
  resolveGitStoreBackendConfig,
  updateStoreRegistryState,
  validateStoreId,
  writeStoreMetadataState,
  type RegistryEntryType,
  type StoreBackendConfig,
  type StoreGitBackendConfig,
  type StorePathOptions,
  type StoreRegistryEntry,
  type StoreRegistryState,
} from './foundation.js';
import { StoreError } from './errors.js';
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

export interface ResolvedStore {
  id: string;
  storeRoot: string;
  backend: StoreGitBackendConfig;
}

export interface StoreRegistrationCommit extends ResolvedStore {
  metadataCreated: boolean;
  registryUpdated: boolean;
  alreadyRegistered: boolean;
}

export interface CommitStoreRegistrationInput extends StorePathOptions {
  id: string;
  backend: StoreGitBackendConfig;
  writeMetadataIfMissing: boolean;
  /** Registry namespace to commit into; absent means store. */
  type?: RegistryEntryType;
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
  backend: StoreGitBackendConfig
): void {
  const nextPath = normalizePathForComparison(getStoreRootForBackend(backend));
  const noun = type === 'project' ? 'Project' : 'Store';

  for (const entry of listStoreRegistryEntries(registry ?? { version: 1, stores: {} })) {
    if (entry.type !== type) {
      continue;
    }

    const entryPath = normalizePathForComparison(getStoreRootForBackend(entry.backend));

    if (entry.id === id && entryPath === nextPath) {
      continue;
    }

    if (entry.id === id) {
      throw new StoreError(
        `${noun} '${id}' is already registered at ${getStoreRootForBackend(entry.backend)}. One checkout per ${type} id is supported on this machine.`,
        'store_id_conflict',
        {
          target: 'store.id',
          fix:
            type === 'project'
              ? `'${id}' is already taken in the project namespace. Rerun with --as <id>, for example --as ${id}-2.`
              : `Use the existing registration, or run rasen store unregister ${id} first to switch this id to a different checkout.`,
        }
      );
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
  backend: StoreGitBackendConfig
): StoreRegistryState {
  assertNoRegisteredStoreConflict(registry, type, id, backend);

  const key = registryKeyFor(type, id);
  const stores = {
    ...(registry?.stores ?? {}),
    // Never inject a `type` key onto a store entry (byte-stability, task 1.4).
    [key]: type === 'project' ? { type, backend } : { backend },
  };

  return {
    version: 1,
    stores: Object.fromEntries(
      Object.entries(stores).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    ),
  };
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
): StoreRegistryEntry {
  const entry = registry?.stores[registryKeyFor(type, id)];
  if (!entry) {
    const noun = type === 'project' ? 'project' : 'store';
    const otherType: RegistryEntryType = type === 'project' ? 'store' : 'project';
    const hasOtherType = registry?.stores[registryKeyFor(otherType, id)] !== undefined;

    throw new StoreError(`Unknown ${noun} '${id}'`, 'store_not_found', {
      target: 'store.id',
      fix: hasOtherType
        ? `'${id}' is registered as a ${otherType}, not a ${noun}. ${otherType === 'project' ? 'Rerun with --project-namespace.' : 'Rerun without --project-namespace.'}`
        : 'Run rasen store list to see registered stores.',
    });
  }

  return {
    id,
    type,
    backend: entry.backend,
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
  delete stores[registryKeyFor(type, id)];

  return {
    removed,
    next: {
      version: 1,
      stores: Object.fromEntries(
        Object.entries(stores).sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
      ),
    },
  };
}

async function ensureStoreMetadata(
  storeRoot: string,
  id: string,
  options: { writeIfMissing: boolean }
): Promise<boolean> {
  const metadata = await readOptionalStoreMetadataState(storeRoot);

  if (!metadata) {
    if (!options.writeIfMissing) {
      throw new StoreError(
        `Registered store '${id}' is missing metadata at ${getStoreMetadataPath(storeRoot)}`,
        'store_metadata_missing',
        {
          target: 'store.metadata',
          fix: `Create ${getStoreMetadataPath(storeRoot)} or rerun "rasen store register <path>".`,
        }
      );
    }

    await writeStoreMetadataState(storeRoot, {
      version: 1,
      id,
    });
    return true;
  }

  // Metadata exists — if it lives only under the legacy `.openspec-store/`
  // name, copy it forward to `.rasen-store/` (copy-only; legacy untouched).
  await copyForwardLegacyStoreMetadata(storeRoot);

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

  return false;
}

export async function commitStoreRegistration(
  input: CommitStoreRegistrationInput
): Promise<StoreRegistrationCommit> {
  const id = validateStoreId(input.id);
  const type = input.type ?? 'store';
  const backend = input.backend;
  const storeRoot = getStoreRootForBackend(backend);
  const key = registryKeyFor(type, id);

  let metadataCreated = false;
  let isRerun = false;
  let registryUpdated = false;

  try {
    metadataCreated = await ensureStoreMetadata(storeRoot, id, {
      writeIfMissing: input.writeMetadataIfMissing,
    });
    const registry = await readStoreRegistryState({
      globalDataDir: input.globalDataDir,
    });
    const existing = registry?.stores[key];
    const existingBackend = existing?.backend as StoreGitBackendConfig | undefined;
    // Same checkout = a rerun for an already-registered store (the 1.3
    // reporting contract), whether or not the observed remote changed;
    // only a remote change needs the registry write (the refresh).
    isRerun = existingBackend !== undefined && sameCheckout(existingBackend, backend);
    const upToDate =
      isRerun && existingBackend !== undefined && storeBackendsMatch(existingBackend, backend);

    if (!upToDate) {
      await updateStoreRegistryState(
        (registry) => withRegisteredStore(registry, type, id, backend),
        { globalDataDir: input.globalDataDir }
      );
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
      if (!current?.stores[key]) {
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
  const id = validateStoreId(input.id);
  const type = input.type ?? 'store';
  const registry = await readStoreRegistryState({
    globalDataDir: input.globalDataDir,
  });
  const entry = getRegisteredStoreOrThrow(registry, type, id);
  assertExpectedRegisteredBackend(id, entry.backend, input.expectedBackend);

  return {
    ...entry,
    storeRoot: getStoreRootForBackend(entry.backend),
  };
}

export async function unregisterStoreRegistration(
  input: UnregisterStoreInput
): Promise<RegisteredStoreEntry> {
  const id = validateStoreId(input.id);
  const type = input.type ?? 'store';
  let removed: StoreRegistryEntry | undefined;

  await updateStoreRegistryState(
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
  };
}

export async function resolveRegisteredStore(
  input: ResolveRegisteredStoreInput
): Promise<ResolvedStore> {
  const id = validateStoreId(input.id);
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

  const entry = getRegisteredStoreOrThrow(registry, type, id);
  const backend = entry.backend;
  const storeRoot = getStoreRootForBackend(backend);
  await ensureStoreMetadata(storeRoot, id, { writeIfMissing: false });

  return {
    id,
    storeRoot,
    backend,
  };
}
