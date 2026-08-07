import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import {
  LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
} from '../../src/core/session-host/process-authority/linux/contracts.js';
import {
  createLinuxAuthorityPublicationLedger,
} from '../../src/core/session-host/process-authority/linux/publication-ledger.js';
import {
  createLinuxPrimaryProcessAuthorityProviderBundleForTesting,
  type LinuxAuthorityNativePrepareRequest,
  type LinuxAuthorityNativeTransport,
} from '../../src/core/session-host/process-authority/linux/provider.js';
import type {
  ProviderControlOutcome,
  ProviderObservation,
} from '../../src/core/session-host/process-authority/index.js';
import { cleanupTempPath } from './temp-cleanup.js';
import type {
  ProcessAuthorityProviderConformanceFixture,
  ProcessAuthorityProviderMutation,
} from './process-authority-provider-conformance.js';

const ARTIFACT_IDENTITY = Object.freeze({
  helperProtocolVersion: 1 as const,
  artifactSha256: 'e'.repeat(64),
  sourceSha256: 'f'.repeat(64),
});

const fixtureRoots: string[] = [];

type Scenario = Parameters<ProcessAuthorityProviderConformanceFixture['setScenario']>[0];

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
    default: throw new TypeError(`No retained Linux diagnostic exists for ${state}.`);
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

export function cleanupLinuxProcessAuthorityProviderFixtures(): void {
  for (const root of fixtureRoots.splice(0)) cleanupTempPath(root);
}

export function createLinuxProcessAuthorityProviderFixture(
  _mutation?: ProcessAuthorityProviderMutation
): ProcessAuthorityProviderConformanceFixture {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-linux-conformance-'));
  fixtureRoots.push(fixtureRoot);

  let starts = 0;
  let preparations = 0;
  let scenario: Scenario = 'normal';
  let observation: ProviderObservation = { state: 'live' };
  let control: ProviderControlOutcome = { state: 'exact-scope-empty' };
  const events: Array<() => void> = [];

  const transport: LinuxAuthorityNativeTransport = {
    async prepare(request: LinuxAuthorityNativePrepareRequest) {
      if (scenario === 'prepare-unavailable') {
        return { state: 'authority-unavailable', diagnosticCode: 'prepare-unavailable' };
      }
      preparations += 1;
      return {
        state: 'inert',
        attestation: {
          generation: Buffer.alloc(16, preparations).toString('base64url'),
          scopeCapability: Buffer.alloc(32, preparations + 16).toString('base64url'),
          controlCapability: Buffer.alloc(32, preparations + 32).toString('base64url'),
          preparationOperationId: request.preparationOperationId,
          launchDigest: request.launchDigest,
          bootId: '11111111-2222-4333-8444-555555555555',
          guardianPid: 5050,
          guardianStartTicks: '12345678901234567',
          pidNamespaceDevice: '4',
          pidNamespaceInode: '4026533111',
          helperProtocolVersion: ARTIFACT_IDENTITY.helperProtocolVersion,
          artifactSha256: ARTIFACT_IDENTITY.artifactSha256,
          sourceSha256: ARTIFACT_IDENTITY.sourceSha256,
        },
      };
    },
    async activate() {
      starts += 1;
      return { state: 'live' };
    },
    async inspect() {
      switch (scenario) {
        case 'optimistic-close': return { state: 'live' };
        case 'unavailable':
          return { state: 'authority-unavailable', diagnosticCode: 'native-unavailable' };
        case 'uncertain':
          return { state: 'authority-uncertain', diagnosticCode: 'native-uncertain' };
        case 'identity-drift':
          return { state: 'identity-drift', diagnosticCode: 'identity-drift' };
        case 'event-gap': return { state: 'event-gap', diagnosticCode: 'event-gap' };
        case 'timeout': return new Promise(() => undefined);
        case 'late-control':
          return new Promise((resolve) => {
            events.push(() => resolve({ state: 'exact-scope-empty' }));
          });
        case 'control-loss':
        case 'adapter-authority-loss':
          throw new Error('Linux fixture native transport lost');
        default: return toNativeOutcome(observation);
      }
    },
    async terminate() {
      if (scenario === 'identity-drift') {
        return { state: 'identity-drift', diagnosticCode: 'identity-drift' };
      }
      if (scenario === 'event-gap') {
        return { state: 'event-gap', diagnosticCode: 'event-gap' };
      }
      return toNativeOutcome(control);
    },
    async abort() {
      return toNativeOutcome(control);
    },
  };

  const ledger = createLinuxAuthorityPublicationLedger({
    root: path.join(fixtureRoot, 'publication-ledger'),
  });
  const bundle = createLinuxPrimaryProcessAuthorityProviderBundleForTesting({
    transport,
    ledger,
    artifactIdentity: ARTIFACT_IDENTITY,
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
    descriptor: LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
    input: { command: '/usr/bin/printf', args: [], cwd: '/tmp', env: { LANG: 'C' } },
    provider: bundle.provider,
    clock: { now: () => 1_000 },
    manifest: {
      schema: 'rasen-process-authority-providers/1',
      providers: [{
        ...LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
        artifactPath: 'providers/linux-user-pidns/rasen-linux-authority',
      }],
    },
    manifestRoot: fixtureRoot,
    publisher: bundle.publishAuthority,
    workloadStarts: () => starts,
    setObservation(value) { observation = value; },
    setControl(value) { control = value; },
    setScenario(value) { scenario = value; },
    externalFacts() {
      return {
        actualEmpty: false,
        destructiveControls: 0,
        releasedWithoutExactReceipt: false,
      };
    },
    async flushEvents() {
      for (const event of events.splice(0)) event();
      await Promise.resolve();
    },
  };
}
