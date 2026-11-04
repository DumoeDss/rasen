/**
 * The binding reducer: four carriers, one stated authority order.
 *
 * | carrier                    | location                                          | portable | authority                                   |
 * | Change v2 identity block   | `<change>/.openspec.yaml`, committed              | yes      | Store, project, target line, Change instance |
 * | Planning-worktree marker   | `<planningWorktree>/.rasen/planning-line.json`    | no       | this worktree's declared scope               |
 * | Execution association      | `<executionWorktree>/.rasen/planning-binding.json`| no       | this checkout's declared planning worktree   |
 * | Machine workspace index    | `<dataDir>/planning-workspaces/index/<scope>.json`| no       | nothing on its own                           |
 *
 * Committed Change metadata outranks every local carrier for identity: a marker
 * or index entry naming a different Store, project, target line, or Change
 * instance is a refusal, never a silent override. The index is re-verified
 * field by field before every use; a MISSING entry is repaired idempotently
 * from the markers and live Git, a DISAGREEING one fails closed.
 *
 * The marker and association documents deliberately use exactly the field set
 * the planning resolver already parses (`version`, `storeUid`, `storeId`,
 * `projectId`, `targetLineId`, `planningWorktree`, `executionRoot`), so a pair
 * this Module writes is readable by the scope resolver that predates it, and a
 * pair an operator assembled by hand is readable here.
 */
import { createHash } from 'node:crypto';

import type { StorePlanningPathFlavor } from '../planning-layout-v2.js';
import { storeUidsMatch } from '../identity-types.js';
import type { StoreWorkspaceDependencies } from './dependencies.js';
import { workspaceError, workspaceRefusal } from './diagnostics.js';
import { deriveWorktreeIdentity, isLinkedWorktree, pathApiFor, samePath } from './identity.js';
import {
  readWorkspaceIndexDocument,
  writeWorkspaceIndexEntry,
  type WorkspaceIndexEntry,
  type WorkspaceIndexSide,
} from './registry.js';
import type {
  WorkspaceScope,
  WorkspaceSide,
  WorkspaceVerificationFinding,
  WorktreeFacts,
} from './types.js';

export const RUN_STATE_DIR_NAME = '.rasen';
export const PLANNING_MARKER_FILE_NAME = 'planning-line.json';
export const EXECUTION_ASSOCIATION_FILE_NAME = 'planning-binding.json';

export interface BindingFact {
  readonly version: 1;
  readonly storeUid: string;
  readonly storeId: string;
  readonly projectId: string;
  readonly targetLineId: string;
  readonly planningWorktree?: string;
  readonly executionRoot?: string;
}

export function planningMarkerPath(
  planningRoot: string,
  flavor: StorePlanningPathFlavor = 'native'
): string {
  return pathApiFor(flavor).join(planningRoot, RUN_STATE_DIR_NAME, PLANNING_MARKER_FILE_NAME);
}

export function executionAssociationPath(
  executionRoot: string,
  flavor: StorePlanningPathFlavor = 'native'
): string {
  return pathApiFor(flavor).join(
    executionRoot,
    RUN_STATE_DIR_NAME,
    EXECUTION_ASSOCIATION_FILE_NAME
  );
}

/**
 * The exact bytes a marker or association file holds. Field order is fixed so
 * the digest a plan freezes is reproducible, and the trailing newline matches
 * every other machine-local document this portfolio writes.
 */
export function serializeBindingFact(fact: BindingFact): string {
  const ordered: Record<string, unknown> = {
    version: 1,
    storeUid: fact.storeUid,
    storeId: fact.storeId,
    projectId: fact.projectId,
    targetLineId: fact.targetLineId,
  };
  if (fact.planningWorktree !== undefined) ordered.planningWorktree = fact.planningWorktree;
  if (fact.executionRoot !== undefined) ordered.executionRoot = fact.executionRoot;
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function digestOf(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function readString(
  value: Record<string, unknown>,
  field: string,
  source: string
): string | undefined {
  const candidate = value[field];
  if (candidate === undefined) return undefined;
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw workspaceError(
      'workspace_marker_conflict',
      `${source}.${field} must be a non-empty string.`,
      { target: source, fix: `Repair or remove ${source}.` }
    );
  }
  return candidate;
}

/**
 * Parses one carrier document. A document that exists but cannot be read as a
 * complete declaration is a CONFLICT, not an absence: treating a corrupt marker
 * as "no marker" is exactly the fail-open this reducer exists to prevent.
 */
export function parseBindingFact(text: string, source: string): BindingFact {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    throw workspaceError('workspace_marker_conflict', `${source} is not valid JSON.`, {
      target: source,
      fix: `Repair or remove ${source}.`,
      cause: error,
    });
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw workspaceError('workspace_marker_conflict', `${source} must be a JSON object.`, {
      target: source,
      fix: `Repair or remove ${source}.`,
    });
  }
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) {
    throw workspaceError('workspace_marker_conflict', `${source}.version must be 1.`, {
      target: source,
      fix: `Repair or remove ${source}.`,
    });
  }
  const storeUid = readString(value, 'storeUid', source);
  const storeId = readString(value, 'storeId', source);
  const projectId = readString(value, 'projectId', source);
  const targetLineId = readString(value, 'targetLineId', source);
  const missing = [
    ['storeUid', storeUid],
    ['storeId', storeId],
    ['projectId', projectId],
    ['targetLineId', targetLineId],
  ]
    .filter(([, candidate]) => candidate === undefined)
    .map(([field]) => field as string);
  if (missing.length > 0) {
    throw workspaceError(
      'workspace_marker_conflict',
      `${source} declares no ${missing.join(', ')}; a marker must declare the resolved Store, project, and target line.`,
      {
        target: source,
        fix: `Re-prepare the workspace with 'rasen store workspace plan' so the marker is written completely, or repair ${source} by hand.`,
      }
    );
  }
  return {
    version: 1,
    storeUid: storeUid as string,
    storeId: storeId as string,
    projectId: projectId as string,
    targetLineId: targetLineId as string,
    ...(readString(value, 'planningWorktree', source) === undefined
      ? {}
      : { planningWorktree: readString(value, 'planningWorktree', source) as string }),
    ...(readString(value, 'executionRoot', source) === undefined
      ? {}
      : { executionRoot: readString(value, 'executionRoot', source) as string }),
  };
}

export async function readBindingFact(
  dependencies: StoreWorkspaceDependencies,
  filePath: string
): Promise<{ readonly fact: BindingFact; readonly text: string } | null> {
  const text = await dependencies.fs.readText(filePath);
  if (text === null) return null;
  return { fact: parseBindingFact(text, filePath), text };
}

/**
 * Refuses a carrier whose declared scope contradicts the authoritative one.
 * Committed Change metadata and explicit selectors reach here as `expected`.
 */
export function assertCarrierAgreesWithScope(
  fact: BindingFact,
  scope: Pick<WorkspaceScope, 'storeUid' | 'projectId' | 'targetLineId'>,
  source: string
): void {
  if (!storeUidsMatch(fact.storeUid, scope.storeUid)) {
    throw workspaceRefusal(
      'workspace_marker_conflict',
      `${source} declares Store '${fact.storeUid}', which contradicts the Change's committed identity.`,
      {
        expected: scope.storeUid,
        actual: fact.storeUid,
        target: source,
        fix: `Correct ${source} or address the pair that actually holds this Change; neither carrier is rewritten to agree.`,
      }
    );
  }
  if (fact.projectId !== scope.projectId) {
    throw workspaceRefusal(
      'workspace_marker_conflict',
      `${source} declares project '${fact.projectId}', which contradicts the Change's committed identity.`,
      {
        expected: scope.projectId,
        actual: fact.projectId,
        target: source,
        fix: `Correct ${source} or address the pair that actually holds this Change; neither carrier is rewritten to agree.`,
      }
    );
  }
  if (fact.targetLineId !== scope.targetLineId) {
    throw workspaceRefusal(
      'workspace_marker_conflict',
      `${source} declares target line '${fact.targetLineId}', which contradicts the Change's committed identity.`,
      {
        expected: scope.targetLineId,
        actual: fact.targetLineId,
        target: source,
        fix: `Correct ${source} or address the pair that actually holds this Change; neither carrier is rewritten to agree.`,
      }
    );
  }
}

// -----------------------------------------------------------------------------
// Live worktree facts
// -----------------------------------------------------------------------------

export async function surveyWorktree(
  dependencies: StoreWorkspaceDependencies,
  input: {
    readonly side: WorkspaceSide;
    readonly root: string;
    readonly repositoryRoot: string;
    readonly flavor: StorePlanningPathFlavor;
  }
): Promise<WorktreeFacts> {
  const kind = await dependencies.fs.statKind(input.root);
  if (kind !== 'directory') {
    return {
      side: input.side,
      root: input.root,
      repositoryRoot: input.repositoryRoot,
      exists: false,
    };
  }
  const identity = await deriveWorktreeIdentity(dependencies, input.root, input.flavor);
  if (identity === null) {
    return {
      side: input.side,
      root: input.root,
      repositoryRoot: input.repositoryRoot,
      exists: true,
    };
  }
  const linked = await isLinkedWorktree(dependencies, input.root, input.flavor);
  const ref = await dependencies.git.checkedOutRef(input.root);
  const headOid = await dependencies.git.headOid(input.root);
  return {
    side: input.side,
    root: input.root,
    repositoryRoot: input.repositoryRoot,
    exists: true,
    ...(linked === null ? {} : { linked }),
    worktreeInstanceId: identity.worktreeInstanceId,
    repositoryIdentity: identity.repositoryIdentity,
    ...(ref === null ? {} : { ref }),
    ...(headOid === null ? {} : { headOid }),
  };
}

// -----------------------------------------------------------------------------
// Index verification, repair, and ambiguity
// -----------------------------------------------------------------------------

export interface IndexVerification {
  readonly entry: WorkspaceIndexEntry;
  readonly planning: WorktreeFacts;
  readonly execution: WorktreeFacts;
  readonly findings: readonly WorkspaceVerificationFinding[];
  /** True when every recorded field still re-derives from live Git. */
  readonly consistent: boolean;
}

function sideFinding(
  side: WorkspaceSide,
  code: string,
  message: string,
  expected?: string,
  actual?: string
): WorkspaceVerificationFinding {
  return {
    code,
    severity: 'error',
    message: `${side}: ${message}`,
    ...(expected === undefined ? {} : { expected }),
    ...(actual === undefined ? {} : { actual }),
  };
}

/**
 * Re-derives every recorded field before the entry is used. A failing
 * re-verification is a CONFLICT — the entry is not truth and is not repaired
 * into agreement; the operation refuses and the disagreement is reported.
 */
export async function verifyIndexEntry(
  dependencies: StoreWorkspaceDependencies,
  entry: WorkspaceIndexEntry,
  flavor: StorePlanningPathFlavor
): Promise<IndexVerification> {
  const findings: WorkspaceVerificationFinding[] = [];
  const sides: Array<[WorkspaceSide, WorkspaceIndexSide]> = [
    ['planning', entry.planning],
    ['execution', entry.execution],
  ];
  const facts: Partial<Record<WorkspaceSide, WorktreeFacts>> = {};

  for (const [side, recorded] of sides) {
    const live = await surveyWorktree(dependencies, {
      side,
      root: recorded.root,
      repositoryRoot: recorded.root,
      flavor,
    });
    facts[side] = live;
    if (!live.exists) {
      findings.push(
        sideFinding(side, 'workspace_worktree_absent', `recorded worktree ${recorded.root} is gone`, recorded.root, '(absent)')
      );
      continue;
    }
    if (live.worktreeInstanceId === undefined) {
      findings.push(
        sideFinding(
          side,
          'workspace_worktree_not_a_repository',
          `recorded worktree ${recorded.root} is no longer a worktree of the recorded repository`,
          recorded.repositoryIdentity,
          '(not a Git work tree)'
        )
      );
      continue;
    }
    if (live.worktreeInstanceId !== recorded.worktreeInstanceId) {
      findings.push(
        sideFinding(
          side,
          'workspace_worktree_identity_drift',
          `recorded worktree instance does not re-derive at ${recorded.root}`,
          recorded.worktreeInstanceId,
          live.worktreeInstanceId
        )
      );
    }
    if (live.repositoryIdentity !== recorded.repositoryIdentity) {
      findings.push(
        sideFinding(
          side,
          'workspace_repository_identity_drift',
          `recorded worktree ${recorded.root} now belongs to a different repository`,
          recorded.repositoryIdentity,
          live.repositoryIdentity ?? '(unknown)'
        )
      );
    }
    if (live.ref !== recorded.ref) {
      findings.push(
        sideFinding(
          side,
          'workspace_ref_drift',
          `recorded worktree ${recorded.root} is on another ref`,
          recorded.ref,
          live.ref ?? '(detached)'
        )
      );
    }
  }

  return {
    entry,
    planning: facts.planning as WorktreeFacts,
    execution: facts.execution as WorktreeFacts,
    findings,
    consistent: findings.length === 0,
  };
}

export interface RepairIndexEntryInput {
  readonly scope: WorkspaceScope;
  readonly changeId: string;
  readonly planning: WorktreeFacts;
  readonly execution: WorktreeFacts;
  readonly planId: string;
  readonly changeInstanceId?: string;
  readonly workspacePairId?: string;
  readonly phase: WorkspaceIndexEntry['phase'];
  readonly at: string;
}

/**
 * Builds the entry a repair writes. It derives every field from live Git and
 * the markers, so it cannot introduce a fact — only cache one. `recordedAt`
 * and `updatedAt` both come from the supplied instant, which is what makes a
 * repeated repair byte-stable.
 */
export function buildIndexEntry(input: RepairIndexEntryInput): WorkspaceIndexEntry {
  const side = (facts: WorktreeFacts): WorkspaceIndexSide => ({
    root: facts.root,
    repositoryIdentity: facts.repositoryIdentity ?? '',
    worktreeInstanceId: facts.worktreeInstanceId ?? '',
    ref: facts.ref ?? '',
    headOid: facts.headOid ?? '',
  });
  return {
    version: 1,
    planningScopeId: input.scope.planningScopeId,
    storeUid: input.scope.storeUid,
    storeId: input.scope.storeId,
    projectId: input.scope.projectId,
    targetLineId: input.scope.targetLineId,
    changeId: input.changeId,
    ...(input.changeInstanceId === undefined
      ? {}
      : { changeInstanceId: input.changeInstanceId }),
    ...(input.workspacePairId === undefined
      ? {}
      : { workspacePairId: input.workspacePairId }),
    planning: side(input.planning),
    execution: side(input.execution),
    planId: input.planId,
    phase: input.phase,
    recordedAt: input.at,
    updatedAt: input.at,
  };
}

/**
 * Repairs a MISSING entry from the markers and live Git. Idempotent: the entry
 * is derived, and re-running it produces byte-identical state because
 * `recordedAt` is preserved from the entry already on disk when there is one.
 */
export async function repairMissingIndexEntry(
  dependencies: StoreWorkspaceDependencies,
  input: RepairIndexEntryInput & { readonly globalDataDir?: string }
): Promise<WorkspaceIndexEntry> {
  const coordination = dependencies.coordination(input.globalDataDir);
  const document = await readWorkspaceIndexDocument(coordination, input.scope.planningScopeId);
  const existing = document.entries.find((entry) => entry.changeId === input.changeId);
  const built = buildIndexEntry(input);
  const entry: WorkspaceIndexEntry =
    existing === undefined ? built : { ...built, recordedAt: existing.recordedAt };
  await writeWorkspaceIndexEntry(coordination, entry);
  return entry;
}

/**
 * Two entries claiming one execution worktree, or two planning worktrees
 * claiming one Change instance. Lists every claimant and chooses none.
 */
export function detectBindingAmbiguity(
  entries: readonly WorkspaceIndexEntry[],
  flavor: StorePlanningPathFlavor
): void {
  const byExecution = new Map<string, WorkspaceIndexEntry[]>();
  const byChangeInstance = new Map<string, WorkspaceIndexEntry[]>();
  for (const entry of entries) {
    const executionKey = entry.execution.worktreeInstanceId;
    if (executionKey.length > 0) {
      byExecution.set(executionKey, [...(byExecution.get(executionKey) ?? []), entry]);
    }
    if (entry.changeInstanceId !== undefined) {
      byChangeInstance.set(entry.changeInstanceId, [
        ...(byChangeInstance.get(entry.changeInstanceId) ?? []),
        entry,
      ]);
    }
  }

  for (const [executionInstance, claimants] of byExecution) {
    if (claimants.length < 2) continue;
    throw workspaceRefusal(
      'workspace_binding_ambiguous',
      `Execution worktree ${claimants[0]?.execution.root ?? executionInstance} is claimed by ${claimants.length} bindings: ${claimants
        .map((entry) => `${entry.changeId} (planning ${entry.planning.root})`)
        .join('; ')}.`,
      {
        expected: '1 claimant',
        actual: `${claimants.length} claimants`,
        target: claimants[0]?.execution.root ?? executionInstance,
        fix: 'Clean up the workspaces that no longer apply (rasen store workspace cleanup --change <id>); Rasen lists every claimant and chooses none.',
      }
    );
  }

  for (const [changeInstanceId, claimants] of byChangeInstance) {
    const planningInstances = new Set(
      claimants.map((entry) => entry.planning.worktreeInstanceId)
    );
    if (planningInstances.size < 2) continue;
    throw workspaceRefusal(
      'workspace_binding_ambiguous',
      `Change instance ${changeInstanceId} is claimed by ${planningInstances.size} planning worktrees: ${claimants
        .map((entry) => entry.planning.root)
        .join('; ')}.`,
      {
        expected: '1 planning worktree',
        actual: `${planningInstances.size} planning worktrees`,
        target: changeInstanceId,
        fix: 'Remove the planning worktrees that no longer apply; a Change instance belongs to exactly one pair.',
      }
    );
  }

  // Two entries recording the SAME planning worktree for different Changes is
  // the `workspace_already_bound` case, which is decided by the caller that
  // knows which Change it is creating; ambiguity here is only about one
  // artifact having two claimants that disagree.
  void flavor;
}

/**
 * The other half of the pair, when the execution association names it. Never
 * inferred from an adjacent directory, a branch name, or the Store integration
 * checkout.
 */
export function requirePlanningSideFrom(
  association: BindingFact,
  associationPath: string
): string {
  if (association.planningWorktree === undefined) {
    throw workspaceRefusal(
      'planning_execution_binding_missing',
      `${associationPath} records no planning worktree for this execution checkout.`,
      {
        expected: 'a recorded planning worktree',
        actual: '(none)',
        target: associationPath,
        fix: "Prepare the pair with 'rasen store workspace plan' and 'rasen store workspace apply'. Rasen never infers a planning worktree from an adjacent directory or the Store integration checkout.",
      }
    );
  }
  return association.planningWorktree;
}

/** Do the two carriers name each other? */
export function assertPairAgrees(
  input: {
    readonly marker: BindingFact;
    readonly markerPath: string;
    readonly association: BindingFact;
    readonly associationPath: string;
    readonly planningRoot: string;
    readonly executionRoot: string;
    readonly flavor: StorePlanningPathFlavor;
  }
): void {
  const declaredPlanning = requirePlanningSideFrom(input.association, input.associationPath);
  if (!samePath(declaredPlanning, input.planningRoot, input.flavor)) {
    throw workspaceRefusal(
      'planning_execution_binding_mismatch',
      `${input.associationPath} names a different planning worktree than the one in hand.`,
      {
        expected: input.planningRoot,
        actual: declaredPlanning,
        target: input.associationPath,
        fix: 'Correct the association or address the pair it names; Rasen picks no winner between disagreeing carriers.',
      }
    );
  }
  if (
    input.marker.executionRoot !== undefined &&
    !samePath(input.marker.executionRoot, input.executionRoot, input.flavor)
  ) {
    throw workspaceRefusal(
      'planning_execution_binding_mismatch',
      `${input.markerPath} names a different execution worktree than the one in hand.`,
      {
        expected: input.executionRoot,
        actual: input.marker.executionRoot,
        target: input.markerPath,
        fix: 'Correct the marker or address the pair it names.',
      }
    );
  }
  if (
    !storeUidsMatch(input.marker.storeUid, input.association.storeUid) ||
    input.marker.projectId !== input.association.projectId ||
    input.marker.targetLineId !== input.association.targetLineId
  ) {
    throw workspaceRefusal(
      'planning_execution_binding_mismatch',
      'The planning marker and the execution association declare different scopes.',
      {
        expected: `${input.marker.storeUid}/${input.marker.projectId}/${input.marker.targetLineId}`,
        actual: `${input.association.storeUid}/${input.association.projectId}/${input.association.targetLineId}`,
        target: input.associationPath,
        fix: 'Correct whichever carrier is stale; Rasen never rewrites one to agree with the other.',
      }
    );
  }
}
