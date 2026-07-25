import { WORKSPACE_DIR_NAME } from './config.js';
/**
 * Shared Rasen root resolution for normal commands.
 *
 * Normal commands (`new change`, `status`, `instructions`, `list`, `show`,
 * `validate`, `archive`) resolve one Rasen root through this module:
 *
 * - `--store <id>` selects a registered store's root.
 * - Without `--store`, the nearest ancestor containing `rasen/` wins.
 *   Leftover workspace view state is never considered a root here.
 * - With no nearest root, registered stores produce a selection hint error;
 *   otherwise commands may treat the current directory as an implicit root.
 *
 * Diagnostic codes reuse the store taxonomy where an error passes
 * through unchanged (`invalid_store_id`, metadata parse failures);
 * resolver-specific failures use the normal-command codes below
 * (`unknown_store`, `no_registered_stores`, `store_identity_mismatch`,
 * `unhealthy_store_root`, `store_path_not_supported`,
 * `invalid_store_pointer`, `no_root_with_registered_stores`,
 * `no_openspec_root`).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

import { StoreError } from './store/errors.js';
import {
  listStoreRegistryEntries,
  readStoreRegistryState,
  validateStoreId,
} from './store/foundation.js';
import { getStoreRootForBackend } from './store/registry.js';
import {
  primaryRepair,
  resolveStoreBinding,
  type StoreUnavailableReason,
  type UnavailableStoreBinding,
} from './store/identity.js';
import { isValidStoreUid, storeUidsMatch } from './store/identity-types.js';
import {
  inspectRegisteredStore,
  type RegisteredStoreInspection,
} from './store/inspection.js';
import {
  findRepoPlanningRootSync,
  findLegacyWorkspaceRootSync,
  legacyWorkspaceGuidance,
  type PlanningHome,
} from './planning-home.js';
import { classifyOpenSpecDir, readProjectConfig } from './project-config.js';
import { touchProjectRegistry, resolveProjectHome } from './project-home.js';
import { findProjectRegistryEntry } from './project-registry.js';
import { storeBindingDeclarationFrom } from './effective-config.js';
import { FileSystemUtils } from '../utils/file-system.js';
import { getAllToolVersionStatus } from './shared/index.js';
import { reportConfigDiagnostic } from './config-diagnostics.js';
import { createConfigDiagnosticReporter } from './config-diagnostic-locale.js';
import { readLastWarnedVersionPair, writeLastWarnedVersionPair } from './version-guard-state.js';

const require = createRequire(import.meta.url);
const { version: OPENSPEC_VERSION } = require('../../package.json');

export type OpenSpecRootSource = 'store' | 'declared' | 'nearest' | 'implicit';

/** Registry namespace a selected/resolved root belongs to. */
export type StoreEntryType = 'store' | 'project';

export interface StoreSelectorOptions {
  store?: string;
  project?: string;
  storePath?: string;
}

export interface ResolveOpenSpecRootOptions extends StoreSelectorOptions {
  startPath?: string;
  allowImplicitRoot?: boolean;
  globalDataDir?: string;
  reporter?: RootSelectionReporter | false;
  /**
   * Read-only diagnostic opt-out (design D4). A declared Store that cannot be
   * used normally stops the command; `rasen doctor` sets this so it keeps
   * working in exactly the state it exists to report, emitting the notice
   * instead of failing.
   */
  allowUnavailableStore?: boolean;
}

export interface ResolvedOpenSpecRoot {
  path: string;
  changesDir: string;
  specsDir: string;
  archiveDir: string;
  defaultSchema: 'spec-driven';
  source: OpenSpecRootSource;
  storeId?: string;
  /** Set alongside storeId; the namespace the id was resolved from. */
  storeType?: StoreEntryType;
}

export type RootSelectionNotice =
  | {
    kind: 'inheriting-store-config';
    filePath: string;
    storeId: string;
    /** Which of the permanent identity or the display alias resolved it. */
    resolvedBy: 'uid' | 'alias';
  }
  | {
    kind: 'unavailable-store-declaration';
    filePath: string;
    storeId: string;
    reason: StoreUnavailableReason;
    repair: string;
  }
  | {
    kind: 'selected-root';
    path: string;
    storeId: string;
    storeType: StoreEntryType;
  };

export type RootSelectionReporter = (notice: RootSelectionNotice) => void;

/** English fallback phrasing for each unavailable reason, shared by surfaces. */
export const STORE_UNAVAILABLE_REASON_TEXT: Record<StoreUnavailableReason, string> = {
  'not-registered': 'it is not registered on this machine',
  'metadata-missing': 'its identity metadata is missing or unreadable',
  'uid-mismatch': 'the registered checkout is a different store',
  'root-unhealthy': 'its Rasen root is missing or incomplete',
  'alias-ambiguous': 'that name matches more than one registered store',
  'pointer-malformed': 'the declaration cannot be read',
};

function defaultRootSelectionReporter(notice: RootSelectionNotice): void {
  if (notice.kind === 'inheriting-store-config') {
    const by =
      notice.resolvedBy === 'uid'
        ? 'Resolved by its permanent identity.'
        : 'Resolved by its display name.';
    console.error(
      `${notice.filePath} declares store '${notice.storeId}'; planning stays local and configuration inherits from that store. ${by}`
    );
    return;
  }

  if (notice.kind === 'unavailable-store-declaration') {
    console.error(
      `Warning: ${notice.filePath} declares store '${notice.storeId}', but it cannot be used on this machine (${STORE_UNAVAILABLE_REASON_TEXT[notice.reason]}). Next: ${notice.repair}`
    );
    return;
  }

  const label = notice.storeType === 'project' ? 'project ' : '';
  console.error(`Using Rasen root: ${label}${notice.storeId} (${notice.path})`);
}

function reportRootSelectionNotice(
  reporter: RootSelectionReporter | false | undefined,
  notice: RootSelectionNotice
): void {
  if (reporter === false) return;
  (reporter ?? defaultRootSelectionReporter)(notice);
}

export interface RootSelectionDiagnostic {
  severity: 'error';
  code: string;
  message: string;
  target?: string;
  fix?: string;
}

export class RootSelectionError extends Error {
  readonly diagnostic: RootSelectionDiagnostic;

  constructor(
    message: string,
    code: string,
    options: { target?: string; fix?: string } = {}
  ) {
    super(message);
    this.name = 'RootSelectionError';
    this.diagnostic = {
      severity: 'error',
      code,
      message,
      ...options,
    };
  }
}

export function isRootSelectionError(error: unknown): error is RootSelectionError {
  return error instanceof RootSelectionError;
}

function fromStoreError(error: unknown): never {
  if (error instanceof StoreError) {
    throw new RootSelectionError(error.message, error.diagnostic.code, {
      ...(error.diagnostic.target ? { target: error.diagnostic.target } : {}),
      ...(error.diagnostic.fix ? { fix: error.diagnostic.fix } : {}),
    });
  }

  throw error;
}

function doctorFix(id: string): string {
  return `Run rasen store doctor ${id} to inspect it.`;
}

function makeRoot(
  rootPath: string,
  source: OpenSpecRootSource,
  storeId?: string,
  storeType?: StoreEntryType
): ResolvedOpenSpecRoot {
  return {
    path: rootPath,
    changesDir: path.join(rootPath, WORKSPACE_DIR_NAME, 'changes'),
    specsDir: path.join(rootPath, WORKSPACE_DIR_NAME, 'specs'),
    archiveDir: path.join(rootPath, WORKSPACE_DIR_NAME, 'changes', 'archive'),
    defaultSchema: 'spec-driven',
    source,
    ...(storeId ? { storeId, storeType: storeType ?? 'store' } : {}),
  };
}

function canonicalDirectory(startPath: string): string {
  const resolved = path.resolve(startPath);

  try {
    const stats = fs.statSync(resolved);
    const dir = stats.isDirectory() ? resolved : path.dirname(resolved);
    return FileSystemUtils.canonicalizeExistingPath(dir);
  } catch {
    return resolved;
  }
}

/**
 * Renders a list of registered stores for an error message. A display name is
 * only a name: when two entries share one, repeating it twice tells the reader
 * nothing, so those entries carry their identity and root. Unique names stay
 * bare, which keeps the common message unchanged.
 */
function renderRegisteredList(
  entries: readonly { id: string; uid?: string; root: string }[]
): string {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
  }
  return entries
    .map((entry) =>
      (counts.get(entry.id) ?? 0) > 1
        ? `${entry.id} (${entry.uid ?? 'no identity'} at ${entry.root})`
        : entry.id
    )
    .join(', ');
}

async function resolveStoreRoot(
  id: string,
  globalDataDir?: string,
  source: OpenSpecRootSource = 'store',
  type: StoreEntryType = 'store'
): Promise<ResolvedOpenSpecRoot> {
  // A permanent identity is a legitimate way to name a store here: it is the
  // ONLY way to name one of two stores that share a display alias, so the
  // identity check runs before the alias-shaped id validation (an uppercase
  // UUID is not kebab-case, and would otherwise be rejected as a bad name).
  const selectsByUid = type === 'store' && isValidStoreUid(id);
  if (!selectsByUid) {
    try {
      validateStoreId(id);
    } catch (error) {
      fromStoreError(error);
    }
  }

  const noun = type === 'project' ? 'project' : 'store';
  let registry;
  try {
    registry = await readStoreRegistryState(globalDataDir ? { globalDataDir } : {});
  } catch (error) {
    fromStoreError(error);
  }
  const entries = (registry ? listStoreRegistryEntries(registry) : []).filter(
    (candidate) => candidate.type === type
  );
  const registered = entries.map((candidate) => ({
    id: candidate.id,
    ...(candidate.uid !== undefined ? { uid: candidate.uid } : {}),
    root: getStoreRootForBackend(candidate.backend),
  }));
  const matches = selectsByUid
    ? entries.filter((candidate) => storeUidsMatch(candidate.uid, id))
    : entries.filter((candidate) => candidate.id === id);

  // A display name is an alias, not an identity: two stores may carry the
  // same one. Naming one is ambiguous, never a silent pick (design D5).
  if (type === 'store' && matches.length > 1) {
    const rendered = matches
      .map(
        (candidate) =>
          `${candidate.uid ?? '(no identity)'} — ${candidate.id} at ${getStoreRootForBackend(candidate.backend)}`
      )
      .join('; ');
    throw new RootSelectionError(
      `The name '${id}' matches ${matches.length} registered stores: ${rendered}. A name is a display alias, not an identity.`,
      'store_alias_ambiguous',
      {
        target: 'store.id',
        // `upgrade-identity` rewrites a PROJECT declaration and does nothing
        // for this flag; the actionable repair here is to pass the identity
        // to --store instead of the name.
        fix: `Pass the store's permanent identity to --store instead of its name, choosing one of the identities listed above.`,
      }
    );
  }

  const entry = matches[0];

  if (!entry) {
    if (entries.length === 0) {
      throw new RootSelectionError(
        `Unknown ${noun} '${id}'. No ${noun}s are registered.`,
        'no_registered_stores',
        {
          target: 'store.id',
          fix:
            type === 'project'
              ? `Run rasen store add-project <path> --to <store-id> --as ${id} first.`
              : `Run rasen store setup ${id} or rasen store register <path> first.`,
        }
      );
    }

    throw new RootSelectionError(
      `Unknown ${noun} '${id}'. Registered ${noun}s: ${renderRegisteredList(registered)}.`,
      'unknown_store',
      {
        target: 'store.id',
        fix: `Pass a registered ${noun} id or permanent identity, or run rasen store list.`,
      }
    );
  }

  const storeRoot = getStoreRootForBackend(entry.backend);
  // The selected entry's own display name identifies it from here on: a
  // selection made by permanent identity must still report (and record on the
  // resolved root) the store's name, not the UUID the user typed.
  const selectedId = entry.id;
  const inspection = await inspectRegisteredStore(selectedId, storeRoot);

  switch (inspection.kind) {
    case 'metadata_error':
      return fromStoreError(inspection.error);
    case 'metadata_missing':
      // The doctor pointer lives in the message because human-mode command
      // wrappers print only the message, not the fix field.
      throw new RootSelectionError(
        `${type === 'project' ? 'Project' : 'Store'} '${selectedId}' is missing identity metadata at ${inspection.metadataPath}. ${doctorFix(selectedId)}`,
        'store_identity_mismatch',
        { target: 'store.metadata', fix: doctorFix(selectedId) }
      );
    case 'metadata_id_mismatch':
      throw new RootSelectionError(
        `${type === 'project' ? 'Project' : 'Store'} '${selectedId}' metadata id '${inspection.actualId}' does not match its registered id. ${doctorFix(selectedId)}`,
        'store_identity_mismatch',
        { target: 'store.metadata', fix: doctorFix(selectedId) }
      );
    case 'unhealthy_root':
      throw new RootSelectionError(
        `${type === 'project' ? 'Project' : 'Store'} '${selectedId}' does not have a healthy Rasen root at ${storeRoot}: ${inspection.problems} ${doctorFix(selectedId)}`,
        'unhealthy_store_root',
        { target: 'openspec.root', fix: doctorFix(selectedId) }
      );
    case 'ok':
      return makeRoot(inspection.canonicalRoot, source, selectedId, type);
    default: {
      // Exhaustiveness guard: a new inspection kind must be handled
      // here explicitly, not fall through to an undefined root.
      const unhandled: never = inspection;
      throw new Error(`Unhandled store inspection kind: ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * The shared read-only store inspection now lives in `store/inspection.ts`, so
 * the identity resolver can reuse it without inverting the dependency
 * direction. Re-exported here because this module has been its import site
 * since it was written — there is still exactly one implementation.
 */
export { inspectRegisteredStore };
export type { RegisteredStoreInspection };

/**
 * Classifies the nearest `rasen/` directory (slice 3.2): a planning
 * shape (specs/ or changes/ directories) is a real root and wins —
 * fallback never override. A config-only directory with a `store:`
 * pointer resolves the declared store; without one, it stays a root
 * (today's behavior for freshly initialized minimal roots).
 */
/**
 * The nearest-root walk, qualified: a `rasen/` DIRECTORY alone is
 * not a root — it must carry a planning shape or a config file.
 * Without this, the recommended `~/rasen/<id>` store layout would
 * make $HOME a phantom root that captures every command under the
 * home tree.
 */
export function findQualifyingRootSync(startPath: string): string | null {
  let candidate = findRepoPlanningRootSync(startPath);
  while (candidate) {
    const { hasPlanningShape, pointer } = classifyOpenSpecDir(candidate);
    if (hasPlanningShape || pointer.filePath) {
      return candidate;
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      return null;
    }
    candidate = findRepoPlanningRootSync(parent);
  }
  return null;
}

/** Canonicalizes an existing path; falls back to `path.resolve` for a path that does not exist on disk (a stale registered root). */
function canonicalizeOrResolve(target: string): string {
  try {
    return FileSystemUtils.canonicalizeExistingPath(target);
  } catch {
    return path.resolve(target);
  }
}

/**
 * A planning space derived from a working directory (planning-space-addressing
 * design D5). `{ type, id, root }` — the shared shape frozen on session records
 * and emitted by `rasen ui` as a `?space=<type>:<id>` selector. `root` is
 * canonical.
 */
export interface DerivedSpace {
  type: 'project' | 'store';
  id: string;
  root: string;
}

export interface DeriveSpaceOptions {
  /** Test/DI override for the machine registries; defaults to getGlobalDataDir(). */
  globalDataDir?: string;
}

/**
 * The one shared cwd→space derivation (design D5), read-only, used by both
 * `rasen ui` (URL emission) and session space attribution: the nearest
 * qualifying `rasen/` root wins; a root with planning shape is that repo's
 * project space (its registry entry id, else its config `projectId`); a
 * config-only root whose `store:` pointer names a registered store is that
 * store's space (id = pointer value, root = registered store root); a
 * malformed pointer, an unregistered store, or a planning root with no
 * resolvable identity yields no space (callers degrade rather than fail).
 * Never mutates any registry, config, or directory.
 */
export async function deriveSpaceFromCwd(
  startPath: string,
  options: DeriveSpaceOptions = {}
): Promise<DerivedSpace | null> {
  const pathOptions = options.globalDataDir !== undefined ? { globalDataDir: options.globalDataDir } : {};

  const root = findQualifyingRootSync(startPath);
  if (!root) return null;

  const { hasPlanningShape, pointer } = classifyOpenSpecDir(root);

  if (hasPlanningShape) {
    const registryEntry = await findProjectRegistryEntry(root, pathOptions);
    if (registryEntry) {
      return { type: 'project', id: registryEntry.entry.projectId, root: registryEntry.canonicalPath };
    }
    const projectId = readProjectConfig(root)?.projectId;
    if (projectId) {
      return { type: 'project', id: projectId, root: canonicalizeOrResolve(root) };
    }
    // Planning-shaped but no resolvable identity (never registered, no minted
    // projectId): no space id to emit or filter by — degrade to no space.
    return null;
  }

  // Config-only root: a well-formed `store:` declaration that resolves
  // attributes to that store's space; anything else degrades to no space
  // (this derivation is advisory — callers degrade rather than fail).
  const binding = await resolveStoreBinding({
    declaration: storeBindingDeclarationFrom(pointer),
    ...pathOptions,
  });
  if (binding.kind === 'resolved') {
    return { type: 'store', id: binding.store.id, root: binding.store.root };
  }
  return null;
}

/**
 * Maps an `unavailable` binding onto THIS module's established error
 * vocabulary (design D1's adapter role) — the codes and shapes callers and
 * agents already key on, not a parallel taxonomy. Only the not-registered arm
 * needs the registry's own facts, which the binding carries.
 */
export function rootSelectionErrorFor(
  binding: UnavailableStoreBinding,
  origin: string | null
): RootSelectionError {
  const diagnostic = binding.diagnostics[0];
  const named = binding.expected.id ?? binding.expected.uid ?? 'the declared store';
  const prefix = origin ? `Declared in ${origin}: ` : '';
  const suffix = ' This command performed no network access and no writes.';

  const build = (message: string, code: string, fix: string): RootSelectionError =>
    new RootSelectionError(`${prefix}${message}${suffix} Next: ${fix}`, code, {
      target: diagnostic?.target ?? 'store.pointer',
      fix,
    });

  switch (binding.reason) {
    case 'not-registered': {
      const registered = binding.registered ?? [];
      if (registered.length === 0) {
        return build(
          `Unknown store '${named}'. No stores are registered.`,
          'no_registered_stores',
          origin
            ? `Register the store (rasen store register <path> --id ${named}) or edit ${origin} to name a registered store.`
            : `Run rasen store setup ${named} or rasen store register <path> first.`
        );
      }
      return build(
        `Unknown store '${named}'. Registered stores: ${renderRegisteredList(registered)}.`,
        'unknown_store',
        origin
          ? `Register the store (rasen store register <path> --id ${named}) or edit ${origin} to name a registered store.`
          : 'Pass a registered store id, or run rasen store list.'
      );
    }
    case 'alias-ambiguous':
      return build(
        diagnostic?.message ?? `The name '${named}' matches more than one registered store.`,
        'store_alias_ambiguous',
        primaryRepair(binding)
      );
    case 'metadata-missing':
    case 'uid-mismatch':
      return build(
        diagnostic?.message ?? `Store '${named}' does not carry the expected identity.`,
        'store_identity_mismatch',
        primaryRepair(binding)
      );
    case 'root-unhealthy':
      return build(
        diagnostic?.message ?? `Store '${named}' does not have a healthy Rasen root.`,
        'unhealthy_store_root',
        primaryRepair(binding)
      );
    case 'pointer-malformed':
      return build(
        diagnostic?.message ?? 'The store declaration cannot be read.',
        'invalid_store_pointer',
        primaryRepair(binding)
      );
  }
}

async function resolveNearestOrDeclaredRoot(
  nearestRoot: string,
  globalDataDir?: string,
  reporter?: RootSelectionReporter | false,
  allowUnavailableStore = false
): Promise<ResolvedOpenSpecRoot> {
  const { hasPlanningShape, pointer } = classifyOpenSpecDir(nearestRoot);
  const pathOptions = globalDataDir ? { globalDataDir } : {};
  const declaration = storeBindingDeclarationFrom(pointer);

  if (hasPlanningShape) {
    // A `store:` declaration beside local planning declares configuration
    // inheritance (store-config-inheritance): planning stays local (this root
    // still wins), but the declaration must resolve. The notice is gated on
    // the SAME resolver `resolveConfigStoreLayer` uses, so the two can never
    // disagree — including the no-transitivity case (a root that IS a
    // registered store resolves `absent` for its own declaration and stays
    // silent). A declaration that cannot be used stops the command, except on
    // the read-only diagnostic surfaces that exist to report it.
    if (declaration.form === 'absent') {
      return makeRoot(nearestRoot, 'nearest');
    }

    const binding = await resolveStoreBinding({
      declaration,
      projectRoot: nearestRoot,
      ...pathOptions,
    });

    if (binding.kind === 'resolved' && pointer.filePath !== null) {
      reportRootSelectionNotice(reporter, {
        kind: 'inheriting-store-config',
        filePath: pointer.filePath,
        storeId: binding.store.id,
        resolvedBy: binding.resolvedBy,
      });
    } else if (binding.kind === 'unavailable') {
      if (!allowUnavailableStore) {
        throw rootSelectionErrorFor(binding, pointer.filePath);
      }
      if (pointer.filePath !== null) {
        reportRootSelectionNotice(reporter, {
          kind: 'unavailable-store-declaration',
          filePath: pointer.filePath,
          storeId: binding.expected.id ?? binding.expected.uid ?? '(unnamed)',
          reason: binding.reason,
          repair: primaryRepair(binding),
        });
      }
    }

    return makeRoot(nearestRoot, 'nearest');
  }

  if (declaration.form === 'absent') {
    return makeRoot(nearestRoot, 'nearest');
  }

  if (declaration.form === 'malformed') {
    // The established message/fix pair for an unreadable declaration: it
    // already names the file and the problem, so it is not re-prefixed.
    throw new RootSelectionError(
      `Invalid store declaration in ${pointer.filePath}: ${declaration.problem}.`,
      'invalid_store_pointer',
      {
        target: 'store.pointer',
        fix:
          pointer.malformed === 'unparseable'
            ? `Fix the YAML syntax in ${pointer.filePath}.`
            : `Edit ${pointer.filePath} so the store key is a registered store id or a declaration carrying a uid, or remove it.`,
      }
    );
  }

  // Config-only pointer directory: the declaration resolves the root itself.
  if (declaration.form === 'alias') {
    try {
      validateStoreId(declaration.id);
    } catch (error) {
      if (error instanceof StoreError) {
        throw new RootSelectionError(
          `Declared in ${pointer.filePath}: ${error.message}`,
          error.diagnostic.code,
          {
            ...(error.diagnostic.target ? { target: error.diagnostic.target } : {}),
            ...(error.diagnostic.fix ? { fix: error.diagnostic.fix } : {}),
          }
        );
      }
      throw error;
    }
  }
  const binding = await resolveStoreBinding({ declaration, ...pathOptions });
  if (binding.kind === 'unavailable') {
    throw rootSelectionErrorFor(binding, pointer.filePath);
  }
  if (binding.kind === 'absent') {
    return makeRoot(nearestRoot, 'nearest');
  }

  return makeRoot(binding.store.root, 'declared', binding.store.id, 'store');
}

export async function resolveOpenSpecRoot(
  options: ResolveOpenSpecRootOptions = {}
): Promise<ResolvedOpenSpecRoot> {
  if (options.storePath !== undefined) {
    throw new RootSelectionError(
      '--store-path is not supported. Register the path with rasen store register <path>, then select it with --store <id>.',
      'store_path_not_supported',
      {
        target: 'store.id',
        fix: 'rasen store register <path>, then rerun with --store <id>.',
      }
    );
  }

  if (options.store !== undefined && options.project !== undefined) {
    throw new RootSelectionError(
      '--store and --project are mutually exclusive; pass only one.',
      'store_project_mutually_exclusive',
      {
        target: 'store.id',
        fix: 'Pass either --store <id> or --project <id>, not both.',
      }
    );
  }

  if (options.store !== undefined) {
    return resolveStoreRoot(options.store, options.globalDataDir, 'store', 'store');
  }

  if (options.project !== undefined) {
    return resolveStoreRoot(options.project, options.globalDataDir, 'store', 'project');
  }

  const startPath = options.startPath ?? process.cwd();
  const nearestRoot = findQualifyingRootSync(startPath);
  if (nearestRoot) {
    return resolveNearestOrDeclaredRoot(
      nearestRoot,
      options.globalDataDir,
      options.reporter,
      options.allowUnavailableStore === true
    );
  }

  let registry;
  try {
    registry = await readStoreRegistryState(
      options.globalDataDir ? { globalDataDir: options.globalDataDir } : {}
    );
  } catch (error) {
    fromStoreError(error);
  }
  const registeredIds = registry
    ? listStoreRegistryEntries(registry).map((entry) => entry.id)
    : [];

  if (registeredIds.length > 0) {
    throw new RootSelectionError(
      `No Rasen root found in the current directory or its ancestors. Registered stores: ${registeredIds.join(', ')}. Pass --store <id> to use one, or run rasen init to create a local root.`,
      'no_root_with_registered_stores',
      {
        target: 'openspec.root',
        fix: `Rerun with --store <id> (registered: ${registeredIds.join(', ')}) or run rasen init.`,
      }
    );
  }

  if (options.allowImplicitRoot === false) {
    const legacyRoot = findLegacyWorkspaceRootSync(startPath);
    if (legacyRoot) {
      throw new RootSelectionError(
        legacyWorkspaceGuidance(legacyRoot),
        'legacy_workspace_detected',
        {
          target: 'openspec.root',
          fix: 'Run rasen migrate (copy-only) or rasen init.',
        }
      );
    }
    throw new RootSelectionError(
      'No Rasen root found from the current directory.',
      'no_openspec_root',
      { target: 'openspec.root', fix: 'Run rasen init to create a root here.' }
    );
  }

  return makeRoot(canonicalDirectory(startPath), 'implicit');
}

// -----------------------------------------------------------------------------
// Output helpers
// -----------------------------------------------------------------------------

export interface RootOutput {
  path: string;
  source: OpenSpecRootSource;
  store_id?: string;
}

export function toRootOutput(root: ResolvedOpenSpecRoot): RootOutput {
  return {
    path: root.path,
    source: root.source,
    ...(root.storeId ? { store_id: root.storeId } : {}),
  };
}

/**
 * A store-selected root — explicit `--store` or the declared fallback.
 * Cross-root behavior (absolute paths, --store hints, suppressed
 * noun-form suggestions) keys on this, never on `source` directly.
 */
export function isStoreSelectedRoot(
  root: ResolvedOpenSpecRoot
): root is ResolvedOpenSpecRoot & { storeId: string } {
  return root.storeId !== undefined;
}

/**
 * Human-mode verification signal for a selected store. Written to stderr so
 * raw-Markdown and agent-consumed stdout payloads stay clean.
 */
export function emitStoreRootBanner(
  root: ResolvedOpenSpecRoot,
  reporter?: RootSelectionReporter | false
): void {
  if (isStoreSelectedRoot(root)) {
    reportRootSelectionNotice(reporter, {
      kind: 'selected-root',
      path: root.path,
      storeId: root.storeId,
      storeType: root.storeType ?? 'store',
    });
  }
}

/**
 * Keeps follow-up command hints inside the selected store or project: a
 * hint a user can paste verbatim must carry `--project <id>` for a
 * project-typed root and `--store <id>` otherwise.
 */
export function withStoreFlag(root: ResolvedOpenSpecRoot, command: string): string {
  if (!isStoreSelectedRoot(root)) {
    return command;
  }
  const flag = root.storeType === 'project' ? '--project' : '--store';
  return `${command} ${flag} ${root.storeId}`;
}

/**
 * Compatibility bridge for workflow code that still expects a PlanningHome.
 * The planning home is always repo-shaped.
 */
export function toPlanningHome(root: ResolvedOpenSpecRoot): PlanningHome {
  return {
    kind: 'repo',
    root: root.path,
    changesDir: root.changesDir,
    defaultSchema: root.defaultSchema,
  };
}

/**
 * Ambient skill/CLI version-mismatch warning (delivery-reliability-version-
 * guard). Reuses the existing `getAllToolVersionStatus` detection — no new
 * stamping or detection mechanism — and fires at most once per (installed
 * stamp version, running CLI version) pair for a given project, via a
 * machine-local marker (`version-guard-state.ts`). A project with no
 * machine home yet (marker cannot be consulted or written) gets the
 * warning every time rather than being silently skipped.
 *
 * Best-effort throughout: wrapped in try/catch so a lookup or marker
 * failure never propagates out of `resolveRootForCommand` and never fails
 * or visibly slows the invoking command (same contract as
 * `touchProjectRegistry`).
 */
async function checkSkillVersionGuard(
  root: ResolvedOpenSpecRoot,
  options: { globalDataDir?: string } = {}
): Promise<void> {
  try {
    const statuses = getAllToolVersionStatus(root.path, OPENSPEC_VERSION);
    const mismatched = statuses.find((status) => status.needsUpdate);
    if (!mismatched) return;

    const stampVersion = mismatched.generatedByVersion ?? 'unknown';
    const cliVersion = OPENSPEC_VERSION as string;

    const home = await resolveProjectHome(root.path, {
      ensure: false,
      ...(options.globalDataDir !== undefined ? { globalDataDir: options.globalDataDir } : {}),
    });

    if (home) {
      const lastWarned = readLastWarnedVersionPair(home.homeDir);
      if (
        lastWarned &&
        lastWarned.stampVersion === stampVersion &&
        lastWarned.cliVersion === cliVersion
      ) {
        return;
      }
    }

    reportConfigDiagnostic(
      {
        key: 'skillVersionMismatch',
        values: { stampVersion, cliVersion },
        fallback: `Warning: installed skills were generated by rasen v${stampVersion}; the running CLI is v${cliVersion}. Run \`rasen update\`.`,
        output: 'warn',
      },
      createConfigDiagnosticReporter()
    );

    if (home) {
      writeLastWarnedVersionPair(home.homeDir, { stampVersion, cliVersion });
    }
  } catch {
    // Best-effort; see docstring above.
  }
}

/**
 * CLI adapter shared by the supported commands. In JSON mode a resolution
 * failure is reported as a machine-readable payload on stdout (no human prose
 * or blank lines) with a non-zero exit code; the caller must return when this
 * resolves to null. In human mode the error propagates to the command's
 * standard error handling so message text and exit behavior stay consistent.
 */
export async function resolveRootForCommand(
  selector: StoreSelectorOptions,
  output: {
    json?: boolean;
    failurePayload?: Record<string, unknown>;
    /** Diagnostic commands inspect what exists; they never scaffold. */
    allowImplicitRoot?: boolean;
    /** Test/DI override for both root resolution and the self-heal touch
     * below; defaults to getGlobalDataDir() (MINOR-5). Without this, an
     * in-process test exercising this function against a projectId-bearing
     * project would silently register temp paths in the real machine
     * registry unless the process env happens to pin XDG_DATA_HOME. */
    globalDataDir?: string;
    /** Human notices emitted during successful root selection. `false` keeps
     * machine-oriented callers silent; omitted preserves the legacy English
     * console output. */
    reporter?: RootSelectionReporter | false;
    /** Read-only diagnostic opt-out; see `ResolveOpenSpecRootOptions`. */
    allowUnavailableStore?: boolean;
  } = {}
): Promise<ResolvedOpenSpecRoot | null> {
  try {
    const root = await resolveOpenSpecRoot({
      ...(selector.store !== undefined ? { store: selector.store } : {}),
      ...(selector.project !== undefined ? { project: selector.project } : {}),
      ...(selector.storePath !== undefined ? { storePath: selector.storePath } : {}),
      ...(output.allowImplicitRoot !== undefined
        ? { allowImplicitRoot: output.allowImplicitRoot }
        : {}),
      ...(output.globalDataDir !== undefined ? { globalDataDir: output.globalDataDir } : {}),
      ...(output.allowUnavailableStore !== undefined
        ? { allowUnavailableStore: output.allowUnavailableStore }
        : {}),
      reporter: output.reporter,
    });

    // Emitted at resolution time so the banner survives command failures
    // that happen after the root was successfully selected.
    if (!output.json) {
      emitStoreRootBanner(root, output.reporter);
      await checkSkillVersionGuard(
        root,
        output.globalDataDir !== undefined ? { globalDataDir: output.globalDataDir } : {}
      );
    }

    // Registry self-healing (design D6): best-effort, throttled, and every
    // failure is swallowed inside touchProjectRegistry itself - it must
    // never fail or visibly slow this command.
    await touchProjectRegistry(
      root.path,
      output.globalDataDir !== undefined ? { globalDataDir: output.globalDataDir } : {}
    );

    return root;
  } catch (error) {
    if (output.json && isRootSelectionError(error)) {
      console.log(
        JSON.stringify(
          { ...(output.failurePayload ?? {}), status: [error.diagnostic] },
          null,
          2
        )
      );
      process.exitCode = 1;
      return null;
    }

    throw error;
  }
}
