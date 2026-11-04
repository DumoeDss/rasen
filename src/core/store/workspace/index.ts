/**
 * `store-planning-worktree-bindings` — the single public entry point.
 *
 * Callers import the Module, its Interface types, and its diagnostics from
 * here. Plan construction, the binding reducer, worktree identity, the machine
 * index, and the lock protocol are internal.
 */
export * from './types.js';
export {
  StoreWorkspaceError,
  isStoreWorkspaceError,
  workspaceError,
  workspaceRefusal,
} from './diagnostics.js';
export {
  StoreWorkspace,
  StoreWorkspaceModuleInstance,
  assertPlanningWorktreeUnbound,
  completeChangeBinding,
  probePlanningWorktree,
  type ChangeBindingInput,
  type CompleteChangeBindingInput,
  type CompletedChangeBinding,
  type PlanningWorktreeProbeInput,
  type PlanningWorktreeProbeResult,
  type StoreWorkspaceOptions,
} from './module.js';
export {
  productionStoreWorkspaceDependencies,
  withDeterministicWorkspaceIdentity,
  type StoreWorkspaceDependencies,
  type WorkspaceCoordination,
  type WorkspaceFileSystem,
  type WorkspaceGit,
  type WorktreeListEntry,
} from './dependencies.js';
export {
  EXECUTION_ASSOCIATION_FILE_NAME,
  PLANNING_MARKER_FILE_NAME,
  executionAssociationPath,
  planningMarkerPath,
  serializeBindingFact,
  type BindingFact,
} from './binding.js';
export {
  WORKSPACE_LOCK_ORDER,
  changeLockKey,
  integrationLockKey,
  scopeLockKey,
  workspaceLockFileName,
  workspaceLockKey,
  type WorkspaceLockKey,
  type WorkspaceLockKind,
} from './locks.js';
export {
  listAllWorkspaceIndexEntries,
  readWorkspaceIndexDocument,
  readWorkspaceIndexEntry,
  workspaceIndexRelativePath,
  type WorkspaceIndexEntry,
} from './registry.js';
export { workspaceBranchRef } from './plan.js';
export { deriveWorktreeIdentity, type WorktreeIdentity } from './identity.js';
