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
import {
  readWorkspaceIndexDocument,
  writeWorkspaceIndexEntry,
  type WorkspaceIndexEntry,
} from '../workspace/registry.js';
import { parseBindingFact, serializeBindingFact } from '../workspace/binding.js';
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
  plan: ArchivePlan
): Promise<AssociationPhaseOutcome> {
  const finalization = plan.finalization;
  if (finalization === undefined) return 'no-op';
  const association = finalization.association;
  if (association.noop) return 'no-op';

  const planningScopeId = association.planningScopeId;
  const changeId = association.changeId;
  const expected = association.expected;
  if (planningScopeId === undefined || changeId === undefined || expected === undefined) {
    throw finalizationRefusal(
      'planning_execution_binding_mismatch',
      'The association phase was planned as active but carries no binding facts.',
      {
        expected: 'planning scope, Change alias, and both worktree sides',
        actual: '(incomplete)',
        target: plan.paths.final,
        fix: 'This is a programming error: a scope with no workspace pair must declare the phase a no-op in advance.',
      }
    );
  }

  const coordination = dependencies.coordination(association.globalDataDir);
  const document = await readWorkspaceIndexDocument(coordination, planningScopeId);
  const existing = document.entries.find(entry => entry.changeId === changeId);

  if (existing !== undefined) {
    assertIndexEntryAgrees(existing, association, plan.paths.final);
  }

  const at = plan.createdAt;
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
    // `planId` names the WORKSPACE plan that created the pair, not this
    // archive transaction. Repairing an entry writes what child 4's own repair
    // writes for an unknown plan rather than substituting a value from a
    // different id space.
    planId: existing?.planId ?? '',
    // `phase` is the WORKTREE lifecycle, and its only reader in the repository
    // is `phaseReached` in child 4's `workspace/cleanup.ts`, which reads it as
    // a `CleanupPhase` ordinal. The terminal 'complete' there means "every side
    // has already been removed", so writing it here would make a later
    // `store workspace cleanup` skip both removal loops AND the reachability
    // pre-pass, delete the index entry that named the worktrees, and report
    // success while both worktrees survive on disk and in Git — permanently
    // un-cleanable, because the second attempt no longer finds a pair.
    //
    // A finalization removes no worktree: the pair stays bound and stays
    // cleanable. So this phase never ADVANCES the lifecycle. It preserves what
    // is recorded, and derives a value only when repairing a missing entry —
    // by the same rule child 4's bind path uses, since the facts this repair
    // writes are exactly the ones that were already true on disk at plan time.
    // Finalization's durable carriers are the execution-side `finalizedChange`
    // block and the Archive v2 record, neither of which is this field.
    phase:
      existing?.phase ?? (association.workspacePairId === undefined ? 'prepared' : 'bound'),
    recordedAt: existing?.recordedAt ?? at,
    updatedAt: at,
  };
  await writeWorkspaceIndexEntry(coordination, entry);

  const associationPath = association.executionAssociationPath;
  if (associationPath !== undefined) {
    const text = await dependencies.fs.readText(associationPath);
    if (text !== null) {
      const fact = parseBindingFact(text, associationPath);
      // Only the finalized-Change fact is added. Every scope field the
      // association already declares is preserved byte-for-byte, so this write
      // introduces no fact that was not already true.
      const next = serializeFinalizedAssociation(text, fact, {
        changeId,
        outcome: finalization.outcome,
        publishedEntry: plan.paths.final,
        finalizedAt: at,
      });
      if (next !== text) {
        await dependencies.fs.writeText(associationPath, next);
      }
    }
  }

  return 'applied';
}

function assertIndexEntryAgrees(
  entry: WorkspaceIndexEntry,
  association: NonNullable<ArchivePlan['finalization']>['association'],
  publishedEntry: string
): void {
  const disagreements: Array<[string, string, string]> = [];
  if (
    association.changeInstanceId !== undefined &&
    entry.changeInstanceId !== undefined &&
    entry.changeInstanceId !== association.changeInstanceId
  ) {
    disagreements.push([
      'changeInstanceId',
      association.changeInstanceId,
      entry.changeInstanceId,
    ]);
  }
  if (
    association.workspacePairId !== undefined &&
    entry.workspacePairId !== undefined &&
    entry.workspacePairId !== association.workspacePairId
  ) {
    disagreements.push([
      'workspacePairId',
      association.workspacePairId,
      entry.workspacePairId,
    ]);
  }
  const expected = association.expected;
  if (expected !== undefined) {
    if (
      entry.planning.worktreeInstanceId.length > 0 &&
      entry.planning.worktreeInstanceId !== expected.planning.worktreeInstanceId
    ) {
      disagreements.push([
        'planning worktree',
        expected.planning.worktreeInstanceId,
        entry.planning.worktreeInstanceId,
      ]);
    }
    if (
      entry.execution.worktreeInstanceId.length > 0 &&
      entry.execution.worktreeInstanceId !== expected.execution.worktreeInstanceId
    ) {
      disagreements.push([
        'execution worktree',
        expected.execution.worktreeInstanceId,
        entry.execution.worktreeInstanceId,
      ]);
    }
  }
  if (disagreements.length === 0) return;
  throw finalizationRefusal(
    'planning_execution_binding_mismatch',
    `The recorded binding disagrees with the finalized pair: ${disagreements
      .map(([field, want, got]) => `${field} expected ${want}, recorded ${got}`)
      .join('; ')}.`,
    {
      expected: disagreements.map(([, want]) => want).join(', '),
      actual: disagreements.map(([, , got]) => got).join(', '),
      target: publishedEntry,
      fix: `Repair the binding, then re-apply the SAME plan token. The Archive entry at ${publishedEntry} is published and stays published; the journal names the unfinished phase.`,
    }
  );
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
  fact: ReturnType<typeof parseBindingFact>,
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
