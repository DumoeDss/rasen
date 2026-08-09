import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  PROCESS_AUTHORITY_PROVIDER_MANIFEST_SCHEMA,
  RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  ProcessAuthorityProviderRegistry,
  validateProcessAuthorityProviderManifest,
  type ProcessAuthorityProvider,
  type ProcessAuthorityProviderDescriptor,
  type ProcessAuthorityProviderManifest,
} from '../../../src/core/session-host/process-authority/index.js';
import {
  createProviderAuthorityReference,
  encodeProcessAuthorityReference,
} from '../../../src/core/session-host/process-authority/reference-codec.js';
import { resolveProcessAuthorityReferenceForDispatch } from '../../../src/core/session-host/process-authority/reference-resolution.js';

const descriptor: ProcessAuthorityProviderDescriptor = {
  providerId: 'test.manifest',
  capabilityId: RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  protocolVersion: 3,
  commonContractVersion: PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  providerReferenceVersion: 2,
  semantics: RECURSIVE_PROCESS_SCOPE_SEMANTICS,
};

function provider(calls: string[] = []): ProcessAuthorityProvider {
  return {
    descriptor,
    async prepare() {
      calls.push('prepare');
      throw new Error('not used');
    },
    async inspect() {
      calls.push('inspect');
      return { state: 'live' };
    },
    async terminate() {
      calls.push('terminate');
      return { state: 'exact-scope-empty' };
    },
    async abort() {
      calls.push('abort');
      return { state: 'exact-scope-empty' };
    },
  };
}

function manifest(
  changed: Partial<ProcessAuthorityProviderManifest['providers'][number]> = {}
): ProcessAuthorityProviderManifest {
  return {
    schema: PROCESS_AUTHORITY_PROVIDER_MANIFEST_SCHEMA,
    providers: [{
      ...descriptor,
      artifactPath: path.join('providers', 'test-manifest', 'helper'),
      ...changed,
    }],
  };
}

describe('closed process-authority provider manifest negotiation', () => {
  it('binds an exact immutable manifest entry to the runtime descriptor', () => {
    const root = path.resolve('fixture-package');
    const source = manifest();
    const validated = validateProcessAuthorityProviderManifest(source, root);
    const registry = new ProcessAuthorityProviderRegistry([provider()], {
      manifest: source,
      manifestRoot: root,
    });

    expect(validated.providers[0]).toMatchObject({
      ...descriptor,
      resolvedArtifactPath: path.resolve(root, 'providers', 'test-manifest', 'helper'),
    });
    (source.providers[0] as { providerId: string }).providerId = 'test.mutated';
    expect(registry.descriptors()).toEqual([descriptor]);
  });

  it.each([
    ['provider', { providerId: 'test.other' }],
    ['capability', { capabilityId: 'test.weaker/1' }],
    ['protocol', { protocolVersion: 4 }],
    ['provider-reference', { providerReferenceVersion: 3 }],
    ['common-contract', { commonContractVersion: 2 }],
  ] as const)('rejects a %s version/identity mismatch before dispatch', (_name, changed) => {
    const calls: string[] = [];
    expect(() => new ProcessAuthorityProviderRegistry([provider(calls)], {
      manifest: manifest(changed as never),
      manifestRoot: path.resolve('fixture-package'),
    })).toThrow(/manifest|descriptor|contract|capability/i);
    expect(calls).toEqual([]);
  });

  it.each([
    ['unknown manifest field', (value: ProcessAuthorityProviderManifest) => ({ ...value, native: true })],
    ['unknown entry field', (value: ProcessAuthorityProviderManifest) => ({
      ...value,
      providers: [{ ...value.providers[0], pid: 42 }],
    })],
    ['missing entry field', (value: ProcessAuthorityProviderManifest) => {
      const entry = { ...value.providers[0] } as Record<string, unknown>;
      delete entry.protocolVersion;
      return { ...value, providers: [entry] };
    }],
    ['missing semantic', (value: ProcessAuthorityProviderManifest) => ({
      ...value,
      providers: [{ ...value.providers[0], semantics: RECURSIVE_PROCESS_SCOPE_SEMANTICS.slice(1) }],
    })],
    ['escaping artifact path', (value: ProcessAuthorityProviderManifest) => ({
      ...value,
      providers: [{ ...value.providers[0], artifactPath: path.join('..', 'outside') }],
    })],
    ['overlong artifact path', (value: ProcessAuthorityProviderManifest) => ({
      ...value,
      providers: [{ ...value.providers[0], artifactPath: `providers/${'x'.repeat(600)}` }],
    })],
  ])('rejects %s in the closed schema', (_name, mutate) => {
    expect(() => validateProcessAuthorityProviderManifest(
      mutate(manifest()) as ProcessAuthorityProviderManifest,
      path.resolve('fixture-package')
    )).toThrow();
  });

  it('rejects duplicate entries and accepts host-normalized separator-shaped fixtures', () => {
    const root = path.resolve('fixture-package');
    const duplicate = manifest();
    duplicate.providers = [duplicate.providers[0], { ...duplicate.providers[0] }];
    expect(() => validateProcessAuthorityProviderManifest(duplicate, root)).toThrow(/duplicate/i);

    for (const artifactPath of [
      'providers/windows/helper.exe',
      'providers\\linux\\helper',
      path.join('providers', 'macos', 'helper'),
    ]) {
      const result = validateProcessAuthorityProviderManifest(manifest({ artifactPath }), root);
      expect(result.providers[0].resolvedArtifactPath.startsWith(root)).toBe(true);
    }
  });

  it('preserves newer and legacy authority bytes without downgrade or provider control', () => {
    const calls: string[] = [];
    const registry = new ProcessAuthorityProviderRegistry([provider(calls)], {
      manifest: manifest(),
      manifestRoot: path.resolve('fixture-package'),
    });
    const newerDescriptor = { ...descriptor, protocolVersion: 4 };
    const newer = encodeProcessAuthorityReference(
      newerDescriptor,
      createProviderAuthorityReference(2, Buffer.from('newer-reference'))
    );
    const legacy = 'rasen-process-scope/1:bGVnYWN5LXBpZC1wZ2lkLWZhY3Q';

    expect(resolveProcessAuthorityReferenceForDispatch(registry, newer)).toMatchObject({
      state: 'authority-unavailable',
      reference: newer,
    });
    expect(resolveProcessAuthorityReferenceForDispatch(registry, legacy)).toMatchObject({
      state: 'authority-unavailable',
      reference: legacy,
    });
    expect(calls).toEqual([]);
  });
});
