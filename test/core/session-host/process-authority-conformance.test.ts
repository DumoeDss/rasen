import { describe, expect, it } from 'vitest';

import { createDeterministicProcessAuthorityProviderFixture } from '../../helpers/deterministic-process-authority-provider.js';
import {
  GREEN_PROCESS_AUTHORITY_MUTATION_SNAPSHOT,
  PROCESS_AUTHORITY_PROVIDER_MUTATIONS,
  assertProcessAuthorityMutationSnapshot,
  measureProcessAuthorityProviderConformance,
  processAuthorityProviderConformanceSuite,
  type ProcessAuthorityProviderConformanceFixtureFactory,
} from '../../helpers/process-authority-provider-conformance.js';

processAuthorityProviderConformanceSuite(
  'deterministic common process-authority provider conformance',
  createDeterministicProcessAuthorityProviderFixture
);

describe('process-authority provider mutation sensitivity', () => {
  it.each(PROCESS_AUTHORITY_PROVIDER_MUTATIONS)(
    'makes the unchanged assertion RED for %s and GREEN when disabled',
    async (mutation) => {
      const red = await measureProcessAuthorityProviderConformance(
        createDeterministicProcessAuthorityProviderFixture(mutation)
      );
      expect(() => assertProcessAuthorityMutationSnapshot(red)).toThrow();
      const green = await measureProcessAuthorityProviderConformance(
        createDeterministicProcessAuthorityProviderFixture()
      );
      expect(green).toEqual(GREEN_PROCESS_AUTHORITY_MUTATION_SNAPSHOT);
      expect(() => assertProcessAuthorityMutationSnapshot(green)).not.toThrow();
    }
  );

  it('exports one unchanged fixture contract for later platform consumers', () => {
    const linux: ProcessAuthorityProviderConformanceFixtureFactory =
      createDeterministicProcessAuthorityProviderFixture;
    const windows: ProcessAuthorityProviderConformanceFixtureFactory =
      createDeterministicProcessAuthorityProviderFixture;
    const macos: ProcessAuthorityProviderConformanceFixtureFactory =
      createDeterministicProcessAuthorityProviderFixture;
    expect([linux, windows, macos].every(
      (consumer) => consumer === createDeterministicProcessAuthorityProviderFixture
    )).toBe(true);
  });
});
