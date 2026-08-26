/**
 * The single Store identity resolver (design D1/D3/D5).
 *
 * Every Phase A consumer answers "which Store is this, and can I use it right
 * now?" through `resolveStoreBinding()`. It returns an exhaustive tri-state,
 * never a bare nullable: `absent` means the project declares no Store — the
 * only state that legitimately resolves with no Store layer — and every other
 * failure is `unavailable`, carrying the identity that was expected, the
 * reason, its diagnostics, and an ordered list of copy-pasteable repairs.
 *
 * The resolver performs ZERO writes on every path: it reads the registry, the
 * Store's metadata, and the Store root's health, and nothing else. It never
 * clones, registers, mints, upgrades, or repairs (plan §5.6, §20.1), and it
 * never touches the network.
 *
 * It lives in `store/` rather than `root-selection.ts` (the plan's §31 code
 * map) because `store/` is the leaf every consumer already imports; placing
 * the implementation in `root-selection.ts` would force `effective-config.ts`
 * and `config-api/*` to import command-facing root selection. `root-selection`
 * keeps §31's responsibility as this tri-state's ADAPTER.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { FileSystemUtils } from '../../utils/file-system.js';
import type { StoreDiagnostic } from './errors.js';
import {
  getStoreMetadataPath,
  listStoreRegistryEntries,
  parseStoreMetadataState,
  readStoreRegistryState,
  type StoreMetadataState,
  type StorePathOptions,
  type StoreRegistryEntry,
} from './foundation.js';
import {
  bootstrapRepair,
  describeStore,
  registerRepair,
  storeAliasAmbiguous,
  storeBootstrapRequired,
  storeMetadataLegacy,
  storePointerAliasDrift,
  storePointerLegacy,
  storePointerRemoteDivergence,
  storeUidMismatch,
} from './identity-diagnostics.js';
import {
  normalizeStoreUid,
  storeUidsMatch,
  type ExpectedStoreRef,
  type ResolvedStoreRef,
} from './identity-types.js';
import { inspectRegisteredStore, type RegisteredStoreInspection } from './inspection.js';

export type StoreUnavailableReason =
  | 'not-registered'
  | 'metadata-missing'
  | 'uid-mismatch'
  | 'root-unhealthy'
  | 'alias-ambiguous'
  | 'pointer-malformed';

/** A registered Store that a display alias matched, for ambiguity reporting. */
export interface StoreBindingCandidate {
  uid?: string;
  id: string;
  root: string;
}

/** How the project's declaration resolved, and what it declared. */
export interface ResolvedStorePointer {
  form: 'alias' | 'durable';
  uid?: string;
  id?: string;
  remote?: string;
}

export interface ResolvedStoreBinding {
  kind: 'resolved';
  store: ResolvedStoreRef;
  pointer: ResolvedStorePointer;
  /** Which of the permanent identity or the display alias did the resolving. */
  resolvedBy: 'uid' | 'alias';
  diagnostics: StoreDiagnostic[];
}

export interface UnavailableStoreBinding {
  kind: 'unavailable';
  expected: ExpectedStoreRef;
  reason: StoreUnavailableReason;
  diagnostics: StoreDiagnostic[];
  /** Ordered, copy-pasteable commands that would make this resolvable. */
  repair: string[];
  /** Every candidate an ambiguous alias matched. */
  candidates?: StoreBindingCandidate[];
  /**
   * The stores that ARE registered here. Present on the `not-registered` arm
   * so a consumer can say "none are registered" rather than "that one is not"
   * when the machine has no stores at all. Each carries its identity and root,
   * because two entries may share a display name and a list of bare names
   * would then repeat itself with nothing to tell the two apart.
   */
  registered?: StoreBindingCandidate[];
}

export type StoreBindingResolution =
  | { kind: 'absent' }
  | ResolvedStoreBinding
  | UnavailableStoreBinding;

/**
 * The declaration side of resolution, decoupled from `readStorePointer`'s file
 * shape so the resolver stays free of a project-config dependency.
 */
export type StoreBindingDeclaration =
  | { form: 'absent' }
  | { form: 'alias'; id: string }
  | { form: 'durable'; uid: string; id?: string; remote?: string }
  | { form: 'malformed'; problem: string; filePath?: string | null };

export interface ResolveStoreBindingInput extends StoreRootMatchOptions {
  declaration: StoreBindingDeclaration;
  /**
   * The project root the declaration was read from. When it is itself a
   * registered Store root — or a linked worktree of one — the declaration is
   * inert (no transitivity).
   */
  projectRoot?: string;
}

function canonicalizeOrResolve(target: string): string {
  try {
    return FileSystemUtils.canonicalizeExistingPath(target);
  } catch {
    return path.resolve(target);
  }
}

function storeEntryRoot(entry: StoreRegistryEntry): string {
  return entry.backend.local_path;
}

/** The registered stores, each with what tells it apart from a namesake. */
function registeredCandidates(
  entries: readonly StoreRegistryEntry[]
): StoreBindingCandidate[] {
  return entries.map((entry) => ({
    ...(entry.uid !== undefined ? { uid: entry.uid } : {}),
    id: entry.id,
    root: storeEntryRoot(entry),
  }));
}

function unavailable(
  expected: ExpectedStoreRef,
  reason: StoreUnavailableReason,
  diagnostics: StoreDiagnostic[],
  repair: string[],
  extra: { candidates?: StoreBindingCandidate[]; registered?: StoreBindingCandidate[] } = {}
): UnavailableStoreBinding {
  return {
    kind: 'unavailable',
    expected,
    reason,
    diagnostics,
    repair,
    ...(extra.candidates ? { candidates: extra.candidates } : {}),
    ...(extra.registered ? { registered: extra.registered } : {}),
  };
}

function doctorRepair(): string {
  return 'rasen doctor';
}

/**
 * Maps a failed health inspection onto the tri-state. Identity failures win
 * over root-health failures, exactly as the inspection itself orders them.
 */
function unavailableFromInspection(
  inspection: Exclude<RegisteredStoreInspection, { kind: 'ok' }>,
  expected: ExpectedStoreRef,
  storeRoot: string
): UnavailableStoreBinding {
  switch (inspection.kind) {
    case 'metadata_missing':
      return unavailable(
        expected,
        'metadata-missing',
        [
          {
            severity: 'error',
            code: 'store_metadata_missing',
            message: `Store ${describeStore(expected)} has no identity metadata at ${inspection.metadataPath}.`,
            target: 'store.metadata',
            fix: `Create ${inspection.metadataPath}, or rerun rasen store register ${storeRoot}.`,
          },
        ],
        [`rasen store register ${storeRoot}`, doctorRepair()]
      );
    case 'metadata_error':
      return unavailable(
        expected,
        'metadata-missing',
        [
          {
            severity: 'error',
            code: 'invalid_store_metadata',
            message: `Store ${describeStore(expected)} has unreadable identity metadata at ${getStoreMetadataPath(storeRoot)}: ${
              inspection.error instanceof Error ? inspection.error.message : String(inspection.error)
            }`,
            target: 'store.metadata',
            fix: `Repair ${getStoreMetadataPath(storeRoot)}.`,
          },
        ],
        [`rasen store doctor ${expected.id ?? ''}`.trim(), doctorRepair()]
      );
    case 'metadata_id_mismatch':
      return unavailable(
        expected,
        'uid-mismatch',
        [
          storeUidMismatch({
            expected: describeStore(expected),
            found: inspection.uid ?? inspection.actualId,
            root: storeRoot,
          }),
        ],
        [`rasen store doctor ${inspection.actualId}`, doctorRepair()]
      );
    case 'unhealthy_root':
      return unavailable(
        expected,
        'root-unhealthy',
        [
          {
            severity: 'error',
            code: 'unhealthy_store_root',
            message: `Store ${describeStore(expected)} does not have a healthy Rasen root at ${storeRoot}: ${inspection.problems}`,
            target: 'openspec.root',
            fix: `Run rasen store doctor ${expected.id ?? ''}`.trim(),
          },
        ],
        [`rasen store doctor ${expected.id ?? ''}`.trim(), doctorRepair()]
      );
  }
}

/**
 * Advisory diagnostics that never block resolution: alias drift, remote
 * divergence, and legacy metadata.
 */
function advisoryDiagnostics(input: {
  declaredId?: string;
  declaredRemote?: string;
  store: ResolvedStoreRef;
  canonicalRemote?: string;
  metadataPath: string;
}): StoreDiagnostic[] {
  const diagnostics: StoreDiagnostic[] = [];

  if (input.declaredId !== undefined && input.declaredId !== input.store.id) {
    diagnostics.push(
      storePointerAliasDrift({
        declared: input.declaredId,
        actual: input.store.id,
        ...(input.store.uid !== undefined ? { uid: input.store.uid } : {}),
      })
    );
  }

  if (
    input.declaredRemote !== undefined &&
    input.canonicalRemote !== undefined &&
    input.declaredRemote !== input.canonicalRemote
  ) {
    diagnostics.push(
      storePointerRemoteDivergence({
        declared: input.declaredRemote,
        canonical: input.canonicalRemote,
      })
    );
  }

  if (input.store.uid === undefined) {
    diagnostics.push(
      storeMetadataLegacy({ id: input.store.id, metadataPath: input.metadataPath })
    );
  }

  return diagnostics;
}

function resolvedFrom(input: {
  entry: StoreRegistryEntry;
  inspection: Extract<RegisteredStoreInspection, { kind: 'ok' }>;
  pointer: ResolvedStorePointer;
  resolvedBy: 'uid' | 'alias';
  extraDiagnostics?: StoreDiagnostic[];
}): ResolvedStoreBinding {
  const store: ResolvedStoreRef = {
    type: 'store',
    id: input.entry.id,
    root: input.inspection.canonicalRoot,
    ...(input.inspection.uid !== undefined ? { uid: input.inspection.uid } : {}),
  };

  return {
    kind: 'resolved',
    store,
    pointer: {
      ...input.pointer,
      ...(store.uid !== undefined ? { uid: store.uid } : {}),
    },
    resolvedBy: input.resolvedBy,
    diagnostics: [
      ...(input.extraDiagnostics ?? []),
      ...advisoryDiagnostics({
        ...(input.pointer.id !== undefined ? { declaredId: input.pointer.id } : {}),
        ...(input.pointer.remote !== undefined ? { declaredRemote: input.pointer.remote } : {}),
        store,
        ...(input.inspection.metadata.remote !== undefined
          ? { canonicalRemote: input.inspection.metadata.remote }
          : {}),
        metadataPath: getStoreMetadataPath(store.root),
      }),
    ],
  };
}

async function readStoreEntries(options: StorePathOptions): Promise<StoreRegistryEntry[]> {
  const registry = await readStoreRegistryState(options);
  if (!registry) return [];
  return listStoreRegistryEntries(registry).filter((entry) => entry.type === 'store');
}

/**
 * Substitutable git repository-identity probe (`store-scope-resolution` D2).
 *
 * Resolves the shared `.git` directory — identical for every worktree of one
 * repository, distinct across clones. Defaults to `gitCommonDir`; tests inject
 * their own so the fallback below can be exercised without a real repository.
 */
export type RepositoryIdentityProbe = (root: string) => Promise<string | null>;

/**
 * Memo for one COMMAND INVOCATION's repository-identity probes, keyed by
 * canonical path.
 *
 * Deliberately caller-owned rather than module-level. Git worktree topology
 * changes under a running process — `workspace apply` adds one, cleanup removes
 * one — so a process-lifetime cache would let the resolver match a root against
 * a repository layout that no longer exists. That is a correctness regression,
 * and a far worse one than the spawns it would save. A caller that resolves
 * many roots in a single command creates ONE of these and lets it die with the
 * command; a caller that resolves once passes nothing and probes directly.
 */
export type RepositoryIdentityCache = Map<string, string | null>;

/**
 * The DEFAULT probe: `git rev-parse --git-common-dir`, reached through a
 * deferred import.
 *
 * The deferral is load-bearing, not stylistic. `identity.ts` is imported early
 * and widely — `effective-config`, `config-api`, `root-selection`,
 * `learned-skills` — and a STATIC edge from here into `./git.js` was enough to
 * put an archive transaction into `abort-required`, with none of this file's
 * logic executing. That was proved by reverting this file to its original
 * content and adding only the import plus a `void` reference: same failure,
 * six of seven `archive-consumer-integration` cases. `git.js` itself is clean
 * (two node imports and two leaf modules, no cycle, no side effects), so the
 * fragility lives in what the archive engine reads at init and is a separate
 * defect — but this module must not be the thing that trips it.
 *
 * Callers that want no dynamic import at all inject `repositoryIdentity`
 * through the seam below, which is also how tests substitute it.
 */
const defaultRepositoryIdentityProbe: RepositoryIdentityProbe = async (root) => {
  const { gitCommonDir } = await import('./git.js');
  return gitCommonDir(root);
};

export interface StoreRootMatchOptions extends StorePathOptions {
  readonly repositoryIdentity?: RepositoryIdentityProbe;
  readonly repositoryIdentityCache?: RepositoryIdentityCache;
}

function comparableRepositoryIdentity(commonDir: string): string {
  const resolved = path.resolve(commonDir);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** The Store metadata physically at this root, or null when there is none. */
async function readStoreMetadataAtRoot(
  canonicalRoot: string
): Promise<StoreMetadataState | null> {
  try {
    const text = await fs.readFile(getStoreMetadataPath(canonicalRoot), 'utf8');
    return parseStoreMetadataState(text);
  } catch {
    return null;
  }
}

/**
 * Does the metadata a checkout carries name the same Store as this entry?
 * The permanent uid decides whenever both sides have one; the display alias is
 * the legacy fallback, never an override.
 */
function storeMetadataMatchesEntry(
  entry: StoreRegistryEntry,
  metadata: StoreMetadataState
): boolean {
  const metadataUid = metadata.version === 2 ? metadata.uid : undefined;
  if (entry.uid !== undefined && metadataUid !== undefined) {
    return storeUidsMatch(entry.uid, metadataUid);
  }
  return metadata.id === entry.id;
}

/**
 * Wraps a probe so each canonical path is spawned for AT MOST ONCE per cache.
 *
 * A miss and a hit are both memoized: `null` (Git absent, not a working tree,
 * bare repository) is a real answer and re-spawning to re-learn it is the cost
 * this exists to avoid. Without a cache the wrapper is the identity function,
 * so behaviour is unchanged for every caller that passes none.
 */
function probeThroughCache(
  probe: RepositoryIdentityProbe,
  cache: RepositoryIdentityCache | undefined
): RepositoryIdentityProbe {
  if (cache === undefined) return probe;
  return async (target) => {
    if (cache.has(target)) return cache.get(target) ?? null;
    const resolved = await probe(target);
    cache.set(target, resolved);
    return resolved;
  };
}

/**
 * The registered entry this root IS, by canonical path first and by git
 * repository identity second (`store-scope-resolution` D2).
 *
 * The fallback exists because the machine registry holds ONE locator per Store
 * — its main checkout — while planning happens in linked worktrees of that
 * same repository. Path equality alone therefore answers "no" for every
 * planning worktree, which is how retention and archive came to refuse the
 * layout the rest of the system creates.
 *
 * It stays fail-closed in three ways, in this order: the root must carry Store
 * metadata at all (so no ordinary project pays for a git spawn, and no
 * non-Store directory can ever match); that metadata must name exactly one
 * registered entry (a disagreeing or ambiguous identity is no match, and the
 * caller's own resolution then reports the mismatch by name); and only then is
 * the repository probed, on both sides, with equality of the resolved common
 * directory required. A probe that cannot run — Git absent, not a working
 * tree, a bare or deleted main checkout — leaves matching exactly as it was:
 * no match, never a wrong one.
 */
async function findRegisteredStoreEntryAtRoot(
  root: string,
  entries: readonly StoreRegistryEntry[],
  options: StoreRootMatchOptions
): Promise<StoreRegistryEntry | null> {
  const canonicalRoot = canonicalizeOrResolve(root);
  const byPath = entries.find(
    (candidate) => canonicalizeOrResolve(storeEntryRoot(candidate)) === canonicalRoot
  );
  if (byPath) return byPath;

  const metadata = await readStoreMetadataAtRoot(canonicalRoot);
  if (!metadata) return null;
  const identityMatches = entries.filter((candidate) =>
    storeMetadataMatchesEntry(candidate, metadata)
  );
  if (identityMatches.length !== 1) return null;
  const entry = identityMatches[0] as StoreRegistryEntry;

  const probe = probeThroughCache(
    options.repositoryIdentity ?? defaultRepositoryIdentityProbe,
    options.repositoryIdentityCache
  );
  const [rootCommonDir, entryCommonDir] = await Promise.all([
    probe(canonicalRoot),
    probe(canonicalizeOrResolve(storeEntryRoot(entry))),
  ]);
  if (!rootCommonDir || !entryCommonDir) return null;
  return comparableRepositoryIdentity(rootCommonDir) ===
    comparableRepositoryIdentity(entryCommonDir)
    ? entry
    : null;
}

/**
 * No-transitivity, made mechanical: a root that is itself a registered Store
 * — or a linked worktree of one — never resolves its own `store:` declaration
 * into a binding.
 */
async function isRegisteredStoreRootPath(
  projectRoot: string | undefined,
  entries: readonly StoreRegistryEntry[],
  options: StoreRootMatchOptions
): Promise<boolean> {
  if (!projectRoot) return false;
  return (await findRegisteredStoreEntryAtRoot(projectRoot, entries, options)) !== null;
}

/**
 * The registered Store this path IS, or null. The read-only answer to "is this
 * planning root a Store's own root?", so a consumer never has to enumerate the
 * registry itself (and so it never reaches for the compat reader to ask). A
 * linked worktree of a registered Store's repository answers as that Store.
 */
export async function findRegisteredStoreAtRoot(
  root: string,
  options: StoreRootMatchOptions = {}
): Promise<ResolvedStoreRef | null> {
  const entries = await readStoreEntries(options);
  const entry = await findRegisteredStoreEntryAtRoot(root, entries, options);
  if (!entry) return null;
  return {
    type: 'store',
    id: entry.id,
    root: canonicalizeOrResolve(storeEntryRoot(entry)),
    ...(entry.uid !== undefined ? { uid: entry.uid } : {}),
  };
}

/** Design D5 path 1: the permanent identity is exact and never consults aliases. */
async function resolveByUid(
  declaration: Extract<StoreBindingDeclaration, { form: 'durable' }>,
  entries: readonly StoreRegistryEntry[]
): Promise<StoreBindingResolution> {
  const expected: ExpectedStoreRef = {
    type: 'store',
    uid: declaration.uid,
    ...(declaration.id !== undefined ? { id: declaration.id } : {}),
    ...(declaration.remote !== undefined ? { remote: declaration.remote } : {}),
  };

  const entry = entries.find((candidate) => storeUidsMatch(candidate.uid, declaration.uid));
  if (!entry) {
    // A registry that still predates identity keying cannot answer a UID
    // lookup directly; fall back to matching the checkout's own metadata,
    // which is where the identity actually lives.
    const legacyMatch = await findEntryByMetadataUid(entries, declaration.uid);
    if (!legacyMatch) {
      return unavailable(
        expected,
        'not-registered',
        [storeBootstrapRequired(expected)],
        // Bootstrap first (the whole-gap repair that registers, obtains, and
        // prepares), the single-step `register` second, `doctor` last for
        // diagnosis (design D1).
        [bootstrapRepair(expected), registerRepair(expected), doctorRepair()],
        { registered: registeredCandidates(entries) }
      );
    }
    return inspectAndResolve(legacyMatch, expected, declaration, 'uid');
  }

  return inspectAndResolve(entry, expected, declaration, 'uid');
}

async function findEntryByMetadataUid(
  entries: readonly StoreRegistryEntry[],
  uid: string
): Promise<StoreRegistryEntry | null> {
  const wanted = normalizeStoreUid(uid);
  for (const entry of entries) {
    const inspection = await inspectRegisteredStore(entry.id, storeEntryRoot(entry));
    if (inspection.kind === 'ok' && inspection.uid && normalizeStoreUid(inspection.uid) === wanted) {
      return entry;
    }
  }
  return null;
}

async function inspectAndResolve(
  entry: StoreRegistryEntry,
  expected: ExpectedStoreRef,
  declaration: Extract<StoreBindingDeclaration, { form: 'durable' }>,
  resolvedBy: 'uid'
): Promise<StoreBindingResolution> {
  const storeRoot = storeEntryRoot(entry);
  const inspection = await inspectRegisteredStore(entry.id, storeRoot);
  if (inspection.kind !== 'ok') {
    return unavailableFromInspection(inspection, expected, storeRoot);
  }

  // The checkout must carry the identity the project asked for. A registry
  // entry can go stale (a folder re-cloned from a different Store); the
  // metadata is the authority, so a disagreement fails closed.
  if (!storeUidsMatch(inspection.uid, declaration.uid)) {
    return unavailable(
      expected,
      'uid-mismatch',
      [
        storeUidMismatch({
          expected: declaration.uid,
          ...(inspection.uid !== undefined ? { found: inspection.uid } : {}),
          root: inspection.canonicalRoot,
        }),
      ],
      [`rasen store doctor ${entry.id}`, doctorRepair()]
    );
  }

  return resolvedFrom({
    entry,
    inspection,
    pointer: {
      form: 'durable',
      uid: declaration.uid,
      ...(declaration.id !== undefined ? { id: declaration.id } : {}),
      ...(declaration.remote !== undefined ? { remote: declaration.remote } : {}),
    },
    resolvedBy,
  });
}

/** Design D5 path 2: alias lookup with explicit arity, never a silent pick. */
async function resolveByAlias(
  id: string,
  entries: readonly StoreRegistryEntry[]
): Promise<StoreBindingResolution> {
  const expected: ExpectedStoreRef = { type: 'store', id };
  const matches = entries.filter((entry) => entry.id === id);

  if (matches.length === 0) {
    return unavailable(
      expected,
      'not-registered',
      [storeBootstrapRequired(expected)],
      // Same ordering as the uid path (design D1): bootstrap first.
      [bootstrapRepair(expected), registerRepair(expected), doctorRepair()],
      { registered: registeredCandidates(entries) }
    );
  }

  if (matches.length > 1) {
    const candidates: StoreBindingCandidate[] = matches.map((entry) => ({
      ...(entry.uid !== undefined ? { uid: entry.uid } : {}),
      id: entry.id,
      root: storeEntryRoot(entry),
    }));
    const diagnostic = storeAliasAmbiguous({ id, candidates });
    return unavailable(
      expected,
      'alias-ambiguous',
      [diagnostic],
      [diagnostic.fix ?? doctorRepair(), doctorRepair()],
      { candidates }
    );
  }

  const entry = matches[0] as StoreRegistryEntry;
  const storeRoot = storeEntryRoot(entry);
  const inspection = await inspectRegisteredStore(entry.id, storeRoot);
  if (inspection.kind !== 'ok') {
    return unavailableFromInspection(inspection, expected, storeRoot);
  }

  return resolvedFrom({
    entry,
    inspection,
    pointer: { form: 'alias', id },
    resolvedBy: 'alias',
    extraDiagnostics: [
      storePointerLegacy({
        id,
        ...(inspection.uid !== undefined ? { uid: inspection.uid } : {}),
      }),
    ],
  });
}

/**
 * Resolves a project's Store declaration into the exhaustive tri-state.
 * Performs no writes on any path.
 */
export async function resolveStoreBinding(
  input: ResolveStoreBindingInput
): Promise<StoreBindingResolution> {
  const { declaration } = input;

  if (declaration.form === 'absent') {
    return { kind: 'absent' };
  }

  if (declaration.form === 'malformed') {
    const expected: ExpectedStoreRef = { type: 'store' };
    const location = declaration.filePath ? ` in ${declaration.filePath}` : '';
    return unavailable(
      expected,
      'pointer-malformed',
      [
        {
          severity: 'error',
          code: 'invalid_store_pointer',
          message: `The store declaration${location} cannot be read (${declaration.problem}).`,
          target: 'store.pointer',
          ...(declaration.filePath
            ? { fix: `Fix or remove the store: declaration in ${declaration.filePath}.` }
            : {}),
        },
      ],
      declaration.filePath ? [`Edit ${declaration.filePath}`, doctorRepair()] : [doctorRepair()]
    );
  }

  // `ResolveStoreBindingInput` extends `StoreRootMatchOptions`, so every match
  // option a caller declares has to survive the hop into `pathOptions`.
  // Forwarding the probe while dropping its cache left the cache reachable
  // only through `findRegisteredStoreAtRoot` - D2's "cached per invocation"
  // mitigation existing in the type and nowhere a caller could reach it.
  const pathOptions: StoreRootMatchOptions = {
    ...(input.globalDataDir !== undefined ? { globalDataDir: input.globalDataDir } : {}),
    ...(input.repositoryIdentity !== undefined
      ? { repositoryIdentity: input.repositoryIdentity }
      : {}),
    ...(input.repositoryIdentityCache !== undefined
      ? { repositoryIdentityCache: input.repositoryIdentityCache }
      : {}),
  };
  const entries = await readStoreEntries(pathOptions);

  if (await isRegisteredStoreRootPath(input.projectRoot, entries, pathOptions)) {
    // A Store root never inherits from its own declaration.
    return { kind: 'absent' };
  }

  if (declaration.form === 'durable') {
    return resolveByUid(declaration, entries);
  }

  return resolveByAlias(declaration.id, entries);
}

/**
 * Exhaustiveness guard for consumers: a future `unavailable` reason must be
 * handled explicitly rather than falling into a default branch.
 */
export function assertNeverStoreBinding(resolution: never): never {
  throw new Error(`Unhandled store binding resolution: ${JSON.stringify(resolution)}`);
}

/** The first repair command, which is what a one-line message shows. */
export function primaryRepair(binding: UnavailableStoreBinding): string {
  return binding.repair[0] ?? doctorRepair();
}

/**
 * The one-line failure message every fail-closed surface prints: what was
 * expected, why it could not be used, that nothing was written or fetched, and
 * the next command to run.
 */
export function describeUnavailableStore(binding: UnavailableStoreBinding): string {
  const detail = binding.diagnostics[0]?.message ?? `Store ${describeStore(binding.expected)} is unavailable.`;
  return `${detail} No network access and no changes were made. Next: ${primaryRepair(binding)}`;
}
