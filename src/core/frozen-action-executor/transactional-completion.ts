/**
 * Frozen-action session executor: transactional completion integrity (design
 * D5; requirement "Completion evidence is published and committed
 * transactionally").
 *
 * Completion integrity is TRANSACTIONAL, not cryptographic (locked decision 12).
 * The mechanism has three composable parts, all on existing machinery:
 *
 * 1. The frozen Action authors the evidence contract (the complete set a
 *    completion must publish). The executor's evidence writer verifies that
 *    complete set is present and well-formed BEFORE publishing any of it to the
 *    durable EvidenceStore; a partial set is not published as if complete.
 * 2. The Facade's `complete` mutation re-reads the evidence set from the durable
 *    EvidenceStore and re-verifies integrity, completeness, and binding to
 *    Action/invocation/workspace-revision/actor before any Record mutation
 *    (facade-runtime.ts `verifyCompletionAuthority` -> `verifyAttestedCompletion`,
 *    which reads bytes through `evidenceStore.read`).
 * 3. The Record mutation itself is atomic under the RunStore head+1 commit; a
 *    crash between publish and Record mutation leaves a partial evidence set
 *    that the re-read completeness check rejects, so a later completion is never
 *    fooled into treating a half-set as complete.
 *
 * No signing private key is minted, held, or accepted anywhere in this path
 * (decision 12). This module mirrors the host's no-signing-key guard.
 */

import type {
  CompleteRunAction,
  Digest,
  EvidenceRef,
  RunAction,
} from '../change-run/contracts.js';
import type { CanonicalRunRecord } from '../change-run/internal/record.js';
import {
  computeEvidenceContentDigest,
  type BoundedEvidenceStore,
} from '../change-run/internal/evidence.js';
import { verifyCompletion } from '../change-run/internal/completion.js';
import { verifyAttestedCompletion } from '../change-run/internal/attestation.js';

export interface CompletionEvidenceUpload {
  readonly contentDigest: Digest;
  readonly contentBase64: string;
}

export type TransactionalCompletionErrorCode =
  | 'completion_upload_invalid'
  | 'completion_set_incomplete'
  | 'completion_set_orphaned'
  | 'completion_binding_mismatch'
  | 'completion_half_set_rejected';

export class TransactionalCompletionError extends Error {
  constructor(
    readonly code: TransactionalCompletionErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'TransactionalCompletionError';
  }
}

function decodeCanonicalBase64(value: string): Uint8Array {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) {
    throw new TransactionalCompletionError(
      'completion_upload_invalid',
      'Completion upload content is not canonical base64.'
    );
  }
  return new Uint8Array(bytes);
}

/**
 * The complete evidence set a completion must publish: the actor attestation
 * plus every evidence ref the completion carries. The frozen Action authors
 * which observations are required (encoded in its completionAuthority); the
 * attestation verifier (`verifyAttestedCompletion`) checks each ref's
 * producer/observation/schema against that frozen authority. This function
 * owns the COMPLETE-SET check: every ref the completion names must have a
 * matching upload, and every upload must be referenced. A partial set is not
 * publishable as if complete.
 */
export function verifyCompleteEvidenceSet(
  completion: CompleteRunAction,
  uploads: readonly CompletionEvidenceUpload[]
): ReadonlyMap<string, Uint8Array> {
  const byDigest = new Map<string, Uint8Array>();
  for (const upload of uploads) {
    const bytes = decodeCanonicalBase64(upload.contentBase64);
    const digest = computeEvidenceContentDigest(bytes);
    if (digest !== upload.contentDigest) {
      throw new TransactionalCompletionError(
        'completion_upload_invalid',
        `Completion upload digest mismatch for ${upload.contentDigest}.`
      );
    }
    const existing = byDigest.get(digest);
    if (existing !== undefined && !Buffer.from(existing).equals(Buffer.from(bytes))) {
      throw new TransactionalCompletionError(
        'completion_upload_invalid',
        `Completion upload ${digest} has conflicting bytes.`
      );
    }
    byDigest.set(digest, bytes);
  }

  const refs: readonly EvidenceRef[] = [completion.actorAttestation, ...completion.evidence];
  const required = new Set(refs.map((ref) => ref.contentDigest));
  for (const ref of refs) {
    if (!byDigest.has(ref.contentDigest)) {
      throw new TransactionalCompletionError(
        'completion_set_incomplete',
        `Completion EvidenceRef ${ref.evidenceDigest} has no upload; the complete set is not present.`
      );
    }
  }
  for (const digest of byDigest.keys()) {
    if (!required.has(digest)) {
      throw new TransactionalCompletionError(
        'completion_set_orphaned',
        `Completion upload ${digest} is not referenced by the completion set.`
      );
    }
  }
  return byDigest;
}

export interface PublishCompletionOptions {
  readonly completion: CompleteRunAction;
  readonly uploads: readonly CompletionEvidenceUpload[];
  readonly evidenceStore: BoundedEvidenceStore;
  /**
   * Fault-injection seam for the half-set crash test (design D5 part 3). When
   * set, the writer stages only the first `crashAfter` refs and then throws,
   * simulating a crash between partial publish and Record mutation. A later
   * `rereadVerifyCompletion` MUST reject the resulting half-set.
   */
  readonly crashAfter?: number;
}

export type PublishOutcome =
  | { readonly kind: 'published'; readonly staged: readonly Digest[] }
  | { readonly kind: 'crashed-after-partial'; readonly staged: readonly Digest[] };

/**
 * Verify the complete evidence set in memory, then publish (stage) every ref to
 * the durable EvidenceStore. Complete-set validation happens BEFORE the first
 * store write, so a partial set never reaches the store as if complete. The
 * optional `crashAfter` seam simulates a mid-publish crash for the half-set
 * guard; in that mode the writer returns `crashed-after-partial` instead of
 * throwing, so a test can then prove the re-read rejects the half-set.
 */
export function publishCompletionTransactionally(
  options: PublishCompletionOptions
): PublishOutcome {
  const { completion, uploads, evidenceStore, crashAfter } = options;
  // Complete-set validation BEFORE the first store write.
  const byDigest = verifyCompleteEvidenceSet(completion, uploads);
  const refs: readonly EvidenceRef[] = [completion.actorAttestation, ...completion.evidence];
  const staged: Digest[] = [];
  for (const ref of refs) {
    if (crashAfter !== undefined && staged.length >= crashAfter) {
      // Simulated crash between partial publish and Record mutation. The store
      // now holds a partial set; a later re-read MUST fail the completeness
      // check.
      return { kind: 'crashed-after-partial', staged: Object.freeze(staged) };
    }
    evidenceStore.stageClaimed(ref, byDigest.get(ref.contentDigest)!);
    staged.push(ref.contentDigest as Digest);
  }
  return { kind: 'published', staged: Object.freeze(staged) };
}

/**
 * Re-read and re-verify a completion's evidence set from the durable
 * EvidenceStore before any Record mutation. This is the Facade's job at
 * `verifyCompletionAuthority` (facade-runtime.ts:119-133); this function
 * exposes the same re-read/re-verify for the executor and for the half-set
 * guard. A half-set left by a mid-publish crash fails the completeness check
 * here (`evidenceStore.read` throws for the missing ref), so a later completion
 * is never fooled into treating it as complete.
 */
export function rereadVerifyCompletion(input: Readonly<{
  record: CanonicalRunRecord;
  action: RunAction;
  completion: CompleteRunAction;
  evidenceStore: Pick<BoundedEvidenceStore, 'read'>;
}>): void {
  // Binding check first: the completion must bind to the exact admitted Action.
  verifyCompletion(input.completion, input.action);
  // Re-read + re-verify every ref from the durable store. A missing ref (half-
  // set) throws here, before any Record mutation.
  try {
    verifyAttestedCompletion(
      input.record,
      input.action,
      input.completion,
      (ref) => input.evidenceStore.read(ref)
    );
  } catch (error) {
    throw new TransactionalCompletionError(
      'completion_half_set_rejected',
      `Re-read re-verify rejected the evidence set: ${(error as Error).message}`
    );
  }
}

/**
 * A mid-publish crash leaves a partial evidence set. This predicate reports
 * whether the store currently holds the COMPLETE set a completion requires, by
 * reading each ref. The half-set guard consults it: a partial set MUST report
 * false so a later completion re-read fails rather than treating it as complete.
 */
export function storeHoldsCompleteSet(
  completion: CompleteRunAction,
  evidenceStore: Pick<BoundedEvidenceStore, 'has'>
): boolean {
  const refs: readonly EvidenceRef[] = [completion.actorAttestation, ...completion.evidence];
  return refs.every((ref) => evidenceStore.has(ref));
}
