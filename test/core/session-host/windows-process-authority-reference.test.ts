import { describe, expect, it } from 'vitest';

import {
  createProviderAuthorityReference,
  providerAuthorityReferenceBytesForDispatch,
} from '../../../src/core/session-host/process-authority/reference-codec.js';
import type {
  ProviderAuthorityReference,
} from '../../../src/core/session-host/process-authority/types.js';
import {
  JOB_OBJECT_LIMIT_BREAKAWAY_OK,
  JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
  JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK,
  WINDOWS_BOOT_IDENTITY_SOURCES,
  WINDOWS_EXPECTED_JOB_LIMIT_MASK,
  createWindowsPrivateAuthorityReference,
  decodeWindowsPrivateAuthorityReference,
  toWindowsPrivateAuthorityReferenceDiagnostic,
  type WindowsPrivateAuthorityReferenceInput,
} from '../../../src/core/session-host/process-authority/windows/private-reference.js';
import {
  WINDOWS_FIXTURE_BOOT_IDENTITY,
  WINDOWS_FIXTURE_GUARDIAN_CREATION_TIME,
  WINDOWS_FIXTURE_GUARDIAN_PID,
  WINDOWS_FIXTURE_OWNER_SID,
} from '../../helpers/windows-process-authority-provider-fixture.js';

const BASE_INPUT: WindowsPrivateAuthorityReferenceInput = Object.freeze({
  scopeId: Buffer.alloc(16, 7).toString('base64url'),
  generation: Buffer.alloc(16, 11).toString('base64url'),
  scopeCapability: Buffer.alloc(32, 21).toString('base64url'),
  controlCapability: Buffer.alloc(32, 31).toString('base64url'),
  preparationOperationId: 'windows-prepare-1',
  launchDigest: 'a'.repeat(64),
  bootIdentity: WINDOWS_FIXTURE_BOOT_IDENTITY,
  bootIdentitySource: 'nt-system-boot-environment-information',
  guardianProcessId: WINDOWS_FIXTURE_GUARDIAN_PID,
  guardianCreationTime: WINDOWS_FIXTURE_GUARDIAN_CREATION_TIME,
  endpointOwnerSid: WINDOWS_FIXTURE_OWNER_SID,
  stateRootOwnerSid: WINDOWS_FIXTURE_OWNER_SID,
  jobLimitMask: WINDOWS_EXPECTED_JOB_LIMIT_MASK,
  activeProcessCountAtPortAssociation: 0,
  soleHandleAttestation: Buffer.alloc(32, 41).toString('base64url'),
  helperProtocolVersion: 1,
  artifactSha256: 'b'.repeat(64),
  sourceSha256: 'c'.repeat(64),
});

function encoded(
  overrides: Partial<Record<keyof WindowsPrivateAuthorityReferenceInput, unknown>> = {}
): ProviderAuthorityReference {
  return createWindowsPrivateAuthorityReference({
    ...BASE_INPUT,
    ...overrides,
  } as WindowsPrivateAuthorityReferenceInput);
}

function reencodeBody(
  reference: ProviderAuthorityReference,
  mutate: (body: Record<string, unknown>) => void
): ProviderAuthorityReference {
  const body = JSON.parse(
    Buffer.from(providerAuthorityReferenceBytesForDispatch(reference)).toString('utf8')
  ) as Record<string, unknown>;
  mutate(body);
  return createProviderAuthorityReference(1, Buffer.from(JSON.stringify(body), 'utf8'));
}

describe('Windows private authority reference codec', () => {
  it('binds every field the recovery rules depend on and round-trips them exactly', () => {
    const decoded = decodeWindowsPrivateAuthorityReference(encoded());
    expect(decoded).toEqual({
      schema: 'rasen-windows-process-authority-reference/1',
      providerId: 'rasen.windows.job-object',
      referenceVersion: 1,
      ...BASE_INPUT,
    });
    expect(Object.keys(decoded)).toEqual([
      'schema',
      'providerId',
      'referenceVersion',
      'scopeId',
      'generation',
      'scopeCapability',
      'controlCapability',
      'preparationOperationId',
      'launchDigest',
      'bootIdentity',
      'bootIdentitySource',
      'guardianProcessId',
      'guardianCreationTime',
      'endpointOwnerSid',
      'stateRootOwnerSid',
      'jobLimitMask',
      'activeProcessCountAtPortAssociation',
      'soleHandleAttestation',
      'helperProtocolVersion',
      'artifactSha256',
      'sourceSha256',
    ]);
  });

  it('refuses any Job limit mask other than the exact expected mask', () => {
    expect(WINDOWS_EXPECTED_JOB_LIMIT_MASK).toBe(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE);
    // The contract requires kill-on-job-close set and both breakaway
    // permissions clear. A Job whose read-back mask permits breakaway must
    // never reach a durable reference, so each of these is refused at the codec
    // boundary rather than accepted and reported.
    for (const mask of [
      WINDOWS_EXPECTED_JOB_LIMIT_MASK | JOB_OBJECT_LIMIT_BREAKAWAY_OK,
      WINDOWS_EXPECTED_JOB_LIMIT_MASK | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK,
      JOB_OBJECT_LIMIT_BREAKAWAY_OK,
      0,
    ]) {
      expect(() => encoded({ jobLimitMask: mask })).toThrow(/private reference is malformed/u);
    }
  });

  it('refuses an authority whose completion port was associated after a member existed', () => {
    expect(() => encoded({ activeProcessCountAtPortAssociation: 1 }))
      .toThrow(/private reference is malformed/u);
  });

  it('refuses a boot identity that is absent, malformed, or all-zero', () => {
    for (const bootIdentity of [
      '00000000-0000-0000-0000-000000000000',
      'not-a-guid',
      '9F2C41AB-77DE-4C1A-B0E5-6D4A12C9F3E8',
      '',
    ]) {
      expect(() => encoded({ bootIdentity })).toThrow(/private reference is malformed/u);
    }
  });

  it('refuses a boot-identity source outside the enumerated candidate list', () => {
    for (const bootIdentitySource of [
      'get-tick-count-64',
      'unbiased-interrupt-time',
      'system-time-subtraction',
      'assumed',
    ]) {
      expect(() => encoded({ bootIdentitySource })).toThrow(/private reference is malformed/u);
    }
  });

  it('enumerates only kernel-read identity values, never the endpoint namespace', () => {
    // The named-pipe namespace's non-persistence across a reboot is a second,
    // independent proof. Admitting it here as an identity *source* would
    // collapse two proofs that fail differently into one, leaving the
    // "identity source denied on this edition" failure silently uncovered.
    expect([...WINDOWS_BOOT_IDENTITY_SOURCES]).toEqual([
      'nt-system-boot-environment-information',
      'nt-system-time-of-day-boot-time',
    ]);
    for (const collapsed of [
      'boot-scoped-object-namespace',
      'named-pipe-namespace',
      'object-namespace',
    ]) {
      expect(() => encoded({ bootIdentitySource: collapsed }))
        .toThrow(/private reference is malformed/u);
    }
  });

  it('refuses a guardian birth identity that cannot disambiguate identifier reuse', () => {
    expect(() => encoded({ guardianCreationTime: '0' })).toThrow(/malformed/u);
    expect(() => encoded({ guardianCreationTime: '18446744073709551616' })).toThrow(/malformed/u);
    expect(() => encoded({ guardianProcessId: 0 })).toThrow(/malformed/u);
    expect(() => encoded({ guardianProcessId: -1 })).toThrow(/malformed/u);
  });

  it('refuses a malformed owner identity for the endpoint or the trusted state root', () => {
    for (const sid of [
      'S-1',
      'Everyone',
      'S-1-5',
      'S-1-5-',
      's-1-5-32-544',
      `S-1-5${'-1'.repeat(20)}`,
    ]) {
      expect(() => encoded({ endpointOwnerSid: sid })).toThrow(/malformed/u);
      expect(() => encoded({ stateRootOwnerSid: sid })).toThrow(/malformed/u);
    }
  });

  it('refuses capability substitution and a shared scope/control capability', () => {
    const shared = Buffer.alloc(32, 55).toString('base64url');
    expect(() => encoded({ scopeCapability: shared, controlCapability: shared }))
      .toThrow(/malformed/u);
    expect(() => encoded({ controlCapability: Buffer.alloc(16, 3).toString('base64url') }))
      .toThrow(/malformed/u);
    expect(() => encoded({ scopeId: Buffer.alloc(32, 3).toString('base64url') }))
      .toThrow(/malformed/u);
  });

  it('rejects an unknown field, a missing field, and a discriminator swap', () => {
    expect(() => decodeWindowsPrivateAuthorityReference(
      reencodeBody(encoded(), (body) => { body.extraField = 'x'; })
    )).toThrow(/malformed/u);
    expect(() => decodeWindowsPrivateAuthorityReference(
      reencodeBody(encoded(), (body) => { delete body.bootIdentity; })
    )).toThrow(/malformed/u);
    expect(() => decodeWindowsPrivateAuthorityReference(
      reencodeBody(encoded(), (body) => { body.providerId = 'rasen.linux.user-pidns'; })
    )).toThrow(/malformed/u);
    expect(() => decodeWindowsPrivateAuthorityReference(
      reencodeBody(encoded(), (body) => {
        body.schema = 'rasen-linux-process-authority-reference/1';
      })
    )).toThrow(/malformed/u);
  });

  it('rejects tampering that keeps the integrity digest stale', () => {
    expect(() => decodeWindowsPrivateAuthorityReference(
      reencodeBody(encoded(), (body) => { body.guardianProcessId = 9999; })
    )).toThrow(/malformed/u);
    expect(() => decodeWindowsPrivateAuthorityReference(
      reencodeBody(encoded(), (body) => { body.integrityDigest = '0'.repeat(64); })
    )).toThrow(/malformed/u);
  });

  it('rejects a non-canonical encoding of otherwise valid content', () => {
    const reference = encoded();
    const body = JSON.parse(
      Buffer.from(providerAuthorityReferenceBytesForDispatch(reference)).toString('utf8')
    ) as Record<string, unknown>;
    const reordered = Object.fromEntries(Object.entries(body).reverse());
    expect(() => decodeWindowsPrivateAuthorityReference(
      createProviderAuthorityReference(1, Buffer.from(JSON.stringify(reordered), 'utf8'))
    )).toThrow(/malformed/u);
  });

  it('rejects a future provider-reference version before decoding anything', () => {
    const bytes = providerAuthorityReferenceBytesForDispatch(encoded());
    expect(() => decodeWindowsPrivateAuthorityReference(
      createProviderAuthorityReference(2, bytes)
    )).toThrow(/malformed/u);
  });

  it('rejects truncation and oversize', () => {
    const bytes = Buffer.from(providerAuthorityReferenceBytesForDispatch(encoded()));
    expect(() => decodeWindowsPrivateAuthorityReference(
      createProviderAuthorityReference(1, bytes.subarray(0, bytes.byteLength - 5))
    )).toThrow(/malformed/u);
    expect(() => encoded({ preparationOperationId: 'x'.repeat(129) })).toThrow(/malformed/u);
  });

  it('keeps the scope id, both capabilities and the guardian identity out of diagnostics', () => {
    const reference = encoded();
    const diagnostic = toWindowsPrivateAuthorityReferenceDiagnostic(reference);
    expect(diagnostic).toEqual({
      classification: 'redacted-windows-process-authority-reference',
      providerId: 'rasen.windows.job-object',
      protocolVersion: 1,
      providerReferenceVersion: 1,
      referenceDigest: diagnostic.referenceDigest,
    });
    expect(diagnostic.referenceDigest).toMatch(/^[a-f0-9]{64}$/u);
    const serialized = JSON.stringify(diagnostic);
    for (const secret of [
      BASE_INPUT.scopeId,
      BASE_INPUT.scopeCapability,
      BASE_INPUT.controlCapability,
      BASE_INPUT.soleHandleAttestation,
      String(BASE_INPUT.guardianProcessId),
      BASE_INPUT.guardianCreationTime,
      BASE_INPUT.endpointOwnerSid,
      String(reference),
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('produces a distinct reference for every distinct attested scope id', () => {
    const first = encoded();
    const second = encoded({ scopeId: Buffer.alloc(16, 8).toString('base64url') });
    expect(String(first)).not.toBe(String(second));
  });
});
