import { describe, expect, it } from 'vitest';

import {
  PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  ProcessAuthorityProviderRegistry,
  type AuthorityOperationContext,
  type AuthorityPrepareInput,
  type AuthorityTerminationIntent,
  type ProcessAuthorityProvider,
  type ProcessAuthorityProviderDescriptor,
  type ProcessAuthoritySelection,
  type ProviderAuthorityReference,
} from '../../../src/core/session-host/process-authority/index.js';
import { createTestProcessAuthorityProviderRegistry } from '../../helpers/process-authority-test-registry.js';

const selection: ProcessAuthoritySelection = {
  providerId: 'test.deterministic',
  capabilityId: RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  protocolVersion: 7,
};

function descriptor(
  overrides: Partial<ProcessAuthorityProviderDescriptor> = {}
): ProcessAuthorityProviderDescriptor {
  return {
    ...selection,
    commonContractVersion: PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
    providerReferenceVersion: 3,
    semantics: RECURSIVE_PROCESS_SCOPE_SEMANTICS,
    ...overrides,
  };
}

class ClassProvider implements ProcessAuthorityProvider {
  readonly calls: string[] = [];

  constructor(readonly descriptor: ProcessAuthorityProviderDescriptor) {}

  async prepare(_input: AuthorityPrepareInput, _context: AuthorityOperationContext): Promise<never> {
    this.calls.push('prepare');
    throw new Error('not used by registry tests');
  }

  async inspect(_reference: ProviderAuthorityReference, _context: AuthorityOperationContext) {
    this.calls.push('inspect');
    return { state: 'live' as const };
  }

  async terminate(
    _reference: ProviderAuthorityReference,
    _intent: AuthorityTerminationIntent,
    _context: AuthorityOperationContext
  ) {
    this.calls.push('terminate');
    return { state: 'exact-scope-empty' as const };
  }

  async abort(
    _reference: ProviderAuthorityReference,
    _reason: string,
    _context: AuthorityOperationContext
  ) {
    this.calls.push('abort');
    return { state: 'exact-scope-empty' as const };
  }
}

const context: AuthorityOperationContext = {
  phase: 'inspect',
  operationId: 'inspect-1',
  deadline: 100,
  signal: new AbortController().signal,
};

describe('closed process-authority provider registry', () => {
  it('rejects every non-empty registry that is not bound to a validated manifest', () => {
    const provider = new ClassProvider(descriptor());

    expect(() => new ProcessAuthorityProviderRegistry([provider])).toThrow(/manifest/i);
    expect(provider.calls).toEqual([]);
  });

  it('dispatches only an exact tuple and preserves class-based provider behavior', async () => {
    const provider = new ClassProvider(descriptor());
    const registry = createTestProcessAuthorityProviderRegistry([provider]);
    const selected = registry.select({ ...selection });

    expect(selected).toMatchObject({ state: 'selected', descriptor: descriptor() });
    if (selected.state !== 'selected') throw new Error('expected exact provider selection');
    await expect(
      selected.provider.inspect('opaque-provider-reference' as ProviderAuthorityReference, context)
    ).resolves.toEqual({ state: 'live' });
    expect(provider.calls).toEqual(['inspect']);
  });

  it('rejects duplicate identities, duplicate tuples, and conflicting descriptors', () => {
    expect(
      () => createTestProcessAuthorityProviderRegistry([
        new ClassProvider(descriptor()),
        new ClassProvider(descriptor()),
      ])
    ).toThrow(/Duplicate process-authority provider id/);

    expect(
      () => createTestProcessAuthorityProviderRegistry([
        new ClassProvider(descriptor()),
        new ClassProvider(descriptor({ protocolVersion: 8 })),
      ])
    ).toThrow(/Duplicate process-authority provider id/);
  });

  it('rejects malformed, open, or weakened descriptors at construction', () => {
    expect(
      () => createTestProcessAuthorityProviderRegistry([
        new ClassProvider(descriptor({ providerId: 'Test Provider' })),
      ])
    ).toThrow(/provider id is malformed/);

    expect(
      () => createTestProcessAuthorityProviderRegistry([
        new ClassProvider({ ...descriptor(), nativeHandle: 1 } as ProcessAuthorityProviderDescriptor),
      ])
    ).toThrow(/unknown or missing field/);

    expect(
      () => createTestProcessAuthorityProviderRegistry([
        new ClassProvider(descriptor({
          semantics: RECURSIVE_PROCESS_SCOPE_SEMANTICS.slice(0, -1),
        })),
      ])
    ).toThrow(/semantics are incomplete or ambiguous/);
  });

  it('copies descriptors and provider lists before closing the registry', () => {
    const mutableDescriptor = descriptor() as {
      -readonly [Key in keyof ProcessAuthorityProviderDescriptor]: ProcessAuthorityProviderDescriptor[Key]
    };
    const provider = new ClassProvider(mutableDescriptor);
    const providers: ProcessAuthorityProvider[] = [provider];
    const registry = createTestProcessAuthorityProviderRegistry(providers);

    mutableDescriptor.providerId = 'test.mutated';
    providers.length = 0;

    expect(registry.select(selection)).toMatchObject({
      state: 'selected',
      descriptor: descriptor(),
    });
    expect(Object.isFrozen(registry.descriptors()[0])).toBe(true);
    expect(Object.isFrozen(registry.descriptors()[0].semantics)).toBe(true);
  });

  it('returns unavailable without platform, ordering, or weaker-capability fallback', () => {
    const provider = new ClassProvider(descriptor());
    const registry = createTestProcessAuthorityProviderRegistry([provider]);
    const absent: ProcessAuthoritySelection = {
      providerId: 'test.absent',
      capabilityId: RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
      protocolVersion: 7,
    };

    expect(registry.select(absent)).toEqual({
      state: 'authority-unavailable',
      selection: absent,
      diagnostic: 'No exact process-authority provider is registered.',
    });
    expect(provider.calls).toEqual([]);
  });

  it('fails a hostile runtime selection closed without provider dispatch', () => {
    const provider = new ClassProvider(descriptor());
    const registry = createTestProcessAuthorityProviderRegistry([provider]);
    const hostile = {} as ProcessAuthoritySelection;
    Object.defineProperty(hostile, 'providerId', {
      enumerable: true,
      get() {
        throw new Error('hostile selection getter');
      },
    });

    expect(registry.select(hostile)).toMatchObject({
      state: 'authority-unavailable',
      diagnostic: expect.stringMatching(/selection|malformed/i),
    });
    expect(provider.calls).toEqual([]);
  });
});
