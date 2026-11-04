import {
  createHash,
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
} from 'node:crypto';

import type {
  ActorRef,
  AttestationAuthority,
  AttestedEvidenceRefV2,
  CompleteRunAction,
  Digest,
  EvidenceRef,
  RunAction,
} from '../contracts.js';
import type { ConsultationStepSubmission } from '../consultation-contracts.js';
import type { CanonicalRunRecord } from './record.js';
import { verifyActorRef } from './actors.js';
import { canonicalJson } from './identity.js';
import {
  computeEvidenceContentDigest,
  EvidenceError,
  verifyEvidenceBinding,
  verifyEvidenceContent,
} from './evidence.js';

const encoder = new TextEncoder();

export interface UnsignedEvidenceIdentityV2 {
  readonly format: 'change-run-unsigned-evidence/2';
  readonly authorityDigest: Digest;
  readonly contentDigest: Digest;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly observationKind: string;
  readonly producer: EvidenceRef['producer'];
  readonly binding: EvidenceRef['binding'];
}

export type CompletionClaimV1 = Readonly<{
  format: 'change-run-completion-claim/1';
  authorityDigest: Digest;
  binding: {
    planningSpaceId: string;
    changeInstanceId: string;
    projectId: string;
    changeId: string;
    runId: string;
    actionId: string;
    expectedTreeDigest: Digest;
  };
  actor: ActorRef;
  completion:
    | {
        kind: 'domain_action_result';
        status: string;
        result: unknown;
        evidence: { domainActionResult: Digest };
      }
    | {
        kind: 'effect_observation';
        effectId: string;
        status: string;
        observation: unknown;
        evidence: { effectObservation: Digest };
      }
    | {
        kind: 'infrastructure_observation';
        status: 'infrastructure_failed';
        error: unknown;
        evidence: { infrastructureObservation: Digest };
      };
}>;

export type AttestationErrorCode =
  | 'attestation_authority_missing'
  | 'attestation_authority_invalid'
  | 'attestation_proof_required'
  | 'attestation_proof_invalid'
  | 'attestation_claim_mismatch'
  | 'attestation_completion_mismatch';

export class AttestationError extends Error {
  constructor(
    readonly code: AttestationErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AttestationError';
  }
}

function prefixedDigest(prefix: string, payload: string | Uint8Array): Digest {
  const hash = createHash('sha256');
  hash.update(encoder.encode(`${prefix}\0`));
  hash.update(payload);
  return `sha256:${hash.digest('hex')}` as Digest;
}

function canonicalBase64(value: string, label: string): Buffer {
  if (value.length === 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new AttestationError(
      'attestation_authority_invalid',
      `${label} is not canonical base64.`
    );
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) {
    throw new AttestationError(
      'attestation_authority_invalid',
      `${label} is not canonical base64.`
    );
  }
  return bytes;
}

export function validateAttestationAuthority(
  authority: AttestationAuthority
): KeyObject {
  if (
    authority.format !== 'change-run-attestation-authority/1' ||
    authority.algorithm !== 'ed25519' ||
    authority.publicKey.format !== 'spki-der' ||
    authority.publicKey.encoding !== 'base64'
  ) {
    throw new AttestationError(
      'attestation_authority_invalid',
      'Attestation authority is not the supported canonical Ed25519 SPKI form.'
    );
  }
  const der = canonicalBase64(authority.publicKey.value, 'Attestation public key');
  if (computeEvidenceContentDigest(der) !== authority.publicKey.digest) {
    throw new AttestationError(
      'attestation_authority_invalid',
      'Attestation public-key digest does not match its DER bytes.'
    );
  }
  let key: KeyObject;
  try {
    key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch (error) {
    throw new AttestationError(
      'attestation_authority_invalid',
      `Attestation public key is malformed: ${(error as Error).message}`
    );
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new AttestationError(
      'attestation_authority_invalid',
      'Attestation public key is not Ed25519.'
    );
  }
  const canonicalDer = key.export({ format: 'der', type: 'spki' });
  if (!Buffer.from(canonicalDer).equals(der)) {
    throw new AttestationError(
      'attestation_authority_invalid',
      'Attestation public key is not canonical SPKI DER.'
    );
  }
  return key;
}

export function computeAttestationAuthorityDigest(
  authority: AttestationAuthority
): Digest {
  validateAttestationAuthority(authority);
  return prefixedDigest(
    'rasen/change-run-attestation-authority/1',
    canonicalJson(authority)
  );
}

export function unsignedEvidenceIdentity(
  ref: Omit<AttestedEvidenceRefV2, 'evidenceDigest' | 'proof'>,
  authorityDigest: Digest
): UnsignedEvidenceIdentityV2 {
  return {
    format: 'change-run-unsigned-evidence/2',
    authorityDigest,
    contentDigest: ref.contentDigest as Digest,
    mediaType: ref.mediaType,
    sizeBytes: ref.sizeBytes,
    observationKind: ref.observationKind,
    producer: ref.producer,
    binding: ref.binding,
  };
}

export function evidenceProofMessage(
  identity: UnsignedEvidenceIdentityV2
): Uint8Array {
  return Buffer.concat([
    Buffer.from('rasen/change-run-evidence-proof/1\0', 'utf8'),
    Buffer.from(canonicalJson(identity), 'utf8'),
  ]);
}

export function computeAttestedEvidenceRefDigest(
  identity: UnsignedEvidenceIdentityV2,
  proof: AttestedEvidenceRefV2['proof']
): Digest {
  return prefixedDigest(
    'rasen/change-run-evidence-ref/2',
    canonicalJson({ unsignedEvidenceIdentity: identity, proof })
  );
}

export function verifyAttestedEvidence(
  ref: EvidenceRef,
  content: Uint8Array,
  authority: AttestationAuthority
): asserts ref is AttestedEvidenceRefV2 {
  if (ref.format !== 'change-run-evidence-ref/2') {
    throw new AttestationError(
      'attestation_proof_required',
      'Executable completion requires an authenticated EvidenceRef v2.'
    );
  }
  const authorityDigest = computeAttestationAuthorityDigest(authority);
  if (ref.proof.authorityDigest !== authorityDigest) {
    throw new AttestationError(
      'attestation_proof_invalid',
      'Evidence proof is not bound to the Action authority.'
    );
  }
  verifyEvidenceContent(ref, content);
  const { evidenceDigest: _digest, proof, ...base } = ref;
  const identity = unsignedEvidenceIdentity(base, authorityDigest);
  if (ref.evidenceDigest !== computeAttestedEvidenceRefDigest(identity, proof)) {
    throw new AttestationError(
      'attestation_proof_invalid',
      'Authenticated EvidenceRef digest does not match its canonical proof envelope.'
    );
  }
  const signature = canonicalBase64(proof.signature, 'Evidence signature');
  if (signature.byteLength !== 64) {
    throw new AttestationError(
      'attestation_proof_invalid',
      'Ed25519 evidence signature must be exactly 64 bytes.'
    );
  }
  const key = validateAttestationAuthority(authority);
  if (!verifySignature(null, evidenceProofMessage(identity), key, signature)) {
    throw new AttestationError(
      'attestation_proof_invalid',
      'Evidence signature was not produced by the Action authority.'
    );
  }
}

function expectedEvidenceUse(
  request: CompleteRunAction,
  action: RunAction
) {
  const authority = action.completionAuthority!;
  return request.kind === 'domain-action-result'
    ? authority.observations.domainActionResult
    : request.kind === 'effect-observation'
      ? authority.observations.effectObservation
      : authority.observations.infrastructureObservation;
}

export function buildCompletionClaim(
  record: CanonicalRunRecord,
  action: RunAction,
  request: CompleteRunAction,
  evidence: AttestedEvidenceRefV2
): CompletionClaimV1 {
  const authority = action.completionAuthority?.attestationAuthority;
  if (authority === undefined) {
    throw new AttestationError(
      'attestation_authority_missing',
      'Admitted Action has no frozen public attestation authority.'
    );
  }
  const base = {
    format: 'change-run-completion-claim/1' as const,
    authorityDigest: computeAttestationAuthorityDigest(authority),
    binding: {
      planningSpaceId: record.change.planningSpaceId,
      changeInstanceId: record.change.instanceId,
      projectId: record.change.projectId,
      changeId: record.change.changeId,
      runId: record.runId,
      actionId: action.actionId,
      expectedTreeDigest: action.expectedBeforeWorkspace.treeDigest as Digest,
    },
    actor: request.actor,
  };
  if (request.kind === 'domain-action-result') {
    return {
      ...base,
      completion: {
        kind: 'domain_action_result',
        status: request.status,
        result: request.result,
        evidence: { domainActionResult: evidence.evidenceDigest as Digest },
      },
    };
  }
  if (request.kind === 'effect-observation') {
    return {
      ...base,
      completion: {
        kind: 'effect_observation',
        effectId: request.effectId,
        status: request.status,
        observation: request.observation,
        evidence: { effectObservation: evidence.evidenceDigest as Digest },
      },
    };
  }
  return {
    ...base,
    completion: {
      kind: 'infrastructure_observation',
      status: 'infrastructure_failed',
      error: request.error,
      evidence: { infrastructureObservation: evidence.evidenceDigest as Digest },
    },
  };
}

function assertEvidenceUse(
  ref: AttestedEvidenceRefV2,
  expected: ReturnType<typeof expectedEvidenceUse>,
  label: string
): void {
  if (
    canonicalJson(ref.producer) !== canonicalJson(expected.producer) ||
    ref.observationKind !== expected.observationKind ||
    ref.binding.schema !== expected.schema ||
    ref.mediaType !== expected.mediaType
  ) {
    throw new AttestationError(
      'attestation_completion_mismatch',
      `${label} does not match the frozen producer/evidence contract.`
    );
  }
}

/**
 * One public verifier for both transport validation and facade re-verification.
 * Callers supply bytes through a read-only lookup; this module owns all
 * canonical preimages, frozen-authority checks and completion-claim rules.
 */
export function verifyAttestedCompletion(
  record: CanonicalRunRecord,
  action: RunAction,
  request: CompleteRunAction,
  read: (ref: EvidenceRef) => Uint8Array
): void {
  if (request.change.changeId !== record.change.changeId) {
    throw new AttestationError(
      'attestation_completion_mismatch',
      'Completion change does not match the canonical Run.'
    );
  }
  const completionAuthority = action.completionAuthority;
  const authority = completionAuthority?.attestationAuthority;
  if (completionAuthority === undefined || authority === undefined) {
    throw new AttestationError(
      'attestation_authority_missing',
      'Legacy or unsigned Action cannot accept executable completion.'
    );
  }
  validateAttestationAuthority(authority);
  verifyActorRef(request.actor);
  if (canonicalJson(request.actor) !== canonicalJson(completionAuthority.actor)) {
    throw new AttestationError(
      'attestation_completion_mismatch',
      'Completion actor does not match the Action authority.'
    );
  }
  if (request.evidence.length !== 1) {
    throw new AttestationError(
      'attestation_completion_mismatch',
      'Authenticated completion requires exactly one labeled evidence object.'
    );
  }

  const evidence = request.evidence[0]!;
  const evidenceBytes = read(evidence);
  verifyAttestedEvidence(evidence, evidenceBytes, authority);
  assertEvidenceUse(evidence, expectedEvidenceUse(request, action), 'Completion evidence');
  verifyEvidenceBinding(evidence, {
    planningSpaceId: record.change.planningSpaceId,
    changeInstanceId: record.change.instanceId,
    projectId: record.change.projectId,
    changeId: record.change.changeId,
    runId: record.runId,
    actionId: action.actionId,
    schema: evidence.binding.schema,
    treeDigest: action.expectedBeforeWorkspace.treeDigest as Digest,
    ...(request.kind === 'effect-observation' ? { effectId: request.effectId } : {}),
  });

  const actorAttestation = request.actorAttestation;
  const actorBytes = read(actorAttestation);
  verifyAttestedEvidence(actorAttestation, actorBytes, authority);
  assertEvidenceUse(
    actorAttestation,
    completionAuthority.actorAttestation,
    'Actor attestation'
  );
  verifyEvidenceBinding(actorAttestation, {
    planningSpaceId: record.change.planningSpaceId,
    changeInstanceId: record.change.instanceId,
    projectId: record.change.projectId,
    changeId: record.change.changeId,
    runId: record.runId,
    actionId: action.actionId,
    schema: actorAttestation.binding.schema,
    treeDigest: action.expectedBeforeWorkspace.treeDigest as Digest,
  });
  const claim = buildCompletionClaim(record, action, request, evidence);
  const expectedClaim = Buffer.from(canonicalJson(claim), 'utf8');
  if (!Buffer.from(actorBytes).equals(expectedClaim)) {
    throw new AttestationError(
      'attestation_claim_mismatch',
      'Actor attestation is not the exact canonical completion claim.'
    );
  }
  if (
    request.kind === 'infrastructure-observation' &&
    request.error.adapterArtifactDigest !== action.capability.artifact.contentDigest
  ) {
    throw new AttestationError(
      'attestation_completion_mismatch',
      'Infrastructure observation is bound to another Adapter artifact.'
    );
  }
}

/**
 * Verify a non-terminal CONSULT result against the same frozen Action trust
 * root as an ordinary completion. The claim is distinct so a signed terminal
 * completion cannot be replayed as a consultation (or vice versa).
 */
export function verifyAttestedConsultationSubmission(
  record: CanonicalRunRecord,
  action: RunAction,
  request: ConsultationStepSubmission,
  read: (ref: EvidenceRef) => Uint8Array
): void {
  const completionAuthority = action.completionAuthority;
  const authority = completionAuthority?.attestationAuthority;
  if (completionAuthority === undefined || authority === undefined) {
    throw new AttestationError(
      'attestation_authority_missing',
      'Legacy or unsigned Action cannot submit a consultation.'
    );
  }
  if (
    request.runId !== record.runId ||
    request.actionId !== action.actionId ||
    request.invocationId !== action.invocationId
  ) {
    throw new AttestationError(
      'attestation_completion_mismatch',
      'Consultation submission does not address the exact canonical Action.'
    );
  }
  validateAttestationAuthority(authority);
  verifyActorRef(request.actor);
  if (canonicalJson(request.actor) !== canonicalJson(completionAuthority.actor)) {
    throw new AttestationError(
      'attestation_completion_mismatch',
      'Consultation actor does not match the Action authority.'
    );
  }
  if (request.evidence.length !== 1) {
    throw new AttestationError(
      'attestation_completion_mismatch',
      'Authenticated consultation requires exactly one question evidence object.'
    );
  }
  const evidence = request.evidence[0]!;
  const evidenceBytes = read(evidence);
  verifyAttestedEvidence(evidence, evidenceBytes, authority);
  assertEvidenceUse(
    evidence,
    completionAuthority.observations.domainActionResult,
    'Consultation question evidence'
  );
  verifyEvidenceBinding(evidence, {
    planningSpaceId: record.change.planningSpaceId,
    changeInstanceId: record.change.instanceId,
    projectId: record.change.projectId,
    changeId: record.change.changeId,
    runId: record.runId,
    actionId: action.actionId,
    schema: evidence.binding.schema,
    treeDigest: action.expectedBeforeWorkspace.treeDigest as Digest,
  });
  const actorAttestation = request.actorAttestation;
  const actorBytes = read(actorAttestation);
  verifyAttestedEvidence(actorAttestation, actorBytes, authority);
  assertEvidenceUse(
    actorAttestation,
    completionAuthority.actorAttestation,
    'Consultation actor attestation'
  );
  verifyEvidenceBinding(actorAttestation, {
    planningSpaceId: record.change.planningSpaceId,
    changeInstanceId: record.change.instanceId,
    projectId: record.change.projectId,
    changeId: record.change.changeId,
    runId: record.runId,
    actionId: action.actionId,
    schema: actorAttestation.binding.schema,
    treeDigest: action.expectedBeforeWorkspace.treeDigest as Digest,
  });
  const claim = buildConsultationClaim(record, action, request, evidence);
  if (!Buffer.from(actorBytes).equals(Buffer.from(canonicalJson(claim), 'utf8'))) {
    throw new AttestationError(
      'attestation_claim_mismatch',
      'Actor attestation is not the exact canonical consultation claim.'
    );
  }
}

/** Canonical signed claim for one non-terminal consultation step. */
export function buildConsultationClaim(
  record: CanonicalRunRecord,
  action: RunAction,
  request: ConsultationStepSubmission,
  evidence: EvidenceRef
) {
  const authority = action.completionAuthority?.attestationAuthority;
  if (authority === undefined) {
    throw new AttestationError(
      'attestation_authority_missing',
      'Consultation claim construction requires a frozen attestation authority.'
    );
  }
  return {
    format: 'teacher-consultation-claim/1',
    authorityDigest: computeAttestationAuthorityDigest(authority),
    binding: {
      planningSpaceId: record.change.planningSpaceId,
      changeInstanceId: record.change.instanceId,
      projectId: record.change.projectId,
      changeId: record.change.changeId,
      runId: record.runId,
      actionId: action.actionId,
      expectedTreeDigest: action.expectedBeforeWorkspace.treeDigest,
      expectedRecordVersion: request.expectedRecordVersion,
    },
    actor: request.actor,
    consultation: {
      requestId: request.requestId,
      resultDigest: request.resultDigest,
      stableSessionId: request.stableSessionId,
      question: request.question,
      evidence: { question: evidence.evidenceDigest },
    },
  };
}
