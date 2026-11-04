import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
  AgentSessionBackend,
  AgentSessionTransport,
  BackendEvent,
  BackendTurn,
} from '../../../src/core/session-host/backend.js';
import { createSessionHost } from '../../../src/core/session-host/host.js';
import { createSessionHostRegistry } from '../../../src/core/session-host/registry.js';
import {
  actionExecuteRequestId,
  createProductionExecutor,
} from '../../../src/core/frozen-action-executor/production-executor.js';
import { decodeTeacherConsultationAdvice } from '../../../src/core/change-run/consultation-contracts.js';
import { commitTeacherAdvice } from '../../../src/core/change-run/internal/consultation-lifecycle.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import { prepareTestSessionTransport } from '../../helpers/session-host-backend.js';
import {
  buildActiveTeacherConsultationFixture,
  buildGrantedConsultationFixture,
  consultationTestBinding,
} from '../change-run/consultation-fixture.js';
import { makeRecordEvidence, recordIds } from '../change-run/record-fixture.js';

const LIMITS = {
  timeoutMs: 2_000,
  maxInputBytes: 64 * 1024,
  maxOutputBytes: 64 * 1024,
};

class ConsultationTransport implements AgentSessionTransport {
  readonly rootPid = 4242;
  readonly closed = new Promise<void>(() => undefined);
  readonly inputs: BackendTurn[] = [];
  runtimeRef!: AgentSessionTransport['runtimeRef'];
  displayPid?: number;

  constructor(
    readonly backendSessionId: string,
    private readonly ambiguousOnContinuation: boolean,
    private readonly resultForTurn: (turnIndex: number) => string =
      (turnIndex) => JSON.stringify({ status: turnIndex === 0 ? 'CONSULT' : 'DONE' })
  ) {}

  send(turn: BackendTurn) {
    const turnIndex = this.inputs.length;
    this.inputs.push(turn);
    const backendSessionId = this.backendSessionId;
    const resultForTurn = this.resultForTurn;
    const ambiguous = this.ambiguousOnContinuation && turnIndex === 1;
    const events = (async function* (): AsyncGenerator<BackendEvent> {
      yield { type: 'init', sessionId: backendSessionId };
      if (ambiguous) {
        throw new Error('transport lost after accepting continuation input');
      }
      yield {
        type: 'result',
        sessionId: backendSessionId,
        content: resultForTurn(turnIndex),
      };
    })();
    return Object.assign(events, { accepted: Promise.resolve() });
  }

  async terminate() {
    return {
      closed: !this.ambiguousOnContinuation,
      cancelledBeforeWork: false,
    };
  }
}

class ConsultationBackend implements AgentSessionBackend {
  readonly id = 'consultation-replay';
  readonly transports: ConsultationTransport[] = [];

  constructor(
    private readonly ambiguousOnContinuation = false,
    private readonly resultForTurn?: (turnIndex: number) => string
  ) {}

  async prepare() {
    const transport = new ConsultationTransport(
      `backend-consultation-${this.transports.length + 1}`,
      this.ambiguousOnContinuation,
      this.resultForTurn
    );
    this.transports.push(transport);
    return prepareTestSessionTransport(transport);
  }
}

function harness(
  ambiguousOnContinuation = false,
  resultForTurn?: (turnIndex: number) => string
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-consultation-host-'));
  const cwd = fs.realpathSync.native(root);
  const backend = new ConsultationBackend(
    ambiguousOnContinuation,
    resultForTurn
  );
  const stateDir = path.join(root, 'state');
  const registry = createSessionHostRegistry({ stateDir });
  const host = createSessionHost({ registry, backends: [backend] });
  return { root, cwd, stateDir, backend, registry, host };
}

async function establishSourceSession(
  fixture: ReturnType<typeof harness>
) {
  await fixture.host.reconcileOnStart();
  const canonical = buildGrantedConsultationFixture();
  const requestId = randomUUID();
  const outcome = await fixture.host.dispatch({
    op: 'execute',
    requestId,
    backend: fixture.backend.id,
    cwd: fixture.cwd,
    input: 'source asks for advice',
    limits: LIMITS,
    sandbox: canonical.sourceAction.agent.sandbox,
    authority: {
      invocationId: canonical.sourceAction.invocationId,
      role: canonical.sourceAction.agent.role,
      workspaceInstanceId: canonical.record.workspaceInstanceId,
      backend: 'hosted',
    },
  });
  if (!outcome.ok) throw new Error(outcome.message);
  return { outcome, requestId };
}

describe('production continuation through the real SessionHost', () => {
  it('binds a recovered Teacher Action to one durable Session and commits its replayed advice once', async () => {
    const active = buildActiveTeacherConsultationFixture();
    const adviceBody = JSON.stringify({
      contract: 'teacher-consultation/advice/1',
      consultationId: active.consultationId,
      teacherAttempt: 1,
      decision: 'plan',
      rationale: 'Reuse the canonical Teacher Session after acknowledgement loss.',
      steps: ['Replay the settled request without another backend input.'],
      cautions: ['Do not mint a second Session for the recovered grant.'],
      evidenceNotes: [],
    });
    const h = harness(false, () => adviceBody);
    await h.host.reconcileOnStart();
    const executor = createProductionExecutor({
      hostPlatform: process.platform,
      host: h.host,
      hostedSeamOptions: {
        cwd: h.cwd,
        backend: h.backend.id,
        limits: LIMITS,
      },
    });
    const runRef = {
      change: {
        projectRoot: h.cwd,
        changeId: active.record.change.changeId,
      },
      runId: active.record.runId,
    };
    const dispatch = () =>
      executor.dispatch({
        runRef,
        grantedAction: active.teacherAction,
        record: active.record,
        expectedRecordVersion: active.record.recordVersion,
        workspaceRevision: active.teacherAction.expectedBeforeWorkspace,
        requestedBackend: 'hosted',
        turnInput:
          active.teacherAction.kind === 'agent'
            ? JSON.stringify(active.teacherAction.agent.input)
            : '{}',
      });

    const first = await dispatch();
    if (first.kind !== 'executed' || first.outcome.hostedTurn === undefined) {
      throw new Error('expected first Teacher dispatch');
    }
    // Simulate loss of the HTTP response: no canonical advice mutation occurs.
    await h.host.shutdown('daemon-stop');
    const restartedHost = createSessionHost({
      registry: createSessionHostRegistry({ stateDir: h.stateDir }),
      backends: [h.backend],
    });
    await restartedHost.reconcileOnStart();
    const restartedExecutor = createProductionExecutor({
      hostPlatform: process.platform,
      host: restartedHost,
      hostedSeamOptions: {
        cwd: h.cwd,
        backend: h.backend.id,
        limits: LIMITS,
      },
    });
    const replay = await restartedExecutor.dispatch({
      runRef,
      grantedAction: active.teacherAction,
      record: active.record,
      expectedRecordVersion: active.record.recordVersion,
      workspaceRevision: active.teacherAction.expectedBeforeWorkspace,
      requestedBackend: 'hosted',
      turnInput:
        active.teacherAction.kind === 'agent'
          ? JSON.stringify(active.teacherAction.agent.input)
          : '{}',
    });
    if (replay.kind !== 'executed' || replay.outcome.hostedTurn?.result === undefined) {
      throw new Error('expected recovered Teacher settled replay');
    }

    const stableSessionId = actionExecuteRequestId(active.teacherAction);
    expect(first.outcome.hostedTurn.stableSessionId).toBe(stableSessionId);
    expect(replay.outcome.hostedTurn).toMatchObject({
      stableSessionId,
      requestId: stableSessionId,
      replayed: true,
    });
    expect(h.backend.transports).toHaveLength(1);
    expect(h.backend.transports[0]?.inputs).toHaveLength(1);

    const advice = decodeTeacherConsultationAdvice(
      JSON.parse(replay.outcome.hostedTurn.result),
      consultationTestBinding.limits
    );
    const actionResult = reduceCanonicalRunRecord(active.record, {
      kind: 'commit-action-result',
      actionId: active.teacherAction.actionId,
      status: 'succeeded',
      receiptDigest: recordIds.digest,
      result: advice,
      evidence: [],
      actor: active.teacherAction.completionAuthority!.actor,
      actorAttestation: makeRecordEvidence(active.teacherAction),
    });
    if (!actionResult.ok) throw new Error(actionResult.failure.message);
    const adviceResult = reduceCanonicalRunRecord(actionResult.record, {
      kind: 'commit-consultation-advice',
      consultation: commitTeacherAdvice({
        consultation: actionResult.record.consultations![active.consultationId]!,
        teacherAction: active.teacherAction,
        result: advice,
        actor: active.teacherAction.completionAuthority!.actor,
        actorAttestation: makeRecordEvidence(active.teacherAction),
        evidence: [makeRecordEvidence(active.teacherAction)],
      }),
    });
    if (!adviceResult.ok) throw new Error(adviceResult.failure.message);
    expect(
      adviceResult.record.transitions.filter(
        (transition) => transition.kind === 'ConsultationAdviceCommitted'
      )
    ).toHaveLength(1);
  });

  it('keeps stable/backend Session identity and durably replays the settled result body after host restart', async () => {
    const h = harness();
    const source = await establishSourceSession(h);
    const fixture = buildGrantedConsultationFixture({
      stableSessionId: source.outcome.session.sessionId,
      sourceRequestId: source.requestId,
    });
    const executor = createProductionExecutor({
      hostPlatform: process.platform,
      host: h.host,
      hostedSeamOptions: {
        cwd: h.cwd,
        backend: h.backend.id,
        limits: LIMITS,
      },
    });

    const first = await executor.dispatchContinuation({
      grant: fixture.grant,
      record: fixture.record,
    });
    if (first.kind !== 'executed' || first.outcome.hostedTurn?.receipt === undefined) {
      throw new Error('expected the first continuation to carry a hosted receipt');
    }
    expect(h.host.verifyTurnReceipt(first.outcome.hostedTurn.receipt)).toBe(true);
    expect(
      h.host.verifyTurnReceipt({
        ...first.outcome.hostedTurn.receipt,
        resultRef: `host-result:sha256:${'f'.repeat(64)}`,
      })
    ).toBe(false);
    await h.host.shutdown('daemon-stop');
    const restartedRegistry = createSessionHostRegistry({ stateDir: h.stateDir });
    const restartedHost = createSessionHost({
      registry: restartedRegistry,
      backends: [h.backend],
    });
    await expect(restartedHost.reconcileOnStart()).resolves.toMatchObject({
      ready: true,
    });
    const restartedExecutor = createProductionExecutor({
      hostPlatform: process.platform,
      host: restartedHost,
      hostedSeamOptions: {
        cwd: h.cwd,
        backend: h.backend.id,
        limits: LIMITS,
      },
    });
    const replay = await restartedExecutor.dispatchContinuation({
      grant: fixture.grant,
      record: fixture.record,
    });

    expect(first.kind).toBe('executed');
    expect(replay.kind).toBe('executed');
    expect(h.backend.transports).toHaveLength(1);
    expect(h.backend.transports[0]?.inputs).toHaveLength(2);
    expect(h.backend.transports[0]?.inputs[1]?.requestId).toBe(
      fixture.grant.requestId
    );
    if (first.kind === 'executed' && replay.kind === 'executed') {
      expect(first.outcome.hostedTurn).toMatchObject({
        stableSessionId: source.outcome.session.sessionId,
        backendSessionId: source.outcome.session.backendSessionId,
        requestId: fixture.grant.requestId,
        result: JSON.stringify({ status: 'DONE' }),
        replayed: false,
      });
      expect(replay.outcome.hostedTurn).toMatchObject({
        stableSessionId: source.outcome.session.sessionId,
        backendSessionId: source.outcome.session.backendSessionId,
        requestId: fixture.grant.requestId,
        result: JSON.stringify({ status: 'DONE' }),
        replayed: true,
      });
      expect(replay.outcome.hostedTurn?.resultDigest).toBe(
        first.outcome.hostedTurn?.resultDigest
      );
      expect(replay.outcome.hostedTurn?.resultRef).toBe(
        first.outcome.hostedTurn?.resultRef
      );
      expect(
        restartedHost.verifyTurnReceipt(replay.outcome.hostedTurn!.receipt!)
      ).toBe(true);
    }
  });

  it('refuses retired and cwd-mismatched source Sessions before another backend send', async () => {
    const retired = harness();
    const retiredSource = await establishSourceSession(retired);
    const retiredFixture = buildGrantedConsultationFixture({
      stableSessionId: retiredSource.outcome.session.sessionId,
      sourceRequestId: retiredSource.requestId,
    });
    await retired.host.dispatch({
      op: 'retire',
      sessionId: retiredSource.outcome.session.sessionId,
      reason: 'source-action-closed',
    });
    const retiredExecutor = createProductionExecutor({
      hostPlatform: process.platform,
      host: retired.host,
      hostedSeamOptions: {
        cwd: retired.cwd,
        backend: retired.backend.id,
        limits: LIMITS,
      },
    });
    const retiredResult = await retiredExecutor.dispatchContinuation({
      grant: retiredFixture.grant,
      record: retiredFixture.record,
    });
    expect(retiredResult.kind).toBe('executed');
    expect(retired.backend.transports[0]?.inputs).toHaveLength(1);
    if (retiredResult.kind === 'executed') {
      expect(retiredResult.outcome).toMatchObject({
        kind: 'uncertain',
        source: 'host-failure',
      });
    }

    const mismatch = harness();
    const mismatchSource = await establishSourceSession(mismatch);
    const mismatchFixture = buildGrantedConsultationFixture({
      stableSessionId: mismatchSource.outcome.session.sessionId,
      sourceRequestId: mismatchSource.requestId,
    });
    const wrongCwd = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rasen-consultation-wrong-cwd-')
    );
    const mismatchExecutor = createProductionExecutor({
      hostPlatform: process.platform,
      host: mismatch.host,
      hostedSeamOptions: {
        cwd: wrongCwd,
        backend: mismatch.backend.id,
        limits: LIMITS,
      },
    });
    const mismatchResult = await mismatchExecutor.dispatchContinuation({
      grant: mismatchFixture.grant,
      record: mismatchFixture.record,
    });
    expect(mismatchResult.kind).toBe('executed');
    expect(mismatch.backend.transports[0]?.inputs).toHaveLength(1);
    if (mismatchResult.kind === 'executed') {
      expect(mismatchResult.outcome).toMatchObject({
        kind: 'uncertain',
        source: 'host-failure',
      });
    }
  });

  it('does not resend a continuation whose accepted turn became ambiguous', async () => {
    const h = harness(true);
    const source = await establishSourceSession(h);
    const fixture = buildGrantedConsultationFixture({
      stableSessionId: source.outcome.session.sessionId,
      sourceRequestId: source.requestId,
    });
    const executor = createProductionExecutor({
      hostPlatform: process.platform,
      host: h.host,
      hostedSeamOptions: {
        cwd: h.cwd,
        backend: h.backend.id,
        limits: LIMITS,
      },
    });
    const first = await executor.dispatchContinuation({
      grant: fixture.grant,
      record: fixture.record,
    });
    const replay = await executor.dispatchContinuation({
      grant: fixture.grant,
      record: fixture.record,
    });
    expect(first.kind).toBe('executed');
    expect(replay.kind).toBe('executed');
    expect(h.backend.transports[0]?.inputs).toHaveLength(2);
    if (first.kind === 'executed' && replay.kind === 'executed') {
      expect(first.outcome.kind).toBe('uncertain');
      expect(replay.outcome.kind).toBe('execution-lost');
    }
  });
});
