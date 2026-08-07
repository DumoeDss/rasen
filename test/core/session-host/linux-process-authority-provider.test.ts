import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ProcessAuthorityProviderRegistry,
  createProcessAuthorityCoordinator,
  type AuthorityOperationContext,
  type ProcessAuthorityProviderManifest,
  type ProviderControlOutcome,
  type ProviderObservation,
} from '../../../src/core/session-host/process-authority/index.js';
import {
  decodeProcessAuthorityReferenceForDispatch,
} from '../../../src/core/session-host/process-authority/reference-codec.js';
import {
  LINUX_BROKER_PROCESS_AUTHORITY_DESCRIPTOR,
  LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
} from '../../../src/core/session-host/process-authority/linux/contracts.js';
import {
  createLinuxBrokerPrivateAuthorityReference,
  createLinuxPrimaryPrivateAuthorityReference,
  decodeLinuxPrivateAuthorityReference,
} from '../../../src/core/session-host/process-authority/linux/private-reference.js';
import {
  decodeLinuxBrokerPreparedForTesting,
  encodeLinuxBrokerReferenceForTesting,
  openLinuxAuthorityRuntimeBridgeForTesting,
  type LinuxAuthorityRuntimeTestChild,
} from '../../../src/core/session-host/process-authority/linux/native-assembly.js';
import {
  createLinuxAuthorityPublicationLedger,
} from '../../../src/core/session-host/process-authority/linux/publication-ledger.js';
import {
  createLinuxBrokerProcessAuthorityProviderBundle,
  createLinuxBrokerProcessAuthorityProviderBundleForTesting,
  createLinuxPrimaryProcessAuthorityProviderBundle,
  createLinuxPrimaryProcessAuthorityProviderBundleForTesting,
  type LinuxAuthorityNativePrepareRequest,
  type LinuxAuthorityNativeTransport,
  type LinuxAuthorityRuntimeOpener,
} from '../../../src/core/session-host/process-authority/linux/provider.js';
import { cleanupTempPath } from '../../helpers/temp-cleanup.js';

const tempRoots: string[] = [];
const ARTIFACT_IDENTITY = Object.freeze({
  helperProtocolVersion: 1 as const,
  artifactSha256: 'e'.repeat(64),
  sourceSha256: 'f'.repeat(64),
});

function operation(
  phase: AuthorityOperationContext['phase'],
  operationId = `${phase}-operation`
): AuthorityOperationContext {
  return Object.freeze({
    phase,
    operationId,
    deadline: Number.MAX_SAFE_INTEGER,
    signal: new AbortController().signal,
  });
}

function ledger() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-linux-provider-'));
  tempRoots.push(parent);
  return createLinuxAuthorityPublicationLedger({ root: path.join(parent, 'ledger') });
}

function launch() {
  return Object.freeze({
    command: '/usr/bin/printf',
    args: Object.freeze(['hello']),
    cwd: '/tmp',
    env: Object.freeze({ LANG: 'C', TEST: 'linux-authority' }),
  });
}

interface FakeNativeOptions {
  readonly mode?: 'user-pidns' | 'broker-pidns-cgroupv2';
  readonly unavailable?: boolean;
  readonly mismatchCapability?: boolean;
}

function fakeNative(options: FakeNativeOptions = {}) {
  const calls: string[] = [];
  let starts = 0;
  let preparations = 0;
  let observation: unknown = { state: 'inert' };
  let control: unknown = { state: 'exact-scope-empty' };
  let lastPrepare: LinuxAuthorityNativePrepareRequest | undefined;
  const mode = options.mode ?? 'user-pidns';
  const transport: LinuxAuthorityNativeTransport = {
    async prepare(request) {
      calls.push(`prepare:${request.mode}`);
      lastPrepare = request;
      if (options.unavailable) {
        return { state: 'authority-unavailable', diagnosticCode: 'prepare-unavailable' };
      }
      preparations += 1;
      const common = {
        generation: Buffer.alloc(16, preparations).toString('base64url'),
        scopeCapability: Buffer.alloc(32, preparations + 16).toString('base64url'),
        controlCapability: options.mismatchCapability
          ? 'not-a-native-capability'
          : Buffer.alloc(32, preparations + 32).toString('base64url'),
        preparationOperationId: request.preparationOperationId,
        launchDigest: request.launchDigest,
        bootId: '11111111-2222-4333-8444-555555555555',
        guardianPid: 5050,
        guardianStartTicks: '12345678901234567',
        pidNamespaceDevice: '4',
        pidNamespaceInode: '4026533111',
        helperProtocolVersion: 1 as const,
        artifactSha256: ARTIFACT_IDENTITY.artifactSha256,
        sourceSha256: ARTIFACT_IDENTITY.sourceSha256,
      };
      return mode === 'broker-pidns-cgroupv2'
        ? {
            state: 'inert' as const,
            attestation: {
              ...common,
              brokerInstallSha256: 'a'.repeat(64),
              brokerKeyId: 'b'.repeat(64),
              brokerLeaseToken: `${'D'.repeat(42)}A`,
              cgroupDevice: '33',
              cgroupInode: '9081726354',
            },
          }
        : { state: 'inert' as const, attestation: common };
    },
    async recordPublication(_reference, binding) {
      calls.push('record-publication');
      expect(binding).toMatchObject({
        referenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        preparationOperationId: expect.any(String),
        generation: expect.any(String),
        launchDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        publicationOperationId: expect.any(String),
      });
    },
    async activate() {
      calls.push('activate');
      starts += 1;
      return { state: 'live' };
    },
    async inspect() {
      calls.push('inspect');
      return observation;
    },
    async terminate() {
      calls.push('terminate');
      return control;
    },
    async abort() {
      calls.push('abort');
      return control;
    },
  };
  return {
    transport,
    calls,
    starts: () => starts,
    lastPrepare: () => lastPrepare,
    setObservation(value: unknown) { observation = value; },
    setControl(value: unknown) { control = value; },
  };
}

function runtimeOpener(opened: string[]): LinuxAuthorityRuntimeOpener {
  return {
    open(reference) {
      opened.push(reference.generation);
      return {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        rootExited: new Promise(() => undefined),
        exactScopeEmpty: new Promise(() => undefined),
      };
    },
  };
}

function manifestFor(
  descriptors: readonly (typeof LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR)[]
): ProcessAuthorityProviderManifest {
  return {
    schema: 'rasen-process-authority-providers/1',
    providers: descriptors.map((descriptor, index) => ({
      ...descriptor,
      artifactPath: `providers/linux-${index}/helper`,
    })),
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) cleanupTempPath(root);
});

describe('Linux process-authority provider bundle', () => {
  it('round-trips the exact bounded Rust broker reference and rejects runtime or shape drift', () => {
    const runtimeRoot = '/run/user/1000/rasen/linux-authority/runtime';
    const reference = decodeLinuxPrivateAuthorityReference(
      createLinuxBrokerPrivateAuthorityReference({
        generation: Buffer.alloc(16, 1).toString('base64url'),
        scopeCapability: Buffer.alloc(32, 2).toString('base64url'),
        controlCapability: Buffer.alloc(32, 3).toString('base64url'),
        preparationOperationId: 'prepare-broker-codec',
        launchDigest: 'a'.repeat(64),
        bootId: '11111111-2222-4333-8444-555555555555',
        guardianPid: 5050,
        guardianStartTicks: '12345678901234567',
        pidNamespaceDevice: '4',
        pidNamespaceInode: '4026533111',
        helperProtocolVersion: 1,
        artifactSha256: 'b'.repeat(64),
        sourceSha256: 'c'.repeat(64),
        brokerInstallSha256: 'd'.repeat(64),
        brokerKeyId: 'e'.repeat(64),
        brokerLeaseToken: Buffer.alloc(32, 6).toString('base64url'),
        cgroupDevice: '33',
        cgroupInode: '9081726354',
      })
    );
    const encoded = encodeLinuxBrokerReferenceForTesting(reference, runtimeRoot);
    expect(encoded.subarray(0, 4).toString('ascii')).toBe('BCR1');
    expect(encoded.subarray(10, 14).toString('ascii')).toBe('BGR1');
    expect(decodeLinuxBrokerPreparedForTesting(encoded, runtimeRoot)).toEqual({
      generation: reference.generation,
      scopeCapability: reference.scopeCapability,
      controlCapability: reference.controlCapability,
      preparationOperationId: reference.preparationOperationId,
      launchDigest: reference.launchDigest,
      bootId: reference.bootId,
      guardianPid: reference.guardianPid,
      guardianStartTicks: reference.guardianStartTicks,
      pidNamespaceDevice: reference.pidNamespaceDevice,
      pidNamespaceInode: reference.pidNamespaceInode,
      helperProtocolVersion: reference.helperProtocolVersion,
      artifactSha256: reference.artifactSha256,
      sourceSha256: reference.sourceSha256,
      brokerInstallSha256: reference.brokerInstallSha256,
      brokerKeyId: reference.brokerKeyId,
      brokerLeaseToken: reference.brokerLeaseToken,
      cgroupDevice: reference.cgroupDevice,
      cgroupInode: reference.cgroupInode,
    });
    expect(() => decodeLinuxBrokerPreparedForTesting(encoded, `${runtimeRoot}-replaced`))
      .toThrow(/runtime root differs/i);
    expect(() => decodeLinuxBrokerPreparedForTesting(
      Buffer.concat([encoded, Buffer.from([0])]),
      runtimeRoot
    )).toThrow(/trailing/i);
    const wrongMagic = Buffer.from(encoded);
    wrongMagic.write('BAD!', 0, 'ascii');
    expect(() => decodeLinuxBrokerPreparedForTesting(wrongMagic, runtimeRoot))
      .toThrow(/header/i);
  });

  it('assembles the production provider from its owned state and packaged native boundary', async () => {
    const parent = fs.mkdtempSync(path.join(
      process.platform === 'win32' ? os.tmpdir() : os.homedir(),
      'rasen-linux-production-provider-'
    ));
    tempRoots.push(parent);
    const stateRoot = path.join(parent, 'state');
    fs.mkdirSync(stateRoot, { mode: 0o700 });
    const bundle = createLinuxPrimaryProcessAuthorityProviderBundle({ stateRoot } as never);

    await expect(bundle.provider.prepare(
      launch(),
      operation('prepare', 'prepare-production-unavailable')
    )).resolves.toMatchObject({ state: 'authority-unavailable' });
    const replacement = createLinuxPrimaryProcessAuthorityProviderBundle({ stateRoot });
    await expect(replacement.provider.prepare(
      launch(),
      operation('prepare', 'prepare-production-replacement-unavailable')
    )).resolves.toMatchObject({ state: 'authority-unavailable' });
    expect(fs.statSync(path.join(stateRoot, 'runtime', 'publication-ledger')).isDirectory())
      .toBe(true);
    const loader = pathToFileURL(
      path.resolve('test/fixtures/typescript-source-loader.mjs')
    ).href;
    const providerModule = pathToFileURL(
      path.resolve('src/core/session-host/process-authority/linux/provider.ts')
    ).href;
    const reopened = spawnSync(process.execPath, [
      '--experimental-loader',
      loader,
      '--input-type=module',
      '--eval',
      `import { createLinuxPrimaryProcessAuthorityProviderBundle as open } from ${JSON.stringify(providerModule)}; open({ stateRoot: ${JSON.stringify(stateRoot)} });`,
    ], { encoding: 'utf8' });
    expect(reopened.status, reopened.stderr).toBe(0);
    expect(() => createLinuxPrimaryProcessAuthorityProviderBundle({
      stateRoot,
      transport: fakeNative().transport,
    } as never)).toThrow(/options|production|injection/i);
  });

  it('rejects writable or special-mode ancestors instead of accepting an arbitrary 0700 leaf', () => {
    if (process.platform === 'win32') return;
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-linux-production-unapproved-'));
    tempRoots.push(parent);
    const stateRoot = path.join(parent, 'state');
    fs.mkdirSync(stateRoot, { mode: 0o700 });
    expect(() => createLinuxPrimaryProcessAuthorityProviderBundle({ stateRoot }))
      .toThrow(/ancestor|ownership|mode/i);

    const approvedParent = fs.mkdtempSync(path.join(
      os.homedir(),
      'rasen-linux-production-special-mode-'
    ));
    tempRoots.push(approvedParent);
    const specialRoot = path.join(approvedParent, 'state');
    fs.mkdirSync(specialRoot, { mode: 0o700 });
    fs.chmodSync(specialRoot, 0o4700);
    expect(() => createLinuxPrimaryProcessAuthorityProviderBundle({ stateRoot: specialRoot }))
      .toThrow(/ownership|mode/i);
  });

  it('rejects every pending runtime fact when a ready helper exits cleanly without terminal proof', async () => {
    class FakeRuntimeChild extends EventEmitter {
      readonly stdin = new PassThrough();
      readonly stdout = new PassThrough();
      kill(): boolean { return true; }
    }
    const child = new FakeRuntimeChild() as FakeRuntimeChild & LinuxAuthorityRuntimeTestChild;
    const reference = createLinuxPrimaryPrivateAuthorityReference({
      generation: 'A'.repeat(22),
      scopeCapability: `${'B'.repeat(42)}A`,
      controlCapability: `${'C'.repeat(42)}A`,
      preparationOperationId: 'prepare-runtime-premature-close',
      launchDigest: 'a'.repeat(64),
      bootId: '11111111-2222-4333-8444-555555555555',
      guardianPid: 4242,
      guardianStartTicks: '12345678901234567',
      pidNamespaceDevice: '4',
      pidNamespaceInode: '4026533111',
      helperProtocolVersion: 1,
      artifactSha256: 'e'.repeat(64),
      sourceSha256: 'f'.repeat(64),
    });
    const runtime = openLinuxAuthorityRuntimeBridgeForTesting(
      child,
      decodeLinuxPrivateAuthorityReference(reference)
    );
    const ready = Buffer.alloc(12);
    ready.write('RPA1', 0, 'ascii');
    ready.writeUInt16BE(1, 4);
    ready[6] = 0x82;
    const rootFailure = expect(runtime.rootExited).rejects.toThrow(/terminal proof/i);
    const emptyFailure = expect(runtime.exactScopeEmpty).rejects.toThrow(/terminal proof/i);
    child.stdout.write(ready);
    await new Promise<void>((resolve) => setImmediate(resolve));
    child.emit('close', 0);

    await rootFailure;
    await emptyFailure;
    expect((runtime.stdout as PassThrough).destroyed).toBe(true);
    expect((runtime.stderr as PassThrough).destroyed).toBe(true);
  });

  it('rejects a ready runtime that closes with a truncated trailing frame', async () => {
    class FakeRuntimeChild extends EventEmitter {
      readonly stdin = new PassThrough();
      readonly stdout = new PassThrough();
      kill(): boolean { return true; }
    }
    const child = new FakeRuntimeChild() as FakeRuntimeChild & LinuxAuthorityRuntimeTestChild;
    const reference = decodeLinuxPrivateAuthorityReference(
      createLinuxPrimaryPrivateAuthorityReference({
        generation: Buffer.alloc(16, 4).toString('base64url'),
        scopeCapability: Buffer.alloc(32, 5).toString('base64url'),
        controlCapability: Buffer.alloc(32, 6).toString('base64url'),
        preparationOperationId: 'prepare-runtime-truncated-close',
        launchDigest: 'b'.repeat(64),
        bootId: '11111111-2222-4333-8444-555555555555',
        guardianPid: 4243,
        guardianStartTicks: '12345678901234568',
        pidNamespaceDevice: '4',
        pidNamespaceInode: '4026533112',
        helperProtocolVersion: 1,
        artifactSha256: 'e'.repeat(64),
        sourceSha256: 'f'.repeat(64),
      })
    );
    const runtime = openLinuxAuthorityRuntimeBridgeForTesting(child, reference);
    const ready = Buffer.alloc(12);
    ready.write('RPA1', 0, 'ascii');
    ready.writeUInt16BE(1, 4);
    ready[6] = 0x82;
    const rootFailure = expect(runtime.rootExited).rejects.toThrow(/terminal proof/i);
    const emptyFailure = expect(runtime.exactScopeEmpty).rejects.toThrow(/terminal proof/i);
    child.stdout.write(Buffer.concat([ready, Buffer.from('RPA1')]));
    await new Promise<void>((resolve) => setImmediate(resolve));
    child.emit('close', 0);
    await rootFailure;
    await emptyFailure;
  });

  it('binds native-owned capabilities from the exact prepare attestation into the private reference', async () => {
    const native = fakeNative();
    const opened: string[] = [];
    const bundle = createLinuxPrimaryProcessAuthorityProviderBundleForTesting({
      transport: native.transport,
      runtimeOpener: runtimeOpener(opened),
      ledger: ledger(),
      artifactIdentity: ARTIFACT_IDENTITY,
    });
    const prepared = await bundle.provider.prepare(launch(), operation('prepare', 'prepare-provider-1'));
    const decoded = decodeLinuxPrivateAuthorityReference(prepared.reference);

    expect(native.starts()).toBe(0);
    expect(native.lastPrepare()).toMatchObject({
      mode: 'user-pidns',
      input: launch(),
      preparationOperationId: 'prepare-provider-1',
      launchDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(native.lastPrepare()).not.toHaveProperty('generation');
    expect(native.lastPrepare()).not.toHaveProperty('scopeCapability');
    expect(native.lastPrepare()).not.toHaveProperty('controlCapability');
    expect(decoded).toMatchObject({
      mode: 'user-pidns',
      preparationOperationId: 'prepare-provider-1',
      generation: Buffer.alloc(16, 1).toString('base64url'),
      scopeCapability: Buffer.alloc(32, 17).toString('base64url'),
      controlCapability: Buffer.alloc(32, 33).toString('base64url'),
      artifactSha256: 'e'.repeat(64),
      sourceSha256: 'f'.repeat(64),
    });
    await expect(prepared.activate(operation('activate'))).resolves.toEqual({
      state: 'authority-uncertain',
      diagnostic: 'Linux process authority is retained (ledger-missing).',
    });
    expect(native.starts()).toBe(0);
  });

  it('rejects a native attestation that does not hold the exact TS capabilities', async () => {
    const native = fakeNative({ mismatchCapability: true });
    const bundle = createLinuxPrimaryProcessAuthorityProviderBundleForTesting({
      transport: native.transport,
      runtimeOpener: runtimeOpener([]),
      ledger: ledger(),
      artifactIdentity: ARTIFACT_IDENTITY,
    });
    await expect(bundle.provider.prepare(
      launch(),
      operation('prepare', 'prepare-mismatched-capability')
    )).rejects.toThrow(/attestation|capability|reference/i);
    expect(native.starts()).toBe(0);
  });

  it('preserves the fresh one-use generation and capabilities minted by native preparation', async () => {
    const native = fakeNative();
    const bundle = createLinuxPrimaryProcessAuthorityProviderBundleForTesting({
      transport: native.transport,
      runtimeOpener: runtimeOpener([]),
      ledger: ledger(),
      artifactIdentity: ARTIFACT_IDENTITY,
    });
    const first = await bundle.provider.prepare(
      launch(),
      operation('prepare', 'prepare-generation-1')
    );
    const firstReference = decodeLinuxPrivateAuthorityReference(first.reference);
    const second = await bundle.provider.prepare(
      launch(),
      operation('prepare', 'prepare-generation-2')
    );
    const secondReference = decodeLinuxPrivateAuthorityReference(second.reference);
    expect(second.reference).not.toBe(first.reference);
    expect(secondReference.generation).not.toBe(firstReference.generation);
    expect(secondReference.scopeCapability).not.toBe(firstReference.scopeCapability);
    expect(secondReference.controlCapability).not.toBe(firstReference.controlCapability);
  });

  it('commits through the existing common publisher seam before exactly-once activation', async () => {
    const native = fakeNative();
    const bundle = createLinuxPrimaryProcessAuthorityProviderBundleForTesting({
      transport: native.transport,
      runtimeOpener: runtimeOpener([]),
      ledger: ledger(),
      artifactIdentity: ARTIFACT_IDENTITY,
    });
    const registry = new ProcessAuthorityProviderRegistry([bundle.provider], {
      manifest: manifestFor([LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR]),
      manifestRoot: path.resolve('linux-primary-package'),
    });
    const ids = ['prepare-provider-published', 'publish-provider-published', 'activate-provider-published'];
    const coordinator = createProcessAuthorityCoordinator({
      registry,
      operationId: () => ids.shift() ?? 'unexpected-operation',
    });
    const prepared = await coordinator.prepare(
      LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
      launch()
    );
    if (prepared.state !== 'prepared-inert') throw new Error('expected prepared authority');
    const published = await prepared.publish(bundle.publishAuthority);
    if (published.state !== 'published-inert') throw new Error('expected published authority');

    await expect(published.activate()).resolves.toMatchObject({ state: 'live' });
    expect(native.starts()).toBe(1);
    expect(native.calls).toEqual(['prepare:user-pidns', 'activate']);
  });

  it('maps inert inspection only through the durable ledger and opens runtime privately', async () => {
    const native = fakeNative();
    const opened: string[] = [];
    const bundle = createLinuxPrimaryProcessAuthorityProviderBundleForTesting({
      transport: native.transport,
      runtimeOpener: runtimeOpener(opened),
      ledger: ledger(),
      artifactIdentity: ARTIFACT_IDENTITY,
    });
    const prepared = await bundle.provider.prepare(launch(), operation('prepare', 'prepare-inspect-1'));
    await expect(bundle.provider.inspect(prepared.reference, operation('inspect'))).resolves.toEqual({
      state: 'prepared-inert',
    });

    const commonReference = decodeProcessAuthorityReferenceForDispatch(
      // The exact public reference is produced through the same canonical codec by a coordinator.
      (await (async () => {
        const registry = new ProcessAuthorityProviderRegistry([bundle.provider], {
          manifest: manifestFor([LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR]),
          manifestRoot: path.resolve('linux-runtime-package'),
        });
        const coordinator = createProcessAuthorityCoordinator({
          registry,
          operationId: () => 'prepare-runtime-open',
        });
        const result = await coordinator.prepare(LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR, launch());
        if (result.state !== 'prepared-inert') throw new Error('expected prepared authority');
        return result.reference;
      })())
    );
    if (commonReference.state !== 'dispatchable') throw new Error('expected common reference');
    const runtime = bundle.openRuntime(commonReference.reference);
    expect(runtime.stdin).toBeInstanceOf(PassThrough);
    expect(opened).toEqual([
      decodeLinuxPrivateAuthorityReference(commonReference.providerReference).generation,
    ]);
  });

  it('maps terminate and abort only through the injected exact native authority', async () => {
    const native = fakeNative();
    const bundle = createLinuxPrimaryProcessAuthorityProviderBundleForTesting({
      transport: native.transport,
      runtimeOpener: runtimeOpener([]),
      ledger: ledger(),
      artifactIdentity: ARTIFACT_IDENTITY,
    });
    const prepared = await bundle.provider.prepare(launch(), operation('prepare', 'prepare-controls'));
    native.setControl({ state: 'identity-drift', diagnosticCode: 'identity-drift' });
    await expect(bundle.provider.terminate(
      prepared.reference,
      { reason: 'test', graceMs: 0 },
      operation('terminate')
    )).resolves.toEqual({
      state: 'identity-drift',
      diagnostic: 'Linux process authority is retained (identity-drift).',
    });
    native.setControl({ state: 'exact-scope-empty' });
    await expect(bundle.provider.abort(
      prepared.reference,
      'test abort',
      operation('abort')
    )).resolves.toEqual({ state: 'exact-scope-empty' });
    expect(native.calls).toEqual(['prepare:user-pidns', 'terminate', 'abort']);
  });

  it('never contacts an alternate provider after primary unavailability or before exact broker selection', async () => {
    const primaryNative = fakeNative({ unavailable: true });
    const brokerNative = fakeNative({ mode: 'broker-pidns-cgroupv2' });
    const primary = createLinuxPrimaryProcessAuthorityProviderBundleForTesting({
      transport: primaryNative.transport,
      runtimeOpener: runtimeOpener([]),
      ledger: ledger(),
      artifactIdentity: ARTIFACT_IDENTITY,
    });
    const broker = createLinuxBrokerProcessAuthorityProviderBundleForTesting({
      transport: brokerNative.transport,
      runtimeOpener: runtimeOpener([]),
      ledger: ledger(),
      artifactIdentity: ARTIFACT_IDENTITY,
    });
    const registry = new ProcessAuthorityProviderRegistry([primary.provider, broker.provider], {
      manifest: manifestFor([
        LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
        LINUX_BROKER_PROCESS_AUTHORITY_DESCRIPTOR,
      ]),
      manifestRoot: path.resolve('linux-provider-package'),
    });
    const coordinator = createProcessAuthorityCoordinator({ registry });

    await expect(coordinator.prepare(
      LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
      launch()
    )).resolves.toEqual({
      state: 'authority-unavailable',
      selection: {
        providerId: LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR.providerId,
        capabilityId: LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR.capabilityId,
        protocolVersion: LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR.protocolVersion,
      },
      diagnostic: 'selected provider prerequisites unavailable',
    });
    expect(primaryNative.calls).toEqual(['prepare:user-pidns']);
    expect(brokerNative.calls).toEqual([]);

    const brokerPrepared = await coordinator.prepare(
      LINUX_BROKER_PROCESS_AUTHORITY_DESCRIPTOR,
      launch()
    );
    expect(brokerPrepared.state).toBe('prepared-inert');
    expect(brokerNative.calls).toEqual(['prepare:broker-pidns-cgroupv2']);
    expect(primaryNative.calls).toEqual(['prepare:user-pidns']);
  });

  it('surfaces native prerequisite denial as a typed prepare-unavailable result', async () => {
    const native = fakeNative({ unavailable: true });
    const bundle = createLinuxPrimaryProcessAuthorityProviderBundleForTesting({
      transport: native.transport,
      runtimeOpener: runtimeOpener([]),
      ledger: ledger(),
      artifactIdentity: ARTIFACT_IDENTITY,
    });
    await expect(bundle.provider.prepare(
      launch(),
      operation('prepare', 'prepare-unavailable')
    )).resolves.toEqual({
      state: 'authority-unavailable',
      diagnostic: 'selected provider prerequisites unavailable',
    });
  });

  it('contains no hidden publication side effect in provider activation', () => {
    const source = fs.readFileSync(
      path.resolve('src/core/session-host/process-authority/linux/provider.ts'),
      'utf8'
    );
    const activation = source.slice(
      source.indexOf('async activate(activateContext'),
      source.indexOf('async inspect(', source.indexOf('async activate(activateContext'))
    );
    expect(activation).toContain('requirePublished');
    expect(activation).not.toContain('.commit(');
    expect(activation).not.toContain('publishAuthority');
    expect(activation).not.toContain('createLinuxAuthorityPublication');
  });

  it('bounds Linux paths and faithfully snapshots a null-prototype environment', async () => {
    const native = fakeNative();
    const bundle = createLinuxPrimaryProcessAuthorityProviderBundleForTesting({
      transport: native.transport,
      runtimeOpener: runtimeOpener([]),
      ledger: ledger(),
      artifactIdentity: ARTIFACT_IDENTITY,
    });
    for (const invalid of [
      { ...launch(), command: `/tmp/${'x'.repeat(32 * 1024)}` },
      { ...launch(), cwd: '/tmp/with\0nul' },
      { ...launch(), env: { 'INVALID=NAME': 'value' } },
    ]) {
      await expect(bundle.provider.prepare(invalid, operation('prepare'))).rejects.toThrow(
        /launch|path|environment|bound|malformed/i
      );
    }
    expect(native.calls).toEqual([]);

    const env = Object.create(null) as Record<string, string>;
    Object.defineProperty(env, '__proto__', {
      value: 'literal-value',
      enumerable: true,
      configurable: false,
      writable: false,
    });
    await bundle.provider.prepare(
      { ...launch(), env },
      operation('prepare', 'prepare-null-prototype-env')
    );
    expect(Object.prototype.hasOwnProperty.call(native.lastPrepare()?.input.env, '__proto__'))
      .toBe(true);
    expect(native.lastPrepare()?.input.env.__proto__).toBe('literal-value');
  });
});
