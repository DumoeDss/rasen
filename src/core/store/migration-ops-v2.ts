/**
 * `store adopt` and `store eject` against a layout v2 Store (design D11).
 *
 * Kept beside the frozen flat implementation rather than folded into it: the
 * flat algorithm and the partition algorithm answer different questions about
 * ownership (a name list versus the partition itself), and interleaving them in
 * one body is the dual-implementation shape the accepted design forbids.
 *
 * Every destination here is computed through the Foundation layout contract.
 * This file never joins a flat Store planning path.
 */
import * as nodeFs from 'node:fs';
import * as path from 'node:path';

import { WORKSPACE_DIR_NAME } from '../config.js';
import { StoreError } from './errors.js';
import { readStoreLayoutState } from './layout-write-guard.js';
import {
  readStoreMembership,
  writeStoreProjectCatalog,
} from './membership-layout.js';
import {
  caseInsensitiveCollisions,
  listSubdirectoryNames,
  moveTreeVerified,
} from './migration.js';
import {
  resolveStorePlanningLayoutV2Path,
  type StorePlanningPathFlavor,
} from './planning-layout-v2.js';
import type { StoreProjectCatalogV2 } from './planning-catalogs.js';
import { parseStoreTargetLineCatalogV1 } from './planning-catalogs.js';
import { isProjectId, isTargetLineId } from './planning-validation.js';

const fs = nodeFs.promises;

export interface PartitionAddresses {
  readonly projectHome: string;
  readonly specs: string;
  readonly designDocs: string;
  readonly changes: string;
}

/** Every partition address a project owns, from the Foundation layout contract. */
export function projectPartition(
  storeRoot: string,
  projectId: string,
  flavor: StorePlanningPathFlavor = 'native'
): PartitionAddresses {
  const projectHome = resolveStorePlanningLayoutV2Path(
    storeRoot,
    { kind: 'project-home', projectId },
    flavor
  );
  return {
    projectHome,
    specs: resolveStorePlanningLayoutV2Path(
      storeRoot,
      { kind: 'project-specs', projectId },
      flavor
    ),
    designDocs: resolveStorePlanningLayoutV2Path(
      storeRoot,
      { kind: 'project-design-docs', projectId },
      flavor
    ),
    // The active-Change collection is the parent of one active Change address;
    // the layout contract owns the segment list, this only steps up from it.
    changes: path.dirname(
      resolveStorePlanningLayoutV2Path(
        storeRoot,
        { kind: 'active-change', projectId, changeId: 'placeholder' },
        flavor
      )
    ),
  };
}

/** The partition's archive collection — the parent of every target-line directory. */
export function projectArchiveRoot(
  storeRoot: string,
  projectId: string,
  flavor: StorePlanningPathFlavor = 'native'
): string {
  return path.dirname(archiveLineDir(storeRoot, projectId, 'placeholder-line', flavor));
}

export function archiveLineDir(
  storeRoot: string,
  projectId: string,
  targetLineId: string,
  flavor: StorePlanningPathFlavor = 'native'
): string {
  return resolveStorePlanningLayoutV2Path(
    storeRoot,
    { kind: 'archive-line', projectId, targetLineId },
    flavor
  );
}

/**
 * A v2 Store addresses a project by its permanent identity, and that identity
 * has to be expressible as a portable path segment. An identity that is not is
 * REJECTED, never sanitized into one that is: quietly renaming a project's
 * identity would silently detach it from every record that already names it.
 */
export function assertPortableProjectIdentity(projectId: string, storeId: string): void {
  if (isProjectId(projectId)) return;
  throw new StoreError(
    `Project identity '${projectId}' does not satisfy the layout v2 portable identifier contract, so it cannot address a partition in store '${storeId}'.`,
    'store_v2_unrecordable_project_identity',
    {
      target: 'store.layout',
      fix: 'Give the project a canonical lowercase UUID or kebab identity before adopting it; migration never rewrites an identity to make it fit.',
    }
  );
}

/**
 * A target line is a stable identity a legacy archive entry never recorded, so
 * `--target-line` is required rather than derived. The named catalog must
 * already exist: creating one here would invent the `storeRef`/`codeRef` facts
 * that only child 4 can resolve.
 */
export async function requireTargetLineCatalog(
  storeRoot: string,
  storeId: string,
  targetLineId: string | undefined,
  selectorHint: string
): Promise<string> {
  if (targetLineId === undefined || targetLineId.length === 0) {
    throw new StoreError(
      `Store '${storeId}' declares planning layout version 2, where archives are partitioned by stable target line, so ${selectorHint} requires an explicit --target-line <id>.`,
      'store_v2_target_line_required',
      {
        target: 'selection.targetLine',
        fix: 'Pass --target-line <id> naming an existing target-line catalog; no line is derived from a branch name, a ref, or another entry.',
      }
    );
  }
  if (!isTargetLineId(targetLineId)) {
    throw new StoreError(
      `Target line '${targetLineId}' is not a portable target-line id.`,
      'store_v2_target_line_invalid',
      { target: 'selection.targetLine', fix: 'Use lowercase alphanumeric segments separated by single dots or hyphens.' }
    );
  }
  const catalogPath = resolveStorePlanningLayoutV2Path(storeRoot, {
    kind: 'target-line-catalog',
    targetLineId,
  });
  let content: string;
  try {
    content = await fs.readFile(catalogPath, 'utf-8');
  } catch {
    throw new StoreError(
      `Store '${storeId}' has no target-line catalog for '${targetLineId}'.`,
      'store_v2_target_line_unknown',
      {
        target: 'selection.targetLine',
        fix: `Create ${catalogPath} (the layout migration writes it from the mapping file's targetLines section), then retry.`,
      }
    );
  }
  parseStoreTargetLineCatalogV1(content, catalogPath);
  return catalogPath;
}

export interface PartitionCollisionInput {
  readonly storeRoot: string;
  readonly projectId: string;
  readonly incomingSpecs: readonly string[];
  readonly incomingChanges: readonly string[];
}

/**
 * Collisions are checked INSIDE the target project's partition only. Two
 * projects each owning a Change called `fix-a` is the point of partitioning,
 * not a conflict, so a name present in another project's partition is not a
 * collision.
 */
export async function partitionCollisions(
  input: PartitionCollisionInput
): Promise<{ specs: string[]; changes: string[] }> {
  const partition = projectPartition(input.storeRoot, input.projectId);
  const [existingSpecs, existingChanges] = await Promise.all([
    listSubdirectoryNames(partition.specs),
    listSubdirectoryNames(partition.changes),
  ]);
  return {
    specs: caseInsensitiveCollisions([...input.incomingSpecs], existingSpecs),
    changes: caseInsensitiveCollisions([...input.incomingChanges], existingChanges),
  };
}

/** The bound catalog written before any source deletion — adopt's resume marker. */
export async function bindProjectCatalog(input: {
  readonly storeRoot: string;
  readonly storeId: string;
  readonly projectId: string;
  readonly displayId?: string;
  readonly remote?: string;
  readonly boundAt: string;
}): Promise<StoreProjectCatalogV2> {
  const existing = await readStoreMembership(input.storeRoot, input.projectId, input.storeId);
  const previous = existing.entry?.layout === 2 ? existing.entry.catalog : undefined;
  const catalog = {
    version: 2 as const,
    projectId: input.projectId,
    ...(previous?.id !== undefined
      ? { id: previous.id }
      : input.displayId !== undefined
        ? { id: input.displayId }
        : {}),
    ...(previous?.remote !== undefined
      ? { remote: previous.remote }
      : input.remote !== undefined
        ? { remote: input.remote }
        : {}),
    ...(previous?.knowledgeBundle !== undefined
      ? { knowledgeBundle: previous.knowledgeBundle }
      : {}),
    roles: {
      planning: true,
      knowledge: previous?.roles.knowledge ?? false,
    },
    planningBinding:
      previous?.planningBinding.state === 'bound'
        ? previous.planningBinding
        : { state: 'bound' as const, boundAt: input.boundAt },
  } as StoreProjectCatalogV2;
  await writeStoreProjectCatalog(input.storeRoot, catalog);
  return catalog;
}

/** Ejecting removes where a project PLANS, not the roster it belongs to. */
export async function unbindProjectCatalog(
  storeRoot: string,
  storeId: string,
  projectId: string
): Promise<void> {
  const existing = await readStoreMembership(storeRoot, projectId, storeId);
  if (existing.entry?.layout !== 2) return;
  const previous = existing.entry.catalog;
  await writeStoreProjectCatalog(storeRoot, {
    ...previous,
    // Roles are preserved verbatim: eject removes where the project PLANS, not
    // the roster it belongs to (spec store-eject).
    roles: { ...previous.roles },
    planningBinding: { state: 'unbound' },
  } as StoreProjectCatalogV2);
}

export interface PartitionContents {
  readonly specs: readonly string[];
  readonly designDocs: readonly string[];
  readonly changes: readonly string[];
  /** `<targetLineId>/<entryName>` pairs under the partition's archive. */
  readonly archiveEntries: readonly { readonly targetLineId: string; readonly name: string }[];
}

/** The partition IS the ownership record: what it holds is what the project owns. */
export async function readPartitionContents(
  storeRoot: string,
  projectId: string
): Promise<PartitionContents> {
  const partition = projectPartition(storeRoot, projectId);
  const specs = await listSubdirectoryNames(partition.specs);
  const changesEntries = await listSubdirectoryNames(partition.changes);
  const archiveCollectionName = path.basename(projectArchiveRoot(storeRoot, projectId));
  const changes = changesEntries.filter((name) => name !== archiveCollectionName);
  const designDocs = await listFileNames(partition.designDocs);

  const archiveRoot = projectArchiveRoot(storeRoot, projectId);
  const archiveEntries: { targetLineId: string; name: string }[] = [];
  for (const targetLineId of await listSubdirectoryNames(archiveRoot)) {
    for (const name of await listSubdirectoryNames(path.join(archiveRoot, targetLineId))) {
      archiveEntries.push({ targetLineId, name });
    }
  }
  return { specs, designDocs, changes, archiveEntries };
}

async function listFileNames(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

/**
 * The in-repo layout has no target-line dimension, so two entries from two
 * lines that share a directory name cannot both be restored. Overwriting one or
 * nesting a line directory would corrupt the archive, so this fails closed and
 * names both source paths.
 */
export function crossLineArchiveCollisions(
  entries: PartitionContents['archiveEntries']
): { name: string; sources: string[] }[] {
  const byName = new Map<string, string[]>();
  for (const entry of entries) {
    const key = entry.name.toLowerCase();
    const list = byName.get(key) ?? [];
    list.push(`${entry.targetLineId}/${entry.name}`);
    byName.set(key, list);
  }
  return [...byName.entries()]
    .filter(([, sources]) => sources.length > 1)
    .map(([name, sources]) => ({ name, sources: sources.sort() }));
}

export interface RestorePartitionInput {
  readonly storeRoot: string;
  readonly projectId: string;
  readonly destinationPath: string;
  readonly contents: PartitionContents;
  readonly verifyHash?: boolean;
}

/** Copy → verify → delete, exactly as the flat path does; zero Git writes. */
export async function restorePartition(input: RestorePartitionInput): Promise<void> {
  const partition = projectPartition(input.storeRoot, input.projectId);
  const repoPlanning = path.join(input.destinationPath, WORKSPACE_DIR_NAME);
  const repoSpecs = path.join(repoPlanning, 'specs');
  const repoChanges = path.join(repoPlanning, 'changes');
  const repoArchive = path.join(repoChanges, 'archive');
  const repoDesignDocs = path.join(repoPlanning, 'design-docs');

  for (const name of input.contents.specs) {
    await moveTreeVerified(path.join(partition.specs, name), path.join(repoSpecs, name), {
      verifyHash: input.verifyHash,
    });
  }
  for (const name of input.contents.changes) {
    await moveTreeVerified(path.join(partition.changes, name), path.join(repoChanges, name), {
      verifyHash: input.verifyHash,
    });
  }
  for (const name of input.contents.designDocs) {
    await fs.mkdir(repoDesignDocs, { recursive: true });
    await fs.copyFile(
      path.join(partition.designDocs, name),
      path.join(repoDesignDocs, name)
    );
    await fs.rm(path.join(partition.designDocs, name), { force: true });
  }
  for (const entry of input.contents.archiveEntries) {
    await moveTreeVerified(
      path.join(archiveLineDir(input.storeRoot, input.projectId, entry.targetLineId), entry.name),
      path.join(repoArchive, entry.name),
      { verifyHash: input.verifyHash }
    );
  }
  await fs.rm(partition.projectHome, { recursive: true, force: true });
}

export interface AssertBoundProjectInput {
  readonly storeRoot: string;
  readonly storeId: string;
  readonly projectId: string;
}

/** Relocation and archive moves need a project whose planning truth lives here. */
export async function assertBoundPlanningMember(
  input: AssertBoundProjectInput
): Promise<StoreProjectCatalogV2> {
  const read = await readStoreMembership(input.storeRoot, input.projectId, input.storeId);
  if (read.entry?.layout !== 2 || read.entry.catalog.planningBinding.state !== 'bound') {
    throw new StoreError(
      `Project '${input.projectId}' is not a bound planning member of store '${input.storeId}'.`,
      'store_v2_project_not_bound',
      {
        target: 'store.membership',
        fix: `Adopt the project into the store first: rasen store adopt <path> --to ${input.storeId}.`,
      }
    );
  }
  return read.entry.catalog;
}

/** True when the Store declares layout v2 (and is not half-migrated). */
export async function storeDeclaresLayoutV2(storeRoot: string): Promise<boolean> {
  return (await readStoreLayoutState(storeRoot)).declared === 2;
}
