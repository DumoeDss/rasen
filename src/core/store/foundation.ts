import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import {
  folderStyleNameProblem,
  isKebabId,
  KEBAB_ID_DESCRIPTION,
  KEBAB_ID_FIX,
} from '../id.js';

import { getGlobalDataDir } from '../global-config.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import {
  acquireFileLock,
  isNodeErrorCode,
  makeLockErrorFactory,
  pathIsDirectory,
  pathIsFile,
  releaseFileLock,
  writeFileAtomically,
} from '../file-state.js';
import { formatZodIssues } from '../zod-issues.js';
import { StoreError } from './errors.js';
import { isValidStoreUid, normalizeStoreUid } from './identity-types.js';
import { assertCredentialFreeRemote } from './remote.js';

const fs = nodeFs.promises;

export const STORE_METADATA_DIR_NAME = '.rasen-store';
/**
 * Legacy metadata directory name. Recognized on read for stores created before
 * the rebrand; never written (the next write copies metadata forward under the
 * rasen name, leaving the legacy directory untouched).
 */
export const LEGACY_STORE_METADATA_DIR_NAME = '.openspec-store';
export const STORE_METADATA_FILE_NAME = 'store.yaml';
export const STORES_DIR_NAME = 'stores';
export const STORE_REGISTRY_FILE_NAME = 'registry.yaml';

export interface StorePathOptions {
  globalDataDir?: string;
}

export interface StoreGitBackendConfig {
  type: 'git';
  local_path: string;
  remote?: string;
  branch?: string;
}

export type StoreBackendConfig = StoreGitBackendConfig;

/**
 * Registry namespace: absent/`'store'` is a store entry, `'project'` an
 * in-repo project registered via `store add-project`. Uniqueness is the
 * `(type, id)` pair (design D1/D2) — a store and a project may share an id.
 */
export type RegistryEntryType = 'store' | 'project';

/** Reserved key-form prefix disambiguating the project namespace on disk. */
const PROJECT_REGISTRY_KEY_PREFIX = 'project:';

/**
 * Registry schema versions. v1 keys store entries by display alias; v2 keys
 * them by the Store's permanent identity with the alias inside the entry
 * (design D2/D7). `project:` entries keep alias keying in BOTH versions —
 * their move to `projectId` records belongs to a later change.
 */
export type StoreRegistrySchemaVersion = 1 | 2;

/** Metadata schema versions: v1 has no permanent identity, v2 carries one. */
export type StoreMetadataSchemaVersion = 1 | 2;

/**
 * Splits a registry map key into its namespace and its identifying value
 * (design D1/D2). The key grammar is chosen by the registry file's own
 * `version` field, never inferred from the key text: in a v1 file a bare key
 * is a display alias, in a v2 file a bare key is a permanent identity.
 */
export function parseRegistryKey(
  key: string,
  version: StoreRegistrySchemaVersion = 1
): { type: RegistryEntryType; id?: string; uid?: string } {
  if (key.startsWith(PROJECT_REGISTRY_KEY_PREFIX)) {
    return { type: 'project', id: key.slice(PROJECT_REGISTRY_KEY_PREFIX.length) };
  }
  return version === 2 ? { type: 'store', uid: key } : { type: 'store', id: key };
}

/**
 * Builds the registry map key for a namespace + id (inverse of
 * parseRegistryKey). A v2 store key is the permanent identity, so `uid` is
 * required there; omitting it is a programming error, not a data condition.
 */
export function registryKeyFor(
  type: RegistryEntryType,
  id: string,
  options: { version?: StoreRegistrySchemaVersion; uid?: string } = {}
): string {
  if (type === 'project') return `${PROJECT_REGISTRY_KEY_PREFIX}${id}`;
  if ((options.version ?? 1) === 2) {
    if (!options.uid) {
      throw invalidStoreStateError(
        'store registry state',
        `store '${id}' has no permanent identity to key on. Run rasen store upgrade-identity ${id} first.`
      );
    }
    return normalizeStoreUid(options.uid);
  }
  return id;
}

export interface StoreRegistryEntryState {
  /** Absent means store (byte-stable with pre-split registry files). */
  type?: RegistryEntryType;
  /**
   * v2 store entries only: the display alias, since the key is the permanent
   * identity. Never present on a v1 entry or on a `project:` entry.
   */
  id?: string;
  backend: StoreBackendConfig;
}

export interface StoreRegistryState {
  version: StoreRegistrySchemaVersion;
  stores: Record<string, StoreRegistryEntryState>;
}

export interface StoreRegistryEntry {
  id: string;
  type: RegistryEntryType;
  /** The Store's permanent identity; absent for a v1 registry entry. */
  uid?: string;
  backend: StoreBackendConfig;
}

export interface StoreMetadataStateV1 {
  version: 1;
  id: string;
  /** Canonical clone source, team-authored. Optional (slice 3.3). */
  remote?: string;
}

export interface StoreMetadataStateV2 {
  version: 2;
  /** The Store's permanent identity — minted once, never changed. */
  uid: string;
  id: string;
  remote?: string;
}

/** Version-discriminated Store metadata; both forms stay fully readable. */
export type StoreMetadataState = StoreMetadataStateV1 | StoreMetadataStateV2;

/** The permanent identity a metadata state carries, or undefined for v1. */
export function storeMetadataUid(
  state: StoreMetadataState | null | undefined
): string | undefined {
  return state && state.version === 2 ? state.uid : undefined;
}

export interface ResolveGitStoreBackendInput {
  localPath: string;
  remote?: string;
  branch?: string;
}

function joinStorePath(basePath: string, ...segments: string[]): string {
  return FileSystemUtils.joinPath(basePath, ...segments);
}

export function getStoresDir(options: StorePathOptions = {}): string {
  return joinStorePath(options.globalDataDir ?? getGlobalDataDir(), STORES_DIR_NAME);
}

export function getStoreRegistryPath(options: StorePathOptions = {}): string {
  return joinStorePath(getStoresDir(options), STORE_REGISTRY_FILE_NAME);
}

export function getStoreMetadataDir(storeRoot: string): string {
  return joinStorePath(storeRoot, STORE_METADATA_DIR_NAME);
}

export function getLegacyStoreMetadataDir(storeRoot: string): string {
  return joinStorePath(storeRoot, LEGACY_STORE_METADATA_DIR_NAME);
}

/** Canonical (rasen) metadata path — the write target. */
export function getStoreMetadataPath(storeRoot: string): string {
  return joinStorePath(
    getStoreMetadataDir(storeRoot),
    STORE_METADATA_FILE_NAME
  );
}

/** Legacy metadata path — read-compat only, never written. */
export function getLegacyStoreMetadataPath(storeRoot: string): string {
  return joinStorePath(
    getLegacyStoreMetadataDir(storeRoot),
    STORE_METADATA_FILE_NAME
  );
}

/**
 * Resolves the metadata file to READ from: the rasen path when present, else
 * the legacy path when present, else the rasen path (so a missing-metadata read
 * yields a consistent ENOENT on the canonical location).
 */
export async function resolveReadableStoreMetadataPath(
  storeRoot: string
): Promise<string> {
  const canonical = getStoreMetadataPath(storeRoot);
  if (await pathIsFile(canonical)) return canonical;
  const legacy = getLegacyStoreMetadataPath(storeRoot);
  if (await pathIsFile(legacy)) return legacy;
  return canonical;
}

export function validateStoreId(id: string): string {
  const folderProblem = folderStyleNameProblem(id, 'Store id');
  if (folderProblem !== null) {
    throw new StoreError(folderProblem, 'invalid_store_id', {
      target: 'store.id',
      fix: KEBAB_ID_FIX,
    });
  }

  if (!isKebabId(id)) {
    throw new StoreError(
      `Store id ${KEBAB_ID_DESCRIPTION}`,
      'invalid_store_id',
      {
        target: 'store.id',
        fix: KEBAB_ID_FIX,
      }
    );
  }

  return id;
}

/**
 * Validates a value that names a Store on a lookup surface, where a permanent
 * identity is as legitimate as a display name — and is the ONLY way to name
 * one of two Stores that share a display name. Write surfaces that ASSIGN a
 * name (`store setup`, `register --id`) keep using `validateStoreId`: an
 * identity is never user input.
 */
export function validateStoreSelector(value: string): string {
  return isValidStoreUid(value) ? value : validateStoreId(value);
}

export function isValidStoreId(id: string): boolean {
  try {
    validateStoreId(id);
    return true;
  } catch {
    return false;
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return isNodeErrorCode(error, 'ENOENT');
}

function normalizeExistingPathForStorage(existingPath: string): string {
  return FileSystemUtils.canonicalizeExistingPath(existingPath);
}

function nonEmptyOptionalString() {
  return z.string().min(1).optional();
}

const GitBackendConfigSchema = z.object({
  type: z.literal('git'),
  local_path: z.string().min(1),
  remote: nonEmptyOptionalString(),
  branch: nonEmptyOptionalString(),
}).strict();

const RegistryEntrySchema = z.object({
  backend: GitBackendConfigSchema,
  type: z.enum(['store', 'project']).optional(),
  id: nonEmptyOptionalString(),
}).strict();

const RegistryStateSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  stores: z.record(z.string(), RegistryEntrySchema),
  // Legacy code-checkout map data is tolerated on read and dropped on
  // the next write.
  repos: z.unknown().optional(),
}).strict();

const MetadataStateSchema = z.discriminatedUnion('version', [
  z.object({
    version: z.literal(1),
    id: z.string(),
    remote: nonEmptyOptionalString(),
  }).strict(),
  z.object({
    version: z.literal(2),
    uid: z.string().min(1),
    id: z.string(),
    remote: nonEmptyOptionalString(),
  }).strict(),
]);

function storeStateDiagnostic(label: string): {
  code: string;
  target: string;
  fix: string;
} {
  if (label.includes('metadata')) {
    return {
      code: 'invalid_store_metadata',
      target: 'store.metadata',
      fix: 'Repair .rasen-store/store.yaml.',
    };
  }

  return {
    code: 'invalid_store_registry',
    target: 'store.registry',
    fix: `Repair or remove ${getStoreRegistryPath({})}.`,
  };
}

function invalidStoreStateError(label: string, message: string): StoreError {
  const diagnostic = storeStateDiagnostic(label);
  return new StoreError(`Invalid ${label}: ${message}`, diagnostic.code, {
    target: diagnostic.target,
    fix: diagnostic.fix,
  });
}

function parseYamlObject(content: string, label: string): unknown {
  try {
    return parseYaml(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw invalidStoreStateError(label, message);
  }
}

/**
 * Validates each registry key against the grammar its own version declares
 * (design D2/D7): a `project:` key's id portion and a v1 store key are kebab
 * ids; a v2 store key MUST parse as a permanent identity. A v2 store entry
 * carries its display alias in the entry body, and a v1 entry never does.
 */
function assertValidRegistryKeys(
  stores: Record<string, StoreRegistryEntryState>,
  version: StoreRegistrySchemaVersion,
  label: string
): void {
  for (const [key, entry] of Object.entries(stores)) {
    const parsed = parseRegistryKey(key, version);

    if (parsed.uid !== undefined) {
      if (!isValidStoreUid(parsed.uid)) {
        throw invalidStoreStateError(
          label,
          `'${key}': a version 2 store key must be a permanent store identity.`
        );
      }
      if (entry.id === undefined) {
        throw invalidStoreStateError(
          label,
          `'${key}': a version 2 store entry must carry its display alias as 'id'.`
        );
      }
      if (!isKebabId(entry.id)) {
        throw invalidStoreStateError('store id', `'${entry.id}': ${KEBAB_ID_DESCRIPTION}`);
      }
      continue;
    }

    if (entry.id !== undefined) {
      throw invalidStoreStateError(
        label,
        `'${key}': an 'id' field is only valid on a version 2 store entry.`
      );
    }
    if (parsed.id === undefined || !isKebabId(parsed.id)) {
      throw invalidStoreStateError('store id', `'${key}': ${KEBAB_ID_DESCRIPTION}`);
    }
  }
}

/**
 * Security-relevant strictness (design D1/risk): an entry's `type` field is
 * authoritative and MUST agree with its key form. A `project:` key claiming
 * `type: store` (or a bare key claiming `type: project`) is never silently
 * coerced to either namespace — it is a diagnostic.
 */
function assertKeyTypeAgreement(
  stores: Record<string, { type?: RegistryEntryType }>,
  version: StoreRegistrySchemaVersion,
  label: string
): void {
  for (const [key, entry] of Object.entries(stores)) {
    const { type: keyType } = parseRegistryKey(key, version);
    const entryType = entry.type ?? 'store';
    if (keyType !== entryType) {
      throw invalidStoreStateError(
        label,
        `'${key}': type '${entryType}' disagrees with its key form (expected '${keyType}').`
      );
    }
  }
}

export function parseStoreRegistryState(content: string): StoreRegistryState {
  const raw = parseYamlObject(content, 'store registry state');
  const result = RegistryStateSchema.safeParse(raw);

  if (!result.success) {
    throw invalidStoreStateError(
      'store registry state',
      formatZodIssues(result.error)
    );
  }

  const version = result.data.version;
  assertValidRegistryKeys(result.data.stores, version, 'store registry state');
  assertKeyTypeAgreement(result.data.stores, version, 'store registry state');

  return {
    version,
    stores: result.data.stores,
  };
}

export function parseStoreMetadataState(content: string): StoreMetadataState {
  const raw = parseYamlObject(content, 'store metadata state');
  const result = MetadataStateSchema.safeParse(raw);

  if (!result.success) {
    throw invalidStoreStateError(
      'store metadata state',
      formatZodIssues(result.error)
    );
  }

  validateStoreId(result.data.id);

  if (result.data.version === 2) {
    if (!isValidStoreUid(result.data.uid)) {
      throw invalidStoreStateError(
        'store metadata state',
        `'${result.data.uid}' is not a well-formed permanent store identity.`
      );
    }
    return {
      version: 2,
      uid: result.data.uid,
      id: result.data.id,
      ...(result.data.remote !== undefined ? { remote: result.data.remote } : {}),
    };
  }

  return {
    version: 1,
    id: result.data.id,
    ...(result.data.remote !== undefined ? { remote: result.data.remote } : {}),
  };
}

export function serializeStoreRegistryState(state: StoreRegistryState): string {
  const result = RegistryStateSchema.safeParse(state);

  if (!result.success) {
    throw invalidStoreStateError(
      'store registry state',
      formatZodIssues(result.error)
    );
  }

  const version = result.data.version;
  assertValidRegistryKeys(result.data.stores, version, 'store registry state');
  assertKeyTypeAgreement(result.data.stores, version, 'store registry state');

  return stringifyYaml({
    version,
    stores: result.data.stores,
  });
}

export function serializeStoreMetadataState(state: StoreMetadataState): string {
  const result = MetadataStateSchema.safeParse(state);

  if (!result.success) {
    throw invalidStoreStateError(
      'store metadata state',
      formatZodIssues(result.error)
    );
  }

  validateStoreId(result.data.id);

  if (result.data.version === 2) {
    if (!isValidStoreUid(result.data.uid)) {
      throw invalidStoreStateError(
        'store metadata state',
        `'${result.data.uid}' is not a well-formed permanent store identity.`
      );
    }
    return stringifyYaml({
      version: 2,
      uid: result.data.uid,
      id: result.data.id,
      ...(result.data.remote !== undefined ? { remote: result.data.remote } : {}),
    });
  }

  return stringifyYaml({
    version: 1,
    id: result.data.id,
    ...(result.data.remote !== undefined ? { remote: result.data.remote } : {}),
  });
}

export function listStoreRegistryEntries(
  registry: StoreRegistryState
): StoreRegistryEntry[] {
  return Object.entries(registry.stores)
    .map(([key, store]) => {
      const parsed = parseRegistryKey(key, registry.version);
      const type = store.type ?? 'store';
      const id = parsed.uid !== undefined ? (store.id as string) : (parsed.id as string);
      return {
        id,
        type,
        ...(parsed.uid !== undefined ? { uid: parsed.uid } : {}),
        backend: store.backend,
      };
    })
    .sort(
      (a, b) =>
        a.id.localeCompare(b.id) ||
        a.type.localeCompare(b.type) ||
        (a.uid ?? '').localeCompare(b.uid ?? '')
    );
}

/**
 * Every registry entry matching a `(type, display id)` pair. In the store
 * namespace of a v2 registry an alias MAY match several entries — the arity
 * rules in `identity.ts` decide what that means; this is the shared lookup
 * both the read and the write path use so they can never disagree on the key
 * grammar.
 */
export function findRegistryEntryKeys(
  registry: StoreRegistryState | null | undefined,
  type: RegistryEntryType,
  id: string
): Array<{ key: string; id: string; uid?: string; entry: StoreRegistryEntryState }> {
  if (!registry) return [];
  const matches: Array<{ key: string; id: string; uid?: string; entry: StoreRegistryEntryState }> = [];

  for (const [key, entry] of Object.entries(registry.stores)) {
    const parsed = parseRegistryKey(key, registry.version);
    if ((entry.type ?? 'store') !== type) continue;
    const entryId = parsed.uid !== undefined ? entry.id : parsed.id;
    if (entryId !== id) continue;
    matches.push({
      key,
      id,
      ...(parsed.uid !== undefined ? { uid: parsed.uid } : {}),
      entry,
    });
  }

  return matches;
}

/** The store-namespace entry carrying a given permanent identity, if any. */
export function findRegistryEntryByUid(
  registry: StoreRegistryState | null | undefined,
  uid: string
): { key: string; id: string; uid: string; entry: StoreRegistryEntryState } | null {
  if (!registry || registry.version !== 2) return null;
  const wanted = normalizeStoreUid(uid);

  for (const [key, entry] of Object.entries(registry.stores)) {
    const parsed = parseRegistryKey(key, registry.version);
    if (parsed.uid === undefined || (entry.type ?? 'store') !== 'store') continue;
    if (normalizeStoreUid(parsed.uid) !== wanted) continue;
    return { key, id: entry.id as string, uid: parsed.uid, entry };
  }

  return null;
}

export async function isStoreRoot(candidateRoot: string): Promise<boolean> {
  if (await pathIsFile(getStoreMetadataPath(candidateRoot))) return true;
  return pathIsFile(getLegacyStoreMetadataPath(candidateRoot));
}

export async function readStoreRegistryState(
  options: StorePathOptions = {}
): Promise<StoreRegistryState | null> {
  const registryPath = getStoreRegistryPath(options);

  if (!(await pathIsFile(registryPath))) {
    return null;
  }

  return parseStoreRegistryState(await fs.readFile(registryPath, 'utf-8'));
}

export async function writeStoreRegistryState(
  state: StoreRegistryState,
  options: StorePathOptions = {}
): Promise<void> {
  await writeFileAtomically(
    getStoreRegistryPath(options),
    serializeStoreRegistryState(state)
  );
}

const storeRegistryLockError = makeLockErrorFactory({
  createSubject: 'the registry lock file',
  busyMessage: 'Store registry is busy.',
  code: 'store_registry_busy',
  target: 'store.registry',
});

/**
 * The outcome of trying to move a registry to its identity-keyed form
 * (design D7). `upgraded: false` is a legitimate, permanent state: a fleet
 * where some Store still predates permanent identities keeps a v1 registry
 * rather than having identities invented for it.
 */
export interface RegistryV2UpgradeResult {
  state: StoreRegistryState;
  upgraded: boolean;
  /** Display aliases of the store entries that block the rewrite. */
  blockedBy: string[];
}

async function readEntryUid(storeRoot: string): Promise<string | undefined> {
  try {
    return storeMetadataUid(await readOptionalStoreMetadataState(storeRoot));
  } catch {
    // An unreadable or malformed identity file blocks the rewrite exactly
    // like a missing one — it never invents an identity, and it must never
    // break the mutation the user actually asked for.
    return undefined;
  }
}

/**
 * Re-keys the store namespace by permanent identity, or refuses and names the
 * entries that need `rasen store upgrade-identity` first. `project:` entries
 * are carried through untouched (design D7). Never mints an identity.
 */
export async function upgradeStoreRegistryToV2(
  state: StoreRegistryState
): Promise<RegistryV2UpgradeResult> {
  const storeEntryCount = Object.entries(state.stores).filter(
    ([key]) => parseRegistryKey(key, state.version).type === 'store'
  ).length;

  // Nothing in the store namespace means nothing to key by identity; the
  // registry keeps (or returns to) its alias-keyed form rather than declaring
  // a version its data does not need.
  if (storeEntryCount === 0) {
    return { state: downgradeStoreRegistryToV1(state).state, upgraded: false, blockedBy: [] };
  }

  if (state.version === 2) return { state, upgraded: true, blockedBy: [] };

  const nextStores: Record<string, StoreRegistryEntryState> = {};
  const blockedBy: string[] = [];
  const seenUids = new Set<string>();

  for (const [key, entry] of Object.entries(state.stores)) {
    const parsed = parseRegistryKey(key, state.version);
    if (parsed.type === 'project') {
      nextStores[key] = entry;
      continue;
    }

    const alias = parsed.id as string;
    const uid = await readEntryUid(entry.backend.local_path);
    if (uid === undefined || !isValidStoreUid(uid)) {
      blockedBy.push(alias);
      continue;
    }

    const normalized = normalizeStoreUid(uid);
    if (seenUids.has(normalized)) {
      blockedBy.push(alias);
      continue;
    }
    seenUids.add(normalized);
    nextStores[normalized] = { id: alias, backend: entry.backend };
  }

  if (blockedBy.length > 0) {
    return { state, upgraded: false, blockedBy };
  }

  return {
    state: {
      version: 2,
      stores: Object.fromEntries(
        Object.entries(nextStores).sort(([left], [right]) => left.localeCompare(right))
      ),
    },
    upgraded: true,
    blockedBy,
  };
}

/**
 * Returns the registry in its alias-keyed form, for the one case that needs
 * it: registering a Store that has no permanent identity yet into a registry
 * that is already identity-keyed. The registry's version is a FUNCTION of its
 * data — identity-keyed exactly when every store entry has an identity — so
 * this and `upgradeStoreRegistryToV2` keep it self-consistent instead of
 * pinning a version the entries cannot support.
 *
 * `collisions` names any display alias that two entries share: collapsing
 * those onto one alias key would silently drop a registration, so the caller
 * must refuse rather than write.
 */
export function downgradeStoreRegistryToV1(state: StoreRegistryState): {
  state: StoreRegistryState;
  collisions: string[];
} {
  if (state.version === 1) return { state, collisions: [] };

  const stores: Record<string, StoreRegistryEntryState> = {};
  const collisions: string[] = [];

  for (const [key, entry] of Object.entries(state.stores)) {
    const parsed = parseRegistryKey(key, state.version);
    if (parsed.type === 'project') {
      stores[key] = entry;
      continue;
    }
    const alias = entry.id as string;
    if (stores[alias] !== undefined) {
      collisions.push(alias);
      continue;
    }
    stores[alias] = { backend: entry.backend };
  }

  if (collisions.length > 0) return { state, collisions };

  return {
    state: {
      version: 1,
      stores: Object.fromEntries(
        Object.entries(stores).sort(([left], [right]) => left.localeCompare(right))
      ),
    },
    collisions,
  };
}

/**
 * The outcome of a registry mutation. `blockedBy` names the store entries that
 * kept the registry alias-keyed, so the command the user actually ran can
 * report which entries need `rasen store upgrade-identity` first (design D7)
 * instead of leaving the refusal invisible.
 */
export interface StoreRegistryUpdate {
  state: StoreRegistryState;
  blockedBy: string[];
}

export async function updateStoreRegistryState(
  updater: (
    state: StoreRegistryState | null
  ) => StoreRegistryState | Promise<StoreRegistryState>,
  options: StorePathOptions = {}
): Promise<StoreRegistryUpdate> {
  const registryPath = getStoreRegistryPath(options);
  const lockPath = `${registryPath}.lock`;
  const lock = await acquireFileLock({
    lockPath,
    errorFor: storeRegistryLockError,
  });

  try {
    const updated = await updater(await readStoreRegistryState(options));
    // This is THE explicit-mutation seam — the only place a registry is
    // rewritten — so it is where the identity-keyed form is adopted (design
    // D7). Read paths never reach here, which is what keeps a read
    // byte-identical.
    const plan = await upgradeStoreRegistryToV2(updated);
    await writeStoreRegistryState(plan.state, options);
    return { state: plan.state, blockedBy: plan.blockedBy };
  } finally {
    await releaseFileLock(lock, lockPath);
  }
}

export async function readStoreMetadataState(
  storeRoot: string
): Promise<StoreMetadataState> {
  return parseStoreMetadataState(
    await fs.readFile(await resolveReadableStoreMetadataPath(storeRoot), 'utf-8')
  );
}

/**
 * Discriminated probe of whether a Store root carries readable metadata.
 * Routing decisions (Store-first vs Project-first) and post-clone identity
 * verification both consume this: the spec's fail-closed rule turns an
 * unreadable metadata file into a blocked report, never a silent fallthrough
 * to "no Store here".
 *
 * Reuses `resolveReadableStoreMetadataPath` (modern first, legacy second) so
 * both locations are covered without duplicating the precedence the rest of
 * the codebase already agrees on. A file that exists but fails to parse is
 * `unreadable`, distinct from `absent`: collapsing them would tell a user
 * their Store is not a Store.
 */
export type StoreMetadataProbe =
  | { kind: 'absent' }
  | { kind: 'valid'; metadata: StoreMetadataState; path: string }
  | { kind: 'unreadable'; path: string; failure: unknown };

export async function probeStoreMetadataState(
  storeRoot: string
): Promise<StoreMetadataProbe> {
  const readablePath = await resolveReadableStoreMetadataPath(storeRoot);
  if (!(await pathIsFile(readablePath))) {
    return { kind: 'absent' };
  }
  try {
    const metadata = parseStoreMetadataState(
      await fs.readFile(readablePath, 'utf-8')
    );
    return { kind: 'valid', metadata, path: readablePath };
  } catch (failure) {
    return { kind: 'unreadable', path: readablePath, failure };
  }
}

export async function readOptionalStoreMetadataState(
  storeRoot: string
): Promise<StoreMetadataState | null> {
  try {
    return await readStoreMetadataState(storeRoot);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

export async function writeStoreMetadataState(
  storeRoot: string,
  state: StoreMetadataState
): Promise<void> {
  // The single metadata write seam, so it is where "Store metadata never
  // carries credentials" is enforced (design D9) — nothing reaches the file
  // without passing here.
  assertCredentialFreeRemote(state.remote);
  // Temp file in the same directory, then rename: an interrupted write never
  // leaves partially written identity metadata behind.
  await FileSystemUtils.createDirectory(getStoreMetadataDir(storeRoot));
  await writeFileAtomically(
    getStoreMetadataPath(storeRoot),
    serializeStoreMetadataState(state)
  );
}

/**
 * Copies legacy `.openspec-store/store.yaml` forward to `.rasen-store/` when the
 * store's metadata lives only under the legacy name. Copy-only: the legacy
 * directory is left untouched. No-op when the rasen metadata already exists or
 * there is no legacy metadata to migrate. Returns true when a copy was made.
 */
export async function copyForwardLegacyStoreMetadata(
  storeRoot: string
): Promise<boolean> {
  if (await pathIsFile(getStoreMetadataPath(storeRoot))) return false;
  if (!(await pathIsFile(getLegacyStoreMetadataPath(storeRoot)))) return false;

  const legacyState = parseStoreMetadataState(
    await fs.readFile(getLegacyStoreMetadataPath(storeRoot), 'utf-8')
  );
  await writeStoreMetadataState(storeRoot, legacyState);
  return true;
}

export async function resolveGitStoreBackendConfig(
  input: ResolveGitStoreBackendInput,
  cwd = process.cwd()
): Promise<StoreGitBackendConfig> {
  if (input.localPath.length === 0) {
    throw new Error('Store local path must not be empty.');
  }

  const resolvedPath = path.isAbsolute(input.localPath)
    ? path.resolve(input.localPath)
    : path.resolve(cwd, input.localPath);

  if (!(await pathIsDirectory(resolvedPath))) {
    throw new Error(`Store local path does not exist: ${input.localPath}`);
  }

  if (input.remote !== undefined && input.remote.length === 0) {
    throw new Error('Store backend remote must not be empty when provided.');
  }

  if (input.branch !== undefined && input.branch.length === 0) {
    throw new Error('Store branch must not be empty when provided.');
  }

  return {
    type: 'git',
    local_path: normalizeExistingPathForStorage(resolvedPath),
    ...(input.remote ? { remote: input.remote } : {}),
    ...(input.branch ? { branch: input.branch } : {}),
  };
}
