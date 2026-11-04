/**
 * `StoreWorkspaceModule` — the one deep Module behind `rasen store workspace` and the
 * planning seam's `planChangeWorkspace` / `applyWorkspacePlan`.
 *
 * Callers see a plan, a token, a binding state, and findings. Worktree identity
 * derivation, the binding reducer and its authority order, the machine index
 * and its re-verification, the lock protocol, the closed Git verb set, and the
 * two-phase prepared/bound transition are all hidden here.
 *
 * The pair completes in TWO phases, because the Change instance does not exist
 * when the worktrees are created:
 *
 *     plan/apply    ->  PREPARED  (scope + both worktrees, no pair id)
 *     createChange  ->  BOUND     (Change instance + pair id completed)
 *
 * `WorkspacePairId` needs a `ChangeInstanceId`, a `ChangeInstanceId` is minted
 * by `createChange`, and `createChange` requires a verified planning worktree.
 * That circle is what the two phases break.
 *
 * `plan` and `apply` remain separate for preview-then-decide; `prepare` runs
 * both under ONE hold of the same locks, so the preconditions a plan freezes
 * cannot go stale in a gap between two invocations of the caller's own flow.
 */
import {
  derivePlanningScopeId,
  deriveWorkspacePairId,
  parseChangeInstanceId,
  parseWorktreeInstanceId,
} from '../planning-identity.js';
import type { StorePlanningPathFlavor } from '../planning-layout-v2.js';
import { applyCleanupPlan, buildCleanupPlan, cleanupGateError } from './cleanup.js';
import {
  assertCarrierAgreesWithScope,
  detectBindingAmbiguity,
  planningMarkerPath,
  readBindingFact,
  surveyWorktree,
  verifyIndexEntry,
} from './binding.js';
import {
  productionStoreWorkspaceDependencies,
  type StoreWorkspaceDependencies,
} from './dependencies.js';
import { workspaceError, workspaceRefusal } from './diagnostics.js';
import {
  deriveWorktreeIdentity,
  isContainedIn,
  isLinkedWorktree,
  samePath,
} from './identity.js';
import {
  scopeLockKey,
  withWorkspaceLocks,
  workspaceLockKey,
  type WorkspaceLockKey,
} from './locks.js';
import { applyWorkspacePlan } from './apply.js';
import { buildWorkspacePlan, resolveWorkspaceContext } from './plan.js';
import {
  listAllWorkspaceIndexEntries,
  readWorkspaceIndexDocument,
  readWorkspaceIndexEntry,
  workspaceCleanupPlanRelativePath,
  workspacePlanRelativePath,
  writeWorkspaceIndexEntry,
  type WorkspaceIndexEntry,
} from './registry.js';
import { WORKSPACE_NOT_PREPARED_CODE } from './types.js';
import type {
  CleanupPlanToken,
  CleanupResult,
  CleanupWorkspaceInput,
  DescribeWorkspaceInput,
  ImmutableCleanupPlan,
  ImmutableWorkspacePlan,
  PrepareChangeWorkspaceInput,
  PreparedChangeWorkspace,
  StoreWorkspaceModule,
  WorkspaceBindingState,
  WorkspaceDescription,
  WorkspacePlanToken,
  WorkspaceVerificationFinding,
} from './types.js';

/**
 * Which recorded pair a `describe` without `--change` is about.
 *
 * A scope holding several entries is a DESIGNED state, not an anomaly: the
 * index file is a per-scope document with one entry per Change alias, and
 * preparing a second Change in one scope while the first is live is expressly
 * reasoned about. So the alphabetically-first entry is never the answer — it
 * reports a different Change than the caller is standing in, with a complete
 * and entirely plausible payload and no finding to say so.
 *
 * The only thing that may decide is the caller's own location: the worktree the
 * command is running inside. When the location decides nothing, the answer is
 * ABSENT — absent facts are absent rather than guessed — and the caller is told
 * which Changes it could have meant.
 */
function selectDescribedEntry(
  entries: readonly WorkspaceIndexEntry[],
  input: DescribeWorkspaceInput,
  flavor: StorePlanningPathFlavor
): {
  readonly entry: WorkspaceIndexEntry | null;
  readonly undecided: readonly WorkspaceIndexEntry[];
} {
  if (input.changeId !== undefined) {
    return {
      entry: entries.find((candidate) => candidate.changeId === input.changeId) ?? null,
      undecided: [],
    };
  }
  if (entries.length <= 1) return { entry: entries[0] ?? null, undecided: [] };
  const here = entries.filter((candidate) =>
    [candidate.execution.root, candidate.planning.root].some(
      (root) => root.length > 0 && isContainedIn(root, input.startPath, flavor)
    )
  );
  if (here.length === 1) return { entry: here[0] as WorkspaceIndexEntry, undecided: [] };
  return { entry: null, undecided: entries };
}

/** What a one-invocation preparation reports: the preview, and the result. */
export interface PreparedWorkspaceOutcome {
  /** The plan built and frozen inside the lock hold. */
  readonly plan: ImmutableWorkspacePlan;
  /**
   * Absent when the plan carried blockers. A plan with unsatisfied
   * preconditions has no token, so there is nothing to apply and nothing was
   * written — the caller gets the preview and the reasons.
   */
  readonly prepared?: PreparedChangeWorkspace;
}

export interface StoreWorkspaceOptions {
  /**
   * Machine data root. Constructor-scoped because `apply(token)` consumes ONLY
   * a token, so there is no other place a machine-local location could arrive
   * from without turning the Module into a stateful object.
   */
  readonly globalDataDir?: string;
}

export class StoreWorkspace implements StoreWorkspaceModule {
  private readonly globalDataDir: string | undefined;

  constructor(
    private readonly dependencies: StoreWorkspaceDependencies = productionStoreWorkspaceDependencies,
    options: StoreWorkspaceOptions = {}
  ) {
    this.globalDataDir = options.globalDataDir;
  }

  async plan(input: PrepareChangeWorkspaceInput): Promise<ImmutableWorkspacePlan> {
    const globalDataDir = input.globalDataDir ?? this.globalDataDir;
    const context = await resolveWorkspaceContext(this.dependencies, {
      ...input,
      ...(globalDataDir === undefined ? {} : { globalDataDir }),
      changeId: input.changeId,
    });
    const plan = await buildWorkspacePlan(this.dependencies, {
      ...input,
      ...(globalDataDir === undefined ? {} : { globalDataDir }),
      context,
    });
    // A plan that cannot be applied writes NOTHING, not even under the machine
    // data directory: a preview is a read.
    if (plan.token !== undefined) {
      await this.dependencies
        .coordination(globalDataDir)
        .writeJson(workspacePlanRelativePath(plan.planId), plan);
    }
    return plan;
  }

  async apply(token: WorkspacePlanToken): Promise<PreparedChangeWorkspace> {
    const plan = await this.loadPlan(token);
    const coordination = this.dependencies.coordination(this.globalDataDir);
    return withWorkspaceLocks(coordination, this.preparationLocks(plan.scope, plan.changeId), () =>
      this.applyUnderLocks(plan, token, this.globalDataDir)
    );
  }

  /**
   * Plan and apply in ONE invocation, under one continuous hold of the locks
   * `apply` takes.
   *
   * The two-step path freezes the target line's tip at `plan` time and requires
   * it unchanged at `apply` time, which is correct — but between two CLI
   * invocations sits an operator-sized gap, and on a line under active
   * retention the operator's OWN flow advances the ref inside it. The plan is
   * then born stale, or goes stale before it is used, and the transaction
   * invalidates itself for no reason anyone chose.
   *
   * Under one hold the gap is milliseconds and same-machine workspace
   * operations on this scope are serialized. Nothing is weakened: a mover that
   * does not take these locks — a human commit, a finalization merge — can
   * still move the ref inside the window, and then revalidation refuses stale
   * exactly as before. What changes is that repeating the invocation now
   * CONVERGES, which is what the wedge this change removes used to prevent.
   *
   * The scope is resolved twice on purpose: once outside the hold, because lock
   * keys are made of the scope's permanent identities and nothing else, and
   * again inside it, because everything the plan FREEZES must be read under the
   * lock rather than before it.
   */
  async prepare(input: PrepareChangeWorkspaceInput): Promise<PreparedWorkspaceOutcome> {
    const globalDataDir = input.globalDataDir ?? this.globalDataDir;
    const withDataDir = globalDataDir === undefined ? {} : { globalDataDir };
    const outer = await resolveWorkspaceContext(this.dependencies, {
      ...input,
      ...withDataDir,
      changeId: input.changeId,
    });
    const coordination = this.dependencies.coordination(globalDataDir);
    return withWorkspaceLocks(
      coordination,
      this.preparationLocks(outer.scope, input.changeId),
      async () => {
        const context = await resolveWorkspaceContext(this.dependencies, {
          ...input,
          ...withDataDir,
          changeId: input.changeId,
        });
        const plan = await buildWorkspacePlan(this.dependencies, {
          ...input,
          ...withDataDir,
          context,
        });
        // A preview is a read: a plan that cannot be applied writes nothing,
        // not even under the machine data directory, and carries no token.
        if (plan.token === undefined) return { plan };
        await coordination.writeJson(workspacePlanRelativePath(plan.planId), plan);
        return {
          plan,
          prepared: await this.applyUnderLocks(plan, plan.token, globalDataDir),
        };
      }
    );
  }

  /** The two locks every preparation takes, in acquisition order. */
  private preparationLocks(
    scope: ImmutableWorkspacePlan['scope'],
    changeId: string
  ): readonly WorkspaceLockKey[] {
    return [
      scopeLockKey({
        storeUid: scope.storeUid,
        projectId: scope.projectId,
        targetLineId: scope.targetLineId,
      }),
      workspaceLockKey({ planningScopeId: scope.planningScopeId, changeId }),
    ];
  }

  /** The applied half, shared by `apply` and `prepare`. Assumes the locks. */
  private async applyUnderLocks(
    plan: ImmutableWorkspacePlan,
    token: WorkspacePlanToken,
    globalDataDir: string | undefined
  ): Promise<PreparedChangeWorkspace> {
    const prepared = await applyWorkspacePlan(this.dependencies, plan, token, {
      ...(globalDataDir === undefined ? {} : { globalDataDir }),
    });
    if (plan.changeInstanceId === undefined) return prepared;

    const completed = await completeChangeBinding(
      {
        storeUid: plan.scope.storeUid,
        storeId: plan.scope.storeId,
        projectId: plan.scope.projectId,
        targetLineId: plan.scope.targetLineId,
        planningScopeId: plan.scope.planningScopeId,
        changeId: plan.changeId,
        changeInstanceId: plan.changeInstanceId,
        planningRoot: plan.planning.root,
        ...(globalDataDir === undefined ? {} : { globalDataDir }),
        pathFlavor: plan.pathFlavor,
      },
      this.dependencies
    );
    const {
      changeInstanceId: _preparedChangeInstanceId,
      workspacePairId: _preparedWorkspacePairId,
      ...result
    } = prepared;
    return {
      ...result,
      bindingState: completed.bindingState,
      ...(completed.entry?.changeInstanceId === undefined
        ? {}
        : { changeInstanceId: completed.entry.changeInstanceId }),
      ...(completed.workspacePairId === undefined
        ? {}
        : { workspacePairId: completed.workspacePairId }),
    };
  }

  async describe(input: DescribeWorkspaceInput): Promise<WorkspaceDescription> {
    const globalDataDir = input.globalDataDir ?? this.globalDataDir;
    const flavor = input.pathFlavor ?? 'native';
    const context = await resolveWorkspaceContext(this.dependencies, {
      ...input,
      ...(globalDataDir === undefined ? {} : { globalDataDir }),
    });
    const coordination = this.dependencies.coordination(globalDataDir);
    const all = await listAllWorkspaceIndexEntries(coordination);
    detectBindingAmbiguity(all, flavor);

    const entries = all.filter(
      (entry) => entry.planningScopeId === context.scope.planningScopeId
    );
    const selected = selectDescribedEntry(entries, input, flavor);
    const entry = selected.entry;

    if (entry === null) {
      return {
        scope: context.scope,
        targetLine: context.targetLine,
        bindingState: 'unbound',
        prepared: false,
        findings: [
          selected.undecided.length > 0
            ? {
                code: 'workspace_binding_ambiguous',
                severity: 'warning',
                message: `Project '${context.scope.projectId}' on target line '${context.scope.targetLineId}' has ${selected.undecided.length} prepared workspaces (${selected.undecided
                  .map((candidate) => candidate.changeId)
                  .join(', ')}), and ${input.startPath} is inside none of them. No pair is reported, because reporting one of several would report a different Change than the one asked about. Name one with --change <change-id>, or run from inside its execution worktree.`,
                expected: '1 workspace for this scope',
                actual: `${selected.undecided.length} workspaces`,
              }
            : {
                code: WORKSPACE_NOT_PREPARED_CODE,
                severity: 'info',
                message: `No workspace is prepared for project '${context.scope.projectId}' on target line '${context.scope.targetLineId}'.`,
              },
        ],
      };
    }

    const verification = await verifyIndexEntry(this.dependencies, entry, flavor);
    const bindingState: WorkspaceBindingState = !verification.consistent
      ? 'drifted'
      : entry.workspacePairId === undefined
        ? 'prepared'
        : 'bound';
    return {
      scope: context.scope,
      targetLine: context.targetLine,
      changeId: entry.changeId,
      ...(entry.changeInstanceId === undefined
        ? {}
        : { changeInstanceId: entry.changeInstanceId }),
      ...(entry.workspacePairId === undefined
        ? {}
        : { workspacePairId: entry.workspacePairId }),
      bindingState,
      planning: verification.planning,
      execution: verification.execution,
      prepared: true,
      findings: verification.findings,
    };
  }

  async planCleanup(input: CleanupWorkspaceInput): Promise<ImmutableCleanupPlan> {
    const globalDataDir = input.globalDataDir ?? this.globalDataDir;
    const context = await resolveWorkspaceContext(this.dependencies, {
      ...input,
      ...(globalDataDir === undefined ? {} : { globalDataDir }),
    });
    const coordination = this.dependencies.coordination(globalDataDir);
    const entry = await readWorkspaceIndexEntry(
      coordination,
      context.scope.planningScopeId,
      input.changeId
    );
    const plan = await buildCleanupPlan(this.dependencies, {
      scope: context.scope,
      changeId: input.changeId,
      entry,
      includeUntracked: input.includeUntracked === true,
      integrationRef: context.targetLine.storeRef,
      codeRef: context.targetLine.codeRef ?? context.targetLine.storeRef,
      flavor: input.pathFlavor ?? 'native',
      ...(globalDataDir === undefined ? {} : { globalDataDir }),
    });
    if (plan.token !== undefined) {
      await coordination.writeJson(workspaceCleanupPlanRelativePath(plan.planId), plan);
    }
    return plan;
  }

  async applyCleanup(token: CleanupPlanToken): Promise<CleanupResult> {
    const coordination = this.dependencies.coordination(this.globalDataDir);
    const value = await coordination.readJson(
      workspaceCleanupPlanRelativePath(token.planId)
    );
    if (value === null) {
      throw workspaceError(
        'workspace_plan_missing',
        `No stored cleanup plan matches token ${token.planId}.`,
        {
          target: token.planId,
          fix: 'Re-run the cleanup preview; a plan is machine-local coordination state and is never committed.',
        }
      );
    }
    const plan = value as ImmutableCleanupPlan;
    if (plan.planId !== token.planId || plan.indexFingerprint !== token.indexFingerprint) {
      throw workspaceRefusal(
        'workspace_plan_stale',
        'The stored cleanup plan does not match the supplied token.',
        {
          expected: token.indexFingerprint,
          actual: plan.indexFingerprint,
          target: token.planId,
          fix: 'Re-run the cleanup preview.',
        }
      );
    }
    if (!plan.applicable) throw cleanupGateError(plan);

    const entry = await readWorkspaceIndexEntry(
      coordination,
      plan.scope.planningScopeId,
      plan.changeId
    );
    const locks: WorkspaceLockKey[] = [
      scopeLockKey({
        storeUid: plan.scope.storeUid,
        projectId: plan.scope.projectId,
        targetLineId: plan.scope.targetLineId,
      }),
      entry?.workspacePairId === undefined
        ? workspaceLockKey({
            planningScopeId: plan.scope.planningScopeId,
            changeId: plan.changeId,
          })
        : workspaceLockKey({ workspacePairId: entry.workspacePairId }),
    ];
    return withWorkspaceLocks(coordination, locks, async () =>
      applyCleanupPlan(this.dependencies, plan, {
        ...(this.globalDataDir === undefined ? {} : { globalDataDir: this.globalDataDir }),
      })
    );
  }

  /**
   * The consumer adapter's plan-id entry point. `apply` itself consumes only a
   * token, which is the contract; a CLI user holds a plan ID, so this looks the
   * plan up and hands `apply` the token the plan already froze. It adds no
   * resolution of its own.
   */
  async applyStoredPlan(planId: string): Promise<PreparedChangeWorkspace> {
    const value = await this.dependencies
      .coordination(this.globalDataDir)
      .readJson(workspacePlanRelativePath(planId));
    if (value === null) {
      throw workspaceError('workspace_plan_missing', `No stored plan matches ${planId}.`, {
        target: planId,
        fix: 'Re-run `rasen store workspace plan`; a plan is machine-local and is never committed.',
      });
    }
    const plan = value as ImmutableWorkspacePlan;
    if (plan.token === undefined) {
      throw workspaceError(
        'workspace_plan_not_applicable',
        `The stored plan ${planId} has unsatisfied preconditions and carries no token.`,
        { target: planId, fix: 'Resolve the listed preconditions and re-plan.' }
      );
    }
    return this.apply(plan.token);
  }

  /** The cleanup counterpart of `applyStoredPlan`. */
  async applyStoredCleanupPlan(planId: string): Promise<CleanupResult> {
    const value = await this.dependencies
      .coordination(this.globalDataDir)
      .readJson(workspaceCleanupPlanRelativePath(planId));
    if (value === null) {
      throw workspaceError(
        'workspace_plan_missing',
        `No stored cleanup plan matches ${planId}.`,
        { target: planId, fix: 'Re-run `rasen store workspace cleanup`.' }
      );
    }
    const plan = value as ImmutableCleanupPlan;
    if (plan.token === undefined) throw cleanupGateError(plan);
    return this.applyCleanup(plan.token);
  }

  private async loadPlan(token: WorkspacePlanToken): Promise<ImmutableWorkspacePlan> {
    const value = await this.dependencies
      .coordination(this.globalDataDir)
      .readJson(workspacePlanRelativePath(token.planId));
    if (value === null) {
      throw workspaceError(
        'workspace_plan_missing',
        `No stored plan matches token ${token.planId}.`,
        {
          target: token.planId,
          fix: 'Re-run `rasen store workspace plan`; a plan is machine-local coordination state and is never committed.',
        }
      );
    }
    const plan = value as ImmutableWorkspacePlan;
    if (plan.planId !== token.planId) {
      throw workspaceRefusal('workspace_plan_stale', 'The stored plan does not match the supplied token.', {
        expected: token.planId,
        actual: plan.planId,
        target: token.planId,
        fix: 'Re-run `rasen store workspace plan`.',
      });
    }
    if (!plan.applicable || plan.token === undefined) {
      throw workspaceError(
        'workspace_plan_not_applicable',
        `The stored plan for Change '${plan.changeId}' has ${plan.blockers.length} unsatisfied precondition(s) and cannot be applied.`,
        {
          target: plan.planId,
          fix: plan.blockers.map((blocker) => `${blocker.id}: ${blocker.detail}`).join(' | '),
        }
      );
    }
    return plan;
  }
}

// -----------------------------------------------------------------------------
// The seam the planning resolver consumes
// -----------------------------------------------------------------------------

export interface PlanningWorktreeProbeInput {
  readonly planningRoot: string;
  /**
   * The target line's Store ref, which must resolve in this repository. Omit it
   * to probe identity alone, which is what a frozen session pair needs.
   */
  readonly storeRef?: string;
  readonly pathFlavor?: StorePlanningPathFlavor;
}

export interface PlanningWorktreeProbeResult {
  readonly isWorktree: boolean;
  readonly linked: boolean;
  readonly worktreeInstanceId?: string;
  readonly storeRefOid?: string;
  readonly ref?: string;
  readonly headOid?: string;
}

/**
 * The evidence the scope resolver's `planningWorktreeVerified` consumes instead
 * of "a marker file exists".
 *
 * It answers exactly three questions and answers them from live Git: is this
 * root a worktree at all, is it a LINKED one (the integration checkout is never
 * authorized), and does the target line's Store ref resolve to a commit here.
 * Everything else the verification needs — that the marker declares the
 * resolved Store, project, and target line — the resolver already has in hand.
 */
export async function probePlanningWorktree(
  input: PlanningWorktreeProbeInput,
  dependencies: StoreWorkspaceDependencies = productionStoreWorkspaceDependencies
): Promise<PlanningWorktreeProbeResult> {
  const flavor = input.pathFlavor ?? 'native';
  let identity: Awaited<ReturnType<typeof deriveWorktreeIdentity>> = null;
  try {
    identity = await deriveWorktreeIdentity(dependencies, input.planningRoot, flavor);
  } catch {
    // An uncanonicalizable identity input fails CLOSED: no identity, so the
    // worktree cannot be verified and the mutation is refused.
    return { isWorktree: false, linked: false };
  }
  if (identity === null) return { isWorktree: false, linked: false };
  const linked = await isLinkedWorktree(dependencies, input.planningRoot, flavor);
  const targets =
    input.storeRef === undefined
      ? []
      : await dependencies.git.resolveRef(input.planningRoot, input.storeRef);
  const resolved =
    targets.length === 1 && targets[0]?.objectType === 'commit' ? targets[0] : undefined;
  const ref = await dependencies.git.checkedOutRef(input.planningRoot);
  const headOid = await dependencies.git.headOid(input.planningRoot);
  return {
    isWorktree: true,
    linked: linked === true,
    worktreeInstanceId: identity.worktreeInstanceId,
    ...(resolved === undefined ? {} : { storeRefOid: resolved.oid }),
    ...(ref === null ? {} : { ref }),
    ...(headOid === null ? {} : { headOid }),
  };
}

export interface FrozenWorktreeFacts {
  readonly root: string;
  readonly worktreeInstanceId: string;
  readonly ref?: string;
  readonly headOid?: string;
}

export interface FrozenWorkspacePairFacts {
  readonly planning?: FrozenWorktreeFacts;
  readonly execution?: FrozenWorktreeFacts;
  readonly changeInstanceId?: string;
  readonly workspacePairId?: string;
}

/**
 * The pair a session freezes at start.
 *
 * Only a pair whose every recorded field still re-derives from live Git is
 * frozen. A drifted one is deliberately NOT frozen: freezing it would hand the
 * session a locator it must then refuse on at every command, whereas absence is
 * an explicit state that a mutation needing the pair refuses on directly, and
 * `rasen context` still reports the drift.
 */
export async function resolveFrozenWorkspacePair(
  input: {
    readonly storeUid?: string;
    readonly projectId?: string;
    readonly targetLineId?: string;
    readonly executionRoot?: string;
    readonly globalDataDir?: string;
    readonly pathFlavor?: StorePlanningPathFlavor;
  },
  dependencies: StoreWorkspaceDependencies = productionStoreWorkspaceDependencies
): Promise<FrozenWorkspacePairFacts | undefined> {
  if (
    input.storeUid === undefined ||
    input.projectId === undefined ||
    input.targetLineId === undefined
  ) {
    return undefined;
  }
  const flavor = input.pathFlavor ?? 'native';
  const planningScopeId = derivePlanningScopeId({
    storeUid: input.storeUid,
    projectId: input.projectId,
    targetLineId: input.targetLineId,
  });
  const coordination = dependencies.coordination(input.globalDataDir);
  const document = await readWorkspaceIndexDocument(coordination, planningScopeId);
  const candidates =
    input.executionRoot === undefined
      ? document.entries
      : document.entries.filter((entry) =>
          samePath(entry.execution.root, input.executionRoot as string, flavor)
        );
  if (candidates.length !== 1) return undefined;
  const entry = candidates[0] as WorkspaceIndexEntry;
  const verification = await verifyIndexEntry(dependencies, entry, flavor);
  if (!verification.consistent) return undefined;

  const side = (facts: typeof verification.planning): FrozenWorktreeFacts | undefined =>
    facts.worktreeInstanceId === undefined
      ? undefined
      : {
          root: facts.root,
          worktreeInstanceId: facts.worktreeInstanceId,
          ...(facts.ref === undefined ? {} : { ref: facts.ref }),
          ...(facts.headOid === undefined ? {} : { headOid: facts.headOid }),
        };

  const planning = side(verification.planning);
  const execution = side(verification.execution);
  if (planning === undefined && execution === undefined) return undefined;
  return {
    ...(planning === undefined ? {} : { planning }),
    ...(execution === undefined ? {} : { execution }),
    ...(entry.changeInstanceId === undefined
      ? {}
      : { changeInstanceId: entry.changeInstanceId }),
    ...(entry.workspacePairId === undefined
      ? {}
      : { workspacePairId: entry.workspacePairId }),
  };
}

export interface ChangeBindingInput {
  readonly storeUid: string;
  readonly storeId: string;
  readonly projectId: string;
  readonly targetLineId: string;
  readonly planningScopeId: string;
  readonly changeId: string;
  readonly planningRoot: string;
  readonly globalDataDir?: string;
  readonly pathFlavor?: StorePlanningPathFlavor;
}

/**
 * Refuses a SECOND Change in one planning worktree, decided from the RECORDED
 * binding rather than from a directory scan of the planning tree. Called before
 * any Change directory is created.
 */
export async function assertPlanningWorktreeUnbound(
  input: ChangeBindingInput,
  dependencies: StoreWorkspaceDependencies = productionStoreWorkspaceDependencies
): Promise<WorkspaceIndexEntry | null> {
  const flavor = input.pathFlavor ?? 'native';
  const coordination = dependencies.coordination(input.globalDataDir);
  const all = await listAllWorkspaceIndexEntries(coordination);
  detectBindingAmbiguity(all, flavor);

  let own: WorkspaceIndexEntry | null = null;
  for (const entry of all) {
    if (entry.planning.root.length === 0) continue;
    if (!samePath(entry.planning.root, input.planningRoot, flavor)) continue;
    if (entry.changeId === input.changeId) {
      own = entry;
      continue;
    }
    if (entry.changeInstanceId === undefined) continue;
    throw workspaceRefusal(
      'workspace_already_bound',
      `Planning worktree ${input.planningRoot} already carries Change '${entry.changeId}'.`,
      {
        expected: entry.changeId,
        actual: input.changeId,
        target: input.planningRoot,
        fix: "Prepare a second planning worktree with 'rasen store workspace plan' for the second Change; one planning worktree carries exactly one active Change.",
      }
    );
  }
  return own;
}

export interface CompleteChangeBindingInput extends ChangeBindingInput {
  readonly changeInstanceId: string;
}

export interface CompletedChangeBinding {
  readonly bindingState: WorkspaceBindingState;
  readonly entry: WorkspaceIndexEntry | null;
  readonly workspacePairId?: string;
  readonly findings: readonly WorkspaceVerificationFinding[];
}

/**
 * Completes the binding after `createChange` mints the instance.
 *
 * When a pair was prepared, both worktree instance ids are recorded and the
 * `WorkspacePairId` completes, moving the workspace from PREPARED to BOUND.
 * When the pair was assembled by hand, the index entry is REPAIRED from the
 * marker and live Git — writing no fact that is not already true on disk — and
 * the pair id completes only if an execution worktree is actually known. A
 * planning-only creation records the Change instance and says so, rather than
 * inventing an execution side.
 */
export async function completeChangeBinding(
  input: CompleteChangeBindingInput,
  dependencies: StoreWorkspaceDependencies = productionStoreWorkspaceDependencies
): Promise<CompletedChangeBinding> {
  const flavor = input.pathFlavor ?? 'native';
  const coordination = dependencies.coordination(input.globalDataDir);
  const findings: WorkspaceVerificationFinding[] = [];
  const existing = await readWorkspaceIndexEntry(
    coordination,
    input.planningScopeId,
    input.changeId
  );

  const planningFacts = await surveyWorktree(dependencies, {
    side: 'planning',
    root: input.planningRoot,
    repositoryRoot: input.planningRoot,
    flavor,
  });
  if (planningFacts.worktreeInstanceId === undefined) {
    findings.push({
      code: 'workspace_planning_identity_unavailable',
      severity: 'warning',
      message: `Planning worktree ${input.planningRoot} has no derivable worktree identity, so no binding was recorded.`,
    });
    return { bindingState: 'unbound', entry: null, findings };
  }

  // The marker is this worktree's declared scope; a marker naming another Store,
  // project, or line than the Change's committed identity is a conflict.
  //
  // The comparison is the SHARED one (`assertCarrierAgreesWithScope`), not a
  // second implementation of the same rule: `storeUid` is an orthogonal
  // dimension from `projectId` and `targetLineId` and `projectId` is portable,
  // so a marker written for another Store with the same project and line is a
  // real conflict that a two-field comparison waves through. That the resolver
  // happens to check `storeUid` first today makes this defense in depth, not
  // redundancy — this is the layer the capability names.
  const markerPath = planningMarkerPath(input.planningRoot, flavor);
  const marker = await readBindingFact(dependencies, markerPath);
  if (marker !== null) {
    assertCarrierAgreesWithScope(
      marker.fact,
      {
        storeUid: input.storeUid,
        projectId: input.projectId,
        targetLineId: input.targetLineId,
      },
      markerPath
    );
  }

  const executionRoot =
    existing?.execution.root !== undefined && existing.execution.root.length > 0
      ? existing.execution.root
      : marker?.fact.executionRoot;
  const executionFacts =
    executionRoot === undefined
      ? null
      : await surveyWorktree(dependencies, {
          side: 'execution',
          root: executionRoot,
          repositoryRoot: executionRoot,
          flavor,
        });

  let workspacePairId: string | undefined;
  if (executionFacts?.worktreeInstanceId !== undefined) {
    workspacePairId = deriveWorkspacePairId({
      changeInstanceId: parseChangeInstanceId(input.changeInstanceId),
      planningWorktreeInstanceId: parseWorktreeInstanceId(planningFacts.worktreeInstanceId),
      executionWorktreeInstanceId: parseWorktreeInstanceId(executionFacts.worktreeInstanceId),
    });
  } else {
    findings.push({
      code: 'workspace_execution_side_unknown',
      severity: 'info',
      message:
        'No execution worktree is recorded for this pair, so the workspace pair identity stays incomplete. The Change instance is recorded either way.',
    });
  }

  const at = dependencies.now().toISOString();
  const entry: WorkspaceIndexEntry = {
    version: 1,
    planningScopeId: input.planningScopeId,
    storeUid: input.storeUid,
    storeId: input.storeId,
    projectId: input.projectId,
    targetLineId: input.targetLineId,
    changeId: input.changeId,
    changeInstanceId: input.changeInstanceId,
    ...(workspacePairId === undefined ? {} : { workspacePairId }),
    planning: {
      root: planningFacts.root,
      repositoryIdentity: planningFacts.repositoryIdentity ?? '',
      worktreeInstanceId: planningFacts.worktreeInstanceId,
      ref: planningFacts.ref ?? '',
      headOid: planningFacts.headOid ?? '',
    },
    execution: {
      root: executionFacts?.root ?? '',
      repositoryIdentity: executionFacts?.repositoryIdentity ?? '',
      worktreeInstanceId: executionFacts?.worktreeInstanceId ?? '',
      ref: executionFacts?.ref ?? '',
      headOid: executionFacts?.headOid ?? '',
    },
    planId: existing?.planId ?? '',
    phase: workspacePairId === undefined ? 'prepared' : 'bound',
    recordedAt: existing?.recordedAt ?? at,
    updatedAt: at,
  };
  await writeWorkspaceIndexEntry(coordination, entry);
  return {
    bindingState: workspacePairId === undefined ? 'prepared' : 'bound',
    entry,
    ...(workspacePairId === undefined ? {} : { workspacePairId }),
    findings,
  };
}

/** The production Module instance. */
export const StoreWorkspaceModuleInstance = new StoreWorkspace();
