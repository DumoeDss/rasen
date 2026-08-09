import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import {
  WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR,
} from '../../src/core/session-host/process-authority/windows/contracts.js';
import {
  WINDOWS_EXPECTED_JOB_LIMIT_MASK,
} from '../../src/core/session-host/process-authority/windows/private-reference.js';
import {
  createWindowsAuthorityPublicationLedger,
} from '../../src/core/session-host/process-authority/windows/publication-ledger.js';
import {
  createWindowsProcessAuthorityProviderBundleWithTransport,
  type WindowsAuthorityNativePrepareRequest,
  type WindowsAuthorityNativeTransport,
  type WindowsProcessAuthorityProviderBundle,
} from '../../src/core/session-host/process-authority/windows/provider.js';
import type {
  ProviderControlOutcome,
  ProviderObservation,
} from '../../src/core/session-host/process-authority/index.js';
import { cleanupTempPath } from './temp-cleanup.js';
import type {
  ProcessAuthorityProviderConformanceFixture,
  ProcessAuthorityProviderMutation,
} from './process-authority-provider-conformance.js';

export const WINDOWS_FIXTURE_ARTIFACT_IDENTITY = Object.freeze({
  helperProtocolVersion: 1 as const,
  artifactSha256: 'e'.repeat(64),
  sourceSha256: 'f'.repeat(64),
});

export const WINDOWS_FIXTURE_OWNER_SID = 'S-1-5-21-1004336348-1177238915-682003330-1001';
export const WINDOWS_FIXTURE_BOOT_IDENTITY = '9f2c41ab-77de-4c1a-b0e5-6d4a12c9f3e8';
export const WINDOWS_FIXTURE_GUARDIAN_PID = 7412;
export const WINDOWS_FIXTURE_GUARDIAN_CREATION_TIME = '133645512345678901';

const fixtureRoots: string[] = [];

type Scenario = Parameters<ProcessAuthorityProviderConformanceFixture['setScenario']>[0];

export interface WindowsAttestationOverrides {
  readonly [key: string]: unknown;
}

/** Builds the exact attestation shape the native helper is contracted to emit. */
export function windowsPrepareAttestation(
  request: Pick<WindowsAuthorityNativePrepareRequest, 'preparationOperationId' | 'launchDigest'>,
  seed: number,
  overrides: WindowsAttestationOverrides = {}
): Record<string, unknown> {
  return {
    scopeId: Buffer.alloc(16, seed).toString('base64url'),
    generation: Buffer.alloc(16, seed + 64).toString('base64url'),
    scopeCapability: Buffer.alloc(32, seed + 16).toString('base64url'),
    controlCapability: Buffer.alloc(32, seed + 32).toString('base64url'),
    preparationOperationId: request.preparationOperationId,
    launchDigest: request.launchDigest,
    bootIdentity: WINDOWS_FIXTURE_BOOT_IDENTITY,
    bootIdentitySource: 'nt-system-boot-environment-information',
    guardianProcessId: WINDOWS_FIXTURE_GUARDIAN_PID,
    guardianCreationTime: WINDOWS_FIXTURE_GUARDIAN_CREATION_TIME,
    endpointOwnerSid: WINDOWS_FIXTURE_OWNER_SID,
    stateRootOwnerSid: WINDOWS_FIXTURE_OWNER_SID,
    jobLimitMask: WINDOWS_EXPECTED_JOB_LIMIT_MASK,
    activeProcessCountAtPortAssociation: 0,
    soleHandleAttestation: Buffer.alloc(32, seed + 96).toString('base64url'),
    helperProtocolVersion: WINDOWS_FIXTURE_ARTIFACT_IDENTITY.helperProtocolVersion,
    artifactSha256: WINDOWS_FIXTURE_ARTIFACT_IDENTITY.artifactSha256,
    sourceSha256: WINDOWS_FIXTURE_ARTIFACT_IDENTITY.sourceSha256,
    ...overrides,
  };
}

export function windowsPresentIdentityProbe(
  attestation: Record<string, unknown>,
  overrides: WindowsAttestationOverrides = {}
): Record<string, unknown> {
  return {
    state: 'authority-present',
    bootIdentity: attestation.bootIdentity,
    guardianProcessId: attestation.guardianProcessId,
    guardianCreationTime: attestation.guardianCreationTime,
    endpointServerProcessId: attestation.guardianProcessId,
    endpointOwnerSid: attestation.endpointOwnerSid,
    endpointAuthentication: 'authenticated',
    soleHandleAttestation: attestation.soleHandleAttestation,
    ...overrides,
  };
}

function retainedDiagnosticCode(
  state: ProviderObservation['state'] | ProviderControlOutcome['state']
): string {
  switch (state) {
    case 'authority-unavailable': return 'native-unavailable';
    case 'authority-uncertain': return 'native-uncertain';
    case 'identity-drift': return 'identity-drift';
    case 'event-gap': return 'event-gap';
    case 'timeout': return 'native-operation-timeout';
    case 'control-loss': return 'native-transport-lost';
    default: throw new TypeError(`No retained Windows diagnostic exists for ${state}.`);
  }
}

function toNativeOutcome(value: ProviderObservation | ProviderControlOutcome): unknown {
  switch (value.state) {
    case 'prepared-inert':
    case 'published-inert':
      return { state: 'inert' };
    case 'live':
    case 'exact-scope-empty':
      return { state: value.state };
    case 'root-exited':
      return { state: value.state, code: value.code, signal: value.signal };
    case 'authority-unavailable':
    case 'authority-uncertain':
    case 'identity-drift':
    case 'event-gap':
    case 'timeout':
    case 'control-loss':
      return { state: value.state, diagnosticCode: retainedDiagnosticCode(value.state) };
  }
}

export function cleanupWindowsProcessAuthorityProviderFixtures(): void {
  for (const root of fixtureRoots.splice(0)) cleanupTempPath(root);
}

export interface WindowsProviderHarness {
  readonly bundle: WindowsProcessAuthorityProviderBundle;
  readonly fixtureRoot: string;
  readonly calls: {
    prepare: number;
    probePreOpen: number;
    probePostOpen: number;
    activate: number;
    inspect: number;
    graceful: number;
    /** Counts forced authority-wide terminate requests reaching the transport. */
    force: number;
    abort: number;
  };
  readonly forcedIntents: readonly { reason: string; graceMs: number }[];
  setScenario(value: Scenario): void;
  setObservation(value: ProviderObservation): void;
  setControl(value: ProviderControlOutcome): void;
  /**
   * Makes the transport answer force with `reterminate-required`. The guardian
   * owns the re-terminate loop, so this is a closed-protocol violation rather
   * than a continuation the provider is allowed to follow.
   */
  setReterminateSignal(value: boolean): void;
  setProbeOverride(
    stage: 'pre-open' | 'post-open',
    value: Record<string, unknown> | undefined
  ): void;
  lastAttestation(): Record<string, unknown>;
  flushEvents(): Promise<void>;
  destructiveControls(): number;
}

export function createWindowsProviderHarness(): WindowsProviderHarness {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-windows-authority-'));
  fixtureRoots.push(fixtureRoot);

  let preparations = 0;
  let scenario: Scenario = 'normal';
  let observation: ProviderObservation = { state: 'live' };
  let control: ProviderControlOutcome = { state: 'exact-scope-empty' };
  let reterminateSignal = false;
  // One attestation per preparation. A single shared mutable attestation would
  // make every probe answer for the most recent authority, which silently turns
  // unrelated scenarios into identity drift and lets guards pass for the wrong
  // reason.
  const attestations = new Map<string, Record<string, unknown>>();
  let latest: Record<string, unknown> = {};
  let destructive = 0;
  const probeOverrides = new Map<string, Record<string, unknown> | undefined>();
  const events: Array<() => void> = [];
  const forcedIntents: { reason: string; graceMs: number }[] = [];
  const calls = {
    prepare: 0,
    probePreOpen: 0,
    probePostOpen: 0,
    activate: 0,
    inspect: 0,
    graceful: 0,
    force: 0,
    abort: 0,
  };

  const transport: WindowsAuthorityNativeTransport = {
    async prepare(request: WindowsAuthorityNativePrepareRequest) {
      calls.prepare += 1;
      if (scenario === 'prepare-unavailable') {
        return { state: 'authority-unavailable', diagnosticCode: 'prepare-unavailable' };
      }
      preparations += 1;
      const attestation = windowsPrepareAttestation(request, preparations);
      attestations.set(request.preparationOperationId, attestation);
      latest = attestation;
      return { state: 'inert', attestation };
    },
    async probeIdentity(reference, stage) {
      if (stage === 'pre-open') calls.probePreOpen += 1;
      else calls.probePostOpen += 1;
      if (probeOverrides.has(stage)) return probeOverrides.get(stage);
      const attestation = attestations.get(reference.preparationOperationId) ?? latest;
      switch (scenario) {
        case 'identity-drift':
          return windowsPresentIdentityProbe(attestation, {
            // A recycled identifier carries a different creation FILETIME.
            guardianCreationTime: '133645512345679999',
          });
        case 'timeout':
          return new Promise(() => undefined);
        default:
          return windowsPresentIdentityProbe(attestation);
      }
    },
    async activate() {
      calls.activate += 1;
      return { state: 'live' };
    },
    async inspect() {
      calls.inspect += 1;
      switch (scenario) {
        case 'optimistic-close': return { state: 'live' };
        case 'unavailable':
          return { state: 'authority-unavailable', diagnosticCode: 'native-unavailable' };
        case 'uncertain':
          return { state: 'authority-uncertain', diagnosticCode: 'native-uncertain' };
        case 'event-gap': return { state: 'event-gap', diagnosticCode: 'event-gap' };
        case 'late-control':
          return new Promise((resolve) => {
            events.push(() => resolve({ state: 'exact-scope-empty' }));
          });
        case 'control-loss':
        case 'adapter-authority-loss':
          throw new Error('Windows fixture native transport lost');
        default: return toNativeOutcome(observation);
      }
    },
    async attemptGraceful() {
      calls.graceful += 1;
      // Deliberately claims the authority looked empty. Nothing may treat this
      // as a receipt; it exists so the "graceful alone cannot close" oracle has
      // something to discriminate against.
      return { state: 'empty-observed' };
    },
    async terminate(_reference, intent) {
      calls.force += 1;
      forcedIntents.push({ reason: intent.reason, graceMs: intent.graceMs });
      if (reterminateSignal) {
        // One-shot, then converge. A provider that (wrongly) loops on this
        // therefore succeeds on its second request rather than hanging, so the
        // mutation shows up as a force count of 2 instead of a test timeout.
        reterminateSignal = false;
        return { state: 'reterminate-required' };
      }
      // A destructive control that reaches the transport while the bound
      // identity does not match the live one is the exact failure this counter
      // exists to detect: the request would land on a replacement process.
      if (scenario === 'identity-drift') destructive += 1;
      if (scenario === 'event-gap') {
        return { state: 'event-gap', diagnosticCode: 'event-gap' };
      }
      return toNativeOutcome(control);
    },
    async abort() {
      calls.abort += 1;
      if (scenario === 'identity-drift') destructive += 1;
      return toNativeOutcome(control);
    },
  };

  const ledger = createWindowsAuthorityPublicationLedger({
    root: path.join(fixtureRoot, 'publication-ledger'),
  });
  const bundle = createWindowsProcessAuthorityProviderBundleWithTransport({
    transport,
    ledger,
    artifactIdentity: WINDOWS_FIXTURE_ARTIFACT_IDENTITY,
    runtimeOpener: {
      open() {
        return {
          stdin: new PassThrough(),
          stdout: new PassThrough(),
          stderr: new PassThrough(),
          rootExited: new Promise(() => undefined),
          exactScopeEmpty: new Promise(() => undefined),
        };
      },
    },
  });

  return {
    bundle,
    fixtureRoot,
    calls,
    forcedIntents,
    setScenario(value) { scenario = value; },
    setObservation(value) { observation = value; },
    setControl(value) { control = value; },
    setReterminateSignal(value) { reterminateSignal = value; },
    setProbeOverride(stage, value) {
      if (value === undefined) probeOverrides.delete(stage);
      else probeOverrides.set(stage, value);
    },
    lastAttestation: () => latest,
    async flushEvents() {
      for (const event of events.splice(0)) event();
      await Promise.resolve();
    },
    destructiveControls: () => destructive,
  };
}

export function createWindowsProcessAuthorityProviderFixture(
  _mutation?: ProcessAuthorityProviderMutation
): ProcessAuthorityProviderConformanceFixture {
  const harness = createWindowsProviderHarness();

  return {
    descriptor: WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR,
    input: {
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/c', 'exit', '0'],
      cwd: 'C:\\Windows\\Temp',
      env: { SystemRoot: 'C:\\Windows' },
    },
    provider: harness.bundle.provider,
    clock: { now: () => 1_000 },
    manifest: {
      schema: 'rasen-process-authority-providers/1',
      providers: [{
        ...WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR,
        artifactPath: 'providers/windows-job-object/rasen-windows-process-authority-helper.exe',
      }],
    },
    manifestRoot: harness.fixtureRoot,
    publisher: harness.bundle.publishAuthority,
    workloadStarts: () => harness.calls.activate,
    setObservation(value) { harness.setObservation(value); },
    setControl(value) { harness.setControl(value); },
    setScenario(value) { harness.setScenario(value); },
    externalFacts() {
      return {
        actualEmpty: false,
        destructiveControls: harness.destructiveControls(),
        releasedWithoutExactReceipt: false,
      };
    },
    flushEvents: () => harness.flushEvents(),
  };
}
