/**
 * `StoreTargetLines` — stable release-line identity with mutable Git locators.
 *
 * A target line is the partition key Archive uses and a derivation input for
 * `PlanningScopeId`, while the Store ref and the per-project code refs behind
 * it are LOCATORS an operator may re-point without inventing a new line.
 *
 * Three rules shape everything here:
 *
 *   - Lines are authored explicitly. Nothing creates, guesses, or completes a
 *     line from a branch name, a version string, a directory name, or "the only
 *     line that looks similar". A branch called `change/line-0.2/app/redesign`
 *     is a human convenience and is never parsed.
 *   - The identity is stable and the locators move. `setRef` edits a record; it
 *     never renames an id, never creates one, and never removes a locator an
 *     active Change still depends on.
 *   - Resolution happens at use time and never falls back. A locator that names
 *     no ref, names an ambiguous ref, or resolves to something other than a
 *     commit fails with `target_line_ref_unresolved` naming the field and the
 *     repository — never `HEAD`, never the current branch, never a similarly
 *     named ref.
 *
 * This Module is separate from the workspace Module because a target line
 * exists before any Change and outlives every workspace on it: the finalization
 * and management owners consume lines without knowing that worktree pairs
 * exist.
 */
import { parse as parseYaml } from 'yaml';

import { ChangeMetadataSchema } from '../change-metadata/index.js';
import {
  parseFullGitRef,
  parseProjectId,
  parseTargetLineId,
  resolveStorePlanningLayoutV2Path,
  serializeStoreTargetLineCatalogV1,
  type StoreTargetLineCatalogV1,
} from './planning-foundation.js';
import type { StorePlanningPathFlavor } from './planning-layout-v2.js';
import {
  productionStoreWorkspaceDependencies,
  type StoreWorkspaceDependencies,
} from './workspace/dependencies.js';
import { workspaceError, workspaceRefusal } from './workspace/diagnostics.js';
import { pathApiFor } from './workspace/identity.js';
import { scopeLockKey, withWorkspaceLocks } from './workspace/locks.js';
import {
  listTargetLineCatalogs,
  readProjectCatalog,
  readTargetLineCatalog,
  requireTargetLineCatalog,
  resolveProjectRepositoryRoot,
  resolveWorkspaceStore,
  storeRelativePosix,
  targetLineCatalogPath,
  type ResolvedWorkspaceStore,
} from './workspace/scope.js';
import type { ResolvedTargetLine, SuggestedWorkspaceCommit } from './workspace/types.js';

// -----------------------------------------------------------------------------
// Inputs and results
// -----------------------------------------------------------------------------

export interface TargetLineQuery {
  readonly store?: string;
  readonly startPath: string;
  readonly globalDataDir?: string;
  readonly pathFlavor?: StorePlanningPathFlavor;
}

export interface TargetLineSelector extends TargetLineQuery {
  readonly targetLineId: string;
  /** Selecting a project asks for its code locator too. */
  readonly project?: string;
}

export interface AddTargetLineInput extends TargetLineQuery {
  readonly targetLineId: string;
  readonly storeRef: string;
  readonly project?: string;
  readonly codeRef?: string;
}

export interface SetTargetLineRefInput extends TargetLineQuery {
  readonly targetLineId: string;
  readonly storeRef?: string;
  readonly project?: string;
  readonly codeRef?: string;
  /** Removes the selected project's code locator. */
  readonly removeCodeRef?: boolean;
}

export interface TargetLineRecord {
  readonly targetLineId: string;
  readonly storeId: string;
  readonly storeUid: string;
  readonly storeRef: string;
  readonly projects: Readonly<Record<string, { readonly codeRef: string }>>;
  /** Absolute path of the catalog, a local locator. */
  readonly path: string;
  readonly suggestedCommits?: readonly SuggestedWorkspaceCommit[];
}

export interface StoreTargetLines {
  list(input: TargetLineQuery): Promise<readonly TargetLineRecord[]>;
  show(input: TargetLineSelector): Promise<TargetLineRecord>;
  add(input: AddTargetLineInput): Promise<TargetLineRecord>;
  setRef(input: SetTargetLineRefInput): Promise<TargetLineRecord>;
  resolve(input: TargetLineSelector): Promise<ResolvedTargetLine>;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function recordFrom(
  store: ResolvedWorkspaceStore,
  catalog: StoreTargetLineCatalogV1,
  catalogPath: string,
  suggestedCommits?: readonly SuggestedWorkspaceCommit[]
): TargetLineRecord {
  return {
    targetLineId: catalog.id,
    storeId: store.storeId,
    storeUid: store.storeUid,
    storeRef: catalog.storeRef,
    projects: Object.freeze(
      Object.fromEntries(
        Object.entries(catalog.projects)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([projectId, locator]) => [projectId, { codeRef: locator.codeRef }])
      )
    ),
    path: catalogPath,
    ...(suggestedCommits === undefined ? {} : { suggestedCommits }),
  };
}

function catalogCommitSuggestion(
  storeCheckoutRoot: string,
  catalogPath: string,
  targetLineId: string
): SuggestedWorkspaceCommit {
  const pathspec = storeRelativePosix(storeCheckoutRoot, catalogPath);
  return {
    repoRoot: storeCheckoutRoot,
    pathspecs: [pathspec],
    message: `chore(store): record target line ${targetLineId}`,
    rationale:
      'The target-line catalog is Git-tracked Store content. Rasen wrote the file and staged nothing.',
    command: `git -C ${storeCheckoutRoot} add -- ${pathspec} && git -C ${storeCheckoutRoot} commit -m "chore(store): record target line ${targetLineId}"`,
  };
}

/**
 * All target-line catalog writes serialize on ONE scope lock per (Store, line),
 * because a Store-ref edit and a per-project code-ref edit write the same file.
 * `*` is not a legal `projectId`, so this key can never collide with a real
 * project's scope lock — and two DIFFERENT lines still take different locks,
 * which is what lets two lines proceed concurrently.
 */
function targetLineWriteLockKey(storeUid: string, targetLineId: string) {
  return scopeLockKey({ storeUid, projectId: '*', targetLineId });
}

/**
 * Resolving one locator. Returns every matching ref so the caller can refuse an
 * ambiguous one rather than picking a winner.
 */
async function resolveLocator(
  dependencies: StoreWorkspaceDependencies,
  input: {
    readonly repoRoot: string;
    readonly ref: string;
    readonly field: string;
    readonly repositoryLabel: string;
  }
): Promise<string> {
  const targets = await dependencies.git.resolveRef(input.repoRoot, input.ref);
  if (targets.length === 0) {
    throw workspaceError(
      'target_line_ref_unresolved',
      `Target-line locator ${input.field} '${input.ref}' names no ref in the ${input.repositoryLabel} repository (${input.repoRoot}).`,
      {
        target: input.field,
        fix: `Create '${input.ref}' in ${input.repoRoot}, or re-point the locator with 'rasen store target-line set-ref'. Resolution never falls back to HEAD or to a similar ref.`,
      }
    );
  }
  if (targets.length > 1) {
    throw workspaceError(
      'target_line_ref_unresolved',
      `Target-line locator ${input.field} '${input.ref}' is ambiguous in the ${input.repositoryLabel} repository (${input.repoRoot}): ${targets
        .map((target) => `${target.ref}=${target.oid}`)
        .join(', ')}.`,
      {
        target: input.field,
        fix: 'Remove the duplicate ref so exactly one object is named.',
      }
    );
  }
  const target = targets[0] as { oid: string; objectType: string };
  if (target.objectType !== 'commit') {
    throw workspaceError(
      'target_line_ref_unresolved',
      `Target-line locator ${input.field} '${input.ref}' resolves to a ${target.objectType}, not a commit, in the ${input.repositoryLabel} repository (${input.repoRoot}).`,
      { target: input.field, fix: 'Point the locator at a branch or a tag of a commit.' }
    );
  }
  return target.oid;
}

/**
 * Active Changes in this project partition that are frozen against `lineId`.
 * Used to refuse removing a locator a live Change still depends on.
 */
async function activeChangesOnLine(
  dependencies: StoreWorkspaceDependencies,
  storeCheckoutRoot: string,
  projectId: string,
  targetLineId: string,
  flavor: StorePlanningPathFlavor
): Promise<readonly string[]> {
  const api = pathApiFor(flavor);
  // The Foundation layout contract addresses one Change, not the collection, so
  // the collection is the parent of a contract-computed path rather than a
  // hand-joined `rasen/projects/<id>/changes` (planning path source guard).
  const changesDir = api.dirname(
    resolveStorePlanningLayoutV2Path(
      api.resolve(storeCheckoutRoot),
      {
        kind: 'active-change',
        projectId: parseProjectId(projectId),
        changeId: 'probe',
      },
      flavor
    )
  );
  const bound: string[] = [];
  for (const name of await dependencies.fs.listNames(changesDir)) {
    if (name === 'archive') continue;
    const metadataPath = api.join(changesDir, name, '.openspec.yaml');
    const text = await dependencies.fs.readText(metadataPath);
    if (text === null) continue;
    let raw: unknown;
    try {
      raw = parseYaml(text);
    } catch {
      continue;
    }
    const parsed = ChangeMetadataSchema.safeParse(raw);
    if (!parsed.success) continue;
    if (parsed.data.identity?.targetLineId === targetLineId) bound.push(name);
  }
  return bound.sort((left, right) => left.localeCompare(right));
}

/**
 * The gate that stops a Change from being re-pointed at another line. A
 * Change's target line is the one frozen in its v2 identity at creation; a
 * weaker source that supplies a different line never overrides it.
 */
export function assertTargetLineMatchesChange(input: {
  readonly changeId: string;
  readonly frozenTargetLineId: string;
  readonly resolvedTargetLineId: string;
  readonly source?: string;
}): void {
  if (input.frozenTargetLineId === input.resolvedTargetLineId) return;
  throw workspaceRefusal(
    'target_line_mismatch',
    `Change '${input.changeId}' is frozen against target line '${input.frozenTargetLineId}', but ${
      input.source ?? 'this command'
    } resolved '${input.resolvedTargetLineId}'.`,
    {
      expected: input.frozenTargetLineId,
      actual: input.resolvedTargetLineId,
      target: 'selection.targetLine',
      fix: `Address the Change on its own line (--target-line ${input.frozenTargetLineId}). A Change is never re-pointed at another line.`,
    }
  );
}

// -----------------------------------------------------------------------------
// Module
// -----------------------------------------------------------------------------

export class StoreTargetLinesModule implements StoreTargetLines {
  constructor(
    private readonly dependencies: StoreWorkspaceDependencies = productionStoreWorkspaceDependencies
  ) {}

  async list(input: TargetLineQuery): Promise<readonly TargetLineRecord[]> {
    const store = await this.store(input);
    const catalogs = await listTargetLineCatalogs(
      this.dependencies,
      store.checkoutRoot,
      input.pathFlavor ?? 'native'
    );
    return catalogs.map((read) => recordFrom(store, read.catalog, read.path));
  }

  async show(input: TargetLineSelector): Promise<TargetLineRecord> {
    const store = await this.store(input);
    const read = await requireTargetLineCatalog(
      this.dependencies,
      store.checkoutRoot,
      store.storeId,
      input.targetLineId,
      input.pathFlavor ?? 'native'
    );
    return recordFrom(store, read.catalog, read.path);
  }

  async add(input: AddTargetLineInput): Promise<TargetLineRecord> {
    const flavor = input.pathFlavor ?? 'native';
    const store = await this.store(input);
    const targetLineId = parseTargetLineId(input.targetLineId, 'targetLineId');
    const storeRef = parseFullGitRef(input.storeRef, 'storeRef');
    const projects: Record<string, { codeRef: string }> = {};
    if (input.project !== undefined) {
      if (input.codeRef === undefined) {
        throw workspaceError(
          'target_line_unknown',
          `--project was supplied without --code-ref, so no code locator can be recorded for '${input.project}'.`,
          { target: 'selection.project', fix: 'Add --code-ref refs/heads/<branch>.' }
        );
      }
      const projectId = await this.requireProject(store, input.project, flavor);
      projects[projectId] = { codeRef: parseFullGitRef(input.codeRef, 'codeRef') };
    }

    const catalogPath = targetLineCatalogPath(store.checkoutRoot, targetLineId, flavor);
    return withWorkspaceLocks(
      this.dependencies.coordination(input.globalDataDir),
      [targetLineWriteLockKey(store.storeUid, targetLineId)],
      async () => {
        const existing = await readTargetLineCatalog(
          this.dependencies,
          store.checkoutRoot,
          targetLineId,
          flavor
        );
        if (existing !== null) {
          throw workspaceError(
            'target_line_exists',
            `Target line '${targetLineId}' already has a catalog at ${existing.path}.`,
            {
              target: existing.path,
              fix: `Re-point its locators with 'rasen store target-line set-ref ${targetLineId}'; authoring never overwrites an existing line.`,
            }
          );
        }
        const catalog: StoreTargetLineCatalogV1 = {
          version: 1,
          id: targetLineId,
          storeRef,
          projects,
        } as StoreTargetLineCatalogV1;
        await this.dependencies.fs.writeText(
          catalogPath,
          serializeStoreTargetLineCatalogV1(catalog)
        );
        return recordFrom(store, catalog, catalogPath, [
          catalogCommitSuggestion(store.checkoutRoot, catalogPath, targetLineId),
        ]);
      }
    );
  }

  async setRef(input: SetTargetLineRefInput): Promise<TargetLineRecord> {
    const flavor = input.pathFlavor ?? 'native';
    const store = await this.store(input);
    const targetLineId = parseTargetLineId(input.targetLineId, 'targetLineId');
    if (
      input.storeRef === undefined &&
      input.codeRef === undefined &&
      input.removeCodeRef !== true
    ) {
      throw workspaceError(
        'target_line_unknown',
        'set-ref was asked to change nothing: supply --store-ref, or --project with --code-ref.',
        { target: 'selection.targetLine', fix: 'Name the locator to move.' }
      );
    }
    const projectId =
      input.project === undefined
        ? undefined
        : await this.requireProject(store, input.project, flavor);
    if ((input.codeRef !== undefined || input.removeCodeRef === true) && projectId === undefined) {
      throw workspaceError(
        'target_line_unknown',
        'A code locator belongs to one project; --code-ref requires --project.',
        { target: 'selection.project', fix: 'Add --project <project-id>.' }
      );
    }

    return withWorkspaceLocks(
      this.dependencies.coordination(input.globalDataDir),
      [targetLineWriteLockKey(store.storeUid, targetLineId)],
      async () => {
        const read = await requireTargetLineCatalog(
          this.dependencies,
          store.checkoutRoot,
          store.storeId,
          targetLineId,
          flavor
        );
        const projects: Record<string, { codeRef: string }> = Object.fromEntries(
          Object.entries(read.catalog.projects).map(([id, locator]) => [
            id,
            { codeRef: locator.codeRef },
          ])
        );

        if (projectId !== undefined && input.removeCodeRef === true) {
          const bound = await activeChangesOnLine(
            this.dependencies,
            store.checkoutRoot,
            projectId,
            targetLineId,
            flavor
          );
          if (bound.length > 0) {
            throw workspaceError(
              'target_line_locator_in_use',
              `Project '${projectId}' still has ${bound.length} active Change(s) bound to target line '${targetLineId}': ${bound.join(', ')}.`,
              {
                target: read.path,
                fix: 'Finalize or move those Changes first; a locator a live Change depends on is never removed.',
              }
            );
          }
          delete projects[projectId];
        } else if (projectId !== undefined && input.codeRef !== undefined) {
          projects[projectId] = { codeRef: parseFullGitRef(input.codeRef, 'codeRef') };
        }

        const catalog: StoreTargetLineCatalogV1 = {
          version: 1,
          // The identity NEVER moves; only the locators do, and renaming is not
          // offered at all.
          id: read.catalog.id,
          storeRef:
            input.storeRef === undefined
              ? read.catalog.storeRef
              : parseFullGitRef(input.storeRef, 'storeRef'),
          projects,
        } as StoreTargetLineCatalogV1;
        await this.dependencies.fs.writeText(
          read.path,
          serializeStoreTargetLineCatalogV1(catalog)
        );
        return recordFrom(store, catalog, read.path, [
          catalogCommitSuggestion(store.checkoutRoot, read.path, targetLineId),
        ]);
      }
    );
  }

  async resolve(input: TargetLineSelector): Promise<ResolvedTargetLine> {
    const flavor = input.pathFlavor ?? 'native';
    const store = await this.store(input);
    const read = await requireTargetLineCatalog(
      this.dependencies,
      store.checkoutRoot,
      store.storeId,
      input.targetLineId,
      flavor
    );
    return resolveTargetLineRecord(this.dependencies, {
      store,
      catalog: read.catalog,
      catalogPath: read.path,
      ...(input.project === undefined ? {} : { projectId: input.project }),
      ...(input.globalDataDir === undefined ? {} : { globalDataDir: input.globalDataDir }),
    });
  }

  private async store(input: TargetLineQuery): Promise<ResolvedWorkspaceStore> {
    return resolveWorkspaceStore(this.dependencies, {
      ...(input.store === undefined ? {} : { store: input.store }),
      startPath: input.startPath,
      ...(input.globalDataDir === undefined ? {} : { globalDataDir: input.globalDataDir }),
      ...(input.pathFlavor === undefined ? {} : { pathFlavor: input.pathFlavor }),
    });
  }

  private async requireProject(
    store: ResolvedWorkspaceStore,
    project: string,
    flavor: StorePlanningPathFlavor
  ): Promise<string> {
    const projectId = parseProjectId(project, 'selection.project');
    const catalog = await readProjectCatalog(
      this.dependencies,
      store.checkoutRoot,
      projectId,
      flavor
    );
    if (catalog === null) {
      throw workspaceError(
        'workspace_project_unresolved',
        `Project '${projectId}' is not in Store '${store.storeId}' layout v2 catalog.`,
        { target: 'selection.project', fix: `Run 'rasen store add-project' first.` }
      );
    }
    return catalog.projectId;
  }
}

/**
 * Resolve one already-read catalog. Shared with the workspace plan builder so
 * both freeze the SAME OIDs from the same code path.
 */
export async function resolveTargetLineRecord(
  dependencies: StoreWorkspaceDependencies,
  input: {
    readonly store: ResolvedWorkspaceStore;
    readonly catalog: StoreTargetLineCatalogV1;
    readonly catalogPath: string;
    readonly projectId?: string;
    readonly codeRepositoryRoot?: string;
    readonly globalDataDir?: string;
  }
): Promise<ResolvedTargetLine> {
  const storeRefOid = await resolveLocator(dependencies, {
    repoRoot: input.store.checkoutRoot,
    ref: input.catalog.storeRef,
    field: 'storeRef',
    repositoryLabel: `Store '${input.store.storeId}'`,
  });

  if (input.projectId === undefined) {
    return { targetLineId: input.catalog.id, storeRef: input.catalog.storeRef, storeRefOid };
  }

  const locator = input.catalog.projects[input.projectId];
  if (locator === undefined) {
    throw workspaceError(
      'target_line_ref_unresolved',
      `Target line '${input.catalog.id}' carries no code locator for project '${input.projectId}'.`,
      {
        target: input.catalogPath,
        fix: `Add one with 'rasen store target-line set-ref ${input.catalog.id} --project ${input.projectId} --code-ref refs/heads/<branch>'.`,
      }
    );
  }
  const codeRepositoryRoot =
    input.codeRepositoryRoot ??
    (await resolveProjectRepositoryRoot(dependencies, input.projectId, input.globalDataDir));
  const codeRefOid = await resolveLocator(dependencies, {
    repoRoot: codeRepositoryRoot,
    ref: locator.codeRef,
    field: `projects.${input.projectId}.codeRef`,
    repositoryLabel: `project '${input.projectId}'`,
  });

  return {
    targetLineId: input.catalog.id,
    storeRef: input.catalog.storeRef,
    storeRefOid,
    codeRef: locator.codeRef,
    codeRefOid,
  };
}

/** The production Module instance. */
export const StoreTargetLinesModuleInstance = new StoreTargetLinesModule();
