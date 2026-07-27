import type {
  CompleteRunAction,
  Digest,
  RunAction,
} from '../contracts.js';
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
      });
    case 'effect-observation':
      return domainDigest('change-run-receipt/effect-observation', {
        effectId: completion.effectId,
        status: completion.status,
        observation: completion.observation,
      });
    case 'infrastructure-observation':
      return domainDigest('change-run-receipt/infrastructure', {
        error: completion.error,
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
