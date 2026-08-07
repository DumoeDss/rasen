import type {
  CompleteRunAction,
  EvidenceRef,
  RunId,
} from '../contracts.js';
import { verifyCompletion } from './completion.js';
import { computeEvidenceContentDigest, type BoundedEvidenceStore } from './evidence.js';
import { verifyAttestedCompletion } from './attestation.js';
import type { RunStore } from './run-store.js';

export interface CompletionEvidenceUpload {
  readonly contentDigest: string;
  readonly contentBase64: string;
}

export interface HostEvidenceWriter {
  /** Verify the complete signed set in memory, then publish all objects. */
  readonly publishCompletion: (
    completion: CompleteRunAction,
    uploads: readonly CompletionEvidenceUpload[]
  ) => void;
}

export class HostEvidenceWriterError extends Error {
  constructor(
    readonly code:
      | 'completion_upload_invalid'
      | 'completion_upload_missing'
      | 'completion_upload_orphaned',
    message: string
  ) {
    super(message);
    this.name = 'HostEvidenceWriterError';
  }
}

function decodeCanonicalBase64(value: string): Uint8Array {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) {
    throw new HostEvidenceWriterError(
      'completion_upload_invalid',
      'Completion upload content is not canonical base64.'
    );
  }
  return new Uint8Array(bytes);
}

/**
 * Complete-transport writer seam. It deliberately has no raw `stageClaimed`
 * escape hatch: publication follows only after one verifier has accepted the
 * Action-frozen authority, every proof, the canonical claim and receipt.
 */
export function createHostEvidenceWriter(input: Readonly<{
  runId: RunId;
  runStore: RunStore;
  evidenceStore: BoundedEvidenceStore;
}>): HostEvidenceWriter {
  return Object.freeze({
    publishCompletion(
      completion: CompleteRunAction,
      uploads: readonly CompletionEvidenceUpload[]
    ): void {
      const record = input.runStore.load(input.runId);
      const committed = record.actions[completion.actionId];
      if (committed === undefined) {
        throw new HostEvidenceWriterError(
          'completion_upload_invalid',
          'Completion upload names an Action that is not admitted.'
        );
      }
      verifyCompletion(completion, committed.action);

      const byDigest = new Map<string, Uint8Array>();
      for (const upload of uploads) {
        const bytes = decodeCanonicalBase64(upload.contentBase64);
        const digest = computeEvidenceContentDigest(bytes);
        if (digest !== upload.contentDigest) {
          throw new HostEvidenceWriterError(
            'completion_upload_invalid',
            `Completion upload digest mismatch for ${upload.contentDigest}.`
          );
        }
        const existing = byDigest.get(digest);
        if (existing !== undefined && !Buffer.from(existing).equals(Buffer.from(bytes))) {
          throw new HostEvidenceWriterError(
            'completion_upload_invalid',
            `Completion upload ${digest} has conflicting bytes.`
          );
        }
        byDigest.set(digest, bytes);
      }

      const refs: readonly EvidenceRef[] = [
        completion.actorAttestation,
        ...completion.evidence,
      ];
      const required = new Set(refs.map((ref) => ref.contentDigest));
      for (const ref of refs) {
        if (!byDigest.has(ref.contentDigest)) {
          throw new HostEvidenceWriterError(
            'completion_upload_missing',
            `Completion EvidenceRef ${ref.evidenceDigest} has no upload.`
          );
        }
      }
      for (const digest of byDigest.keys()) {
        if (!required.has(digest)) {
          throw new HostEvidenceWriterError(
            'completion_upload_orphaned',
            `Completion upload ${digest} is not referenced by the signed submission.`
          );
        }
      }

      // Complete-set validation happens before the first store write.
      verifyAttestedCompletion(record, committed.action, completion, (ref) => {
        const bytes = byDigest.get(ref.contentDigest);
        if (bytes === undefined) {
          throw new HostEvidenceWriterError(
            'completion_upload_missing',
            `Completion EvidenceRef ${ref.evidenceDigest} has no upload.`
          );
        }
        return bytes;
      });
      for (const ref of refs) {
        input.evidenceStore.stageClaimed(ref, byDigest.get(ref.contentDigest)!);
      }
    },
  });
}
