import { createHash } from 'node:crypto';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  PROCESS_AUTHORITY_PROVIDER_MANIFEST_SCHEMA,
  RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  validateProcessAuthorityProviderManifest,
} from '../../../src/core/session-host/process-authority/index.js';
import {
  createProviderAuthorityReference,
  providerAuthorityReferenceBytesForDispatch,
} from '../../../src/core/session-host/process-authority/reference-codec.js';
import {
  LINUX_BROKER_PROCESS_AUTHORITY_DESCRIPTOR,
  LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
  LINUX_PROCESS_AUTHORITY_PROTOCOL_VERSION,
  LINUX_PROCESS_AUTHORITY_REFERENCE_VERSION,
  createLinuxProcessAuthorityProviderManifest,
} from '../../../src/core/session-host/process-authority/linux/contracts.js';
import {
  createLinuxBrokerPrivateAuthorityReference,
  createLinuxPrimaryPrivateAuthorityReference,
  decodeLinuxPrivateAuthorityReference,
  toLinuxPrivateAuthorityReferenceDiagnostic,
} from '../../../src/core/session-host/process-authority/linux/private-reference.js';
import {
  mapLinuxNativeControlOutcome,
  mapLinuxNativeObservation,
} from '../../../src/core/session-host/process-authority/linux/outcomes.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const SCOPE_ID = 'A'.repeat(22);
const SCOPE_CAPABILITY = `${'B'.repeat(42)}A`;
const CONTROL_CAPABILITY = `${'C'.repeat(42)}A`;
const LEASE_CAPABILITY = `${'D'.repeat(42)}A`;

const primaryInput = Object.freeze({
  generation: SCOPE_ID,
  scopeCapability: SCOPE_CAPABILITY,
  controlCapability: CONTROL_CAPABILITY,
  preparationOperationId: 'prepare-linux-1',
  launchDigest: DIGEST_A,
  bootId: '11111111-2222-4333-8444-555555555555',
  guardianPid: 4242,
  guardianStartTicks: '9007199254740993',
  pidNamespaceDevice: '4',
  pidNamespaceInode: '4026533001',
  helperProtocolVersion: 1,
  artifactSha256: 'e'.repeat(64),
  sourceSha256: DIGEST_B,
});

function privateBody(reference: string): Record<string, unknown> {
  const bytes = providerAuthorityReferenceBytesForDispatch(reference as never);
  return JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown>;
}

describe('Linux process-authority exact contract', () => {
  it('declares two unique exact descriptors and exact manifest entries', () => {
    expect(LINUX_PROCESS_AUTHORITY_PROTOCOL_VERSION).toBe(1);
    expect(LINUX_PROCESS_AUTHORITY_REFERENCE_VERSION).toBe(1);
    expect(LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR).toEqual({
      providerId: 'rasen.linux.user-pidns',
      capabilityId: RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
      protocolVersion: 1,
      commonContractVersion: PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
      providerReferenceVersion: 1,
      semantics: RECURSIVE_PROCESS_SCOPE_SEMANTICS,
    });
    expect(LINUX_BROKER_PROCESS_AUTHORITY_DESCRIPTOR).toEqual({
      ...LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
      providerId: 'rasen.linux.broker-pidns-cgroupv2',
    });

    const manifest = createLinuxProcessAuthorityProviderManifest({
      primaryArtifactPath: 'native/linux-x64/rasen-linux-process-authority-helper',
      brokerArtifactPath: 'installed/broker/rasen-linux-process-authority-broker',
    });
    expect(manifest).toEqual({
      schema: PROCESS_AUTHORITY_PROVIDER_MANIFEST_SCHEMA,
      providers: [
        {
          ...LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
          artifactPath: 'native/linux-x64/rasen-linux-process-authority-helper',
        },
        {
          ...LINUX_BROKER_PROCESS_AUTHORITY_DESCRIPTOR,
          artifactPath: 'installed/broker/rasen-linux-process-authority-broker',
        },
      ],
    });
    expect(() => validateProcessAuthorityProviderManifest(
      manifest,
      path.resolve('linux-provider-fixture')
    )).not.toThrow();
  });

  it('round-trips one closed bounded primary reference without exposing secrets', () => {
    const reference = createLinuxPrimaryPrivateAuthorityReference(primaryInput);
    expect(decodeLinuxPrivateAuthorityReference(reference)).toEqual({
      schema: 'rasen-linux-process-authority-reference/1',
      mode: 'user-pidns',
      providerId: 'rasen.linux.user-pidns',
      referenceVersion: 1,
      ...primaryInput,
    });

    const diagnostic = toLinuxPrivateAuthorityReferenceDiagnostic(reference);
    expect(diagnostic).toEqual({
      classification: 'redacted-linux-process-authority-reference',
      providerId: 'rasen.linux.user-pidns',
      mode: 'user-pidns',
      protocolVersion: 1,
      providerReferenceVersion: 1,
      referenceDigest: createHash('sha256').update(reference).digest('hex'),
    });
    const text = JSON.stringify(diagnostic);
    expect(text).not.toContain(SCOPE_CAPABILITY);
    expect(text).not.toContain(CONTROL_CAPABILITY);
    expect(text).not.toContain('4242');
    expect(text).not.toContain('4026533001');
  });

  it('round-trips the closed broker extension and rejects malformed or corrupt bytes', () => {
    const broker = createLinuxBrokerPrivateAuthorityReference({
      ...primaryInput,
      brokerInstallSha256: 'c'.repeat(64),
      brokerKeyId: 'd'.repeat(64),
      brokerLeaseToken: LEASE_CAPABILITY,
      cgroupDevice: '33',
      cgroupInode: '9081726354',
    });
    expect(decodeLinuxPrivateAuthorityReference(broker)).toMatchObject({
      mode: 'broker-pidns-cgroupv2',
      providerId: 'rasen.linux.broker-pidns-cgroupv2',
      brokerInstallSha256: 'c'.repeat(64),
      brokerKeyId: 'd'.repeat(64),
      brokerLeaseToken: LEASE_CAPABILITY,
      cgroupDevice: '33',
      cgroupInode: '9081726354',
    });

    const differentValidToken = createLinuxBrokerPrivateAuthorityReference({
      ...primaryInput,
      brokerInstallSha256: 'c'.repeat(64),
      brokerKeyId: 'd'.repeat(64),
      brokerLeaseToken: `${'E'.repeat(42)}A`,
      cgroupDevice: '33',
      cgroupInode: '9081726354',
    });
    expect(decodeLinuxPrivateAuthorityReference(differentValidToken)).toMatchObject({
      brokerLeaseToken: `${'E'.repeat(42)}A`,
    });

    const body = privateBody(broker);
    const changedToken = createProviderAuthorityReference(1, Buffer.from(JSON.stringify({
      ...body,
      brokerLeaseToken: `${'E'.repeat(42)}A`,
    })));
    const unknownField = createProviderAuthorityReference(1, Buffer.from(JSON.stringify({
      ...body,
      cgroupPath: '/caller/controlled',
    })));
    const future = createProviderAuthorityReference(2, Buffer.from(JSON.stringify(body)));
    for (const changed of [changedToken, unknownField, future]) {
      expect(() => decodeLinuxPrivateAuthorityReference(changed)).toThrow(/reference/i);
      expect(() => toLinuxPrivateAuthorityReferenceDiagnostic(changed)).toThrow(/reference/i);
    }
  });

  it('rejects non-canonical, overlong, unknown, and unsafe primary fields', () => {
    const reference = createLinuxPrimaryPrivateAuthorityReference(primaryInput);
    const body = privateBody(reference);
    const mutations = [
      { ...body, guardianPid: 0 },
      { ...body, guardianStartTicks: '-1' },
      { ...body, generation: 'short' },
      { ...body, scopeCapability: `${SCOPE_CAPABILITY}x` },
      { ...body, sourceSha256: 'future' },
      { ...body, socketPath: '/tmp/forged' },
    ];
    for (const mutation of mutations) {
      const changed = createProviderAuthorityReference(1, Buffer.from(JSON.stringify(mutation)));
      expect(() => decodeLinuxPrivateAuthorityReference(changed)).toThrow(/reference/i);
    }
  });

  it('rejects a reordered preimage even when its unkeyed integrity digest is recomputed', () => {
    const reference = createLinuxPrimaryPrivateAuthorityReference(primaryInput);
    const body = privateBody(reference);
    const reordered = Object.fromEntries(
      Object.entries(body)
        .filter(([key]) => key !== 'integrityAlgorithm' && key !== 'integrityDigest')
        .reverse()
    );
    const aliasBody = {
      ...reordered,
      integrityAlgorithm: 'sha256',
      integrityDigest: createHash('sha256').update(JSON.stringify(reordered)).digest('hex'),
    };
    const alias = createProviderAuthorityReference(1, Buffer.from(JSON.stringify(aliasBody)));

    expect(alias).not.toBe(reference);
    expect(() => decodeLinuxPrivateAuthorityReference(alias)).toThrow(/reference/i);
  });

  it('maps the complete closed native lifecycle into only the frozen common vocabulary', () => {
    expect(mapLinuxNativeObservation({ state: 'inert' }, 'prepared-inert', 'inspect')).toEqual({
      state: 'prepared-inert',
    });
    expect(mapLinuxNativeObservation({ state: 'inert' }, 'published-inert', 'inspect')).toEqual({
      state: 'published-inert',
    });
    expect(mapLinuxNativeObservation({ state: 'live' }, 'prepared-inert', 'inspect')).toEqual({
      state: 'live',
    });
    expect(mapLinuxNativeObservation(
      { state: 'root-exited', code: 17, signal: null },
      'prepared-inert',
      'inspect'
    )).toEqual({ state: 'root-exited', code: 17, signal: null });
    expect(mapLinuxNativeObservation(
      { state: 'root-exited', code: null, signal: 'SIGTERM' },
      'prepared-inert',
      'inspect'
    )).toEqual({ state: 'root-exited', code: null, signal: 'SIGTERM' });
    expect(mapLinuxNativeObservation(
      { state: 'exact-scope-empty' },
      'prepared-inert',
      'inspect'
    )).toEqual({ state: 'exact-scope-empty' });

    for (const [native, common] of [
      ['authority-unavailable', 'authority-unavailable'],
      ['authority-uncertain', 'authority-uncertain'],
      ['identity-drift', 'identity-drift'],
      ['event-gap', 'event-gap'],
    ] as const) {
      expect(mapLinuxNativeObservation(
        { state: native, diagnosticCode: 'native-state-retained' },
        'prepared-inert',
        'inspect'
      )).toEqual({ state: common, diagnostic: 'Linux process authority is retained (native-state-retained).' });
    }
    expect(mapLinuxNativeObservation(
      { state: 'timeout', diagnosticCode: 'native-operation-timeout' },
      'prepared-inert',
      'terminate'
    )).toEqual({
      state: 'timeout',
      phase: 'terminate',
      diagnostic: 'Linux process authority is retained (native-operation-timeout).',
    });
    expect(mapLinuxNativeControlOutcome(
      { state: 'control-loss', diagnosticCode: 'native-transport-lost' },
      'abort'
    )).toEqual({
      state: 'control-loss',
      phase: 'abort',
      diagnostic: 'Linux process authority is retained (native-transport-lost).',
    });
  });

  it('retains malformed root status and closed-schema mutations as control loss', () => {
    for (const mutation of [
      { state: 'root-exited', code: null, signal: null },
      { state: 'root-exited', code: 0, signal: 'SIGTERM' },
      { state: 'root-exited', code: 0, signal: null, pid: 42 },
      { state: 'live', pid: 42 },
      { state: 'unknown' },
    ]) {
      expect(mapLinuxNativeObservation(mutation, 'prepared-inert', 'inspect')).toEqual({
        state: 'control-loss',
        phase: 'inspect',
        diagnostic: 'Linux process-authority native outcome is malformed.',
      });
    }
  });

  it('rejects impossible Linux root exit codes and signal names as native corruption', () => {
    for (const value of [
      { state: 'root-exited', code: 256, signal: null },
      { state: 'root-exited', code: null, signal: 'SIGNOTREAL' },
    ]) {
      expect(mapLinuxNativeObservation(value, 'published-inert', 'inspect')).toMatchObject({
        state: 'control-loss',
        phase: 'inspect',
      });
    }
  });
});
