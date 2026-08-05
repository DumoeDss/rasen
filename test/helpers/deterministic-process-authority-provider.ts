import {
  PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  createProcessAuthorityPublicationAcknowledgement,
  type AuthorityOperationContext,
  type ProcessAuthorityProvider,
  type ProcessAuthorityProviderDescriptor,
  type ProviderControlOutcome,
  type ProviderObservation,
} from '../../src/core/session-host/process-authority/index.js';
import { createProviderAuthorityReference } from '../../src/core/session-host/process-authority/reference-codec.js';
import type { ProcessAuthorityProviderConformanceFixture } from './process-authority-provider-conformance.js';

export function createDeterministicProcessAuthorityProviderFixture():
ProcessAuthorityProviderConformanceFixture;
export function createDeterministicProcessAuthorityProviderFixture(
  mutation?: import('./process-authority-provider-conformance.js').ProcessAuthorityProviderMutation
): ProcessAuthorityProviderConformanceFixture {
  const descriptor: ProcessAuthorityProviderDescriptor = {
    providerId: 'test.conformance',
    capabilityId: RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
    protocolVersion: 1,
    commonContractVersion: PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
    providerReferenceVersion: 1,
    semantics: RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  };
  let starts = 0;
  let preparationGeneration = 0;
  let scenario: Parameters<ProcessAuthorityProviderConformanceFixture['setScenario']>[0] = 'normal';
  let destructiveControls = 0;
  let releasedWithoutExactReceipt = false;
  const events: Array<() => void> = [];
  let observation: ProviderObservation = { state: 'live' };
  let control: ProviderControlOutcome = { state: 'exact-scope-empty' };
  const provider: ProcessAuthorityProvider = {
    descriptor,
    async prepare() {
      if (scenario === 'prepare-unavailable') {
        return {
          state: 'authority-unavailable',
          diagnostic: 'selected provider prerequisites unavailable',
        };
      }
      preparationGeneration += 1;
      if (mutation === 'activate-before-publication') starts += 1;
      return {
        reference: mutation === 'reference-tamper-future-version'
          ? createProviderAuthorityReference(2, Buffer.from('future-authority'))
          : createProviderAuthorityReference(
              1,
              Buffer.from(
                mutation === 'reference-reuse'
                  ? 'conformance-authority-reused'
                  : `conformance-authority-${preparationGeneration}`
              )
            ),
        activate: async (_context: AuthorityOperationContext) => {
          starts += 1;
          if (mutation === 'duplicate-late-outcomes') events.push(() => { starts += 1; });
          return { state: 'live' };
        },
      };
    },
    async inspect(_reference, context) {
      if (scenario === 'optimistic-close') {
        return mutation === 'optimistic-close' ? { state: 'exact-scope-empty' } : { state: 'live' };
      }
      if (scenario === 'unavailable') {
        return mutation === 'unavailable-uncertain-retention'
          ? { state: 'exact-scope-empty' }
          : { state: 'authority-unavailable', diagnostic: 'unavailable' };
      }
      if (scenario === 'uncertain') {
        return mutation === 'unavailable-uncertain-retention'
          ? { state: 'exact-scope-empty' }
          : { state: 'authority-uncertain', diagnostic: 'uncertain' };
      }
      if (scenario === 'identity-drift') {
        return { state: 'identity-drift', diagnostic: 'identity changed' };
      }
      if (scenario === 'event-gap') return { state: 'event-gap', diagnostic: 'event gap' };
      if (scenario === 'timeout') {
        if (mutation === 'timeout') {
          context.signal.addEventListener('abort', () => { releasedWithoutExactReceipt = true; }, { once: true });
        }
        return new Promise<ProviderObservation>(() => undefined);
      }
      if (scenario === 'late-control') {
        return new Promise<ProviderObservation>((resolve) => {
          events.push(() => resolve({ state: 'exact-scope-empty' }));
        });
      }
      if (scenario === 'control-loss' || scenario === 'adapter-authority-loss') {
        if (mutation === scenario) releasedWithoutExactReceipt = true;
        throw new Error('deterministic control loss');
      }
      return observation;
    },
    async terminate() {
      if (scenario === 'identity-drift') {
        if (mutation === 'identity-drift') destructiveControls += 1;
        return { state: 'identity-drift', diagnostic: 'identity changed' };
      }
      if (scenario === 'event-gap') {
        if (mutation === 'event-gap') destructiveControls += 1;
        return { state: 'event-gap', diagnostic: 'event gap' };
      }
      return control;
    },
    async abort() {
      return mutation === 'broken-abort'
        ? { state: 'authority-uncertain', diagnostic: 'broken abort mutation' }
        : control;
    },
  };
  return {
    descriptor,
    input: { command: 'fixture-command', args: [], cwd: 'fixture', env: {} },
    provider,
    clock: { now: () => 1_000 },
    manifest: {
      schema: 'rasen-process-authority-providers/1',
      providers: [{
        ...descriptor,
        ...(mutation === 'tuple-manifest-mismatch' ? { protocolVersion: 2 } : {}),
        artifactPath: 'providers/test-conformance/helper',
      }],
    },
    manifestRoot: process.cwd(),
    publisher: async (binding) =>
      createProcessAuthorityPublicationAcknowledgement(binding),
    workloadStarts: () => starts,
    setObservation(value) { observation = value; },
    setControl(value) { control = value; },
    setScenario(value) { scenario = value; },
    externalFacts() {
      return {
        actualEmpty: false,
        destructiveControls,
        releasedWithoutExactReceipt,
      };
    },
    async flushEvents() {
      for (const event of events.splice(0)) event();
      await Promise.resolve();
    },
  };
}
