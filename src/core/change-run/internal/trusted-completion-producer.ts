import {
  createPublicKey,
  sign,
  type KeyObject,
} from 'node:crypto';

import {
  decodeCompletion,
  type AttestationAuthority,
  type AttestedEvidenceRefV2,
  type ChangeRef,
  type CompleteRunAction,
  type Digest,
  type EffectId,
  type EvidenceRef,
  type RunAction,
} from '../contracts.js';
import type { CanonicalRunRecord } from './record.js';
import {
  decodeConsultationStepSubmission,
  type ConsultationContentLimits,
  type ConsultationStepSubmission,
} from '../consultation-contracts.js';
import { parseConsultableLeafReturn } from '../../worker-contracts.js';
import {
  buildCompletionClaim,
  buildConsultationClaim,
  computeAttestationAuthorityDigest,
  computeAttestedEvidenceRefDigest,
  evidenceProofMessage,
  unsignedEvidenceIdentity,
  validateAttestationAuthority,
} from './attestation.js';
import { computeCompletionReceiptDigest } from './completion.js';
import { computeEvidenceContentDigest } from './evidence.js';
import { canonicalJson } from './identity.js';

export type TrustedCompletionSemantic =
  | Readonly<{
      kind: 'domain-action-result';
      status: 'succeeded' | 'failed' | 'blocked';
      result: unknown;
    }>
  | Readonly<{
      kind: 'effect-observation';
      effectId: EffectId;
      status: 'succeeded' | 'failed' | 'not_executed';
      observation: unknown;
    }>
  | Readonly<{
      kind: 'infrastructure-observation';
      status: 'infrastructure_failed';
      error: {
        code: string;
        retryable: boolean;
        adapterArtifactDigest: Digest;
      };
    }>;

export interface TrustedCompletionInput {
  readonly change: ChangeRef;
  readonly record: CanonicalRunRecord;
  readonly action: RunAction;
  readonly completion: TrustedCompletionSemantic;
  readonly evidenceContent: Uint8Array;
}

export interface AttestedCompletionSubmission {
  readonly completion: CompleteRunAction;
  readonly uploads: readonly Readonly<{
    contentDigest: Digest;
    contentBase64: string;
  }>[];
}

export interface TrustedConsultationInput {
  readonly change: ChangeRef;
  readonly record: CanonicalRunRecord;
  readonly action: RunAction;
  /** Exact settled SessionHost result body selected for consultable parsing. */
  readonly result: string;
  /** SessionHost SHA-256, accepted as raw hex or canonical sha256-prefixed form. */
  readonly resultDigest: string;
  readonly stableSessionId: string;
  readonly requestId: string;
  readonly limits: ConsultationContentLimits;
}

export interface AttestedConsultationSubmission {
  readonly consultation: ConsultationStepSubmission;
  readonly uploads: readonly Readonly<{
    contentDigest: Digest;
    contentBase64: string;
  }>[];
}

export interface TrustedCompletionProducer {
  readonly adapter: Readonly<{
    id: string;
    version: string;
    contentDigest: Digest;
  }>;
  readonly authority: AttestationAuthority;
  attestCompletion(
    input: TrustedCompletionInput
  ): AttestedCompletionSubmission;
  attestConsultation(
    input: TrustedConsultationInput
  ): AttestedConsultationSubmission;
}

export class TrustedCompletionProducerError extends Error {
  constructor(
    readonly code:
      | 'attestation_signer_unavailable'
      | 'attestation_signer_mismatch'
      | 'attestation_input_mismatch',
    message: string
  ) {
    super(message);
    this.name = 'TrustedCompletionProducerError';
  }
}

/**
 * Fail-closed producer used when an Action's historical public authority is
 * still verifiable but its private credential provider is not installed.
 */
export function createUnavailableTrustedCompletionProducer(input: Readonly<{
  adapter: TrustedCompletionProducer['adapter'];
  authority: AttestationAuthority;
}>): TrustedCompletionProducer {
  validateAttestationAuthority(input.authority);
  return Object.freeze({
    adapter: Object.freeze({ ...input.adapter }),
    authority: Object.freeze(structuredClone(input.authority)),
    attestCompletion(): AttestedCompletionSubmission {
      throw new TrustedCompletionProducerError(
        'attestation_signer_unavailable',
        'The frozen Action authority remains verifiable, but its trusted signer is unavailable.'
      );
    },
    attestConsultation(): AttestedConsultationSubmission {
      throw new TrustedCompletionProducerError(
        'attestation_signer_unavailable',
        'The frozen Action authority remains verifiable, but its trusted signer is unavailable.'
      );
    },
  });
}

function buildSignedRef(
  privateKey: KeyObject,
  authority: AttestationAuthority,
  input: Readonly<{
    content: Uint8Array;
    mediaType: string;
    observationKind: string;
    producer: EvidenceRef['producer'];
    binding: EvidenceRef['binding'];
  }>
): AttestedEvidenceRefV2 {
  const base = {
    format: 'change-run-evidence-ref/2' as const,
    contentDigest: computeEvidenceContentDigest(input.content),
    mediaType: input.mediaType,
    sizeBytes: input.content.byteLength,
    observationKind: input.observationKind,
    producer: input.producer,
    binding: input.binding,
  };
  const authorityDigest = computeAttestationAuthorityDigest(authority);
  const identity = unsignedEvidenceIdentity(base, authorityDigest);
  const signature = sign(null, evidenceProofMessage(identity), privateKey);
  const proof = {
    format: 'change-run-evidence-proof/1' as const,
    authorityDigest,
    signature: signature.toString('base64'),
  };
  return {
    ...base,
    proof,
    evidenceDigest: computeAttestedEvidenceRefDigest(identity, proof),
  };
}

function semanticCompletion(
  input: TrustedCompletionInput,
  evidence: AttestedEvidenceRefV2,
  actorAttestation: EvidenceRef
): CompleteRunAction {
  const base = {
    format: 'change-run-completion/1' as const,
    change: input.change,
    runId: input.action.runId,
    actionId: input.action.actionId,
    invocationId: input.action.invocationId,
    receiptDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' as Digest,
    actor: input.action.completionAuthority!.actor,
    actorAttestation,
    evidence: [evidence],
  };
  return (input.completion.kind === 'domain-action-result'
    ? { ...base, ...input.completion }
    : input.completion.kind === 'effect-observation'
      ? { ...base, ...input.completion }
      : { ...base, ...input.completion }) as CompleteRunAction;
}

export function createTrustedCompletionProducer(input: Readonly<{
  adapter: TrustedCompletionProducer['adapter'];
  authority: AttestationAuthority;
  privateKey: KeyObject;
}>): TrustedCompletionProducer {
  if (input.privateKey.type !== 'private' || input.privateKey.asymmetricKeyType !== 'ed25519') {
    throw new TrustedCompletionProducerError(
      'attestation_signer_unavailable',
      'Trusted completion producer requires a private Ed25519 KeyObject.'
    );
  }
  const expectedPublic = validateAttestationAuthority(input.authority);
  const actualPublic = createPublicKey(input.privateKey);
  const expectedDer = expectedPublic.export({ format: 'der', type: 'spki' });
  const actualDer = actualPublic.export({ format: 'der', type: 'spki' });
  if (!Buffer.from(expectedDer).equals(Buffer.from(actualDer))) {
    throw new TrustedCompletionProducerError(
      'attestation_signer_mismatch',
      'Trusted completion producer private key does not match its public authority.'
    );
  }
  const adapter = Object.freeze({ ...input.adapter });
  const authority = Object.freeze(structuredClone(input.authority));

  const assertFrozenInput = (
    request: Readonly<{ record: CanonicalRunRecord; action: RunAction }>
  ): NonNullable<RunAction['completionAuthority']> => {
    const frozen = request.action.completionAuthority;
    if (
      frozen?.attestationAuthority === undefined ||
      canonicalJson(frozen.attestationAuthority) !== canonicalJson(authority) ||
      request.action.capability.artifact.id !== adapter.id ||
      request.action.capability.artifact.version !== adapter.version ||
      request.action.capability.artifact.contentDigest !== adapter.contentDigest ||
      request.record.runId !== request.action.runId ||
      canonicalJson(request.record.actions[request.action.actionId]?.action) !==
        canonicalJson(request.action)
    ) {
      throw new TrustedCompletionProducerError(
        'attestation_input_mismatch',
        'Trusted producer input does not match its exact frozen Adapter/Action.'
      );
    }
    return frozen;
  };

  return Object.freeze({
    adapter,
    authority,
    attestCompletion(
      request: TrustedCompletionInput
    ): AttestedCompletionSubmission {
      const frozen = assertFrozenInput(request);
      const use = request.completion.kind === 'domain-action-result'
        ? frozen.observations.domainActionResult
        : request.completion.kind === 'effect-observation'
          ? frozen.observations.effectObservation
          : frozen.observations.infrastructureObservation;
      const binding = {
        planningSpaceId: request.record.change.planningSpaceId,
        changeInstanceId: request.record.change.instanceId,
        projectId: request.record.change.projectId,
        changeId: request.record.change.changeId,
        runId: request.record.runId,
        actionId: request.action.actionId,
        ...(request.completion.kind === 'effect-observation'
          ? { effectId: request.completion.effectId }
          : {}),
        treeDigest: request.action.expectedBeforeWorkspace.treeDigest,
        schema: use.schema,
      };
      const evidence = buildSignedRef(input.privateKey, authority, {
        content: request.evidenceContent,
        mediaType: use.mediaType,
        observationKind: use.observationKind,
        producer: use.producer,
        binding,
      });
      const preliminary = semanticCompletion(request, evidence, evidence);
      const claim = buildCompletionClaim(
        request.record,
        request.action,
        preliminary,
        evidence
      );
      const actorBytes = Buffer.from(canonicalJson(claim), 'utf8');
      const attestationUse = frozen.actorAttestation;
      const actorAttestation = buildSignedRef(input.privateKey, authority, {
        content: actorBytes,
        mediaType: attestationUse.mediaType,
        observationKind: attestationUse.observationKind,
        producer: attestationUse.producer,
        binding: {
          planningSpaceId: request.record.change.planningSpaceId,
          changeInstanceId: request.record.change.instanceId,
          projectId: request.record.change.projectId,
          changeId: request.record.change.changeId,
          runId: request.record.runId,
          actionId: request.action.actionId,
          treeDigest: request.action.expectedBeforeWorkspace.treeDigest,
          schema: attestationUse.schema,
        },
      });
      const withoutReceipt = semanticCompletion(request, evidence, actorAttestation);
      const completion = decodeCompletion({
        ...withoutReceipt,
        receiptDigest: computeCompletionReceiptDigest(withoutReceipt),
      });
      return Object.freeze({
        completion,
        uploads: Object.freeze([
          Object.freeze({
            contentDigest: evidence.contentDigest as Digest,
            contentBase64: Buffer.from(request.evidenceContent).toString('base64'),
          }),
          Object.freeze({
            contentDigest: actorAttestation.contentDigest as Digest,
            contentBase64: actorBytes.toString('base64'),
          }),
        ]),
      });
    },
    attestConsultation(
      request: TrustedConsultationInput
    ): AttestedConsultationSubmission {
      const frozen = assertFrozenInput(request);
      if (
        request.action.kind !== 'agent' ||
        request.action.agent.consultation?.eligible !== true
      ) {
        throw new TrustedCompletionProducerError(
          'attestation_input_mismatch',
          'Only a frozen consultation-eligible agent Action can attest CONSULT.'
        );
      }
      const parsed = parseConsultableLeafReturn(request.result);
      if (parsed.status !== 'CONSULT') {
        throw new TrustedCompletionProducerError(
          'attestation_input_mismatch',
          'The selected consultable worker step is terminal, not CONSULT.'
        );
      }
      const resultBytes = Buffer.from(request.result, 'utf8');
      const computedResultDigest = computeEvidenceContentDigest(resultBytes);
      const suppliedResultDigest = request.resultDigest.startsWith('sha256:')
        ? request.resultDigest
        : `sha256:${request.resultDigest}`;
      if (suppliedResultDigest !== computedResultDigest) {
        throw new TrustedCompletionProducerError(
          'attestation_input_mismatch',
          'SessionHost result bytes do not match the settled result digest.'
        );
      }
      const use = frozen.observations.domainActionResult;
      const binding = {
        planningSpaceId: request.record.change.planningSpaceId,
        changeInstanceId: request.record.change.instanceId,
        projectId: request.record.change.projectId,
        changeId: request.record.change.changeId,
        runId: request.record.runId,
        actionId: request.action.actionId,
        treeDigest: request.action.expectedBeforeWorkspace.treeDigest,
        schema: use.schema,
      };
      const evidence = buildSignedRef(input.privateKey, authority, {
        content: resultBytes,
        mediaType: use.mediaType,
        observationKind: use.observationKind,
        producer: use.producer,
        binding,
      });
      const question = {
        problemSummary: parsed.problemSummary,
        question: parsed.question,
        attemptedApproaches: parsed.attemptedApproaches,
        constraints: parsed.constraints,
        evidencePointers: parsed.evidencePointers,
      };
      const preliminary: ConsultationStepSubmission = {
        format: 'teacher-consultation/submission/1',
        runId: request.record.runId,
        actionId: request.action.actionId as never,
        invocationId: request.action.invocationId as never,
        expectedRecordVersion: request.record.recordVersion as never,
        stableSessionId: request.stableSessionId,
        requestId: request.requestId,
        resultDigest: computedResultDigest,
        question,
        actor: frozen.actor,
        actorAttestation: evidence,
        evidence: [evidence],
      };
      const claim = buildConsultationClaim(
        request.record,
        request.action,
        preliminary,
        evidence
      );
      const actorBytes = Buffer.from(canonicalJson(claim), 'utf8');
      const attestationUse = frozen.actorAttestation;
      const actorAttestation = buildSignedRef(input.privateKey, authority, {
        content: actorBytes,
        mediaType: attestationUse.mediaType,
        observationKind: attestationUse.observationKind,
        producer: attestationUse.producer,
        binding: {
          planningSpaceId: request.record.change.planningSpaceId,
          changeInstanceId: request.record.change.instanceId,
          projectId: request.record.change.projectId,
          changeId: request.record.change.changeId,
          runId: request.record.runId,
          actionId: request.action.actionId,
          treeDigest: request.action.expectedBeforeWorkspace.treeDigest,
          schema: attestationUse.schema,
        },
      });
      const consultation = decodeConsultationStepSubmission(
        { ...preliminary, actorAttestation },
        request.limits
      );
      return Object.freeze({
        consultation,
        uploads: Object.freeze([
          Object.freeze({
            contentDigest: evidence.contentDigest as Digest,
            contentBase64: resultBytes.toString('base64'),
          }),
          Object.freeze({
            contentDigest: actorAttestation.contentDigest as Digest,
            contentBase64: actorBytes.toString('base64'),
          }),
        ]),
      });
    },
  });
}
