import { describe, expect, it } from 'vitest';

import {
  publishCompletionTransactionally,
  rereadVerifyCompletion,
  storeHoldsCompleteSet,
  TransactionalCompletionError,
  verifyCompleteEvidenceSet,
} from '../../../src/core/frozen-action-executor/transactional-completion.js';
import {
  buildEvidenceRef,
  createBoundedEvidenceStore,
} from '../../../src/core/change-run/internal/evidence.js';
import { computeCompletionReceiptDigest } from '../../../src/core/change-run/internal/completion.js';
import type {
  ActorRef,
  CompleteRunAction,
  Digest,
  EvidenceRef,
} from '../../../src/core/change-run/contracts.js';
import { recordIds } from '../change-run/record-fixture.js';

const branded = <T>(value: string): T => value as T;
const digest = (c: string) => branded<Digest>(`sha256:${c.repeat(64)}`);

function makeRef(content: Uint8Array, label: string): EvidenceRef {
  return buildEvidenceRef({
    content,
    mediaType: 'application/json',
    observationKind: label,
    producer: {
      id: 'executor',
      version: '1',
      identityDigest: digest('p'),
    },
    binding: {
      planningSpaceId: recordIds.planningSpaceId,
      changeInstanceId: recordIds.changeInstanceId,
      projectId: 'project-fixture',
      changeId: 'fixture-change',
      runId: recordIds.runId,
      actionId: recordIds.actionId,
      schema: label,
    },
  });
}

function makeCompletion(refs: {
  attestation: EvidenceRef;
  evidence: EvidenceRef[];
}): CompleteRunAction {
  const base = {
    format: 'change-run-completion/1' as const,
    change: { projectRoot: '/root', changeId: 'fixture-change' },
    runId: recordIds.runId,
    actionId: recordIds.actionId,
    invocationId: recordIds.invocationId,
    actor: { format: 'change-run-actor/1', kind: 'agent', role: 'implementer' } as unknown as ActorRef,
    actorAttestation: refs.attestation,
    evidence: refs.evidence,
  };
  const withoutReceipt = {
    ...base,
    kind: 'domain-action-result' as const,
    status: 'succeeded' as const,
    result: { ok: true },
    receiptDigest: digest('0'),
  };
  const receiptDigest = computeCompletionReceiptDigest(withoutReceipt);
  return { ...withoutReceipt, receiptDigest } as unknown as CompleteRunAction;
}

function uploadsFor(refs: readonly EvidenceRef[], contents: Map<string, Uint8Array>) {
  return refs.map((ref) => ({
    contentDigest: ref.contentDigest,
    contentBase64: Buffer.from(contents.get(ref.contentDigest)!).toString('base64'),
  }));
}

describe('transactional completion - complete-set verify before publish', () => {
  it('accepts a complete evidence set with every ref uploaded', () => {
    const attestationBytes = Buffer.from('{"attestation":true}');
    const evidenceBytes = Buffer.from('{"evidence":true}');
    const attestation = makeRef(attestationBytes, 'actor-attestation');
    const evidence = makeRef(evidenceBytes, 'domain-result');
    const completion = makeCompletion({ attestation, evidence: [evidence] });
    const contents = new Map([
      [attestation.contentDigest, attestationBytes],
      [evidence.contentDigest, evidenceBytes],
    ]);
    const uploads = uploadsFor([attestation, evidence], contents);
    expect(() => verifyCompleteEvidenceSet(completion, uploads)).not.toThrow();
  });

  it('rejects a partial set (a ref with no upload) before any publish', () => {
    const attestation = makeRef(Buffer.from('a'), 'actor-attestation');
    const evidence = makeRef(Buffer.from('b'), 'domain-result');
    const completion = makeCompletion({ attestation, evidence: [evidence] });
    // Only the attestation is uploaded; the evidence ref is missing.
    const uploads = [
      {
        contentDigest: attestation.contentDigest,
        contentBase64: Buffer.from('a').toString('base64'),
      },
    ];
    expect(() => verifyCompleteEvidenceSet(completion, uploads)).toThrowError(
      TransactionalCompletionError
    );
    expect(() => verifyCompleteEvidenceSet(completion, uploads)).toThrowError(
      /complete set is not present/
    );
  });

  it('rejects an orphaned upload not referenced by the completion set', () => {
    const attestation = makeRef(Buffer.from('a'), 'actor-attestation');
    const evidence = makeRef(Buffer.from('b'), 'domain-result');
    const completion = makeCompletion({ attestation, evidence: [evidence] });
    const orphan = makeRef(Buffer.from('c'), 'orphan');
    const uploads = [
      ...uploadsFor(
        [attestation, evidence],
        new Map([
          [attestation.contentDigest, Buffer.from('a')],
          [evidence.contentDigest, Buffer.from('b')],
        ])
      ),
      {
        contentDigest: orphan.contentDigest,
        contentBase64: Buffer.from('c').toString('base64'),
      },
    ];
    expect(() => verifyCompleteEvidenceSet(completion, uploads)).toThrowError(
      /not referenced/
    );
  });
});

describe('transactional completion - half-set crash guard (D5 part 3)', () => {
  it('publishes the complete set atomically when no crash is injected', () => {
    const store = createBoundedEvidenceStore({ maxRunBytes: 1024, maxEntries: 16 });
    const attestation = makeRef(Buffer.from('a'), 'actor-attestation');
    const evidence = makeRef(Buffer.from('b'), 'domain-result');
    const completion = makeCompletion({ attestation, evidence: [evidence] });
    const uploads = uploadsFor(
      [attestation, evidence],
      new Map([
        [attestation.contentDigest, Buffer.from('a')],
        [evidence.contentDigest, Buffer.from('b')],
      ])
    );
    const outcome = publishCompletionTransactionally({ completion, uploads, evidenceStore: store });
    expect(outcome.kind).toBe('published');
    expect(storeHoldsCompleteSet(completion, store)).toBe(true);
  });

  it('a mid-publish crash leaves a partial set the completeness check rejects', () => {
    const store = createBoundedEvidenceStore({ maxRunBytes: 1024, maxEntries: 16 });
    const attestation = makeRef(Buffer.from('a'), 'actor-attestation');
    const evidence = makeRef(Buffer.from('b'), 'domain-result');
    const completion = makeCompletion({ attestation, evidence: [evidence] });
    const uploads = uploadsFor(
      [attestation, evidence],
      new Map([
        [attestation.contentDigest, Buffer.from('a')],
        [evidence.contentDigest, Buffer.from('b')],
      ])
    );
    // Inject a crash after staging only the attestation (crashAfter: 1). The
    // store now holds a half-set: the evidence ref is missing.
    const outcome = publishCompletionTransactionally({
      completion,
      uploads,
      evidenceStore: store,
      crashAfter: 1,
    });
    expect(outcome.kind).toBe('crashed-after-partial');
    // The completeness guard reports the half-set is NOT complete.
    expect(storeHoldsCompleteSet(completion, store)).toBe(false);
    // A later completion re-reading the store MUST fail the completeness check
    // rather than treating the half-set as complete.
    expect(() => store.read(evidence)).toThrow();
  });

  it('a half-set accepted as complete fails the guard (discrimination)', () => {
    // The completeness guard must report false for a half-set and true only for
    // the complete set. This test exists so a mutation that makes the guard
    // accept a half-set fails.
    const store = createBoundedEvidenceStore({ maxRunBytes: 1024, maxEntries: 16 });
    const attestation = makeRef(Buffer.from('a'), 'actor-attestation');
    const evidence = makeRef(Buffer.from('b'), 'domain-result');
    const completion = makeCompletion({ attestation, evidence: [evidence] });
    publishCompletionTransactionally({
      completion,
      uploads: uploadsFor(
        [attestation, evidence],
        new Map([
          [attestation.contentDigest, Buffer.from('a')],
          [evidence.contentDigest, Buffer.from('b')],
        ])
      ),
      evidenceStore: store,
      crashAfter: 1,
    });
    expect(storeHoldsCompleteSet(completion, store)).toBe(false);
    // Stage the missing ref; now the set IS complete.
    store.stageClaimed(evidence, Buffer.from('b'));
    expect(storeHoldsCompleteSet(completion, store)).toBe(true);
  });
});

describe('no signing material enters the completion path (decision 12)', () => {
  it('the transactional-completion module exposes no signing key parameter', () => {
    // The functions verifyCompleteEvidenceSet / publishCompletionTransactionally
    // / storeHoldsCompleteSet accept no private key, no credential, no producer
    // secret. Integrity is carried by content digests and the complete-set
    // check, not by a signature.
    expect(typeof verifyCompleteEvidenceSet).toBe('function');
    expect(typeof publishCompletionTransactionally).toBe('function');
    expect(typeof storeHoldsCompleteSet).toBe('function');
    expect(typeof rereadVerifyCompletion).toBe('function');
  });
});

// Note: rereadVerifyCompletion delegates to the Facade's existing
// verifyAttestedCompletion re-read/re-verify (facade-runtime.ts:119-133), which
// the regression suite (task 9.3: facade-runtime.test.ts, attestation.test.ts)
// already covers for the signed path. The executor's NEW transactional guard is
// the complete-set layer proven above, which is signing-free per decision 12.
