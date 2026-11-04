/**
 * Safe cleanup: plan, then apply, and the refusals are the point.
 *
 * A worktree is removable only when EVERY one of these holds, and the plan
 * lists each as satisfied or unsatisfied with its values:
 *
 *   1. it is one of the two roots the pair recorded, and it re-derives the
 *      recorded worktree instance id;
 *   2. it is a linked worktree, never the repository's main checkout;
 *   3. its checked-out ref is the ref the pair recorded;
 *   4. it has no tracked modifications and no staged changes;
 *   5. it has no untracked files, unless `--include-untracked` accepts the ones
 *      the plan listed;
 *   6. every commit on its branch is reachable from the recorded Store
 *      integration ref (planning side) or target code ref (execution side);
 *   7. no live session context references it;
 *   8. no scope or workspace lock is held elsewhere.
 *
 * Anything unsatisfied is `workspace_cleanup_unsafe`. There is no `--force` and
 * no partial removal. Cleanup never deletes a branch or any ref, never merges
 * or rebases to satisfy reachability, and never touches the Store integration
 * checkout, the code repository's main checkout, the Change directory, the
 * project partition, the Archive, or another pair's state. This pair's index
 * entry is removed LAST, after both worktrees are gone, so an interrupted
 * cleanup resumes from the recorded phase rather than concluding "already gone"
 * from an absent directory.
 */
import { createHash } from 'node:crypto';
import * as nodePath from 'node:path';

import { canonicalBytes } from '../../canonical-json.js';
import { getGlobalDataDir } from '../../global-config.js';
import type { StorePlanningPathFlavor } from '../planning-layout-v2.js';
import {
  EXECUTION_ASSOCIATION_FILE_NAME,
  PLANNING_MARKER_FILE_NAME,
  RUN_STATE_DIR_NAME,
  surveyWorktree,
} from './binding.js';
import type {
  StoreWorkspaceDependencies,
  WorkspaceCoordination,
} from './dependencies.js';
import { workspaceRefusal } from './diagnostics.js';
import { isContainedIn, pathApiFor, samePath } from './identity.js';
import {
  lockIsHeld,
  scopeLockKey,
  workspaceLockKey,
  workspaceLockPath,
  type WorkspaceLockKey,
} from './locks.js';
import {
  currentWorkspaceIndexFingerprint,
  readWorkspaceIndexEntry,
  removeWorkspaceIndexEntry,
  writeWorkspaceIndexEntry,
  type WorkspaceIndexEntry,
} from './registry.js';
import { repositoryMainCheckout } from './scope.js';
import type {
  CleanupPhase,
  CleanupPlanToken,
  CleanupResult,
  CleanupTarget,
  ImmutableCleanupPlan,
  WorkspacePrecondition,
  WorkspaceScope,
  WorkspaceSide,
} from './types.js';

const SESSIONS_DIR_NAME = 'sessions';
const SESSION_CONTEXT_FILE_NAME = 'context.json';

/** A lock that is currently held, named by BOTH its label and its file. */
interface HeldLock {
  readonly label: string;
  readonly path: string;
}

/** The eight preconditions this module lists for every cleanup target. */
export const PRECONDITIONS_PER_TARGET = 8;

function precondition(
  id: string,
  satisfied: boolean,
  detail: string,
  extra: { readonly expected?: string; readonly actual?: string } = {}
): WorkspacePrecondition {
  return {
    id,
    satisfied,
    detail,
    ...(extra.expected === undefined ? {} : { expected: extra.expected }),
    ...(extra.actual === undefined ? {} : { actual: extra.actual }),
    code: 'workspace_cleanup_unsafe',
  };
}

/**
 * Worktree roots any live session context still names. Read-only, and a
 * context file that cannot be read counts as REFERENCING everything: a session
 * we cannot inspect is not a session we may assume is gone.
 *
 * An OMITTED machine root means the real machine root, never "no sessions
 * exist" — the coordination adapter already resolves its default the same way
 * (`dependencies.ts`: `globalDataDir ?? getGlobalDataDir()`). The CLI
 * constructs `new StoreWorkspace()` with no options and calls `planCleanup`
 * with no `globalDataDir`, so an early return here would make precondition 7
 * inert on the one path that matters, and "satisfied" is the wrong default for
 * a fail-closed gate.
 */
export async function sessionReferencedRoots(
  dependencies: StoreWorkspaceDependencies,
  globalDataDir: string | undefined
): Promise<{ readonly roots: readonly string[]; readonly unreadable: readonly string[] }> {
  const sessionsDir = nodePath.join(globalDataDir ?? getGlobalDataDir(), SESSIONS_DIR_NAME);
  const roots: string[] = [];
  const unreadable: string[] = [];
  for (const name of await dependencies.fs.listNames(sessionsDir)) {
    const contextPath = nodePath.join(sessionsDir, name, SESSION_CONTEXT_FILE_NAME);
    const text = await dependencies.fs.readText(contextPath);
    if (text === null) continue;
    try {
      const parsed = JSON.parse(text) as {
        planning?: { root?: string; worktree?: { root?: string } };
        execution?: { root?: string; worktree?: { root?: string } };
      };
      for (const candidate of [
        parsed.planning?.root,
        parsed.planning?.worktree?.root,
        parsed.execution?.root,
        parsed.execution?.worktree?.root,
      ]) {
        if (typeof candidate === 'string' && candidate.length > 0) roots.push(candidate);
      }
    } catch {
      unreadable.push(contextPath);
    }
  }
  return { roots, unreadable };
}

export interface BuildCleanupPlanInput {
  readonly scope: WorkspaceScope;
  readonly changeId: string;
  readonly entry: WorkspaceIndexEntry | null;
  readonly includeUntracked: boolean;
  readonly integrationRef: string;
  readonly codeRef: string;
  readonly flavor: StorePlanningPathFlavor;
  readonly globalDataDir?: string;
}

export async function buildCleanupPlan(
  dependencies: StoreWorkspaceDependencies,
  input: BuildCleanupPlanInput
): Promise<ImmutableCleanupPlan> {
  const coordination = dependencies.coordination(input.globalDataDir);
  const createdAt = dependencies.now().toISOString();

  if (input.entry === null) {
    const blocker = precondition(
      'pair-recorded',
      false,
      `No workspace is recorded for Change '${input.changeId}' in this scope, so there is no pair whose roots cleanup may remove.`,
      { expected: 'a recorded pair', actual: '(none)' }
    );
    return {
      planId: createHash('sha256')
        .update(canonicalBytes({ scope: input.scope, changeId: input.changeId, createdAt }))
        .digest('hex'),
      schemaVersion: 1,
      createdAt,
      scope: input.scope,
      changeId: input.changeId,
      targets: [],
      indexFingerprint: await currentWorkspaceIndexFingerprint(
        coordination,
        input.scope.planningScopeId,
        input.changeId
      ),
      includeUntracked: input.includeUntracked,
      applicable: false,
      blockers: [blocker],
    };
  }

  const entry = input.entry;
  const sessions = await sessionReferencedRoots(dependencies, input.globalDataDir);
  const lockKeys: readonly WorkspaceLockKey[] = [
    scopeLockKey({
      storeUid: input.scope.storeUid,
      projectId: input.scope.projectId,
      targetLineId: input.scope.targetLineId,
    }),
    entry.workspacePairId === undefined
      ? workspaceLockKey({
          planningScopeId: input.scope.planningScopeId,
          changeId: input.changeId,
        })
      : workspaceLockKey({ workspacePairId: entry.workspacePairId }),
  ];
  // The refusal names the FILE as well as the label. A lock filename is a
  // sha256 of the key material, so a user told only "scope app-a@line-0.2" is
  // told to resolve a precondition without being told where it lives; the
  // acquire path's diagnostic already names `info.lockPath`.
  const heldLocks: HeldLock[] = [];
  for (const key of lockKeys) {
    if (await lockIsHeld(coordination, key)) {
      heldLocks.push({ label: key.label, path: workspaceLockPath(coordination, key) });
    }
  }

  const targets: CleanupTarget[] = [];
  for (const side of ['execution', 'planning'] as const) {
    targets.push(
      await buildCleanupTarget(dependencies, {
        side,
        entry,
        includeUntracked: input.includeUntracked,
        reachableFrom: side === 'planning' ? input.integrationRef : input.codeRef,
        sessions,
        heldLocks,
        flavor: input.flavor,
      })
    );
  }

  const blockers = targets.flatMap((target) =>
    target.preconditions.filter((entry_) => !entry_.satisfied)
  );
  const applicable = blockers.length === 0;
  const indexFingerprint = await currentWorkspaceIndexFingerprint(
    coordination,
    input.scope.planningScopeId,
    input.changeId
  );
  const body = {
    schemaVersion: 1 as const,
    scope: input.scope,
    changeId: input.changeId,
    targets,
    indexFingerprint,
    includeUntracked: input.includeUntracked,
    applicable,
    blockers,
  };
  // Same rule as the workspace plan: the wall clock is recorded beside the id,
  // never inside it, so re-previewing an unchanged pair is the same plan.
  const planId = createHash('sha256').update(canonicalBytes(body)).digest('hex');
  return {
    planId,
    createdAt,
    ...body,
    ...(applicable
      ? {
          token: {
            planId,
            storeUid: input.scope.storeUid,
            projectId: input.scope.projectId,
            targetLineId: input.scope.targetLineId,
            changeId: input.changeId,
            indexFingerprint,
          },
        }
      : {}),
  };
}

async function buildCleanupTarget(
  dependencies: StoreWorkspaceDependencies,
  input: {
    readonly side: WorkspaceSide;
    readonly entry: WorkspaceIndexEntry;
    readonly includeUntracked: boolean;
    readonly reachableFrom: string;
    readonly sessions: { readonly roots: readonly string[]; readonly unreadable: readonly string[] };
    readonly heldLocks: readonly HeldLock[];
    readonly flavor: StorePlanningPathFlavor;
  }
): Promise<CleanupTarget> {
  const recorded = input.side === 'planning' ? input.entry.planning : input.entry.execution;
  const preconditions: WorkspacePrecondition[] = [];
  const facts = await surveyWorktree(dependencies, {
    side: input.side,
    root: recorded.root,
    repositoryRoot: recorded.root,
    flavor: input.flavor,
  });

  const identityMatches =
    facts.exists && facts.worktreeInstanceId === recorded.worktreeInstanceId;
  preconditions.push(
    precondition(
      `${input.side}-1-recorded-root-and-identity`,
      identityMatches,
      identityMatches
        ? `${recorded.root} is the recorded ${input.side} worktree and re-derives its recorded instance id.`
        : `${recorded.root} does not re-derive the recorded ${input.side} worktree instance id.`,
      identityMatches
        ? {}
        : {
            expected: recorded.worktreeInstanceId,
            actual: facts.worktreeInstanceId ?? '(absent)',
          }
    )
  );

  const linked = facts.linked === true;
  preconditions.push(
    precondition(
      `${input.side}-2-linked-worktree`,
      linked,
      linked
        ? `${recorded.root} is a linked worktree.`
        : `${recorded.root} is the repository's main checkout, which cleanup never removes.`,
      linked ? {} : { expected: 'a linked worktree', actual: 'the main checkout' }
    )
  );

  const refMatches = facts.ref === recorded.ref;
  preconditions.push(
    precondition(
      `${input.side}-3-recorded-ref`,
      refMatches,
      refMatches
        ? `${recorded.root} is on the recorded ref ${recorded.ref}.`
        : `${recorded.root} is on another ref than the pair recorded.`,
      refMatches ? {} : { expected: recorded.ref, actual: facts.ref ?? '(detached HEAD)' }
    )
  );

  const dirty = facts.exists ? await dependencies.git.dirtyEntries(recorded.root) : [];
  preconditions.push(
    precondition(
      `${input.side}-4-clean-tree`,
      dirty.length === 0,
      dirty.length === 0
        ? `${recorded.root} has no tracked modifications and no staged changes.`
        : `${recorded.root} has ${dirty.length} tracked modification(s) or staged change(s): ${dirty
            .map((change) => change.path)
            .join(', ')}.`,
      dirty.length === 0 ? {} : { expected: '0 modified files', actual: String(dirty.length) }
    )
  );

  // The marker and the association are documents THIS Module wrote under
  // `.rasen/`, which the portfolio never commits. Precondition 5 exists to
  // protect the user's untracked work; counting Rasen's own run state would
  // make every pair this Module prepares permanently un-removable without
  // `--include-untracked`, which would then be required for the normal case.
  const ownRunStateRelative =
    input.side === 'planning'
      ? `${RUN_STATE_DIR_NAME}/${PLANNING_MARKER_FILE_NAME}`
      : `${RUN_STATE_DIR_NAME}/${EXECUTION_ASSOCIATION_FILE_NAME}`;
  const allUntracked = facts.exists
    ? await dependencies.git.untrackedFiles(recorded.root)
    : [];
  const ownRunState = allUntracked.filter((entry) => entry === ownRunStateRelative);
  const untracked = allUntracked.filter((entry) => entry !== ownRunStateRelative);
  const untrackedAccepted = untracked.length === 0 || input.includeUntracked;
  preconditions.push(
    precondition(
      `${input.side}-5-untracked-accepted`,
      untrackedAccepted,
      untracked.length === 0
        ? `${recorded.root} has no untracked files.`
        : input.includeUntracked
          ? `${untracked.length} untracked file(s) in ${recorded.root} were listed and explicitly accepted.`
          : `${recorded.root} has ${untracked.length} untracked file(s) Git cannot restore: ${untracked
              .slice(0, 10)
              .join(', ')}.`,
      untrackedAccepted
        ? {}
        : { expected: '0 untracked files, or --include-untracked', actual: String(untracked.length) }
    )
  );

  let reachable = false;
  if (facts.exists && facts.headOid !== undefined) {
    reachable = await dependencies.git.isAncestor(
      recorded.root,
      facts.headOid,
      input.reachableFrom
    );
  }
  preconditions.push(
    precondition(
      `${input.side}-6-reachable-from-recorded-ref`,
      reachable,
      reachable
        ? `Every commit on ${recorded.ref} is reachable from ${input.reachableFrom}.`
        : `${recorded.ref} has commits that are not reachable from ${input.reachableFrom}; removing the worktree would lose them. Cleanup never merges or rebases to satisfy this.`,
      reachable
        ? {}
        : { expected: `an ancestor of ${input.reachableFrom}`, actual: facts.headOid ?? '(unknown)' }
    )
  );

  const referencedBySession =
    input.sessions.unreadable.length > 0 ||
    input.sessions.roots.some((root) => samePath(root, recorded.root, input.flavor));
  preconditions.push(
    precondition(
      `${input.side}-7-no-live-session`,
      !referencedBySession,
      referencedBySession
        ? input.sessions.unreadable.length > 0
          ? `A session context could not be read (${input.sessions.unreadable.join(', ')}), so no session can be proven finished.`
          : `A live session context still references ${recorded.root}.`
        : `No live session context references ${recorded.root}.`,
      referencedBySession ? { expected: 'no live session', actual: recorded.root } : {}
    )
  );

  preconditions.push(
    precondition(
      `${input.side}-8-no-lock-held`,
      input.heldLocks.length === 0,
      input.heldLocks.length === 0
        ? 'No scope or workspace lock is held for this pair.'
        : `A lock is held elsewhere: ${describeHeldLocks(input.heldLocks)}.`,
      input.heldLocks.length === 0
        ? {}
        : { expected: 'no held lock', actual: describeHeldLocks(input.heldLocks) }
    )
  );

  // Resolved WHILE the worktree still exists: a side deleted by hand between
  // preview and apply can no longer answer for its own repository, and the
  // prune that removal is recorded as having done runs from here.
  const mainCheckout = facts.exists
    ? await repositoryMainCheckout(dependencies, recorded.root)
    : null;

  return {
    side: input.side,
    root: recorded.root,
    repositoryRoot: recorded.root,
    ref: recorded.ref,
    reachableFrom: input.reachableFrom,
    ...(mainCheckout === null ? {} : { mainCheckout }),
    preconditions,
    untracked,
    ownRunState,
    removable: preconditions.every((entry) => entry.satisfied),
  };
}

function describeHeldLocks(locks: readonly HeldLock[]): string {
  return locks.map((lock) => `${lock.label} (${lock.path})`).join(', ');
}

export function cleanupGateError(plan: ImmutableCleanupPlan): Error {
  const failed = plan.blockers
    .map((blocker) => `${blocker.id}: ${blocker.detail}`)
    .join('\n  ');
  return workspaceRefusal(
    'workspace_cleanup_unsafe',
    `Cleanup for Change '${plan.changeId}' cannot be proven lossless:\n  ${failed}`,
    {
      // The total is a constant `targets.length * 8`. Adding the blocker count
      // made the "expected" figure GROW with the number of failures, so it
      // matched neither the real total nor anything else the user could check.
      expected:
        plan.targets.length === 0
          ? 'a recorded pair'
          : `${plan.targets.length * PRECONDITIONS_PER_TARGET} preconditions satisfied`,
      actual: `${plan.blockers.length} unsatisfied`,
      target: plan.changeId,
      fix: 'Resolve each listed precondition. There is no --force and no partial removal.',
    }
  );
}

const PHASE_ORDER: readonly CleanupPhase[] = Object.freeze([
  'planned',
  'removing-execution',
  'removed-execution',
  'removing-planning',
  'removed-planning',
  'pruned',
  'complete',
]);

function phaseReached(entry: WorkspaceIndexEntry, phase: CleanupPhase): boolean {
  const current = PHASE_ORDER.indexOf(entry.phase as CleanupPhase);
  return current >= PHASE_ORDER.indexOf(phase);
}

/**
 * Re-runs, BEFORE the first removal, the two preconditions a stored plan can
 * no longer vouch for.
 *
 * `applyCleanupPlan` already re-checks each worktree's instance id and the
 * main-checkout guard, and `git worktree remove` backstops a dirty or untracked
 * tree. Reachability has no such backstop: the user can commit on the planning
 * branch between preview and apply, and removing the worktree then removes the
 * only checkout of work that is not reachable from the integration ref. The
 * index fingerprint has the same problem — `module.ts` compares the token to
 * the STORED PLAN, which is the same document, so that comparison is
 * self-satisfying and a concurrent sibling preparation goes unnoticed.
 *
 * Both run as a PRE-PASS over every target, never interleaved with removal:
 * a refusal discovered after the execution side is gone would be exactly the
 * partial removal this capability forbids.
 */
async function revalidateBeforeRemoval(
  dependencies: StoreWorkspaceDependencies,
  coordination: WorkspaceCoordination,
  plan: ImmutableCleanupPlan,
  entry: WorkspaceIndexEntry
): Promise<void> {
  const fingerprint = await currentWorkspaceIndexFingerprint(
    coordination,
    plan.scope.planningScopeId,
    plan.changeId
  );
  if (fingerprint !== plan.indexFingerprint) {
    throw workspaceRefusal(
      'workspace_plan_stale',
      'The workspace index changed after this cleanup was previewed, so the plan no longer describes what is recorded.',
      {
        expected: plan.indexFingerprint,
        actual: fingerprint,
        target: plan.planId,
        fix: 'Re-run the cleanup preview.',
      }
    );
  }

  for (const target of plan.targets) {
    const removedPhase: CleanupPhase =
      target.side === 'execution' ? 'removed-execution' : 'removed-planning';
    if (phaseReached(entry, removedPhase)) continue;
    const recorded = target.side === 'planning' ? entry.planning : entry.execution;
    const facts = await surveyWorktree(dependencies, {
      side: target.side,
      root: recorded.root,
      repositoryRoot: recorded.root,
      flavor: 'native',
    });
    if (!facts.exists || facts.headOid === undefined) continue;
    const reachable = await dependencies.git.isAncestor(
      recorded.root,
      facts.headOid,
      target.reachableFrom
    );
    if (reachable) continue;
    throw workspaceRefusal(
      'workspace_cleanup_unsafe',
      `${recorded.ref} has commits that are not reachable from ${target.reachableFrom}; removing the worktree would lose them. Cleanup never merges or rebases to satisfy this.`,
      {
        expected: `an ancestor of ${target.reachableFrom}`,
        actual: facts.headOid,
        target: recorded.root,
        fix: 'Integrate the work, then re-run the cleanup preview. There is no --force and no partial removal.',
      }
    );
  }
}

export async function applyCleanupPlan(
  dependencies: StoreWorkspaceDependencies,
  plan: ImmutableCleanupPlan,
  options: { readonly globalDataDir?: string } = {}
): Promise<CleanupResult> {
  const coordination = dependencies.coordination(options.globalDataDir);
  const entry = await readWorkspaceIndexEntry(
    coordination,
    plan.scope.planningScopeId,
    plan.changeId
  );
  if (entry === null) {
    return {
      planId: plan.planId,
      scope: plan.scope,
      changeId: plan.changeId,
      phase: 'complete',
      removed: [],
      indexEntryRemoved: false,
    };
  }

  await revalidateBeforeRemoval(dependencies, coordination, plan, entry);

  const removed: string[] = [];
  // `git worktree remove` is run from the repository's MAIN checkout, never
  // from inside the worktree being removed, and the same roots drive the prune
  // afterwards — by then the worktree directories are gone.
  const mainCheckouts = new Map<WorkspaceSide, string>();
  let current = entry;
  const advance = async (phase: CleanupPhase): Promise<void> => {
    current = { ...current, phase, updatedAt: dependencies.now().toISOString() };
    await writeWorkspaceIndexEntry(coordination, current);
  };

  for (const target of plan.targets) {
    const removingPhase: CleanupPhase =
      target.side === 'execution' ? 'removing-execution' : 'removing-planning';
    const removedPhase: CleanupPhase =
      target.side === 'execution' ? 'removed-execution' : 'removed-planning';
    if (phaseReached(current, removedPhase)) continue;

    await advance(removingPhase);
    const recorded = target.side === 'planning' ? current.planning : current.execution;
    const facts = await surveyWorktree(dependencies, {
      side: target.side,
      root: recorded.root,
      repositoryRoot: recorded.root,
      flavor: 'native',
    });
    if (!facts.exists) {
      // The directory is gone, but "already gone" is concluded from the
      // RECORDED PHASE, never from an absent directory alone; reaching here
      // means the phase said otherwise, so the removal is still driven through
      // `worktree prune` below rather than assumed complete. That requires the
      // repository the plan FROZE, because a deleted directory can no longer
      // answer for its own repository — without it the prune loop would iterate
      // an empty entry for this side, leaving Git listing a prunable worktree
      // at a path that does not exist while the index recorded `pruned`.
      if (target.mainCheckout !== undefined) {
        mainCheckouts.set(target.side, target.mainCheckout);
      }
      await advance(removedPhase);
      continue;
    }
    if (facts.worktreeInstanceId !== recorded.worktreeInstanceId) {
      throw workspaceRefusal(
        'workspace_cleanup_unsafe',
        `${recorded.root} no longer re-derives the recorded ${target.side} worktree instance id, so it is not the worktree this pair recorded.`,
        {
          expected: recorded.worktreeInstanceId,
          actual: facts.worktreeInstanceId ?? '(absent)',
          target: recorded.root,
          fix: 'Re-plan the cleanup; the recorded pair no longer matches what is on disk.',
        }
      );
    }
    // `git worktree remove` refuses a tree with untracked files and this Module
    // may never pass `--force`, so the files the plan listed are removed first:
    // this pair's own binding document always, and the user's untracked files
    // only when `--include-untracked` accepted the list the plan printed. Each
    // path is re-checked as still untracked and still inside the recorded root.
    const removable = [
      ...target.ownRunState,
      ...(plan.includeUntracked ? target.untracked : []),
    ];
    if (removable.length > 0) {
      const stillUntracked = new Set(await dependencies.git.untrackedFiles(recorded.root));
      for (const relative of removable) {
        if (!stillUntracked.has(relative)) continue;
        const absolute = pathApiFor('native').resolve(recorded.root, relative);
        if (!isContainedIn(recorded.root, absolute, 'native')) continue;
        await dependencies.fs.removeFile(absolute);
      }
      // The run-state directory is left behind empty by the removals above;
      // `git worktree remove` treats an empty directory as removable, but
      // pruning it here keeps the refusal surface to real content.
      await dependencies.fs.removeDirectoryIfEmpty(
        pathApiFor('native').resolve(recorded.root, RUN_STATE_DIR_NAME)
      );
    }
    const mainCheckout = await repositoryMainCheckout(dependencies, recorded.root);
    if (mainCheckout === null || samePath(mainCheckout, recorded.root, 'native')) {
      throw workspaceRefusal(
        'workspace_cleanup_unsafe',
        `${recorded.root} could not be resolved to a linked worktree of a repository with a separate main checkout.`,
        {
          expected: 'a linked worktree',
          actual: mainCheckout ?? '(no repository)',
          target: recorded.root,
          fix: 'Re-plan the cleanup; cleanup never removes a repository main checkout.',
        }
      );
    }
    mainCheckouts.set(target.side, mainCheckout);
    await dependencies.git.removeWorktree(mainCheckout, recorded.root);
    removed.push(recorded.root);
    await advance(removedPhase);
  }

  for (const mainCheckout of new Set(mainCheckouts.values())) {
    await dependencies.git.pruneWorktrees(mainCheckout).catch(() => undefined);
  }
  await advance('pruned');

  // The index entry goes LAST, after both worktrees are gone, so an interrupted
  // cleanup resumes from the index rather than from a directory scan.
  const indexEntryRemoved = await removeWorkspaceIndexEntry(
    coordination,
    plan.scope.planningScopeId,
    plan.changeId
  );

  return {
    planId: plan.planId,
    scope: plan.scope,
    changeId: plan.changeId,
    phase: 'complete',
    removed,
    indexEntryRemoved,
  };
}
