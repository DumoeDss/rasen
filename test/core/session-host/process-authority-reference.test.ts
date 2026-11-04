import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import * as publicAuthority from '../../../src/core/session-host/process-authority/index.js';
import {
  PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  ProcessAuthorityProviderRegistry,
  toProcessAuthorityReferenceView,
  type ProcessAuthorityProvider,
  type ProcessAuthorityProviderDescriptor,
} from '../../../src/core/session-host/process-authority/index.js';
import {
  createProviderAuthorityReference,
  decodeProcessAuthorityReferenceForDispatch,
  encodeProcessAuthorityReference,
  providerAuthorityReferenceBytesForDispatch,
  reencodeProcessAuthorityReference,
} from '../../../src/core/session-host/process-authority/reference-codec.js';
import { resolveProcessAuthorityReferenceForDispatch } from '../../../src/core/session-host/process-authority/reference-resolution.js';
import { createTestProcessAuthorityProviderRegistry } from '../../helpers/process-authority-test-registry.js';

const descriptor: ProcessAuthorityProviderDescriptor = {
  providerId: 'test.deterministic',
  capabilityId: RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  protocolVersion: 7,
  commonContractVersion: PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  providerReferenceVersion: 3,
  semantics: RECURSIVE_PROCESS_SCOPE_SEMANTICS,
};

function encodeBody(body: object, prefixVersion = 1): string {
  return `rasen-process-authority/${prefixVersion}:${Buffer.from(JSON.stringify(body)).toString('base64url')}`;
}

function decodeBody(reference: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(reference.slice(reference.indexOf(':') + 1), 'base64url').toString('utf8')
  ) as Record<string, unknown>;
}

function withValidDigest(body: Record<string, unknown>): Record<string, unknown> {
  const withoutDigest = { ...body };
  delete withoutDigest.integrityDigest;
  return {
    ...withoutDigest,
    integrityDigest: createHash('sha256').update(JSON.stringify(withoutDigest)).digest('hex'),
  };
}

function dispatchRegistry(calls: string[]): ProcessAuthorityProviderRegistry {
  const provider: ProcessAuthorityProvider = {
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
  return createTestProcessAuthorityProviderRegistry([provider]);
}

describe('opaque process-authority reference codec', () => {
  it('canonically encodes, decodes, and re-encodes an exact provider tuple', () => {
    const providerBytes = Uint8Array.from([0, 1, 2, 253, 254, 255]);
    const providerReference = createProviderAuthorityReference(3, providerBytes);
    const reference = encodeProcessAuthorityReference(descriptor, providerReference);
    const decoded = decodeProcessAuthorityReferenceForDispatch(reference, descriptor);

    expect(reference).toMatch(/^rasen-process-authority\/1:[A-Za-z0-9_-]+$/);
    expect(decoded).toMatchObject({
      state: 'dispatchable',
      reference,
      selection: {
        providerId: 'test.deterministic',
        capabilityId: RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
        protocolVersion: 7,
      },
      providerReferenceVersion: 3,
      integrityIdentity: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    if (decoded.state !== 'dispatchable') throw new Error('expected dispatchable reference');
    expect(providerAuthorityReferenceBytesForDispatch(decoded.providerReference)).toEqual(
      providerBytes
    );
    expect(reencodeProcessAuthorityReference(decoded)).toBe(reference);
  });

  it.each([
    ['truncated', (reference: string) => reference.slice(0, -1)],
    ['base64-invalid', (reference: string) => `${reference.slice(0, reference.indexOf(':') + 1)}%%%`],
    ['changed-payload', (reference: string) => {
      const body = decodeBody(reference);
      body.providerReferenceBytes = 'AQIDBA';
      return encodeBody(body);
    }],
    ['changed-digest', (reference: string) => {
      const body = decodeBody(reference);
      body.integrityDigest = '0'.repeat(64);
      return encodeBody(body);
    }],
    ['unknown-field', (reference: string) => encodeBody({ ...decodeBody(reference), pid: 42 })],
    ['overlong-field', (reference: string) => {
      const body = decodeBody(reference);
      body.providerId = `test.${'a'.repeat(256)}`;
      return encodeBody(withValidDigest(body));
    }],
    ['malformed-identity', (reference: string) => {
      const body = decodeBody(reference);
      body.providerId = '../native-helper';
      return encodeBody(withValidDigest(body));
    }],
    ['tuple-mismatch', (reference: string) => {
      const body = decodeBody(reference);
      body.protocolVersion = 8;
      return encodeBody(withValidDigest(body));
    }],
  ])('retains %s input and refuses provider dispatch', (_name, mutate) => {
    const providerReference = createProviderAuthorityReference(3, Uint8Array.from([5, 4, 3, 2, 1]));
    const canonical = encodeProcessAuthorityReference(descriptor, providerReference);
    const changed = mutate(canonical);
    const calls: string[] = [];

    expect(resolveProcessAuthorityReferenceForDispatch(dispatchRegistry(calls), changed)).toMatchObject({
      state: 'authority-unavailable',
      reference: changed,
    });
    expect(calls).toEqual([]);
  });

  it('rejects duplicate fields and non-canonical field order', () => {
    const providerReference = createProviderAuthorityReference(3, Uint8Array.from([9, 8, 7]));
    const canonical = encodeProcessAuthorityReference(descriptor, providerReference);
    const bodyText = Buffer.from(
      canonical.slice(canonical.indexOf(':') + 1),
      'base64url'
    ).toString('utf8');
    const duplicate = bodyText.replace(
      '"providerId":"test.deterministic"',
      '"providerId":"test.deterministic","providerId":"test.deterministic"'
    );
    const reordered = JSON.stringify(
      Object.fromEntries(Object.entries(decodeBody(canonical)).reverse())
    );

    for (const changedBody of [duplicate, reordered]) {
      const changed = `rasen-process-authority/1:${Buffer.from(changedBody).toString('base64url')}`;
      expect(decodeProcessAuthorityReferenceForDispatch(changed, descriptor)).toMatchObject({
        state: 'authority-unavailable',
        reference: changed,
      });
    }
  });

  it('preserves unknown envelope and provider-reference versions byte-for-byte', () => {
    const futureEnvelope = encodeBody({ schemaVersion: 2, opaque: 'future' }, 2);
    expect(decodeProcessAuthorityReferenceForDispatch(futureEnvelope, descriptor)).toEqual({
      state: 'authority-unavailable',
      reason: 'unknown-envelope-version',
      reference: futureEnvelope,
      diagnostic: 'Process-authority envelope version is not supported by this runtime.',
    });

    const newerDescriptor = { ...descriptor, providerReferenceVersion: 4 };
    const newerReference = encodeProcessAuthorityReference(
      newerDescriptor,
      createProviderAuthorityReference(4, Uint8Array.from([1, 3, 3, 7]))
    );
    expect(decodeProcessAuthorityReferenceForDispatch(newerReference, descriptor)).toMatchObject({
      state: 'authority-unavailable',
      reason: 'provider-reference-version-mismatch',
      reference: newerReference,
    });
  });

  it('exposes only a redacted, non-replayable tuple and digest through the public index', () => {
    const reference = encodeProcessAuthorityReference(
      descriptor,
      createProviderAuthorityReference(3, Buffer.from('pid=42;job=native;broker=secret'))
    );
    const view = toProcessAuthorityReferenceView(reference);
    const publicKeys = Object.keys(publicAuthority);

    expect(view).toEqual({
      classification: 'redacted-process-authority-reference',
      schemaVersion: 1,
      providerId: descriptor.providerId,
      capabilityId: descriptor.capabilityId,
      protocolVersion: descriptor.protocolVersion,
      providerReferenceVersion: descriptor.providerReferenceVersion,
      referenceDigest: createHash('sha256').update(String(reference), 'utf8').digest('hex'),
    });
    expect(view).not.toHaveProperty('reference');
    expect(JSON.stringify(view)).not.toContain(String(reference));
    expect(JSON.stringify(view)).not.toContain('pid=42');
    expect(JSON.stringify(view)).not.toContain('job=native');
    expect(JSON.stringify(view)).not.toContain('broker=secret');
    expect(publicKeys).not.toContain('decodeProcessAuthorityReferenceForDispatch');
    expect(publicKeys).not.toContain('providerAuthorityReferenceBytesForDispatch');
    expect(publicKeys).not.toContain('createProviderAuthorityReference');
    expect(publicKeys).not.toContain('resolveProcessAuthorityReferenceForDispatch');
  });
});
