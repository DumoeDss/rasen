import { describe, expect, it } from 'vitest';

import {
  PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  PROCESS_AUTHORITY_PUBLICATION_VERSION,
  RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  createProcessAuthorityCoordinator,
  createProcessAuthorityPublicationAcknowledgement,
  type AuthorityOperationContext,
  type AuthorityPrepareInput,
  type AuthorityScheduler,
  type ProcessAuthorityProvider,
  type ProcessAuthorityProviderDescriptor,
  type ProviderAuthorityReference,
  type ProviderControlOutcome,
  type ProviderObservation,
} from '../../../src/core/session-host/process-authority/index.js';
import { createProviderAuthorityReference } from '../../../src/core/session-host/process-authority/reference-codec.js';
import { createTestProcessAuthorityProviderRegistry } from '../../helpers/process-authority-test-registry.js';

const descriptor: ProcessAuthorityProviderDescriptor = {
  providerId: 'test.lifecycle',
  capabilityId: RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  protocolVersion: 1,
  commonContractVersion: PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  providerReferenceVersion: 1,
  semantics: RECURSIVE_PROCESS_SCOPE_SEMANTICS,
};

const input: AuthorityPrepareInput = {
  command: 'fixture-command',
  args: ['--fixture'],
  cwd: 'C:\\fixture',
  env: { RASEN_FIXTURE: '1' },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

class LifecycleProvider implements ProcessAuthorityProvider {
  readonly descriptor = descriptor;
  activationResult: Promise<ProviderObservation> = Promise.resolve({ state: 'live' });
  abortResult: Promise<ProviderControlOutcome> = Promise.resolve({ state: 'exact-scope-empty' });
  readonly providerReference: ProviderAuthorityReference = createProviderAuthorityReference(
    1,
    Buffer.from('deterministic-authority')
  );
  prepareCalls = 0;
  receivedInput: AuthorityPrepareInput | undefined;

  constructor(private readonly onWorkloadStart: () => void = () => undefined) {}

  async prepare(input: AuthorityPrepareInput, _context: AuthorityOperationContext) {
    this.prepareCalls += 1;
    this.receivedInput = input;
    return {
      reference: this.providerReference,
      activate: async (_activationContext: AuthorityOperationContext) => {
        this.onWorkloadStart();
        return this.activationResult;
      },
    };
  }

  async inspect() {
    return { state: 'prepared-inert' as const };
  }

  async terminate() {
    return { state: 'exact-scope-empty' as const };
  }

  async abort() {
    return this.abortResult;
  }
}

function lifecycle(provider = new LifecycleProvider(), scheduler?: AuthorityScheduler) {
  let operation = 0;
  const coordinator = createProcessAuthorityCoordinator({
    registry: createTestProcessAuthorityProviderRegistry([provider]),
    clock: { now: () => 1_000 },
    operationId: () => `operation-${++operation}`,
    operationTimeoutMs: 500,
    ...(scheduler ? { scheduler } : {}),
  });
  return { coordinator, provider };
}

async function prepare(provider = new LifecycleProvider()) {
  const fixture = lifecycle(provider);
  const result = await fixture.coordinator.prepare(descriptor, input);
  expect(result.state).toBe('prepared-inert');
  if (result.state !== 'prepared-inert') throw new Error('expected prepared authority');
  return { ...fixture, prepared: result };
}

describe('process-authority prepare, publish, activate lifecycle', () => {
  it('keeps prepare inert and exposes activation only after exact publication', async () => {
    let workloadStarts = 0;
    const { prepared } = await prepare(new LifecycleProvider(() => { workloadStarts += 1; }));
    expect(workloadStarts).toBe(0);
    expect(prepared.currentState()).toBe('prepared-inert');
    expect('activate' in prepared).toBe(false);
    // @ts-expect-error activation is intentionally absent before publication
    void prepared.activate;

    const acknowledgement = createProcessAuthorityPublicationAcknowledgement(
      prepared.publicationBinding
    );
    const published = await prepared.publish(async () => acknowledgement);
    expect(published.state).toBe('published-inert');
    if (published.state !== 'published-inert') throw new Error('expected published authority');
    expect(workloadStarts).toBe(0);
    expect(published.currentState()).toBe('published-inert');

    const live = await published.activate();
    expect(live).toMatchObject({ state: 'live', reference: prepared.reference });
    expect(workloadStarts).toBe(1);
    expect(published.currentState()).toBe('live');

    await expect(published.activate()).resolves.toMatchObject({
      state: 'ordering-conflict',
      reference: prepared.reference,
      phase: 'activate',
    });
    expect(workloadStarts).toBe(1);
  });

  it('runs the trusted durable publisher inside the bounded publish phase', async () => {
    const { prepared } = await prepare();
    let observedBinding = prepared.publicationBinding;
    let observedContext: AuthorityOperationContext | undefined;
    const published = await prepared.publish(async (binding, context) => {
      observedBinding = binding;
      observedContext = context;
      return createProcessAuthorityPublicationAcknowledgement(binding);
    });

    expect(published.state).toBe('published-inert');
    expect(observedBinding).toBe(prepared.publicationBinding);
    expect(observedContext).toMatchObject({
      phase: 'publish',
      operationId: expect.any(String),
      deadline: expect.any(Number),
    });
    expect(observedContext?.signal).toBeInstanceOf(AbortSignal);
  });

  it('copies, bounds, and freezes prepare input before deferred provider dispatch', async () => {
    const provider = new LifecycleProvider();
    const { coordinator } = lifecycle(provider);
    const mutableArgs = ['original'];
    const mutableEnv = { ORIGINAL: '1' };
    const mutableInput: AuthorityPrepareInput = {
      command: 'fixture-command',
      args: mutableArgs,
      cwd: 'fixture',
      env: mutableEnv,
    };

    const pending = coordinator.prepare(descriptor, mutableInput);
    mutableArgs[0] = 'mutated';
    mutableEnv.ORIGINAL = 'mutated';
    const prepared = await pending;

    expect(prepared.state).toBe('prepared-inert');
    expect(provider.receivedInput).toEqual({
      command: 'fixture-command',
      args: ['original'],
      cwd: 'fixture',
      env: { ORIGINAL: '1' },
    });
    expect(Object.isFrozen(provider.receivedInput)).toBe(true);
    expect(Object.isFrozen(provider.receivedInput?.args)).toBe(true);
    expect(Object.isFrozen(provider.receivedInput?.env)).toBe(true);
  });

  it.each([
    ['command', 'fixture-command', 'unsafe\0command'],
    ['args', ['--safe'], [1n]],
    ['cwd', 'fixture', 'unsafe\0cwd'],
    ['env', { SAFE: '1' }, { SAFE: 1n }],
    ['windowsVerbatimArguments', false, 1n],
  ] as const)('reads prepare field %s once and dispatches only its validated snapshot', async (
    field,
    safe,
    hostile
  ) => {
    const provider = new LifecycleProvider();
    const { coordinator } = lifecycle(provider);
    const alternating: Record<string, unknown> = {
      command: 'fixture-command',
      args: ['--safe'],
      cwd: 'fixture',
      env: { SAFE: '1' },
      windowsVerbatimArguments: false,
    };
    let reads = 0;
    Object.defineProperty(alternating, field, {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? safe : hostile;
      },
    });

    const result = await coordinator.prepare(descriptor, alternating as unknown as AuthorityPrepareInput);
    expect(result.state).toBe('prepared-inert');
    expect(reads).toBe(1);
    expect(provider.receivedInput?.[field]).toEqual(safe);
  });

  it('captures provider prepared reference and activation capability exactly once', async () => {
    const provider = new LifecycleProvider();
    const firstReference = createProviderAuthorityReference(1, Buffer.from('captured-reference'));
    const secondReference = createProviderAuthorityReference(1, Buffer.from('forged-reference'));
    let referenceReads = 0;
    let activateReads = 0;
    let abortedReference: ProviderAuthorityReference | undefined;
    provider.prepare = async () => {
      const prepared = {} as Record<string, unknown>;
      Object.defineProperty(prepared, 'reference', {
        enumerable: true,
        get() {
          referenceReads += 1;
          return referenceReads === 1 ? firstReference : secondReference;
        },
      });
      Object.defineProperty(prepared, 'activate', {
        enumerable: true,
        get() {
          activateReads += 1;
          if (activateReads > 1) throw new Error('activation capability was reread');
          return async () => ({ state: 'published-inert' as const });
        },
      });
      return prepared as unknown as Awaited<ReturnType<ProcessAuthorityProvider['prepare']>>;
    };
    provider.abort = async (reference) => {
      abortedReference = reference;
      return { state: 'exact-scope-empty' };
    };
    const { coordinator } = lifecycle(provider);
    const prepared = await coordinator.prepare(descriptor, input);
    if (prepared.state !== 'prepared-inert') throw new Error('expected prepared authority');
    const published = await prepared.publish(async (binding) =>
      createProcessAuthorityPublicationAcknowledgement(binding)
    );
    if (published.state !== 'published-inert') throw new Error('expected published authority');

    await expect(published.activate()).resolves.toMatchObject({ state: 'published-inert' });
    await expect(published.abort('captured-provider-capability')).resolves.toMatchObject({
      state: 'exact-scope-empty',
    });
    expect(referenceReads).toBe(1);
    expect(activateReads).toBe(1);
    expect(abortedReference).toBe(firstReference);
  });

  it('turns hostile prepare values into a typed failure without provider dispatch', async () => {
    const provider = new LifecycleProvider();
    const { coordinator } = lifecycle(provider);
    const hostile = { ...input } as AuthorityPrepareInput;
    Object.defineProperty(hostile, 'args', {
      enumerable: true,
      get() {
        throw new Error('hostile args getter');
      },
    });

    await expect(coordinator.prepare(descriptor, hostile)).resolves.toMatchObject({
      state: 'authority-unavailable',
      diagnostic: expect.stringMatching(/input|malformed/i),
    });
    expect(provider.prepareCalls).toBe(0);
  });

  it('cannot activate before publication and leaves bounded abort available', async () => {
    let workloadStarts = 0;
    const { prepared } = await prepare(new LifecycleProvider(() => { workloadStarts += 1; }));
    expect((prepared as unknown as { activate?: unknown }).activate).toBeUndefined();
    expect(workloadStarts).toBe(0);

    await expect(prepared.abort('publication-failed')).resolves.toMatchObject({
      state: 'exact-scope-empty',
      reference: prepared.reference,
    });
    expect(workloadStarts).toBe(0);
    expect(prepared.currentState()).toBe('exact-scope-empty');
  });

  it.each([
    ['reference digest', { referenceDigest: '0'.repeat(64) }],
    ['publication version', { publicationVersion: PROCESS_AUTHORITY_PUBLICATION_VERSION + 1 }],
    ['preparation operation', { preparationOperationId: 'different-operation' }],
  ])('consumes publication after a mismatched %s acknowledgment without activating', async (_name, changed) => {
    let workloadStarts = 0;
    const { prepared } = await prepare(new LifecycleProvider(() => { workloadStarts += 1; }));
    const exact = createProcessAuthorityPublicationAcknowledgement(prepared.publicationBinding);
    const forged = { ...exact, ...changed } as typeof exact;

    let publisherCalls = 0;
    await expect(prepared.publish(async () => {
      publisherCalls += 1;
      return forged;
    })).resolves.toMatchObject({
      state: 'control-loss',
      reference: prepared.reference,
      phase: 'publish',
    });
    expect(prepared.currentState()).toBe('publication-uncertain');
    expect(workloadStarts).toBe(0);
    await expect(prepared.publish(async () => {
      publisherCalls += 1;
      return exact;
    })).resolves.toMatchObject({ state: 'ordering-conflict', phase: 'publish' });
    expect(publisherCalls).toBe(1);
    await expect(prepared.abort('invalid-publication')).resolves.toMatchObject({
      state: 'exact-scope-empty',
    });
  });

  it('rejects duplicate publication and publication after abort', async () => {
    const first = await prepare();
    const acknowledgment = createProcessAuthorityPublicationAcknowledgement(
      first.prepared.publicationBinding
    );
    const published = await first.prepared.publish(async () => acknowledgment);
    expect(published.state).toBe('published-inert');
    await expect(first.prepared.publish(async () => acknowledgment)).resolves.toMatchObject({
      state: 'ordering-conflict',
      phase: 'publish',
    });

    const second = await prepare();
    await second.prepared.abort('cancelled');
    await expect(
      second.prepared.publish(async (binding) =>
        createProcessAuthorityPublicationAcknowledgement(binding)
      )
    ).resolves.toMatchObject({ state: 'ordering-conflict', phase: 'publish' });
  });

  it('settles duplicate activation and activation/abort races exactly once', async () => {
    let workloadStarts = 0;
    const provider = new LifecycleProvider(() => { workloadStarts += 1; });
    const activation = deferred<ProviderObservation>();
    provider.activationResult = activation.promise;
    const { prepared } = await prepare(provider);
    const published = await prepared.publish(async (binding) =>
      createProcessAuthorityPublicationAcknowledgement(binding)
    );
    if (published.state !== 'published-inert') throw new Error('expected published authority');

    const firstActivation = published.activate();
    await expect(published.activate()).resolves.toMatchObject({
      state: 'ordering-conflict',
      phase: 'activate',
    });
    await expect(published.abort('racing-abort')).resolves.toMatchObject({
      state: 'ordering-conflict',
      phase: 'abort',
    });
    expect(workloadStarts).toBe(1);

    activation.resolve({ state: 'live' });
    await expect(firstActivation).resolves.toMatchObject({ state: 'live' });
    expect(workloadStarts).toBe(1);
  });

  it('settles abort/publication races once and ignores a later provider outcome', async () => {
    let workloadStarts = 0;
    const provider = new LifecycleProvider(() => { workloadStarts += 1; });
    const abort = deferred<ProviderControlOutcome>();
    provider.abortResult = abort.promise;
    const { prepared } = await prepare(provider);
    const aborting = prepared.abort('racing-publication');

    await expect(
      prepared.publish(async (binding) =>
        createProcessAuthorityPublicationAcknowledgement(binding)
      )
    ).resolves.toMatchObject({ state: 'ordering-conflict', phase: 'publish' });
    expect(workloadStarts).toBe(0);

    abort.resolve({ state: 'exact-scope-empty' });
    await expect(aborting).resolves.toMatchObject({ state: 'exact-scope-empty' });
    await expect(prepared.abort('duplicate-abort')).resolves.toMatchObject({
      state: 'ordering-conflict',
      phase: 'abort',
    });
  });

  it('is deterministic across repeated runs with an injected monotonic clock and scheduler', async () => {
    let scheduled = 0;
    let cleared = 0;
    const scheduler: AuthorityScheduler = {
      set(_delayMs, _onElapsed) {
        scheduled += 1;
        return scheduled;
      },
      clear() {
        cleared += 1;
      },
    };

    for (let iteration = 0; iteration < 20; iteration += 1) {
      const { coordinator } = lifecycle(new LifecycleProvider(), scheduler);
      const prepared = await coordinator.prepare(descriptor, input);
      if (prepared.state !== 'prepared-inert') throw new Error('expected prepared authority');
      const published = await prepared.publish(async (binding) =>
        createProcessAuthorityPublicationAcknowledgement(binding)
      );
      if (published.state !== 'published-inert') throw new Error('expected published authority');
      await expect(published.activate()).resolves.toMatchObject({ state: 'live' });
    }

    expect(scheduled).toBe(60);
    expect(cleared).toBe(60);
  });
});
