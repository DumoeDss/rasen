/**
 * Association completion — a journaled phase of the transaction, not an
 * epilogue.
 *
 * The shape this must NOT take is a best-effort write after publication: a
 * crash in that window leaves a bound workspace pair pointing at a Change
 * directory that has moved, which is precisely the state child 4's index treats
 * as a conflict and refuses to operate against. So the phase sits between the
 * durable record and the removal of the active source, and the transaction does
 * not report completion until it lands.
 *
 * Failure handling follows child 4's rule exactly: a MISSING index entry is
 * repaired from what is already true on disk, a DISAGREEING one fails closed.
 * The planning-worktree marker is never touched — the worktree stays usable
 * until cleanup, which is child 4's plan/apply with its own preconditions.
 */
import type { ArchivePlan } from '../../archive-engine.js';
import { deriveWorktreeInstanceId } from '../planning-identity.js';
import { comparablePath } from '../workspace/identity.js';
import {
  AtomicWorkspaceWriteConflictError,
  type AtomicWorkspaceCarrierAuthority,
} from '../workspace/dependencies.js';
import {
  workspaceIndexRelativePath,
  type WorkspaceIndexEntry,
  type WorkspacePhase,
} from '../workspace/registry.js';
import {
  executionAssociationPath as expectedExecutionAssociationPath,
  parseBindingFact,
  serializeBindingFact,
  type BindingFact,
} from '../workspace/binding.js';
import { finalizationRefusal } from './diagnostics.js';
import type { FinalizationDependencies } from './dependencies.js';

export type AssociationPhaseOutcome = 'applied' | 'no-op';

/**
 * Completes the association. Idempotent by construction: the index entry is an
 * upsert of a derived value and the execution association is rewritten to the
 * same bytes, so re-applying the same token after an interrupted run completes
 * the phase rather than duplicating anything.
 */
export async function completeFinalizationAssociation(
  dependencies: FinalizationDependencies,
  plan: ArchivePlan,
  options: {
    readonly requireComplete?: boolean;
    readonly carriers?: readonly AtomicWorkspaceCarrierAuthority[];
    readonly carrierPrepared?: (
      authority: AtomicWorkspaceCarrierAuthority
    ) => Promise<void>;
  } = {}
): Promise<AssociationPhaseOutcome> {
  const finalization = plan.finalization;
  if (finalization === undefined) return 'no-op';
  const association = finalization.association;
  if (association.noop) return 'no-op';

  const planningScopeId = association.planningScopeId;
  const changeId = association.changeId;
  const expected = association.expected;
  const associationPath = association.executionAssociationPath;
  if (
    planningScopeId === undefined ||
    changeId === undefined ||
    expected === undefined ||
    associationPath === undefined
  ) {
    throw finalizationRefusal(
      'planning_execution_binding_mismatch',
      'The active association phase carries incomplete frozen binding facts.',
      {
        expected:
          'planning scope, Change alias, both worktree sides, and execution association path',
        actual: '(incomplete)',
        target: plan.paths.final,
        fix: 'A scope without a workspace pair must declare this phase a no-op.',
      }
    );
  }
  const associationPathFlavor =
    /^[A-Za-z]:[\\/]/u.test(expected.execution.root) ||
    expected.execution.root.startsWith('\\\\')
      ? 'win32'
      : 'native';
  const expectedAssociationPath = expectedExecutionAssociationPath(
    expected.execution.root,
    associationPathFlavor
  );
  if (
    comparablePath(associationPath, associationPathFlavor) !==
    comparablePath(expectedAssociationPath, associationPathFlavor)
  ) {
    throw bindingMismatch(
      associationPath,
      'executionAssociationPath',
      expectedAssociationPath,
      associationPath,
      plan.paths.final
    );
  }
  if (
    typeof expected.indexPlanId !== 'string' ||
    !WORKSPACE_PHASES.has(expected.indexPhase as WorkspacePhase)
  ) {
    throw bindingMismatch(
      plan.paths.final,
      'workspaceIndexFacts',
      'a frozen plan id and valid workspace phase',
      `${String(expected.indexPlanId)} / ${String(expected.indexPhase)}`,
      plan.paths.final
    );
  }
  if (
    dependencies.fs.writeTextAtomic === undefined ||
    dependencies.fs.readAtomicSnapshot === undefined
  ) {
    throw bindingMismatch(
      associationPath,
      'atomicPersistence',
      'snapshot-bound crash-safe association persistence',
      '(unavailable)',
      plan.paths.final
    );
  }

  const associationSnapshot =
    await dependencies.fs.readAtomicSnapshot(associationPath);
  const associationText = associationSnapshot.content;
  if (associationText === null) {
    throw bindingMismatch(
      associationPath,
      'execution association document',
      associationPath,
      '(missing)',
      plan.paths.final
    );
  }
  let associationFact: BindingFact;
  try {
    associationFact = parseBindingFact(associationText, associationPath);
  } catch (error) {
    throw finalizationRefusal(
      'planning_execution_binding_mismatch',
      'The execution association document is not a coherent binding.',
      {
        expected: 'the frozen Store/worktree binding',
        actual: error instanceof Error ? error.message : String(error),
        target: associationPath,
        fix: `Repair ${associationPath}, then re-apply the SAME plan token. The disagreeing document is never overwritten.`,
        cause: error,
      }
    );
  }
  assertExecutionAssociationAgrees(
    associationText,
    associationFact,
    association,
    plan,
    options.requireComplete === true
  );

  const coordination = dependencies.coordination(association.globalDataDir);
  const indexPath = coordination.resolve(
    workspaceIndexRelativePath(planningScopeId)
  );
  if (
    options.carriers?.some(
      carrier =>
        carrier.target !== associationPath && carrier.target !== indexPath
    )
  ) {
    throw bindingMismatch(
      indexPath,
      'associationCarrier.target',
      `${associationPath} or ${indexPath}`,
      options.carriers
        .map(carrier => carrier.target)
        .filter(target => target !== associationPath && target !== indexPath)
        .join(', '),
      plan.paths.final
    );
  }
  const indexSnapshot = await dependencies.fs.readAtomicSnapshot(indexPath);
  let parsedEntries: WorkspaceIndexEntry[] = [];
  if (indexSnapshot.content !== null) {
    let rawDocument: unknown;
    try {
      rawDocument = JSON.parse(indexSnapshot.content) as unknown;
    } catch {
      throw bindingMismatch(
        indexPath,
        'workspaceIndexDocument',
        'valid JSON',
        '(corrupt)',
        plan.paths.final
      );
    }
    if (
      !isAssociationRecord(rawDocument) ||
      Object.keys(rawDocument).some(
        key => !['version', 'planningScopeId', 'entries'].includes(key)
      ) ||
      rawDocument.version !== 1 ||
      rawDocument.planningScopeId !== planningScopeId ||
      !Array.isArray(rawDocument.entries)
    ) {
      throw bindingMismatch(
        indexPath,
        'workspaceIndexDocument',
        `version 1 scope ${planningScopeId}`,
        '(malformed or disagreeing)',
        plan.paths.final
      );
    }
    parsedEntries = rawDocument.entries.filter(isStrictWorkspaceIndexEntry);
    if (
      parsedEntries.length !== rawDocument.entries.length ||
      parsedEntries.some(entry => entry.planningScopeId !== planningScopeId)
    ) {
      throw bindingMismatch(
        indexPath,
        'workspaceIndexEntry',
        `complete entries belonging to scope ${planningScopeId}`,
        '(malformed or cross-scope entry)',
        plan.paths.final
      );
    }
    const seenChangeIds = new Set<string>();
    for (const candidate of parsedEntries) {
      if (seenChangeIds.has(candidate.changeId)) {
        throw bindingMismatch(
          indexPath,
          'workspaceIndexEntry.changeId',
          'unique Change aliases',
          `duplicate ${candidate.changeId}`,
          plan.paths.final
        );
      }
      seenChangeIds.add(candidate.changeId);
    }
  }

  const existing = parsedEntries.find(entry => entry.changeId === changeId);
  if (existing !== undefined) {
    assertIndexEntryAgrees(existing, association, plan.paths.final, indexPath);
  }
  if (options.requireComplete === true && existing === undefined) {
    throw bindingMismatch(
      indexPath,
      'workspaceIndexEntry',
      `the exact frozen entry for ${changeId}`,
      '(missing)',
      plan.paths.final
    );
  }
  if (options.requireComplete === true) return 'applied';
  await assertLiveWorktreePairAgrees(
    dependencies,
    association,
    plan.paths.final
  );
  const at = plan.createdAt;
  if (existing === undefined) {
    const entry: WorkspaceIndexEntry = {
      version: 1,
      planningScopeId,
      storeUid: expected.storeUid,
      storeId: expected.storeId,
      projectId: expected.projectId,
      targetLineId: expected.targetLineId,
      changeId,
      ...(association.changeInstanceId === undefined
        ? {}
        : { changeInstanceId: association.changeInstanceId }),
      ...(association.workspacePairId === undefined
        ? {}
        : { workspacePairId: association.workspacePairId }),
      planning: expected.planning,
      execution: expected.execution,
      planId: expected.indexPlanId,
      phase: expected.indexPhase as WorkspacePhase,
      recordedAt: at,
      updatedAt: at,
    };
    const nextIndexDocument = {
      version: 1 as const,
      planningScopeId,
      entries: [...parsedEntries, entry].sort((left, right) =>
        left.changeId.localeCompare(right.changeId)
      ),
    };
    try {
      await dependencies.fs.writeTextAtomic(
        indexPath,
        `${JSON.stringify(nextIndexDocument, null, 2)}\n`,
        {
          ...indexSnapshot,
          authority: options.carriers?.find(
            carrier => carrier.target === indexPath
          ),
          onPrepared: options.carrierPrepared,
        }
      );
    } catch (error) {
      if (error instanceof AtomicWorkspaceWriteConflictError) {
        throw bindingMismatch(
          error.target,
          'workspaceIndexPersistence',
          'the exact validated index snapshot',
          error.message,
          plan.paths.final
        );
      }
      throw error;
    }
  }

  const next = serializeFinalizedAssociation(
    associationText,
    associationFact,
    {
      changeId,
      outcome: finalization.outcome,
      publishedEntry: plan.paths.final,
      finalizedAt: at,
    }
  );
  if (next !== associationText) {
    try {
      await dependencies.fs.writeTextAtomic(associationPath, next, {
        ...associationSnapshot,
        authority: options.carriers?.find(
          carrier => carrier.target === associationPath
        ),
        onPrepared: options.carrierPrepared,
      });
    } catch (error) {
      if (error instanceof AtomicWorkspaceWriteConflictError) {
        throw bindingMismatch(
          error.target,
          'executionAssociationPersistence',
          'the exact validated execution association snapshot',
          error.message,
          plan.paths.final
        );
      }
      throw error;
    }
  }
  return 'applied';
}
function isAssociationRecord(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


const WORKSPACE_PHASES: ReadonlySet<WorkspacePhase> = new Set([
  'planned',
  'planning-worktree-created',
  'execution-worktree-created',
  'markers-written',
  'prepared',
  'bound',
  'removing-execution',
  'removed-execution',
  'removing-planning',
  'removed-planning',
  'pruned',
  'complete',
]);

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isStrictWorkspaceIndexEntry(
  value: unknown
): value is WorkspaceIndexEntry {
  if (!isAssociationRecord(value)) return false;
  const allowed = [
    'version',
    'planningScopeId',
    'storeUid',
    'storeId',
    'projectId',
    'targetLineId',
    'changeId',
    'changeInstanceId',
    'workspacePairId',
    'planning',
    'execution',
    'planId',
    'phase',
    'recordedAt',
    'updatedAt',
  ];
  if (Object.keys(value).some(key => !allowed.includes(key))) return false;
  const sideAgrees = (side: unknown) =>
    isAssociationRecord(side) &&
    Object.keys(side).every(key =>
      ['root', 'repositoryIdentity', 'worktreeInstanceId', 'ref', 'headOid'].includes(
        key
      )
    ) &&
    typeof side.root === 'string' &&
    typeof side.repositoryIdentity === 'string' &&
    typeof side.worktreeInstanceId === 'string' &&
    typeof side.ref === 'string' &&
    typeof side.headOid === 'string';
  return (
    value.version === 1 &&
    typeof value.planningScopeId === 'string' &&
    typeof value.storeUid === 'string' &&
    typeof value.storeId === 'string' &&
    typeof value.projectId === 'string' &&
    typeof value.targetLineId === 'string' &&
    typeof value.changeId === 'string' &&
    (value.changeInstanceId === undefined ||
      typeof value.changeInstanceId === 'string') &&
    (value.workspacePairId === undefined ||
      typeof value.workspacePairId === 'string') &&
    sideAgrees(value.planning) &&
    sideAgrees(value.execution) &&
    typeof value.planId === 'string' &&
    typeof value.phase === 'string' &&
    WORKSPACE_PHASES.has(value.phase as WorkspacePhase) &&
    isCanonicalTimestamp(value.recordedAt) &&
    isCanonicalTimestamp(value.updatedAt)
  );
}

function assertIndexEntryAgrees(
  entry: WorkspaceIndexEntry,
  association: NonNullable<ArchivePlan['finalization']>['association'],
  publishedEntry: string,
  indexPath: string
): void {
  const expected = association.expected;
  if (expected === undefined) {
    throw bindingMismatch(
      indexPath,
      'expected binding',
      'complete frozen binding facts',
      '(missing)',
      publishedEntry
    );
  }
  const disagreements: Array<[string, string, string]> = [];
  compareRequired(disagreements, 'version', '1', String(entry.version));
  compareRequired(
    disagreements,
    'planningScopeId',
    association.planningScopeId ?? '(missing)',
    entry.planningScopeId
  );
  compareRequired(disagreements, 'storeUid', expected.storeUid, entry.storeUid);
  compareRequired(disagreements, 'storeId', expected.storeId, entry.storeId);
  compareRequired(disagreements, 'projectId', expected.projectId, entry.projectId);
  compareRequired(
    disagreements,
    'targetLineId',
    expected.targetLineId,
    entry.targetLineId
  );
  compareRequired(
    disagreements,
    'changeId',
    association.changeId ?? '(missing)',
    entry.changeId
  );
  compareRequired(
    disagreements,
    'planId',
    expected.indexPlanId,
    entry.planId
  );
  compareOptional(
    disagreements,
    'changeInstanceId',
    association.changeInstanceId,
    entry.changeInstanceId
  );
  compareOptional(
    disagreements,
    'workspacePairId',
    association.workspacePairId,
    entry.workspacePairId
  );
  compareRequired(
    disagreements,
    'phase',
    expected.indexPhase,
    entry.phase
  );
  compareSide(disagreements, 'planning', expected.planning, entry.planning);
  compareSide(disagreements, 'execution', expected.execution, entry.execution);
  if (disagreements.length === 0) return;
  const error = finalizationRefusal(
    'planning_execution_binding_mismatch',
    `The recorded binding disagrees with the finalized pair: ${disagreements
      .map(([field, want, got]) => `${field} expected ${want}, recorded ${got}`)
      .join('; ')}.`,
    {
      expected: disagreements.map(([, want]) => want).join(', '),
      actual: disagreements.map(([, , got]) => got).join(', '),
      target: indexPath,
      fix: `Repair the binding, then re-apply the SAME plan token. The Archive entry at ${publishedEntry} is published and stays published; the journal names the unfinished phase.`,
    }
  );
  Object.assign(error, {
    retainedPaths: [indexPath, publishedEntry],
  });
  throw error;
}

function compareRequired(
  disagreements: Array<[string, string, string]>,
  field: string,
  expected: string,
  actual: string
): void {
  if (actual !== expected) disagreements.push([field, expected, actual]);
}

function compareOptional(
  disagreements: Array<[string, string, string]>,
  field: string,
  expected: string | undefined,
  actual: string | undefined
): void {
  // An absent optional projection field may be derived. A recorded value may
  // never be erased or replaced merely because the frozen plan omitted it.
  if (actual === undefined && expected !== undefined) return;
  if (actual !== expected) {
    disagreements.push([field, expected ?? '(absent)', actual ?? '(absent)']);
  }
}

function compareSide(
  disagreements: Array<[string, string, string]>,
  label: 'planning' | 'execution',
  expected: NonNullable<
    NonNullable<ArchivePlan['finalization']>['association']['expected']
  >['planning'],
  actual: WorkspaceIndexEntry['planning']
): void {
  compareRequired(disagreements, `${label}.root`, expected.root, actual.root);
  compareRequired(
    disagreements,
    `${label}.repositoryIdentity`,
    expected.repositoryIdentity,
    actual.repositoryIdentity
  );
  compareRequired(
    disagreements,
    `${label}.worktreeInstanceId`,
    expected.worktreeInstanceId,
    actual.worktreeInstanceId
  );
  // A binding index records the pair's immutable identity. Branch/ref movement
  // and later commits are revalidated live against the frozen plan below, but
  // do not make the already-bound pair a different pair.
}

function bindingMismatch(
  target: string,
  field: string,
  expected: string,
  actual: string,
  publishedEntry: string
): Error {
  const error = finalizationRefusal(
    'planning_execution_binding_mismatch',
    `The execution binding disagrees with the frozen plan at ${field}.`,
    {
      expected,
      actual,
      target,
      fix: `Repair ${target}, then re-apply the SAME plan token. The Archive entry at ${publishedEntry} stays published and the disagreeing binding is never overwritten.`,
    }
  );
  Object.assign(error, {
    retainedPaths: [target, publishedEntry],
  });
  return error;
}

function assertExecutionAssociationAgrees(
  originalText: string,
  fact: BindingFact,
  association: NonNullable<ArchivePlan['finalization']>['association'],
  plan: ArchivePlan,
  requireComplete: boolean
): void {
  const expected = association.expected!;
  const associationPath = association.executionAssociationPath!;
  const fields: Array<[string, string, string | undefined]> = [
    ['version', '1', String(fact.version)],
    ['storeUid', expected.storeUid, fact.storeUid],
    ['storeId', expected.storeId, fact.storeId],
    ['projectId', expected.projectId, fact.projectId],
    ['targetLineId', expected.targetLineId, fact.targetLineId],
    ['planningWorktree', expected.planning.root, fact.planningWorktree],
    ['executionRoot', expected.execution.root, fact.executionRoot],
  ];
  for (const [field, wanted, actual] of fields) {
    if (actual !== wanted) {
      throw bindingMismatch(
        associationPath,
        field,
        wanted,
        actual ?? '(missing)',
        plan.paths.final
      );
    }
  }

  let existing: Record<string, unknown>;
  try {
    existing = JSON.parse(originalText) as Record<string, unknown>;
  } catch {
    return;
  }
  if (existing.finalizedChange === undefined && !requireComplete) return;
  if (existing.finalizedChange === undefined) {
    throw bindingMismatch(
      associationPath,
      'finalizedChange',
      'the exact durable finalized Change fact',
      '(missing)',
      plan.paths.final
    );
  }
  const wanted = {
    changeId: association.changeId,
    outcome: plan.finalization!.outcome,
    publishedEntry: plan.paths.final,
    finalizedAt: plan.createdAt,
  };
  if (
    typeof existing.finalizedChange !== 'object' ||
    existing.finalizedChange === null ||
    Array.isArray(existing.finalizedChange) ||
    JSON.stringify(existing.finalizedChange) !== JSON.stringify(wanted)
  ) {
    throw bindingMismatch(
      associationPath,
      'finalizedChange',
      JSON.stringify(wanted),
      JSON.stringify(existing.finalizedChange),
      plan.paths.final
    );
  }
}

async function assertLiveWorktreePairAgrees(
  dependencies: FinalizationDependencies,
  association: NonNullable<ArchivePlan['finalization']>['association'],
  publishedEntry: string
): Promise<void> {
  const expected = association.expected!;
  for (const [label, side] of [
    ['planning', expected.planning],
    ['execution', expected.execution],
  ] as const) {
    const [paths, ref, headOid] = await Promise.all([
      dependencies.git.repositoryPaths(side.root),
      dependencies.git.checkedOutRef(side.root),
      dependencies.git.headOid(side.root),
    ]);
    if (paths === null) {
      throw bindingMismatch(
        side.root,
        `${label}.worktreeMembership`,
        side.worktreeInstanceId,
        '(unobservable)',
        publishedEntry
      );
    }
    let repositoryIdentity: string;
    let worktreeIdentity: string;
    try {
      repositoryIdentity = comparablePath(
        dependencies.fs.canonicalizeExisting(paths.commonDir),
        'native'
      );
      worktreeIdentity = comparablePath(
        dependencies.fs.canonicalizeExisting(paths.toplevel),
        'native'
      );
    } catch {
      throw bindingMismatch(
        side.root,
        `${label}.worktreeMembership`,
        side.worktreeInstanceId,
        '(uncanonicalizable)',
        publishedEntry
      );
    }
    const worktreeInstanceId = deriveWorktreeInstanceId({
      repositoryIdentity,
      worktreeIdentity,
    });
    for (const [field, wanted, actual] of [
      ['root', comparablePath(side.root, 'native'), worktreeIdentity],
      ['repositoryIdentity', side.repositoryIdentity, repositoryIdentity],
      ['worktreeInstanceId', side.worktreeInstanceId, worktreeInstanceId],
      ['ref', side.ref, ref ?? '(unobservable)'],
      ['headOid', side.headOid, headOid ?? '(unobservable)'],
    ] as const) {
      if (actual !== wanted) {
        throw bindingMismatch(
          side.root,
          `${label}.${field}`,
          wanted,
          actual,
          publishedEntry
        );
      }
    }
  }

  const registered = (await dependencies.snapshotProjects(
    association.globalDataDir
  )).filter(project => project.entry.projectId === expected.projectId);
  if (registered.length !== 1) {
    throw bindingMismatch(
      expected.execution.root,
      'project.registryMembership',
      `one registered checkout for ${expected.projectId}`,
      `${registered.length} registered checkouts`,
      publishedEntry
    );
  }
  const registeredPaths = await dependencies.git.repositoryPaths(
    registered[0]!.root
  );
  let registeredRepositoryIdentity: string | null = null;
  if (registeredPaths !== null) {
    try {
      registeredRepositoryIdentity = comparablePath(
        dependencies.fs.canonicalizeExisting(registeredPaths.commonDir),
        'native'
      );
    } catch {
      registeredRepositoryIdentity = null;
    }
  }
  if (registeredRepositoryIdentity !== expected.execution.repositoryIdentity) {
    throw bindingMismatch(
      registered[0]!.root,
      'project.repositoryIdentity',
      expected.execution.repositoryIdentity,
      registeredRepositoryIdentity ?? '(unobservable)',
      publishedEntry
    );
  }
}

interface FinalizedAssociationFacts {
  readonly changeId: string;
  readonly outcome: string;
  readonly publishedEntry: string;
  readonly finalizedAt: string;
}

/**
 * Rewrites the execution-side association document so its Change is recorded as
 * finalized. The existing declaration is preserved exactly; only a
 * `finalizedChange` block is added or replaced, so a later mutation from that
 * checkout resolves the Change as archived rather than active.
 */
export function serializeFinalizedAssociation(
  originalText: string,
  fact: BindingFact,
  finalized: FinalizedAssociationFacts
): string {
  let existing: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(originalText) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    existing = {};
  }
  const base = serializeBindingFact(fact);
  const ordered = JSON.parse(base) as Record<string, unknown>;
  for (const [key, value] of Object.entries(existing)) {
    if (!(key in ordered)) ordered[key] = value;
  }
  ordered.finalizedChange = {
    changeId: finalized.changeId,
    outcome: finalized.outcome,
    publishedEntry: finalized.publishedEntry,
    finalizedAt: finalized.finalizedAt,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
