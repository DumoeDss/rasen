import { createHash, generateKeyPairSync } from 'node:crypto';

import type {
  AttestationAuthority,
  CompleteRunAction,
  Digest,
  EvidenceRef,
  RunAction,
} from '../../src/core/change-run/contracts.js';
import {
  createTrustedCompletionProducer,
  type TrustedCompletionProducer,
} from '../../src/core/change-run/internal/trusted-completion-producer.js';
import {
  createTrustedExecutionAdapterCatalog,
  provisionTrustedExecutionAdapterCatalog,
  provisionTrustedExecutionAdapterCredentials,
  type TrustedExecutionAdapterCatalog,
  type TrustedExecutionAdapterDescriptor,
} from '../../src/core/pipeline-registry/trusted-execution-adapters.js';
import type { RuntimeCapabilityBinding } from '../../src/core/pipeline-registry/execution-plan-internal.js';
import { resolveRuntimeExecutionProfile } from '../../src/core/pipeline-registry/profile-resolver.js';
import { freezeProductionPreparedPipelineRegistry } from '../../src/core/pipeline-registry/prepared-registry.js';
import type { BoundedEvidenceStore } from '../../src/core/change-run/internal/evidence.js';
import type {
  AttestedCompletionSubmission,
  TrustedCompletionInput,
} from '../../src/core/change-run/internal/trusted-completion-producer.js';

const pair = generateKeyPairSync('ed25519');
const publicDer = pair.publicKey.export({ format: 'der', type: 'spki' });

export const TEST_ATTESTATION_AUTHORITY: AttestationAuthority = Object.freeze({
  format: 'change-run-attestation-authority/1',
  algorithm: 'ed25519',
  keyId: 'rasen-test-host',
  keyVersion: '1',
  publicKey: Object.freeze({
    format: 'spki-der',
    encoding: 'base64',
    value: Buffer.from(publicDer).toString('base64'),
    digest: `sha256:${createHash('sha256').update(publicDer).digest('hex')}` as Digest,
  }),
});

export function trustedDescriptor(
  adapter: Readonly<{ id: string; version: string; contentDigest: Digest }>,
  authority: AttestationAuthority = TEST_ATTESTATION_AUTHORITY
): TrustedExecutionAdapterDescriptor {
  return {
    format: 'trusted-execution-adapter/1',
    adapter,
    attestationAuthority: authority,
  };
}

export function trustedCatalogForBindings(
  bindings: readonly RuntimeCapabilityBinding[],
  authority: AttestationAuthority = TEST_ATTESTATION_AUTHORITY
): TrustedExecutionAdapterCatalog {
  const unique = new Map<string, TrustedExecutionAdapterDescriptor>();
  for (const binding of bindings) {
    const adapter = {
      id: binding.adapter.id,
      version: binding.adapter.version,
      contentDigest: binding.adapter.contentDigest as Digest,
    };
    unique.set(
      `${adapter.id}\0${adapter.version}\0${adapter.contentDigest}`,
      trustedDescriptor(adapter, authority)
    );
  }
  return createTrustedExecutionAdapterCatalog([...unique.values()]);
}

type TestRuntimeCapabilityBindingInput = Omit<
  RuntimeCapabilityBinding,
  'adapter'
> &
  Readonly<{
    adapter: Omit<
      RuntimeCapabilityBinding['adapter'],
      'attestationAuthority'
    > &
      Readonly<{
        attestationAuthority?: AttestationAuthority;
      }>;
  }>;

/**
 * Complete an executable test binding with the one shared public test
 * authority. Production deliberately has no equivalent fallback: every real
 * binding must still resolve its authority from the host-owned catalog.
 */
export function withTestAttestationAuthority(
  binding: TestRuntimeCapabilityBindingInput
): RuntimeCapabilityBinding {
  return {
    ...binding,
    adapter: {
      ...binding.adapter,
      attestationAuthority:
        binding.adapter.attestationAuthority ?? TEST_ATTESTATION_AUTHORITY,
    },
  };
}

/**
 * Test-host bootstrap for fresh CLI journeys. It discovers the exact Adapter
 * artifacts selected by production preparation, then provisions only their
 * public descriptors into the journey's isolated host-state root. The private
 * key remains module-local to this test fixture.
 */
export async function provisionTestTrustedExecutionAdaptersForPipeline(
  projectRoot: string,
  hostStateRoot: string,
  pipelineName: string
): Promise<void> {
  const registry = await freezeProductionPreparedPipelineRegistry(projectRoot, {
    reporter: false,
  });
  const execution = await registry.selectForExecution(pipelineName, {
    reporter: false,
  });
  const prepared = execution.resolution.prepared;
  const sourceRevision = {
    layer: execution.resolution.source,
    kind: 'pipeline-yaml' as const,
    sourceId: `${execution.resolution.source}:${prepared.definition.name}`,
    authoredContentDigest: `sha256:${prepared.digests.source}` as Digest,
    semanticDigest: `sha256:${prepared.digests.source}` as Digest,
  };
  const discoveryProfile = resolveRuntimeExecutionProfile(
    prepared,
    registry.catalog,
    [],
    sourceRevision,
    { maxAttempts: 3, maxActions: 64 },
    undefined,
    undefined
  );
  const catalog = trustedCatalogForBindings(discoveryProfile.capabilities);
  provisionTrustedExecutionAdapterCatalog(hostStateRoot, catalog.descriptors);
}

/** Test-host installation of the module-local private half. */
export function provisionTestTrustedExecutionAdapterCredentials(
  hostStateRoot: string,
  descriptors: readonly TrustedExecutionAdapterDescriptor[]
): void {
  provisionTrustedExecutionAdapterCredentials(
    hostStateRoot,
    descriptors.map((descriptor) => ({
      descriptor,
      privateKey: pair.privateKey,
    }))
  );
}

export function createTestTrustedCompletionProducer(
  action: RunAction
): TrustedCompletionProducer {
  const authority = action.completionAuthority?.attestationAuthority;
  if (authority === undefined) {
    throw new Error(
      `Test Action has no frozen attestation authority: ${JSON.stringify(action.completionAuthority)}`
    );
  }
  return createTrustedCompletionProducer({
    adapter: {
      id: action.capability.artifact.id,
      version: action.capability.artifact.version,
      contentDigest: action.capability.artifact.contentDigest as Digest,
    },
    authority,
    privateKey: pair.privateKey,
  });
}

export function attestTestCompletion(
  input: TrustedCompletionInput
): AttestedCompletionSubmission {
  return createTestTrustedCompletionProducer(input.action).attestCompletion(input);
}

/** Publish a fully verified test-host submission into an in-memory evidence store. */
export function stageTestCompletion(
  store: BoundedEvidenceStore,
  submission: AttestedCompletionSubmission
): CompleteRunAction {
  const refs: readonly EvidenceRef[] = [
    submission.completion.actorAttestation,
    ...submission.completion.evidence,
  ];
  for (const upload of submission.uploads) {
    const ref = refs.find((candidate) => candidate.contentDigest === upload.contentDigest);
    if (ref === undefined) {
      throw new Error(`Test submission upload ${upload.contentDigest} has no evidence ref.`);
    }
    store.stageClaimed(ref, Buffer.from(upload.contentBase64, 'base64'));
  }
  return submission.completion;
}
