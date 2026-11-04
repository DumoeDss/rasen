import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AuthorityOperationContext,
  AuthorityPrepareInput,
  ProviderAuthorityReference,
} from '../../../src/core/session-host/process-authority/types.js';
import {
  createLinuxBrokerPreparationDeliveryLedger,
  LinuxBrokerPreparationDeliveryLedger,
} from '../../../src/core/session-host/process-authority/linux/preparation-delivery-ledger.js';
import {
  createLinuxAuthorityPublicationLedger,
} from '../../../src/core/session-host/process-authority/linux/publication-ledger.js';
import {
  createLinuxBrokerPrivateAuthorityReference,
} from '../../../src/core/session-host/process-authority/linux/private-reference.js';
import {
  createLinuxBrokerProcessAuthorityProviderBundle,
  createLinuxBrokerProcessAuthorityProviderBundleForTesting,
  digestLinuxAuthorityLaunch,
  type LinuxAuthorityNativePrepareRequest,
  type LinuxAuthorityNativeTransport,
  type LinuxBrokerPreparationDeliveryRecovery,
} from '../../../src/core/session-host/process-authority/linux/provider.js';
import { cleanupTempPath } from '../../helpers/temp-cleanup.js';

const tempRoots: string[] = [];
const ARTIFACT_IDENTITY = Object.freeze({
  helperProtocolVersion: 1 as const,
  artifactSha256: 'e'.repeat(64),
  sourceSha256: 'f'.repeat(64),
});
const PREPARE_DIGEST = createHash('sha256')
  .update('controller-delivery-test-payload')
  .digest('hex');

function operation(operationId: string): AuthorityOperationContext {
  return Object.freeze({
    phase: 'prepare' as const,
    operationId,
    deadline: Number.MAX_SAFE_INTEGER,
    signal: new AbortController().signal,
  });
}

function launch(): AuthorityPrepareInput {
  return Object.freeze({
    command: '/usr/bin/printf',
    args: Object.freeze(['delivery']),
    cwd: '/tmp',
    env: Object.freeze({ LANG: 'C' }),
  });
}

function roots() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-linux-delivery-'));
  tempRoots.push(root);
  return Object.freeze({
    root,
    delivery: path.join(root, 'delivery'),
    publication: path.join(root, 'publication'),
  });
}

function brokerAttestation(request: LinuxAuthorityNativePrepareRequest, seed = 1) {
  return Object.freeze({
    state: 'inert' as const,
    attestation: Object.freeze({
      generation: Buffer.alloc(16, seed).toString('base64url'),
      scopeCapability: Buffer.alloc(32, seed + 16).toString('base64url'),
      controlCapability: Buffer.alloc(32, seed + 32).toString('base64url'),
      preparationOperationId: request.preparationOperationId,
      launchDigest: request.launchDigest,
      bootId: '11111111-2222-4333-8444-555555555555',
      guardianPid: 5050 + seed,
      guardianStartTicks: '12345678901234567',
      pidNamespaceDevice: '4',
      pidNamespaceInode: '4026533111',
      helperProtocolVersion: 1 as const,
      artifactSha256: ARTIFACT_IDENTITY.artifactSha256,
      sourceSha256: ARTIFACT_IDENTITY.sourceSha256,
      brokerInstallSha256: 'a'.repeat(64),
      brokerKeyId: 'b'.repeat(64),
      brokerLeaseToken: Buffer.alloc(32, seed + 48).toString('base64url'),
      cgroupDevice: '33',
      cgroupInode: '9081726354',
    }),
  });
}

interface DeliveryTransportState {
  prepareCalls: number;
  recoverCalls: number;
  acknowledgeCalls: number;
  abortCalls: number;
  losePrepareResponse: boolean;
  loseAcknowledgementResponse: boolean;
  abortOutcome?: unknown;
}

function deliveryTransport(
  state: DeliveryTransportState,
  deliveryLedger: LinuxBrokerPreparationDeliveryLedger,
  expectedRequest: LinuxAuthorityNativePrepareRequest
): LinuxAuthorityNativeTransport {
  return Object.freeze({
    async prepare(): Promise<never> {
      throw new Error('legacy broker prepare must not bypass durable delivery');
    },
    preparationDeliveryDigest() {
      return PREPARE_DIGEST;
    },
    async prepareDelivery(request, binding, context) {
      state.prepareCalls += 1;
      expect(request).toEqual(expectedRequest);
      expect(deliveryLedger.begin(
        binding.preparationOperationId,
        binding.prepareDigest,
        binding.launchDigest,
        context
      )).toMatchObject({ state: 'Intent', created: false, binding });
      if (state.losePrepareResponse) {
        state.losePrepareResponse = false;
        throw new Error('simulated broker response loss after PreparedPendingAck');
      }
      return brokerAttestation(request);
    },
    async recoverPreparedDelivery(binding) {
      state.recoverCalls += 1;
      expect(binding).toMatchObject({
        preparationOperationId: expectedRequest.preparationOperationId,
        prepareDigest: PREPARE_DIGEST,
        launchDigest: expectedRequest.launchDigest,
      });
      return brokerAttestation(expectedRequest);
    },
    async acknowledgePreparedDelivery(_reference, binding, context) {
      state.acknowledgeCalls += 1;
      expect(deliveryLedger.begin(
        binding.preparationOperationId,
        binding.prepareDigest,
        binding.launchDigest,
        context
      )).toMatchObject({ state: 'ReferenceStored', created: false, binding });
      if (state.loseAcknowledgementResponse) {
        state.loseAcknowledgementResponse = false;
        throw new Error('simulated ACK response loss after broker acceptance');
      }
    },
    async abortPreparedDelivery(binding) {
      state.abortCalls += 1;
      expect(binding).toMatchObject({
        preparationOperationId: expectedRequest.preparationOperationId,
        prepareDigest: PREPARE_DIGEST,
        launchDigest: expectedRequest.launchDigest,
      });
      return state.abortOutcome ?? { state: 'exact-scope-empty' };
    },
    async recordPublication() {},
    async activate() { return { state: 'live' }; },
    async inspect() { return { state: 'inert' }; },
    async terminate() { return { state: 'exact-scope-empty' }; },
    async abort() { return { state: 'exact-scope-empty' }; },
  });
}

function bundle(
  stateRoot: ReturnType<typeof roots>,
  deliveryLedger: LinuxBrokerPreparationDeliveryLedger,
  transport: LinuxAuthorityNativeTransport
) {
  return createLinuxBrokerProcessAuthorityProviderBundleForTesting({
    transport,
    runtimeOpener: { open() { throw new Error('runtime not used'); } },
    ledger: createLinuxAuthorityPublicationLedger({ root: stateRoot.publication }),
    deliveryLedger,
    artifactIdentity: ARTIFACT_IDENTITY,
  });
}

async function waitForFile(file: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!fs.existsSync(file)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path.basename(file)}.`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForChild(child: ReturnType<typeof spawn>): Promise<void> {
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer | string) => { stderr += chunk.toString(); });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) resolve();
      else reject(new Error(`Delivery child exited ${String(code)}/${String(signal)}: ${stderr}`));
    });
  });
}

function concurrentBeginChild(
  deliveryRoot: string,
  readyFile: string,
  gateFile: string,
  resultFile: string,
  operationId: string,
  launchDigest: string
) {
  const loader = pathToFileURL(path.resolve('test/fixtures/typescript-source-loader.mjs')).href;
  const ledgerModule = pathToFileURL(path.resolve(
    'src/core/session-host/process-authority/linux/preparation-delivery-ledger.ts'
  )).href;
  const source = `
    import fs from 'node:fs';
    import { createLinuxBrokerPreparationDeliveryLedger } from ${JSON.stringify(ledgerModule)};
    const ledger = createLinuxBrokerPreparationDeliveryLedger({ root: ${JSON.stringify(deliveryRoot)} });
    fs.writeFileSync(${JSON.stringify(readyFile)}, 'ready', 'utf8');
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(${JSON.stringify(gateFile)})) {
      if (Date.now() >= deadline) throw new Error('concurrent begin gate timeout');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    try {
      const entry = ledger.begin(
        ${JSON.stringify(operationId)},
        ${JSON.stringify(PREPARE_DIGEST)},
        ${JSON.stringify(launchDigest)},
        Object.freeze({
          phase: 'prepare',
          operationId: ${JSON.stringify(operationId)},
          deadline: Number.MAX_SAFE_INTEGER,
          signal: new AbortController().signal,
        })
      );
      fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({
        ok: true,
        created: entry.created,
        recoveryCapability: entry.binding.recoveryCapability,
      }), 'utf8');
    } catch (error) {
      fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }), 'utf8');
      process.exitCode = 1;
    }
  `;
  return spawn(process.execPath, [
    '--no-warnings',
    '--experimental-loader',
    loader,
    '--input-type=module',
    '--eval',
    source,
  ]);
}

function orphanReconciliationChild(stateRoot: string, resultFile: string) {
  const loader = pathToFileURL(path.resolve('test/fixtures/typescript-source-loader.mjs')).href;
  const providerModule = pathToFileURL(path.resolve(
    'src/core/session-host/process-authority/linux/provider.ts'
  )).href;
  const ledgerModule = pathToFileURL(path.resolve(
    'src/core/session-host/process-authority/linux/preparation-delivery-ledger.ts'
  )).href;
  const publicationModule = pathToFileURL(path.resolve(
    'src/core/session-host/process-authority/linux/publication-ledger.ts'
  )).href;
  const source = `
    import fs from 'node:fs';
    import path from 'node:path';
    import {
      createLinuxBrokerProcessAuthorityProviderBundleForTesting,
    } from ${JSON.stringify(providerModule)};
    import {
      createLinuxBrokerPreparationDeliveryLedger,
    } from ${JSON.stringify(ledgerModule)};
    import {
      createLinuxAuthorityPublicationLedger,
    } from ${JSON.stringify(publicationModule)};
    const trustedStateRoot = ${JSON.stringify(stateRoot)};
    const brokerStatePath = path.join(trustedStateRoot, 'broker-delivery-state.json');
    const brokerState = JSON.parse(fs.readFileSync(brokerStatePath, 'utf8'));
    const exactDelivery = (binding) => {
      const delivery = brokerState.deliveries.find((candidate) =>
        candidate.binding.preparationOperationId === binding.preparationOperationId);
      if (!delivery || JSON.stringify(delivery.binding) !== JSON.stringify(binding)) {
        throw new TypeError('fixture broker delivery identity drifted');
      }
      return delivery;
    };
    const transport = Object.freeze({
      async prepare() { throw new Error('legacy prepare is forbidden'); },
      preparationDeliveryDigest() { return ${JSON.stringify(PREPARE_DIGEST)}; },
      async prepareDelivery() { throw new Error('fresh owner must not prepare an orphan'); },
      async recoverPreparedDelivery(binding) {
        const delivery = exactDelivery(binding);
        delivery.recoverCalls += 1;
        return Object.freeze({ state: 'inert', attestation: Object.freeze(delivery.attestation) });
      },
      async acknowledgePreparedDelivery(_reference, binding) {
        const delivery = exactDelivery(binding);
        delivery.acknowledgeCalls += 1;
        delivery.acknowledged = true;
      },
      async abortPreparedDelivery(binding) {
        const delivery = exactDelivery(binding);
        delivery.abortCalls += 1;
        return Object.freeze({ state: 'exact-scope-empty' });
      },
      async recordPublication() {},
      async activate() { return Object.freeze({ state: 'live' }); },
      async inspect() { return Object.freeze({ state: 'inert' }); },
      async terminate() { return Object.freeze({ state: 'exact-scope-empty' }); },
      async abort() { return Object.freeze({ state: 'exact-scope-empty' }); },
    });
    const ledger = createLinuxBrokerPreparationDeliveryLedger({
      root: path.join(trustedStateRoot, 'delivery'),
    });
    const bundle = createLinuxBrokerProcessAuthorityProviderBundleForTesting({
      transport,
      runtimeOpener: Object.freeze({ open() { throw new Error('runtime not used'); } }),
      ledger: createLinuxAuthorityPublicationLedger({
        root: path.join(trustedStateRoot, 'publication'),
      }),
      deliveryLedger: ledger,
      artifactIdentity: Object.freeze(${JSON.stringify(ARTIFACT_IDENTITY)}),
    });
    const recovery = bundle.preparationDeliveryRecovery;
    if (!recovery) throw new TypeError('bundle recovery capability is absent');
    const result = await recovery.reconcileOrphans(Object.freeze({
      phase: 'inspect',
      operationId: 'fresh-controller-orphan-reconciliation',
      deadline: performance.now() + 10000,
      signal: new AbortController().signal,
    }));
    fs.writeFileSync(brokerStatePath, JSON.stringify(brokerState), 'utf8');
    fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({
      result,
      recoveryKeys: Object.keys(recovery).sort(),
    }), 'utf8');
  `;
  return spawn(process.execPath, [
    '--no-warnings',
    '--experimental-loader',
    loader,
    '--input-type=module',
    '--eval',
    source,
  ]);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) cleanupTempPath(root);
});

describe('Linux broker controller preparation-delivery ledger', () => {
  it('keeps a production broker with a missing packaged client typed unavailable', async () => {
    const parent = fs.mkdtempSync(path.join(
      process.platform === 'win32' ? os.tmpdir() : os.homedir(),
      'rasen-linux-broker-production-unavailable-'
    ));
    tempRoots.push(parent);
    const stateRoot = path.join(parent, 'state');
    fs.mkdirSync(stateRoot, { mode: 0o700 });

    const production = createLinuxBrokerProcessAuthorityProviderBundle({ stateRoot });
    await expect(production.provider.prepare(
      launch(),
      operation('prepare-broker-production-unavailable')
    )).resolves.toMatchObject({ state: 'authority-unavailable' });
    expect(fs.readdirSync(path.join(
      stateRoot,
      'runtime',
      'preparation-delivery-ledger'
    ))).toEqual([]);
  });

  it('persists Intent before client spawn and ReferenceStored before ACK', async () => {
    const stateRoot = roots();
    const deliveryLedger = createLinuxBrokerPreparationDeliveryLedger({ root: stateRoot.delivery });
    const context = operation('prepare-delivery-order');
    const input = launch();
    const expectedRequest = Object.freeze({
      mode: 'broker-pidns-cgroupv2' as const,
      input,
      preparationOperationId: context.operationId,
      launchDigest: digestLinuxAuthorityLaunch(input),
    });
    const state: DeliveryTransportState = {
      prepareCalls: 0,
      recoverCalls: 0,
      acknowledgeCalls: 0,
      abortCalls: 0,
      losePrepareResponse: false,
      loseAcknowledgementResponse: false,
    };

    const prepared = await bundle(
      stateRoot,
      deliveryLedger,
      deliveryTransport(state, deliveryLedger, expectedRequest)
    ).provider.prepare(input, context);
    expect('reference' in prepared).toBe(true);
    const final = deliveryLedger.begin(
      context.operationId,
      PREPARE_DIGEST,
      expectedRequest.launchDigest,
      context
    );
    expect(final).toMatchObject({ state: 'Acknowledged', created: false });
    expect(final.reference).toBe('reference' in prepared ? prepared.reference : undefined);
    expect(state).toMatchObject({ prepareCalls: 1, recoverCalls: 0, acknowledgeCalls: 1 });
  });

  it('recovers a committed response after controller/client replacement without rerunning prepare', async () => {
    const stateRoot = roots();
    const firstLedger = createLinuxBrokerPreparationDeliveryLedger({ root: stateRoot.delivery });
    const context = operation('prepare-controller-replacement');
    const input = launch();
    const expectedRequest = Object.freeze({
      mode: 'broker-pidns-cgroupv2' as const,
      input,
      preparationOperationId: context.operationId,
      launchDigest: digestLinuxAuthorityLaunch(input),
    });
    const state: DeliveryTransportState = {
      prepareCalls: 0,
      recoverCalls: 0,
      acknowledgeCalls: 0,
      abortCalls: 0,
      losePrepareResponse: true,
      loseAcknowledgementResponse: false,
    };
    await expect(bundle(
      stateRoot,
      firstLedger,
      deliveryTransport(state, firstLedger, expectedRequest)
    ).provider.prepare(input, context)).rejects.toThrow(/response loss/);

    const replacementLedger = createLinuxBrokerPreparationDeliveryLedger({ root: stateRoot.delivery });
    const recovered = await bundle(
      stateRoot,
      replacementLedger,
      deliveryTransport(state, replacementLedger, expectedRequest)
    ).provider.prepare(input, context);
    expect('reference' in recovered).toBe(true);
    expect(state).toMatchObject({ prepareCalls: 1, recoverCalls: 1, acknowledgeCalls: 1 });
    expect(replacementLedger.begin(
      context.operationId,
      PREPARE_DIGEST,
      expectedRequest.launchDigest,
      context
    )).toMatchObject({ state: 'Acknowledged', reference: 'reference' in recovered
      ? recovered.reference
      : undefined });
  });

  it('replays ACK after response loss and never re-prepares or re-recovers a stored reference', async () => {
    const stateRoot = roots();
    const firstLedger = createLinuxBrokerPreparationDeliveryLedger({ root: stateRoot.delivery });
    const context = operation('prepare-ack-loss');
    const input = launch();
    const expectedRequest = Object.freeze({
      mode: 'broker-pidns-cgroupv2' as const,
      input,
      preparationOperationId: context.operationId,
      launchDigest: digestLinuxAuthorityLaunch(input),
    });
    const state: DeliveryTransportState = {
      prepareCalls: 0,
      recoverCalls: 0,
      acknowledgeCalls: 0,
      abortCalls: 0,
      losePrepareResponse: false,
      loseAcknowledgementResponse: true,
    };
    await expect(bundle(
      stateRoot,
      firstLedger,
      deliveryTransport(state, firstLedger, expectedRequest)
    ).provider.prepare(input, context)).rejects.toThrow(/ACK response loss/);

    const replacementLedger = createLinuxBrokerPreparationDeliveryLedger({ root: stateRoot.delivery });
    const recovered = await bundle(
      stateRoot,
      replacementLedger,
      deliveryTransport(state, replacementLedger, expectedRequest)
    ).provider.prepare(input, context);
    expect('reference' in recovered).toBe(true);
    expect(state).toMatchObject({ prepareCalls: 1, recoverCalls: 0, acknowledgeCalls: 2 });

    const finalLedger = createLinuxBrokerPreparationDeliveryLedger({ root: stateRoot.delivery });
    const final = await bundle(
      stateRoot,
      finalLedger,
      deliveryTransport(state, finalLedger, expectedRequest)
    ).provider.prepare(input, context);
    expect('reference' in final && 'reference' in recovered && final.reference === recovered.reference)
      .toBe(true);
    expect(state).toMatchObject({ prepareCalls: 1, recoverCalls: 0, acknowledgeCalls: 2 });
  });

  it('fails closed on operation, digest, capability, and reference conflicts', () => {
    const stateRoot = roots();
    const deliveryLedger = createLinuxBrokerPreparationDeliveryLedger({ root: stateRoot.delivery });
    const context = operation('prepare-conflict');
    const launchDigest = digestLinuxAuthorityLaunch(launch());
    const intent = deliveryLedger.begin(context.operationId, PREPARE_DIGEST, launchDigest, context);

    expect(() => deliveryLedger.begin(
      context.operationId,
      '0'.repeat(64),
      launchDigest,
      context
    )).toThrow(/conflict/i);
    expect(() => deliveryLedger.storeReference({
      ...intent.binding,
      recoveryCapability: Buffer.alloc(32, 99).toString('base64url'),
    }, 'first-reference' as ProviderAuthorityReference)).toThrow(/unavailable|conflict/i);

    deliveryLedger.storeReference(intent.binding, 'first-reference' as ProviderAuthorityReference);
    expect(() => deliveryLedger.storeReference(
      intent.binding,
      'different-reference' as ProviderAuthorityReference
    )).toThrow(/reference conflicts/i);
  });

  it('serializes concurrent controller intent without replacing committed phase files', async () => {
    const stateRoot = roots();
    fs.mkdirSync(stateRoot.delivery, { mode: 0o700 });
    const operationId = 'prepare-concurrent-controller-intent';
    const launchDigest = digestLinuxAuthorityLaunch(launch());
    const gate = path.join(stateRoot.root, 'begin.gate');
    const ready = [0, 1].map((index) => path.join(stateRoot.root, `begin-${index}.ready`));
    const results = [0, 1].map((index) => path.join(stateRoot.root, `begin-${index}.json`));
    const children = [0, 1].map((index) => concurrentBeginChild(
      stateRoot.delivery,
      ready[index]!,
      gate,
      results[index]!,
      operationId,
      launchDigest
    ));
    await Promise.all(ready.map(waitForFile));
    fs.writeFileSync(gate, 'go', 'utf8');
    await Promise.all(children.map(waitForChild));

    const outcomes = results.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')) as {
      readonly ok: boolean;
      readonly created: boolean;
      readonly recoveryCapability: string;
    });
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(outcomes.map((outcome) => outcome.created).sort()).toEqual([false, true]);
    expect(new Set(outcomes.map((outcome) => outcome.recoveryCapability)).size).toBe(1);

    const ledger = createLinuxBrokerPreparationDeliveryLedger({ root: stateRoot.delivery });
    const intent = ledger.begin(operationId, PREPARE_DIGEST, launchDigest, operation(operationId));
    ledger.storeReference(intent.binding, 'concurrent-reference' as ProviderAuthorityReference);
    ledger.acknowledge(intent.binding);
    const names = fs.readdirSync(stateRoot.delivery).sort();
    expect(names.filter((name) => name.endsWith('.intent'))).toHaveLength(1);
    expect(names.filter((name) => name.endsWith('.reference'))).toHaveLength(1);
    expect(names.filter((name) => name.endsWith('.acknowledged'))).toHaveLength(1);
    expect(names.some((name) => name.endsWith('.delivery') || name.endsWith('.tmp'))).toBe(false);
  }, 20_000);

  it('recovers, validates, stores, and ACKs orphan delivery in a fresh bundle process', async () => {
    const stateRoot = roots();
    const ledger = createLinuxBrokerPreparationDeliveryLedger({ root: stateRoot.delivery });
    const input = launch();
    const launchDigest = digestLinuxAuthorityLaunch(input);
    const intentOperation = 'prepare-orphan-intent';
    const referenceOperation = 'prepare-orphan-reference';
    const acknowledgedOperation = 'prepare-settled-acknowledged';
    const intent = ledger.begin(
      intentOperation,
      PREPARE_DIGEST,
      launchDigest,
      operation(intentOperation)
    );
    const reference = ledger.begin(
      referenceOperation,
      PREPARE_DIGEST,
      launchDigest,
      operation(referenceOperation)
    );
    const referenceRequest = Object.freeze({
      mode: 'broker-pidns-cgroupv2' as const,
      input,
      preparationOperationId: referenceOperation,
      launchDigest,
    });
    const referenceAttestation = brokerAttestation(referenceRequest, 2).attestation;
    const referenceValue = createLinuxBrokerPrivateAuthorityReference(referenceAttestation);
    ledger.storeReference(reference.binding, referenceValue);
    const acknowledged = ledger.begin(
      acknowledgedOperation,
      PREPARE_DIGEST,
      launchDigest,
      operation(acknowledgedOperation)
    );
    const acknowledgedRequest = Object.freeze({
      mode: 'broker-pidns-cgroupv2' as const,
      input,
      preparationOperationId: acknowledgedOperation,
      launchDigest,
    });
    ledger.storeReference(
      acknowledged.binding,
      createLinuxBrokerPrivateAuthorityReference(
        brokerAttestation(acknowledgedRequest, 3).attestation
      )
    );
    ledger.acknowledge(acknowledged.binding);

    const intentRequest = Object.freeze({
      mode: 'broker-pidns-cgroupv2' as const,
      input,
      preparationOperationId: intentOperation,
      launchDigest,
    });
    fs.writeFileSync(
      path.join(stateRoot.root, 'broker-delivery-state.json'),
      JSON.stringify({
        deliveries: [
          {
            binding: intent.binding,
            attestation: brokerAttestation(intentRequest, 1).attestation,
            recoverCalls: 0,
            acknowledgeCalls: 0,
            abortCalls: 0,
            acknowledged: false,
          },
          {
            binding: reference.binding,
            attestation: referenceAttestation,
            recoverCalls: 0,
            acknowledgeCalls: 0,
            abortCalls: 0,
            acknowledged: false,
          },
        ],
      }),
      'utf8'
    );

    const resultFile = path.join(stateRoot.root, 'fresh-controller-orphans.json');
    await waitForChild(orphanReconciliationChild(stateRoot.root, resultFile));
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8')) as {
      readonly result: {
        readonly visited: number;
        readonly acknowledged: number;
        readonly reconciled: number;
        readonly retained: number;
        readonly entries: Array<{
        readonly preparationOperationId: string;
          readonly initialState: 'Intent' | 'ReferenceStored';
          readonly disposition: 'acknowledged';
          readonly reference: string;
        }>;
      };
      readonly recoveryKeys: readonly string[];
    };
    result.result.entries.sort((left, right) =>
      left.preparationOperationId.localeCompare(right.preparationOperationId));

    expect(result.recoveryKeys).toEqual(['reconcileOrphans', 'recover']);
    expect(result.result).toMatchObject({
      visited: 2,
      acknowledged: 2,
      reconciled: 0,
      retained: 0,
      entries: [
        {
          preparationOperationId: intentOperation,
          initialState: 'Intent',
          disposition: 'acknowledged',
        },
        {
          preparationOperationId: referenceOperation,
          initialState: 'ReferenceStored',
          disposition: 'acknowledged',
          reference: referenceValue,
        },
      ],
    });
    const brokerState = JSON.parse(fs.readFileSync(
      path.join(stateRoot.root, 'broker-delivery-state.json'),
      'utf8'
    )) as { readonly deliveries: Array<{
      readonly recoverCalls: number;
      readonly acknowledgeCalls: number;
      readonly abortCalls: number;
      readonly acknowledged: boolean;
    }> };
    expect(brokerState.deliveries).toMatchObject([
      { recoverCalls: 1, acknowledgeCalls: 1, abortCalls: 0, acknowledged: true },
      { recoverCalls: 0, acknowledgeCalls: 1, abortCalls: 0, acknowledged: true },
    ]);

    const replacement = createLinuxBrokerPreparationDeliveryLedger({ root: stateRoot.delivery });
    expect(replacement.begin(intentOperation, PREPARE_DIGEST, launchDigest, operation(intentOperation)))
      .toMatchObject({ state: 'Acknowledged' });
    expect(replacement.begin(
      referenceOperation,
      PREPARE_DIGEST,
      launchDigest,
      operation(referenceOperation)
    )).toMatchObject({ state: 'Acknowledged', reference: referenceValue });
    expect(replacement.discoverPendingOrphans()).toEqual([]);

    const replayFile = path.join(stateRoot.root, 'fresh-controller-replay.json');
    await waitForChild(orphanReconciliationChild(stateRoot.root, replayFile));
    expect(JSON.parse(fs.readFileSync(replayFile, 'utf8'))).toMatchObject({
      result: { visited: 0, acknowledged: 0, reconciled: 0, retained: 0, entries: [] },
    });
  }, 20_000);

  it('fails orphan discovery closed when a phase filename does not match its durable identity', () => {
    const stateRoot = roots();
    const ledger = createLinuxBrokerPreparationDeliveryLedger({ root: stateRoot.delivery });
    const operationId = 'prepare-orphan-filename-drift';
    ledger.begin(
      operationId,
      PREPARE_DIGEST,
      digestLinuxAuthorityLaunch(launch()),
      operation(operationId)
    );
    const intentName = fs.readdirSync(stateRoot.delivery)
      .find((name) => name.endsWith('.intent'))!;
    const replacementPrefix = intentName[0] === '0' ? '1' : '0';
    const driftedName = `${replacementPrefix}${intentName.slice(1)}`;
    fs.renameSync(
      path.join(stateRoot.delivery, intentName),
      path.join(stateRoot.delivery, driftedName)
    );

    const replacement = createLinuxBrokerPreparationDeliveryLedger({ root: stateRoot.delivery });
    expect(() => replacement.discoverPendingOrphans()).toThrow(/enumerated identity differs/i);
  });

  it('rejects an unbranded ledger before constructing the bundle-owned recovery capability', () => {
    const stateRoot = roots();
    const forged = Object.freeze(Object.create(
      LinuxBrokerPreparationDeliveryLedger.prototype
    )) as LinuxBrokerPreparationDeliveryLedger;
    const input = launch();
    const context = operation('forged-delivery-recovery-ledger');
    const expectedRequest = Object.freeze({
      mode: 'broker-pidns-cgroupv2' as const,
      input,
      preparationOperationId: context.operationId,
      launchDigest: digestLinuxAuthorityLaunch(input),
    });
    const state: DeliveryTransportState = {
      prepareCalls: 0,
      recoverCalls: 0,
      acknowledgeCalls: 0,
      abortCalls: 0,
      losePrepareResponse: false,
      loseAcknowledgementResponse: false,
    };
    expect(() => bundle(
      stateRoot,
      forged,
      deliveryTransport(state, forged, expectedRequest)
    ))
      .toThrow(/ledger provenance is invalid/i);
  });

  it('forbids an external orphan callback on the branded bundle capability', async () => {
    const stateRoot = roots();
    const ledger = createLinuxBrokerPreparationDeliveryLedger({ root: stateRoot.delivery });
    const input = launch();
    const expectedRequest = Object.freeze({
      mode: 'broker-pidns-cgroupv2' as const,
      input,
      preparationOperationId: 'callback-forbidden',
      launchDigest: digestLinuxAuthorityLaunch(input),
    });
    const state: DeliveryTransportState = {
      prepareCalls: 0,
      recoverCalls: 0,
      acknowledgeCalls: 0,
      abortCalls: 0,
      losePrepareResponse: false,
      loseAcknowledgementResponse: false,
    };
    const recovery = bundle(
      stateRoot,
      ledger,
      deliveryTransport(state, ledger, expectedRequest)
    ).preparationDeliveryRecovery!;
    await expect((recovery.reconcileOrphans as unknown as (
      context: AuthorityOperationContext,
      callback: () => void
    ) => Promise<unknown>)(Object.freeze({
      phase: 'inspect',
      operationId: 'callback-forbidden-reconciliation',
      deadline: performance.now() + 10_000,
      signal: new AbortController().signal,
    }), () => {})).rejects.toThrow(/forbids external callbacks/i);
    expect(state).toMatchObject({ recoverCalls: 0, acknowledgeCalls: 0, abortCalls: 0 });
  });

  it('bounds the pending orphan frontier and stops before invoking reconciliation', async () => {
    const stateRoot = roots();
    const ledger = createLinuxBrokerPreparationDeliveryLedger({ root: stateRoot.delivery });
    const input = launch();
    const launchDigest = digestLinuxAuthorityLaunch(input);
    for (let index = 0; index < 65; index += 1) {
      const operationId = `prepare-orphan-capacity-${index}`;
      ledger.begin(
        operationId,
        PREPARE_DIGEST,
        launchDigest,
        operation(operationId)
      );
    }
    const expectedRequest = Object.freeze({
      mode: 'broker-pidns-cgroupv2' as const,
      input,
      preparationOperationId: 'unused-bounded-orphan-request',
      launchDigest,
    });
    const state: DeliveryTransportState = {
      prepareCalls: 0,
      recoverCalls: 0,
      acknowledgeCalls: 0,
      abortCalls: 0,
      losePrepareResponse: false,
      loseAcknowledgementResponse: false,
    };
    const recovery = bundle(
      stateRoot,
      ledger,
      deliveryTransport(state, ledger, expectedRequest)
    ).preparationDeliveryRecovery!;
    await expect(recovery.reconcileOrphans(Object.freeze({
      phase: 'inspect',
      operationId: 'bounded-orphan-reconciliation',
      deadline: performance.now() + 10_000,
      signal: new AbortController().signal,
    }))).rejects.toThrow(/orphan enumeration exceeds its bound/i);
    expect(state).toMatchObject({ recoverCalls: 0, acknowledgeCalls: 0, abortCalls: 0 });
  }, 20_000);

  it('does not invoke orphan reconciliation after cancellation', async () => {
    const stateRoot = roots();
    const ledger = createLinuxBrokerPreparationDeliveryLedger({ root: stateRoot.delivery });
    const operationId = 'prepare-orphan-cancelled';
    const input = launch();
    const launchDigest = digestLinuxAuthorityLaunch(input);
    ledger.begin(
      operationId,
      PREPARE_DIGEST,
      launchDigest,
      operation(operationId)
    );
    const expectedRequest = Object.freeze({
      mode: 'broker-pidns-cgroupv2' as const,
      input,
      preparationOperationId: operationId,
      launchDigest,
    });
    const state: DeliveryTransportState = {
      prepareCalls: 0,
      recoverCalls: 0,
      acknowledgeCalls: 0,
      abortCalls: 0,
      losePrepareResponse: false,
      loseAcknowledgementResponse: false,
    };
    const recovery = bundle(
      stateRoot,
      ledger,
      deliveryTransport(state, ledger, expectedRequest)
    ).preparationDeliveryRecovery!;
    const controller = new AbortController();
    controller.abort();
    await expect(recovery.reconcileOrphans(Object.freeze({
      phase: 'inspect',
      operationId: 'cancelled-orphan-reconciliation',
      deadline: performance.now() + 10_000,
      signal: controller.signal,
    }))).rejects.toThrow(/expired or was cancelled/i);
    expect(state).toMatchObject({ recoverCalls: 0, acknowledgeCalls: 0, abortCalls: 0 });
  });

  it('does not invoke orphan reconciliation after its exact deadline', async () => {
    const stateRoot = roots();
    const ledger = createLinuxBrokerPreparationDeliveryLedger({ root: stateRoot.delivery });
    const input = launch();
    const operationId = 'prepare-orphan-deadline';
    const expectedRequest = Object.freeze({
      mode: 'broker-pidns-cgroupv2' as const,
      input,
      preparationOperationId: operationId,
      launchDigest: digestLinuxAuthorityLaunch(input),
    });
    ledger.begin(
      operationId,
      PREPARE_DIGEST,
      expectedRequest.launchDigest,
      operation(operationId)
    );
    const state: DeliveryTransportState = {
      prepareCalls: 0,
      recoverCalls: 0,
      acknowledgeCalls: 0,
      abortCalls: 0,
      losePrepareResponse: false,
      loseAcknowledgementResponse: false,
    };
    const recovery = bundle(
      stateRoot,
      ledger,
      deliveryTransport(state, ledger, expectedRequest)
    ).preparationDeliveryRecovery!;
    await expect(recovery.reconcileOrphans(Object.freeze({
      phase: 'inspect',
      operationId: 'expired-orphan-reconciliation',
      deadline: Math.max(1, performance.now() - 1),
      signal: new AbortController().signal,
    }))).rejects.toThrow(/expired or was cancelled/i);
    expect(state).toMatchObject({ recoverCalls: 0, acknowledgeCalls: 0, abortCalls: 0 });
  });

  it('exactly aborts and durably reconciles an orphan whose recovered identity mismatches', async () => {
    const stateRoot = roots();
    const ledger = createLinuxBrokerPreparationDeliveryLedger({ root: stateRoot.delivery });
    const input = launch();
    const operationId = 'prepare-orphan-identity-mismatch';
    const expectedRequest = Object.freeze({
      mode: 'broker-pidns-cgroupv2' as const,
      input,
      preparationOperationId: operationId,
      launchDigest: digestLinuxAuthorityLaunch(input),
    });
    ledger.begin(
      operationId,
      PREPARE_DIGEST,
      expectedRequest.launchDigest,
      operation(operationId)
    );
    const state: DeliveryTransportState = {
      prepareCalls: 0,
      recoverCalls: 0,
      acknowledgeCalls: 0,
      abortCalls: 0,
      losePrepareResponse: false,
      loseAcknowledgementResponse: false,
    };
    const base = deliveryTransport(state, ledger, expectedRequest);
    const transport: LinuxAuthorityNativeTransport = Object.freeze({
      ...base,
      async recoverPreparedDelivery() {
        state.recoverCalls += 1;
        return brokerAttestation(Object.freeze({
          ...expectedRequest,
          preparationOperationId: 'different-recovered-operation',
        }));
      },
    });
    const recovery = bundle(stateRoot, ledger, transport).preparationDeliveryRecovery!;
    await expect(recovery.reconcileOrphans(Object.freeze({
      phase: 'inspect',
      operationId: 'identity-mismatch-reconciliation',
      deadline: performance.now() + 10_000,
      signal: new AbortController().signal,
    }))).resolves.toMatchObject({
      visited: 1,
      acknowledged: 0,
      reconciled: 1,
      retained: 0,
      entries: [{
        preparationOperationId: operationId,
        initialState: 'Intent',
        disposition: 'reconciled',
      }],
    });
    expect(state).toMatchObject({ recoverCalls: 1, acknowledgeCalls: 0, abortCalls: 1 });
    expect(ledger.begin(
      operationId,
      PREPARE_DIGEST,
      expectedRequest.launchDigest,
      operation(operationId)
    )).toMatchObject({
      state: 'Reconciled',
      reconciledDisposition: 'exact-scope-empty',
    });
    expect(ledger.discoverPendingOrphans()).toEqual([]);
  });

  it('retains an inexact abort and blocks a logically new operation before creating its intent', async () => {
    const stateRoot = roots();
    const ledger = createLinuxBrokerPreparationDeliveryLedger({ root: stateRoot.delivery });
    const input = launch();
    const oldOperationId = 'prepare-orphan-abort-retained';
    const oldRequest = Object.freeze({
      mode: 'broker-pidns-cgroupv2' as const,
      input,
      preparationOperationId: oldOperationId,
      launchDigest: digestLinuxAuthorityLaunch(input),
    });
    ledger.begin(
      oldOperationId,
      PREPARE_DIGEST,
      oldRequest.launchDigest,
      operation(oldOperationId)
    );
    const state: DeliveryTransportState = {
      prepareCalls: 0,
      recoverCalls: 0,
      acknowledgeCalls: 0,
      abortCalls: 0,
      losePrepareResponse: false,
      loseAcknowledgementResponse: false,
      abortOutcome: { state: 'authority-uncertain', diagnosticCode: 'native-uncertain' },
    };
    const base = deliveryTransport(state, ledger, oldRequest);
    const transport: LinuxAuthorityNativeTransport = Object.freeze({
      ...base,
      async recoverPreparedDelivery() {
        state.recoverCalls += 1;
        return { state: 'authority-unavailable', diagnosticCode: 'prepare-unavailable' };
      },
    });
    const brokerBundle = bundle(stateRoot, ledger, transport);
    const recovery = brokerBundle.preparationDeliveryRecovery!;
    await expect(recovery.reconcileOrphans(Object.freeze({
      phase: 'inspect',
      operationId: 'retained-abort-reconciliation',
      deadline: performance.now() + 10_000,
      signal: new AbortController().signal,
    }))).resolves.toMatchObject({
      visited: 1,
      acknowledged: 0,
      reconciled: 0,
      retained: 1,
      entries: [{
        preparationOperationId: oldOperationId,
        disposition: 'retained',
        retainedState: 'authority-uncertain',
      }],
    });
    expect(ledger.discoverPendingOrphans()).toHaveLength(1);

    const namesBefore = fs.readdirSync(stateRoot.delivery).sort();
    await expect(brokerBundle.provider.prepare(
      input,
      operation('prepare-logically-new-while-orphan-retained')
    )).rejects.toThrow(/retains unresolved prior ownership/i);
    expect(fs.readdirSync(stateRoot.delivery).sort()).toEqual(namesBefore);
    expect(state).toMatchObject({ recoverCalls: 2, acknowledgeCalls: 0, abortCalls: 2 });
  });

  it('pins the trusted delivery root identity across controller replacement', () => {
    const stateRoot = roots();
    const ledger = createLinuxBrokerPreparationDeliveryLedger({ root: stateRoot.delivery });
    const moved = `${stateRoot.delivery}-original`;
    fs.renameSync(stateRoot.delivery, moved);
    fs.mkdirSync(stateRoot.delivery, { mode: 0o700 });

    expect(() => ledger.begin(
      'prepare-replaced-delivery-root',
      PREPARE_DIGEST,
      digestLinuxAuthorityLaunch(launch()),
      operation('prepare-replaced-delivery-root')
    )).toThrow(/root identity changed/i);
  });

  it('compares delivery root inode identities without unsafe-number truncation', () => {
    const stateRoot = roots();
    fs.mkdirSync(stateRoot.delivery, { mode: 0o700 });
    const trustedRoot = fs.realpathSync.native(stateRoot.delivery);
    const originalLstat = fs.lstatSync.bind(fs);
    const initialInode = 1n << 54n;
    const replacementInode = initialInode + 1n;
    let rootReads = 0;
    const lstat = vi.spyOn(fs, 'lstatSync').mockImplementation(((target, options) => {
      const stat = options === undefined
        ? originalLstat(target)
        : originalLstat(target, options);
      if (typeof target !== 'string' || path.resolve(target) !== trustedRoot) return stat;
      const inode = rootReads++ === 0 ? initialInode : replacementInode;
      Object.defineProperty(stat, 'ino', {
        configurable: true,
        value: typeof stat.ino === 'bigint' ? inode : Number(inode),
      });
      return stat;
    }) as typeof fs.lstatSync);
    try {
      const ledger = createLinuxBrokerPreparationDeliveryLedger({ root: stateRoot.delivery });
      expect(() => ledger.discoverPendingOrphans()).toThrow(/root identity changed/i);
    } finally {
      lstat.mockRestore();
    }
  });
});
