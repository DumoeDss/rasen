import { describe, expect, it } from 'vitest';

import {
  PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  createProcessAuthorityCoordinator,
  createProcessAuthorityPublicationAcknowledgement,
  isExactScopeEmptyReceipt,
  type AuthorityOperationContext,
  type AuthorityPrepareInput,
  type AuthorityTerminationIntent,
  type ProcessAuthorityLifecycleOutcome,
  type ProcessAuthorityProvider,
  type ProcessAuthorityProviderDescriptor,
  type ProviderAuthorityReference,
  type ProviderControlOutcome,
  type ProviderObservation,
} from '../../../src/core/session-host/process-authority/index.js';
import { createProviderAuthorityReference } from '../../../src/core/session-host/process-authority/reference-codec.js';
import { encodeProcessAuthorityReference } from '../../../src/core/session-host/process-authority/reference-codec.js';
import { createTestProcessAuthorityProviderRegistry } from '../../helpers/process-authority-test-registry.js';

const descriptor: ProcessAuthorityProviderDescriptor = {
  providerId: 'test.outcomes',
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

class OutcomeProvider implements ProcessAuthorityProvider {
  readonly descriptor = descriptor;
  readonly providerReference: ProviderAuthorityReference = createProviderAuthorityReference(
    1,
    Buffer.from('outcome-authority')
  );
  observation: ProviderObservation = { state: 'live' };
  control: ProviderControlOutcome = { state: 'exact-scope-empty' };
  destructiveControls = 0;
  receivedIntent: AuthorityTerminationIntent | undefined;

  async prepare(_input: AuthorityPrepareInput, _context: AuthorityOperationContext) {
    return {
      reference: this.providerReference,
      activate: async () => ({ state: 'live' as const }),
    };
  }

  async inspect() {
    return this.observation;
  }

  async terminate(
    _reference: ProviderAuthorityReference,
    intent: AuthorityTerminationIntent
  ) {
    this.receivedIntent = intent;
    if (this.observation.state !== 'identity-drift' && this.observation.state !== 'event-gap') {
      this.destructiveControls += 1;
    }
    return this.control;
  }

  async abort() {
    return this.control;
  }
}

async function publishedFixture() {
  const provider = new OutcomeProvider();
  let operation = 0;
  const coordinator = createProcessAuthorityCoordinator({
    registry: createTestProcessAuthorityProviderRegistry([provider]),
    operationId: () => `outcome-${++operation}`,
    operationTimeoutMs: 500,
  });
  const prepared = await coordinator.prepare(descriptor, input);
  if (prepared.state !== 'prepared-inert') throw new Error('expected prepared authority');
  const published = await prepared.publish(async (binding) =>
    createProcessAuthorityPublicationAcknowledgement(binding)
  );
  if (published.state !== 'published-inert') throw new Error('expected published authority');
  return { coordinator, provider, prepared, published };
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs = 100): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('process-authority operation did not settle')),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe('process-authority observation and release truth', () => {
  it('retains root-exited authority and permits exact inspect/terminate reconciliation', async () => {
    const fixture = await publishedFixture();
    fixture.provider.observation = { state: 'root-exited', code: 17, signal: null };

    const rootExited = await fixture.coordinator.inspect(fixture.prepared.reference);
    expect(rootExited).toEqual({
      state: 'root-exited',
      reference: fixture.prepared.reference,
      code: 17,
      signal: null,
    });
    expect(isExactScopeEmptyReceipt(rootExited)).toBe(false);

    fixture.provider.control = { state: 'exact-scope-empty' };
    const terminated = await fixture.coordinator.terminate(fixture.prepared.reference, {
      reason: 'root-exited-reconciliation',
      graceMs: 0,
    });
    expect(terminated).toEqual({
      state: 'exact-scope-empty',
      reference: fixture.prepared.reference,
    });
    expect(isExactScopeEmptyReceipt(terminated)).toBe(true);
    const repeated = await fixture.coordinator.observeExactScopeEmpty(
      fixture.prepared.reference
    );
    expect(repeated).toBe(terminated);
  });

  it('never reuses a retired provider reference or replays its exact-empty receipt', async () => {
    const fixture = await publishedFixture();
    fixture.provider.control = { state: 'exact-scope-empty' };
    const retired = await fixture.coordinator.terminate(fixture.prepared.reference, {
      reason: 'retire-first-generation',
      graceMs: 0,
    });
    expect(isExactScopeEmptyReceipt(retired)).toBe(true);

    const second = await fixture.coordinator.prepare(descriptor, input);
    expect(second).toMatchObject({
      state: 'authority-unavailable',
      diagnostic: expect.stringMatching(/reference|reuse|retired/i),
    });
  });

  it.each([
    ['authority-unavailable', 'provider unavailable'],
    ['authority-uncertain', 'scope truth unavailable'],
  ] as const)('retains the exact published reference for %s', async (state, diagnostic) => {
    const fixture = await publishedFixture();
    fixture.provider.observation = { state, diagnostic };

    const observed = await fixture.coordinator.inspect(fixture.prepared.reference);
    expect(observed).toEqual({ state, reference: fixture.prepared.reference, diagnostic });
    expect(isExactScopeEmptyReceipt(observed)).toBe(false);

    fixture.provider.observation = { state: 'live' };
    await expect(fixture.coordinator.inspect(fixture.prepared.reference)).resolves.toEqual({
      state: 'live',
      reference: fixture.prepared.reference,
    });
  });

  it.each(['prepared-inert', 'published-inert'] as const)(
    'preserves the %s recovery observation instead of inventing control loss',
    async (state) => {
      const fixture = await publishedFixture();
      fixture.provider.observation = { state };

      await expect(fixture.coordinator.inspect(fixture.prepared.reference)).resolves.toEqual({
        state,
        reference: fixture.prepared.reference,
      });
    }
  );

  it('rejects statusless root-exited on every provider path', async () => {
    const fixture = await publishedFixture();
    fixture.provider.observation = { state: 'root-exited' } as unknown as ProviderObservation;
    fixture.provider.control = { state: 'root-exited' } as unknown as ProviderControlOutcome;

    await expect(fixture.coordinator.inspect(fixture.prepared.reference)).resolves.toMatchObject({
      state: 'control-loss',
      phase: 'inspect',
    });
    await expect(fixture.coordinator.terminate(fixture.prepared.reference, {
      reason: 'status-required',
      graceMs: 0,
    })).resolves.toMatchObject({
      state: 'control-loss',
      phase: 'terminate',
    });
  });

  it('rejects root-exited with neither an exit code nor signal on observation and control paths', async () => {
    const fixture = await publishedFixture();
    fixture.provider.observation = {
      state: 'root-exited',
      code: null,
      signal: null,
    } as ProviderObservation;
    fixture.provider.control = {
      state: 'root-exited',
      code: null,
      signal: null,
    } as ProviderControlOutcome;

    await expect(fixture.coordinator.inspect(fixture.prepared.reference)).resolves.toMatchObject({
      state: 'control-loss',
      phase: 'inspect',
    });
    await expect(fixture.coordinator.terminate(fixture.prepared.reference, {
      reason: 'nonempty-root-status-required',
      graceMs: 0,
    })).resolves.toMatchObject({ state: 'control-loss', phase: 'terminate' });
  });

  it.each(['live', 'exact-scope-empty'] as const)(
    'registers a recovered %s reference before provider dispatch and forbids generation reuse',
    async (state) => {
      const provider = new OutcomeProvider();
      let operation = 0;
      const coordinator = createProcessAuthorityCoordinator({
        registry: createTestProcessAuthorityProviderRegistry([provider]),
        operationId: () => `recovery-ledger-${++operation}`,
      });
      const recovered = encodeProcessAuthorityReference(descriptor, provider.providerReference);
      provider.observation = state === 'live' ? { state: 'live' } : { state: 'exact-scope-empty' };
      const observation = await coordinator.inspect(recovered);
      expect(observation.state).toBe(state);

      await expect(coordinator.prepare(descriptor, input)).resolves.toMatchObject({
        state: 'authority-unavailable',
        diagnostic: expect.stringMatching(/reference|reuse|retired/i),
      });
      if (state === 'exact-scope-empty') {
        await expect(coordinator.terminate(recovered, {
          reason: 'stale-receipt-proof',
          graceMs: 0,
        })).resolves.toBe(observation);
      }
    }
  );

  it('registers a recovered generation before its first provider observation settles', async () => {
    const provider = new OutcomeProvider();
    let finishObservation!: (value: ProviderObservation) => void;
    const observation = new Promise<ProviderObservation>((resolve) => {
      finishObservation = resolve;
    });
    provider.inspect = async () => observation;
    let operation = 0;
    const coordinator = createProcessAuthorityCoordinator({
      registry: createTestProcessAuthorityProviderRegistry([provider]),
      operationId: () => `atomic-recovery-ledger-${++operation}`,
    });
    const recovered = encodeProcessAuthorityReference(descriptor, provider.providerReference);

    const inspecting = coordinator.inspect(recovered);
    await Promise.resolve();
    await expect(coordinator.prepare(descriptor, input)).resolves.toMatchObject({
      state: 'authority-unavailable',
      diagnostic: expect.stringMatching(/reference|reuse/i),
    });
    finishObservation({ state: 'live' });
    await expect(inspecting).resolves.toEqual({ state: 'live', reference: recovered });
  });

  it.each([
    ['identity-drift', 'native identity changed'],
    ['event-gap', 'event interval is incomplete'],
  ] as const)('does not normalize or destructively control %s', async (state, diagnostic) => {
    const fixture = await publishedFixture();
    fixture.provider.observation = { state, diagnostic };
    fixture.provider.control = { state, diagnostic };

    const observed = await fixture.coordinator.inspect(fixture.prepared.reference);
    expect(observed).toEqual({ state, reference: fixture.prepared.reference, diagnostic });
    const controlled = await fixture.coordinator.terminate(fixture.prepared.reference, {
      reason: 'unsafe-control-mutation',
      graceMs: 0,
    });
    expect(controlled).toEqual({ state, reference: fixture.prepared.reference, diagnostic });
    expect(fixture.provider.destructiveControls).toBe(0);
    expect(isExactScopeEmptyReceipt(controlled)).toBe(false);
  });

  it('makes the exact-scope-empty receipt the sole release predicate', () => {
    const reference = 'rasen-process-authority/1:fixture' as never;
    const retained: readonly ProcessAuthorityLifecycleOutcome[] = [
      { state: 'live', reference },
      { state: 'root-exited', reference, code: 0, signal: null },
      { state: 'authority-unavailable', reference, diagnostic: 'unavailable' },
      { state: 'authority-uncertain', reference, diagnostic: 'uncertain' },
      { state: 'identity-drift', reference, diagnostic: 'drift' },
      { state: 'event-gap', reference, diagnostic: 'gap' },
      { state: 'timeout', reference, phase: 'inspect', diagnostic: 'timeout' },
      { state: 'control-loss', reference, phase: 'inspect', diagnostic: 'loss' },
      { state: 'ordering-conflict', reference, phase: 'activate', diagnostic: 'conflict' },
    ];

    expect(retained.every((outcome) => !isExactScopeEmptyReceipt(outcome))).toBe(true);
    expect(isExactScopeEmptyReceipt({ state: 'exact-scope-empty', reference })).toBe(false);
    expect(isExactScopeEmptyReceipt({ state: 'exact-scope-empty' })).toBe(false);
  });

  it.each([
    ['circular', () => {
      const circular: Record<string, unknown> = { state: 'live' };
      circular.self = circular;
      return circular;
    }],
    ['BigInt-unserializable', () => ({ state: 'live', nativeIdentity: 1n })],
    ['throwing-accessor', () => {
      const malformed: Record<string, unknown> = {};
      Object.defineProperty(malformed, 'state', {
        enumerable: true,
        get() {
          throw new Error('malformed provider getter');
        },
      });
      return malformed;
    }],
  ] as const)('fails closed and remains usable after a %s fulfilled provider outcome', async (_name, createOutcome) => {
    const fixture = await publishedFixture();
    fixture.provider.observation = createOutcome() as unknown as ProviderObservation;

    await expect(
      settleWithin(fixture.coordinator.inspect(fixture.prepared.reference))
    ).resolves.toMatchObject({
      state: 'control-loss',
      reference: fixture.prepared.reference,
      phase: 'inspect',
      diagnostic: expect.stringContaining('invalid fulfilled outcome'),
    });

    fixture.provider.observation = { state: 'live' };
    await expect(fixture.coordinator.inspect(fixture.prepared.reference)).resolves.toEqual({
      state: 'live',
      reference: fixture.prepared.reference,
    });
  });

  it('never turns a malformed circular exact-empty outcome into a release receipt', async () => {
    const fixture = await publishedFixture();
    const circularTerminal: Record<string, unknown> = { state: 'exact-scope-empty' };
    circularTerminal.self = circularTerminal;
    fixture.provider.control = circularTerminal as unknown as ProviderControlOutcome;

    const controlled = await settleWithin(
      fixture.coordinator.terminate(fixture.prepared.reference, {
        reason: 'malformed-terminal-receipt',
        graceMs: 0,
      })
    );
    expect(controlled).toMatchObject({
      state: 'control-loss',
      reference: fixture.prepared.reference,
      phase: 'terminate',
      diagnostic: expect.stringContaining('invalid fulfilled outcome'),
    });
    expect(isExactScopeEmptyReceipt(controlled)).toBe(false);

    fixture.provider.observation = { state: 'live' };
    await expect(fixture.coordinator.inspect(fixture.prepared.reference)).resolves.toEqual({
      state: 'live',
      reference: fixture.prepared.reference,
    });
  });

  it('dispatches one immutable termination-intent snapshot', async () => {
    const fixture = await publishedFixture();
    const intent = { reason: 'original', graceMs: 10 };
    const pending = fixture.coordinator.terminate(fixture.prepared.reference, intent);
    intent.reason = 'mutated';
    intent.graceMs = 99;
    await pending;

    expect(fixture.provider.receivedIntent).toEqual({ reason: 'original', graceMs: 10 });
    expect(Object.isFrozen(fixture.provider.receivedIntent)).toBe(true);
  });

  it.each([
    ['reason', 'original', 'unsafe\0reason'],
    ['graceMs', 10, 1n],
  ] as const)('reads termination field %s once and dispatches only its validated snapshot', async (
    field,
    safe,
    hostile
  ) => {
    const fixture = await publishedFixture();
    const alternating: Record<string, unknown> = { reason: 'original', graceMs: 10 };
    let reads = 0;
    Object.defineProperty(alternating, field, {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? safe : hostile;
      },
    });

    await expect(fixture.coordinator.terminate(
      fixture.prepared.reference,
      alternating as unknown as AuthorityTerminationIntent
    )).resolves.toMatchObject({ state: 'exact-scope-empty' });
    expect(reads).toBe(1);
    expect(fixture.provider.receivedIntent?.[field]).toEqual(safe);
  });

  it('rejects hostile or out-of-bound termination intent without provider dispatch', async () => {
    const fixture = await publishedFixture();
    const hostile = { reason: 'invalid', graceMs: 0 } as AuthorityTerminationIntent;
    Object.defineProperty(hostile, 'graceMs', {
      enumerable: true,
      get() {
        throw new Error('hostile grace getter');
      },
    });

    await expect(fixture.coordinator.terminate(
      fixture.prepared.reference,
      hostile
    )).resolves.toMatchObject({
      state: 'control-loss',
      phase: 'terminate',
      diagnostic: expect.stringMatching(/intent|malformed/i),
    });
    expect(fixture.provider.receivedIntent).toBeUndefined();
  });
});
