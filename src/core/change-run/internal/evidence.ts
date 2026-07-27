import { createHash } from 'node:crypto';

import type {
  Digest,
  EvidenceRef,
} from '../contracts.js';
import { domainDigest } from './identity.js';

export type EvidenceErrorCode =
  | 'evidence_content_mismatch'
  | 'evidence_size_mismatch'
  | 'evidence_identity_mismatch'
  | 'evidence_binding_mismatch';

export class EvidenceError extends Error {
  constructor(
    readonly code: EvidenceErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'EvidenceError';
  }
}

export interface EvidenceBinding {
  readonly planningSpaceId: EvidenceRef['binding']['planningSpaceId'];
  readonly changeInstanceId: EvidenceRef['binding']['changeInstanceId'];
  readonly projectId: string;
  readonly changeId: string;
  readonly runId: EvidenceRef['binding']['runId'];
  readonly actionId: EvidenceRef['binding']['actionId'];
  readonly schema: string;
  readonly effectId?: EvidenceRef['binding']['effectId'];
  readonly treeDigest?: Digest;
}

export interface EvidenceProducer {
  readonly id: string;
  readonly version: string;
  readonly identityDigest: Digest;
}

export interface BuildEvidenceInput {
  readonly content: Uint8Array;
  readonly mediaType: string;
  readonly observationKind: string;
  readonly producer: EvidenceProducer;
  readonly binding: EvidenceBinding;
}

/** Content-addressed digest of raw evidence bytes. */
export function computeEvidenceContentDigest(content: Uint8Array): Digest {
  return `sha256:${createHash('sha256').update(content).digest('hex')}` as Digest;
}

/**
 * The canonical evidence-ref identity digest, computed over every field EXCEPT
 * the digest itself (so a tampered ref is detectable). The ref is path-free:
 * it carries digests only, never a filesystem path.
 */
export function computeEvidenceRefDigest(
  ref: Omit<EvidenceRef, 'evidenceDigest'>
): Digest {
  return domainDigest('change-run-evidence-ref/1', ref);
}

export function buildEvidenceRef(input: BuildEvidenceInput): EvidenceRef {
  const base = {
    format: 'change-run-evidence-ref/1' as const,
    store: 'change-run' as const,
    contentDigest: computeEvidenceContentDigest(input.content),
    mediaType: input.mediaType,
    size: input.content.byteLength,
    observationKind: input.observationKind,
    producer: input.producer,
    binding: input.binding,
  };
  return {
    ...base,
    evidenceDigest: computeEvidenceRefDigest(base),
  } as EvidenceRef;
}

/**
 * Verify that the supplied bytes match the ref's contentDigest and recorded
 * size. Fail-closed on any mismatch (tamper, relabel, truncation).
 */
export function verifyEvidenceContent(
  ref: EvidenceRef,
  content: Uint8Array
): void {
  if (ref.size !== content.byteLength) {
    throw new EvidenceError(
      'evidence_size_mismatch',
      'Evidence content size does not match the recorded ref.'
    );
  }
  if (ref.contentDigest !== computeEvidenceContentDigest(content)) {
    throw new EvidenceError(
      'evidence_content_mismatch',
      'Evidence contentDigest does not match the supplied bytes.'
    );
  }
}

/** Verify the ref's identity digest matches its canonical fields (anti-tamper). */
export function verifyEvidenceRefIdentity(ref: EvidenceRef): void {
  const { evidenceDigest: _omit, ...rest } = ref;
  if (ref.evidenceDigest !== computeEvidenceRefDigest(rest)) {
    throw new EvidenceError(
      'evidence_identity_mismatch',
      'EvidenceRef evidenceDigest does not match its canonical identity.'
    );
  }
}

/** Verify the ref binds to the exact Run/Action/context it claims. */
export function verifyEvidenceBinding(
  ref: EvidenceRef,
  expected: EvidenceBinding
): void {
  const b = ref.binding;
  if (
    b.planningSpaceId !== expected.planningSpaceId ||
    b.changeInstanceId !== expected.changeInstanceId ||
    b.projectId !== expected.projectId ||
    b.changeId !== expected.changeId ||
    b.runId !== expected.runId ||
    b.actionId !== expected.actionId ||
    b.schema !== expected.schema ||
    b.effectId !== expected.effectId ||
    b.treeDigest !== expected.treeDigest
  ) {
    throw new EvidenceError(
      'evidence_binding_mismatch',
      'EvidenceRef binding does not match the expected Run/Action context.'
    );
  }
}

/**
 * A local-substitutable content-addressed evidence store (task 7.2). It holds
 * bytes keyed by content digest and exposes no writable path; the filesystem
 * implementation is a drop-in substitute with the same surface. Reads return
 * the exact bytes that were staged, so verification is TOCTOU-free at this
 * layer — the bytes a ref was built over are the bytes a verifier sees.
 */
export interface EvidenceStore {
  readonly stage: (content: Uint8Array) => Digest;
  readonly read: (ref: EvidenceRef) => Uint8Array;
  readonly has: (ref: EvidenceRef) => boolean;
}

export function createInMemoryEvidenceStore(): EvidenceStore {
  const entries = new Map<string, Uint8Array>();
  const store: EvidenceStore = {
    stage(content: Uint8Array): Digest {
      const digest = computeEvidenceContentDigest(content);
      if (!entries.has(digest)) {
        entries.set(digest, content.slice());
      }
      return digest;
    },
    read(ref: EvidenceRef): Uint8Array {
      const bytes = entries.get(ref.contentDigest);
      if (bytes === undefined) {
        throw new EvidenceError(
          'evidence_content_mismatch',
          'No staged content matches this evidence ref.'
        );
      }
      return bytes;
    },
    has(ref: EvidenceRef): boolean {
      return entries.has(ref.contentDigest);
    },
  };
  return Object.freeze(store);
}
