/**
 * `store-planning-worktree-bindings` — the Interface types for the one Module
 * that prepares, binds, describes, and removes a Store planning / project
 * execution worktree pair.
 *
 * Everything a caller may see lives here: the immutable plan and its token, the
 * binding state, the verification findings, the cleanup preconditions, and the
 * stable error codes. Worktree identity derivation, the binding reducer, the
 * machine index, the lock protocol, and the Git verb set stay behind
 * `StoreWorkspaceModule`.
 */
import type { StorePlanningPathFlavor } from '../planning-layout-v2.js';

// -----------------------------------------------------------------------------
// Scope and target line
// -----------------------------------------------------------------------------

/**
 * The (Store, project, target line) triple a workspace belongs to, resolved to
 * permanent identities. `storeRoot` is the registered Store checkout — a local
 * locator, never identity.
 */
export interface WorkspaceScope {
  readonly storeUid: string;
  readonly storeId: string;
  readonly storeRoot: string;
  readonly projectId: string;
  readonly targetLineId: string;
  readonly planningScopeId: string;
}

/** A target line resolved to concrete refs and commit OIDs at use time. */
export interface ResolvedTargetLine {
  readonly targetLineId: string;
  readonly storeRef: string;
  readonly storeRefOid: string;
  readonly codeRef?: string;
  readonly codeRefOid?: string;
}

// -----------------------------------------------------------------------------
// Worktree facts
// -----------------------------------------------------------------------------

export type WorkspaceSide = 'planning' | 'execution';

/**
 * One side of a pair as it exists right now. Absent facts are absent: a
 * worktree that does not exist yet has no instance id, ref, or HEAD.
 */
export interface WorktreeFacts {
  readonly side: WorkspaceSide;
  readonly root: string;
  /** The repository the worktree belongs to, as a local locator. */
  readonly repositoryRoot: string;
  readonly exists: boolean;
  /** True only when the root is a linked worktree, never the main checkout. */
  readonly linked?: boolean;
  readonly worktreeInstanceId?: string;
  readonly repositoryIdentity?: string;
  readonly ref?: string;
  readonly headOid?: string;
}

// -----------------------------------------------------------------------------
// Plan
// -----------------------------------------------------------------------------

export type WorkspaceActionKind =
  | 'reuse-planning-worktree'
  | 'create-planning-worktree'
  | 'reuse-execution-worktree'
  | 'create-execution-worktree'
  | 'write-planning-marker'
  | 'write-execution-association'
  | 'record-index-entry';

export interface WorkspaceAction {
  readonly kind: WorkspaceActionKind;
  /** Absolute destination this action creates or writes. */
  readonly destination: string;
  /** The repository the action operates in, for worktree actions. */
  readonly repositoryRoot?: string;
  /** The commit a created worktree is created FROM. Never a ref name. */
  readonly fromOid?: string;
  /** The ref a created worktree checks out, or a reused one must already be on. */
  readonly ref?: string;
  /** True when the plan creates `ref` as a new branch from `fromOid`. */
  readonly createsBranch?: boolean;
  /** sha256 over the exact bytes a write action will produce. */
  readonly digest?: string;
  /** Already true on disk, so applying is a no-op for this action. */
  readonly alreadySatisfied: boolean;
}

/**
 * One checked fact, reported whether it holds or not. A plan reports EVERY
 * unsatisfied precondition rather than stopping at the first.
 */
export interface WorkspacePrecondition {
  readonly id: string;
  readonly satisfied: boolean;
  readonly detail: string;
  readonly expected?: string;
  readonly actual?: string;
  /** The refusal code this precondition produces when unsatisfied. */
  readonly code?: StoreWorkspaceErrorCode;
}

export type WorkspaceIntent = 'new-change' | 'existing-change';

export interface WorkspacePlanToken {
  readonly planId: string;
  readonly storeUid: string;
  readonly projectId: string;
  readonly targetLineId: string;
  readonly changeId: string;
  readonly storeRefOid: string;
  readonly codeRefOid: string;
  readonly planningHeadOid?: string;
  readonly executionHeadOid?: string;
  readonly indexFingerprint: string;
}

export interface ImmutableWorkspacePlan {
  readonly planId: string;
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly intent: WorkspaceIntent;
  readonly scope: WorkspaceScope;
  readonly targetLine: ResolvedTargetLine;
  /** The catalog bytes the plan froze, so `apply` can detect an edited line. */
  readonly targetLineCatalog: {
    readonly path: string;
    readonly digest: string;
  };
  /** The Store metadata whose declared layout version `apply` revalidates. */
  readonly storeMetadataPath: string;
  readonly changeId: string;
  /** Present only for `intent: 'existing-change'`. */
  readonly changeInstanceId?: string;
  readonly pathFlavor: StorePlanningPathFlavor;
  readonly planning: WorkspacePlanSide;
  readonly execution: WorkspacePlanSide;
  readonly actions: readonly WorkspaceAction[];
  readonly preconditions: readonly WorkspacePrecondition[];
  readonly indexFingerprint: string;
  /** True only when every precondition holds. */
  readonly applicable: boolean;
  readonly blockers: readonly WorkspacePrecondition[];
  readonly token?: WorkspacePlanToken;
}

export interface WorkspacePlanSide {
  readonly side: WorkspaceSide;
  readonly root: string;
  readonly repositoryRoot: string;
  readonly disposition: 'create' | 'reuse';
  readonly ref: string;
  /** The commit a created worktree is created from; the frozen HEAD of a reused one. */
  readonly fromOid: string;
  readonly createsBranch: boolean;
  /** Present only when the worktree already exists. */
  readonly worktreeInstanceId?: string;
  readonly headOid?: string;
}

// -----------------------------------------------------------------------------
// Binding and description
// -----------------------------------------------------------------------------

export type WorkspaceBindingState = 'unbound' | 'prepared' | 'bound' | 'drifted';

/**
 * One thing the verifier checked while resolving a binding. Findings are
 * reported by `describe` and by `rasen context`; they are never repaired
 * silently.
 */
export interface WorkspaceVerificationFinding {
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly expected?: string;
  readonly actual?: string;
}

export interface PreparedChangeWorkspace {
  readonly planId: string;
  readonly scope: WorkspaceScope;
  readonly targetLine: ResolvedTargetLine;
  readonly changeId: string;
  readonly bindingState: WorkspaceBindingState;
  readonly planning: WorktreeFacts;
  readonly execution: WorktreeFacts;
  readonly changeInstanceId?: string;
  readonly workspacePairId?: string;
  readonly created: readonly string[];
  readonly reused: readonly string[];
  readonly suggestedCommits: readonly SuggestedWorkspaceCommit[];
}

export interface WorkspaceDescription {
  readonly scope?: WorkspaceScope;
  readonly targetLine?: ResolvedTargetLine;
  readonly changeId?: string;
  readonly changeInstanceId?: string;
  readonly workspacePairId?: string;
  readonly bindingState: WorkspaceBindingState;
  /** Absent when no workspace has been prepared for the scope. */
  readonly planning?: WorktreeFacts;
  readonly execution?: WorktreeFacts;
  readonly prepared: boolean;
  readonly findings: readonly WorkspaceVerificationFinding[];
}

export interface SuggestedWorkspaceCommit {
  readonly repoRoot: string;
  readonly pathspecs: readonly string[];
  readonly message: string;
  readonly rationale: string;
  readonly command: string;
}

// -----------------------------------------------------------------------------
// Cleanup
// -----------------------------------------------------------------------------

export type CleanupPhase =
  | 'planned'
  | 'removing-execution'
  | 'removed-execution'
  | 'removing-planning'
  | 'removed-planning'
  | 'pruned'
  | 'complete';

export interface CleanupTarget {
  readonly side: WorkspaceSide;
  readonly root: string;
  readonly repositoryRoot: string;
  readonly ref: string;
  /**
   * The recorded ref every commit on this side must be reachable from. Frozen
   * here so `apply` can re-run the reachability precondition instead of
   * trusting the preview: it is the one precondition that exists to prevent
   * losing work, and work can be committed between preview and apply.
   */
  readonly reachableFrom: string;
  /**
   * The repository's MAIN checkout, resolved while the worktree still exists.
   * `git worktree remove` and `git worktree prune` both run from here, and a
   * worktree directory deleted by hand can no longer answer for its own
   * repository — so a side that vanished between preview and apply is still
   * pruned rather than silently skipped.
   */
  readonly mainCheckout?: string;
  readonly preconditions: readonly WorkspacePrecondition[];
  /** Untracked files that are the USER's, and that block removal. */
  readonly untracked: readonly string[];
  /**
   * The binding document this Module itself wrote under `.rasen/`. It is run
   * state, never committed, and removing the worktree removes it — so it is
   * listed separately rather than counted as untracked work at risk.
   */
  readonly ownRunState: readonly string[];
  readonly removable: boolean;
}

export interface CleanupPlanToken {
  readonly planId: string;
  readonly storeUid: string;
  readonly projectId: string;
  readonly targetLineId: string;
  readonly changeId: string;
  readonly indexFingerprint: string;
}

export interface ImmutableCleanupPlan {
  readonly planId: string;
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly scope: WorkspaceScope;
  readonly changeId: string;
  readonly targets: readonly CleanupTarget[];
  readonly indexFingerprint: string;
  readonly includeUntracked: boolean;
  readonly applicable: boolean;
  readonly blockers: readonly WorkspacePrecondition[];
  readonly token?: CleanupPlanToken;
}

export interface CleanupResult {
  readonly planId: string;
  readonly scope: WorkspaceScope;
  readonly changeId: string;
  readonly phase: CleanupPhase;
  readonly removed: readonly string[];
  readonly indexEntryRemoved: boolean;
}

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

/**
 * The finding `describe` emits when NOTHING is prepared for the scope.
 *
 * Exported because a human printer must not re-derive that claim from
 * `prepared === false`. That flag is also false when the scope holds SEVERAL
 * prepared pairs and the caller's location picks none of them, and when the
 * pair could not be resolved at all — and printing "no workspace is prepared"
 * in either case states the opposite of what the same report says a few lines
 * later. The Module decides which absence this is; the printer repeats it.
 */
export const WORKSPACE_NOT_PREPARED_CODE = 'workspace_not_prepared';

/** Does this report say nothing is prepared, as opposed to naming nothing? */
export function reportsNoPreparedWorkspace(
  findings: readonly { readonly code: string }[]
): boolean {
  return findings.some((finding) => finding.code === WORKSPACE_NOT_PREPARED_CODE);
}

export interface WorkspaceSelectors {
  /** Store id or permanent identity, as accepted by the Store registry. */
  readonly store?: string;
  readonly project?: string;
  readonly targetLine?: string;
  /** Absolute command boundary the caller captured. */
  readonly startPath: string;
  readonly globalDataDir?: string;
  readonly pathFlavor?: StorePlanningPathFlavor;
}

export interface PrepareChangeWorkspaceInput extends WorkspaceSelectors {
  readonly changeId: string;
  readonly intent?: WorkspaceIntent;
  /** Absolute destination for the Store planning worktree. */
  readonly planningWorktree?: string;
  /** Absolute destination for the project execution worktree. */
  readonly executionWorktree?: string;
}

export type DescribeWorkspaceInput = WorkspaceSelectors & {
  readonly changeId?: string;
};

export interface CleanupWorkspaceInput extends WorkspaceSelectors {
  readonly changeId: string;
  readonly includeUntracked?: boolean;
}

// -----------------------------------------------------------------------------
// Module
// -----------------------------------------------------------------------------

export interface StoreWorkspaceModule {
  plan(input: PrepareChangeWorkspaceInput): Promise<ImmutableWorkspacePlan>;
  apply(token: WorkspacePlanToken): Promise<PreparedChangeWorkspace>;
  describe(input: DescribeWorkspaceInput): Promise<WorkspaceDescription>;
  planCleanup(input: CleanupWorkspaceInput): Promise<ImmutableCleanupPlan>;
  applyCleanup(token: CleanupPlanToken): Promise<CleanupResult>;
}

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

/**
 * The closed refusal taxonomy. Each code names the two disagreeing values and
 * carries a repair hint; none of them has an override flag.
 */
export const STORE_WORKSPACE_ERROR_CODES = [
  'planning_execution_binding_missing',
  'planning_execution_binding_mismatch',
  'workspace_binding_ambiguous',
  'workspace_marker_conflict',
  'target_line_mismatch',
  'target_line_ref_unresolved',
  'workspace_ref_mismatch',
  'workspace_dirty_tree',
  'workspace_destination_exists',
  'workspace_already_bound',
  'workspace_plan_stale',
  'workspace_lock_unavailable',
  'workspace_cleanup_unsafe',
] as const;

export type StoreWorkspaceErrorCode = (typeof STORE_WORKSPACE_ERROR_CODES)[number];

/** Codes this Module raises that are not part of the closed refusal taxonomy. */
export const STORE_WORKSPACE_OPERATIONAL_ERROR_CODES = [
  'workspace_store_unresolved',
  'workspace_project_unresolved',
  'workspace_target_line_unknown',
  'workspace_layout_version_unsupported',
  'workspace_plan_missing',
  'workspace_plan_not_applicable',
  'workspace_repository_unavailable',
  'workspace_identity_unavailable',
  'workspace_git_failed',
  'target_line_exists',
  'target_line_unknown',
  'target_line_locator_in_use',
] as const;

export type StoreWorkspaceOperationalErrorCode =
  (typeof STORE_WORKSPACE_OPERATIONAL_ERROR_CODES)[number];

export type WorkspaceErrorCode =
  | StoreWorkspaceErrorCode
  | StoreWorkspaceOperationalErrorCode;
