import { describe, expect, it } from 'vitest';

import {
  createWindowsPrivateAuthorityReference,
  decodeWindowsPrivateAuthorityReference,
  WINDOWS_EXPECTED_JOB_LIMIT_MASK,
  type WindowsPrivateAuthorityReference,
  type WindowsPrivateAuthorityReferenceInput,
} from '../../../src/core/session-host/process-authority/windows/private-reference.js';
import {
  classifyWindowsAuthorityRecovery,
  parseWindowsAuthorityIdentityProbe,
} from '../../../src/core/session-host/process-authority/windows/recovery.js';
import {
  WINDOWS_FIXTURE_BOOT_IDENTITY,
  WINDOWS_FIXTURE_GUARDIAN_CREATION_TIME,
  WINDOWS_FIXTURE_GUARDIAN_PID,
  WINDOWS_FIXTURE_OWNER_SID,
} from '../../helpers/windows-process-authority-provider-fixture.js';

const SOLE_HANDLE_ATTESTATION = Buffer.alloc(32, 41).toString('base64url');
const SCOPE_ID = Buffer.alloc(16, 7).toString('base64url');
const GENERATION = Buffer.alloc(16, 11).toString('base64url');

const INPUT: WindowsPrivateAuthorityReferenceInput = Object.freeze({
  scopeId: SCOPE_ID,
  generation: GENERATION,
  scopeCapability: Buffer.alloc(32, 21).toString('base64url'),
  controlCapability: Buffer.alloc(32, 31).toString('base64url'),
  preparationOperationId: 'windows-recovery-1',
  launchDigest: 'a'.repeat(64),
  bootIdentity: WINDOWS_FIXTURE_BOOT_IDENTITY,
  bootIdentitySource: 'nt-system-boot-environment-information',
  guardianProcessId: WINDOWS_FIXTURE_GUARDIAN_PID,
  guardianCreationTime: WINDOWS_FIXTURE_GUARDIAN_CREATION_TIME,
  endpointOwnerSid: WINDOWS_FIXTURE_OWNER_SID,
  stateRootOwnerSid: WINDOWS_FIXTURE_OWNER_SID,
  jobLimitMask: WINDOWS_EXPECTED_JOB_LIMIT_MASK,
  activeProcessCountAtPortAssociation: 0,
  soleHandleAttestation: SOLE_HANDLE_ATTESTATION,
  helperProtocolVersion: 1,
  artifactSha256: 'b'.repeat(64),
  sourceSha256: 'c'.repeat(64),
});

const REFERENCE: WindowsPrivateAuthorityReference = decodeWindowsPrivateAuthorityReference(
  createWindowsPrivateAuthorityReference(INPUT)
);

function present(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    state: 'authority-present',
    bootIdentity: WINDOWS_FIXTURE_BOOT_IDENTITY,
    guardianProcessId: WINDOWS_FIXTURE_GUARDIAN_PID,
    guardianCreationTime: WINDOWS_FIXTURE_GUARDIAN_CREATION_TIME,
    endpointServerProcessId: WINDOWS_FIXTURE_GUARDIAN_PID,
    endpointOwnerSid: WINDOWS_FIXTURE_OWNER_SID,
    endpointAuthentication: 'authenticated',
    soleHandleAttestation: SOLE_HANDLE_ATTESTATION,
    ...overrides,
  };
}

function absent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    state: 'authority-absent',
    bootIdentity: WINDOWS_FIXTURE_BOOT_IDENTITY,
    endpointPresent: false,
    soleHandleAttestation: SOLE_HANDLE_ATTESTATION,
    terminalRecord: null,
    ...overrides,
  };
}

function terminalRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    outcome: 'exact-scope-empty',
    scopeId: SCOPE_ID,
    generation: GENERATION,
    bootIdentity: WINDOWS_FIXTURE_BOOT_IDENTITY,
    soleHandleAttestation: SOLE_HANDLE_ATTESTATION,
    ...overrides,
  };
}

describe('Windows replacement recovery classification', () => {
  it('proceeds only when the complete tuple is stable across both reads', () => {
    expect(classifyWindowsAuthorityRecovery(REFERENCE, present(), present()))
      .toEqual({ disposition: 'proceed' });
  });

  it('returns identity-drift when any bound value differs before any handle opens', () => {
    const drifts: readonly [string, Record<string, unknown>, string][] = [
      ['reused guardian identifier', present({ guardianCreationTime: '133645512399999999' }),
        'guardian-birth-identity-differs'],
      ['different guardian identifier', present({ guardianProcessId: 4242 }), 'identity-drift'],
      ['endpoint served by another process',
        present({ endpointServerProcessId: 4242 }), 'endpoint-server-differs'],
      ['wrong endpoint owner',
        present({ endpointOwnerSid: 'S-1-5-18' }), 'endpoint-owner-differs'],
      ['sole-handle attestation differs',
        present({ soleHandleAttestation: Buffer.alloc(32, 99).toString('base64url') }),
        'sole-handle-attestation-absent'],
    ];
    for (const [name, probe, diagnosticCode] of drifts) {
      expect(classifyWindowsAuthorityRecovery(REFERENCE, probe, probe), name).toEqual({
        disposition: 'retained',
        state: 'identity-drift',
        diagnosticCode,
      });
    }
  });

  it('checks boot identity before any identifier, so a prior boot never matches', () => {
    const priorBoot = present({
      bootIdentity: '11111111-2222-3333-4444-555555555555',
      // Same pid and same creation time as the reference: only the boot differs.
    });
    expect(classifyWindowsAuthorityRecovery(REFERENCE, priorBoot, priorBoot)).toEqual({
      disposition: 'retained',
      state: 'identity-drift',
      diagnosticCode: 'identity-drift',
    });
  });

  it('returns control-loss when the endpoint rejects authentication', () => {
    const rejected = present({ endpointAuthentication: 'rejected' });
    expect(classifyWindowsAuthorityRecovery(REFERENCE, rejected, rejected)).toEqual({
      disposition: 'retained',
      state: 'control-loss',
      diagnosticCode: 'control-unavailable',
    });
  });

  it('refuses to proceed when the tuple changes between the two reads', () => {
    for (const postOpen of [
      present({ guardianCreationTime: '133645512399999999' }),
      present({ endpointServerProcessId: 4242 }),
      absent(),
      { state: 'control-loss', diagnosticCode: 'native-transport-lost' },
    ]) {
      const outcome = classifyWindowsAuthorityRecovery(REFERENCE, present(), postOpen);
      expect(outcome.disposition).toBe('retained');
      expect(outcome).not.toMatchObject({ disposition: 'proceed' });
    }
  });

  it('reports exact empty from a durable terminal record that binds this authority', () => {
    expect(classifyWindowsAuthorityRecovery(
      REFERENCE,
      absent({ terminalRecord: terminalRecord() }),
      undefined
    )).toEqual({ disposition: 'exact-scope-empty', basis: 'durable-terminal-record' });
  });

  it('refuses a terminal record bound to a different scope or generation', () => {
    for (const override of [
      { scopeId: Buffer.alloc(16, 9).toString('base64url') },
      { generation: Buffer.alloc(16, 9).toString('base64url') },
      { soleHandleAttestation: Buffer.alloc(32, 9).toString('base64url') },
    ]) {
      expect(classifyWindowsAuthorityRecovery(
        REFERENCE,
        absent({ terminalRecord: terminalRecord(override) }),
        undefined
      )).toEqual({
        disposition: 'retained',
        state: 'event-gap',
        diagnosticCode: 'ledger-conflict',
      });
    }
  });

  it('applies the last-handle rule only when the sole-handle attestation is corroborated', () => {
    expect(classifyWindowsAuthorityRecovery(REFERENCE, absent(), undefined))
      .toEqual({ disposition: 'exact-scope-empty', basis: 'last-handle-rule' });
    // Without corroboration the inference has nothing behind it. Reporting exact
    // empty here would fabricate a receipt for a workload that may still be live.
    expect(classifyWindowsAuthorityRecovery(
      REFERENCE,
      absent({ soleHandleAttestation: null }),
      undefined
    )).toEqual({
      disposition: 'retained',
      state: 'authority-uncertain',
      diagnosticCode: 'guardian-absent-without-record',
    });
    expect(classifyWindowsAuthorityRecovery(
      REFERENCE,
      absent({ soleHandleAttestation: Buffer.alloc(32, 3).toString('base64url') }),
      undefined
    )).toMatchObject({ disposition: 'retained', state: 'authority-uncertain' });
  });

  it('treats a surviving endpoint without its guardian as drift, never as empty', () => {
    expect(classifyWindowsAuthorityRecovery(
      REFERENCE,
      absent({ endpointPresent: true, terminalRecord: terminalRecord() }),
      undefined
    )).toEqual({
      disposition: 'retained',
      state: 'identity-drift',
      diagnosticCode: 'endpoint-server-differs',
    });
  });

  it('passes a retained native probe through without inventing a disposition', () => {
    for (const state of ['authority-unavailable', 'authority-uncertain', 'control-loss'] as const) {
      expect(classifyWindowsAuthorityRecovery(
        REFERENCE,
        { state, diagnosticCode: 'native-unavailable' },
        undefined
      )).toEqual({ disposition: 'retained', state, diagnosticCode: 'native-unavailable' });
    }
  });

  it('classifies a malformed or unknown probe as control-loss', () => {
    for (const probe of [
      undefined,
      null,
      'authority-present',
      { state: 'authority-present' },
      { state: 'authority-present', ...present(), extra: 1 },
      { state: 'live' },
      { state: 'authority-absent', bootIdentity: WINDOWS_FIXTURE_BOOT_IDENTITY },
      present({ endpointAuthentication: 'maybe' }),
    ]) {
      expect(classifyWindowsAuthorityRecovery(REFERENCE, probe, present())).toEqual({
        disposition: 'retained',
        state: 'control-loss',
        diagnosticCode: 'native-transport-lost',
      });
    }
  });

  it('parses only the closed probe vocabulary', () => {
    expect(parseWindowsAuthorityIdentityProbe(present())).toMatchObject({
      state: 'authority-present',
    });
    expect(parseWindowsAuthorityIdentityProbe(absent())).toMatchObject({
      state: 'authority-absent',
    });
    expect(parseWindowsAuthorityIdentityProbe({ state: 'exact-scope-empty' })).toBeUndefined();
    expect(parseWindowsAuthorityIdentityProbe(
      absent({ terminalRecord: terminalRecord({ outcome: 'live' }) })
    )).toBeUndefined();
  });
});
