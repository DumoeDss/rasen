/**
 * Shared scope resolution for the target-line and workspace Modules.
 *
 * Both need the same three answers before they can do anything: WHICH Store
 * (and which of its checkouts this command is standing in), WHICH project
 * partition, and WHICH target-line catalog. Neither joins Store-internal paths
 * itself — every destination comes from the Foundation layout contract.
 */
import * as path from 'node:path';

import {
  parseStoreMetadataState,
  validateStoreSelector,
  type StoreMetadataState,
} from '../foundation.js';
import { resolveRegisteredStore } from '../registry.js';
import {
  parseStoreProjectCatalogV2,
  parseStoreTargetLineCatalogV1,
  parseProjectId,
  parseTargetLineId,
  resolveStorePlanningLayoutV2Path,
  type StoreProjectCatalogV2,
  type StoreTargetLineCatalogV1,
} from '../planning-foundation.js';
import type { StorePlanningPathFlavor } from '../planning-layout-v2.js';
import type { StoreWorkspaceDependencies } from './dependencies.js';
import { workspaceError } from './diagnostics.js';
import { isContainedIn, pathApiFor, samePath } from './identity.js';

export interface ResolvedWorkspaceStore {
  readonly storeId: string;
  readonly storeUid: string;
  /** The registered Store checkout. */
  readonly registeredRoot: string;
  /**
   * The Store checkout this command is standing in, which is the one a
   * Git-tracked write lands in. Falls back to the registered root.
   */
  readonly checkoutRoot: string;
  readonly metadata: StoreMetadataState;
}

/**
 * Resolves the Store, requires layout v2 and a permanent identity, and picks
 * the checkout the command is standing in. A legacy flat Store has no project
 * partitions and no target-line catalogs, so it is refused here rather than
 * producing an empty answer downstream.
 */
export async function resolveWorkspaceStore(
  dependencies: StoreWorkspaceDependencies,
  input: {
    readonly store?: string;
    readonly startPath: string;
    readonly globalDataDir?: string;
    readonly pathFlavor?: StorePlanningPathFlavor;
  }
): Promise<ResolvedWorkspaceStore> {
  if (input.store === undefined) {
    throw workspaceError(
      'workspace_store_unresolved',
      'No Store was selected. A workspace and a target line both belong to exactly one Store.',
      { target: 'selection.store', fix: 'Add --store <store-id>.' }
    );
  }
  const selector = validateStoreSelector(input.store);
  const resolved = await resolveRegisteredStore({
    id: selector,
    ...(input.globalDataDir === undefined ? {} : { globalDataDir: input.globalDataDir }),
  });

  const flavor = input.pathFlavor ?? 'native';
  const metadataPath = resolveStorePlanningLayoutV2Path(
    pathApiFor(flavor).resolve(resolved.storeRoot),
    { kind: 'store-metadata' },
    flavor
  );
  const metadataText = await dependencies.fs.readText(metadataPath);
  if (metadataText === null) {
    throw workspaceError(
      'workspace_store_unresolved',
      `Store '${resolved.id}' has no metadata at ${metadataPath}.`,
      { target: metadataPath, fix: 'Repair the Store checkout, then retry.' }
    );
  }
  const metadata = parseStoreMetadataState(metadataText);
  if (metadata.layoutVersion !== 2) {
    throw workspaceError(
      'workspace_layout_version_unsupported',
      `Store '${resolved.id}' still declares the legacy flat planning layout; target lines and workspace pairs exist only in layout v2.`,
      {
        target: metadataPath,
        fix: `Run 'rasen store migrate-layout ${resolved.id}' first.`,
      }
    );
  }
  if (metadata.version !== 2) {
    throw workspaceError(
      'workspace_store_unresolved',
      `Store '${resolved.id}' has no permanent Store identity, which layout v2 requires.`,
      { target: metadataPath, fix: `Run 'rasen update' to mint Store identity metadata.` }
    );
  }

  const checkoutRoot = await resolveStoreCheckout(
    dependencies,
    resolved.storeRoot,
    input.startPath,
    flavor
  );

  return {
    storeId: resolved.id,
    storeUid: metadata.uid,
    registeredRoot: resolved.storeRoot,
    checkoutRoot,
    metadata,
  };
}

/**
 * The Store worktree a command is standing in, when it is one of this Store
 * repository's worktrees; the registered root otherwise. A Git-tracked write
 * lands in the checkout the operator can see, never in some other worktree.
 */
export async function resolveStoreCheckout(
  dependencies: StoreWorkspaceDependencies,
  registeredRoot: string,
  startPath: string,
  flavor: StorePlanningPathFlavor
): Promise<string> {
  const worktrees = await dependencies.git.worktreeList(registeredRoot);
  if (worktrees === null) return registeredRoot;
  for (const entry of worktrees) {
    if (isContainedIn(entry.root, startPath, flavor)) return entry.root;
  }
  return registeredRoot;
}

export interface TargetLineCatalogRead {
  readonly catalog: StoreTargetLineCatalogV1;
  readonly text: string;
  readonly path: string;
}

export function targetLineCatalogPath(
  storeCheckoutRoot: string,
  targetLineId: string,
  flavor: StorePlanningPathFlavor = 'native'
): string {
  return resolveStorePlanningLayoutV2Path(
    pathApiFor(flavor).resolve(storeCheckoutRoot),
    { kind: 'target-line-catalog', targetLineId: parseTargetLineId(targetLineId) },
    flavor
  );
}

export async function readTargetLineCatalog(
  dependencies: StoreWorkspaceDependencies,
  storeCheckoutRoot: string,
  targetLineId: string,
  flavor: StorePlanningPathFlavor = 'native'
): Promise<TargetLineCatalogRead | null> {
  const filePath = targetLineCatalogPath(storeCheckoutRoot, targetLineId, flavor);
  const text = await dependencies.fs.readText(filePath);
  if (text === null) return null;
  return { catalog: parseStoreTargetLineCatalogV1(text, filePath), text, path: filePath };
}

export async function requireTargetLineCatalog(
  dependencies: StoreWorkspaceDependencies,
  storeCheckoutRoot: string,
  storeId: string,
  targetLineId: string,
  flavor: StorePlanningPathFlavor = 'native'
): Promise<TargetLineCatalogRead> {
  const read = await readTargetLineCatalog(
    dependencies,
    storeCheckoutRoot,
    targetLineId,
    flavor
  );
  if (read === null) {
    throw workspaceError(
      'target_line_unknown',
      `Target line '${targetLineId}' has no catalog in Store '${storeId}'. A branch name is never a target line.`,
      {
        target: targetLineCatalogPath(storeCheckoutRoot, targetLineId, flavor),
        fix: `Author it with 'rasen store target-line add ${targetLineId} --store ${storeId} --store-ref refs/heads/<branch>'.`,
      }
    );
  }
  return read;
}

/** Every target-line catalog in the Store, including unresolvable ones. */
export async function listTargetLineCatalogs(
  dependencies: StoreWorkspaceDependencies,
  storeCheckoutRoot: string,
  flavor: StorePlanningPathFlavor = 'native'
): Promise<readonly TargetLineCatalogRead[]> {
  const api = pathApiFor(flavor);
  // The Foundation layout contract addresses catalog FILES, not their
  // directory, so the collection is the parent of one contract-computed path
  // rather than a hand-joined `.rasen-store/target-lines`.
  const dir = api.dirname(targetLineCatalogPath(storeCheckoutRoot, 'probe', flavor));
  const reads: TargetLineCatalogRead[] = [];
  for (const name of await dependencies.fs.listNames(dir)) {
    if (!name.endsWith('.yaml')) continue;
    const filePath = api.join(dir, name);
    const text = await dependencies.fs.readText(filePath);
    if (text === null) continue;
    reads.push({ catalog: parseStoreTargetLineCatalogV1(text, filePath), text, path: filePath });
  }
  return reads.sort((left, right) => left.catalog.id.localeCompare(right.catalog.id));
}

export async function readProjectCatalog(
  dependencies: StoreWorkspaceDependencies,
  storeCheckoutRoot: string,
  projectId: string,
  flavor: StorePlanningPathFlavor = 'native'
): Promise<StoreProjectCatalogV2 | null> {
  const filePath = resolveStorePlanningLayoutV2Path(
    pathApiFor(flavor).resolve(storeCheckoutRoot),
    { kind: 'project-catalog', projectId: parseProjectId(projectId) },
    flavor
  );
  const text = await dependencies.fs.readText(filePath);
  return text === null ? null : parseStoreProjectCatalogV2(text, filePath);
}

/**
 * The code repository checkout for a project, from the machine project
 * registry. An unregistered project has no execution repository this machine
 * can name, and guessing one from an adjacent directory is exactly what the
 * binding rules forbid.
 */
export async function resolveProjectRepositoryRoot(
  dependencies: StoreWorkspaceDependencies,
  projectId: string,
  globalDataDir?: string
): Promise<string> {
  const projects = await dependencies.snapshotProjects(globalDataDir);
  const matches = projects.filter((entry) => entry.entry.projectId === projectId);
  if (matches.length === 0) {
    throw workspaceError(
      'workspace_project_unresolved',
      `Project '${projectId}' has no registered checkout on this machine, so its execution repository cannot be named.`,
      {
        target: 'selection.project',
        fix: 'Register the project checkout (rasen init / rasen store add-project), or pass --execution-worktree <path>.',
      }
    );
  }
  const distinct = [...new Set(matches.map((entry) => entry.root))];
  if (distinct.length > 1) {
    throw workspaceError(
      'workspace_project_unresolved',
      `Project '${projectId}' matches more than one registered checkout: ${distinct.join(', ')}.`,
      {
        target: 'selection.project',
        fix: 'Pass --execution-worktree <path> to name the checkout explicitly.',
      }
    );
  }
  return distinct[0] as string;
}

/** The main checkout of the repository containing `root`, or null. */
export async function repositoryMainCheckout(
  dependencies: StoreWorkspaceDependencies,
  root: string
): Promise<string | null> {
  const worktrees = await dependencies.git.worktreeList(root);
  if (worktrees === null || worktrees.length === 0) return null;
  return worktrees[0]?.root ?? null;
}

/** Store-relative POSIX form, for commit suggestions and messages. */
export function storeRelativePosix(storeRoot: string, target: string): string {
  return path.relative(storeRoot, target).split(path.sep).join('/');
}

export function sameCheckout(
  left: string,
  right: string,
  flavor: StorePlanningPathFlavor = 'native'
): boolean {
  return samePath(left, right, flavor);
}
