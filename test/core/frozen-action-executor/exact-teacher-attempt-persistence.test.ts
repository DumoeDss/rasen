import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  EXACT_TEACHER_ATTEMPT_PHASES,
  createExactTeacherAttemptJournal,
  createExactTeacherAttemptPersistence,
} from '../../../src/core/frozen-action-executor/index.js';
import type {
  AgentSessionBackend,
  AgentSessionTransport,
  BackendTurnStream,
} from '../../../src/core/session-host/backend.js';
import type {
  ExactTeacherAttemptPhaseCommit,
  ExactTeacherAttemptSeed,
} from '../../../src/core/session-host/contracts.js';
import { createSessionHost } from '../../../src/core/session-host/host.js';
import {
  PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  createProcessAuthorityCoordinator,
  createProcessAuthorityPublicationAcknowledgement,
  isExactScopeEmptyReceipt,
  type AuthorityOperationContext,
  type ExactScopeEmptyReceipt,
  type ProcessAuthorityProvider,
  type ProviderAuthorityReference,
} from '../../../src/core/session-host/process-authority/index.js';
import { createProviderAuthorityReference } from '../../../src/core/session-host/process-authority/reference-codec.js';
import { asProcessRef } from '../../../src/core/session-host/process-scope.js';
import {
  SessionHostRegistryError,
  createSessionHostRegistry,
  digestSessionHostText,
  type SessionHostRegistry,
} from '../../../src/core/session-host/registry.js';
import { createTestProcessAuthorityProviderRegistry } from '../../helpers/process-authority-test-registry.js';
import { cleanupTempPath } from '../../helpers/temp-cleanup.js';

const roots: string[] = [];
const providerTuple = {
  providerId: 'test.exact-teacher-persistence',
  capabilityId: RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  protocolVersion: 1,
} as const;

class ReceiptProvider implements ProcessAuthorityProvider {
  readonly descriptor = {
    ...providerTuple,
    commonContractVersion: PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
    providerReferenceVersion: 1,
    semantics: RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  } as const;
  readonly reference: ProviderAuthorityReference = createProviderAuthorityReference(
    1,
    Buffer.from('exact-teacher-persistence')
  );

  async prepare() {
    return {
      reference: this.reference,
      async activate(_context: AuthorityOperationContext) {
        return { state: 'live' as const };
      },
    };
  }
  async inspect() { return { state: 'live' as const }; }
  async terminate() { return { state: 'exact-scope-empty' as const }; }
  async abort() { return { state: 'exact-scope-empty' as const }; }
}

async function authenticReceipt(): Promise<ExactScopeEmptyReceipt> {
  const provider = new ReceiptProvider();
  const coordinator = createProcessAuthorityCoordinator({
    registry: createTestProcessAuthorityProviderRegistry([provider]),
  });
  const prepared = await coordinator.prepare(providerTuple, {
    command: process.execPath,
    args: [],
    cwd: process.cwd(),
    env: {},
  });
  if (prepared.state !== 'prepared-inert') throw new Error('fixture prepare failed');
  const published = await prepared.publish(async (binding) =>
    createProcessAuthorityPublicationAcknowledgement(binding));
  if (published.state !== 'published-inert') throw new Error('fixture publish failed');
  const receipt = await published.abort('fixture-receipt');
  if (!isExactScopeEmptyReceipt(receipt)) throw new Error('fixture receipt is not authentic');
  return receipt;
}

function resultStream(): BackendTurnStream {
  return {
    accepted: Promise.resolve(),
    async *[Symbol.asyncIterator]() {
      yield { type: 'init', sessionId: 'backend-session:persistence' };
      yield { type: 'result', sessionId: 'backend-session:persistence', content: '{"ok":true}' };
    },
  };
}

async function durableFrontierFixture(input: {
  readonly label: string;
  readonly sessionRevision: number;
  readonly sessionPhase: 'activated' | 'request-sent';
  readonly sessionBaseline: string;
  readonly journalRevision: number;
  readonly journalPhase: 'activated' | 'request-sent';
  readonly journalBaseline: string;
}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `rasen-exact-${input.label}-`));
  roots.push(root);
  const processRef = String((await authenticReceipt()).reference);
  const stateDir = path.join(root, 'host');
  const journalRoot = path.join(root, 'journal');
  const now = '2026-08-10T00:00:00.000Z';
  const seed: ExactTeacherAttemptSeed = {
    attemptId: `attempt:${input.label}`,
    provider: providerTuple,
    runId: `run:${input.label}`,
    actionId: `action:${input.label}`,
    invocationId: `invocation:${input.label}`,
    attempt: 1,
    stableSessionId: '88888888-8888-4888-8888-888888888888',
    requestId: '99999999-9999-4999-8999-999999999999',
  };
  const registry = createSessionHostRegistry({ stateDir });
  await registry.create({
    sessionId: seed.stableSessionId,
    backend: 'replay',
    cwd: fs.realpathSync.native(root),
    cwdDigest: digestSessionHostText(fs.realpathSync.native(root)),
    hostState: 'idle',
    generation: 1,
    createdAt: now,
    updatedAt: now,
    requests: [{
      requestId: seed.requestId,
      inputDigest: 'f'.repeat(64),
      generation: 1,
      state: 'prepared',
      preparedAt: now,
    }],
    process: {
      generation: 1,
      ownerToken: `${input.label}-owner`,
      runtimeRef: processRef as never,
      preparedAt: now,
    },
    exactTeacherAttempt: {
      schema: 'rasen-exact-teacher-session-attempt/1',
      recordVersion: 1,
      ...seed,
      processRef,
      journalRevision: input.sessionRevision,
      phase: input.sessionPhase,
      baselineIdentity: input.sessionBaseline,
    },
  });
  const journal = createExactTeacherAttemptJournal({ root: journalRoot });
  journal.create({
    schema: 'rasen-exact-teacher-attempt-journal/1',
    recordVersion: 1,
    revision: input.journalRevision,
    ...seed,
    processRef,
    baselineIdentity: input.journalBaseline,
    phase: input.journalPhase,
  });
  const journalPath = path.join(journalRoot, fs.readdirSync(journalRoot)[0]!);
  return Object.freeze({
    committer: createExactTeacherAttemptPersistence({ journal, sessionRegistry: registry }),
    journal,
    journalPath,
    registry,
    seed,
    stateDir,
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) cleanupTempPath(root);
});

describe('exact Teacher attempt journal/SessionHost persistence', () => {
  it('durably prepares and activates before the only request send', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-exact-attempt-persistence-'));
    roots.push(root);
    const exactReceipt = await authenticReceipt();
    const processRef = asProcessRef(String(exactReceipt.reference));
    let sends = 0;
    let resolveClosed!: (value: unknown) => void;
    const closed = new Promise<unknown>((resolve) => { resolveClosed = resolve; });
    const transport: AgentSessionTransport = {
      runtimeRef: processRef,
      closed,
      send() {
        sends += 1;
        return resultStream();
      },
      async terminate() {
        resolveClosed({ exactScopeEmptyReceipt: exactReceipt });
        return {
          closed: true,
          cancelledBeforeWork: false,
          exactScopeEmptyReceipt: exactReceipt,
        };
      },
    };
    const backend: AgentSessionBackend = {
      id: 'replay',
      async prepare(input) {
        return {
          runtimeRef: processRef,
          async activate() {
            await input.onExactAuthorityPhase?.('authority-published-inert', processRef);
            await input.onExactAuthorityPhase?.('activated', processRef);
            return transport;
          },
          async abort() {
            return { state: 'closed' as const, exactScopeEmptyReceipt: exactReceipt };
          },
        };
      },
    };
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'host') });
    const committer = createExactTeacherAttemptPersistence({
      journal: createExactTeacherAttemptJournal({ root: path.join(root, 'journal') }),
      sessionRegistry: registry,
    });
    const host = createSessionHost({
      registry,
      backends: [backend],
      exactRetirementAuthority: 'coordinator-authenticated',
      exactTeacherAttemptCommitter: committer,
    });
    const seed: ExactTeacherAttemptSeed = {
      attemptId: 'attempt:exact-persistence',
      provider: providerTuple,
      runId: 'run:exact-persistence',
      actionId: 'action:exact-persistence',
      invocationId: 'invocation:exact-persistence',
      attempt: 1,
      stableSessionId: '11111111-1111-4111-8111-111111111111',
      requestId: '22222222-2222-4222-8222-222222222222',
    };
    await committer.commit(seed, 'canonical-preflight');
    await committer.commit(seed, 'baseline-stable', {
      baselineIdentity: 'workspace-baseline:exact-persistence',
    });
    await host.reconcileOnStart();
    const command = {
      op: 'execute' as const,
      requestId: seed.requestId,
      backend: 'replay',
      cwd: root,
      input: '{"question":"fixture"}',
      limits: { timeoutMs: 10_000, maxInputBytes: 4096, maxOutputBytes: 4096 },
      sandbox: 'read-only' as const,
      authority: {
        invocationId: seed.invocationId,
        role: 'teacher',
        workspaceInstanceId: 'workspace:exact-persistence',
        backend: 'hosted' as const,
      },
    };

    const prepared = await host.dispatch({
      ...command,
      newSessionId: seed.stableSessionId,
      exactTeacherAttempt: { mode: 'prepare-only', seed },
    });
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared).toMatchObject({ ok: true, requestId: seed.requestId });
    expect(sends).toBe(0);
    expect(committer.load(seed.attemptId)).toMatchObject({
      phase: 'activated',
      processRef: String(processRef),
    });
    expect(registry.get(seed.stableSessionId)).toMatchObject({
      requests: [{ requestId: seed.requestId, state: 'prepared' }],
      exactTeacherAttempt: { phase: 'activated', processRef: String(processRef) },
    });

    await committer.commit(seed, 'request-sent', { processRef: String(processRef) });
    const settled = await host.dispatch({
      ...command,
      sessionId: seed.stableSessionId,
      exactTeacherAttempt: { mode: 'send-prepared', seed },
    });
    expect(settled).toMatchObject({ ok: true, result: '{"ok":true}' });
    expect(sends).toBe(1);
    if (!settled.ok || settled.receipt?.resultRef === undefined || settled.receipt.resultDigest === undefined) {
      throw new Error('fixture turn did not settle');
    }
    await committer.commit(seed, 'result-quarantined', {
      processRef: String(processRef),
      quarantineIdentity: `quarantine:sha256:${settled.receipt.resultDigest}`,
      hostedReceipt: {
        stableSessionId: seed.stableSessionId,
        requestId: seed.requestId,
        resultRef: settled.receipt.resultRef,
        resultDigest: settled.receipt.resultDigest,
      },
    });
    expect(committer.load(seed.attemptId)).toMatchObject({
      phase: 'result-quarantined',
      hostedReceipt: { requestId: seed.requestId },
      quarantineIdentity: `quarantine:sha256:${settled.receipt.resultDigest}`,
    });

    await host.shutdown('server-shutdown');
  });

  it('retains a foreign durable authority union without rewriting either store', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-exact-foreign-union-'));
    roots.push(root);
    const processRef = String((await authenticReceipt()).reference);
    const stateDir = path.join(root, 'host');
    const journalRoot = path.join(root, 'journal');
    const stableSessionId = '55555555-5555-4555-8555-555555555555';
    const requestId = '66666666-6666-4666-8666-666666666666';
    const foreignRequestId = '77777777-7777-4777-8777-777777777777';
    const now = '2026-08-10T00:00:00.000Z';
    const seed: ExactTeacherAttemptSeed = {
      attemptId: 'attempt:foreign-union',
      provider: providerTuple,
      runId: 'run:canonical-union',
      actionId: 'action:canonical-union',
      invocationId: 'invocation:canonical-union',
      attempt: 1,
      stableSessionId,
      requestId,
    };
    const registry = createSessionHostRegistry({ stateDir });
    await registry.create({
      sessionId: stableSessionId,
      backend: 'replay',
      cwd: fs.realpathSync.native(root),
      cwdDigest: digestSessionHostText(fs.realpathSync.native(root)),
      hostState: 'idle',
      generation: 1,
      createdAt: now,
      updatedAt: now,
      requests: [requestId, foreignRequestId].map((durableRequestId) => ({
        requestId: durableRequestId,
        inputDigest: 'f'.repeat(64),
        generation: 1,
        state: durableRequestId === foreignRequestId
          ? 'prepared' as const
          : 'cancelled' as const,
        preparedAt: now,
      })),
      process: {
        generation: 1,
        ownerToken: 'foreign-union-owner',
        runtimeRef: processRef as never,
        preparedAt: now,
      },
      exactTeacherAttempt: {
        schema: 'rasen-exact-teacher-session-attempt/1',
        recordVersion: 1,
        attemptId: seed.attemptId,
        provider: providerTuple,
        processRef,
        runId: 'run:foreign-union',
        actionId: 'action:foreign-union',
        invocationId: 'invocation:foreign-union',
        attempt: 1,
        stableSessionId,
        requestId: foreignRequestId,
        journalRevision: 5,
        phase: 'activated',
        baselineIdentity: 'workspace-baseline:foreign-union',
      },
    });
    const journal = createExactTeacherAttemptJournal({ root: journalRoot });
    journal.create({
      schema: 'rasen-exact-teacher-attempt-journal/1',
      recordVersion: 1,
      revision: 5,
      ...seed,
      processRef,
      baselineIdentity: 'workspace-baseline:foreign-union',
      phase: 'activated',
    });
    const journalPath = path.join(journalRoot, fs.readdirSync(journalRoot)[0]!);
    const registryBefore = fs.readFileSync(registry.paths.registryPath);
    const journalBefore = fs.readFileSync(journalPath);
    const committer = createExactTeacherAttemptPersistence({ journal, sessionRegistry: registry });

    await expect(committer.loadRecovery(seed.attemptId)).rejects.toMatchObject({
      name: 'ExactTeacherAttemptRecoveryLoadError',
      reason: 'authority-identity-mismatch',
    });
    expect(fs.readFileSync(registry.paths.registryPath)).toEqual(registryBefore);
    expect(fs.readFileSync(journalPath)).toEqual(journalBefore);
  });

  it.each([
    {
      label: 'same-phase-conflict',
      sessionRevision: 5,
      sessionPhase: 'activated',
      sessionBaseline: 'workspace-baseline:session',
      journalRevision: 5,
      journalPhase: 'activated',
      journalBaseline: 'workspace-baseline:journal',
    },
    {
      label: 'future-session-frontier',
      sessionRevision: 6,
      sessionPhase: 'request-sent',
      sessionBaseline: 'workspace-baseline:shared',
      journalRevision: 5,
      journalPhase: 'activated',
      journalBaseline: 'workspace-baseline:shared',
    },
  ] as const)(
    'retains $label without rewriting either durable frontier',
    async (input) => {
      const staged = await durableFrontierFixture(input);
      const registryBefore = fs.readFileSync(staged.registry.paths.registryPath);
      const journalBefore = fs.readFileSync(staged.journalPath);

      await expect(staged.committer.loadRecovery(staged.seed.attemptId))
        .rejects.toMatchObject({
          name: 'ExactTeacherAttemptRecoveryLoadError',
          reason: 'durable-frontier-conflict',
        });
      expect(fs.readFileSync(staged.registry.paths.registryPath)).toEqual(registryBefore);
      expect(fs.readFileSync(staged.journalPath)).toEqual(journalBefore);
    }
  );

  it('retains malformed journal bytes without rewriting either durable store', async () => {
    const staged = await durableFrontierFixture({
      label: 'malformed-journal',
      sessionRevision: 5,
      sessionPhase: 'activated',
      sessionBaseline: 'workspace-baseline:shared',
      journalRevision: 5,
      journalPhase: 'activated',
      journalBaseline: 'workspace-baseline:shared',
    });
    fs.appendFileSync(staged.journalPath, Buffer.from('malformed-private-bytes', 'utf8'));
    const registryBefore = fs.readFileSync(staged.registry.paths.registryPath);
    const journalBefore = fs.readFileSync(staged.journalPath);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(staged.committer.loadRecovery(staged.seed.attemptId))
        .rejects.toMatchObject({
          name: 'ExactTeacherAttemptRecoveryLoadError',
          reason: 'durable-journal-malformed',
        });
    }
    expect(fs.readFileSync(staged.registry.paths.registryPath)).toEqual(registryBefore);
    expect(fs.readFileSync(staged.journalPath)).toEqual(journalBefore);
  });

  it.each(['same-instance', 'independent-instance'] as const)(
    'makes simultaneous repair of the same journal-first gap idempotent with %s registries',
    async (mode) => {
    const staged = await durableFrontierFixture({
      label: `concurrent-journal-first-gap-${mode}`,
      sessionRevision: 5,
      sessionPhase: 'activated',
      sessionBaseline: 'workspace-baseline:shared',
      journalRevision: 6,
      journalPhase: 'request-sent',
      journalBaseline: 'workspace-baseline:shared',
    });
    const competingRegistry = mode === 'same-instance'
      ? staged.registry
      : createSessionHostRegistry({ stateDir: staged.stateDir });
    if (mode === 'independent-instance') await competingRegistry.load();
    let updateArrivals = 0;
    const observedRegistryCodes: string[] = [];
    let releaseUpdates!: () => void;
    const bothAtUpdate = new Promise<void>((resolve) => {
      releaseUpdates = resolve;
    });
    const concurrentRegistry = (
      registry: SessionHostRegistry
    ): SessionHostRegistry => Object.freeze({
      ...registry,
      async update(sessionId, expected, mutate) {
        updateArrivals += 1;
        if (updateArrivals === 2) releaseUpdates();
        await bothAtUpdate;
        try {
          return await registry.update(sessionId, expected, mutate);
        } catch (error) {
          if (error instanceof SessionHostRegistryError) {
            observedRegistryCodes.push(error.code);
          }
          throw error;
        }
      },
    });
    const firstCommitter = createExactTeacherAttemptPersistence({
      journal: staged.journal,
      sessionRegistry: concurrentRegistry(staged.registry),
    });
    const secondCommitter = createExactTeacherAttemptPersistence({
      journal: staged.journal,
      sessionRegistry: concurrentRegistry(competingRegistry),
    });

    const outcomes = await Promise.allSettled([
      firstCommitter.loadRecovery(staged.seed.attemptId),
      secondCommitter.loadRecovery(staged.seed.attemptId),
    ]);

    expect(updateArrivals).toBeGreaterThanOrEqual(2);
    if (mode === 'same-instance') {
      expect(observedRegistryCodes).toContain('stale-generation');
    } else {
      expect(observedRegistryCodes).toEqual(
        expect.arrayContaining(['registry-busy'])
      );
    }
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toEqual([]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      'fulfilled',
      'fulfilled',
    ]);
    for (const outcome of outcomes) {
      if (outcome.status !== 'fulfilled') continue;
      expect(outcome.value).toMatchObject({
        journal: { revision: 6, phase: 'request-sent' },
        session: {
          exactTeacherAttempt: { journalRevision: 6, phase: 'request-sent' },
        },
      });
    }
    }
  );

  it('makes simultaneous downstream phase projection idempotent', async () => {
    const staged = await durableFrontierFixture({
      label: 'concurrent-downstream-commit',
      sessionRevision: 5,
      sessionPhase: 'activated',
      sessionBaseline: 'workspace-baseline:shared',
      journalRevision: 5,
      journalPhase: 'activated',
      journalBaseline: 'workspace-baseline:shared',
    });
    const processRef = staged.committer.load(staged.seed.attemptId)?.processRef;
    if (processRef === undefined) throw new Error('fixture lost exact ProcessRef');
    let updateArrivals = 0;
    let releaseUpdates!: () => void;
    const bothAtUpdate = new Promise<void>((resolve) => {
      releaseUpdates = resolve;
    });
    const observedRegistryCodes: string[] = [];
    const registry: SessionHostRegistry = Object.freeze({
      ...staged.registry,
      async update(sessionId, expected, mutate) {
        updateArrivals += 1;
        if (updateArrivals === 2) releaseUpdates();
        await bothAtUpdate;
        try {
          return await staged.registry.update(sessionId, expected, mutate);
        } catch (error) {
          if (error instanceof SessionHostRegistryError) {
            observedRegistryCodes.push(error.code);
          }
          throw error;
        }
      },
    });
    const first = createExactTeacherAttemptPersistence({
      journal: staged.journal,
      sessionRegistry: registry,
    });
    const second = createExactTeacherAttemptPersistence({
      journal: staged.journal,
      sessionRegistry: registry,
    });

    const outcomes = await Promise.allSettled([
      first.commit(staged.seed, 'request-sent', { processRef }),
      second.commit(staged.seed, 'request-sent', { processRef }),
    ]);

    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      'fulfilled',
      'fulfilled',
    ]);
    expect(observedRegistryCodes).toContain('stale-generation');
    expect(staged.committer.load(staged.seed.attemptId)).toMatchObject({
      journalRevision: 6,
      phase: 'request-sent',
    });
    expect(staged.registry.get(staged.seed.stableSessionId)).toMatchObject({
      exactTeacherAttempt: { journalRevision: 6, phase: 'request-sent' },
    });
  });

  it('reopens every durable phase with the same exact identity union', async () => {
    const exactReceipt = await authenticReceipt();
    const processRef = String(exactReceipt.reference);
    const hostedReceipt = {
      stableSessionId: '33333333-3333-4333-8333-333333333333',
      requestId: '44444444-4444-4444-8444-444444444444',
      resultRef: `host-result:sha256:${'e'.repeat(64)}`,
      resultDigest: 'e'.repeat(64),
    } as const;
    const quarantineIdentity = `quarantine:sha256:${hostedReceipt.resultDigest}`;
    const baselineIdentity = 'workspace-baseline:phase-restart';

    for (const targetPhase of EXACT_TEACHER_ATTEMPT_PHASES) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-exact-phase-restart-'));
      roots.push(root);
      const stateDir = path.join(root, 'host');
      const journalRoot = path.join(root, 'journal');
      const registry = createSessionHostRegistry({ stateDir });
      const seed: ExactTeacherAttemptSeed = {
        attemptId: 'attempt:phase-restart',
        provider: providerTuple,
        runId: 'run:phase-restart',
        actionId: 'action:phase-restart',
        invocationId: 'invocation:phase-restart',
        attempt: 1,
        stableSessionId: hostedReceipt.stableSessionId,
        requestId: hostedReceipt.requestId,
      };
      const now = '2026-08-10T00:00:00.000Z';
      await registry.create({
        sessionId: seed.stableSessionId,
        backend: 'replay',
        cwd: fs.realpathSync.native(root),
        cwdDigest: digestSessionHostText(fs.realpathSync.native(root)),
        hostState: 'idle',
        generation: 1,
        createdAt: now,
        updatedAt: now,
        requests: [{
          requestId: seed.requestId,
          inputDigest: 'f'.repeat(64),
          generation: 1,
          state: 'prepared',
          preparedAt: now,
        }],
      });
      const journal = createExactTeacherAttemptJournal({ root: journalRoot });
      const committer = createExactTeacherAttemptPersistence({
        journal,
        sessionRegistry: registry,
      });

      for (const phase of EXACT_TEACHER_ATTEMPT_PHASES) {
        if (phase === 'result-quarantined') {
          const current = registry.get(seed.stableSessionId)!;
          await registry.update(
            current.sessionId,
            { generation: current.generation, revision: current.revision ?? 0 },
            (record) => ({
              ...record,
              requests: record.requests.map((request) => ({
                ...request,
                state: 'settled' as const,
                sentAt: now,
                settledAt: now,
                resultRef: hostedReceipt.resultRef,
                resultDigest: hostedReceipt.resultDigest,
              })),
            })
          );
        }
        const phaseIndex = EXACT_TEACHER_ATTEMPT_PHASES.indexOf(phase);
        const processIndex = EXACT_TEACHER_ATTEMPT_PHASES.indexOf(
          'authority-prepared-inert'
        );
        const baselineIndex = EXACT_TEACHER_ATTEMPT_PHASES.indexOf(
          'baseline-stable'
        );
        const resultIndex = EXACT_TEACHER_ATTEMPT_PHASES.indexOf(
          'result-quarantined'
        );
        const facts: ExactTeacherAttemptPhaseCommit = {
          ...(phaseIndex < baselineIndex ? {} : { baselineIdentity }),
          ...(phaseIndex < processIndex ? {} : { processRef }),
          ...(phaseIndex < resultIndex
            ? {}
            : { hostedReceipt, quarantineIdentity }),
        };
        if (phase === 'authority-prepared-inert') {
          // The host publishes the opaque authority reference and its exact
          // restart union in one registry CAS. There is deliberately no
          // parseable intermediate record containing only one of them.
          await committer.commit(seed, phase, {
            ...facts,
            deferSessionProjection: true,
          });
          const exactTeacherAttempt = committer.load(seed.attemptId)!;
          const current = registry.get(seed.stableSessionId)!;
          await registry.update(
            current.sessionId,
            { generation: current.generation, revision: current.revision ?? 0 },
            (record) => ({
              ...record,
              process: {
                generation: record.generation,
                ownerToken: 'phase-restart-owner',
                runtimeRef: processRef as never,
                preparedAt: now,
              },
              exactTeacherAttempt,
            })
          );
        } else if (phase === 'request-sent' && targetPhase === 'request-sent') {
          // Simulate a daemon crash after the journal replace but before the
          // matching private Session projection CAS.
          await committer.commit(seed, phase, {
            ...facts,
            deferSessionProjection: true,
          });
        } else {
          await committer.commit(seed, phase, facts);
        }
        if (phase === targetPhase) break;
      }

      const restartedJournal = createExactTeacherAttemptJournal({ root: journalRoot });
      const restartedRegistry = createSessionHostRegistry({ stateDir });
      await restartedRegistry.load();
      const durable = restartedJournal.load(seed.attemptId)!;
      const restartedCommitter = createExactTeacherAttemptPersistence({
        journal: restartedJournal,
        sessionRegistry: restartedRegistry,
      });
      const recovery = await restartedCommitter.loadRecovery(seed.attemptId);
      expect(recovery?.journal, targetPhase).toEqual(durable);
      expect(durable, targetPhase).toMatchObject({
        ...seed,
        phase: targetPhase,
      });
      const targetIndex = EXACT_TEACHER_ATTEMPT_PHASES.indexOf(targetPhase);
      const processIndex = EXACT_TEACHER_ATTEMPT_PHASES.indexOf(
        'authority-prepared-inert'
      );
      const baselineIndex = EXACT_TEACHER_ATTEMPT_PHASES.indexOf(
        'baseline-stable'
      );
      const resultIndex = EXACT_TEACHER_ATTEMPT_PHASES.indexOf(
        'result-quarantined'
      );
      if (targetIndex < processIndex) {
        expect(recovery?.session, targetPhase).toBeUndefined();
        expect(durable.processRef, targetPhase).toBeUndefined();
        expect(
          restartedRegistry.get(seed.stableSessionId)?.exactTeacherAttempt,
          targetPhase
        ).toBeUndefined();
      } else {
        expect(recovery?.session?.sessionId, targetPhase).toBe(seed.stableSessionId);
        expect(
          recovery?.session?.exactTeacherAttempt?.phase,
          targetPhase
        ).toBe(targetPhase);
        expect(durable.processRef, targetPhase).toBe(processRef);
        expect(
          restartedRegistry.get(seed.stableSessionId)?.exactTeacherAttempt,
          targetPhase
        ).toMatchObject({ ...seed, processRef, phase: targetPhase });
      }
      if (targetIndex < baselineIndex) {
        expect(durable.baselineIdentity, targetPhase).toBeUndefined();
      } else {
        expect(durable.baselineIdentity, targetPhase).toBe(baselineIdentity);
      }
      if (targetIndex < resultIndex) {
        expect(durable.hostedReceipt, targetPhase).toBeUndefined();
        expect(durable.quarantineIdentity, targetPhase).toBeUndefined();
      } else {
        expect(durable.hostedReceipt, targetPhase).toEqual(hostedReceipt);
        expect(durable.quarantineIdentity, targetPhase).toBe(quarantineIdentity);
      }
      expect(
        restartedRegistry.get(seed.stableSessionId)?.requests.filter(
          (request) => request.requestId === seed.requestId
        ),
        targetPhase
      ).toHaveLength(1);
    }
  });
});
