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
  | 'evidence_binding_mismatch'
  | 'evidence_budget_exceeded'
  | 'evidence_claim_conflict';

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

export interface BoundedEvidenceOptions {
  readonly maxRunBytes: number;
  readonly maxEntries: number;
}

export interface BoundedEvidenceStore extends EvidenceStore {
  /** Stage content whose digest was pre-claimed by a ref; reject a mismatch. */
  readonly stageClaimed: (ref: EvidenceRef, content: Uint8Array) => void;
  readonly usage: () => Readonly<{ bytes: number; entries: number }>;
}

/**
 * HostEvidenceWriter staging (tasks 7.5/7.6): atomic content-addressed staging
 * bounded by a per-Run byte and entry budget, with claimed-digest conflict
 * detection. Staging is idempotent (re-staging identical content is a no-op
 * that does not consume budget); a writer that claims one digest but supplies
 * the bytes of another is rejected before publish.
 */
export function createBoundedEvidenceStore(
  options: BoundedEvidenceOptions
): BoundedEvidenceStore {
  const entries = new Map<string, Uint8Array>();
  let totalBytes = 0;

  const assertBudget = (content: Uint8Array): void => {
    if (
      entries.size >= options.maxEntries &&
      !entries.has(computeEvidenceContentDigest(content))
    ) {
      throw new EvidenceError(
        'evidence_budget_exceeded',
        'Evidence entry budget exceeded for this Run.'
      );
    }
    const digest = computeEvidenceContentDigest(content);
    if (!entries.has(digest) && totalBytes + content.byteLength > options.maxRunBytes) {
      throw new EvidenceError(
        'evidence_budget_exceeded',
        'Evidence byte budget exceeded for this Run.'
      );
    }
  };

  const stage = (content: Uint8Array): Digest => {
    const digest = computeEvidenceContentDigest(content);
    if (!entries.has(digest)) {
      assertBudget(content);
      entries.set(digest, content.slice());
      totalBytes += content.byteLength;
    }
    return digest;
  };

  return Object.freeze({
    stage,
    stageClaimed(ref: EvidenceRef, content: Uint8Array): void {
      const actual = computeEvidenceContentDigest(content);
      if (actual !== ref.contentDigest) {
        throw new EvidenceError(
          'evidence_claim_conflict',
          'Staged content does not match the evidence ref claimed contentDigest.'
        );
      }
      stage(content);
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
    usage() {
      return Object.freeze({ bytes: totalBytes, entries: entries.size });
    },
  });
}

export interface StagedEvidenceEntry {
  readonly contentDigest: Digest;
  readonly stagedAtMs: number;
  readonly bytes: number;
}

export interface RetentionOptions {
  readonly minAgeMs: number;
  readonly cursorPageSize: number;
}

export const DEFAULT_RETENTION: RetentionOptions = Object.freeze({
  minAgeMs: 24 * 60 * 60 * 1000,
  cursorPageSize: 256,
});

export interface RetentionLedger {
  /** Record that content was staged at a facade-supplied time. */
  readonly record: (ref: EvidenceRef, nowMs: number) => void;
  /** Paginated orphan list (read-only — listing never cleans up). */
  readonly listOrphans: (
    nowMs: number,
    isReferenced: (ref: EvidenceRef) => boolean,
    cursor: number
  ) => Readonly<{ entries: readonly StagedEvidenceEntry[]; nextCursor: number }>;
  /**
   * Explicit-only cleanup. Removes orphans older than minAge whose references
   * are absent from every Record, rechecking each reference immediately before
   * delete (race retention). Returns the removed digests.
   */
  readonly cleanupEligible: (
    nowMs: number,
    isReferenced: (ref: EvidenceRef) => boolean,
    options?: RetentionOptions
  ) => readonly Digest[];
}

/**
 * Bounded conservative orphan retention (tasks 7.7/7.8). The ledger tracks
 * staged-at times and removes only entries that are (a) older than the minimum
 * age AND (b) unreferenced by any committed Record at the moment of delete.
 * Listing, inspecting, and status never clean up. `nowMs` is facade-supplied so
 * the module stays deterministic and testable without a wall clock.
 */
export function createRetentionLedger(
  refs: () => Iterable<EvidenceRef>
): RetentionLedger {
  const stagedAt = new Map<string, number>();

  const entryFor = (digest: string, nowMs: number): StagedEvidenceEntry | null => {
    const at = stagedAt.get(digest);
    if (at === undefined) return null;
    return Object.freeze({ contentDigest: digest as Digest, stagedAtMs: at, bytes: 0 });
  };

  const ledger: RetentionLedger = {
    record(ref: EvidenceRef, nowMs: number) {
      if (!stagedAt.has(ref.contentDigest)) {
        stagedAt.set(ref.contentDigest, nowMs);
      }
    },
    listOrphans(
      nowMs: number,
      isReferenced: (ref: EvidenceRef) => boolean,
      cursor: number
    ) {
      const options = DEFAULT_RETENTION;
      const entries: StagedEvidenceEntry[] = [];
      let visited = 0;
      for (const ref of refs()) {
        if (stagedAt.get(ref.contentDigest) === undefined) continue;
        if (isReferenced(ref)) continue;
        if (visited < cursor) {
          visited += 1;
          continue;
        }
        const entry = entryFor(ref.contentDigest, nowMs);
        if (entry) entries.push(entry);
        if (entries.length >= options.cursorPageSize) break;
      }
      const nextCursor = cursor + entries.length;
      return Object.freeze({ entries: Object.freeze(entries), nextCursor });
    },
    cleanupEligible(
      nowMs: number,
      isReferenced: (ref: EvidenceRef) => boolean,
      options: RetentionOptions = DEFAULT_RETENTION
    ) {
      const removed: string[] = [];
      for (const ref of refs()) {
        const at = stagedAt.get(ref.contentDigest);
        if (at === undefined) continue;
        if (nowMs - at < options.minAgeMs) continue;
        // Recheck reference immediately before delete (race retention).
        if (isReferenced(ref)) continue;
        stagedAt.delete(ref.contentDigest);
        removed.push(ref.contentDigest);
      }
      return Object.freeze(removed) as readonly Digest[];
    },
  };
  return Object.freeze(ledger);
}
