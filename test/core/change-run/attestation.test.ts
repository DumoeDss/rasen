import { describe, expect, it } from 'vitest';
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';

import type {
  ActionId,
  CompleteRunAction,
  Digest,
  RunAction,
  RunId,
} from '../../../src/core/change-run/contracts.js';
import type { AttestationAuthority } from '../../../src/core/change-run/contracts.js';
import { computeCompletionReceiptDigest } from '../../../src/core/change-run/internal/completion.js';
import { buildEvidenceRef, createBoundedEvidenceStore } from '../../../src/core/change-run/internal/evidence.js';
import { createChangePipelineRuntime } from '../../../src/core/change-run/internal/facade-runtime.js';
import { createHostEvidenceWriter } from '../../../src/core/change-run/internal/host-evidence-writer.js';
import {
  createTrustedCompletionProducer,
  createUnavailableTrustedCompletionProducer,
  TrustedCompletionProducerError,
} from '../../../src/core/change-run/internal/trusted-completion-producer.js';
import {
  computeAttestationAuthorityDigest,
  computeAttestedEvidenceRefDigest,
  evidenceProofMessage,
  unsignedEvidenceIdentity,
  verifyAttestedCompletion,
} from '../../../src/core/change-run/internal/attestation.js';
import { digestCanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import { createInMemoryRunStore } from '../../../src/core/change-run/internal/run-store.js';
import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import type { RuntimePlanInput } from '../../../src/core/change-run/internal/runtime-plan.js';
import {
  TEST_ATTESTATION_AUTHORITY,
  createTestTrustedCompletionProducer,
} from '../../fixtures/trusted-completion.js';
import {
  agentAction,
  fixtureDigests,
  startRecord,
} from './reconciler-fixture.js';

const branded = <T>(value: string): T => value as T;

function fixture() {
  const runId = branded<RunId>(`run:${'9'.repeat(64)}`);
  const plan = createRuntimePlan({
    runId,
    pipeline: 'attestation-fixture',
    planDigest: branded<Digest>(`sha256:${'1'.repeat(64)}`),
    profileDigest: branded<Digest>(`sha256:${'2'.repeat(64)}`),
    sourceRevisionDigest: branded<Digest>(`sha256:${'3'.repeat(64)}`),
    capabilityDigest: branded<Digest>(`sha256:${'4'.repeat(64)}`),
    policyDigest: branded<Digest>(`sha256:${'5'.repeat(64)}`),
    implicitFinishOutcome: 'done',
    nodes: [{
      kind: 'atomic',
      hierarchicalPath: 'root/work',
      requires: [],
      admissionKind: 'agent',
      workspace: { access: 'write' },
    }],
  } as RuntimePlanInput);
  const action = agentAction(plan, 'root/work');
  const initial = startRecord(plan);
  const admitted = reduceCanonicalRunRecord(initial, {
    kind: 'admit-action',
    action,
    attemptOrdinal: 0,
    deliveryMode: 'grant',
  });
  if (!admitted.ok) throw new Error(admitted.failure.message);
  const runStore = createInMemoryRunStore();
  runStore.create(runId, admitted.record);
  const evidenceStore = createBoundedEvidenceStore({
    maxRunBytes: 1024 * 1024,
    maxEntries: 16,
  });
  const writer = createHostEvidenceWriter({ runId, runStore, evidenceStore });
  const facade = createChangePipelineRuntime({
    store: runStore,
    plan,
    initialRecord: initial,
    evidenceStore,
    buildAction: () => action,
  });
  return { plan, action, runStore, evidenceStore, writer, facade };
}

function publicMetadataForgery(
  record: ReturnType<ReturnType<typeof fixture>['runStore']['load']>,
  action: RunAction
): Readonly<{
  completion: CompleteRunAction;
  uploads: readonly { contentDigest: string; contentBase64: string }[];
}> {
  const authority = action.completionAuthority!;
  const effectUse = authority.observations.effectObservation;
  const effectBytes = Buffer.from('{"caller":"forged effect"}', 'utf8');
  const actorBytes = Buffer.from('{"caller":"forged actor attestation"}', 'utf8');
  const common = {
    planningSpaceId: record.change.planningSpaceId,
    changeInstanceId: record.change.instanceId,
    projectId: record.change.projectId,
    changeId: record.change.changeId,
    runId: record.runId,
    actionId: action.actionId as ActionId,
    treeDigest: action.expectedBeforeWorkspace.treeDigest,
  };
  const evidence = buildEvidenceRef({
    content: effectBytes,
    mediaType: effectUse.mediaType,
    observationKind: effectUse.observationKind,
    producer: effectUse.producer,
    binding: {
      ...common,
      effectId: action.effects[0]!.effectId,
      schema: effectUse.schema,
    },
  });
  const actorAttestation = buildEvidenceRef({
    content: actorBytes,
    mediaType: authority.actorAttestation.mediaType,
    observationKind: authority.actorAttestation.observationKind,
    producer: authority.actorAttestation.producer,
    binding: { ...common, schema: authority.actorAttestation.schema },
  });
  const base = {
    format: 'change-run-completion/1' as const,
    kind: 'effect-observation' as const,
    change: { projectRoot: '/public-caller', changeId: record.change.changeId },
    runId: record.runId,
    actionId: action.actionId,
    invocationId: action.invocationId,
    actor: authority.actor,
    actorAttestation,
    evidence: [evidence],
    effectId: action.effects[0]!.effectId,
    status: 'succeeded' as const,
    observation: { caller: 'forged success' },
  };
  const completion: CompleteRunAction = {
    ...base,
    receiptDigest: computeCompletionReceiptDigest(base),
  };
  return {
    completion,
    uploads: [
      { contentDigest: actorAttestation.contentDigest, contentBase64: actorBytes.toString('base64') },
      { contentDigest: evidence.contentDigest, contentBase64: effectBytes.toString('base64') },
    ],
  };
}

describe('Action-frozen Ed25519 completion attestation', () => {
  it('keeps canonical authority, proof, and EvidenceRef preimages byte-stable', () => {
    const authority: AttestationAuthority = {
      format: 'change-run-attestation-authority/1',
      algorithm: 'ed25519',
      keyId: 'golden',
      keyVersion: '1',
      publicKey: {
        format: 'spki-der',
        encoding: 'base64',
        value: 'MCowBQYDK2VwAyEAAoLxv5CVb7Wk5t7V+7gMTf7WThG+J/aQuSHw7C9gziw=',
        digest: 'sha256:6490926161555d46173c38e8d05f9501f61068b2b59e905aaf6260a337e59137' as Digest,
      },
    };
    const authorityDigest = computeAttestationAuthorityDigest(authority);
    expect(authorityDigest).toBe(
      'sha256:56cfecf1219c68b03668b00a5b8cc36e9c927d7c0dc2efecf00f89bc41aa4cd8'
    );
    const identity = unsignedEvidenceIdentity({
      format: 'change-run-evidence-ref/2',
      contentDigest: `sha256:${'1'.repeat(64)}` as Digest,
      mediaType: 'application/json',
      sizeBytes: 2,
      observationKind: 'golden',
      producer: {
        id: 'golden',
        version: '1',
        identityDigest: `sha256:${'2'.repeat(64)}`,
      },
      binding: {
        planningSpaceId: `planning-space:${'3'.repeat(64)}`,
        changeInstanceId: `change-instance:${'4'.repeat(64)}`,
        projectId: 'p',
        changeId: 'c',
        runId: `run:${'5'.repeat(64)}`,
        actionId: `action:${'6'.repeat(64)}`,
        treeDigest: `sha256:${'7'.repeat(64)}`,
        schema: 'golden/1',
      },
    }, authorityDigest);
    const privateKey = createPrivateKey({
      key: Buffer.from(
        'MC4CAQAwBQYDK2VwBCIEIAEVaaloNWg/UbQjSojfR0jNlXh4gf7RKebttaVnJ4/4',
        'base64'
      ),
      format: 'der',
      type: 'pkcs8',
    });
    const signature = sign(null, evidenceProofMessage(identity), privateKey).toString('base64');
    expect(signature).toBe(
      'fXojOdaTGDFzT0PSDgnUQ2/AaNsvG2Bt4lJ1bEfYhqnu97dFb604e1Cz6LA3xT8o+sH9YIp04YF4If7Lf1zTAQ=='
    );
    expect(computeAttestedEvidenceRefDigest(identity, {
      format: 'change-run-evidence-proof/1',
      authorityDigest,
      signature,
    })).toBe(
      'sha256:a7dfd162376f282d82d36c035c693c4636d35961a4748e6f7bef6212272357bf'
    );
  });

  it('rejects exact public Action metadata without a private-key proof before any publication', () => {
    const fx = fixture();
    const beforeRecord = digestCanonicalRunRecord(fx.runStore.load(fx.plan.runId));
    const forged = publicMetadataForgery(
      fx.runStore.load(fx.plan.runId),
      fx.action
    );

    expect(() =>
      fx.writer.publishCompletion(forged.completion, forged.uploads)
    ).toThrow(/authenticated EvidenceRef v2|proof/i);
    expect(fx.evidenceStore.usage()).toEqual({ bytes: 0, entries: 0 });
    expect(digestCanonicalRunRecord(fx.runStore.load(fx.plan.runId))).toBe(
      beforeRecord
    );
  });

  it('publishes and re-verifies a valid signed effect completion, with exact replay idempotency', async () => {
    const fx = fixture();
    expect(fx.action.completionAuthority?.attestationAuthority).toEqual(
      TEST_ATTESTATION_AUTHORITY
    );
    const producer = createTestTrustedCompletionProducer(fx.action);
    const submission = await producer.attestCompletion({
      change: { projectRoot: '/trusted-host', changeId: 'fixture-change' },
      record: fx.runStore.load(fx.plan.runId),
      action: fx.action,
      completion: {
        kind: 'effect-observation',
        effectId: fx.action.effects[0]!.effectId,
        status: 'succeeded',
        observation: { workspace: 'observed' },
      },
      evidenceContent: Buffer.from('{"workspace":"observed"}', 'utf8'),
    });

    fx.writer.publishCompletion(submission.completion, submission.uploads);
    const first = await fx.facade.complete(submission.completion, {
      deliveryMode: 'grant',
    });
    expect(first.disposition).toBe('advanced');
    fx.writer.publishCompletion(submission.completion, submission.uploads);
    const replay = await fx.facade.complete(submission.completion, {
      deliveryMode: 'grant',
    });
    expect(replay.disposition).toBe('reused');
  });

  it('rejects a semantic payload change even when the public receipt is recomputed', async () => {
    const fx = fixture();
    const producer = createTestTrustedCompletionProducer(fx.action);
    const submission = await producer.attestCompletion({
      change: { projectRoot: '/trusted-host', changeId: 'fixture-change' },
      record: fx.runStore.load(fx.plan.runId),
      action: fx.action,
      completion: {
        kind: 'effect-observation',
        effectId: fx.action.effects[0]!.effectId,
        status: 'succeeded',
        observation: { workspace: 'observed' },
      },
      evidenceContent: Buffer.from('{"workspace":"observed"}', 'utf8'),
    });
    const changedBase = {
      ...submission.completion,
      observation: { workspace: 'forged-after-signing' },
    } as CompleteRunAction & { kind: 'effect-observation' };
    const changed = {
      ...changedBase,
      receiptDigest: computeCompletionReceiptDigest(changedBase),
    } as CompleteRunAction;

    expect(() =>
      fx.writer.publishCompletion(changed, submission.uploads)
    ).toThrow(/canonical completion claim/i);
    expect(fx.evidenceStore.usage()).toEqual({ bytes: 0, entries: 0 });
  });

  it('binds every variant status and semantic payload into the signed actor claim', () => {
    const assertChangedRejected = (
      original: CompleteRunAction,
      uploads: readonly Readonly<{ contentDigest: string; contentBase64: string }>[],
      patch: Record<string, unknown>
    ): void => {
      const fx = fixture();
      const changedBase = { ...original, ...patch } as CompleteRunAction;
      const changed = {
        ...changedBase,
        receiptDigest: computeCompletionReceiptDigest(changedBase),
      } as CompleteRunAction;
      expect(() => fx.writer.publishCompletion(changed, uploads)).toThrow(
        /canonical completion claim/i
      );
      expect(fx.evidenceStore.usage()).toEqual({ bytes: 0, entries: 0 });
    };

    const domainFx = fixture();
    const domain = createTestTrustedCompletionProducer(
      domainFx.action
    ).attestCompletion({
      change: { projectRoot: '/trusted-host', changeId: 'fixture-change' },
      record: domainFx.runStore.load(domainFx.plan.runId),
      action: domainFx.action,
      completion: {
        kind: 'domain-action-result',
        status: 'succeeded',
        result: { value: 1 },
      },
      evidenceContent: Buffer.from('{"value":1}', 'utf8'),
    });
    assertChangedRejected(domain.completion, domain.uploads, { status: 'failed' });
    assertChangedRejected(domain.completion, domain.uploads, { result: { value: 2 } });

    const infraFx = fixture();
    const infrastructure = createTestTrustedCompletionProducer(
      infraFx.action
    ).attestCompletion({
      change: { projectRoot: '/trusted-host', changeId: 'fixture-change' },
      record: infraFx.runStore.load(infraFx.plan.runId),
      action: infraFx.action,
      completion: {
        kind: 'infrastructure-observation',
        status: 'infrastructure_failed',
        error: {
          code: 'spawn_failed',
          retryable: true,
          adapterArtifactDigest: infraFx.action.capability.artifact.contentDigest as Digest,
        },
      },
      evidenceContent: Buffer.from('{"code":"spawn_failed"}', 'utf8'),
    });
    if (infrastructure.completion.kind !== 'infrastructure-observation') {
      throw new Error('expected infrastructure completion');
    }
    assertChangedRejected(infrastructure.completion, infrastructure.uploads, {
      error: {
        ...infrastructure.completion.error,
        code: 'caller_reclassified',
      },
    });
  });

  it('validates the whole upload set before publishing any object', async () => {
    const fx = fixture();
    const producer = createTestTrustedCompletionProducer(fx.action);
    const submission = await producer.attestCompletion({
      change: { projectRoot: '/trusted-host', changeId: 'fixture-change' },
      record: fx.runStore.load(fx.plan.runId),
      action: fx.action,
      completion: {
        kind: 'effect-observation',
        effectId: fx.action.effects[0]!.effectId,
        status: 'succeeded',
        observation: { ok: true },
      },
      evidenceContent: Buffer.from('{"ok":true}', 'utf8'),
    });
    const invalidBatch = [
      submission.uploads[0]!,
      { ...submission.uploads[1]!, contentBase64: Buffer.from('tampered').toString('base64') },
    ];

    expect(() =>
      fx.writer.publishCompletion(submission.completion, invalidBatch)
    ).toThrow(/digest mismatch/i);
    expect(fx.evidenceStore.usage()).toEqual({ bytes: 0, entries: 0 });
  });

  it('rejects a correctly signed actor claim whose JSON bytes are not the exact canonical encoding', () => {
    const fx = fixture();
    const pair = generateKeyPairSync('ed25519');
    const der = pair.publicKey.export({ format: 'der', type: 'spki' });
    const authority: AttestationAuthority = {
      ...TEST_ATTESTATION_AUTHORITY,
      keyId: 'noncanonical-claim-test',
      publicKey: {
        ...TEST_ATTESTATION_AUTHORITY.publicKey,
        value: Buffer.from(der).toString('base64'),
        digest: `sha256:${createHash('sha256').update(der).digest('hex')}` as Digest,
      },
    };
    const action = {
      ...fx.action,
      completionAuthority: {
        ...fx.action.completionAuthority!,
        attestationAuthority: authority,
      },
    } as RunAction;
    const originalRecord = fx.runStore.load(fx.plan.runId);
    const record = {
      ...originalRecord,
      actions: {
        ...originalRecord.actions,
        [action.actionId]: {
          ...originalRecord.actions[action.actionId]!,
          action,
        },
      },
    } as typeof originalRecord;
    const submission = createTrustedCompletionProducer({
      adapter: {
        id: action.capability.artifact.id,
        version: action.capability.artifact.version,
        contentDigest: action.capability.artifact.contentDigest as Digest,
      },
      authority,
      privateKey: pair.privateKey,
    }).attestCompletion({
      change: { projectRoot: '/trusted-host', changeId: 'fixture-change' },
      record,
      action,
      completion: {
        kind: 'effect-observation',
        effectId: action.effects[0]!.effectId,
        status: 'succeeded',
        observation: { exactBytes: true },
      },
      evidenceContent: Buffer.from('{"exactBytes":true}', 'utf8'),
    });
    const actorRef = submission.completion.actorAttestation;
    if (actorRef.format !== 'change-run-evidence-ref/2') throw new Error('expected v2');
    const actorUpload = submission.uploads.find(
      (upload) => upload.contentDigest === actorRef.contentDigest
    )!;
    const parsedClaim = JSON.parse(
      Buffer.from(actorUpload.contentBase64, 'base64').toString('utf8')
    );
    const noncanonicalBytes = Buffer.from(JSON.stringify(parsedClaim, null, 2), 'utf8');
    const authorityDigest = computeAttestationAuthorityDigest(authority);
    const unsigned = {
      format: actorRef.format,
      contentDigest: `sha256:${createHash('sha256').update(noncanonicalBytes).digest('hex')}` as Digest,
      mediaType: actorRef.mediaType,
      sizeBytes: noncanonicalBytes.byteLength,
      observationKind: actorRef.observationKind,
      producer: actorRef.producer,
      binding: actorRef.binding,
    } as const;
    const identity = unsignedEvidenceIdentity(unsigned, authorityDigest);
    const proof = {
      format: 'change-run-evidence-proof/1' as const,
      authorityDigest,
      signature: sign(null, evidenceProofMessage(identity), pair.privateKey).toString('base64'),
    };
    const noncanonicalRef = {
      ...unsigned,
      proof,
      evidenceDigest: computeAttestedEvidenceRefDigest(identity, proof),
    };
    const changedBase = {
      ...submission.completion,
      actorAttestation: noncanonicalRef,
    } as CompleteRunAction;
    const changed = {
      ...changedBase,
      receiptDigest: computeCompletionReceiptDigest(changedBase),
    } as CompleteRunAction;
    const bytes = new Map(
      submission.uploads.map((upload) => [
        upload.contentDigest,
        Buffer.from(upload.contentBase64, 'base64'),
      ] as const)
    );
    bytes.set(noncanonicalRef.contentDigest, noncanonicalBytes);
    expect(() =>
      verifyAttestedCompletion(record, action, changed, (ref) => bytes.get(ref.contentDigest)!)
    ).toThrow(/exact canonical completion claim/i);
  });

  it('rejects a caller key substitution even with a fully re-signed self-consistent set', async () => {
    const fx = fixture();
    const pair = generateKeyPairSync('ed25519');
    const der = pair.publicKey.export({ format: 'der', type: 'spki' });
    const authority: AttestationAuthority = {
      format: 'change-run-attestation-authority/1',
      algorithm: 'ed25519',
      keyId: 'caller-substitution',
      keyVersion: '1',
      publicKey: {
        format: 'spki-der',
        encoding: 'base64',
        value: Buffer.from(der).toString('base64'),
        digest: `sha256:${createHash('sha256').update(der).digest('hex')}` as Digest,
      },
    };
    const substitutedAction = {
      ...fx.action,
      completionAuthority: {
        ...fx.action.completionAuthority!,
        attestationAuthority: authority,
      },
    } as RunAction;
    const originalRecord = fx.runStore.load(fx.plan.runId);
    const substitutedRecord = {
      ...originalRecord,
      actions: {
        ...originalRecord.actions,
        [substitutedAction.actionId]: {
          ...originalRecord.actions[substitutedAction.actionId]!,
          action: substitutedAction,
        },
      },
    };
    const producer = createTrustedCompletionProducer({
      adapter: {
        id: substitutedAction.capability.artifact.id,
        version: substitutedAction.capability.artifact.version,
        contentDigest: substitutedAction.capability.artifact.contentDigest as Digest,
      },
      authority,
      privateKey: pair.privateKey,
    });
    const forged = await producer.attestCompletion({
      change: { projectRoot: '/caller', changeId: 'fixture-change' },
      record: substitutedRecord as typeof originalRecord,
      action: substitutedAction,
      completion: {
        kind: 'effect-observation',
        effectId: substitutedAction.effects[0]!.effectId,
        status: 'succeeded',
        observation: { forged: true },
      },
      evidenceContent: Buffer.from('{"forged":true}', 'utf8'),
    });

    expect(() =>
      fx.writer.publishCompletion(forged.completion, forged.uploads)
    ).toThrow(/Action authority|proof is not bound/i);
    expect(fx.evidenceStore.usage()).toEqual({ bytes: 0, entries: 0 });
  });

  it('rejects signature bit flips, non-canonical base64, and cross-Run/Action/effect replay', async () => {
    const makeSubmission = async () => {
      const fx = fixture();
      const submission = await createTestTrustedCompletionProducer(
        fx.action
      ).attestCompletion({
        change: { projectRoot: '/trusted-host', changeId: 'fixture-change' },
        record: fx.runStore.load(fx.plan.runId),
        action: fx.action,
        completion: {
          kind: 'effect-observation',
          effectId: fx.action.effects[0]!.effectId,
          status: 'succeeded',
          observation: { ok: true },
        },
        evidenceContent: Buffer.from('{"ok":true}', 'utf8'),
      });
      return { fx, submission };
    };

    const bitflip = await makeSubmission();
    const signedEvidence = bitflip.submission.completion.evidence[0]!;
    if (signedEvidence.format !== 'change-run-evidence-ref/2') throw new Error('expected v2');
    const signature = Buffer.from(signedEvidence.proof.signature, 'base64');
    signature[0] ^= 1;
    const bitflippedBase = {
      ...bitflip.submission.completion,
      evidence: [{
        ...signedEvidence,
        proof: { ...signedEvidence.proof, signature: signature.toString('base64') },
      }],
    } as CompleteRunAction;
    const bitflipped = {
      ...bitflippedBase,
      receiptDigest: computeCompletionReceiptDigest(bitflippedBase),
    } as CompleteRunAction;
    expect(() =>
      bitflip.fx.writer.publishCompletion(bitflipped, bitflip.submission.uploads)
    ).toThrow(/proof|signature/i);

    const noncanonical = await makeSubmission();
    const actor = noncanonical.submission.completion.actorAttestation;
    if (actor.format !== 'change-run-evidence-ref/2') throw new Error('expected v2');
    const strippedBase = {
      ...noncanonical.submission.completion,
      actorAttestation: {
        ...actor,
        proof: {
          ...actor.proof,
          signature: actor.proof.signature.replace(/=+$/, ''),
        },
      },
    } as CompleteRunAction;
    const stripped = {
      ...strippedBase,
      receiptDigest: computeCompletionReceiptDigest(strippedBase),
    } as CompleteRunAction;
    expect(() =>
      noncanonical.fx.writer.publishCompletion(stripped, noncanonical.submission.uploads)
    ).toThrow(/base64|proof/i);

    const replay = await makeSubmission();
    const changedBase = {
      ...replay.submission.completion,
      effectId: `effect:${'f'.repeat(64)}`,
    } as CompleteRunAction & { kind: 'effect-observation' };
    const crossEffect = {
      ...changedBase,
      receiptDigest: computeCompletionReceiptDigest(changedBase),
    } as CompleteRunAction;
    expect(() =>
      replay.fx.writer.publishCompletion(crossEffect, replay.submission.uploads)
    ).toThrow(/binding|claim|Action/i);

    const crossRunAttempt = await makeSubmission();
    const wrongRunBase = {
      ...crossRunAttempt.submission.completion,
      runId: `run:${'e'.repeat(64)}`,
    } as CompleteRunAction;
    const wrongRun = {
      ...wrongRunBase,
      receiptDigest: computeCompletionReceiptDigest(wrongRunBase),
    } as CompleteRunAction;
    expect(() =>
      crossRunAttempt.fx.writer.publishCompletion(
        wrongRun,
        crossRunAttempt.submission.uploads
      )
    ).toThrow(/Run|Action|binding|claim/i);

    const crossActionAttempt = await makeSubmission();
    const wrongActionBase = {
      ...crossActionAttempt.submission.completion,
      actionId: `action:${'d'.repeat(64)}`,
    } as CompleteRunAction;
    const wrongAction = {
      ...wrongActionBase,
      receiptDigest: computeCompletionReceiptDigest(wrongActionBase),
    } as CompleteRunAction;
    expect(() =>
      crossActionAttempt.fx.writer.publishCompletion(
        wrongAction,
        crossActionAttempt.submission.uploads
      )
    ).toThrow(/Action|binding|claim/i);
  });

  it('accepts the domain and infrastructure variants only with their signed canonical claims', async () => {
    const domainFx = fixture();
    const producer = createTestTrustedCompletionProducer(domainFx.action);
    const effect = await producer.attestCompletion({
      change: { projectRoot: '/trusted-host', changeId: 'fixture-change' },
      record: domainFx.runStore.load(domainFx.plan.runId),
      action: domainFx.action,
      completion: {
        kind: 'effect-observation',
        effectId: domainFx.action.effects[0]!.effectId,
        status: 'succeeded',
        observation: { ok: true },
      },
      evidenceContent: Buffer.from('{"effect":"ok"}', 'utf8'),
    });
    domainFx.writer.publishCompletion(effect.completion, effect.uploads);
    await domainFx.facade.complete(effect.completion, { deliveryMode: 'grant' });
    const domain = await producer.attestCompletion({
      change: { projectRoot: '/trusted-host', changeId: 'fixture-change' },
      record: domainFx.runStore.load(domainFx.plan.runId),
      action: domainFx.action,
      completion: {
        kind: 'domain-action-result',
        status: 'succeeded',
        result: { ok: true },
      },
      evidenceContent: Buffer.from('{"result":"ok"}', 'utf8'),
    });
    domainFx.writer.publishCompletion(domain.completion, domain.uploads);
    await expect(
      domainFx.facade.complete(domain.completion, { deliveryMode: 'grant' })
    ).resolves.toBeDefined();

    const infraFx = fixture();
    const infrastructure = await createTestTrustedCompletionProducer(
      infraFx.action
    ).attestCompletion({
      change: { projectRoot: '/trusted-host', changeId: 'fixture-change' },
      record: infraFx.runStore.load(infraFx.plan.runId),
      action: infraFx.action,
      completion: {
        kind: 'infrastructure-observation',
        status: 'infrastructure_failed',
        error: {
          code: 'spawn_failed',
          retryable: true,
          adapterArtifactDigest: infraFx.action.capability.artifact.contentDigest as Digest,
        },
      },
      evidenceContent: Buffer.from('{"error":"spawn_failed"}', 'utf8'),
    });
    infraFx.writer.publishCompletion(infrastructure.completion, infrastructure.uploads);
    await expect(
      infraFx.facade.complete(infrastructure.completion, { deliveryMode: 'grant' })
    ).resolves.toBeDefined();
  });

  it('keeps old verification Action-frozen across rotation and reports an unavailable signer without fallback', () => {
    const fx = fixture();
    const submission = createTestTrustedCompletionProducer(fx.action).attestCompletion({
      change: { projectRoot: '/trusted-host', changeId: 'fixture-change' },
      record: fx.runStore.load(fx.plan.runId),
      action: fx.action,
      completion: {
        kind: 'effect-observation',
        effectId: fx.action.effects[0]!.effectId,
        status: 'succeeded',
        observation: { oldKey: true },
      },
      evidenceContent: Buffer.from('{"oldKey":true}', 'utf8'),
    });
    const uploadByDigest = new Map(
      submission.uploads.map((upload) => [
        upload.contentDigest,
        Buffer.from(upload.contentBase64, 'base64'),
      ] as const)
    );
    expect(() =>
      verifyAttestedCompletion(
        fx.runStore.load(fx.plan.runId),
        fx.action,
        submission.completion,
        (ref) => uploadByDigest.get(ref.contentDigest)!
      )
    ).not.toThrow();

    const rotatedPair = generateKeyPairSync('ed25519');
    const rotatedDer = rotatedPair.publicKey.export({ format: 'der', type: 'spki' });
    const rotatedAuthority: AttestationAuthority = {
      ...TEST_ATTESTATION_AUTHORITY,
      keyVersion: '2',
      publicKey: {
        ...TEST_ATTESTATION_AUTHORITY.publicKey,
        value: Buffer.from(rotatedDer).toString('base64'),
        digest: `sha256:${createHash('sha256').update(rotatedDer).digest('hex')}` as Digest,
      },
    };
    const rotatedAction = {
      ...fx.action,
      completionAuthority: {
        ...fx.action.completionAuthority!,
        attestationAuthority: rotatedAuthority,
      },
    } as RunAction;
    const oldRecord = fx.runStore.load(fx.plan.runId);
    const rotatedRecord = {
      ...oldRecord,
      actions: {
        ...oldRecord.actions,
        [rotatedAction.actionId]: {
          ...oldRecord.actions[rotatedAction.actionId]!,
          action: rotatedAction,
        },
      },
    };
    expect(() =>
      verifyAttestedCompletion(
        rotatedRecord as typeof oldRecord,
        rotatedAction,
        submission.completion,
        (ref) => uploadByDigest.get(ref.contentDigest)!
      )
    ).toThrow(/Action authority|proof is not bound/i);

    const unavailable = createUnavailableTrustedCompletionProducer({
      adapter: {
        id: fx.action.capability.artifact.id,
        version: fx.action.capability.artifact.version,
        contentDigest: fx.action.capability.artifact.contentDigest as Digest,
      },
      authority: fx.action.completionAuthority!.attestationAuthority!,
    });
    expect(() => unavailable.attestCompletion({} as never)).toThrowError(
      expect.objectContaining<Partial<TrustedCompletionProducerError>>({
        code: 'attestation_signer_unavailable',
      })
    );
  });
});
