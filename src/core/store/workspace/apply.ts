/**
 * Applying a workspace plan.
 *
 * `apply` consumes ONLY a token. It re-reads no working directory, no current
 * branch, and none of the selectors that produced the plan; everything it needs
 * is either in the stored plan or is re-read from Git for the sole purpose of
 * REVALIDATION.
 *
 * Before the first write it revalidates, under the scope and workspace locks:
 * the target-line catalog text, both resolved ref OIDs, the HEAD OID and
 * checked-out ref of every reused worktree, the non-existence of every created
 * destination, the Store's declared layout version, and the index fingerprint.
 * Any mismatch aborts with `workspace_plan_stale` — a stale plan is INVALIDATED,
 * never repaired, because repairing it would mean deciding on the user's behalf
 * which of two disagreeing facts they meant.
 *
 * New worktrees are created from the recorded commit OID, never from the ref
 * name, so a ref that moved between planning and applying cannot silently
 * retarget the worktree; the OID comparison catches it first.
 *
 * Every action is idempotent for an already-satisfied state, and the phase is
 * recorded in the index entry BEFORE each transition, so an interrupted apply
 * is resumable from the index rather than from a directory scan.
 */
import { parseStoreMetadataState } from '../foundation.js';
import {
  assertCarrierAgreesWithScope,
  assertPairAgrees,
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
import { pathApiFor } from './identity.js';
import {
  currentWorkspaceIndexFingerprint,
  readWorkspaceIndexEntry,
  writeWorkspaceIndexEntry,
  type WorkspaceIndexEntry,
  type WorkspacePhase,
} from './registry.js';
import type {
  ImmutableWorkspacePlan,
  PreparedChangeWorkspace,
  SuggestedWorkspaceCommit,
  WorkspacePlanToken,
  WorkspacePlanSide,
  WorktreeFacts,
} from './types.js';

function stale(
  what: string,
  expected: string | undefined,
  actual: string | undefined,
  target: string
): never {
  throw workspaceRefusal(
    'workspace_plan_stale',
    `${what} moved between planning and applying, so the plan no longer describes reality.`,
    {
      expected,
      actual,
      target,
      fix: "Re-run 'rasen store workspace plan' and apply the new plan. A stale plan is invalidated, never repaired.",
    }
  );
}

/**
 * Everything the plan froze, re-read once. Returns the live facts so the
 * caller does not have to survey twice.
 */
export async function revalidateWorkspacePlan(
  dependencies: StoreWorkspaceDependencies,
  plan: ImmutableWorkspacePlan,
  token: WorkspacePlanToken,
  existing: WorkspaceIndexEntry | null = null
): Promise<{ readonly planning: WorktreeFacts; readonly execution: WorktreeFacts }> {
  const flavor = plan.pathFlavor;

  const metadataText = await dependencies.fs.readText(plan.storeMetadataPath);
  if (metadataText === null) {
    stale('The Store metadata', 'layoutVersion: 2', '(absent)', plan.storeMetadataPath);
  }
  const metadata = parseStoreMetadataState(metadataText);
  if (metadata.layoutVersion !== 2) {
    stale(
      "The Store's declared layout version",
      '2',
      String(metadata.layoutVersion ?? 1),
      plan.storeMetadataPath
    );
  }

  const catalogText = await dependencies.fs.readText(plan.targetLineCatalog.path);
  const catalogDigest = catalogText === null ? '(absent)' : digestOf(catalogText);
  if (catalogDigest !== plan.targetLineCatalog.digest) {
    stale(
      `The target-line catalog for '${plan.targetLine.targetLineId}'`,
      plan.targetLineCatalog.digest,
      catalogDigest,
      plan.targetLineCatalog.path
    );
  }

  const storeRefTargets = await dependencies.git.resolveRef(
    plan.scope.storeRoot,
    plan.targetLine.storeRef
  );
  const liveStoreOid = storeRefTargets.length === 1 ? storeRefTargets[0]?.oid : undefined;
  if (liveStoreOid !== token.storeRefOid) {
    stale(
      `The Store ref ${plan.targetLine.storeRef}`,
      token.storeRefOid,
      liveStoreOid ?? '(unresolved or ambiguous)',
      plan.targetLine.storeRef
    );
  }

  if (plan.targetLine.codeRef !== undefined) {
    const codeRefTargets = await dependencies.git.resolveRef(
      plan.execution.repositoryRoot,
      plan.targetLine.codeRef
    );
    const liveCodeOid = codeRefTargets.length === 1 ? codeRefTargets[0]?.oid : undefined;
    if (liveCodeOid !== token.codeRefOid) {
      stale(
        `The code ref ${plan.targetLine.codeRef}`,
        token.codeRefOid,
        liveCodeOid ?? '(unresolved or ambiguous)',
        plan.targetLine.codeRef
      );
    }
  }

  const sides: Array<[WorkspacePlanSide, string | undefined]> = [
    [plan.planning, token.planningHeadOid],
    [plan.execution, token.executionHeadOid],
  ];
  const facts: WorktreeFacts[] = [];
  for (const [side, frozenHead] of sides) {
    const live = await surveyWorktree(dependencies, {
      side: side.side,
      root: side.root,
      repositoryRoot: side.repositoryRoot,
      flavor,
    });
    facts.push(live);
    if (side.disposition === 'create') {
      // Idempotence: a destination this apply already created carries the
      // planned ref and its identity still agrees with the recorded apply.
      if (live.exists && live.ref !== side.ref) {
        stale(
          `The planned ${side.side} destination ${side.root}`,
          '(absent)',
          live.ref ?? '(occupied)',
          side.root
        );
      }
      const recordedIdentity =
        side.side === 'planning'
          ? existing?.planning.worktreeInstanceId
          : existing?.execution.worktreeInstanceId;
      if (
        recordedIdentity !== undefined &&
        recordedIdentity.length > 0 &&
        live.worktreeInstanceId !== recordedIdentity
      ) {
        stale(
          `The identity of the created ${side.side} worktree ${side.root}`,
          recordedIdentity,
          live.worktreeInstanceId ?? '(unknown)',
          side.root
        );
      }
      continue;
    }
    if (!live.exists) {
      stale(`The reused ${side.side} worktree ${side.root}`, side.ref, '(absent)', side.root);
    }
    if (
      side.worktreeInstanceId !== undefined &&
      live.worktreeInstanceId !== side.worktreeInstanceId
    ) {
      stale(
        `The identity of the reused ${side.side} worktree ${side.root}`,
        side.worktreeInstanceId,
        live.worktreeInstanceId ?? '(unknown)',
        side.root
      );
    }
    if (live.ref !== side.ref) {
      stale(
        `The reused ${side.side} worktree ${side.root}`,
        side.ref,
        live.ref ?? '(detached HEAD)',
        side.root
      );
    }
    if (frozenHead !== undefined && live.headOid !== frozenHead) {
      stale(
        `The HEAD of the reused ${side.side} worktree ${side.root}`,
        frozenHead,
        live.headOid ?? '(unknown)',
        side.root
      );
    }
  }

  if (plan.changeInstanceId !== undefined) {
    const markerPath = planningMarkerPath(plan.planning.root, flavor);
    const associationPath = executionAssociationPath(plan.execution.root, flavor);
    const [marker, association] = await Promise.all([
      readBindingFact(dependencies, markerPath),
      readBindingFact(dependencies, associationPath),
    ]);
    if (marker !== null) assertCarrierAgreesWithScope(marker.fact, plan.scope, markerPath);
    if (association !== null) {
      assertCarrierAgreesWithScope(association.fact, plan.scope, associationPath);
    }

    const expectedMarker: BindingFact = {
      version: 1,
      storeUid: plan.scope.storeUid,
      storeId: plan.scope.storeId,
      projectId: plan.scope.projectId,
      targetLineId: plan.scope.targetLineId,
      executionRoot: plan.execution.root,
    };
    const expectedAssociation: BindingFact = {
      ...expectedMarker,
      planningWorktree: plan.planning.root,
    };
    assertPairAgrees({
      marker: marker?.fact ?? expectedMarker,
      markerPath,
      association: association?.fact ?? expectedAssociation,
      associationPath,
      planningRoot: plan.planning.root,
      executionRoot: plan.execution.root,
      flavor,
    });
  }

  return { planning: facts[0] as WorktreeFacts, execution: facts[1] as WorktreeFacts };
}

export interface ApplyWorkspacePlanOptions {
  readonly globalDataDir?: string;
}

/**
 * Runs the plan's actions in order. The index entry is written FIRST, with the
 * phase it is about to attempt, so a crash leaves a resumable record rather
 * than an orphaned worktree nobody knows about.
 */
export async function applyWorkspacePlan(
  dependencies: StoreWorkspaceDependencies,
  plan: ImmutableWorkspacePlan,
  token: WorkspacePlanToken,
  options: ApplyWorkspacePlanOptions = {}
): Promise<PreparedChangeWorkspace> {
  const coordination = dependencies.coordination(options.globalDataDir);
  const liveFingerprint = await currentWorkspaceIndexFingerprint(
    coordination,
    plan.scope.planningScopeId,
    plan.changeId
  );
  if (liveFingerprint !== token.indexFingerprint) {
    stale(
      'The machine workspace index for this scope',
      token.indexFingerprint,
      liveFingerprint,
      coordination.resolve(`index/${plan.scope.planningScopeId}.json`)
    );
  }

  const existing = await readWorkspaceIndexEntry(
    coordination,
    plan.scope.planningScopeId,
    plan.changeId
  );
  await revalidateWorkspacePlan(dependencies, plan, token, existing);

  const at = dependencies.now().toISOString();
  const created: string[] = [];
  const reused: string[] = [];

  const record = async (
    phase: WorkspacePhase,
    planning: WorktreeFacts,
    execution: WorktreeFacts
  ): Promise<WorkspaceIndexEntry> => {
    const entry: WorkspaceIndexEntry = {
      version: 1,
      planningScopeId: plan.scope.planningScopeId,
      storeUid: plan.scope.storeUid,
      storeId: plan.scope.storeId,
      projectId: plan.scope.projectId,
      targetLineId: plan.scope.targetLineId,
      changeId: plan.changeId,
      ...(plan.changeInstanceId === undefined
        ? {}
        : { changeInstanceId: plan.changeInstanceId }),
      planning: {
        root: planning.root,
        repositoryIdentity: planning.repositoryIdentity ?? '',
        worktreeInstanceId: planning.worktreeInstanceId ?? '',
        ref: planning.ref ?? plan.planning.ref,
        headOid: planning.headOid ?? '',
      },
      execution: {
        root: execution.root,
        repositoryIdentity: execution.repositoryIdentity ?? '',
        worktreeInstanceId: execution.worktreeInstanceId ?? '',
        ref: execution.ref ?? plan.execution.ref,
        headOid: execution.headOid ?? '',
      },
      planId: plan.planId,
      phase,
      recordedAt: existing?.recordedAt ?? at,
      updatedAt: at,
    };
    await writeWorkspaceIndexEntry(coordination, entry);
    return entry;
  };

  const survey = async (side: WorkspacePlanSide): Promise<WorktreeFacts> =>
    surveyWorktree(dependencies, {
      side: side.side,
      root: side.root,
      repositoryRoot: side.repositoryRoot,
      flavor: plan.pathFlavor,
    });

  let planningFacts = await survey(plan.planning);
  let executionFacts = await survey(plan.execution);
  await record('planned', planningFacts, executionFacts);

  for (const side of [plan.planning, plan.execution] as const) {
    const isPlanning = side.side === 'planning';
    const facts = isPlanning ? planningFacts : executionFacts;
    if (side.disposition === 'reuse' || facts.exists) {
      reused.push(side.root);
      continue;
    }
    await record(
      isPlanning ? 'planning-worktree-created' : 'execution-worktree-created',
      planningFacts,
      executionFacts
    );
    // Created FROM the frozen commit, not from the ref name: a ref that moved
    // is already excluded by revalidation, and using the OID means the
    // worktree cannot follow it even if it moves during this call.
    await dependencies.git.addWorktree({
      repoRoot: side.repositoryRoot,
      destination: side.root,
      branch: side.ref,
      commit: side.fromOid,
    });
    created.push(side.root);
    if (isPlanning) planningFacts = await survey(side);
    else executionFacts = await survey(side);
  }

  const markerFact: BindingFact = {
    version: 1,
    storeUid: plan.scope.storeUid,
    storeId: plan.scope.storeId,
    projectId: plan.scope.projectId,
    targetLineId: plan.scope.targetLineId,
    executionRoot: plan.execution.root,
  };
  const associationFact: BindingFact = {
    version: 1,
    storeUid: plan.scope.storeUid,
    storeId: plan.scope.storeId,
    projectId: plan.scope.projectId,
    targetLineId: plan.scope.targetLineId,
    planningWorktree: plan.planning.root,
    executionRoot: plan.execution.root,
  };

  await record('markers-written', planningFacts, executionFacts);
  await writeBindingDocument(dependencies, {
    destination: markerAction(plan, 'write-planning-marker'),
    content: serializeBindingFact(markerFact),
    root: plan.planning.root,
    flavor: plan.pathFlavor,
  });
  await writeBindingDocument(dependencies, {
    destination: markerAction(plan, 'write-execution-association'),
    content: serializeBindingFact(associationFact),
    root: plan.execution.root,
    flavor: plan.pathFlavor,
  });

  const entry = await record('prepared', planningFacts, executionFacts);

  return {
    planId: plan.planId,
    scope: plan.scope,
    targetLine: plan.targetLine,
    changeId: plan.changeId,
    bindingState: entry.workspacePairId === undefined ? 'prepared' : 'bound',
    planning: planningFacts,
    execution: executionFacts,
    ...(entry.changeInstanceId === undefined
      ? {}
      : { changeInstanceId: entry.changeInstanceId }),
    ...(entry.workspacePairId === undefined
      ? {}
      : { workspacePairId: entry.workspacePairId }),
    created,
    reused,
    suggestedCommits: preparationCommitSuggestions(),
  };
}

function markerAction(
  plan: ImmutableWorkspacePlan,
  kind: 'write-planning-marker' | 'write-execution-association'
): string {
  const action = plan.actions.find((candidate) => candidate.kind === kind);
  if (action === undefined) {
    throw workspaceError(
      'workspace_plan_not_applicable',
      `The plan carries no ${kind} action, so it cannot be applied.`,
      { target: plan.planId, fix: 'Re-run the plan.' }
    );
  }
  return action.destination;
}

/**
 * Writes one binding document, refusing any destination outside its planned
 * worktree root. Containment is checked again here rather than trusted from the
 * plan: `apply` writes only inside the two planned roots and the machine data
 * directory, and that is an invariant of the WRITE, not of the plan.
 */
async function writeBindingDocument(
  dependencies: StoreWorkspaceDependencies,
  input: {
    readonly destination: string;
    readonly content: string;
    readonly root: string;
    readonly flavor: ImmutableWorkspacePlan['pathFlavor'];
  }
): Promise<void> {
  const api = pathApiFor(input.flavor);
  const relative = api.relative(api.resolve(input.root), api.resolve(input.destination));
  if (relative.length === 0 || relative.startsWith('..') || api.isAbsolute(relative)) {
    throw workspaceRefusal(
      'workspace_destination_exists',
      `Refusing to write ${input.destination}: it is outside the planned worktree root.`,
      {
        expected: input.root,
        actual: input.destination,
        target: input.destination,
        fix: 'Re-run the plan; apply writes only inside the two planned worktree roots and the machine data directory.',
      }
    );
  }
  const current = await dependencies.fs.readText(input.destination);
  if (current === input.content) return;
  await dependencies.fs.writeText(input.destination, input.content);
}

function preparationCommitSuggestions(): readonly SuggestedWorkspaceCommit[] {
  // Preparation writes NOTHING Git-tracked: the marker and the association are
  // machine-local run state under `.rasen/`, and the index lives in the machine
  // data directory. There is deliberately nothing to commit here.
  return [];
}
