import { describe, expect, it } from 'vitest';

import {
  PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  PROCESS_AUTHORITY_REFERENCE_TOMBSTONE_LIMIT,
  createProcessAuthorityCoordinator,
  type AuthorityOperationContext,
  type AuthorityPrepareInput,
  type ProcessAuthorityProvider,
  type ProcessAuthorityProviderDescriptor,
} from '../../../src/core/session-host/process-authority/index.js';
import { createProviderAuthorityReference } from '../../../src/core/session-host/process-authority/reference-codec.js';
import { createTestProcessAuthorityProviderRegistry } from '../../helpers/process-authority-test-registry.js';

const descriptor: ProcessAuthorityProviderDescriptor = {
  providerId: 'test.prepare-unavailable',
  capabilityId: RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  protocolVersion: 1,
  commonContractVersion: PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  providerReferenceVersion: 1,
  semantics: RECURSIVE_PROCESS_SCOPE_SEMANTICS,
};

const fallbackDescriptor: ProcessAuthorityProviderDescriptor = {
  ...descriptor,
  providerId: 'test.prepare-fallback-forbidden',
};

const input: AuthorityPrepareInput = {
  command: '/fixture/command',
  args: [],
  cwd: '/fixture',
  env: {},
};

function inertProvider(
  providerDescriptor: ProcessAuthorityProviderDescriptor,
  prepare: () => Promise<unknown>
): ProcessAuthorityProvider {
  return {
    descriptor: providerDescriptor,
    prepare,
    async inspect() { return { state: 'prepared-inert' }; },
    async terminate() { return { state: 'exact-scope-empty' }; },
    async abort() { return { state: 'exact-scope-empty' }; },
  } as unknown as ProcessAuthorityProvider;
}

describe('process-authority selected-provider prepare unavailability', () => {
  it('preserves the typed diagnostic without minting authority or probing a fallback', async () => {
    let selectedCalls = 0;
    let fallbackCalls = 0;
    const selected = inertProvider(descriptor, async () => {
      selectedCalls += 1;
      return {
        state: 'authority-unavailable',
        diagnostic: 'Linux user and PID namespaces are unavailable.',
      };
    });
    const fallback = inertProvider(fallbackDescriptor, async () => {
      fallbackCalls += 1;
      return {
        reference: createProviderAuthorityReference(1, Buffer.from('fallback')),
        activate: async (_context: AuthorityOperationContext) => ({ state: 'live' as const }),
      };
    });
    const coordinator = createProcessAuthorityCoordinator({
      registry: createTestProcessAuthorityProviderRegistry([selected, fallback]),
    });

    const result = await coordinator.prepare(descriptor, input);

    expect(result).toEqual({
      state: 'authority-unavailable',
      selection: {
        providerId: descriptor.providerId,
        capabilityId: descriptor.capabilityId,
        protocolVersion: descriptor.protocolVersion,
      },
      diagnostic: 'Linux user and PID namespaces are unavailable.',
    });
    expect(selectedCalls).toBe(1);
    expect(fallbackCalls).toBe(0);
    expect('reference' in result).toBe(false);
    expect('publish' in result).toBe(false);
  });

  it('keeps provider rejection distinct as prepare control loss', async () => {
    const provider = inertProvider(descriptor, async () => {
      throw new Error('provider crashed');
    });
    const coordinator = createProcessAuthorityCoordinator({
      registry: createTestProcessAuthorityProviderRegistry([provider]),
    });

    await expect(coordinator.prepare(descriptor, input)).resolves.toMatchObject({
      state: 'control-loss',
      phase: 'prepare',
    });
  });

  it('releases every reserved reference slot after typed unavailability', async () => {
    let unavailable = true;
    const provider = inertProvider(descriptor, async () => unavailable
      ? {
          state: 'authority-unavailable',
          diagnostic: 'native prerequisite unavailable',
        }
      : {
          reference: createProviderAuthorityReference(1, Buffer.from('available-after-probes')),
          activate: async () => ({ state: 'live' as const }),
        });
    const coordinator = createProcessAuthorityCoordinator({
      registry: createTestProcessAuthorityProviderRegistry([provider]),
    });

    for (let attempt = 0; attempt <= PROCESS_AUTHORITY_REFERENCE_TOMBSTONE_LIMIT; attempt += 1) {
      await expect(coordinator.prepare(descriptor, input)).resolves.toMatchObject({
        state: 'authority-unavailable',
        diagnostic: 'native prerequisite unavailable',
      });
    }
    unavailable = false;
    await expect(coordinator.prepare(descriptor, input)).resolves.toMatchObject({
      state: 'prepared-inert',
    });
  });

  it.each([
    { state: 'authority-unavailable', diagnostic: 'x', reference: 'forbidden' },
    {
      state: 'authority-unavailable',
      diagnostic: 'hybrid smuggling attempt',
      reference: createProviderAuthorityReference(1, Buffer.from('smuggled-authority')),
      activate: async () => ({ state: 'live' as const }),
    },
    { state: 'authority-unavailable', diagnostic: 'x'.repeat(2_049) },
    { state: 'authority-unavailable' },
  ])('rejects malformed unavailable lookalikes without minting a reference', async (value) => {
    const provider = inertProvider(descriptor, async () => value);
    const coordinator = createProcessAuthorityCoordinator({
      registry: createTestProcessAuthorityProviderRegistry([provider]),
    });

    const result = await coordinator.prepare(descriptor, input);
    expect(result).toMatchObject({ state: 'authority-unavailable' });
    expect('reference' in result).toBe(false);
  });

  it('reads a hostile hybrid discriminator once and never falls through to activation', async () => {
    let stateReads = 0;
    let activationCalls = 0;
    const value = {
      get state() {
        stateReads += 1;
        return stateReads === 1 ? 'authority-unavailable' : 'prepared-inert';
      },
      diagnostic: 'hostile hybrid',
      reference: createProviderAuthorityReference(1, Buffer.from('hostile-hybrid')),
      activate: async () => {
        activationCalls += 1;
        return { state: 'live' as const };
      },
    };
    const provider = inertProvider(descriptor, async () => value);
    const coordinator = createProcessAuthorityCoordinator({
      registry: createTestProcessAuthorityProviderRegistry([provider]),
    });

    const result = await coordinator.prepare(descriptor, input);
    expect(result).toMatchObject({ state: 'authority-unavailable' });
    expect('reference' in result).toBe(false);
    expect(stateReads).toBe(1);
    expect(activationCalls).toBe(0);
  });

  it('rejects a non-enumerable unavailable discriminator on an otherwise valid prepared shape', async () => {
    const value = {
      diagnostic: 'hidden discriminator',
      reference: createProviderAuthorityReference(1, Buffer.from('hidden-discriminator')),
      activate: async () => ({ state: 'live' as const }),
    } as Record<string, unknown>;
    Object.defineProperty(value, 'state', {
      value: 'authority-unavailable',
      enumerable: false,
    });
    const provider = inertProvider(descriptor, async () => value);
    const coordinator = createProcessAuthorityCoordinator({
      registry: createTestProcessAuthorityProviderRegistry([provider]),
    });

    const result = await coordinator.prepare(descriptor, input);
    expect(result).toMatchObject({ state: 'authority-unavailable' });
    expect('reference' in result).toBe(false);
  });
});
