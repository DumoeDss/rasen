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
import { FileSystemUtils } from '../../utils/file-system.js';
import type { ProjectRef } from './wire-types.js';

export interface ResolvedProject {
  root: string;
  ref: ProjectRef;
}

/**
 * Resolves an explicit `project` selector: exact `projectId` match in the
 * registry first, else a canonical-root-path match on the registry key.
 * Returns `null` when the selector matches nothing (callers respond
 * `project_not_found`).
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
  if (!entry) return null;
  return { root: canonical, ref: { projectId: entry.projectId, name: entry.name, root: canonical } };
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
