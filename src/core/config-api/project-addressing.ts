/**
 * Project addressing (design.md D4): resolves a `?project=` / body `project`
 * selector (a `projectId` or an absolute root path) against the machine
 * project registry, and derives a `ProjectRef` for the server's launch
 * project (which needs no registry membership — it is addressed by cwd,
 * exactly like the CLI's own `--scope project` commands).
 */
import { readProjectConfig } from '../project-config.js';
import {
  deriveProjectDisplayName,
  findProjectRegistryEntry,
  readProjectRegistryState,
} from '../project-registry.js';
import { cachedResolveRegistrationRoot } from './piercing-cache.js';
import {
  primaryRepair,
  type StoreUnavailableReason,
  type UnavailableStoreBinding,
} from '../store/identity.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import type { ProjectRef } from './wire-types.js';
import {
  PlanningScopeError,
  StorePlanning,
  type ProjectReadScope,
  type StoreAggregateReadScope,
} from '../store-planning/index.js';

export interface ResolvedProject {
  root: string;
  ref: ProjectRef;
}

/**
 * A planning space resolved from a `?space=` / body `space` selector
 * (planning-space-addressing design D1/D2): a project space (machine project
 * registry) or a store space (machine store registry, store namespace). The
 * `root` is always canonical (`FileSystemUtils.canonicalizeExistingPath`), so
 * downstream root-equality comparisons are Windows-safe.
 */
interface ResolvedSpaceBase {
  type: 'project' | 'store';
  id: string;
  name: string;
  /** Planning checkout locator retained for wire compatibility. */
  root: string;
}

export interface ResolvedProjectSpace extends ResolvedSpaceBase {
  type: 'project';
  planningScope: ProjectReadScope;
  projectHome: string;
  schemasDir: string;
  changesDir: string;
  specsDir: string;
  archiveDir?: string;
  /** Real code checkout, independent from Store planning ownership. */
  executionRoot?: string;
}

export interface ResolvedStoreSpace extends ResolvedSpaceBase {
  type: 'store';
  planningScope: StoreAggregateReadScope;
}

export type ResolvedSpace = ResolvedProjectSpace | ResolvedStoreSpace;

export type SpaceSelectorResult =
  | { ok: true; space: ResolvedSpace }
  | { ok: false; status: number; code: string; message: string };

type ParsedSpaceSelector =
  | { ok: true; namespace: 'project' | 'store'; selector: string }
  | { ok: false; status: 400; code: 'invalid_space'; message: string };

const PROJECT_SPACE_PREFIX = 'project:';
const STORE_SPACE_PREFIX = 'store:';

/**
 * Splits a `space` selector into its namespace and bare selector (design D1).
 * The prefix is MANDATORY — a bare value is rejected (`invalid_space`) rather
 * than guessed into a namespace, because a project and a store may legitimately
 * share an id and guessing could silently address the wrong space.
 */
export function parseSpaceSelector(raw: string): ParsedSpaceSelector {
  if (raw.startsWith(PROJECT_SPACE_PREFIX)) {
    return { ok: true, namespace: 'project', selector: raw.slice(PROJECT_SPACE_PREFIX.length) };
  }
  if (raw.startsWith(STORE_SPACE_PREFIX)) {
    return { ok: true, namespace: 'store', selector: raw.slice(STORE_SPACE_PREFIX.length) };
  }
  return {
    ok: false,
    status: 400,
    code: 'invalid_space',
    message: `Space selector "${raw}" must be prefixed with "project:" or "store:".`,
  };
}

/**
 * Maps an `unavailable` store binding onto this surface's existing result
 * vocabulary (design D1): a store that is not registered here is a 404
 * `space_not_found`; a store that is registered but cannot be used is a 409
 * `space_unavailable`. The reason and its repair travel in the message, so an
 * HTTP client sees exactly what the CLI reports.
 */
const SPACE_STATUS_BY_REASON: Record<StoreUnavailableReason, { status: number; code: string }> = {
  'not-registered': { status: 404, code: 'space_not_found' },
  'metadata-missing': { status: 409, code: 'space_unavailable' },
  'uid-mismatch': { status: 409, code: 'space_unavailable' },
  'root-unhealthy': { status: 409, code: 'space_unavailable' },
  'alias-ambiguous': { status: 409, code: 'space_unavailable' },
  'pointer-malformed': { status: 400, code: 'invalid_space' },
};

/**
 * The ONE mapping from an `unavailable` binding to an HTTP result, shared by
 * every config/space surface so a broken inheritance edge never reaches a
 * client as a 500 with the structured reason and repair flattened into a
 * stack trace.
 */
export function unavailableStoreHttpResult(
  binding: UnavailableStoreBinding,
  subject: string
): { status: number; code: string; message: string } {
  const mapped = SPACE_STATUS_BY_REASON[binding.reason];
  const detail = binding.diagnostics[0]?.message ?? `Store "${subject}" is unavailable.`;
  return {
    status: mapped.status,
    code: mapped.code,
    message: `${detail} Next: ${primaryRepair(binding)}`,
  };
}

function planningSpaceFailure(
  error: unknown,
  namespace: 'project' | 'store',
  selector: string
): Extract<SpaceSelectorResult, { ok: false }> {
  if (!(error instanceof PlanningScopeError)) throw error;
  const notFound = error.diagnostic.code === 'unknown_project' ||
    (namespace === 'store' && error.diagnostic.code === 'unknown_store');
  return {
    ok: false,
    status: notFound ? 404 : 409,
    code: notFound ? 'space_not_found' : 'space_unavailable',
    message: notFound
      ? `No registered ${namespace} matches "${selector}" in the ${namespace} namespace.`
      : `${namespace} space "${selector}" is unavailable: ${error.message}`,
  };
}

async function projectPlanningSpace(
  resolved: ResolvedProject
): Promise<ResolvedProjectSpace> {
  const planningScope = await StorePlanning.open({
    intent: 'project-read',
    startPath: resolved.root,
  });
  const scopeProjectId = planningScope.ref.projectId;
  if (
    resolved.ref.projectId.length > 0 &&
    scopeProjectId !== undefined &&
    scopeProjectId !== resolved.ref.projectId
  ) {
    throw new PlanningScopeError(
      'planning_selection_conflict',
      `Project registry identity '${resolved.ref.projectId}' conflicts with planning identity '${planningScope.ref.projectId}'.`,
      { target: resolved.root }
    );
  }
  const description = planningScope.describe();
  let archiveDir: string | undefined;
  try {
    archiveDir = planningScope.locate({ kind: 'archive-line' }).absolutePath;
  } catch (error) {
    if (!(error instanceof PlanningScopeError)) throw error;
  }
  return {
    type: 'project',
    id: resolved.ref.projectId,
    name: resolved.ref.name,
    root: description.paths['planning-checkout'] as string,
    planningScope,
    projectHome: planningScope.locate({ kind: 'project-home' }).absolutePath,
    schemasDir: planningScope.locate({ kind: 'project-schemas' }).absolutePath,
    changesDir: planningScope.locate({ kind: 'active-changes' }).absolutePath,
    specsDir: planningScope.locate({ kind: 'specs' }).absolutePath,
    ...(archiveDir === undefined ? {} : { archiveDir }),
    ...(description.paths['execution-root'] === undefined
      ? { executionRoot: resolved.root }
      : { executionRoot: description.paths['execution-root'] }),
  };
}

/** Resolve an already-identified project root through Store planning truth. */
export async function resolveProjectPlanningSpaceFromRoot(
  root: string
): Promise<SpaceSelectorResult> {
  const ref = await resolveLaunchProjectRef(root);
  if (!ref) {
    return {
      ok: false,
      status: 404,
      code: 'space_not_found',
      message: `No launch project is available at "${root}".`,
    };
  }
  try {
    return { ok: true, space: await projectPlanningSpace({ root, ref }) };
  } catch (error) {
    return planningSpaceFailure(error, 'project', ref.projectId || root);
  }
}

/**
 * Resolves a `space` selector to a `ResolvedSpace` (design D1/D2). The
 * `project:` namespace reuses `resolveProjectSelector` verbatim (the machine
 * project registry — NOT the store registry's `project:` reference
 * namespace). The `store:` namespace resolves the store-namespace registry
 * entry and runs `inspectRegisteredStore` read-only. Never mutates: no
 * registration, identity minting, or directory creation.
 */
export async function resolveSpaceSelector(raw: string): Promise<SpaceSelectorResult> {
  const parsed = parseSpaceSelector(raw);
  if (!parsed.ok) return parsed;

  if (parsed.namespace === 'project') {
    const resolved = await resolveProjectSelector(parsed.selector);
    if (!resolved) {
      return {
        ok: false,
        status: 404,
        code: 'space_not_found',
        message: `No registered project matches "${parsed.selector}" in the project namespace.`,
      };
    }
    try {
      return { ok: true, space: await projectPlanningSpace(resolved) };
    } catch (error) {
      return planningSpaceFailure(error, 'project', parsed.selector);
    }
  }

  // `store:<permanent identity>` addresses a Store exactly, which is the only
  // way an HTTP client can name one of two Stores that share a display name —
  // the same identity form the CLI's `--store` and lifecycle commands accept.
  // The resolved space below already reports the Store's own id, never the
  // selector, so this is purely an additional way in.
  try {
    const planningScope = await StorePlanning.open({
      intent: 'store-read',
      startPath: process.cwd(),
      selection: { store: parsed.selector },
    });
    const description = planningScope.describe();
    return {
      ok: true,
      space: {
        type: 'store',
        id: planningScope.ref.storeId,
        name: planningScope.ref.storeId,
        root: description.paths['planning-checkout'] as string,
        planningScope,
      },
    };
  } catch (error) {
    return planningSpaceFailure(error, 'store', parsed.selector);
  }
}

/**
 * Resolves an explicit `project` selector: exact `projectId` match in the
 * registry first, else a canonical-root-path match on the registry key, else a
 * worktree-path fallback (worktree-aware-spaces D3) — a canonical path that is
 * not itself a registry key but is a linked git worktree of a registered
 * project resolves to that project's identity with the requested worktree path
 * as the answering root. Returns `null` when the selector matches nothing
 * (callers respond `project_not_found`). Non-mutating (git rev-parse only) —
 * the "resolution has no side effects" contract is preserved.
 */
export async function resolveProjectSelector(selector: string): Promise<ResolvedProject | null> {
  const state = await readProjectRegistryState();
  if (!state) return null;

  for (const [rootPath, entry] of Object.entries(state.projects)) {
    if (entry.projectId === selector) {
      return { root: rootPath, ref: { projectId: entry.projectId, name: entry.name, root: rootPath } };
    }
  }

  let canonical: string;
  try {
    canonical = FileSystemUtils.canonicalizeExistingPath(selector);
  } catch {
    return null;
  }
  const entry = state.projects[canonical];
  if (entry) {
    return { root: canonical, ref: { projectId: entry.projectId, name: entry.name, root: canonical } };
  }

  // Worktree-path fallback: the requested path is a linked worktree of a
  // registered project. Answer from the worktree's own root with the owning
  // project's identity, so a worktree's branch-local planning state is
  // addressable without the worktree becoming a separate space.
  // Cached (TTL + .git mtime invalidation): uncached, every board fetch
  // against a worktree-root selector spawned two git rev-parse processes.
  const pierced = await cachedResolveRegistrationRoot(canonical);
  if (pierced !== canonical) {
    const mainEntry = state.projects[pierced];
    if (mainEntry) {
      return { root: canonical, ref: { projectId: mainEntry.projectId, name: mainEntry.name, root: canonical } };
    }
  }
  return null;
}

/**
 * Derives a `ProjectRef` for the server's launch project (resolved from cwd
 * at startup, nullable). Prefers the machine registry entry (canonical
 * `projectId`/`name`) when the project happens to be registered; otherwise
 * falls back to the project's own hand-mintable `projectId` (from
 * `rasen/config.yaml`, read-only — this never mints one) with a
 * display-name derived from the root, so an unregistered project still gets
 * a usable reference instead of `null`.
 */
export async function resolveLaunchProjectRef(root: string | null): Promise<ProjectRef | null> {
  if (!root) return null;
  const canonical = FileSystemUtils.canonicalizeExistingPath(root);

  const registryEntry = await findProjectRegistryEntry(canonical);
  if (registryEntry) {
    return { projectId: registryEntry.entry.projectId, name: registryEntry.entry.name, root: canonical };
  }

  const projectId = readProjectConfig(canonical)?.projectId ?? '';
  return { projectId, name: deriveProjectDisplayName(canonical), root: canonical };
}
