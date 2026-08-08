/**
 * Workspace plan construction.
 *
 * `plan` is READ-ONLY and TOTAL: it resolves the scope and the target line,
 * surveys both repositories, and reports EVERY unsatisfied precondition rather
 * than stopping at the first. It writes nothing into either Git repository —
 * the only file it produces is the plan itself, under the machine data
 * directory, and that write happens in the Module, not here.
 *
 * The plan is a pure value. Its identity is the digest of its own canonical
 * bytes, so equal inputs produce an identical plan and an identical id, and
 * `apply` can consume ONLY a token: no working directory, no current branch,
 * and none of the selectors that produced it.
 *
 * Git OID preconditions are frozen INTO the plan — the target line's Store ref
 * and code ref, and the HEAD of every reused worktree — and a created worktree
 * is created from the recorded OID rather than from the ref name, so a ref that
 * moves between planning and applying invalidates the plan instead of silently
 * retargeting the worktree.
 */
import { createHash } from 'node:crypto';

import { parse as parseYamlDocument } from 'yaml';

import { canonicalBytes } from '../../canonical-json.js';
import { ChangeMetadataSchema } from '../../change-metadata/index.js';
import { storeUidsMatch } from '../identity-types.js';
import {
  derivePlanningScopeId,
  parseChangeId,
  parseFullGitRef,
  parseProjectId,
  parseTargetLineId,
  resolveStorePlanningLayoutV2Path,
} from '../planning-foundation.js';
import type { StorePlanningPathFlavor } from '../planning-layout-v2.js';
import { resolveTargetLineRecord } from '../target-lines.js';
import {
  digestOf,
  executionAssociationPath,
  planningMarkerPath,
  readBindingFact,
  serializeBindingFact,
  surveyWorktree,
  type BindingFact,
} from './binding.js';
import type { StoreWorkspaceDependencies } from './dependencies.js';
import { workspaceError, workspaceRefusal } from './diagnostics.js';
import { isContainedIn, pathApiFor, samePath } from './identity.js';
import {
  currentWorkspaceIndexFingerprint,
  readWorkspaceIndexDocument,
  type WorkspaceIndexEntry,
} from './registry.js';
import {
  readProjectCatalog,
  repositoryMainCheckout,
  requireTargetLineCatalog,
  resolveProjectRepositoryRoot,
  resolveWorkspaceStore,
  type ResolvedWorkspaceStore,
} from './scope.js';
import type {
  ImmutableWorkspacePlan,
  PrepareChangeWorkspaceInput,
  ResolvedTargetLine,
  WorkspaceAction,
  WorkspacePlanSide,
  WorkspacePlanToken,
  WorkspacePrecondition,
  WorkspaceScope,
  WorkspaceSide,
  WorktreeFacts,
} from './types.js';

/**
 * The planning and execution branch a prepared pair checks out. It is a
 * LOCATOR: it embeds the line, project, and Change alias for humans, and no
 * code path ever parses it back out.
 */
export function workspaceBranchRef(input: {
  readonly targetLineId: string;
  readonly projectId: string;
  readonly changeId: string;
}): string {
  return parseFullGitRef(
    `refs/heads/change/${input.targetLineId}/${input.projectId}/${input.changeId}`,
    'planningRef'
  );
}

/**
 * Where a worktree goes when the caller names no destination: a sibling of the
 * repository root, suffixed with the Change alias. It is computed on the plan's
 * declared path flavor, so a `win32` plan produces a `win32` destination on a
 * POSIX host and vice versa.
 */
export function defaultWorktreeDestination(
  base: string,
  changeId: string,
  flavor: StorePlanningPathFlavor
): string {
  const api = pathApiFor(flavor);
  const resolved = api.resolve(base);
  return api.join(api.dirname(resolved), `${api.basename(resolved)}--${changeId}`);
}

function precondition(
  id: string,
  satisfied: boolean,
  detail: string,
  extra: {
    readonly expected?: string;
    readonly actual?: string;
    readonly code?: WorkspacePrecondition['code'];
  } = {}
): WorkspacePrecondition {
  return {
    id,
    satisfied,
    detail,
    ...(extra.expected === undefined ? {} : { expected: extra.expected }),
    ...(extra.actual === undefined ? {} : { actual: extra.actual }),
    ...(extra.code === undefined ? {} : { code: extra.code }),
  };
}

interface SidePlanInput {
  readonly side: WorkspaceSide;
  readonly requestedRoot?: string;
  readonly repositoryRoot: string;
  readonly expectedRef: string;
  readonly changeId: string;
  readonly fromOid: string;
  readonly recorded?: { readonly root: string; readonly ref: string; readonly headOid: string };
  readonly flavor: StorePlanningPathFlavor;
}

interface SidePlan {
  readonly plan: WorkspacePlanSide;
  readonly facts: WorktreeFacts;
  readonly preconditions: readonly WorkspacePrecondition[];
}

/**
 * Decides create-vs-reuse for one side and reports every problem it finds.
 *
 * Reuse is decided by "is this path already a worktree of the recorded
 * repository", never by the path merely existing: an occupied destination that
 * is NOT a worktree is `workspace_destination_exists`, because overwriting or
 * merging into it is not something a preparation step gets to do.
 */
async function planSide(
  dependencies: StoreWorkspaceDependencies,
  input: SidePlanInput
): Promise<SidePlan> {
  const flavor = input.flavor;
  const root =
    input.requestedRoot ??
    input.recorded?.root ??
    defaultWorktreeDestination(input.repositoryRoot, input.changeId, flavor);
  const facts = await surveyWorktree(dependencies, {
    side: input.side,
    root,
    repositoryRoot: input.repositoryRoot,
    flavor,
  });
  const preconditions: WorkspacePrecondition[] = [];

  const isWorktreeOfRepository =
    facts.exists &&
    facts.worktreeInstanceId !== undefined &&
    (await sameRepository(dependencies, input.repositoryRoot, root, flavor));

  if (!facts.exists) {
    preconditions.push(
      precondition(
        `${input.side}-destination-available`,
        true,
        `${root} does not exist yet, so the worktree is created there.`
      )
    );
    return {
      facts,
      preconditions,
      plan: {
        side: input.side,
        root,
        repositoryRoot: input.repositoryRoot,
        disposition: 'create',
        ref: input.expectedRef,
        fromOid: input.fromOid,
        createsBranch: true,
      },
    };
  }

  if (!isWorktreeOfRepository) {
    preconditions.push(
      precondition(
        `${input.side}-destination-available`,
        false,
        `${root} already exists and is not a worktree of ${input.repositoryRoot}; preparation never overwrites or merges into an occupied destination.`,
        {
          expected: '(absent, or a worktree of the recorded repository)',
          actual: root,
          code: 'workspace_destination_exists',
        }
      )
    );
    return {
      facts,
      preconditions,
      plan: {
        side: input.side,
        root,
        repositoryRoot: input.repositoryRoot,
        disposition: 'create',
        ref: input.expectedRef,
        fromOid: input.fromOid,
        createsBranch: true,
      },
    };
  }

  // Reuse. A recorded pair fixes the ref; a fresh reuse ADOPTS the ref the
  // worktree is already on, because there is nothing yet to disagree with and
  // preparation never moves a HEAD.
  const expectedRef = input.recorded?.ref ?? facts.ref;
  if (facts.ref === undefined) {
    preconditions.push(
      precondition(
        `${input.side}-ref-matches`,
        false,
        `${root} has a detached HEAD, so there is no ref for the pair to record.`,
        {
          expected: expectedRef ?? input.expectedRef,
          actual: '(detached HEAD)',
          code: 'workspace_ref_mismatch',
        }
      )
    );
  } else if (expectedRef !== undefined && facts.ref !== expectedRef) {
    preconditions.push(
      precondition(
        `${input.side}-ref-matches`,
        false,
        `${root} is on ${facts.ref}, not the recorded ${expectedRef}. Preparation refuses rather than switching it, because the worktree may hold work you have not committed.`,
        { expected: expectedRef, actual: facts.ref, code: 'workspace_ref_mismatch' }
      )
    );
  } else {
    preconditions.push(
      precondition(
        `${input.side}-ref-matches`,
        true,
        `${root} is on ${facts.ref ?? '(unknown)'}, which is the ref the pair records.`
      )
    );
  }

  if (facts.linked === false) {
    preconditions.push(
      precondition(
        `${input.side}-is-linked-worktree`,
        input.side === 'execution',
        input.side === 'planning'
          ? `${root} is the Store repository's main checkout, which is the integration checkout and is never a planning worktree.`
          : `${root} is the project repository's main checkout, which a pair may legitimately use for execution.`,
        input.side === 'planning'
          ? {
              expected: 'a linked worktree',
              actual: 'the main checkout',
              code: 'workspace_ref_mismatch',
            }
          : {}
      )
    );
  }

  return {
    facts,
    preconditions,
    plan: {
      side: input.side,
      root,
      repositoryRoot: input.repositoryRoot,
      disposition: 'reuse',
      ref: expectedRef ?? input.expectedRef,
      fromOid: facts.headOid ?? input.fromOid,
      createsBranch: false,
      ...(facts.worktreeInstanceId === undefined
        ? {}
        : { worktreeInstanceId: facts.worktreeInstanceId }),
      ...(facts.headOid === undefined ? {} : { headOid: facts.headOid }),
    },
  };
}

async function sameRepository(
  dependencies: StoreWorkspaceDependencies,
  repositoryRoot: string,
  candidate: string,
  flavor: StorePlanningPathFlavor
): Promise<boolean> {
  const worktrees = await dependencies.git.worktreeList(repositoryRoot);
  if (worktrees === null) return false;
  return worktrees.some((entry) => samePath(entry.root, candidate, flavor));
}

export interface WorkspacePlanContext {
  readonly store: ResolvedWorkspaceStore;
  readonly scope: WorkspaceScope;
  readonly targetLine: ResolvedTargetLine;
  readonly targetLineCatalog: { readonly path: string; readonly digest: string };
  readonly codeRepositoryRoot: string;
  readonly indexEntry: WorkspaceIndexEntry | null;
}

/**
 * Resolves everything a plan needs before any survey happens. Splitting this
 * out keeps `describe` and `planCleanup` on exactly the same resolution path as
 * `plan`, so the three can never disagree about which scope they are talking
 * about.
 */
export async function resolveWorkspaceContext(
  dependencies: StoreWorkspaceDependencies,
  input: {
    readonly store?: string;
    readonly project?: string;
    readonly targetLine?: string;
    readonly changeId?: string;
    readonly startPath: string;
    readonly globalDataDir?: string;
    readonly pathFlavor?: StorePlanningPathFlavor;
    readonly executionWorktree?: string;
  }
): Promise<WorkspacePlanContext> {
  const flavor = input.pathFlavor ?? 'native';
  const store = await resolveWorkspaceStore(dependencies, {
    ...(input.store === undefined ? {} : { store: input.store }),
    startPath: input.startPath,
    ...(input.globalDataDir === undefined ? {} : { globalDataDir: input.globalDataDir }),
    pathFlavor: flavor,
  });

  if (input.project === undefined) {
    throw workspaceError(
      'workspace_project_unresolved',
      'A workspace belongs to exactly one project partition.',
      { target: 'selection.project', fix: 'Add --project <project-id>.' }
    );
  }
  const projectCatalog = await readProjectCatalog(
    dependencies,
    store.checkoutRoot,
    parseProjectId(input.project, 'selection.project'),
    flavor
  );
  if (projectCatalog === null) {
    throw workspaceError(
      'workspace_project_unresolved',
      `Project '${input.project}' is not in Store '${store.storeId}' layout v2 catalog.`,
      { target: 'selection.project', fix: `Run 'rasen store add-project' first.` }
    );
  }

  if (input.targetLine === undefined) {
    throw workspaceError(
      'workspace_target_line_unknown',
      'A workspace is prepared on exactly one target line, and no line is ever inferred from a branch name.',
      { target: 'selection.targetLine', fix: 'Add --target-line <id>.' }
    );
  }
  const catalog = await requireTargetLineCatalog(
    dependencies,
    store.checkoutRoot,
    store.storeId,
    parseTargetLineId(input.targetLine, 'selection.targetLine'),
    flavor
  );

  const codeRepositoryRoot =
    (await executionRepositoryFor(dependencies, input.executionWorktree, flavor)) ??
    (await resolveProjectRepositoryRoot(
      dependencies,
      projectCatalog.projectId,
      input.globalDataDir
    ));

  const targetLine = await resolveTargetLineRecord(dependencies, {
    store,
    catalog: catalog.catalog,
    catalogPath: catalog.path,
    projectId: projectCatalog.projectId,
    codeRepositoryRoot,
    ...(input.globalDataDir === undefined ? {} : { globalDataDir: input.globalDataDir }),
  });

  const scope: WorkspaceScope = {
    storeUid: store.storeUid,
    storeId: store.storeId,
    storeRoot: store.checkoutRoot,
    projectId: projectCatalog.projectId,
    targetLineId: catalog.catalog.id,
    planningScopeId: derivePlanningScopeId({
      storeUid: store.storeUid,
      projectId: projectCatalog.projectId,
      targetLineId: catalog.catalog.id,
    }),
  };

  const coordination = dependencies.coordination(input.globalDataDir);
  const document = await readWorkspaceIndexDocument(coordination, scope.planningScopeId);
  const indexEntry =
    input.changeId === undefined
      ? null
      : (document.entries.find((entry) => entry.changeId === input.changeId) ?? null);

  return {
    store,
    scope,
    targetLine,
    targetLineCatalog: { path: catalog.path, digest: digestOf(catalog.text) },
    codeRepositoryRoot,
    indexEntry,
  };
}

/**
 * The repository an explicitly named execution worktree belongs to. Returns
 * null when the caller named nothing, or named a path that is not a worktree —
 * the latter becomes `workspace_destination_exists` further down, where the
 * plan can report it beside every other problem.
 */
async function executionRepositoryFor(
  dependencies: StoreWorkspaceDependencies,
  executionWorktree: string | undefined,
  flavor: StorePlanningPathFlavor
): Promise<string | null> {
  if (executionWorktree === undefined) return null;
  if ((await dependencies.fs.statKind(executionWorktree)) !== 'directory') return null;
  const main = await repositoryMainCheckout(dependencies, executionWorktree);
  void flavor;
  return main;
}

export interface BuildWorkspacePlanInput extends PrepareChangeWorkspaceInput {
  readonly context: WorkspacePlanContext;
}

export async function buildWorkspacePlan(
  dependencies: StoreWorkspaceDependencies,
  input: BuildWorkspacePlanInput
): Promise<ImmutableWorkspacePlan> {
  const flavor = input.pathFlavor ?? 'native';
  const api = pathApiFor(flavor);
  const { scope, targetLine, codeRepositoryRoot, indexEntry } = input.context;
  const changeId = parseChangeId(input.changeId, 'changeId');
  const intent = input.intent ?? 'new-change';
  const preconditions: WorkspacePrecondition[] = [];

  if (targetLine.codeRef === undefined || targetLine.codeRefOid === undefined) {
    throw workspaceError(
      'target_line_ref_unresolved',
      `Target line '${targetLine.targetLineId}' carries no code locator for project '${scope.projectId}', so no execution worktree can be planned.`,
      {
        target: 'selection.targetLine',
        fix: `Add one with 'rasen store target-line set-ref ${targetLine.targetLineId} --project ${scope.projectId} --code-ref refs/heads/<branch>'.`,
      }
    );
  }

  const branchRef = workspaceBranchRef({
    targetLineId: scope.targetLineId,
    projectId: scope.projectId,
    changeId,
  });

  // A second Change in one planning worktree is refused from the RECORDED
  // binding, never from a directory scan of the planning tree.
  const coordination = dependencies.coordination(input.globalDataDir);
  const document = await readWorkspaceIndexDocument(coordination, scope.planningScopeId);
  const requestedPlanningRoot = input.planningWorktree ?? indexEntry?.planning.root;
  if (requestedPlanningRoot !== undefined) {
    const conflicting = document.entries.find(
      (entry) =>
        entry.changeId !== changeId &&
        entry.planning.root.length > 0 &&
        samePath(entry.planning.root, requestedPlanningRoot, flavor)
    );
    if (conflicting !== undefined) {
      throw workspaceRefusal(
        'workspace_already_bound',
        `Planning worktree ${requestedPlanningRoot} already carries Change '${conflicting.changeId}'.`,
        {
          expected: conflicting.changeId,
          actual: changeId,
          target: requestedPlanningRoot,
          fix: 'Prepare a second planning worktree for the second Change; one planning worktree carries exactly one active Change.',
        }
      );
    }
  }

  const planningBase = api.resolve(input.context.store.registeredRoot);
  const executionBase = api.resolve(codeRepositoryRoot);

  const planningSide = await planSide(dependencies, {
    side: 'planning',
    ...(input.planningWorktree === undefined
      ? {}
      : { requestedRoot: api.resolve(input.planningWorktree) }),
    repositoryRoot: input.context.store.registeredRoot,
    expectedRef: branchRef,
    changeId,
    fromOid: targetLine.storeRefOid,
    ...(indexEntry === null
      ? {}
      : {
          recorded: {
            root: indexEntry.planning.root,
            ref: indexEntry.planning.ref,
            headOid: indexEntry.planning.headOid,
          },
        }),
    flavor,
  });
  const executionSide = await planSide(dependencies, {
    side: 'execution',
    ...(input.executionWorktree === undefined
      ? {}
      : { requestedRoot: api.resolve(input.executionWorktree) }),
    repositoryRoot: codeRepositoryRoot,
    expectedRef: branchRef,
    changeId,
    fromOid: targetLine.codeRefOid,
    ...(indexEntry === null
      ? {}
      : {
          recorded: {
            root: indexEntry.execution.root,
            ref: indexEntry.execution.ref,
            headOid: indexEntry.execution.headOid,
          },
        }),
    flavor,
  });
  preconditions.push(...planningSide.preconditions, ...executionSide.preconditions);

  // Default destinations are derived from each repository, which is why the
  // side planner is given the repository root as the naming base.
  void planningBase;
  void executionBase;

  // Containment: every destination this plan writes must sit inside its own
  // planned worktree root, computed on the plan's declared path flavor.
  const markerPath = planningMarkerPath(planningSide.plan.root, flavor);
  const associationPath = executionAssociationPath(executionSide.plan.root, flavor);
  for (const [side, root, destination] of [
    ['planning', planningSide.plan.root, markerPath],
    ['execution', executionSide.plan.root, associationPath],
  ] as const) {
    preconditions.push(
      precondition(
        `${side}-marker-contained`,
        isContainedIn(root, destination, flavor),
        `${destination} is inside the planned ${side} worktree root ${root}.`,
        isContainedIn(root, destination, flavor)
          ? {}
          : { expected: root, actual: destination, code: 'workspace_destination_exists' }
      )
    );
  }

  // The two checks above are structurally incapable of failing: a marker path
  // is two fixed non-`..` literals joined onto its own root, so it is a
  // descendant of that root for every input. They state the invariant, and they
  // would fire if the marker location ever became configurable — but the
  // containment facts that CAN be false are about the ROOTS, which is where a
  // caller's `--planning-worktree` / `--execution-worktree` arrives.
  for (const [side, root, repositoryRoot] of [
    ['planning', planningSide.plan.root, input.context.store.registeredRoot],
    ['execution', executionSide.plan.root, codeRepositoryRoot],
  ] as const) {
    const inside = isContainedIn(repositoryRoot, root, flavor);
    preconditions.push(
      precondition(
        `${side}-root-outside-repository`,
        !inside,
        inside
          ? `${root} is inside the ${side} repository's own checkout ${repositoryRoot}. A worktree nested in its repository shows up there as untracked content, so the checkout this capability promises to leave byte-identical would stop being so, and cleanup would have to reach inside it.`
          : `${root} is outside the ${side} repository's checkout ${repositoryRoot}.`,
        inside
          ? {
              expected: `a path outside ${repositoryRoot}`,
              actual: root,
              code: 'workspace_destination_exists',
            }
          : {}
      )
    );
  }

  const nested =
    isContainedIn(planningSide.plan.root, executionSide.plan.root, flavor) ||
    isContainedIn(executionSide.plan.root, planningSide.plan.root, flavor);
  preconditions.push(
    precondition(
      'pair-roots-disjoint',
      !nested,
      nested
        ? `The planned planning root ${planningSide.plan.root} and execution root ${executionSide.plan.root} are the same path or nested one inside the other. The pair's two carriers would land in one tree, and removing either side would reach into the other.`
        : 'The planned planning and execution roots are distinct, and neither contains the other.',
      nested
        ? {
            expected: 'two disjoint roots',
            actual: `${planningSide.plan.root} / ${executionSide.plan.root}`,
            code: 'workspace_destination_exists',
          }
        : {}
    )
  );

  const markerFact: BindingFact = {
    version: 1,
    storeUid: scope.storeUid,
    storeId: scope.storeId,
    projectId: scope.projectId,
    targetLineId: scope.targetLineId,
    executionRoot: executionSide.plan.root,
  };
  const associationFact: BindingFact = {
    version: 1,
    storeUid: scope.storeUid,
    storeId: scope.storeId,
    projectId: scope.projectId,
    targetLineId: scope.targetLineId,
    planningWorktree: planningSide.plan.root,
    executionRoot: executionSide.plan.root,
  };
  const markerContent = serializeBindingFact(markerFact);
  const associationContent = serializeBindingFact(associationFact);

  // A marker already in a reused planning worktree must not contradict the
  // scope; a contradicting one is a conflict, never something to rewrite.
  if (planningSide.plan.disposition === 'reuse') {
    const existingMarker = await readBindingFact(dependencies, markerPath).catch(
      (error: unknown) => {
        preconditions.push(
          precondition(
            'planning-marker-agrees',
            false,
            error instanceof Error ? error.message : String(error),
            { code: 'workspace_marker_conflict' }
          )
        );
        return null;
      }
    );
    if (existingMarker !== null) {
      const agrees =
        storeUidsMatch(existingMarker.fact.storeUid, scope.storeUid) &&
        existingMarker.fact.projectId === scope.projectId &&
        existingMarker.fact.targetLineId === scope.targetLineId;
      preconditions.push(
        precondition(
          'planning-marker-agrees',
          agrees,
          agrees
            ? `${markerPath} already declares this Store, project, and target line.`
            : `${markerPath} declares ${existingMarker.fact.storeUid}/${existingMarker.fact.projectId}/${existingMarker.fact.targetLineId}, which contradicts the selected scope.`,
          agrees
            ? {}
            : {
                expected: `${scope.storeUid}/${scope.projectId}/${scope.targetLineId}`,
                actual: `${existingMarker.fact.storeUid}/${existingMarker.fact.projectId}/${existingMarker.fact.targetLineId}`,
                code: 'workspace_marker_conflict',
              }
        )
      );
    }
  }

  let changeInstanceId: string | undefined;
  if (intent === 'existing-change') {
    changeInstanceId = await verifyExistingChangeIdentity(dependencies, {
      scope,
      changeId,
      flavor,
    });
  } else {
    const changePath = resolveStorePlanningLayoutV2Path(
      api.resolve(scope.storeRoot),
      { kind: 'active-change', projectId: parseProjectId(scope.projectId), changeId },
      flavor
    );
    const exists = (await dependencies.fs.statKind(changePath)) !== 'absent';
    preconditions.push(
      precondition(
        'change-not-already-created',
        !exists,
        exists
          ? `Change '${changeId}' already exists at ${changePath}; bind it with --intent existing-change instead of minting a second one.`
          : `Change '${changeId}' does not exist yet; creating it in the prepared planning worktree completes the binding.`,
        exists
          ? { expected: '(absent)', actual: changePath, code: 'workspace_already_bound' }
          : {}
      )
    );
  }

  const actions: WorkspaceAction[] = [
    {
      kind:
        planningSide.plan.disposition === 'create'
          ? 'create-planning-worktree'
          : 'reuse-planning-worktree',
      destination: planningSide.plan.root,
      repositoryRoot: planningSide.plan.repositoryRoot,
      fromOid: planningSide.plan.fromOid,
      ref: planningSide.plan.ref,
      createsBranch: planningSide.plan.createsBranch,
      alreadySatisfied: planningSide.plan.disposition === 'reuse',
    },
    {
      kind:
        executionSide.plan.disposition === 'create'
          ? 'create-execution-worktree'
          : 'reuse-execution-worktree',
      destination: executionSide.plan.root,
      repositoryRoot: executionSide.plan.repositoryRoot,
      fromOid: executionSide.plan.fromOid,
      ref: executionSide.plan.ref,
      createsBranch: executionSide.plan.createsBranch,
      alreadySatisfied: executionSide.plan.disposition === 'reuse',
    },
    {
      kind: 'write-planning-marker',
      destination: markerPath,
      digest: digestOf(markerContent),
      alreadySatisfied:
        (await dependencies.fs.readText(markerPath).catch(() => null)) === markerContent,
    },
    {
      kind: 'write-execution-association',
      destination: associationPath,
      digest: digestOf(associationContent),
      alreadySatisfied:
        (await dependencies.fs.readText(associationPath).catch(() => null)) ===
        associationContent,
    },
    {
      kind: 'record-index-entry',
      destination: coordination.resolve(`index/${scope.planningScopeId}.json`),
      alreadySatisfied: false,
    },
  ];

  const indexFingerprint = await currentWorkspaceIndexFingerprint(
    coordination,
    scope.planningScopeId,
    changeId
  );
  const blockers = preconditions.filter((entry) => !entry.satisfied);
  const applicable = blockers.length === 0;

  const body = {
    schemaVersion: 1 as const,
    intent,
    scope,
    targetLine,
    targetLineCatalog: input.context.targetLineCatalog,
    storeMetadataPath: resolveStorePlanningLayoutV2Path(
      api.resolve(scope.storeRoot),
      { kind: 'store-metadata' },
      flavor
    ),
    changeId,
    ...(changeInstanceId === undefined ? {} : { changeInstanceId }),
    pathFlavor: flavor,
    planning: planningSide.plan,
    execution: executionSide.plan,
    actions,
    preconditions,
    indexFingerprint,
    applicable,
    blockers,
  };
  // The plan id is the digest of the plan's MEANING, so equal inputs produce an
  // identical plan and an identical id. `createdAt` is recorded beside it and
  // deliberately excluded: a wall clock in the digest would make every re-plan
  // a different plan, and re-planning is how a user checks that nothing moved.
  const planId = createHash('sha256').update(canonicalBytes(body)).digest('hex');
  const token: WorkspacePlanToken | undefined = applicable
    ? {
        planId,
        storeUid: scope.storeUid,
        projectId: scope.projectId,
        targetLineId: scope.targetLineId,
        changeId,
        storeRefOid: targetLine.storeRefOid,
        codeRefOid: targetLine.codeRefOid,
        ...(planningSide.plan.disposition === 'reuse' && planningSide.plan.headOid !== undefined
          ? { planningHeadOid: planningSide.plan.headOid }
          : {}),
        ...(executionSide.plan.disposition === 'reuse' && executionSide.plan.headOid !== undefined
          ? { executionHeadOid: executionSide.plan.headOid }
          : {}),
        indexFingerprint,
      }
    : undefined;

  return {
    planId,
    createdAt: dependencies.now().toISOString(),
    ...body,
    ...(token === undefined ? {} : { token }),
  };
}

/**
 * `intent: 'existing-change'` verifies an already-minted Change identity
 * instead of reserving a new one, and refuses a Change whose committed
 * metadata names another Store, project, or target line.
 */
async function verifyExistingChangeIdentity(
  dependencies: StoreWorkspaceDependencies,
  input: {
    readonly scope: WorkspaceScope;
    readonly changeId: string;
    readonly flavor: StorePlanningPathFlavor;
  }
): Promise<string> {
  const api = pathApiFor(input.flavor);
  const changePath = resolveStorePlanningLayoutV2Path(
    api.resolve(input.scope.storeRoot),
    {
      kind: 'active-change',
      projectId: parseProjectId(input.scope.projectId),
      changeId: parseChangeId(input.changeId),
    },
    input.flavor
  );
  const metadataPath = api.join(changePath, '.openspec.yaml');
  const text = await dependencies.fs.readText(metadataPath);
  if (text === null) {
    throw workspaceError(
      'workspace_plan_not_applicable',
      `Change '${input.changeId}' has no committed metadata at ${metadataPath}, so there is no identity to bind.`,
      { target: metadataPath, fix: 'Prepare a workspace with the default intent and create the Change in it.' }
    );
  }
  let raw: unknown;
  try {
    raw = parseYamlDocument(text);
  } catch (error) {
    throw workspaceError(
      'workspace_plan_not_applicable',
      `Change '${input.changeId}' metadata at ${metadataPath} is unreadable.`,
      { target: metadataPath, fix: 'Repair the Change metadata.', cause: error }
    );
  }
  const parsed = ChangeMetadataSchema.safeParse(raw);
  if (!parsed.success || parsed.data.identity === undefined) {
    throw workspaceError(
      'workspace_plan_not_applicable',
      `Change '${input.changeId}' carries no portable v2 identity, so a pair cannot be bound to it.`,
      { target: metadataPath, fix: 'Repair the Change metadata.' }
    );
  }
  const identity = parsed.data.identity;
  if (
    !storeUidsMatch(identity.storeUid, input.scope.storeUid) ||
    identity.projectId !== input.scope.projectId
  ) {
    throw workspaceRefusal(
      'planning_execution_binding_mismatch',
      `Change '${input.changeId}' belongs to another Store or project than the one selected.`,
      {
        expected: `${input.scope.storeUid}/${input.scope.projectId}`,
        actual: `${identity.storeUid}/${identity.projectId}`,
        target: metadataPath,
        fix: 'Select the Store and project the Change was created in.',
      }
    );
  }
  if (identity.targetLineId !== input.scope.targetLineId) {
    throw workspaceRefusal(
      'target_line_mismatch',
      `Change '${input.changeId}' is frozen against target line '${identity.targetLineId}'.`,
      {
        expected: identity.targetLineId,
        actual: input.scope.targetLineId,
        target: metadataPath,
        fix: `Address it on its own line (--target-line ${identity.targetLineId}); a Change is never re-pointed at another line.`,
      }
    );
  }
  return identity.instanceId;
}
