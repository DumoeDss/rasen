import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  createProcessAuthorityCoordinator,
  createProcessAuthorityPublicationAcknowledgement,
  createProviderBackedProcessScope,
  isExactScopeEmptyReceipt,
  type AuthorityOperationContext,
  type ProcessAuthorityLifecycleOutcome,
  type ProcessAuthorityProvider,
  type ProcessAuthorityProviderDescriptor,
  type ProviderAuthorityReference,
  type ProviderControlOutcome,
  type ProviderObservation,
} from '../../../src/core/session-host/process-authority/index.js';
import { createProviderAuthorityReference } from '../../../src/core/session-host/process-authority/reference-codec.js';
import { asProcessRef, ProcessScopeError } from '../../../src/core/session-host/process-scope.js';
import { createTestProcessAuthorityProviderRegistry } from '../../helpers/process-authority-test-registry.js';

const descriptor: ProcessAuthorityProviderDescriptor = {
  providerId: 'test.process-scope-adapter',
  capabilityId: RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  protocolVersion: 1,
  commonContractVersion: PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  providerReferenceVersion: 1,
  semantics: RECURSIVE_PROCESS_SCOPE_SEMANTICS,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

class AdapterProvider implements ProcessAuthorityProvider {
  readonly descriptor = descriptor;
  readonly reference: ProviderAuthorityReference = createProviderAuthorityReference(
    1,
    Buffer.from('adapter-authority')
  );
  observation: ProviderObservation = { state: 'live' };
  control: ProviderControlOutcome = { state: 'exact-scope-empty' };
  activation: ProviderObservation = { state: 'live' };
  prepareGate: Promise<void> = Promise.resolve();
  activationCalls = 0;
  abortCalls = 0;
  terminateCalls = 0;

  async prepare() {
    await this.prepareGate;
    return {
      reference: this.reference,
      activate: async (_context: AuthorityOperationContext) => {
        this.activationCalls += 1;
        return this.activation;
      },
    };
  }

  async inspect() { return this.observation; }
  async terminate() {
    this.terminateCalls += 1;
    return this.control;
  }
  async abort() {
    this.abortCalls += 1;
    return this.control;
  }
}

function fixture() {
  const provider = new AdapterProvider();
  let operation = 0;
  const coordinator = createProcessAuthorityCoordinator({
    registry: createTestProcessAuthorityProviderRegistry([provider]),
    operationId: () => `adapter-${++operation}`,
  });
  const rootExited = deferred<ProcessAuthorityLifecycleOutcome>();
  const exactScopeEmpty = deferred<ProcessAuthorityLifecycleOutcome>();
  let publications = 0;
  const scope = createProviderBackedProcessScope({
    coordinator,
    selection: descriptor,
    async publishAuthority(binding) {
      publications += 1;
      return createProcessAuthorityPublicationAcknowledgement(binding);
    },
    openRuntime() {
      return {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        rootExited: rootExited.promise,
        exactScopeEmpty: exactScopeEmpty.promise,
      };
    },
  });
  return { provider, scope, rootExited, exactScopeEmpty, publications: () => publications };
}

describe('opt-in provider-backed ProcessScope compatibility', () => {
  it('publishes before activation and exposes only the opaque common reference', async () => {
    const value = fixture();
    const prepared = await value.scope.prepare({
      command: 'fixture-command',
      args: [],
      cwd: 'fixture',
      env: {},
    });
    expect(String(prepared.ref)).toMatch(/^rasen-process-authority\/1:/);
    expect(JSON.stringify(prepared)).not.toMatch(/pid|pgid|job|broker|namespace|handle/i);
    expect(value.publications()).toBe(0);

    const live = await prepared.activate();
    expect(value.publications()).toBe(1);
    expect(live.ref).toBe(prepared.ref);
    expect(await value.scope.inspect(live.ref)).toEqual({ state: 'live', controllable: true });

    value.rootExited.resolve({
      state: 'root-exited',
      reference: String(live.ref) as never,
      code: 0,
      signal: null,
    });
    await expect(live.rootExited).resolves.toEqual({ state: 'root-exited', code: 0, signal: null });
  });

  it('refuses a repeated activation before any publication or provider dispatch', async () => {
    const value = fixture();
    const prepared = await value.scope.prepare({
      command: 'fixture-command',
      args: [],
      cwd: 'fixture',
      env: {},
    });

    await prepared.activate();
    expect(value.publications()).toBe(1);
    expect(value.provider.activationCalls).toBe(1);

    // Activation discipline is enforced by the adapter itself, independently of
    // the deferred publish-before-activate semantic: the second call must fail
    // before it reaches the publisher or the provider.
    await expect(prepared.activate()).rejects.toMatchObject({ code: 'activation-failed' });
    expect(value.publications()).toBe(1);
    expect(value.provider.activationCalls).toBe(1);
  });

  it('retains every non-exact common outcome and releases only a coordinator receipt', async () => {
    const value = fixture();
    const prepared = await value.scope.prepare({ command: 'fixture', args: [], cwd: '.', env: {} });
    const live = await prepared.activate();

    for (const observation of [
      { state: 'authority-unavailable', diagnostic: 'unavailable' },
      { state: 'authority-uncertain', diagnostic: 'uncertain' },
      { state: 'identity-drift', diagnostic: 'drift' },
      { state: 'event-gap', diagnostic: 'gap' },
    ] as const) {
      value.provider.observation = observation;
      const mapped = await value.scope.inspect(live.ref);
      expect(mapped.state).not.toBe('closed');
      expect(mapped.controllable).toBe(false);
    }

    value.provider.control = { state: 'authority-uncertain', diagnostic: 'not empty' };
    await expect(value.scope.terminate(live.ref, { reason: 'retain', graceMs: 0 })).resolves.toMatchObject({
      state: 'uncertain',
    });

    value.exactScopeEmpty.resolve({
      state: 'exact-scope-empty',
      reference: String(live.ref) as never,
    });
    await expect(live.closed).rejects.toBeInstanceOf(ProcessScopeError);
  });

  it('maps a provider-proven exact-empty receipt to legacy closed semantics', async () => {
    const value = fixture();
    const prepared = await value.scope.prepare({ command: 'fixture', args: [], cwd: '.', env: {} });
    const live = await prepared.activate();
    value.provider.control = { state: 'exact-scope-empty' };
    const receipt = await value.scope.terminate(live.ref, { reason: 'close', graceMs: 0 });
    expect(receipt).toMatchObject({ state: 'closed', gracefulAttempted: true });
    expect(isExactScopeEmptyReceipt(receipt.exactScopeEmptyReceipt)).toBe(true);
    expect(receipt.exactScopeEmptyReceipt?.reference).toBe(String(live.ref));
  });

  it('treats the runtime empty frame only as a wakeup and re-authenticates through the coordinator', async () => {
    const value = fixture();
    const prepared = await value.scope.prepare({ command: 'fixture', args: [], cwd: '.', env: {} });
    const live = await prepared.activate();
    value.provider.observation = { state: 'exact-scope-empty' };

    value.exactScopeEmpty.resolve({
      state: 'exact-scope-empty',
      reference: String(live.ref) as never,
    });
    const receipt = await live.closed;

    expect(receipt.state).toBe('scope-empty');
    expect(isExactScopeEmptyReceipt(receipt.exactScopeEmptyReceipt)).toBe(true);
    expect(receipt.exactScopeEmptyReceipt?.reference).toBe(String(live.ref));
  });

  it('maps null/null root status to retained uncertainty instead of legacy root exit', async () => {
    const value = fixture();
    const prepared = await value.scope.prepare({ command: 'fixture', args: [], cwd: '.', env: {} });
    const live = await prepared.activate();
    value.provider.observation = {
      state: 'root-exited',
      code: null,
      signal: null,
    } as ProviderObservation;
    await expect(value.scope.inspect(live.ref)).resolves.toMatchObject({
      state: 'uncertain',
      controllable: false,
    });
    value.provider.control = {
      state: 'root-exited',
      code: null,
      signal: null,
    } as ProviderControlOutcome;
    await expect(value.scope.terminate(live.ref, {
      reason: 'root-status-adapter',
      graceMs: 0,
    })).resolves.toMatchObject({ state: 'uncertain' });
  });

  it('retains the durable ref when activation loses authority after publication', async () => {
    const value = fixture();
    value.provider.activation = {
      state: 'control-loss',
      phase: 'activate',
      diagnostic: 'activation acknowledgement lost',
    };
    value.provider.control = {
      state: 'authority-uncertain',
      diagnostic: 'activation cleanup requires later reconciliation',
    };
    const prepared = await value.scope.prepare({ command: 'fixture', args: [], cwd: '.', env: {} });
    await expect(prepared.activate()).rejects.toMatchObject({
      code: 'process-authority-uncertain',
    });
    expect(value.publications()).toBe(1);
    expect(value.provider.terminateCalls).toBe(1);
    value.provider.observation = { state: 'authority-uncertain', diagnostic: 'reconcile later' };
    await expect(value.scope.inspect(prepared.ref)).resolves.toMatchObject({
      state: 'uncertain',
      diagnostic: 'reconcile later',
    });
  });

  it('aborts a published-inert authority when the runtime bridge cannot be opened', async () => {
    const value = fixture();
    const scope = createProviderBackedProcessScope({
      coordinator: createProcessAuthorityCoordinator({
        registry: createTestProcessAuthorityProviderRegistry([value.provider]),
        operationId: (() => {
          let operation = 0;
          return () => `broken-runtime-${++operation}`;
        })(),
      }),
      selection: descriptor,
      async publishAuthority(binding) {
        return createProcessAuthorityPublicationAcknowledgement(binding);
      },
      openRuntime() {
        throw new Error('runtime bridge unavailable');
      },
    });
    const prepared = await scope.prepare({ command: 'fixture', args: [], cwd: '.', env: {} });

    await expect(prepared.activate()).rejects.toBeInstanceOf(ProcessScopeError);
    expect(value.provider.activationCalls).toBe(0);
    expect(value.provider.abortCalls).toBe(1);
  });

  it('runs exact termination reconciliation when activation times out after bridge acquisition', async () => {
    const value = fixture();
    const scope = createProviderBackedProcessScope({
      coordinator: createProcessAuthorityCoordinator({
        registry: createTestProcessAuthorityProviderRegistry([value.provider]),
        scheduler: {
          set(_delay, callback, context) {
            if (context.phase === 'activate') callback();
            return context.operationId;
          },
          clear() {},
        },
        operationId: (() => {
          let operation = 0;
          return () => `activation-timeout-${++operation}`;
        })(),
      }),
      selection: descriptor,
      async publishAuthority(binding) {
        return createProcessAuthorityPublicationAcknowledgement(binding);
      },
      openRuntime() {
        return {
          stdin: new PassThrough(),
          stdout: new PassThrough(),
          stderr: new PassThrough(),
          rootExited: value.rootExited.promise,
          exactScopeEmpty: value.exactScopeEmpty.promise,
        };
      },
    });
    const prepared = await scope.prepare({ command: 'fixture', args: [], cwd: '.', env: {} });

    await expect(prepared.activate()).rejects.toMatchObject({ code: 'activation-failed' });
    expect(value.provider.activationCalls).toBe(0);
    expect(value.provider.terminateCalls).toBe(1);
  });

  it('preserves legacy prepare cancellation outside provider launch data', async () => {
    const value = fixture();
    value.provider.prepareGate = new Promise<void>(() => undefined);
    const controller = new AbortController();
    const preparing = value.scope.prepare({
      command: 'fixture',
      args: [],
      cwd: '.',
      env: {},
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    await expect(preparing).rejects.toMatchObject({
      code: 'process-control-lost',
      phase: 'prepare',
    });
    expect(value.publications()).toBe(0);
  });

  it('preserves legacy v1 bytes and rejects unknown legacy versions without promotion', () => {
    const legacy = 'rasen-process-scope/1:bGVnYWN5LW9wYXF1ZS1yZWY';
    expect(String(asProcessRef(legacy))).toBe(legacy);
    expect(() => asProcessRef('rasen-process-scope/2:ZnV0dXJl')).toThrow(ProcessScopeError);
    expect(() => asProcessRef('rasen-process-scope/1:cGlkPTQyO3BnaWQ9NDI')).not.toThrow();
    expect(String(asProcessRef('rasen-process-scope/1:cGlkPTQyO3BnaWQ9NDI')))
      .not.toMatch(/^rasen-process-authority/);
  });
});
