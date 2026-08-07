import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  PROCESS_AUTHORITY_PROVIDER_MANIFEST_SCHEMA,
  RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  ProcessAuthorityProviderRegistry,
  validateProcessAuthorityProviderManifest,
  type AuthorityOperationContext,
  type AuthorityPrepareInput,
  type AuthorityTerminationIntent,
  type ProcessAuthorityProvider,
  type ProcessAuthorityProviderDescriptor,
  type ProcessAuthorityProviderManifest,
  type ProviderAuthorityReference,
  type RecursiveProcessScopeSemantic,
} from '../../../src/core/session-host/process-authority/index.js';

/**
 * The narrowed contract, written out rather than derived, so this test fails if
 * the constant drifts in either direction.
 */
const EXPECTED_SEMANTICS = Object.freeze([
  'forked-descendant-non-escape',
  'root-exit-distinct',
  'natural-exact-empty',
  'recursive-terminate',
  'recursive-abort',
  'bounded-controls',
  'identity-drift-detection',
  'event-completeness',
]);

/** The ten-element array as it shipped before the narrowing. */
const RETIRED_SEMANTICS = Object.freeze([
  'workload-non-escape',
  'publish-before-activate',
  'root-exit-distinct',
  'natural-exact-empty',
  'recursive-terminate',
  'recursive-abort',
  'replacement-recovery',
  'bounded-controls',
  'identity-drift-detection',
  'event-completeness',
]);

const RETIRED_TOKENS = Object.freeze([
  'workload-non-escape',
  'replacement-recovery',
  'publish-before-activate',
]);

function semantics(values: readonly string[]): readonly RecursiveProcessScopeSemantic[] {
  return values as unknown as readonly RecursiveProcessScopeSemantic[];
}

const MANIFEST_ROOT = path.resolve('test-process-authority-package');

class RecordingProvider implements ProcessAuthorityProvider {
  readonly calls: string[] = [];

  constructor(readonly descriptor: ProcessAuthorityProviderDescriptor) {}

  async prepare(_input: AuthorityPrepareInput, _context: AuthorityOperationContext): Promise<never> {
    this.calls.push('prepare');
    throw new Error('a rejected contract must never reach preparation');
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

function descriptorWith(
  advertised: readonly RecursiveProcessScopeSemantic[]
): ProcessAuthorityProviderDescriptor {
  return {
    providerId: 'test.retired-contract',
    capabilityId: RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
    protocolVersion: 1,
    commonContractVersion: PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
    providerReferenceVersion: 1,
    semantics: advertised,
  };
}

function manifestWith(
  advertised: readonly RecursiveProcessScopeSemantic[]
): ProcessAuthorityProviderManifest {
  return {
    schema: PROCESS_AUTHORITY_PROVIDER_MANIFEST_SCHEMA,
    providers: [{
      ...descriptorWith(advertised),
      artifactPath: path.join('providers', 'test-retired', 'helper'),
    }],
  };
}

describe('narrowed recursive process-scope semantics contract', () => {
  it('enumerates exactly eight semantics in the exact expected order', () => {
    expect([...RECURSIVE_PROCESS_SCOPE_SEMANTICS]).toEqual([...EXPECTED_SEMANTICS]);
    expect(RECURSIVE_PROCESS_SCOPE_SEMANTICS).toHaveLength(8);
    expect(RECURSIVE_PROCESS_SCOPE_SEMANTICS[0]).toBe('forked-descendant-non-escape');
  });

  it('carries none of the retired semantic tokens', () => {
    for (const token of RETIRED_TOKENS) {
      expect(RECURSIVE_PROCESS_SCOPE_SEMANTICS as readonly string[]).not.toContain(token);
    }
  });

  it('holds the capability id and common contract version at 1', () => {
    expect(RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID).toBe('rasen-recursive-process-scope/1');
    expect(PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION).toBe(1);
  });

  it.each([
    ['the retired ten-element array', RETIRED_SEMANTICS],
    ['a single retired token in place', [
      'workload-non-escape',
      ...EXPECTED_SEMANTICS.slice(1),
    ]],
    ['the retired ordering of the surviving eight', [
      EXPECTED_SEMANTICS[1],
      EXPECTED_SEMANTICS[0],
      ...EXPECTED_SEMANTICS.slice(2),
    ]],
  ])(
    'rejects a runtime descriptor advertising %s before any dispatch',
    (_name, advertised) => {
      const provider = new RecordingProvider(descriptorWith(semantics(advertised)));

      expect(() => new ProcessAuthorityProviderRegistry([provider], {
        manifest: manifestWith(semantics(advertised)),
        manifestRoot: MANIFEST_ROOT,
      })).toThrow(/semantics are incomplete or ambiguous|capability is incomplete/);
      expect(provider.calls).toEqual([]);
    }
  );

  it('fails a packaged manifest carrying the retired array closed under the same capability id', () => {
    const stale = manifestWith(semantics(RETIRED_SEMANTICS));

    expect(stale.providers[0].capabilityId).toBe(RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID);
    expect(() => validateProcessAuthorityProviderManifest(stale, MANIFEST_ROOT))
      .toThrow(/capability is incomplete/);
  });

  it('prepares no provider when a stale manifest is presented to the registry', () => {
    const provider = new RecordingProvider(descriptorWith(RECURSIVE_PROCESS_SCOPE_SEMANTICS));

    expect(() => new ProcessAuthorityProviderRegistry([provider], {
      manifest: manifestWith(semantics(RETIRED_SEMANTICS)),
      manifestRoot: MANIFEST_ROOT,
    })).toThrow();
    expect(provider.calls).toEqual([]);
  });
});
