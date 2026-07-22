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
  resolveRegistrationRoot,
} from '../project-registry.js';
import { listRegisteredStores } from '../store/registry.js';
import { inspectRegisteredStore, type RegisteredStoreInspection } from '../root-selection.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import type { ProjectRef } from './wire-types.js';

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
export interface ResolvedSpace {
  type: 'project' | 'store';
  id: string;
  name: string;
  root: string;
}

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

/** Human-readable reason for a store that is registered but fails read-only health inspection (design D1: 409 `space_unavailable`). */
function storeInspectionReason(inspection: Exclude<RegisteredStoreInspection, { kind: 'ok' }>): string {
  switch (inspection.kind) {
    case 'metadata_error':
      return `store identity metadata could not be read: ${
        inspection.error instanceof Error ? inspection.error.message : String(inspection.error)
      }`;
    case 'metadata_missing':
      return `store identity metadata is missing at ${inspection.metadataPath}`;
    case 'metadata_id_mismatch':
      return `store metadata id "${inspection.actualId}" does not match its registered id`;
    case 'unhealthy_root':
      return `store planning root is unhealthy: ${inspection.problems}`;
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
    return {
      ok: true,
      space: { type: 'project', id: resolved.ref.projectId, name: resolved.ref.name, root: resolved.root },
    };
  }

  const stores = await listRegisteredStores();
  const entry = stores.find((candidate) => candidate.type === 'store' && candidate.id === parsed.selector);
  if (!entry) {
    return {
      ok: false,
      status: 404,
      code: 'space_not_found',
      message: `No registered store matches "${parsed.selector}" in the store namespace.`,
    };
  }

  const inspection = await inspectRegisteredStore(entry.id, entry.storeRoot);
  if (inspection.kind !== 'ok') {
    return {
      ok: false,
      status: 409,
      code: 'space_unavailable',
      message: `Store "${entry.id}" is unavailable: ${storeInspectionReason(inspection)}.`,
    };
  }

  return {
    ok: true,
    space: { type: 'store', id: entry.id, name: entry.id, root: inspection.canonicalRoot },
  };
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
  const pierced = await resolveRegistrationRoot(canonical);
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
