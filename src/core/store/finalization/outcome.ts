/**
 * Outcome resolution: the request half of the four terminal states.
 *
 * There is no second outcome parser here. Shape is decided by child 1's
 * `validateFinalizationOutcome`, the canonical validator; this module only
 * builds the request from the command surface's options, refuses the
 * combinations that cannot be expressed at all, and refuses them BEFORE any
 * filesystem or Git access — which is what makes "a contradictory combination
 * is refused before any access" a property rather than an ordering accident.
 */
import {
  parseFinalizationOutcome,
  validateFinalizationOutcome,
  type FinalizationOutcome,
} from '../finalization-v2.js';
import { finalizationError, finalizationRefusal } from './diagnostics.js';
import {
  FINALIZATION_OUTCOMES,
  type FinalizationOutcomeName,
  type FinalizationOutcomeRequest,
} from './types.js';

const OUTCOME_MENU =
  "landed (no reason, proves its code commit), superseded (reason + --by <changeInstanceId>), cancelled (reason), abandoned (reason)";

export interface ResolvedOutcomeRequest {
  readonly outcome: FinalizationOutcomeName;
  readonly reason: string | null;
  readonly supersededBy: string | null;
  readonly byTargetLine: string | null;
  readonly commit: string | null;
}

function isOutcomeName(value: string): value is FinalizationOutcomeName {
  return (FINALIZATION_OUTCOMES as readonly string[]).includes(value);
}

/**
 * Builds and checks the request. Every refusal here is reachable with no I/O
 * whatsoever, so a Store v2 archive that names no outcome — or names a
 * contradictory combination — never reads a planning file, never runs Git, and
 * never touches the destination.
 */
export function resolveFinalizationOutcomeRequest(
  request: FinalizationOutcomeRequest
): ResolvedOutcomeRequest {
  const raw = request.outcome?.trim();
  if (raw === undefined || raw.length === 0) {
    throw finalizationError(
      'finalization_outcome_required',
      `A Store v2 Change ends in exactly one explicitly declared outcome, and there is no default: ${OUTCOME_MENU}.`,
      {
        target: '--outcome',
        fix: "Rerun with --outcome landed, or --outcome <superseded|cancelled|abandoned> --reason '<why>' (superseded also needs --by <changeInstanceId>). Nothing was read or written.",
      }
    );
  }
  if (!isOutcomeName(raw)) {
    throw finalizationRefusal(
      'finalization_outcome_invalid',
      `'${raw}' is not a finalization outcome.`,
      {
        expected: FINALIZATION_OUTCOMES.join(', '),
        actual: raw,
        target: '--outcome',
        fix: `Choose one of: ${OUTCOME_MENU}.`,
      }
    );
  }

  const reason = request.reason?.trim() ?? '';
  const by = request.by?.trim() ?? '';
  const byTargetLine = request.byTargetLine?.trim() ?? '';
  const commit = request.commit?.trim() ?? '';

  if (raw !== 'superseded' && by.length > 0) {
    throw finalizationRefusal(
      'finalization_outcome_invalid',
      'A successor is only meaningful for a superseded outcome.',
      {
        expected: 'superseded',
        actual: raw,
        target: '--by',
        fix: "Drop --by, or finalize as --outcome superseded --reason '<why>' --by <changeInstanceId>.",
      }
    );
  }
  if (raw !== 'superseded' && byTargetLine.length > 0) {
    throw finalizationRefusal(
      'finalization_outcome_invalid',
      'A successor search filter is only meaningful for a superseded outcome.',
      {
        expected: 'superseded',
        actual: raw,
        target: '--by-target-line',
        fix: 'Drop --by-target-line; it narrows the successor search and nothing else.',
      }
    );
  }
  if (raw === 'landed' && reason.length > 0) {
    throw finalizationRefusal(
      'finalization_outcome_invalid',
      'A landed outcome carries no reason; it carries a proof.',
      {
        expected: 'no reason',
        actual: reason,
        target: '--reason',
        fix: 'Drop --reason. A landed record states the commit and the ref it is reachable from.',
      }
    );
  }
  if (raw !== 'landed' && reason.length === 0) {
    throw finalizationRefusal(
      'finalization_outcome_invalid',
      `Outcome '${raw}' requires a non-empty reason; a passive outcome is the only record of why the work ended.`,
      {
        expected: 'a non-empty reason',
        actual: request.reason === undefined ? '(none)' : '(whitespace only)',
        target: '--reason',
        fix: `Rerun with --outcome ${raw} --reason '<why>'.`,
      }
    );
  }
  if (raw === 'superseded' && by.length === 0) {
    throw finalizationRefusal(
      'finalization_outcome_invalid',
      'A superseded outcome names the Change instance that replaces this one.',
      {
        expected: 'a Change instance id',
        actual: '(none)',
        target: '--by',
        fix: "Rerun with --by <changeInstanceId>. Rasen resolves it to real committed scope evidence; a Change alias, a directory, or a branch name is never accepted.",
      }
    );
  }
  if (raw !== 'landed' && commit.length > 0) {
    throw finalizationRefusal(
      'finalization_outcome_invalid',
      'A commit is only meaningful for a landed outcome.',
      {
        expected: 'landed',
        actual: raw,
        target: '--commit',
        fix: 'Drop --commit. A passive outcome records no code merge.',
      }
    );
  }

  return {
    outcome: raw,
    reason: raw === 'landed' ? null : reason,
    supersededBy: raw === 'superseded' ? by : null,
    byTargetLine: byTargetLine.length > 0 ? byTargetLine : null,
    commit: commit.length > 0 ? commit : null,
  };
}

/** The canonical validator's view of the same request. */
export function canonicalOutcomeValue(
  resolved: ResolvedOutcomeRequest
): Record<string, unknown> {
  if (resolved.outcome === 'landed') return { outcome: 'landed' };
  if (resolved.outcome === 'superseded') {
    return {
      outcome: 'superseded',
      reason: resolved.reason,
      supersededBy: resolved.supersededBy,
    };
  }
  return { outcome: resolved.outcome, reason: resolved.reason };
}

/**
 * Runs the request through child 1's validator so shape and cross-field rules
 * are decided in exactly one place. `successorScope` is supplied only once the
 * successor has been resolved to real evidence.
 */
export function validateResolvedOutcome(
  resolved: ResolvedOutcomeRequest,
  currentScope: {
    storeUid: string;
    projectId: string;
    targetLineId: string;
    changeInstanceId: string;
  },
  successorScope?: {
    storeUid: string;
    projectId: string;
    targetLineId: string;
    changeInstanceId: string;
  }
): FinalizationOutcome {
  const value = canonicalOutcomeValue(resolved);
  try {
    return successorScope === undefined
      ? validateFinalizationOutcome(value, currentScope)
      : validateFinalizationOutcome(value, currentScope, successorScope);
  } catch (error) {
    throw finalizationRefusal(
      'finalization_outcome_invalid',
      error instanceof Error ? error.message : String(error),
      {
        target: '--outcome',
        fix: 'Correct the outcome, its reason, or its successor and rerun.',
        cause: error,
      }
    );
  }
}

export { parseFinalizationOutcome };
