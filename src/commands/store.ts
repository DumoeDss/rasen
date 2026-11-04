import * as os from 'node:os';
import { asErrorMessage, emitFailure, printJson } from './shared-output.js';
import * as path from 'node:path';
import { Command } from 'commander';

import { COMMAND_REGISTRY } from '../core/completions/command-registry.js';

import {
  StoreError,
  doctorStores,
  listStores,
  prepareStoreSetup,
  prepareStoreCleanup,
  registerExistingStore,
  removeStore,
  resolveSetupGitEnabled,
  setupPreparedStore,
  storeAddProject,
  unregisterStore,
  validateStoreId,
  type StoreAddProjectResult,
  type StoreCleanupResult,
  type StoreDiagnostic,
  type StoreDoctorResult,
  type StoreInfo,
  type StoreInspection,
  type StoreListResult,
  type StoreMutationResult,
  type SetupStoreInput,
  type RegistryEntryType,
} from '../core/store/index.js';
import {
  upgradeStoreIdentity,
  type UpgradeStoreIdentityResult,
} from '../core/store/upgrade-identity.js';
import { findRepoPlanningRootSync } from '../core/planning-home.js';
import { isInteractive } from '../utils/interactive.js';
import { WORKSPACE_DIR_NAME } from '../core/config.js';
import { StoreAggregateQuery } from '../core/store/query/index.js';
import {
  ISSUE_ATTENTION_KIND_ORDER,
  type IssueAttentionItem,
} from '../core/issue-status/index.js';
import {
  attentionCounts,
  composeStoreAttention,
  resolveRunStateContext,
  type StoreAttentionScanEntry,
} from '../core/issue-read/index.js';
import { runAdopt, runEject } from './store-migration.js';
import {
  runStoreMigrateLayout,
  type StoreMigrateLayoutOptions,
} from './store-migrate-layout.js';
import { registerStoreAggregateCommands } from './store-aggregate.js';
import { registerStoreIssueCommand } from './store-issue.js';
import { registerStoreTargetLineCommand } from './store-target-line.js';
import { registerWorkspaceCommand } from './workspace.js';
import { projectStoreAttentionForWire } from '../core/management-api/stores.js';
import {
  diagnoseMigrationDrift,
  migrateStoreMembership,
  type MigrateMembershipResult,
} from '../core/store/migration-ops.js';
import type { SuggestedGitCommand } from '../core/store/migration.js';
import { readStorePointer } from '../core/project-config.js';
import { storeBindingDeclarationFrom } from '../core/effective-config.js';
import {
  resolveStoreBinding,
  type UnavailableStoreBinding,
} from '../core/store/identity.js';
import { describeStore } from '../core/store/identity-diagnostics.js';
import { gatherProjectMembership } from './shared-gather.js';
import { membershipHumanLines, type MembershipHealth } from '../core/relationship-health.js';

interface StoreSetupOptions {
  path?: string;
  initGit?: boolean;
  json?: boolean;
  remote?: string;
  /** `--layout <version>`: explicit layout request; only 2 is accepted. */
  layout?: string;
}

interface StoreRegisterOptions {
  id?: string;
  yes?: boolean;
  json?: boolean;
}

interface StoreRemoveOptions {
  yes?: boolean;
  json?: boolean;
  projectNamespace?: boolean;
}

interface StoreAddProjectOptions {
  to?: string;
  as?: string;
  json?: boolean;
  /** `--set-primary`: opt-in, default off, never inferred. */
  setPrimary?: boolean;
  dryRun?: boolean;
}

interface StoreMigrateMembershipOptions {
  json?: boolean;
  apply?: boolean;
  dryRun?: boolean;
}

interface StoreJsonOptions {
  json?: boolean;
}

interface StoreUnregisterOptions extends StoreJsonOptions {
  projectNamespace?: boolean;
}

interface StoreDoctorOptions extends StoreJsonOptions {
  projectNamespace?: boolean;
}

interface StoreUpgradeIdentityOptions extends StoreJsonOptions {
  uid?: string;
  apply?: boolean;
  dryRun?: boolean;
  all?: boolean;
}

/**
 * `--project-namespace` narrows a store-namespace lifecycle command to the
 * project namespace; a bare id keeps meaning store (backward compat). Named
 * distinctly from the root-selector `--project <id>` flag (which every
 * `--store`-bearing command carries with a fixed, tested description) so the
 * two never collide in meaning.
 */
function namespaceTypeFromFlag(projectNamespace: boolean | undefined): RegistryEntryType {
  return projectNamespace ? 'project' : 'store';
}

interface ResolvedStoreSetupInput extends SetupStoreInput {
  id: string;
}

interface StoreOutput {
  id: string;
  root: string;
  metadata_path?: string;
  uid?: string;
}

interface StoreUpgradeIdentityOutput {
  store: { id: string; root: string; uid: string } | null;
  applied: boolean;
  steps: Array<{
    target: string;
    path: string;
    needed: boolean;
    description: string;
    blocked?: string;
  }>;
  files_to_commit: string[];
  repair_needed: string[];
  status: StoreDiagnostic[];
}

interface StoreMutationOutput {
  store: StoreOutput | null;
  registry: {
    path: string;
    registered: boolean;
    already_registered: boolean;
  } | null;
  git: {
    is_repository: boolean;
    initialized: boolean;
    committed: boolean;
  } | null;
  created_files: string[];
  status: StoreDiagnostic[];
}

interface StoreCleanupOutput {
  store: StoreOutput | null;
  registry: {
    path: string;
    removed: boolean;
  } | null;
  files: {
    deleted: boolean;
    deleted_path: string | null;
    left_on_disk: string | null;
  } | null;
  status: StoreDiagnostic[];
}

interface StoreListOutputEntry extends StoreOutput {
  type: string;
}

interface StoreListOutput {
  stores: StoreListOutputEntry[];
  status: StoreDiagnostic[];
}

interface StoreMembershipOutput {
  project_id: string | null;
  roles: { planning: boolean; knowledge: boolean };
  project_base_commit: string | null;
  store_base_commit: string | null;
  project_writes: string[];
  store_writes: string[];
  record_written: boolean;
  hint_written: boolean;
  repair_needed: Array<{ code: string; message: string; repair: string }>;
  suggested_commits: Array<{ repo_root: string; command: string; purpose: string }>;
}

interface StorePlanningBindingOutput {
  requested: boolean;
  changed: boolean;
  refused: boolean;
  already_bound: boolean;
  bound_to: string | null;
  /** Permanent identity of `bound_to`, so two Stores sharing a name are distinguishable. */
  bound_to_uid: string | null;
  requested_store: string;
  requested_store_uid: string | null;
  rebind_command: string | null;
}

interface StoreAddProjectOutput {
  project: {
    id: string;
    root: string;
    metadata_created: boolean;
    already_registered: boolean;
  } | null;
  target: {
    id: string;
    root: string;
    config_path: string;
    reference_added: boolean;
    reference_already_present: boolean;
  } | null;
  membership: StoreMembershipOutput | null;
  planning_binding: StorePlanningBindingOutput | null;
  dry_run: boolean;
  status: StoreDiagnostic[];
}

interface StoreMigrateMembershipOutput {
  store: { id: string; root: string } | null;
  applied: boolean;
  converted: Array<{
    project_id: string | null;
    alias: string | null;
    source: string;
    roles: { planning: boolean; knowledge: boolean };
    record_path: string | null;
  }>;
  unresolved: Array<{
    project_id: string | null;
    alias: string | null;
    source: string;
    reason: string;
  }>;
  store_writes: string[];
  legacy_manifest_removed: boolean;
  legacy_manifest_path: string | null;
  suggested_commits: Array<{ repo_root: string; command: string; purpose: string }>;
  status: StoreDiagnostic[];
}

type OpenSpecRootOutput = Omit<StoreInspection['openspecRoot'], 'diagnostics'> & {
  status: StoreDiagnostic[];
};

interface StoreDoctorStoreOutput extends StoreOutput {
  type: RegistryEntryType;
  openspec_root: OpenSpecRootOutput;
  metadata: StoreInspection['metadata'];
  git: {
    is_repository: boolean | null;
    has_commits: boolean | null;
    has_uncommitted_changes: boolean | null;
    has_remote: boolean | null;
    origin_url: string | null;
  };
  status: StoreDiagnostic[];
}

interface StoreDoctorOutput {
  stores: StoreDoctorStoreOutput[];
  status: StoreDiagnostic[];
}





function toStoreOutput(store: StoreInfo): StoreOutput {
  return {
    id: store.id,
    root: store.root,
    ...(store.uid ? { uid: store.uid } : {}),
    ...(store.metadataPath ? { metadata_path: store.metadataPath } : {}),
  };
}

function toUpgradeIdentityOutput(
  result: UpgradeStoreIdentityResult
): StoreUpgradeIdentityOutput {
  return {
    store: result.store,
    applied: result.applied,
    steps: result.steps.map((step) => ({
      target: step.target,
      path: step.path,
      needed: step.needed,
      description: step.description,
      ...(step.blocked ? { blocked: step.blocked } : {}),
    })),
    files_to_commit: result.filesToCommit,
    repair_needed: result.repairNeeded,
    status: result.diagnostics,
  };
}

function printUpgradeIdentityHuman(payload: StoreUpgradeIdentityOutput): void {
  if (!payload.store) return;

  console.log(
    payload.applied
      ? `Store identity applied: ${payload.store.id}`
      : `Store identity plan (preview, nothing written): ${payload.store.id}`
  );
  console.log(`Permanent identity: ${payload.store.uid}`);
  console.log(`Location: ${formatPathForHuman(payload.store.root)}`);
  console.log('');
  for (const step of payload.steps) {
    const mark = step.needed ? '-' : 'ok';
    console.log(`  ${mark} ${step.path}: ${step.description}`);
    if (step.blocked) {
      console.log(`      Blocked: ${step.blocked}`);
    }
  }
  for (const status of payload.status) {
    console.log(`${status.severity === 'error' ? 'Issue' : 'Note'}: ${status.message}`);
  }
  if (payload.repair_needed.length > 0) {
    console.log('');
    console.log('Still needs doing:');
    for (const repair of payload.repair_needed) {
      console.log(`  - ${repair}`);
    }
  }
  if (payload.files_to_commit.length > 0) {
    console.log('');
    console.log('Commit these files yourself — this command never commits or pushes:');
    for (const file of payload.files_to_commit) {
      console.log(`  - ${file}`);
    }
  }
}

function toMutationOutput(result: StoreMutationResult): StoreMutationOutput {
  return {
    store: toStoreOutput(result.store),
    registry: {
      path: result.registryCommit.path,
      registered: result.registryCommit.registered,
      already_registered: result.registryCommit.alreadyRegistered,
    },
    git: {
      is_repository: result.git.isRepository,
      initialized: result.git.initialized,
      committed: result.git.committed,
    },
    created_files: result.createdArtifacts,
    status: result.diagnostics,
  };
}

function toCleanupOutput(result: StoreCleanupResult): StoreCleanupOutput {
  return {
    store: toStoreOutput(result.store),
    registry: {
      path: result.registryCommit.path,
      removed: result.registryCommit.removed,
    },
    files: {
      deleted: result.files.deleted,
      deleted_path: result.files.deletedPath ?? null,
      left_on_disk: result.files.leftOnDisk ?? null,
    },
    status: result.diagnostics,
  };
}

function toListOutput(result: StoreListResult): StoreListOutput {
  return {
    stores: result.stores.map((store) => ({ ...toStoreOutput(store), type: store.type })),
    status: [],
  };
}

function toSuggestedCommitOutput(
  commits: readonly SuggestedGitCommand[]
): Array<{ repo_root: string; command: string; purpose: string }> {
  return commits.map((commit) => ({
    repo_root: commit.repoRoot,
    command: commit.command,
    purpose: commit.purpose,
  }));
}

function toAddProjectOutput(result: StoreAddProjectResult): StoreAddProjectOutput {
  return {
    project: {
      id: result.project.id,
      root: result.project.root,
      metadata_created: result.project.metadataCreated,
      already_registered: result.project.alreadyRegistered,
    },
    target: {
      id: result.target.id,
      root: result.target.root,
      config_path: result.target.configPath,
      reference_added: result.target.referenceAdded,
      reference_already_present: result.target.referenceAlreadyPresent,
    },
    membership: {
      project_id: result.membership.projectId,
      roles: result.membership.roles,
      project_base_commit: result.membership.projectBaseCommit,
      store_base_commit: result.membership.storeBaseCommit,
      project_writes: result.membership.projectWrites,
      store_writes: result.membership.storeWrites,
      record_written: result.membership.recordWritten,
      hint_written: result.membership.hintWritten,
      repair_needed: result.membership.repairNeeded.map((repair) => ({
        code: repair.code,
        message: repair.message,
        repair: repair.repair,
      })),
      suggested_commits: toSuggestedCommitOutput(result.membership.suggestedCommits),
    },
    planning_binding: {
      requested: result.planningBinding.requested,
      changed: result.planningBinding.changed,
      refused: result.planningBinding.refused,
      already_bound: result.planningBinding.alreadyBound,
      bound_to: result.planningBinding.boundTo ?? null,
      bound_to_uid: result.planningBinding.boundToUid ?? null,
      requested_store: result.planningBinding.requestedStore,
      requested_store_uid: result.planningBinding.requestedStoreUid ?? null,
      rebind_command: result.planningBinding.rebindCommand ?? null,
    },
    dry_run: result.dryRun,
    status: result.diagnostics,
  };
}

function toMigrateMembershipOutput(
  result: MigrateMembershipResult
): StoreMigrateMembershipOutput {
  return {
    store: { id: result.storeId, root: result.storeRoot },
    applied: result.applied,
    converted: result.converted.map((entry) => ({
      project_id: entry.projectId ?? null,
      alias: entry.alias ?? null,
      source: entry.source,
      roles: entry.roles,
      record_path: entry.recordPath ?? null,
    })),
    unresolved: result.unresolved.map((entry) => ({
      project_id: entry.projectId ?? null,
      alias: entry.alias ?? null,
      source: entry.source,
      reason: entry.unresolved ?? 'unresolved',
    })),
    store_writes: result.storeWrites,
    legacy_manifest_removed: result.legacyManifestRemoved,
    legacy_manifest_path: result.legacyManifestPath,
    suggested_commits: toSuggestedCommitOutput(result.suggestedCommits),
    status: result.diagnostics,
  };
}

function toOpenSpecRootOutput(root: StoreInspection['openspecRoot']): OpenSpecRootOutput {
  return {
    present: root.present,
    config: root.config,
    specs: root.specs,
    changes: root.changes,
    archive: root.archive,
    healthy: root.healthy,
    status: root.diagnostics,
  };
}

function toDoctorStoreOutput(store: StoreInspection): StoreDoctorStoreOutput {
  return {
    ...toStoreOutput(store),
    type: store.type,
    openspec_root: toOpenSpecRootOutput(store.openspecRoot),
    metadata: store.metadata,
    git: {
      is_repository: store.git.isRepository,
      has_commits: store.git.hasCommits,
      has_uncommitted_changes: store.git.hasUncommittedChanges,
      has_remote: store.git.hasRemote,
      origin_url: store.git.originUrl,
    },
    status: store.diagnostics,
  };
}

/**
 * The current project's declared store, when it cannot be used. Read-only and
 * best-effort: `store doctor` runs from anywhere, and a directory that declares
 * nothing (or cannot be classified) simply has nothing to report. Resolved
 * through the SAME resolver every other command uses, so this surface can never
 * disagree with the commands it diagnoses.
 */
async function unavailableProjectDeclaration(): Promise<UnavailableStoreBinding | null> {
  try {
    const projectRoot = findRepoPlanningRootSync(process.cwd());
    if (!projectRoot) return null;
    const declaration = storeBindingDeclarationFrom(readStorePointer(projectRoot));
    if (declaration.form === 'absent') return null;
    const binding = await resolveStoreBinding({ declaration, projectRoot });
    return binding.kind === 'unavailable' ? binding : null;
  } catch {
    return null;
  }
}

function toDoctorOutput(result: StoreDoctorResult): StoreDoctorOutput {
  return {
    stores: result.stores.map(toDoctorStoreOutput),
    status: result.diagnostics,
  };
}


// -----------------------------------------------------------------------------
// The attention scan (`store attention`) — issue-needs-attention D3
// -----------------------------------------------------------------------------

interface StoreAttentionOptions {
  store?: string;
  issue?: string;
  json?: boolean;
}

/** One attention item's human line — the item's own context carries the axes. */
function renderAttentionItem(
  item: IssueAttentionItem,
  issueKeys: ReadonlyMap<string, string>
): string {
  const context = `[${issueKeys.get(item.issueId) ?? item.issueId} ${item.phase}/${item.health}]`;
  const who = item.nodeId === null ? '' : item.alias === null ? ` ${item.nodeId}` : ` ${item.nodeId} ${item.alias}`;
  switch (item.kind) {
    case 'failure':
      return `    ${context}${who} failed${item.diagnostic === null ? '' : ` — ${item.diagnostic}`}`;
    case 'blocked-behind':
      return `    ${context}${who} blocked behind ${item.blockers
        .map(blocker => `${blocker.nodeId}@${blocker.projectId}: ${blocker.state}`)
        .join(', ')}`;
    case 'waiting-human':
      return `    ${context}${who} waiting for a human`;
    case 'acceptance-awaiting': {
      const gate =
        item.gate === null
          ? 'gate not evaluated on this read — no acceptance facts supplied'
          : item.gate.eligible
            ? `gate holds, conditions revision ${item.gate.conditionsRevisionId}`
            : `gate does not hold — ${item.gate.message}`;
      return `    ${context} acceptance is the human's next act (${gate})`;
    }
    case 'problem': {
      const node = item.problem.node === null ? '' : ` ${item.problem.node}`;
      const at = item.problem.ref === null ? '' : ` ${item.problem.ref}`;
      return `    ${context} problem ${item.problem.kind}${node}${at}: ${item.problem.reason}`;
    }
  }
}

/** The visibility label each per-Issue read already renders, one line per distinct value. */
function attentionVisibilityLines(entries: readonly StoreAttentionScanEntry[]): string[] {
  const labels = new Set(
    entries.map(entry =>
      entry.runStateVisibility.kind === 'execution-root'
        ? entry.runStateVisibility.executionRoot
        : 'none visible from this directory'
    )
  );
  return [...labels].sort().map(label => `  run-state: ${label}`);
}

/**
 * The attention answer in human form: the scan summary first (every Issue
 * scanned with its phase, health, and item count — scanned-and-healthy work is
 * visible, honestly unlisted), then the items grouped fail-first with every
 * item listed in full, and an explicit empty state when nothing needs
 * attention. Reading writes nothing, and the answer says so.
 */
function renderAttentionAnswer(
  narrowed: boolean,
  narrowedIssueId: string | null,
  scanned: readonly StoreAttentionScanEntry[],
  items: readonly IssueAttentionItem[]
): void {
  const issueKeys = new Map(scanned.map(entry => [entry.issueId, entry.issueKey]));
  const narrowedKey = narrowedIssueId === null ? null : issueKeys.get(narrowedIssueId) ?? narrowedIssueId;
  const scope = narrowed ? `narrowed to ${narrowedKey} — ` : '';
  console.log(`Store attention scan — ${scope}${scanned.length} Issue(s) scanned`);
  console.log('  scanned:');
  for (const entry of scanned) {
    console.log(`    ${entry.issueKey}: ${entry.phase}/${entry.health} — ${entry.itemCount} item(s)`);
  }
  for (const line of attentionVisibilityLines(scanned)) console.log(line);
  if (items.length === 0) {
    console.log(`  none need attention — ${scanned.length} Issue(s) scanned, zero items`);
  } else {
    console.log(`  attention: ${items.length} item(s)`);
    for (const kind of ISSUE_ATTENTION_KIND_ORDER) {
      const group = items.filter(item => item.kind === kind);
      if (group.length === 0) continue;
      console.log(`  ${kind} (${group.length})`);
      for (const item of group) console.log(renderAttentionItem(item, issueKeys));
    }
  }
  console.log('');
  console.log('  wrote nothing — attention derives; acting on an item remains a human act.');
}

function formatPathForHuman(targetPath: string): string {
  const home = os.homedir();
  const normalizedHome = path.resolve(home);
  const normalizedTarget = path.resolve(targetPath);

  if (normalizedTarget === normalizedHome) return '~';
  if (normalizedTarget.startsWith(`${normalizedHome}${path.sep}`)) {
    return `~${path.sep}${path.relative(normalizedHome, normalizedTarget)}`;
  }

  return targetPath;
}

async function promptStoreId(): Promise<string> {
  const { input } = await import('@inquirer/prompts');

  return input({
    message: 'Store name',
    required: true,
    validate(value: string) {
      try {
        validateStoreId(value);
        return true;
      } catch (error) {
        return asErrorMessage(error);
      }
    },
  });
}

async function promptStorePath(id: string): Promise<string> {
  const { input } = await import('@inquirer/prompts');
  // Suggest a visible, user-owned location — never the managed XDG data dir.
  const defaultPath = ['~', WORKSPACE_DIR_NAME, id].join('/');

  return input({
    message: 'Where should this store live?',
    default: defaultPath,
    prefill: 'editable',
    required: true,
  });
}

async function resolveSetupInput(
  id: string | undefined,
  options: StoreSetupOptions
): Promise<ResolvedStoreSetupInput> {
  const interactive = !options.json && isInteractive();

  if (!id && !interactive) {
    throw new StoreError(
      'Pass a store name.',
      'store_setup_id_required',
      {
        target: 'store.id',
        fix: `rasen store setup <name> --path ~/${WORKSPACE_DIR_NAME}/<name> --json`,
      }
    );
  }

  if (options.path === undefined && !interactive) {
    throw new StoreError(
      'Pass --path with the folder where this store should live.',
      'store_setup_path_required',
      {
        target: 'store.root',
        fix: `rasen store setup ${id ?? '<name>'} --path ~/${WORKSPACE_DIR_NAME}/${id ?? '<name>'}`,
      }
    );
  }

  // Value-validated before anything is touched (and before any prompt), so an
  // unsupported request fails fast naming the one accepted value.
  const layoutVersion = parseSetupLayoutOption(options.layout);

  const resolvedId = id ? validateStoreId(id) : await promptStoreId();
  const promptedPath = options.path === undefined
    ? await promptStorePath(resolvedId)
    : undefined;

  return {
    id: resolvedId,
    path: options.path ?? promptedPath,
    ...(options.remote !== undefined ? { remote: options.remote } : {}),
    ...(layoutVersion !== undefined ? { layoutVersion } : {}),
  };
}

/** `--layout` accepts exactly the layout version 2; anything else is refused. */
function parseSetupLayoutOption(value: string | undefined): 2 | undefined {
  if (value === undefined) return undefined;
  if (value === '2') return 2;
  throw new StoreError(
    `Unsupported store layout version '${value}'; only layout version 2 can be requested.`,
    'store_setup_layout_invalid',
    {
      target: 'store.layout',
      fix: 'Pass --layout 2, or omit the option to create the store as setup creates it today.',
    }
  );
}

async function prepareSetupInput(
  input: ResolvedStoreSetupInput,
  _options: StoreSetupOptions
) {
  return prepareStoreSetup(input);
}

async function confirmSetup(
  prepared: Awaited<ReturnType<typeof prepareStoreSetup>>,
  initGit: boolean
): Promise<void> {
  const { confirm } = await import('@inquirer/prompts');

  console.log('');
  console.log('Rasen will create:');
  console.log('');
  console.log(`  Store: ${prepared.id}`);
  console.log(`  Location: ${formatPathForHuman(prepared.root)}`);
  console.log(`  Git: ${initGit ? 'initialized' : 'not initialized'}`);
  console.log('');

  const confirmed = await confirm({
    message: 'Create this store?',
    default: true,
  });

  if (!confirmed) {
    throw new StoreError(
      'Store setup cancelled.',
      'store_setup_cancelled',
      {
        target: 'store.root',
        fix: 'Rerun setup when you are ready.',
      }
    );
  }
}

async function confirmRemove(id: string, root: string, options: StoreRemoveOptions): Promise<void> {
  if (options.yes) return;

  if (options.json || !isInteractive()) {
    throw new StoreError(
      'Pass --yes to delete store files non-interactively.',
      'store_remove_confirmation_required',
      {
        target: 'store.root',
        fix: `rasen store remove ${id} --yes`,
      }
    );
  }

  const { confirm } = await import('@inquirer/prompts');
  const confirmed = await confirm({
    message: `Delete local store folder ${formatPathForHuman(root)}?`,
    default: false,
  });

  if (!confirmed) {
    throw new StoreError(
      'Store remove cancelled.',
      'store_remove_cancelled',
      {
        target: 'store.root',
        fix: 'Run "rasen store unregister <id>" if you only want to forget the local registration.',
      }
    );
  }
}

function isRegisterIdentityConfirmationError(error: unknown): boolean {
  return (
    error instanceof StoreError &&
    error.diagnostic.code === 'store_register_identity_confirmation_required'
  );
}

async function confirmRegisterConversion(error: unknown): Promise<void> {
  const { confirm } = await import('@inquirer/prompts');
  const confirmed = await confirm({
    message: asErrorMessage(error),
    default: false,
  });

  if (!confirmed) {
    throw new StoreError(
      'Store register cancelled.',
      'store_register_cancelled',
      {
        target: 'store.metadata',
        fix: 'Rerun register when you are ready to create store identity metadata.',
      }
    );
  }
}

function printMutationHuman(
  title: string,
  payload: StoreMutationOutput,
  remotes?: { canonical?: string; observed?: string }
): void {
  if (!payload.store || !payload.registry || !payload.git) {
    return;
  }

  console.log(`${title}: ${payload.store.id}`);
  console.log(`Location: ${formatPathForHuman(payload.store.root)}`);
  console.log('Rasen root: ready');
  console.log(`Registry: ${payload.registry.already_registered ? 'already registered' : 'registered'}`);
  for (const status of payload.status) {
    console.log(`${status.severity === 'error' ? 'Issue' : 'Note'}: ${status.message}`);
  }
  console.log('');
  console.log('Next: run normal Rasen commands against this store, for example:');
  console.log(`  rasen new change <change-id> --store ${payload.store.id}`);
  if (payload.git.is_repository) {
    const shareRemote = remotes?.canonical ?? remotes?.observed;
    console.log(
      shareRemote
        ? `Share it: teammates clone ${shareRemote} and run rasen store register <path>.`
        : 'Share this store by committing and pushing it like any Git repo.'
    );
  }
}

function printCleanupHuman(title: string, payload: StoreCleanupOutput): void {
  if (!payload.store || !payload.registry || !payload.files) {
    return;
  }

  console.log(`${title}: ${payload.store.id}`);

  if (payload.files.deleted_path) {
    console.log(`Deleted: ${formatPathForHuman(payload.files.deleted_path)}`);
  } else if (payload.files.left_on_disk) {
    console.log(`Files kept at: ${formatPathForHuman(payload.files.left_on_disk)}`);
  } else if (!payload.files.deleted) {
    console.log(`Files were already missing: ${formatPathForHuman(payload.store.root)}`);
  }

  for (const status of payload.status) {
    console.log(`${status.severity === 'error' ? 'Issue' : 'Note'}: ${status.message}`);
  }
}

function printListHuman(payload: StoreListOutput): void {
  if (payload.stores.length === 0) {
    console.log('No stores registered.');
    console.log('');
    console.log('Next:');
    console.log(`  rasen store setup team-context --path ~/${WORKSPACE_DIR_NAME}/team-context`);
    console.log('  rasen store register /path/to/store');
    return;
  }

  console.log(`Rasen stores (${payload.stores.length})`);
  console.log('');
  console.log(`${'ID'.padEnd(16)}${'Type'.padEnd(10)}${'Identity'.padEnd(38)}Location`);
  for (const store of payload.stores) {
    const identity = store.uid ?? '(none yet)';
    console.log(
      `${store.id.padEnd(16)}${store.type.padEnd(10)}${identity.padEnd(38)}${store.root}`
    );
  }
}

function printMigrateMembershipHuman(payload: StoreMigrateMembershipOutput): void {
  if (!payload.store) {
    return;
  }

  console.log(`Store: ${payload.store.id}`);
  console.log(`Location: ${formatPathForHuman(payload.store.root)}`);
  console.log(
    payload.applied
      ? 'Mode: applied'
      : 'Mode: preview (nothing was written; rerun with --apply to convert)'
  );
  console.log('');

  if (payload.converted.length === 0) {
    console.log('Nothing left to convert: every member already has a per-project record.');
  } else {
    console.log(`Projects ${payload.applied ? 'converted' : 'to convert'}: ${payload.converted.length}`);
    for (const entry of payload.converted) {
      const name = entry.alias ? `${entry.alias} (${entry.project_id})` : (entry.project_id ?? '');
      console.log(
        `  ${name} — from ${entry.source}, planning=${entry.roles.planning ? 'yes' : 'no'}, knowledge=${entry.roles.knowledge ? 'yes' : 'no'}`
      );
      if (entry.record_path) {
        console.log(`    ${formatPathForHuman(entry.record_path)}`);
      }
    }
  }

  if (payload.unresolved.length > 0) {
    console.log('');
    console.log(`Left untouched (cannot be resolved on this machine): ${payload.unresolved.length}`);
    for (const entry of payload.unresolved) {
      console.log(`  ${entry.alias ?? entry.project_id ?? '(unknown)'} — ${entry.reason}`);
    }
    console.log('  Their legacy data was kept: it is the only remaining record that they are members.');
  }

  if (payload.legacy_manifest_path) {
    console.log('');
    if (payload.legacy_manifest_removed) {
      console.log(
        payload.applied
          ? `Removed ${formatPathForHuman(payload.legacy_manifest_path)} after every record was written and read back.`
          : `Would remove ${formatPathForHuman(payload.legacy_manifest_path)} once every record above is written and read back.`
      );
      console.log(
        '  It is removed rather than renamed: any archived copy would keep a machine-absolute path in git, which is the thing being removed.'
      );
      console.log(
        '  Every fact it held is carried into the per-project records, and the file itself stays recoverable from this store\'s git history:'
      );
      console.log('    git log --oneline -- .rasen-store/adoptions.yaml');
      console.log('    git show <commit>:.rasen-store/adoptions.yaml');
    } else {
      console.log(
        `Kept ${formatPathForHuman(payload.legacy_manifest_path)}: it still describes members this machine cannot resolve.`
      );
    }
  }

  for (const commit of payload.suggested_commits) {
    console.log('');
    console.log(`Suggested commit (${commit.purpose})`);
    console.log(`  ${commit.command}`);
    console.log('  Not run: rasen never stages, commits, pushes, fetches, or pulls.');
  }

  for (const status of payload.status) {
    console.log(`${status.severity === 'error' ? 'Issue' : 'Note'}: ${status.message}`);
    if (status.fix) console.log(`  Fix: ${status.fix}`);
  }
}

function printAddProjectHuman(payload: StoreAddProjectOutput): void {
  if (!payload.project || !payload.target) {
    return;
  }

  console.log(`Project: ${payload.project.id} (project namespace)`);
  console.log(`Location: ${formatPathForHuman(payload.project.root)}`);
  console.log(`Registry: ${payload.project.already_registered ? 'already registered' : 'registered'}`);
  console.log(`Added to store: ${payload.target.id}`);
  console.log(
    payload.target.reference_added
      ? `References: added to ${formatPathForHuman(payload.target.config_path)}`
      : `References: already present in ${formatPathForHuman(payload.target.config_path)}`
  );

  // Membership and the planning binding are reported SEPARATELY and always:
  // they are different relations, and collapsing them in the output is exactly
  // the confusion the record exists to remove.
  const membership = payload.membership;
  if (membership) {
    console.log('');
    console.log(
      payload.dry_run
        ? 'Membership (preview — nothing was written):'
        : 'Membership (roster and eligibility only; it does not decide where a change is implemented):'
    );
    console.log(`  Project identity: ${membership.project_id ?? '(not assigned yet)'}`);
    console.log(
      `  Roles: planning=${membership.roles.planning ? 'yes' : 'no'}, knowledge=${membership.roles.knowledge ? 'yes' : 'no'}`
    );
    for (const write of membership.store_writes) {
      console.log(
        `  Store repo ${payload.dry_run ? 'would write' : 'wrote'}: ${formatPathForHuman(write)}`
      );
    }
    for (const write of membership.project_writes) {
      console.log(
        `  Project repo ${payload.dry_run ? 'would write' : 'wrote'}: ${formatPathForHuman(write)}`
      );
    }
    if (membership.store_writes.length === 0 && membership.project_writes.length === 0) {
      console.log('  Already recorded in both repositories; nothing to write.');
    }
    for (const repair of membership.repair_needed) {
      console.log(`  Needs repair: ${repair.message}`);
      console.log(`    Run: ${repair.repair}`);
    }
    for (const commit of membership.suggested_commits) {
      console.log(`  Suggested commit (${commit.purpose})`);
      console.log(`    ${commit.command}`);
    }
    if (membership.suggested_commits.length > 0) {
      console.log('  Neither command was run: rasen never stages, commits, pushes, fetches, or pulls.');
    }
  }

  const binding = payload.planning_binding;
  if (binding) {
    console.log('');
    if (binding.refused) {
      // Named by identity on BOTH sides: two Stores may legitimately share a
      // display name, and naming only the name renders "plans in 'team-store',
      // not 'team-store'" — a refusal the user cannot act on.
      const boundLabel = describeStore({
        ...(binding.bound_to ? { id: binding.bound_to } : {}),
        ...(binding.bound_to_uid ? { uid: binding.bound_to_uid } : {}),
      });
      const requestedLabel = describeStore({
        id: binding.requested_store,
        ...(binding.requested_store_uid ? { uid: binding.requested_store_uid } : {}),
      });
      console.log(
        `Planning store: REFUSED — nothing was overwritten. This project plans in ${boundLabel}; --set-primary asked for ${requestedLabel}.`
      );
      console.log('  The planning store was left exactly as it was.');
      console.log(
        '  The membership record and locator hint this command wrote are unaffected — they are a different relation.'
      );
      if (binding.rebind_command) {
        console.log(`  To rebind deliberately: ${binding.rebind_command}`);
      }
    } else if (binding.changed) {
      console.log(`Planning store: changed to '${binding.requested_store}' (--set-primary).`);
      console.log('  This is separate from the membership above: it decides where this project plans.');
    } else if (binding.requested && binding.already_bound) {
      console.log(`Planning store: already '${binding.requested_store}'; nothing was rewritten.`);
    } else {
      console.log(
        `Planning store: unchanged${binding.bound_to ? ` ('${binding.bound_to}')` : ' (none declared)'}. Pass --set-primary to bind it.`
      );
    }
  }

  console.log('');
  console.log('The project remains usable in-repo; it continues to resolve as its own local Rasen root.');

  if (payload.project.metadata_created) {
    const metadataPath = path.join(payload.project.root, '.rasen-store', 'store.yaml');
    console.log('');
    console.log(`Store identity metadata was created at ${formatPathForHuman(metadataPath)}.`);
    console.log('Commit it so teammates can resolve this project as a store on their own checkouts, or gitignore it to keep it machine-local.');
    console.log('This command does not edit .gitignore and does not create a commit.');
  }

  for (const status of payload.status) {
    console.log(`${status.severity === 'error' ? 'Issue' : 'Note'}: ${status.message}`);
  }
}

function formatMetadataHuman(store: StoreDoctorOutput['stores'][number]): string {
  if (store.metadata.valid) return 'ok';
  if (store.metadata.present === false) return 'missing';
  if (store.metadata.present === null) return 'unknown';
  return 'invalid';
}

function formatDoctorGitHuman(store: StoreDoctorOutput['stores'][number]): string {
  if (store.git.is_repository === null) return 'unknown';
  if (!store.git.is_repository) return 'not detected';

  const fact = (value: boolean | null, yes: string, no: string): string =>
    value === null ? 'unknown' : value ? yes : no;

  return `repository detected (commits: ${fact(store.git.has_commits, 'yes', 'none')}, uncommitted changes: ${fact(store.git.has_uncommitted_changes, 'yes', 'no')}, remote: ${fact(store.git.has_remote, 'yes', 'none')})`;
}

function formatOpenSpecRootHuman(store: StoreDoctorOutput['stores'][number]): string {
  if (store.openspec_root.healthy) return 'ok';
  if (store.openspec_root.present === false) return 'missing';
  if (store.openspec_root.present === null) return 'unknown';
  return 'incomplete';
}

function printDoctorHuman(payload: StoreDoctorOutput): void {
  if (payload.stores.length === 0) {
    console.log('No stores registered.');
    return;
  }

  console.log('Store doctor');
  for (const status of payload.status) {
    console.log('');
    console.log(`Note: ${status.message}`);
    if (status.fix) {
      console.log(`Fix: ${status.fix}`);
    }
  }
  for (const store of payload.stores) {
    console.log('');
    console.log(`${store.id} (${store.type})`);
    console.log(`  Location: ${store.root}`);
    console.log(`  Rasen root: ${formatOpenSpecRootHuman(store)}`);
    console.log(
      `  Identity: ${store.metadata.uid ?? 'none yet (run rasen store upgrade-identity ' + store.id + ' --apply)'}`
    );
    console.log(`  Metadata: ${formatMetadataHuman(store)}`);
    const remoteLine = store.metadata.remote ?? store.git.origin_url;
    if (remoteLine) {
      console.log(`  Remote: ${remoteLine}`);
    }
    console.log(`  Git: ${formatDoctorGitHuman(store)}`);

    if (store.status.length === 0) {
      console.log('  Issues: none');
      continue;
    }

    console.log('  Issues:');
    for (const status of store.status) {
      console.log(`    - ${status.message}`);
      if (status.fix) {
        console.log(`      Fix: ${status.fix}`);
      }
    }
  }
}

class StoreCommand {
  async setup(id: string | undefined, options: StoreSetupOptions = {}): Promise<void> {
    try {
      const setupInput = await resolveSetupInput(id, options);
      const prepared = await prepareSetupInput(setupInput, options);
      const initGit = resolveSetupGitEnabled(prepared, options.initGit);
      if (!options.json && isInteractive()) {
        await confirmSetup(prepared, initGit);
      }
      const result = await setupPreparedStore(prepared, { initGit });
      const payload = toMutationOutput(result);

      if (options.json) {
        printJson(payload);
        return;
      }

      printMutationHuman('Store ready', payload, result.remotes);
    } catch (error) {
      this.handleFailure(
        options.json,
        { store: null, registry: null, git: null, created_files: [], status: [] },
        error
      );
    }
  }

  async register(inputPath: string | undefined, options: StoreRegisterOptions = {}): Promise<void> {
    try {
      let result: StoreMutationResult;
      try {
        result = await registerExistingStore({
          path: inputPath,
          id: options.id,
          allowCreateIdentity: options.yes,
        });
      } catch (error) {
        if (!isRegisterIdentityConfirmationError(error) || options.json || !isInteractive()) {
          throw error;
        }

        await confirmRegisterConversion(error);
        result = await registerExistingStore({
          path: inputPath,
          id: options.id,
          allowCreateIdentity: true,
        });
      }

      const payload = toMutationOutput(result);

      if (options.json) {
        printJson(payload);
        return;
      }

      printMutationHuman('Store registered', payload, result.remotes);
    } catch (error) {
      this.handleFailure(
        options.json,
        { store: null, registry: null, git: null, created_files: [], status: [] },
        error
      );
    }
  }

  async unregister(id: string, options: StoreUnregisterOptions = {}): Promise<void> {
    try {
      const type = namespaceTypeFromFlag(options.projectNamespace);
      const payload = toCleanupOutput(await unregisterStore({ id, type }));

      if (options.json) {
        printJson(payload);
        return;
      }

      printCleanupHuman(type === 'project' ? 'Unregistered project' : 'Unregistered store', payload);
    } catch (error) {
      this.handleFailure(
        options.json,
        { store: null, registry: null, files: null, status: [] },
        error
      );
    }
  }

  async remove(id: string, options: StoreRemoveOptions = {}): Promise<void> {
    try {
      const type = namespaceTypeFromFlag(options.projectNamespace);
      const target = await prepareStoreCleanup({ id, type });
      await confirmRemove(target.id, target.root, options);
      const payload = toCleanupOutput(await removeStore(target));

      if (options.json) {
        printJson(payload);
        return;
      }

      printCleanupHuman(type === 'project' ? 'Removed project' : 'Removed store', payload);
    } catch (error) {
      this.handleFailure(
        options.json,
        { store: null, registry: null, files: null, status: [] },
        error
      );
    }
  }

  async addProject(projectPath: string | undefined, options: StoreAddProjectOptions = {}): Promise<void> {
    try {
      if (!options.to) {
        throw new StoreError(
          'Pass --to <store-id> naming the target store.',
          'store_add_project_to_required',
          {
            target: 'store.id',
            fix: 'rasen store add-project <path> --to <store-id>',
          }
        );
      }
      if (!projectPath) {
        throw new StoreError(
          'Pass the project path to add.',
          'store_add_project_path_required',
          {
            target: 'store.root',
            fix: 'rasen store add-project <path> --to <store-id>',
          }
        );
      }

      const result = await storeAddProject({
        projectPath,
        targetStoreId: options.to,
        ...(options.as !== undefined ? { id: options.as } : {}),
        // Opt-in only, read straight off the flag: never derived from another
        // option, from the project's state, or from this being its only
        // membership.
        ...(options.setPrimary === true ? { setPrimary: true } : {}),
        ...(options.dryRun === true ? { dryRun: true } : {}),
      });
      const payload = toAddProjectOutput(result);

      if (options.json) {
        printJson(payload);
        return;
      }

      printAddProjectHuman(payload);
    } catch (error) {
      this.handleFailure(
        options.json,
        {
          project: null,
          target: null,
          membership: null,
          planning_binding: null,
          dry_run: options.dryRun === true,
          status: [],
        },
        error
      );
    }
  }

  async migrateMembership(
    storeId: string,
    options: StoreMigrateMembershipOptions = {}
  ): Promise<void> {
    try {
      const result = await migrateStoreMembership({
        storeId,
        // Dry run is the default: the one non-reversible step in this command
        // (removing the legacy manifest) never happens without --apply.
        ...(options.apply === true ? { apply: true } : {}),
      });
      const payload = toMigrateMembershipOutput(result);

      if (options.json) {
        printJson(payload);
        return;
      }

      printMigrateMembershipHuman(payload);
    } catch (error) {
      this.handleFailure(
        options.json,
        {
          store: null,
          applied: false,
          converted: [],
          unresolved: [],
          store_writes: [],
          legacy_manifest_removed: false,
          legacy_manifest_path: null,
          suggested_commits: [],
          status: [],
        },
        error
      );
    }
  }

  async list(options: StoreJsonOptions = {}): Promise<void> {
    try {
      const payload = toListOutput(await listStores());

      if (options.json) {
        printJson(payload);
        return;
      }

      printListHuman(payload);
    } catch (error) {
      this.handleFailure(options.json, { stores: [], status: [] }, error);
    }
  }

  async doctor(id: string | undefined, options: StoreDoctorOptions = {}): Promise<void> {
    try {
      const payload = toDoctorOutput(
        await doctorStores(id, options.projectNamespace ? 'project' : undefined)
      );

      // Drift diagnostics for the current project root (D7): pointer to an
      // unregistered store, ambiguous shape+pointer, and manifest/store
      // mismatch. Only meaningful when running from a project root, so a
      // failure to resolve degrades to no drift rather than an error.
      //
      // Membership joins them on the same terms and for the same reason: it is
      // a fact about the CURRENT project, so it is reported when the command
      // inspects the machine rather than one named store, alongside its two
      // siblings. Read-only, from the same provider `rasen doctor` uses and
      // rendered from the same structure, so the two commands cannot report
      // different codes or different repairs for one state.
      let drift: StoreDiagnostic[] = [];
      let declaration: UnavailableStoreBinding | null = null;
      let membership: MembershipHealth | null = null;
      if (id === undefined) {
        drift = await diagnoseMigrationDrift(process.cwd()).catch(() => []);
        declaration = await unavailableProjectDeclaration();
        const projectRoot = findRepoPlanningRootSync(process.cwd());
        membership = projectRoot ? await gatherProjectMembership(projectRoot) : null;
      }
      const declarationReport = declaration
        ? {
            reason: declaration.reason,
            repair: declaration.repair,
            status: declaration.diagnostics,
          }
        : null;

      // This command is a carve-out from failing closed (design D4) so a user
      // can diagnose a broken declaration — but it reports a broken machine,
      // so it must not exit 0 while doing it.
      if (declaration) {
        process.exitCode = 1;
      }

      if (options.json) {
        printJson({
          ...payload,
          projectDrift: drift,
          projectStore: declarationReport,
          membership,
        });
        return;
      }

      printDoctorHuman(payload);
      if (membership) {
        console.log('');
        console.log(
          'Store membership (roster and eligibility only; it does not decide where work is done)'
        );
        for (const line of membershipHumanLines(membership)) {
          console.log(line);
        }
      }
      if (declarationReport) {
        console.log('');
        console.log('Declared store:');
        console.log(`  - Not available on this machine (${declarationReport.reason}).`);
        for (const status of declarationReport.status) {
          console.log(`  - [${status.severity}] ${status.message}`);
          if (status.fix) console.log(`    Fix: ${status.fix}`);
        }
        for (const repair of declarationReport.repair) {
          console.log(`    Next: ${repair}`);
        }
      }
      if (drift.length > 0) {
        console.log('');
        console.log('Current project drift:');
        for (const status of drift) {
          console.log(`  - [${status.severity}] ${status.message}`);
          if (status.fix) console.log(`    Fix: ${status.fix}`);
        }
      }
    } catch (error) {
      this.handleFailure(options.json, { stores: [], status: [] }, error);
    }
  }

  async upgradeIdentity(
    id: string,
    options: StoreUpgradeIdentityOptions = {}
  ): Promise<void> {
    try {
      const projectRoot = findRepoPlanningRootSync(process.cwd());
      const result = await upgradeStoreIdentity({
        id,
        ...(options.uid !== undefined ? { uid: options.uid } : {}),
        apply: options.apply === true && options.dryRun !== true,
        ...(projectRoot ? { projectRoot } : {}),
      });
      const payload = toUpgradeIdentityOutput(result);

      if (options.json) {
        printJson(payload);
        return;
      }

      printUpgradeIdentityHuman(payload);
    } catch (error) {
      this.handleFailure(
        options.json,
        {
          store: null,
          applied: false,
          steps: [],
          files_to_commit: [],
          repair_needed: [],
          status: [],
        },
        error
      );
    }
  }

  /**
   * Batch upgrade: migrates every registered store to a permanent identity,
   * backfills `storeMemberships` hints, and triggers the registry re-key.
   * Store-centric (no `projectRoot`); the `update` hook handles the project
   * `store:` declaration.
   */
  async upgradeIdentityAll(
    options: StoreUpgradeIdentityOptions = {}
  ): Promise<void> {
    try {
      const { migrateAllStoreIdentities, formatStoreIdentityMigrationSummary } =
        await import('../core/store/identity-migration.js');
      const result = await migrateAllStoreIdentities({
        apply: options.apply === true && options.dryRun !== true,
      });

      if (options.json) {
        printJson(result);
        return;
      }

      const lines = formatStoreIdentityMigrationSummary(result);
      if (lines.length > 0) {
        console.log(lines.join('\n'));
      }
    } catch (error) {
      this.handleFailure(
        options.json,
        {
          applied: false,
          stores: [],
          projects: [],
          registryRekeyed: false,
          registryBlockedBy: [],
          suggestedCommits: [],
          status: [],
        },
        error
      );
    }
  }

  private handleFailure<T extends { status: StoreDiagnostic[] }>(
    json: boolean | undefined,
    payload: T,
    error: unknown
  ): void {
    emitFailure(json, payload, error, 'store_error');
  }
}

export function registerStoreCommand(program: Command): void {
  const storeCommand = new StoreCommand();
  const store = program.command('store').description('');

  store
    .command('setup [name]')
    .description('')
    .option('--path <path>', '')
    .option('--init-git', '')
    .option('--no-init-git', '')
    .option('--remote <url>', '')
    .option('--layout <version>', '')
    .option('--json', '')
    .action(async (id: string | undefined, options: StoreSetupOptions) => {
      await storeCommand.setup(id, options);
    });

  store
    .command('register [path]')
    .description('')
    .option('--id <id>', '')
    .option('--yes', '')
    .option('--json', '')
    .action(async (inputPath: string | undefined, options: StoreRegisterOptions) => {
      await storeCommand.register(inputPath, options);
    });

  store
    .command('unregister <id>')
    .description('')
    .option('--project-namespace', '')
    .option('--json', '')
    .action(async (id: string, options: StoreUnregisterOptions) => {
      await storeCommand.unregister(id, options);
    });

  store
    .command('remove <id>')
    .description('')
    .option('--yes', '')
    .option('--project-namespace', '')
    .option('--json', '')
    .action(async (id: string, options: StoreRemoveOptions) => {
      await storeCommand.remove(id, options);
    });

  store
    .command('add-project <path>')
    .description('')
    .option('--to <store-id>', '')
    .option('--as <id>', '')
    .option(
      '--set-primary',
      ''
    )
    .option('--dry-run', '')
    .option('--json', '')
    .action(async (projectPath: string, options: StoreAddProjectOptions) => {
      await storeCommand.addProject(projectPath, options);
    });

  store
    .command('migrate-membership <store-id>')
    .description('')
    .option('--dry-run', '')
    .option('--apply', '')
    .option('--json', '')
    .action(async (storeId: string, options: StoreMigrateMembershipOptions) => {
      await storeCommand.migrateMembership(storeId, options);
    });

  store
    .command('migrate-layout <store-id>')
    .description('')
    .option('--mapping <path>', '')
    .option('--default-target-line <id>', '')
    .option('--include-untracked', '')
    .option('--dry-run', '')
    .option('--apply', '')
    .option('--status', '')
    .option('--resume', '')
    .option('--rollback', '')
    .option('--retire-flat', '')
    .option('--json', '')
    .action(async (storeId: string, options: StoreMigrateLayoutOptions) => {
      await runStoreMigrateLayout(storeId, options);
    });

  store
    .command('adopt [path]')
    .description('')
    .option('--to <store-id>', '')
    .option('--archive <mode>', '')
    .option('--target-line <id>', '')
    .option('--dry-run', '')
    .option('--verify-hash', '')
    .option('--json', '')
    .action(async (inputPath: string | undefined, options) => {
      await runAdopt(inputPath, options);
    });

  store
    .command('eject <project-id>')
    .description('')
    .option('--from <store-id>', '')
    .option('--all', '')
    .option('--yes', '')
    .option('--force', '')
    .option(
      '--into <path>',
      ''
    )
    .option('--dry-run', '')
    .option('--verify-hash', '')
    .option('--json', '')
    .action(async (projectId: string, options) => {
      await runEject(projectId, options);
    });

  store
    .command('upgrade-identity [id]')
    .description('')
    .option('--uid <uid>', '')
    .option('--dry-run', '')
    .option('--apply', '')
    .option('--all', '')
    .option('--json', '')
    .action(async (id: string | undefined, options: StoreUpgradeIdentityOptions) => {
      if (options.all) {
        await storeCommand.upgradeIdentityAll(options);
        return;
      }
      if (!id) {
        console.error(
          asErrorMessage(
            "Store id is required (or use '--all' to upgrade every registered store)."
          )
        );
        process.exitCode = 1;
        return;
      }
      await storeCommand.upgradeIdentity(id, options);
    });

  store
    .command('list')
    .alias('ls')
    .description('')
    .option('--json', '')
    .action(async (options: StoreJsonOptions) => {
      await storeCommand.list(options);
    });

  store
    .command('doctor [id]')
    .description('')
    .option('--project-namespace', '')
    .option('--json', '')
    .action(async (id: string | undefined, options: StoreDoctorOptions) => {
      await storeCommand.doctor(id, options);
    });

  // The cross-Issue attention scan (issue-needs-attention D3): a Store-scoped
  // FLEET read, hence a sibling of `issue` on the store tree, not one of its
  // per-Issue subcommands. Read-only: the scan composes each Issue through the
  // exact CLI status composition `show` performs (same detail, same inputs,
  // same projection), so attention and show cannot disagree about an Issue's
  // facts.
  store
    .command('attention')
    .description('')
    .option('--store <id>', '')
    .option('--issue <issue-id>', '')
    .option('--json', '')
    .action(async (options: StoreAttentionOptions) => {
      const emptyAnswer = () => ({
        narrowed: options.issue !== undefined,
        issueId: options.issue ?? null,
        scannedCount: 0,
        scanned: [] as StoreAttentionScanEntry[],
        items: [] as IssueAttentionItem[],
        counts: attentionCounts([]),
        total: 0,
      });
      try {
        // The fleet composition (issue-read-surface design D1): the scan loop
        // - the ordered per-Issue inputs, the unknown-narrowing refusal, and
        // the fail-first cross-Issue ordering - lives in `core/issue-read`,
        // where the daemon's attention path calls the same function, so the
        // two surfaces cannot assemble a scan differently. The failure
        // sentinel above stays here: it is this command's shape for a refused
        // answer, not a fact about the scan.
        const answer = await composeStoreAttention(
          StoreAggregateQuery,
          {
            ...(options.store === undefined ? {} : { store: options.store }),
            startPath: process.cwd(),
          },
          await resolveRunStateContext(process.cwd()),
          options.issue
        );
        if (options.json) {
          printJson(projectStoreAttentionForWire(answer));
          return;
        }
        renderAttentionAnswer(answer.narrowed, answer.issueId, answer.scanned, answer.items);
      } catch (error) {
        emitFailure(options.json, emptyAnswer(), error, 'store_attention_failed');
      }
    });

  registerStoreTargetLineCommand(store);
  // The bound planning/execution worktree PAIR is Store content — a standalone
  // project has no pair — and `workspace` is a retired top-level group name
  // that must stay retired, so the group lives here rather than at the root.
  registerWorkspaceCommand(store);
  // A Store-level Issue spans projects, so its commands take only `--store`.
  registerStoreIssueCommand(store);
  // The aggregate reads. They answer questions that span more than one project,
  // which is exactly what no other surface can do.
  registerStoreAggregateCommands(store);

  const lifecycleRedirects = new Set(
    (COMMAND_REGISTRY.subcommands ?? []).filter(
      (entry) =>
        entry.flags.some((flag) => flag.name === 'store') ||
        (entry.subcommands ?? []).some((subcommand) =>
          subcommand.flags.some((flag) => flag.name === 'store')
        )
    ).map((entry) => entry.name)
  );
  const storeSubcommandsLine = store.commands
    .map((subcommand) => {
      const aliases = subcommand.aliases();
      return aliases.length > 0 ? `${subcommand.name()} (${aliases.join(', ')})` : subcommand.name();
    })
    .join(', ');
  // One group action owns missing AND unknown subcommands. Known
  // subcommands dispatch above; everything else — including a bare
  // `store --json` with no operand — lands here, so the handler owns the
  // entire message and exit path (same text for human and --json). The
  // permissive flags route unknown operands/options here instead of
  // letting Commander emit a raw error before the action runs. We detect
  // `--json` in the residual args rather than declaring a group option,
  // which would otherwise shadow each subcommand's own `--json` flag.
  store.allowExcessArguments(true);
  store.allowUnknownOption(true);
  store.action(() => {
    const operands = store.args;
    // Flag values are indistinguishable from operands without a full
    // parse, so the verbatim echo only applies to plain-operand input.
    const attempted = operands.filter((operand) => !operand.startsWith('-'));
    const hasFlagLikeToken = operands.some((operand) => operand.startsWith('-'));
    // The agent contract: --json failures emit one JSON document.
    if (operands.includes('--json')) {
      const message =
        attempted.length > 0
          ? `Unknown command '${attempted[0]}' for 'rasen store'. Store subcommands: ${storeSubcommandsLine}.`
          : `Missing subcommand for 'rasen store'. Store subcommands: ${storeSubcommandsLine}.`;
      printJson({
        status: [
          {
            severity: 'error',
            code: 'unknown_store_subcommand',
            message,
            fix: 'Run a store subcommand, or use the lifecycle command with --store <id>.',
          },
        ],
      });
      process.exitCode = 1;
      return;
    }
    let example = 'rasen new change <change-id> --store <id>';
    if (!hasFlagLikeToken && attempted.length > 0 && lifecycleRedirects.has(attempted[0])) {
      if (attempted[0] === 'new') {
        const changeId = attempted[1] === 'change' && attempted[2] ? attempted[2] : '<change-id>';
        example = `rasen new change ${changeId} --store <id>`;
      } else {
        example = `rasen ${attempted.join(' ')} --store <id>`;
      }
    }
    console.error(
      attempted.length > 0
        ? `Error: unknown command '${attempted[0]}' for 'rasen store'.`
        : "Error: missing subcommand for 'rasen store'."
    );
    console.error(
      `Store subcommands manage store registration: ${storeSubcommandsLine}.`
    );
    console.error(
      'To create or work on a change in a store, use the normal command with --store, for example:'
    );
    console.error(`  ${example}`);
    process.exitCode = 1;
  });
}
