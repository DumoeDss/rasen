import { describe, expect, it, vi } from 'vitest';

import {
  PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  PROCESS_AUTHORITY_OPERATION_LEDGER_LIMIT,
  PROCESS_AUTHORITY_REFERENCE_TOMBSTONE_LIMIT,
  RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  createProcessAuthorityCoordinator,
  createProcessAuthorityPublicationAcknowledgement,
  type AuthorityOperationContext,
  type AuthorityOperationDiagnostic,
  type AuthorityOperationPhase,
  type AuthorityPrepareInput,
  type AuthorityScheduler,
  type ProcessAuthorityProvider,
  type ProcessAuthorityProviderDescriptor,
  type ProviderAuthorityReference,
  type ProviderObservation,
} from '../../../src/core/session-host/process-authority/index.js';
import { createProviderAuthorityReference } from '../../../src/core/session-host/process-authority/reference-codec.js';
import { encodeProcessAuthorityReference } from '../../../src/core/session-host/process-authority/reference-codec.js';
import { createTestProcessAuthorityProviderRegistry } from '../../helpers/process-authority-test-registry.js';

const descriptor: ProcessAuthorityProviderDescriptor = {
  providerId: 'test.deadlines',
  capabilityId: RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  protocolVersion: 1,
  commonContractVersion: PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  providerReferenceVersion: 1,
  semantics: RECURSIVE_PROCESS_SCOPE_SEMANTICS,
};

const input: AuthorityPrepareInput = {
  command: 'fixture-command',
  args: [],
  cwd: 'fixture',
  env: {},
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

function rejectable<T>() {
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((_resolve, fail) => { reject = fail; });
  return { promise, reject };
}

class DeadlineProvider implements ProcessAuthorityProvider {
  readonly descriptor = descriptor;
  readonly providerReference: ProviderAuthorityReference = createProviderAuthorityReference(
    1,
    Buffer.from('deadline-authority')
  );
  observation: Promise<ProviderObservation> = Promise.resolve({ state: 'live' });
  activation: Promise<ProviderObservation> = Promise.resolve({ state: 'live' });
  termination: Promise<import('../../../src/core/session-host/process-authority/index.js').ProviderControlOutcome> =
    Promise.resolve({ state: 'exact-scope-empty' });
  abortion: Promise<import('../../../src/core/session-host/process-authority/index.js').ProviderControlOutcome> =
    Promise.resolve({ state: 'exact-scope-empty' });
  starts = 0;
  preparationGeneration = 0;
  inspectCalls = 0;
  terminateCalls = 0;
  prepareOverride: (() => Promise<{
    readonly reference: ProviderAuthorityReference;
    readonly activate: () => Promise<ProviderObservation>;
  }>) | undefined;

  async prepare(_input: AuthorityPrepareInput, _context: AuthorityOperationContext) {
    this.starts += 1;
    if (this.prepareOverride) return this.prepareOverride();
    this.preparationGeneration += 1;
    return {
      reference: createProviderAuthorityReference(
        1,
        Buffer.from(`deadline-authority-${this.preparationGeneration}`)
      ),
      activate: async () => this.activation,
    };
  }

  async inspect() {
    this.inspectCalls += 1;
    return this.observation;
  }

  async terminate() {
    this.terminateCalls += 1;
    return this.termination;
  }

  async abort() {
    return this.abortion;
  }
}

function passiveScheduler(phases: AuthorityOperationPhase[] = []): AuthorityScheduler {
  return {
    set(_delayMs, _onElapsed, context) {
      phases.push(context.phase);
      return Symbol(context.phase);
    },
    clear() {},
  };
}

async function published(
  provider: DeadlineProvider,
  options: Parameters<typeof createProcessAuthorityCoordinator>[0] = {}
) {
  let operation = 0;
  const coordinator = createProcessAuthorityCoordinator({
    registry: createTestProcessAuthorityProviderRegistry([provider]),
    scheduler: passiveScheduler(),
    operationId: () => `deadline-${++operation}`,
    operationTimeoutMs: 100,
    ...options,
  });
  const prepared = await coordinator.prepare(descriptor, input);
  if (prepared.state !== 'prepared-inert') throw new Error('expected prepared authority');
  const authority = await prepared.publish(async (binding) =>
    createProcessAuthorityPublicationAcknowledgement(binding)
  );
  if (authority.state !== 'published-inert') throw new Error('expected published authority');
  return { coordinator, prepared, authority };
}

describe('process-authority bounded operations', () => {
  it('clears the real token and never starts work when a scheduler expires synchronously', async () => {
    const provider = new DeadlineProvider();
    const token = Object.freeze({ timer: 'synchronous' });
    const cleared: unknown[] = [];
    const scheduler: AuthorityScheduler = {
      set(_delayMs, onElapsed) {
        onElapsed();
        return token;
      },
      clear(value) {
        cleared.push(value);
      },
    };
    const coordinator = createProcessAuthorityCoordinator({
      registry: createTestProcessAuthorityProviderRegistry([provider]),
      scheduler,
      clock: { now: () => 10 },
      operationId: () => 'synchronous-timeout',
      operationTimeoutMs: 5,
    });

    await expect(coordinator.prepare(descriptor, input)).resolves.toMatchObject({
      state: 'timeout',
      phase: 'prepare',
      diagnostic: expect.stringContaining('deadline'),
    });
    await Promise.resolve();
    expect(provider.starts).toBe(0);
    expect(cleared).toEqual([token]);
  });

  it('does not install a caller-abort listener after synchronous settlement', async () => {
    const provider = new DeadlineProvider();
    const scheduler: AuthorityScheduler = {
      set(_delayMs, onElapsed, context) {
        if (context.phase === 'inspect') onElapsed();
        return context.operationId;
      },
      clear() {},
    };
    const fixture = await published(provider, { scheduler });
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');

    await expect(
      fixture.coordinator.inspect(fixture.prepared.reference, controller.signal)
    ).resolves.toMatchObject({ state: 'timeout', phase: 'inspect' });
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('assigns independent phase identities to every bounded operation', async () => {
    const phases: AuthorityOperationPhase[] = [];
    const provider = new DeadlineProvider();
    let operation = 0;
    const coordinator = createProcessAuthorityCoordinator({
      registry: createTestProcessAuthorityProviderRegistry([provider]),
      scheduler: passiveScheduler(phases),
      operationId: () => `phase-${++operation}`,
      operationTimeoutMs: 100,
    });
    const prepared = await coordinator.prepare(descriptor, input);
    if (prepared.state !== 'prepared-inert') throw new Error('expected prepared authority');
    const publishedAuthority = await prepared.publish(async (binding) =>
      createProcessAuthorityPublicationAcknowledgement(binding)
    );
    if (publishedAuthority.state !== 'published-inert') throw new Error('expected published');
    await publishedAuthority.activate();
    await coordinator.inspect(prepared.reference);
    await coordinator.observeExactScopeEmpty(prepared.reference);
    await coordinator.terminate(prepared.reference, { reason: 'phase-proof', graceMs: 0 });

    const second = await coordinator.prepare(descriptor, input);
    if (second.state !== 'prepared-inert') throw new Error('expected second prepared authority');
    await second.abort('phase-proof');

    expect(phases).toEqual([
      'prepare',
      'publish',
      'activate',
      'inspect',
      'exact-empty-observation',
      'terminate',
      'prepare',
      'abort',
    ]);
  });

  it('bounds the actual trusted publication callback and aborts its signal on timeout', async () => {
    const provider = new DeadlineProvider();
    const elapsed = new Map<AuthorityOperationPhase, () => void>();
    const coordinator = createProcessAuthorityCoordinator({
      registry: createTestProcessAuthorityProviderRegistry([provider]),
      scheduler: {
        set(_delay, callback, context) {
          elapsed.set(context.phase, callback);
          return context.operationId;
        },
        clear() {},
      },
      operationId: (() => {
        let operation = 0;
        return () => `publish-deadline-${++operation}`;
      })(),
    });
    const prepared = await coordinator.prepare(descriptor, input);
    if (prepared.state !== 'prepared-inert') throw new Error('expected prepared authority');
    let publicationSignal: AbortSignal | undefined;
    const publishing = prepared.publish(async (_binding, context) => {
      publicationSignal = context.signal;
      return new Promise(() => undefined);
    });
    await Promise.resolve();
    await Promise.resolve();
    elapsed.get('publish')?.();

    await expect(publishing).resolves.toMatchObject({ state: 'timeout', phase: 'publish' });
    expect(publicationSignal?.aborted).toBe(true);
  });

  it('quarantines a provider result delivered after timeout', async () => {
    const provider = new DeadlineProvider();
    const late = deferred<ProviderObservation>();
    provider.observation = late.promise;
    const timers: Array<() => void> = [];
    const diagnostics: AuthorityOperationDiagnostic[] = [];
    const scheduler: AuthorityScheduler = {
      set(_delayMs, onElapsed) {
        timers.push(onElapsed);
        return timers.length;
      },
      clear() {},
    };
    const fixture = await published(provider, {
      scheduler,
      onDiagnostic(diagnostic) {
        diagnostics.push(diagnostic);
        throw new Error('diagnostic observer must not affect settlement');
      },
    });

    const observation = fixture.coordinator.inspect(fixture.prepared.reference);
    await Promise.resolve();
    timers.at(-1)?.();
    await expect(observation).resolves.toMatchObject({
      state: 'timeout',
      reference: fixture.prepared.reference,
      phase: 'inspect',
    });
    late.resolve({ state: 'exact-scope-empty' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(diagnostics.some(
      (diagnostic) => diagnostic.kind === 'late-settlement' && diagnostic.phase === 'inspect'
    )).toBe(true);

    provider.observation = Promise.resolve({ state: 'live' });
    await expect(fixture.coordinator.inspect(fixture.prepared.reference)).resolves.toEqual({
      state: 'live',
      reference: fixture.prepared.reference,
    });
  });

  it('rejects settlement past the monotonic deadline when the scheduler callback is delayed', async () => {
    const provider = new DeadlineProvider();
    const observation = deferred<ProviderObservation>();
    provider.observation = observation.promise;
    let now = 1_000;
    const fixture = await published(provider, {
      clock: { now: () => now },
      scheduler: passiveScheduler(),
      operationTimeoutMs: 100,
    });

    const pending = fixture.coordinator.inspect(fixture.prepared.reference);
    await Promise.resolve();
    await Promise.resolve();
    now = 1_101;
    observation.resolve({ state: 'live' });

    await expect(pending).resolves.toMatchObject({
      state: 'timeout',
      phase: 'inspect',
      reference: fixture.prepared.reference,
    });
  });

  it.each([
    'prepare',
    'publish',
    'activate',
    'inspect',
    'terminate',
    'abort',
    'exact-empty-observation',
  ] as const)(
    'enforces the monotonic deadline at %s settlement even when its timer is withheld',
    async (phase) => {
      const provider = new DeadlineProvider();
      let now = 100;
      let operation = 0;
      const coordinator = createProcessAuthorityCoordinator({
        registry: createTestProcessAuthorityProviderRegistry([provider]),
        clock: { now: () => now },
        scheduler: passiveScheduler(),
        operationId: () => `monotonic-${phase}-${++operation}`,
        operationTimeoutMs: 10,
      });

      if (phase === 'prepare') {
        const gate = deferred<Awaited<ReturnType<DeadlineProvider['prepare']>>>();
        provider.prepareOverride = async () => gate.promise;
        const pending = coordinator.prepare(descriptor, input);
        await Promise.resolve();
        await Promise.resolve();
        now = 111;
        gate.resolve({
          reference: provider.providerReference,
          activate: async () => ({ state: 'live' }),
        });
        await expect(pending).resolves.toMatchObject({ state: 'timeout', phase });
        return;
      }

      const prepared = await coordinator.prepare(descriptor, input);
      if (prepared.state !== 'prepared-inert') throw new Error('expected prepared authority');
      if (phase === 'abort') {
        const gate = deferred<import('../../../src/core/session-host/process-authority/index.js').ProviderControlOutcome>();
        provider.abortion = gate.promise;
        const pending = prepared.abort('monotonic-deadline');
        await Promise.resolve();
        now = 111;
        gate.resolve({ state: 'exact-scope-empty' });
        await expect(pending).resolves.toMatchObject({ state: 'timeout', phase });
        return;
      }

      if (phase === 'publish') {
        const gate = deferred<ReturnType<typeof createProcessAuthorityPublicationAcknowledgement>>();
        const pending = prepared.publish(async () => gate.promise);
        await Promise.resolve();
        now = 111;
        gate.resolve(createProcessAuthorityPublicationAcknowledgement(prepared.publicationBinding));
        await expect(pending).resolves.toMatchObject({ state: 'timeout', phase });
        return;
      }

      const publishedAuthority = await prepared.publish(async (binding) =>
        createProcessAuthorityPublicationAcknowledgement(binding)
      );
      if (publishedAuthority.state !== 'published-inert') throw new Error('expected published authority');
      let pending: Promise<unknown>;
      let release: () => void;
      if (phase === 'activate') {
        const gate = deferred<ProviderObservation>();
        provider.activation = gate.promise;
        pending = publishedAuthority.activate();
        release = () => gate.resolve({ state: 'live' });
      } else if (phase === 'terminate') {
        const gate = deferred<import('../../../src/core/session-host/process-authority/index.js').ProviderControlOutcome>();
        provider.termination = gate.promise;
        pending = coordinator.terminate(prepared.reference, {
          reason: 'monotonic-deadline',
          graceMs: 0,
        });
        release = () => gate.resolve({ state: 'exact-scope-empty' });
      } else {
        const gate = deferred<ProviderObservation>();
        provider.observation = gate.promise;
        pending = phase === 'inspect'
          ? coordinator.inspect(prepared.reference)
          : coordinator.observeExactScopeEmpty(prepared.reference);
        release = () => gate.resolve({ state: 'exact-scope-empty' });
      }
      await Promise.resolve();
      now = 111;
      release();
      await expect(pending).resolves.toMatchObject({ state: 'timeout', phase });
    }
  );

  it.each([
    'prepare',
    'publish',
    'activate',
    'inspect',
    'terminate',
    'abort',
    'exact-empty-observation',
  ] as const)(
    'turns a rejected %s settlement at or after its monotonic deadline into timeout',
    async (phase) => {
      const provider = new DeadlineProvider();
      let now = 100;
      let operation = 0;
      const coordinator = createProcessAuthorityCoordinator({
        registry: createTestProcessAuthorityProviderRegistry([provider]),
        clock: { now: () => now },
        scheduler: passiveScheduler(),
        operationId: () => `monotonic-rejection-${phase}-${++operation}`,
        operationTimeoutMs: 10,
      });

      if (phase === 'prepare') {
        const gate = rejectable<Awaited<ReturnType<DeadlineProvider['prepare']>>>();
        provider.prepareOverride = async () => gate.promise;
        const pending = coordinator.prepare(descriptor, input);
        await Promise.resolve();
        now = 111;
        gate.reject(new Error('late prepare rejection'));
        await expect(pending).resolves.toMatchObject({ state: 'timeout', phase });
        return;
      }

      const prepared = await coordinator.prepare(descriptor, input);
      if (prepared.state !== 'prepared-inert') throw new Error('expected prepared authority');
      if (phase === 'publish') {
        const gate = rejectable<ReturnType<typeof createProcessAuthorityPublicationAcknowledgement>>();
        const pending = prepared.publish(async () => gate.promise);
        await Promise.resolve();
        now = 111;
        gate.reject(new Error('late publish rejection'));
        await expect(pending).resolves.toMatchObject({ state: 'timeout', phase });
        return;
      }
      if (phase === 'abort') {
        const gate = rejectable<import('../../../src/core/session-host/process-authority/index.js').ProviderControlOutcome>();
        provider.abortion = gate.promise;
        const pending = prepared.abort('late rejection');
        await Promise.resolve();
        now = 111;
        gate.reject(new Error('late abort rejection'));
        await expect(pending).resolves.toMatchObject({ state: 'timeout', phase });
        return;
      }

      const publishedAuthority = await prepared.publish(async (binding) =>
        createProcessAuthorityPublicationAcknowledgement(binding)
      );
      if (publishedAuthority.state !== 'published-inert') throw new Error('expected published');
      let pending: Promise<unknown>;
      let reject: () => void;
      if (phase === 'activate') {
        const gate = rejectable<ProviderObservation>();
        provider.activation = gate.promise;
        pending = publishedAuthority.activate();
        reject = () => gate.reject(new Error('late activate rejection'));
      } else if (phase === 'terminate') {
        const gate = rejectable<import('../../../src/core/session-host/process-authority/index.js').ProviderControlOutcome>();
        provider.termination = gate.promise;
        pending = coordinator.terminate(prepared.reference, {
          reason: 'late-rejection',
          graceMs: 0,
        });
        reject = () => gate.reject(new Error('late terminate rejection'));
      } else {
        const gate = rejectable<ProviderObservation>();
        provider.observation = gate.promise;
        pending = phase === 'inspect'
          ? coordinator.inspect(prepared.reference)
          : coordinator.observeExactScopeEmpty(prepared.reference);
        reject = () => gate.reject(new Error('late observation rejection'));
      }
      await Promise.resolve();
      now = 111;
      reject();
      await expect(pending).resolves.toMatchObject({ state: 'timeout', phase });
    }
  );

  it.each([
    'activate',
    'inspect',
    'terminate',
    'abort',
    'exact-empty-observation',
  ] as const)('quarantines a late exact-empty result from %s', async (phase) => {
    const provider = new DeadlineProvider();
    const late = deferred<
      ProviderObservation | import('../../../src/core/session-host/process-authority/index.js').ProviderControlOutcome
    >();
    const elapsed = new Map<AuthorityOperationPhase, () => void>();
    const diagnostics: AuthorityOperationDiagnostic[] = [];
    const scheduler: AuthorityScheduler = {
      set(_delay, callback, context) {
        elapsed.set(context.phase, callback);
        return context.operationId;
      },
      clear() {},
    };
    let operation = 0;
    const coordinator = createProcessAuthorityCoordinator({
      registry: createTestProcessAuthorityProviderRegistry([provider]),
      scheduler,
      operationId: () => `late-${phase}-${++operation}`,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const prepared = await coordinator.prepare(descriptor, input);
    if (prepared.state !== 'prepared-inert') throw new Error('expected prepared authority');
    let operationResult: Promise<unknown>;
    if (phase === 'abort') {
      provider.abortion = late.promise as Promise<
        import('../../../src/core/session-host/process-authority/index.js').ProviderControlOutcome
      >;
      operationResult = prepared.abort('late-abort');
    } else {
      const publishedAuthority = await prepared.publish(async (binding) =>
        createProcessAuthorityPublicationAcknowledgement(binding)
      );
      if (publishedAuthority.state !== 'published-inert') throw new Error('expected published');
      if (phase === 'activate') {
        provider.activation = late.promise as Promise<ProviderObservation>;
        operationResult = publishedAuthority.activate();
      } else if (phase === 'inspect') {
        provider.observation = late.promise as Promise<ProviderObservation>;
        operationResult = coordinator.inspect(prepared.reference);
      } else if (phase === 'terminate') {
        provider.termination = late.promise as Promise<
          import('../../../src/core/session-host/process-authority/index.js').ProviderControlOutcome
        >;
        operationResult = coordinator.terminate(prepared.reference, {
          reason: 'late-terminate',
          graceMs: 0,
        });
      } else {
        provider.observation = late.promise as Promise<ProviderObservation>;
        operationResult = coordinator.observeExactScopeEmpty(prepared.reference);
      }
    }
    await Promise.resolve();
    await Promise.resolve();
    elapsed.get(phase)?.();
    await expect(operationResult).resolves.toMatchObject({ state: 'timeout', phase });
    late.resolve({ state: 'exact-scope-empty' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(diagnostics.some(
      (diagnostic) => diagnostic.kind === 'late-settlement' && diagnostic.phase === phase
    )).toBe(true);
  });

  it('maps provider exceptions and caller cancellation to bounded control loss', async () => {
    const provider = new DeadlineProvider();
    const fixture = await published(provider);
    provider.observation = Promise.reject(new Error('channel closed'));
    await expect(fixture.coordinator.inspect(fixture.prepared.reference)).resolves.toMatchObject({
      state: 'control-loss',
      reference: fixture.prepared.reference,
      phase: 'inspect',
    });

    const controller = new AbortController();
    const pending = deferred<ProviderObservation>();
    provider.observation = pending.promise;
    const cancelled = fixture.coordinator.inspect(fixture.prepared.reference, controller.signal);
    controller.abort();
    await expect(cancelled).resolves.toMatchObject({
      state: 'control-loss',
      reference: fixture.prepared.reference,
      phase: 'inspect',
      diagnostic: expect.stringContaining('cancelled'),
    });
    pending.resolve({ state: 'live' });
  });

  it('cancels prepare without adding AbortSignal to provider-owned launch data', async () => {
    const provider = new DeadlineProvider();
    const preparation = deferred<Awaited<ReturnType<DeadlineProvider['prepare']>>>();
    let receivedInput: AuthorityPrepareInput | undefined;
    provider.prepare = async (value) => {
      receivedInput = value;
      return preparation.promise;
    };
    const controller = new AbortController();
    const coordinator = createProcessAuthorityCoordinator({
      registry: createTestProcessAuthorityProviderRegistry([provider]),
      scheduler: passiveScheduler(),
      operationId: () => 'cancelled-prepare',
    });

    const pending = coordinator.prepare(descriptor, input, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(pending).resolves.toMatchObject({
      state: 'control-loss',
      phase: 'prepare',
      diagnostic: expect.stringContaining('cancelled'),
    });
    expect(receivedInput).toEqual(input);
    expect('signal' in (receivedInput ?? {})).toBe(false);
    preparation.resolve({
      reference: provider.providerReference,
      activate: async () => ({ state: 'live' }),
    });
  });

  it('quarantines an inert preparation delivered after its prepare deadline', async () => {
    const provider = new DeadlineProvider();
    const preparation = deferred<Awaited<ReturnType<DeadlineProvider['prepare']>>>();
    provider.prepare = async () => preparation.promise;
    let elapsed: (() => void) | undefined;
    const diagnostics: AuthorityOperationDiagnostic[] = [];
    const coordinator = createProcessAuthorityCoordinator({
      registry: createTestProcessAuthorityProviderRegistry([provider]),
      scheduler: {
        set(_delay, callback, context) {
          if (context.phase === 'prepare') elapsed = callback;
          return context.operationId;
        },
        clear() {},
      },
      operationId: () => 'late-prepare',
      onDiagnostic: (diagnostic) => { diagnostics.push(diagnostic); },
    });
    const result = coordinator.prepare(descriptor, input);
    await Promise.resolve();
    await Promise.resolve();
    elapsed?.();
    await expect(result).resolves.toMatchObject({ state: 'timeout', phase: 'prepare' });
    preparation.resolve({
      reference: provider.providerReference,
      activate: async () => ({ state: 'live' }),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(diagnostics.some(
      (diagnostic) => diagnostic.kind === 'late-settlement' && diagnostic.phase === 'prepare'
    )).toBe(true);
  });

  it('faults closed when an operation id is reused for the same or a conflicting phase', async () => {
    const provider = new DeadlineProvider();
    const ids = ['prepare-id', 'publish-id', 'shared-id', 'shared-id', 'shared-id'];
    const fixture = await published(provider, {
      operationId: () => ids.shift() ?? 'unique-id',
    });

    const first = await fixture.coordinator.inspect(fixture.prepared.reference);
    const duplicate = await fixture.coordinator.inspect(fixture.prepared.reference);
    expect(first).toEqual({ state: 'live', reference: fixture.prepared.reference });
    expect(duplicate).toMatchObject({
      state: 'control-loss',
      phase: 'inspect',
      reference: fixture.prepared.reference,
    });
    expect(provider.inspectCalls).toBe(1);

    await expect(
      fixture.coordinator.terminate(fixture.prepared.reference, {
        reason: 'conflicting-phase',
        graceMs: 0,
      })
    ).resolves.toMatchObject({
      state: 'control-loss',
      phase: 'terminate',
      reference: fixture.prepared.reference,
    });
  });

  it('reserves an operation id before concurrent same-identity provider dispatch', async () => {
    const provider = new DeadlineProvider();
    const gate = deferred<ProviderObservation>();
    provider.observation = gate.promise;
    const ids = ['prepare-id', 'publish-id', 'shared-in-flight', 'shared-in-flight'];
    const diagnostics: AuthorityOperationDiagnostic[] = [];
    const fixture = await published(provider, {
      operationId: () => ids.shift() ?? 'unique-id',
      onDiagnostic(diagnostic) {
        diagnostics.push(diagnostic);
        throw new Error('operation-id diagnostic observer must remain isolated');
      },
    });

    const first = fixture.coordinator.inspect(fixture.prepared.reference);
    await Promise.resolve();
    await Promise.resolve();
    const duplicate = fixture.coordinator.inspect(fixture.prepared.reference);
    await Promise.resolve();
    await Promise.resolve();
    const callsBeforeSettlement = provider.inspectCalls;
    gate.resolve({ state: 'live' });

    await expect(duplicate).resolves.toMatchObject({
      state: 'control-loss',
      phase: 'inspect',
      reference: fixture.prepared.reference,
    });
    expect(callsBeforeSettlement).toBe(1);
    expect(diagnostics).toContainEqual(expect.objectContaining({
      kind: 'operation-id-conflict',
      operationId: 'shared-in-flight',
      phase: 'inspect',
    }));
    await expect(first).resolves.toEqual({
      state: 'live',
      reference: fixture.prepared.reference,
    });
  });

  it('rejects a concurrent same-id conflicting phase before either provider control can run twice', async () => {
    const provider = new DeadlineProvider();
    const gate = deferred<ProviderObservation>();
    provider.observation = gate.promise;
    const ids = ['prepare-id', 'publish-id', 'shared-in-flight', 'shared-in-flight'];
    const fixture = await published(provider, {
      operationId: () => ids.shift() ?? 'unique-id',
    });

    const inspecting = fixture.coordinator.inspect(fixture.prepared.reference);
    await Promise.resolve();
    await Promise.resolve();
    const conflicting = fixture.coordinator.terminate(fixture.prepared.reference, {
      reason: 'same-id-different-control',
      graceMs: 0,
    });

    await expect(conflicting).resolves.toMatchObject({
      state: 'control-loss',
      phase: 'terminate',
      reference: fixture.prepared.reference,
    });
    expect(provider.inspectCalls).toBe(1);
    expect(provider.terminateCalls).toBe(0);
    gate.resolve({ state: 'live' });
    await expect(inspecting).resolves.toMatchObject({ state: 'live' });
  });

  it('never reuses an in-flight successful prepare result for a duplicate operation id', async () => {
    const provider = new DeadlineProvider();
    const gate = deferred<Awaited<ReturnType<DeadlineProvider['prepare']>>>();
    let prepareCalls = 0;
    provider.prepare = async () => {
      prepareCalls += 1;
      return gate.promise;
    };
    const coordinator = createProcessAuthorityCoordinator({
      registry: createTestProcessAuthorityProviderRegistry([provider]),
      scheduler: passiveScheduler(),
      operationId: () => 'shared-prepare-id',
    });

    const first = coordinator.prepare(descriptor, input);
    await Promise.resolve();
    await Promise.resolve();
    const duplicate = coordinator.prepare(descriptor, input);
    gate.resolve({
      reference: provider.providerReference,
      activate: async () => ({ state: 'live' }),
    });

    await expect(first).resolves.toMatchObject({ state: 'prepared-inert' });
    await expect(duplicate).resolves.toMatchObject({
      state: 'control-loss',
      phase: 'prepare',
      diagnostic: expect.stringContaining('not unique'),
    });
    expect(prepareCalls).toBe(1);
  });

  it('bounds in-flight reservations and admits new ids only after settled retention can be evicted', async () => {
    const provider = new DeadlineProvider();
    const gate = deferred<ProviderObservation>();
    provider.observation = gate.promise;
    let operation = 0;
    const fixture = await published(provider, {
      operationId: () => `bounded-ledger-${++operation}`,
    });
    const inFlight = Array.from(
      { length: PROCESS_AUTHORITY_OPERATION_LEDGER_LIMIT },
      () => fixture.coordinator.inspect(fixture.prepared.reference)
    );
    await Promise.resolve();
    await Promise.resolve();
    const overflow = fixture.coordinator.inspect(fixture.prepared.reference);
    await Promise.resolve();
    await Promise.resolve();
    const callsBeforeSettlement = provider.inspectCalls;
    gate.resolve({ state: 'live' });

    await expect(overflow).resolves.toMatchObject({
      state: 'control-loss',
      phase: 'inspect',
      diagnostic: expect.stringContaining('capacity'),
    });
    expect(callsBeforeSettlement).toBe(PROCESS_AUTHORITY_OPERATION_LEDGER_LIMIT);

    await Promise.all(inFlight);
    provider.observation = Promise.resolve({ state: 'live' });
    await expect(fixture.coordinator.inspect(fixture.prepared.reference)).resolves.toMatchObject({
      state: 'live',
    });
    expect(provider.inspectCalls).toBe(PROCESS_AUTHORITY_OPERATION_LEDGER_LIMIT + 1);
  });

  it('fails preparation closed when non-reusable reference tombstones reach their bound', async () => {
    const provider = new DeadlineProvider();
    let operation = 0;
    const coordinator = createProcessAuthorityCoordinator({
      registry: createTestProcessAuthorityProviderRegistry([provider]),
      scheduler: passiveScheduler(),
      operationId: () => `reference-tombstone-${++operation}`,
    });

    for (let index = 0; index < PROCESS_AUTHORITY_REFERENCE_TOMBSTONE_LIMIT; index += 1) {
      const prepared = await coordinator.prepare(descriptor, input);
      expect(prepared.state).toBe('prepared-inert');
    }
    await expect(coordinator.prepare(descriptor, input)).resolves.toMatchObject({
      state: 'authority-unavailable',
      diagnostic: expect.stringContaining('tombstone capacity'),
    });
    expect(provider.starts).toBe(PROCESS_AUTHORITY_REFERENCE_TOMBSTONE_LIMIT);
  });

  it('atomically reserves the final tombstone slot before concurrent preparation dispatch', async () => {
    const provider = new DeadlineProvider();
    let operation = 0;
    const coordinator = createProcessAuthorityCoordinator({
      registry: createTestProcessAuthorityProviderRegistry([provider]),
      scheduler: passiveScheduler(),
      operationId: () => `concurrent-tombstone-${++operation}`,
    });
    for (let index = 0; index < PROCESS_AUTHORITY_REFERENCE_TOMBSTONE_LIMIT - 1; index += 1) {
      const prepared = await coordinator.prepare(descriptor, input);
      if (prepared.state !== 'prepared-inert') throw new Error('expected capacity fixture');
    }
    let concurrentDispatches = 0;
    provider.prepareOverride = async () => {
      concurrentDispatches += 1;
      return {
        reference: createProviderAuthorityReference(
          1,
          Buffer.from(`concurrent-final-${concurrentDispatches}`)
        ),
        activate: async () => ({ state: 'live' as const }),
      };
    };

    const results = await Promise.all([
      coordinator.prepare(descriptor, input),
      coordinator.prepare(descriptor, input),
    ]);
    expect(results.filter((result) => result.state === 'prepared-inert')).toHaveLength(1);
    expect(results.filter((result) => result.state === 'authority-unavailable')).toHaveLength(1);
    expect(concurrentDispatches).toBe(1);
  });

  it.each(['failure', 'timeout', 'collision'] as const)(
    'releases a reserved tombstone slot after prepare %s',
    async (mode) => {
      const provider = new DeadlineProvider();
      let operation = 0;
      let timeoutNext = false;
      const coordinator = createProcessAuthorityCoordinator({
        registry: createTestProcessAuthorityProviderRegistry([provider]),
        scheduler: {
          set(_delay, callback, context) {
            if (timeoutNext && context.phase === 'prepare') callback();
            return context.operationId;
          },
          clear() {},
        },
        operationId: () => `released-tombstone-${mode}-${++operation}`,
      });
      for (let index = 0; index < PROCESS_AUTHORITY_REFERENCE_TOMBSTONE_LIMIT - 1; index += 1) {
        const prepared = await coordinator.prepare(descriptor, input);
        if (prepared.state !== 'prepared-inert') throw new Error('expected capacity fixture');
      }
      if (mode === 'failure') {
        provider.prepareOverride = async () => { throw new Error('prepare control lost'); };
      } else if (mode === 'timeout') {
        timeoutNext = true;
      } else {
        provider.prepareOverride = async () => ({
          reference: createProviderAuthorityReference(1, Buffer.from('deadline-authority-1')),
          activate: async () => ({ state: 'live' as const }),
        });
      }
      const failed = await coordinator.prepare(descriptor, input);
      expect(failed.state).not.toBe('prepared-inert');

      timeoutNext = false;
      provider.prepareOverride = async () => ({
        reference: createProviderAuthorityReference(1, Buffer.from(`released-${mode}`)),
        activate: async () => ({ state: 'live' as const }),
      });
      await expect(coordinator.prepare(descriptor, input)).resolves.toMatchObject({
        state: 'prepared-inert',
      });
    }
  );

  it('refuses recovered dispatch when active tombstones already fill the ledger', async () => {
    const provider = new DeadlineProvider();
    let operation = 0;
    const coordinator = createProcessAuthorityCoordinator({
      registry: createTestProcessAuthorityProviderRegistry([provider]),
      scheduler: passiveScheduler(),
      operationId: () => `recovered-capacity-${++operation}`,
    });
    for (let index = 0; index < PROCESS_AUTHORITY_REFERENCE_TOMBSTONE_LIMIT; index += 1) {
      const prepared = await coordinator.prepare(descriptor, input);
      if (prepared.state !== 'prepared-inert') throw new Error('expected full ledger fixture');
    }
    const recovered = encodeProcessAuthorityReference(
      descriptor,
      createProviderAuthorityReference(1, Buffer.from('external-recovered-generation'))
    );
    const inspectCalls = provider.inspectCalls;

    await expect(coordinator.inspect(recovered)).resolves.toMatchObject({
      state: 'authority-unavailable',
      diagnostic: expect.stringContaining('tombstone capacity'),
    });
    expect(provider.inspectCalls).toBe(inspectCalls);
  });
});
