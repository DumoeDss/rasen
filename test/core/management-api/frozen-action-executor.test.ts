import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  handleFrozenActionContinuation,
  handleFrozenActionDispatch,
} from '../../../src/core/management-api/frozen-action-executor.js';
import {
  deriveFreshStepRequestId,
} from '../../../src/core/change-run/index.js';
import type {
  ExactTeacherAttemptModule,
  ExactTeacherAuthorityPolicy,
} from '../../../src/core/frozen-action-executor/index.js';
import type {
  ExactTeacherAttemptPhase,
  ExactTeacherAttemptPhaseCommit,
  ExactTeacherAttemptPhaseCommitter,
  ExactTeacherAttemptRecoverySnapshot,
  ExactTeacherAttemptSeed,
  HostedSessionRecord,
  SessionHost,
  SessionHostCommand,
  SessionHostOutcome,
  SessionHostView,
  SessionRecoveryReport,
} from '../../../src/core/session-host/contracts.js';
import {
  makeRecordAction,
  recordIds,
  recordRevision,
} from '../change-run/record-fixture.js';
import {
  buildActiveTeacherConsultationFixture,
  buildGrantedConsultationFixture,
} from '../change-run/consultation-fixture.js';

const LIMITS = { timeoutMs: 30_000, maxInputBytes: 1024 * 1024, maxOutputBytes: 1024 * 1024 };

function stubHost(): SessionHost {
  return {
    async dispatch(command: SessionHostCommand): Promise<SessionHostOutcome> {
      if (command.op === 'execute') {
        return {
          ok: true,
          op: 'execute',
          session: {
            sessionId: '11111111-1111-1111-1111-111111111111',
            backend: 'claude',
            cwd: command.cwd,
            hostState: 'idle',
            state: 'running',
            generation: 1,
            createdAt: '2026-08-08T00:00:00Z',
            updatedAt: '2026-08-08T00:00:00Z',
          },
          requestId: command.requestId,
          result: '{"ok":true}',
          resultDigest: 'sha256:abc',
        };
      }
      return { ok: false, op: command.op, code: 'invalid-input', message: 'execute only' };
    },
    inspect(): undefined {
      return undefined;
    },
    list(): SessionHostView[] {
      return [];
    },
    verifyTurnReceipt(): boolean {
      return false;
    },
    async reconcileOnStart(): Promise<SessionRecoveryReport> {
      return { ready: true, inspected: 0, recovered: 0, interrupted: 0, failed: 0, diagnostics: [] };
    },
    async shutdown(): Promise<void> {
      /* no-op */
    },
  };
}

function dispatchBody(overrides: Record<string, unknown> = {}) {
  return {
    runRef: {
      change: { projectRoot: '/root', changeId: 'fixture-change' },
      runId: recordIds.runId,
    },
    grantedAction: makeRecordAction(),
    expectedRecordVersion: 3,
    workspaceRevision: recordRevision,
    requestedBackend: 'hosted',
    turnInput: 'do the work',
    hostedSeam: { cwd: '/root', backend: 'claude', limits: LIMITS },
    ...overrides,
  };
}

function writeHeadRecord(root: string, record: unknown): void {
  const dirName = recordIds.runId.replace(/[^a-z0-9]/gi, '_');
  const dir = path.join(root, dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'record-v4.json'), JSON.stringify(record), 'utf8');
}

describe('frozen-action-executor daemon face - body validation (additive endpoint)', () => {
  it('rejects a non-object body', async () => {
    const result = await handleFrozenActionDispatch({ host: stubHost(), hostPlatform: 'linux', body: 'nope' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad_request');
  });

  it('rejects an invalid runRef', async () => {
    const result = await handleFrozenActionDispatch({
      host: stubHost(),
      hostPlatform: 'linux',
      body: dispatchBody({ runRef: { change: {} } }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_run_ref');
  });

  it('rejects an invalid grantedAction', async () => {
    const result = await handleFrozenActionDispatch({
      host: stubHost(),
      hostPlatform: 'linux',
      body: dispatchBody({ grantedAction: { kind: 'agent' } }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_granted_action');
  });

  it('rejects a non-integer expectedRecordVersion', async () => {
    const result = await handleFrozenActionDispatch({
      host: stubHost(),
      hostPlatform: 'linux',
      body: dispatchBody({ expectedRecordVersion: 'three' }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_expected_record_version');
  });

  it('rejects an empty turnInput', async () => {
    const result = await handleFrozenActionDispatch({
      host: stubHost(),
      hostPlatform: 'linux',
      body: dispatchBody({ turnInput: '' }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_turn_input');
  });

  it('rejects an invalid requestedBackend', async () => {
    const result = await handleFrozenActionDispatch({
      host: stubHost(),
      hostPlatform: 'linux',
      body: dispatchBody({ requestedBackend: 'kernel-enforced' }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_backend');
  });

  it('returns run_not_found when no Record exists for the runId', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fae-store-'));
    try {
      const result = await handleFrozenActionDispatch({
        host: stubHost(),
        hostPlatform: 'linux',
        body: dispatchBody(),
        storeRoot: tmp,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(404);
        expect(result.code).toBe('run_not_found');
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('frozen-action-executor daemon face - consultation continuation', () => {
  it('fails closed before continuation when the daemon signer is unavailable', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fae-continuation-store-'));
    try {
      const fixture = buildGrantedConsultationFixture();
      writeHeadRecord(tmp, fixture.record);
      const result = await handleFrozenActionContinuation({
        host: stubHost(),
        hostPlatform: 'linux',
        storeRoot: tmp,
        body: {
          runRef: {
            change: { projectRoot: '/root', changeId: 'fixture-change' },
            runId: recordIds.runId,
          },
          grant: fixture.grant,
          requestedBackend: 'hosted',
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(503);
        expect(result.code).toBe('attestation_signer_unavailable');
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects caller-supplied continuation text before SessionHost dispatch', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fae-continuation-store-'));
    try {
      const fixture = buildGrantedConsultationFixture();
      writeHeadRecord(tmp, fixture.record);
      const result = await handleFrozenActionContinuation({
        host: stubHost(),
        hostPlatform: 'linux',
        storeRoot: tmp,
        body: {
          runRef: {
            change: { projectRoot: '/root', changeId: 'fixture-change' },
            runId: recordIds.runId,
          },
          grant: { ...fixture.grant, continuationText: 'Teacher ran.' },
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('invalid_continuation_grant');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('frozen-action-executor daemon face - canonical Teacher host authority', () => {
  it('rejects a caller-selected Teacher cwd/backend/limits before host dispatch', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fae-teacher-store-'));
    try {
      const fixture = buildActiveTeacherConsultationFixture();
      writeHeadRecord(tmp, fixture.record);
      const result = await handleFrozenActionDispatch({
        host: stubHost(),
        hostPlatform: 'linux',
        storeRoot: tmp,
        body: dispatchBody({
          grantedAction: fixture.teacherAction,
          expectedRecordVersion: fixture.record.recordVersion,
          workspaceRevision: fixture.teacherAction.expectedBeforeWorkspace,
          turnInput: 'caller-selected Teacher input',
          hostedSeam: {
            cwd: path.join(tmp, 'wrong-worktree'),
            backend: 'caller-backend',
            limits: { ...LIMITS, maxOutputBytes: 17 },
          },
        }),
      });
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        code: 'external_teacher_hosted_seam_forbidden',
      });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('accepts a seam-free recovered Teacher body and reaches daemon signer authority', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fae-teacher-store-'));
    try {
      const fixture = buildActiveTeacherConsultationFixture();
      writeHeadRecord(tmp, fixture.record);
      const result = await handleFrozenActionDispatch({
        host: stubHost(),
        hostPlatform: 'linux',
        storeRoot: tmp,
        body: dispatchBody({
          grantedAction: fixture.teacherAction,
          expectedRecordVersion: fixture.record.recordVersion,
          workspaceRevision: fixture.teacherAction.expectedBeforeWorkspace,
          hostedSeam: undefined,
        }),
      });
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        code: 'legacy_teacher_dispatch_forbidden',
      });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('routes a canonical Teacher locator through the one deep Module interface', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fae-teacher-module-store-'));
    try {
      const fixture = buildActiveTeacherConsultationFixture();
      writeHeadRecord(tmp, fixture.record);
      const calls: unknown[] = [];
      const exactTeacherAttemptModule: ExactTeacherAttemptModule = Object.freeze({
        async executeAndSettle(locator) {
          calls.push(locator);
          return Object.freeze({
            state: 'authority-retained' as const,
            attemptId: fixture.teacherAction.attemptId,
            reason: 'fixture-retained',
            sessionReleaseAllowed: false as const,
            sponsoredReservationReleaseAllowed: false as const,
            adviceAllowed: false as const,
          });
        },
      });
      const result = await handleFrozenActionDispatch({
        host: stubHost(),
        hostPlatform: 'linux',
        storeRoot: tmp,
        exactTeacherAttemptModule,
        body: {
          runRef: {
            change: { projectRoot: '/root', changeId: 'fixture-change' },
            runId: recordIds.runId,
          },
          teacherActionId: fixture.teacherAction.actionId,
          expectedRecordVersion: fixture.record.recordVersion,
        },
      });

      expect(result).toMatchObject({
        ok: true,
        status: 200,
        result: {
          state: 'authority-retained',
          reason: 'authority-reconciliation-required',
        },
      });
      expect(JSON.stringify(result)).not.toContain('fixture-retained');
      expect(calls).toEqual([{
        runRef: {
          change: { projectRoot: '/root', changeId: 'fixture-change' },
          runId: recordIds.runId,
        },
        teacherActionId: fixture.teacherAction.actionId,
        expectedRecordVersion: fixture.record.recordVersion,
      }]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('recovers a replacement from a durably settled request without fresh preparation or activation', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fae-teacher-recovery-store-'));
    try {
      const fixture = buildActiveTeacherConsultationFixture();
      writeHeadRecord(tmp, fixture.record);
      const consultation = fixture.record.consultations![fixture.consultationId]!;
      const requestId = deriveFreshStepRequestId(
        fixture.record.runId,
        fixture.teacherAction.actionId as never,
        fixture.teacherAction.attemptId as never
      );
      const resultBody = JSON.stringify({
        contract: 'teacher-consultation/advice/1',
        consultationId: fixture.consultationId,
        teacherAttempt: consultation.teacher.attemptOrdinal,
        decision: 'plan',
        rationale: 'Recover the durable result.',
        steps: ['Replay the settled request.'],
        cautions: [],
        evidenceNotes: [],
      });
      const resultDigest = createHash('sha256').update(resultBody, 'utf8').digest('hex');
      const resultRef = `host-result:sha256:${resultDigest}`;
      const provider = {
        providerId: 'test.management-recovery',
        capabilityId: 'recursive-process-scope',
        protocolVersion: 1,
      } as const;
      const processRef = 'opaque-management-recovery-reference';
      const baselineIdentity = 'manifest:baseline';
      const hostedReceipt = {
        stableSessionId: requestId,
        requestId,
        resultRef,
        resultDigest,
      } as const;
      let phase: ExactTeacherAttemptPhase = 'request-sent';
      let revision = 6;
      let currentFacts: ExactTeacherAttemptPhaseCommit = {
        baselineIdentity,
        processRef,
      };
      const commits: ExactTeacherAttemptPhase[] = [];
      const seed: ExactTeacherAttemptSeed = {
        attemptId: fixture.teacherAction.attemptId,
        provider,
        runId: fixture.record.runId,
        actionId: fixture.teacherAction.actionId,
        invocationId: fixture.teacherAction.invocationId,
        attempt: consultation.teacher.attemptOrdinal,
        stableSessionId: requestId,
        requestId,
      };
      const recoverySnapshot = (): ExactTeacherAttemptRecoverySnapshot => {
        const exactTeacherAttempt = {
          schema: 'rasen-exact-teacher-session-attempt/1' as const,
          recordVersion: 1 as const,
          ...seed,
          processRef,
          journalRevision: revision,
          phase,
          baselineIdentity,
          ...(currentFacts.hostedReceipt === undefined
            ? {}
            : { hostedReceipt: currentFacts.hostedReceipt }),
          ...(currentFacts.quarantineIdentity === undefined
            ? {}
            : { quarantineIdentity: currentFacts.quarantineIdentity }),
        };
        const session: HostedSessionRecord = {
          sessionId: requestId,
          backend: 'claude',
          cwd: tmp,
          cwdDigest: 'c'.repeat(64),
          turnLimits: LIMITS,
          sandbox: 'read-only',
          authority: {
            invocationId: fixture.teacherAction.invocationId,
            role: 'teacher',
            workspaceInstanceId: fixture.record.workspaceInstanceId,
            backend: 'hosted',
            handoffTokensUsed: 0,
            reuseRoundsServed: 0,
          },
          hostState: 'idle',
          generation: 1,
          createdAt: '2026-08-10T00:00:00.000Z',
          updatedAt: '2026-08-10T00:00:01.000Z',
          requests: [{
            requestId,
            inputDigest: 'd'.repeat(64),
            generation: 1,
            state: 'settled',
            preparedAt: '2026-08-10T00:00:00.000Z',
            sentAt: '2026-08-10T00:00:00.500Z',
            settledAt: '2026-08-10T00:00:01.000Z',
            resultRef,
            resultDigest,
          }],
          process: {
            generation: 1,
            ownerToken: 'management-recovery-owner',
            runtimeRef: processRef as never,
            preparedAt: '2026-08-10T00:00:00.000Z',
          },
          exactTeacherAttempt,
        };
        return {
          journal: {
            schema: 'rasen-exact-teacher-attempt-journal/1',
            recordVersion: 1,
            revision,
            ...seed,
            processRef,
            baselineIdentity,
            ...(currentFacts.hostedReceipt === undefined
              ? {}
              : { hostedReceipt: currentFacts.hostedReceipt }),
            ...(currentFacts.quarantineIdentity === undefined
              ? {}
              : { quarantineIdentity: currentFacts.quarantineIdentity }),
            phase,
          },
          session,
        };
      };
      const committer: ExactTeacherAttemptPhaseCommitter = {
        async commit(actualSeed, nextPhase, facts = {}) {
          expect(actualSeed).toEqual(seed);
          if (nextPhase === phase) return;
          const phases: ExactTeacherAttemptPhase[] = [
            'canonical-preflight',
            'baseline-stable',
            'authority-prepared-inert',
            'authority-published-inert',
            'activated',
            'request-sent',
            'result-quarantined',
            'hosted-receipt-verified',
            'retirement-pending',
            'exact-scope-empty',
            'final-observation-stable',
            'advice-validated',
            'canonical-settled',
          ];
          expect(phases.indexOf(nextPhase)).toBe(phases.indexOf(phase) + 1);
          phase = nextPhase;
          revision += 1;
          currentFacts = { ...currentFacts, ...facts };
          commits.push(nextPhase);
        },
        load() {
          return recoverySnapshot().session!.exactTeacherAttempt;
        },
        async loadRecovery() {
          return recoverySnapshot();
        },
      };
      const sourceHost: SessionHost = {
        ...stubHost(),
        inspect(sessionId) {
          if (sessionId !== consultation.source.stableSessionId) return undefined;
          return {
            sessionId,
            backend: 'claude',
            cwd: tmp,
            turnLimits: LIMITS,
            sandbox: 'workspace-write',
            authority: {
              invocationId: consultation.source.invocationId,
              role: fixture.sourceAction.kind === 'agent'
                ? fixture.sourceAction.agent.role
                : 'implementer',
              workspaceInstanceId: fixture.record.workspaceInstanceId,
              backend: 'hosted',
              handoffTokensUsed: 0,
              reuseRoundsServed: 0,
            },
            hostState: 'idle',
            state: 'running',
            generation: 1,
            createdAt: '2026-08-10T00:00:00.000Z',
            updatedAt: '2026-08-10T00:00:01.000Z',
          };
        },
      };
      const exactCommands: SessionHostCommand[] = [];
      const exactTeacherHost: SessionHost = {
        ...stubHost(),
        async dispatch(command) {
          exactCommands.push(command);
          if (
            command.op !== 'execute' ||
            command.exactTeacherAttempt?.mode !== 'send-prepared' ||
            command.sessionId !== requestId
          ) {
            throw new Error('replacement recovery attempted fresh exact authority work');
          }
          return {
            ok: true,
            op: 'execute',
            session: {
              sessionId: requestId,
              backend: 'claude',
              cwd: tmp,
              turnLimits: LIMITS,
              sandbox: 'read-only',
              hostState: 'idle',
              state: 'running',
              generation: 1,
              createdAt: '2026-08-10T00:00:00.000Z',
              updatedAt: '2026-08-10T00:00:01.000Z',
            },
            requestId,
            result: resultBody,
            resultRef,
            resultDigest,
            receipt: {
              format: 'rasen-session-host-turn-receipt/1',
              stableSessionId: requestId,
              backend: 'claude',
              requestId,
              requestState: 'settled',
              cwd: tmp,
              cwdDigest: 'c'.repeat(64),
              sandbox: 'read-only',
              resultRef,
              resultDigest,
              result: resultBody,
              replayed: true,
            },
            replayed: true,
          };
        },
        verifyTurnReceipt(receipt) {
          return receipt.requestId === requestId && receipt.replayed;
        },
      };
      let inspections = 0;
      const exactTeacherAuthorityPolicy: ExactTeacherAuthorityPolicy = {
        resolve() {
          return {
            state: 'available',
            platform: 'linux',
            selection: provider,
            lane: {
              selection: provider,
              registry: {} as never,
              coordinator: {
                selection: () => ({ state: 'available' }) as never,
                prepare: async () => {
                  throw new Error('replacement recovery must not prepare authority');
                },
                inspect: async () => {
                  inspections += 1;
                  return inspections === 1
                    ? ({ state: 'live' } as never)
                    : ({
                        state: 'control-loss',
                        reference: processRef,
                        diagnostic: 'fixture control loss after quarantine',
                      } as never);
                },
                observeExactScopeEmpty: async () => ({ state: 'control-loss' }) as never,
                terminate: async () => {
                  throw new Error('fixture stops after durable quarantine');
                },
              },
              processScope: {} as never,
            },
          };
        },
      };

      const result = await handleFrozenActionDispatch({
        host: sourceHost,
        exactTeacherHost,
        exactTeacherAuthorityPolicy,
        exactTeacherAttemptCommitter: committer,
        hostPlatform: 'linux',
        storeRoot: tmp,
        producerFor: async () => {
          throw new Error('retained recovery must not parse or settle advice');
        },
        body: {
          runRef: {
            change: { projectRoot: '/root', changeId: 'fixture-change' },
            runId: recordIds.runId,
          },
          teacherActionId: fixture.teacherAction.actionId,
          expectedRecordVersion: fixture.record.recordVersion,
        },
      });

      expect(result, JSON.stringify(result)).toMatchObject({
        ok: true,
        status: 200,
        result: { state: 'authority-retained' },
      });
      expect(commits).toEqual(['result-quarantined']);
      expect(exactCommands).toHaveLength(1);
      expect(exactCommands[0]).toMatchObject({
        op: 'execute',
        sessionId: requestId,
        requestId,
        exactTeacherAttempt: { mode: 'send-prepared', seed },
      });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects every caller-supplied Teacher execution or authority field', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fae-teacher-fields-store-'));
    try {
      const fixture = buildActiveTeacherConsultationFixture();
      writeHeadRecord(tmp, fixture.record);
      const base = {
        runRef: {
          change: { projectRoot: '/root', changeId: 'fixture-change' },
          runId: recordIds.runId,
        },
        teacherActionId: fixture.teacherAction.actionId,
        expectedRecordVersion: fixture.record.recordVersion,
      };
      for (const [field, value] of Object.entries({
        hostedSeam: {},
        backend: 'hosted',
        limits: LIMITS,
        exact: true,
        provider: { providerId: 'caller' },
        processRef: 'caller-ref',
        pid: 123,
        processName: 'caller-process',
        receipt: {},
        turnInput: 'caller-input',
        phase: 'validate-advice',
        grantedAction: fixture.teacherAction,
        workspaceRevision: fixture.teacherAction.expectedBeforeWorkspace,
      })) {
        const result = await handleFrozenActionDispatch({
          host: stubHost(),
          hostPlatform: 'linux',
          storeRoot: tmp,
          exactTeacherAttemptModule: Object.freeze({
            async executeAndSettle() {
              throw new Error('forbidden fields must fail before the Module');
            },
          }),
          body: { ...base, [field]: value },
        });
        expect(result, field).toMatchObject({
          ok: false,
          status: 400,
          code: 'external_teacher_authority_field_forbidden',
        });
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
