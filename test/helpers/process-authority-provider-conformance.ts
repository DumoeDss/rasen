import { describe, expect, it } from 'vitest';

import {
  createProcessAuthorityCoordinator,
  createProcessAuthorityPublicationAcknowledgement,
  isExactScopeEmptyReceipt,
  mapProcessAuthorityObservation,
  ProcessAuthorityProviderRegistry,
  type AuthorityPrepareInput,
  type AuthorityScheduler,
  type MonotonicClock,
  type ProcessAuthorityProvider,
  type ProcessAuthorityProviderDescriptor,
  type ProcessAuthorityProviderManifest,
  type ProviderControlOutcome,
  type ProviderObservation,
} from '../../src/core/session-host/process-authority/index.js';

export const PROCESS_AUTHORITY_PROVIDER_MUTATIONS = Object.freeze([
  'activate-before-publication',
  'tuple-manifest-mismatch',
  'reference-tamper-future-version',
  'optimistic-close',
  'unavailable-uncertain-retention',
  'identity-drift',
  'event-gap',
  'timeout',
  'control-loss',
  'duplicate-late-outcomes',
  'reference-reuse',
  'broken-abort',
  'adapter-authority-loss',
] as const);

export type ProcessAuthorityProviderMutation =
  (typeof PROCESS_AUTHORITY_PROVIDER_MUTATIONS)[number];

export interface ProcessAuthorityProviderConformanceFixture {
  readonly descriptor: ProcessAuthorityProviderDescriptor;
  readonly input: AuthorityPrepareInput;
  readonly provider: ProcessAuthorityProvider;
  readonly workloadStarts: () => number;
  readonly clock: MonotonicClock;
  readonly manifest: ProcessAuthorityProviderManifest;
  readonly manifestRoot: string;
  setObservation(value: ProviderObservation): void;
  setControl(value: ProviderControlOutcome): void;
  setScenario(value:
    | 'normal'
    | 'optimistic-close'
    | 'unavailable'
    | 'uncertain'
    | 'identity-drift'
    | 'event-gap'
    | 'timeout'
    | 'control-loss'
    | 'late-control'
    | 'adapter-authority-loss'
  ): void;
  externalFacts(): {
    readonly actualEmpty: boolean;
    readonly destructiveControls: number;
    readonly releasedWithoutExactReceipt: boolean;
  };
  flushEvents(): Promise<void>;
}

export type ProcessAuthorityProviderConformanceFixtureFactory =
  (mutation?: ProcessAuthorityProviderMutation) => ProcessAuthorityProviderConformanceFixture;

function createFixtureRegistry(
  fixture: ProcessAuthorityProviderConformanceFixture
): ProcessAuthorityProviderRegistry {
  return new ProcessAuthorityProviderRegistry([fixture.provider], {
    manifest: fixture.manifest,
    manifestRoot: fixture.manifestRoot,
  });
}

async function preparePublished(fixture: ProcessAuthorityProviderConformanceFixture) {
  let operation = 0;
  const coordinator = createProcessAuthorityCoordinator({
    registry: createFixtureRegistry(fixture),
    clock: fixture.clock,
    operationId: () => `conformance-${++operation}`,
  });
  const prepared = await coordinator.prepare(fixture.descriptor, fixture.input);
  expect(prepared.state).toBe('prepared-inert');
  if (prepared.state !== 'prepared-inert') throw new Error('expected inert authority');
  const published = await prepared.publish(async (binding) =>
    createProcessAuthorityPublicationAcknowledgement(binding)
  );
  expect(published.state).toBe('published-inert');
  if (published.state !== 'published-inert') throw new Error('expected published authority');
  return { coordinator, prepared, published };
}

/** Unchanged suite body imported by every platform provider fixture. */
export function processAuthorityProviderConformanceSuite(
  name: string,
  factory: ProcessAuthorityProviderConformanceFixtureFactory
): void {
  describe(name, () => {
    it('keeps preparation inert until exact publication and activates once', async () => {
      const fixture = factory();
      const { published } = await preparePublished(fixture);
      expect(fixture.workloadStarts()).toBe(0);
      await expect(published.activate()).resolves.toMatchObject({ state: 'live' });
      expect(fixture.workloadStarts()).toBe(1);
      await expect(published.activate()).resolves.toMatchObject({
        state: 'ordering-conflict',
        phase: 'activate',
      });
      expect(fixture.workloadStarts()).toBe(1);
    });

    it('rejects publication identity mismatch without activating workload code', async () => {
      const fixture = factory();
      let operation = 0;
      const coordinator = createProcessAuthorityCoordinator({
        registry: createFixtureRegistry(fixture),
        clock: fixture.clock,
        operationId: () => `publication-mismatch-${++operation}`,
      });
      const prepared = await coordinator.prepare(fixture.descriptor, fixture.input);
      if (prepared.state !== 'prepared-inert') throw new Error('expected inert authority');
      const exact = createProcessAuthorityPublicationAcknowledgement(prepared.publicationBinding);
      await expect(prepared.publish(async () => ({
        ...exact,
        referenceDigest: '0'.repeat(64),
      }))).resolves.toMatchObject({ state: 'control-loss', phase: 'publish' });
      expect(fixture.workloadStarts()).toBe(0);
      await expect(prepared.abort('publication-mismatch-reconciliation')).resolves.toMatchObject({
        state: 'exact-scope-empty',
      });
    });

    it('keeps root exit distinct and releases only an authentic exact-empty receipt', async () => {
      const fixture = factory();
      const { coordinator, prepared } = await preparePublished(fixture);
      fixture.setObservation({ state: 'root-exited', code: 9, signal: null });
      const root = await coordinator.inspect(prepared.reference);
      expect(root).toMatchObject({ state: 'root-exited', code: 9, signal: null });
      expect(isExactScopeEmptyReceipt(root)).toBe(false);
      fixture.setControl({ state: 'exact-scope-empty' });
      const closed = await coordinator.terminate(prepared.reference, {
        reason: 'conformance',
        graceMs: 0,
      });
      expect(isExactScopeEmptyReceipt(closed)).toBe(true);
    });

    it('rejects root exit without either an exact code or signal on observe and control', async () => {
      const fixture = factory();
      const { coordinator, prepared } = await preparePublished(fixture);
      fixture.setObservation({
        state: 'root-exited',
        code: null,
        signal: null,
      } as ProviderObservation);
      await expect(coordinator.inspect(prepared.reference)).resolves.toMatchObject({
        state: 'control-loss',
        phase: 'inspect',
      });
      fixture.setControl({
        state: 'root-exited',
        code: null,
        signal: null,
      } as ProviderControlOutcome);
      await expect(coordinator.terminate(prepared.reference, {
        reason: 'root-status-conformance',
        graceMs: 0,
      })).resolves.toMatchObject({ state: 'control-loss', phase: 'terminate' });
    });

    it('accepts natural exact empty only through an authentic coordinator receipt', async () => {
      const fixture = factory();
      const { coordinator, prepared } = await preparePublished(fixture);
      fixture.setObservation({ state: 'exact-scope-empty' });
      const empty = await coordinator.observeExactScopeEmpty(prepared.reference);
      expect(isExactScopeEmptyReceipt(empty)).toBe(true);
    });

    it.each([
      ['authority-unavailable', 'unavailable'],
      ['authority-uncertain', 'uncertain'],
      ['identity-drift', 'identity changed'],
      ['event-gap', 'event gap'],
    ] as const)('retains %s without optimistic release', async (state, diagnostic) => {
      const fixture = factory();
      const { coordinator, prepared } = await preparePublished(fixture);
      fixture.setObservation({ state, diagnostic });
      const outcome = await coordinator.inspect(prepared.reference);
      expect(outcome).toEqual({ state, reference: prepared.reference, diagnostic });
      expect(isExactScopeEmptyReceipt(outcome)).toBe(false);
    });

    it('fails a mismatched exact tuple closed without provider fallback', async () => {
      const fixture = factory();
      const coordinator = createProcessAuthorityCoordinator({
        registry: createFixtureRegistry(fixture),
      });
      await expect(coordinator.prepare({
        ...fixture.descriptor,
        protocolVersion: fixture.descriptor.protocolVersion + 1,
      }, fixture.input)).resolves.toMatchObject({ state: 'authority-unavailable' });
      expect(fixture.workloadStarts()).toBe(0);
    });

    it('uses the manifest-bound registry on the operational preparation path', async () => {
      const fixture = factory();
      const registry = createFixtureRegistry(fixture);
      expect(registry.select(fixture.descriptor)).toMatchObject({
        state: 'selected',
        descriptor: fixture.descriptor,
      });
      const prepared = await createProcessAuthorityCoordinator({ registry }).prepare(
        fixture.descriptor,
        fixture.input
      );
      expect(prepared.state).toBe('prepared-inert');
    });

    it.each(['prepared-inert', 'published-inert'] as const)(
      'preserves %s during replacement recovery',
      async (state) => {
        const fixture = factory();
        const { coordinator, prepared } = await preparePublished(fixture);
        fixture.setObservation({ state });
        await expect(coordinator.inspect(prepared.reference)).resolves.toEqual({
          state,
          reference: prepared.reference,
        });
      }
    );

    it.each(['prepared', 'published'] as const)(
      'returns an authentic exact-empty receipt for %s abort',
      async (phase) => {
        const fixture = factory();
        let operation = 0;
        const coordinator = createProcessAuthorityCoordinator({
          registry: createFixtureRegistry(fixture),
          clock: fixture.clock,
          operationId: () => `exact-${phase}-abort-${++operation}`,
        });
        const prepared = await coordinator.prepare(fixture.descriptor, fixture.input);
        if (prepared.state !== 'prepared-inert') throw new Error('expected inert authority');
        const abortable = phase === 'prepared'
          ? prepared
          : await prepared.publish(async (binding) =>
              createProcessAuthorityPublicationAcknowledgement(binding)
            );
        if (abortable.state !== `${phase}-inert`) throw new Error(`expected ${phase} authority`);
        expect(isExactScopeEmptyReceipt(await abortable.abort('exact-abort-proof'))).toBe(true);
        expect(fixture.workloadStarts()).toBe(0);
      }
    );

    it.each(['prepared', 'published'] as const)(
      'retains a broken %s abort without forging exact empty',
      async (phase) => {
        const fixture = factory();
        fixture.setControl({ state: 'authority-uncertain', diagnostic: 'abort not observed empty' });
        let operation = 0;
        const coordinator = createProcessAuthorityCoordinator({
          registry: createFixtureRegistry(fixture),
          clock: fixture.clock,
          operationId: () => `broken-${phase}-abort-${++operation}`,
        });
        const prepared = await coordinator.prepare(fixture.descriptor, fixture.input);
        if (prepared.state !== 'prepared-inert') throw new Error('expected inert authority');
        const abortable = phase === 'prepared'
          ? prepared
          : await prepared.publish(async (binding) =>
              createProcessAuthorityPublicationAcknowledgement(binding)
            );
        if (abortable.state !== `${phase}-inert`) throw new Error(`expected ${phase} authority`);
        const outcome = await abortable.abort('broken-abort-proof');
        expect(outcome).toMatchObject({
          state: 'authority-uncertain',
          reference: prepared.reference,
        });
        expect(isExactScopeEmptyReceipt(outcome)).toBe(false);
      }
    );

    it('rejects tampered recovery bytes before provider control', async () => {
      const fixture = factory();
      const { coordinator, prepared } = await preparePublished(fixture);
      const text = String(prepared.reference);
      const tampered = `${text.slice(0, -1)}${text.endsWith('A') ? 'B' : 'A'}` as typeof prepared.reference;
      await expect(coordinator.inspect(tampered)).resolves.toMatchObject({
        state: 'authority-unavailable',
        reference: tampered,
      });

      const future = String(prepared.reference).replace(
        'rasen-process-authority/1:',
        'rasen-process-authority/2:'
      ) as typeof prepared.reference;
      await expect(coordinator.inspect(future)).resolves.toMatchObject({
        state: 'authority-unavailable',
        reference: future,
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
    ] as const)('bounds the shared %s phase without optimistic release', async (phase) => {
      const fixture = factory();
      let operation = 0;
      const coordinator = createProcessAuthorityCoordinator({
        registry: createFixtureRegistry(fixture),
        clock: fixture.clock,
        scheduler: {
          set(_delay, callback, context) {
            if (context.phase === phase) callback();
            return context.operationId;
          },
          clear() {},
        },
        operationId: () => `shared-${phase}-deadline-${++operation}`,
      });
      const prepared = await coordinator.prepare(fixture.descriptor, fixture.input);
      if (phase === 'prepare') {
        expect(prepared).toMatchObject({ state: 'timeout', phase });
        return;
      }
      if (prepared.state !== 'prepared-inert') throw new Error('expected inert authority');
      if (phase === 'abort') {
        const outcome = await prepared.abort('shared-timeout');
        expect(outcome).toMatchObject({ state: 'timeout', phase });
        expect(isExactScopeEmptyReceipt(outcome)).toBe(false);
        return;
      }
      const published = await prepared.publish(async (binding) =>
        createProcessAuthorityPublicationAcknowledgement(binding)
      );
      if (phase === 'publish') {
        expect(published).toMatchObject({ state: 'timeout', phase });
        return;
      }
      if (published.state !== 'published-inert') throw new Error('expected published authority');
      if (phase === 'activate') {
        const outcome = await published.activate();
        expect(outcome).toMatchObject({ state: 'timeout', phase });
        return;
      }
      const outcome = phase === 'inspect'
        ? await coordinator.inspect(prepared.reference)
        : phase === 'terminate'
          ? await coordinator.terminate(prepared.reference, { reason: 'shared-timeout', graceMs: 0 })
          : await coordinator.observeExactScopeEmpty(prepared.reference);
      expect(outcome).toMatchObject({ state: 'timeout', phase });
      expect(isExactScopeEmptyReceipt(outcome)).toBe(false);
    });

    it('quarantines a control result delivered after the shared deadline', async () => {
      const fixture = factory();
      const elapsed: Array<() => void> = [];
      let operation = 0;
      const coordinator = createProcessAuthorityCoordinator({
        registry: createFixtureRegistry(fixture),
        clock: fixture.clock,
        scheduler: {
          set(_delay, callback, context) {
            if (context.phase === 'inspect') elapsed.push(callback);
            return context.operationId;
          },
          clear() {},
        },
        operationId: () => `shared-late-control-${++operation}`,
      });
      const prepared = await coordinator.prepare(fixture.descriptor, fixture.input);
      if (prepared.state !== 'prepared-inert') throw new Error('expected inert authority');
      const published = await prepared.publish(async (binding) =>
        createProcessAuthorityPublicationAcknowledgement(binding)
      );
      if (published.state !== 'published-inert') throw new Error('expected published authority');
      fixture.setScenario('late-control');
      const observing = coordinator.inspect(prepared.reference);
      await Promise.resolve();
      await Promise.resolve();
      elapsed.at(-1)?.();
      await expect(observing).resolves.toMatchObject({ state: 'timeout', phase: 'inspect' });
      await fixture.flushEvents();
      fixture.setScenario('normal');
      await expect(coordinator.inspect(prepared.reference)).resolves.toMatchObject({ state: 'live' });
    });

    it('passes the complete provider-neutral measured invariant probe', async () => {
      const measured = await measureProcessAuthorityProviderConformance(factory());
      assertProcessAuthorityMutationSnapshot(measured);
    });
  });
}

export interface ProcessAuthorityMutationSnapshot {
  readonly publishBeforeActivate: boolean;
  readonly exactTuple: boolean;
  readonly opaqueReference: boolean;
  readonly noOptimisticClose: boolean;
  readonly unavailableRetained: boolean;
  readonly uncertainRetained: boolean;
  readonly identityDriftRetained: boolean;
  readonly eventGapRetained: boolean;
  readonly timeoutRetained: boolean;
  readonly controlLossRetained: boolean;
  readonly singleSettlement: boolean;
  readonly freshReferencePerPrepare: boolean;
  readonly preparedAbortExact: boolean;
  readonly publishedAbortExact: boolean;
  readonly adapterAuthorityRetained: boolean;
}

export const GREEN_PROCESS_AUTHORITY_MUTATION_SNAPSHOT: ProcessAuthorityMutationSnapshot =
  Object.freeze({
    publishBeforeActivate: true,
    exactTuple: true,
    opaqueReference: true,
    noOptimisticClose: true,
    unavailableRetained: true,
    uncertainRetained: true,
    identityDriftRetained: true,
    eventGapRetained: true,
    timeoutRetained: true,
    controlLossRetained: true,
    singleSettlement: true,
    freshReferencePerPrepare: true,
    preparedAbortExact: true,
    publishedAbortExact: true,
    adapterAuthorityRetained: true,
  });

/** Measures public behavior plus provider-neutral external authority facts. */
export async function measureProcessAuthorityProviderConformance(
  fixture: ProcessAuthorityProviderConformanceFixture
): Promise<ProcessAuthorityMutationSnapshot> {
  let exactTuple = true;
  let registry: ProcessAuthorityProviderRegistry | undefined;
  try {
    registry = createFixtureRegistry(fixture);
  } catch {
    exactTuple = false;
  }

  if (!registry) {
    return Object.freeze({
      ...GREEN_PROCESS_AUTHORITY_MUTATION_SNAPSHOT,
      exactTuple,
    });
  }

  let operation = 0;
  const coordinator = createProcessAuthorityCoordinator({
    registry,
    clock: fixture.clock,
    operationId: () => `mutation-probe-${++operation}`,
  });
  const abortPrepared = await coordinator.prepare(fixture.descriptor, fixture.input);
  const preparedAbortExact = abortPrepared.state === 'prepared-inert' &&
    isExactScopeEmptyReceipt(await abortPrepared.abort('prepared-abort-mutation-probe'));
  const abortPublishedPreparation = await coordinator.prepare(fixture.descriptor, fixture.input);
  let publishedAbortExact = false;
  if (abortPublishedPreparation.state === 'prepared-inert') {
    const abortPublished = await abortPublishedPreparation.publish(async (binding) =>
      createProcessAuthorityPublicationAcknowledgement(binding)
    );
    publishedAbortExact = abortPublished.state === 'published-inert' &&
      isExactScopeEmptyReceipt(await abortPublished.abort('published-abort-mutation-probe'));
  }
  const prepared = await coordinator.prepare(fixture.descriptor, fixture.input);
  const publishBeforeActivate = fixture.workloadStarts() === 0;
  if (prepared.state !== 'prepared-inert') {
    return Object.freeze({
      ...GREEN_PROCESS_AUTHORITY_MUTATION_SNAPSHOT,
      exactTuple,
      publishBeforeActivate,
      opaqueReference: false,
      preparedAbortExact,
      publishedAbortExact,
    });
  }
  const opaqueReference = String(prepared.reference).startsWith('rasen-process-authority/1:');
  const published = await prepared.publish(async (binding) =>
    createProcessAuthorityPublicationAcknowledgement(binding)
  );
  if (published.state !== 'published-inert') {
    return Object.freeze({
      ...GREEN_PROCESS_AUTHORITY_MUTATION_SNAPSHOT,
      exactTuple,
      publishBeforeActivate,
      opaqueReference,
      preparedAbortExact,
      publishedAbortExact,
    });
  }
  await published.activate();
  await fixture.flushEvents();
  const singleSettlement = fixture.workloadStarts() === 1;
  const nextPrepared = await coordinator.prepare(fixture.descriptor, fixture.input);
  const freshReferencePerPrepare = nextPrepared.state === 'prepared-inert' &&
    nextPrepared.reference !== prepared.reference;
  if (nextPrepared.state === 'prepared-inert') await nextPrepared.abort('fresh-reference-probe');

  fixture.setScenario('optimistic-close');
  const optimistic = await coordinator.inspect(prepared.reference);
  const noOptimisticClose = !isExactScopeEmptyReceipt(optimistic) ||
    fixture.externalFacts().actualEmpty;

  fixture.setScenario('unavailable');
  const unavailable = await coordinator.inspect(prepared.reference);
  const unavailableRetained = unavailable.state === 'authority-unavailable' &&
    !isExactScopeEmptyReceipt(unavailable);

  fixture.setScenario('uncertain');
  const uncertain = await coordinator.inspect(prepared.reference);
  const uncertainRetained = uncertain.state === 'authority-uncertain' &&
    !isExactScopeEmptyReceipt(uncertain);

  fixture.setScenario('identity-drift');
  const drift = await coordinator.inspect(prepared.reference);
  await coordinator.terminate(prepared.reference, { reason: 'drift-probe', graceMs: 0 });
  const identityDriftRetained = drift.state === 'identity-drift' &&
    fixture.externalFacts().destructiveControls === 0;

  fixture.setScenario('event-gap');
  const gap = await coordinator.inspect(prepared.reference);
  await coordinator.terminate(prepared.reference, { reason: 'gap-probe', graceMs: 0 });
  const eventGapRetained = gap.state === 'event-gap' &&
    fixture.externalFacts().destructiveControls === 0;

  const timeoutCallbacks: Array<() => void> = [];
  const timeoutScheduler: AuthorityScheduler = {
    set(_delay, elapsed, context) {
      if (context.phase === 'inspect') timeoutCallbacks.push(elapsed);
      return context.operationId;
    },
    clear() {},
  };
  let timeoutOperation = 0;
  const timeoutCoordinator = createProcessAuthorityCoordinator({
    registry: createFixtureRegistry(fixture),
    clock: fixture.clock,
    scheduler: timeoutScheduler,
    operationId: () => `timeout-probe-${++timeoutOperation}`,
  });
  fixture.setScenario('normal');
  const timeoutPrepared = await timeoutCoordinator.prepare(fixture.descriptor, fixture.input);
  let timeoutRetained = false;
  if (timeoutPrepared.state === 'prepared-inert') {
    const timeoutPublished = await timeoutPrepared.publish(async (binding) =>
      createProcessAuthorityPublicationAcknowledgement(binding)
    );
    if (timeoutPublished.state === 'published-inert') {
      fixture.setScenario('timeout');
      const timingOut = timeoutCoordinator.inspect(timeoutPrepared.reference);
      await Promise.resolve();
      timeoutCallbacks.at(-1)?.();
      const timedOut = await timingOut;
      timeoutRetained = timedOut.state === 'timeout' &&
        !fixture.externalFacts().releasedWithoutExactReceipt;
    }
  }

  fixture.setScenario('control-loss');
  const lost = await coordinator.inspect(prepared.reference);
  const controlLossRetained = lost.state === 'control-loss' &&
    !fixture.externalFacts().releasedWithoutExactReceipt;

  fixture.setScenario('adapter-authority-loss');
  const adapterLoss = await coordinator.inspect(prepared.reference);
  const mappedAdapterLoss = mapProcessAuthorityObservation(adapterLoss);
  const adapterAuthorityRetained = mappedAdapterLoss.state !== 'closed' &&
    !fixture.externalFacts().releasedWithoutExactReceipt;

  return Object.freeze({
    publishBeforeActivate,
    exactTuple,
    opaqueReference,
    noOptimisticClose,
    unavailableRetained,
    uncertainRetained,
    identityDriftRetained,
    eventGapRetained,
    timeoutRetained,
    controlLossRetained,
    singleSettlement,
    freshReferencePerPrepare,
    preparedAbortExact,
    publishedAbortExact,
    adapterAuthorityRetained,
  });
}

export function assertProcessAuthorityMutationSnapshot(
  snapshot: ProcessAuthorityMutationSnapshot
): void {
  expect(snapshot).toEqual(GREEN_PROCESS_AUTHORITY_MUTATION_SNAPSHOT);
}
