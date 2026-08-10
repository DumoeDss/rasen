/**
 * Landed-only spec synchronization.
 *
 * The mechanics do not change: the existing `findSpecUpdates` →
 * `buildUpdatedSpec` → `PreparedArchiveSpecAction` → engine `write-spec` /
 * `delete-spec` pipeline is exactly what a landed Store v2 finalization uses,
 * resolved against the project partition's canonical specs. What changes is the
 * AUTHORITY: only a landed outcome may run it at all, and the Archive v2
 * record's `specSync` is derived from the SAME prepared actions the engine
 * applies, so the record cannot describe a synchronization that did not happen.
 */
import { createHash } from 'node:crypto';

import type { PreparedArchiveSpecAction } from '../../archive-engine.js';
import { parseChangeId } from '../planning-validation.js';
import { finalizationRefusal } from './diagnostics.js';
import type { ArchiveSpecAction } from '../finalization-v2.js';

/**
 * The digest mapping. A `create` has no before; a `delete` has no after; an
 * `update` has both, and its before is the precondition digest the engine will
 * revalidate — so the record and the transaction cannot disagree about what was
 * overwritten.
 */
export function archiveSpecActionFor(
  action: PreparedArchiveSpecAction
): ArchiveSpecAction {
  const capabilityId = parseCapabilityId(action.capability);
  if (action.action === 'create') {
    if (action.targetPrecondition.state !== 'absent') {
      throw preconditionRefusal(action, 'absent');
    }
    return {
      action: 'create',
      capabilityId,
      beforeSha256: null,
      afterSha256: digestOf(action.rebuilt),
    } as ArchiveSpecAction;
  }
  if (action.targetPrecondition.state === 'absent') {
    throw preconditionRefusal(action, 'file');
  }
  const before = action.targetPrecondition.sha256;
  if (action.action === 'delete') {
    return {
      action: 'delete',
      capabilityId,
      beforeSha256: before,
      afterSha256: null,
    } as ArchiveSpecAction;
  }
  return {
    action: 'update',
    capabilityId,
    beforeSha256: before,
    afterSha256: digestOf(action.rebuilt),
  } as ArchiveSpecAction;
}

export function archiveSpecActionsFor(
  actions: readonly PreparedArchiveSpecAction[]
): ArchiveSpecAction[] {
  return actions.map(archiveSpecActionFor);
}

function digestOf(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function parseCapabilityId(capability: string): ArchiveSpecAction['capabilityId'] {
  try {
    const segments = capability.split('/');
    if (
      capability.length === 0 ||
      capability.includes('\\') ||
      segments.some(
        segment =>
          segment.length === 0 || segment === '.' || segment === '..'
      )
    ) {
      throw new Error('Capability path is not canonical.');
    }
    for (const segment of segments) {
      parseChangeId(segment, 'capabilityId');
    }
    return capability as ArchiveSpecAction['capabilityId'];
  } catch (error) {
    throw finalizationRefusal(
      'finalization_record_invalid',
      `Spec action capability '${capability}' is not a canonical capability path.`,
      {
        expected: 'a slash-delimited path of lowercase kebab capability ids',
        actual: capability,
        target: capability,
        fix: 'Rename every capability directory segment to a canonical id and rerun.',
        cause: error,
      }
    );
  }
}

/**
 * A prepared action whose target precondition contradicts its verb is a
 * PLANNING bug. Coercing it into a shape that validates would make the record
 * assert something the transaction is not going to do, so it blocks instead.
 */
function preconditionRefusal(
  action: PreparedArchiveSpecAction,
  expected: 'absent' | 'file'
): Error {
  return finalizationRefusal(
    'finalization_record_invalid',
    `Prepared spec action '${action.action}' for capability '${action.capability}' has a contradictory target precondition.`,
    {
      expected: `target precondition '${expected}'`,
      actual: `target precondition '${action.targetPrecondition.state}'`,
      target: action.target,
      fix: 'Re-plan the archive: the canonical spec changed underneath the prepared action, or the action was built for a different target.',
    }
  );
}

/**
 * The refusal for `--skip-specs` on a landed Change that carries deltas. A
 * landed record asserts `specSync.applied: true`; an empty action list would
 * make that assertion false, so the combination is refused rather than
 * recorded.
 */
export function specSkipConflict(changeId: string): Error {
  return finalizationRefusal(
    'finalization_spec_skip_conflict',
    `Change '${changeId}' carries delta specs, and a landed record asserts that spec synchronization was applied.`,
    {
      expected: 'spec synchronization applied',
      actual: '--skip-specs',
      target: changeId,
      fix: "Drop --skip-specs to land the deltas, or finalize with a passive outcome (--outcome cancelled|abandoned|superseded --reason '<why>'), which applies no delta at all.",
    }
  );
}
