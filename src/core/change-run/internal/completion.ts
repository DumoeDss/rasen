import type {
  CompleteRunAction,
  Digest,
  RunAction,
} from '../contracts.js';
import type { CommittedAction } from './record.js';
import { domainDigest } from './identity.js';

export type CompletionErrorCode =
  | 'completion_binding_mismatch'
  | 'completion_receipt_mismatch';

export class CompletionError extends Error {
  constructor(
    readonly code: CompletionErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'CompletionError';
  }
}

/**
 * The canonical receipt digest authenticates a completion's RESULT payload
 * (never the base context). It is recomputed from the payload, so a
 * caller-supplied digest that does not match the actual content is detected
 * as tampering — the reducer/facade never trusts a caller-supplied digest,
 * actor, result, observation, or evidence.
 */
export function computeCompletionReceiptDigest(
  completion: CompleteRunAction
): Digest {
  switch (completion.kind) {
    case 'domain-action-result':
      return domainDigest('change-run-receipt/domain-result', {
        status: completion.status,
        result: completion.result,
        actor: completion.actor,
        actorAttestation: completion.actorAttestation,
        evidence: completion.evidence,
      });
    case 'effect-observation':
      return domainDigest('change-run-receipt/effect-observation', {
        effectId: completion.effectId,
        status: completion.status,
        observation: completion.observation,
        actor: completion.actor,
        actorAttestation: completion.actorAttestation,
        evidence: completion.evidence,
      });
    case 'infrastructure-observation':
      return domainDigest('change-run-receipt/infrastructure', {
        error: completion.error,
        actor: completion.actor,
        actorAttestation: completion.actorAttestation,
        evidence: completion.evidence,
      });
  }
}

/**
 * Validate that a completion binds to the exact admitted Action it claims to
 * complete, and that its receipt digest matches its actual payload. The action
 * reference (actionId/invocationId/runId) must match; a mismatched or
 * cross-action completion is rejected without mutation.
 */
export function verifyCompletion(
  completion: CompleteRunAction,
  action: RunAction
): void {
  if (
    completion.actionId !== action.actionId ||
    completion.invocationId !== action.invocationId ||
    completion.runId !== action.runId
  ) {
    throw new CompletionError(
      'completion_binding_mismatch',
      'Completion does not bind to the exact admitted Action.'
    );
  }
  const expected = computeCompletionReceiptDigest(completion);
  if (completion.receiptDigest !== expected) {
    throw new CompletionError(
      'completion_receipt_mismatch',
      'Completion receiptDigest does not match its canonical payload digest.'
    );
  }
}

export type CompletionSlotClassification = 'new' | 'idempotent' | 'conflict';

/**
 * Per-slot receipt idempotency (tasks 6.9/6.10), independent of Record version
 * and transport-only uploads. A completion addresses exactly one slot keyed by
 * `(actionId, kind, effectId-or-domain)`:
 * - a fresh slot is `new`;
 * - a slot whose recorded receipt matches the canonical bytes is `idempotent`
 *   (a replay — e.g. a browser re-upload after response loss — commits nothing);
 * - a slot carrying a different receipt is `conflict`.
 *
 * Different effect IDs of one action are independent slots and may complete in
 * any order. The domain slot closes only after every required effect slot has
 * been observed (the reducer's existing ordering rule).
 */
export function classifyCompletionSlot(
  completion: CompleteRunAction,
  committed: CommittedAction
): CompletionSlotClassification {
  switch (completion.kind) {
    case 'domain-action-result':
      if (committed.result === undefined) return 'new';
      return committed.result.receiptDigest === completion.receiptDigest
        ? 'idempotent'
        : 'conflict';
    case 'effect-observation': {
      const effect = committed.effects.find(
        (entry) => entry.effectId === completion.effectId
      );
      if (effect === undefined) return 'conflict';
      if (effect.state === 'admitted') return 'new';
      return effect.receiptDigest === completion.receiptDigest
        ? 'idempotent'
        : 'conflict';
    }
    case 'infrastructure-observation':
      if (committed.infrastructure === undefined) return 'new';
      return committed.infrastructure.receiptDigest === completion.receiptDigest
        ? 'idempotent'
        : 'conflict';
  }
}
