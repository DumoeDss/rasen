import { describe, expect, expectTypeOf, it } from 'vitest';

import * as publicAuthority from '../../../src/core/session-host/process-authority/index.js';
import {
  PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  createEmptyProcessAuthorityProviderRegistry,
  createProcessAuthorityCoordinator,
  ProcessAuthorityProviderRegistry,
  type ProcessAuthorityProvider,
  type ProcessAuthorityProviderDescriptor,
  type ProcessAuthoritySelection,
  type ProviderAuthorityReference,
} from '../../../src/core/session-host/process-authority/index.js';
import { createProviderAuthorityReference } from '../../../src/core/session-host/process-authority/reference-codec.js';
import {
  createTestProcessAuthorityProviderManifest,
  createTestProcessAuthorityProviderRegistry,
} from '../../helpers/process-authority-test-registry.js';

const selection: ProcessAuthoritySelection = {
  providerId: 'test.deterministic',
  capabilityId: RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  protocolVersion: 1,
};

const descriptor: ProcessAuthorityProviderDescriptor = {
  ...selection,
  commonContractVersion: PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  providerReferenceVersion: 1,
  semantics: RECURSIVE_PROCESS_SCOPE_SEMANTICS,
};

describe('process authority public surface', () => {
  it('keeps native authority fields out of Session-facing contract values', () => {
    expect(selection).toEqual({
      providerId: 'test.deterministic',
      capabilityId: RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
      protocolVersion: 1,
    });
    expect(descriptor).not.toHaveProperty('pid');
    expect(descriptor).not.toHaveProperty('pgid');
    expect(descriptor).not.toHaveProperty('job');
    expect(descriptor).not.toHaveProperty('broker');
    expect(descriptor).not.toHaveProperty('namespace');
    expect(descriptor).not.toHaveProperty('handle');

    // The provider reference is opaque even to TypeScript callers.
    const opaque = 'test-only-opaque-value' as ProviderAuthorityReference;
    expectTypeOf(opaque).toEqualTypeOf<ProviderAuthorityReference>();
    // @ts-expect-error provider-owned bytes are not readable from the public reference
    void opaque.providerReferenceBytes;
    // @ts-expect-error native process identity is not part of the selection seam
    void selection.pid;
  });

  it('rejects the raw-provider coordinator bypass before implicit platform selection', () => {
    const provider: ProcessAuthorityProvider = {
      descriptor,
      async prepare() {
        throw new Error('fixture preparation is exercised by lifecycle tests');
      },
      async inspect() {
        return { state: 'authority-uncertain', diagnostic: 'fixture not active' };
      },
      async terminate() {
        return { state: 'authority-uncertain', diagnostic: 'fixture not active' };
      },
      async abort() {
        return { state: 'authority-uncertain', diagnostic: 'fixture not active' };
      },
    };

    expect(() => createProcessAuthorityCoordinator({
      // @ts-expect-error non-empty providers must enter through a manifest-bound registry
      providers: [provider],
    })).toThrow(/registry|provider/i);
  });

  it('rejects subclass, proxy, and lookalike registry selection seams with zero dispatch', async () => {
    let providerDispatches = 0;
    let forgedSelectionDispatches = 0;
    const provider: ProcessAuthorityProvider = {
      descriptor,
      async prepare() {
        providerDispatches += 1;
        return {
          reference: createProviderAuthorityReference(1, Buffer.from('forged-registry')),
          activate: async () => ({ state: 'live' }),
        };
      },
      async inspect() {
        providerDispatches += 1;
        return { state: 'live' };
      },
      async terminate() {
        providerDispatches += 1;
        return { state: 'exact-scope-empty' };
      },
      async abort() {
        providerDispatches += 1;
        return { state: 'exact-scope-empty' };
      },
    };
    class ForgedRegistry extends ProcessAuthorityProviderRegistry {
      override select() {
        forgedSelectionDispatches += 1;
        return { state: 'selected' as const, descriptor, provider };
      }
    }
    const manifest = createTestProcessAuthorityProviderManifest([provider]);
    const subclass = new ForgedRegistry([provider], {
      manifest,
      manifestRoot: process.cwd(),
    });
    const authentic = createTestProcessAuthorityProviderRegistry([provider]);
    const proxy = new Proxy(authentic, {
      get(target, key, receiver) {
        if (key === 'select') {
          return () => {
            forgedSelectionDispatches += 1;
            return { state: 'selected' as const, descriptor, provider };
          };
        }
        return Reflect.get(target, key, receiver);
      },
    });
    const lookalike = {
      select() {
        forgedSelectionDispatches += 1;
        return { state: 'selected' as const, descriptor, provider };
      },
    } as unknown as ProcessAuthorityProviderRegistry;
    const input = { command: 'fixture', args: [], cwd: '.', env: {} };

    for (const registry of [subclass, proxy, lookalike]) {
      const coordinator = createProcessAuthorityCoordinator({ registry });
      await expect(coordinator.prepare(selection, input)).resolves.toMatchObject({
        state: 'authority-unavailable',
      });
    }
    expect(forgedSelectionDispatches).toBe(0);
    expect(providerDispatches).toBe(0);
  });

  it('starts with no production provider and cannot claim ProcessCapsule conformance', () => {
    const registry = createEmptyProcessAuthorityProviderRegistry();
    expect(registry.descriptors()).toEqual([]);
    expect(registry.select(selection)).toEqual({
      state: 'authority-unavailable',
      selection,
      diagnostic: 'No exact process-authority provider is registered.',
    });
    expect(registry.descriptors()).not.toContainEqual(
      expect.objectContaining({ providerId: 'rasen.process-capsule' })
    );
    const runtimeExports = Object.keys(publicAuthority).join('\n');
    expect(runtimeExports).not.toMatch(
      /create(?:Linux|Windows|Mac|Macos|Darwin)|EndpointSecurity|Broker|Installer|Entitlement|Signing|VirtualMachine/i
    );
  });
});
