import { describe, expect, it } from 'vitest';

import {
  createExactTeacherAttemptModule,
  type ExactTeacherAttemptModuleOptions,
  type ExactTeacherResolvedAttempt,
} from '../../../src/core/frozen-action-executor/exact-teacher-attempt-module.js';
import {
  ExactTeacherAttemptRecoveryLoadError,
  type ExactTeacherAttemptRecoveryLoadFailureReason,
} from '../../../src/core/session-host/contracts.js';

const locator = Object.freeze({
  runRef: {
    change: { projectRoot: '/workspace', changeId: 'change:teacher-module' },
    runId: 'run:teacher-module',
  },
  teacherActionId: 'action:teacher-module',
  expectedRecordVersion: 7,
});

const attempt: ExactTeacherResolvedAttempt = Object.freeze({
  attemptId: 'attempt:teacher-module',
  runId: locator.runRef.runId,
  actionId: locator.teacherActionId,
  invocationId: 'invocation:teacher-module',
  attempt: 1,
  stableSessionId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  provider: {
    providerId: 'test.teacher-module',
    capabilityId: 'recursive-process-scope',
    protocolVersion: 1,
  },
  canonicalContext: Object.freeze({ source: 'canonical-record' }),
});

function successfulOptions(events: string[]): ExactTeacherAttemptModuleOptions {
  let quarantinedResult: string | undefined;
  return {
    resolveCanonicalAttempt: async () => {
      events.push('resolve-canonical');
      return attempt;
    },
    commitPhase: async (_attempt, phase) => {
      events.push(`phase:${phase}`);
    },
    captureBaseline: async () => {
      events.push('capture-baseline');
      return Object.freeze({ identity: 'baseline' });
    },
    prepareAuthority: async () => {
      events.push('prepare-authority');
      return Object.freeze({
        state: 'prepared-inert' as const,
        processRef: 'process:teacher-module',
        authority: Object.freeze({ step: 'prepared' }),
      });
    },
    publishAuthority: async (_attempt, prepared) => {
      events.push('publish-authority');
      return Object.freeze({
        state: 'published-inert' as const,
        processRef: prepared.processRef,
        authority: Object.freeze({ step: 'published' }),
      });
    },
    activateAuthority: async (_attempt, published) => {
      events.push('activate-authority');
      return Object.freeze({
        state: 'activated' as const,
        processRef: published.processRef,
        authority: Object.freeze({ step: 'activated' }),
      });
    },
    executeOnce: async () => {
      events.push('execute-once');
      return Object.freeze({
        state: 'settled' as const,
        result: '{"decision":"plan"}',
        hostedReceipt: Object.freeze({
          stableSessionId: attempt.stableSessionId,
          requestId: attempt.requestId,
          resultRef: `host-result:sha256:${'a'.repeat(64)}`,
          resultDigest: 'a'.repeat(64),
        }),
      });
    },
    quarantineResult: async (_attempt, settled) => {
      events.push('quarantine-result');
      quarantinedResult = settled.result;
      return Object.freeze({
        identity: 'quarantine:teacher-module',
        result: settled.result,
        hostedReceipt: settled.hostedReceipt,
      });
    },
    verifyHostedReceipt: async () => {
      events.push('verify-hosted-receipt');
      return true;
    },
    retireAuthority: async () => {
      events.push('retire-authority');
      return Object.freeze({ state: 'exact-scope-empty' as const, receipt: {} as never });
    },
    classifyAuthorityRecovery: () => Object.freeze({
      state: 'exact-scope-empty' as const,
      receipt: {} as never,
      sessionReleaseAllowed: true as const,
      sponsoredReservationReleaseAllowed: true as const,
      adviceAllowed: false as const,
    }),
    recoverAuthority: async () => {
      throw new Error('successful retirement must not recover');
    },
    releaseSponsoredReservation: async () => {
      events.push('release-sponsored-reservation');
    },
    captureFinalObservation: async () => {
      events.push('capture-final-observation');
      return Object.freeze({ state: 'stable' as const, identity: 'baseline' });
    },
    validateAdvice: async (_attempt, quarantine) => {
      expect(quarantine.result).toBe(quarantinedResult);
      events.push('validate-advice');
      return Object.freeze({ state: 'valid' as const, advice: { decision: 'plan' } });
    },
    settleAdvice: async () => {
      events.push('settle-advice');
      return Object.freeze({ receipt: 'canonical-advice' }) as never;
    },
    settleUnavailable: async () => {
      events.push('settle-unavailable');
      return Object.freeze({ receipt: 'canonical-unavailable' }) as never;
    },
  };
}

describe('ExactTeacherAttemptModule', () => {
  it('owns the complete successful order and validates only after exact retirement', async () => {
    const events: string[] = [];
    const module = createExactTeacherAttemptModule(successfulOptions(events));

    await expect(module.executeAndSettle(locator)).resolves.toMatchObject({
      state: 'canonical-advice-settled',
    });
    expect(Object.keys(module)).toEqual(['executeAndSettle']);
    expect(events).toEqual([
      'resolve-canonical',
      'phase:canonical-preflight',
      'capture-baseline',
      'phase:baseline-stable',
      'prepare-authority',
      'phase:authority-prepared-inert',
      'publish-authority',
      'phase:authority-published-inert',
      'activate-authority',
      'phase:activated',
      'phase:request-sent',
      'execute-once',
      'quarantine-result',
      'phase:result-quarantined',
      'verify-hosted-receipt',
      'phase:hosted-receipt-verified',
      'phase:retirement-pending',
      'retire-authority',
      'phase:exact-scope-empty',
      'release-sponsored-reservation',
      'capture-final-observation',
      'phase:final-observation-stable',
      'validate-advice',
      'phase:advice-validated',
      'settle-advice',
      'phase:canonical-settled',
    ]);
  });

  it.each([
    'authority-identity-mismatch',
    'durable-frontier-conflict',
    'durable-journal-malformed',
    'durable-session-state-unavailable',
  ] as const)(
    'turns typed durable load failure %s into retained authority before side effects',
    async (reason: ExactTeacherAttemptRecoveryLoadFailureReason) => {
      const events: string[] = [];
      const module = createExactTeacherAttemptModule({
        ...successfulOptions(events),
        loadRecoveryState: async () => {
          events.push('load-recovery');
          throw new ExactTeacherAttemptRecoveryLoadError(reason);
        },
      });

      await expect(module.executeAndSettle(locator)).resolves.toMatchObject({
        state: 'authority-retained',
        reason,
        adviceAllowed: false,
        sessionReleaseAllowed: false,
        sponsoredReservationReleaseAllowed: false,
      });
      expect(events).toEqual(['resolve-canonical', 'load-recovery']);
    }
  );

  it('does not recategorize an unrelated recovery loader failure', async () => {
    const events: string[] = [];
    const module = createExactTeacherAttemptModule({
      ...successfulOptions(events),
      loadRecoveryState: async () => {
        events.push('load-recovery');
        throw new Error('unrelated loader failure');
      },
    });

    await expect(module.executeAndSettle(locator)).rejects.toThrow(
      'unrelated loader failure'
    );
    expect(events).toEqual(['resolve-canonical', 'load-recovery']);
  });

  it('resumes a replacement from the durable request frontier without fresh prepare or activation', async () => {
    const events: string[] = [];
    const options = successfulOptions(events);
    const processRef = 'process:teacher-module';
    const hostedReceipt = Object.freeze({
      stableSessionId: attempt.stableSessionId,
      requestId: attempt.requestId,
      resultRef: `host-result:sha256:${'a'.repeat(64)}`,
      resultDigest: 'a'.repeat(64),
    });
    const journal = Object.freeze({
      schema: 'rasen-exact-teacher-attempt-journal/1' as const,
      recordVersion: 1 as const,
      revision: 6,
      attemptId: attempt.attemptId,
      provider: attempt.provider!,
      processRef,
      runId: attempt.runId,
      actionId: attempt.actionId,
      invocationId: attempt.invocationId,
      attempt: attempt.attempt,
      stableSessionId: attempt.stableSessionId,
      requestId: attempt.requestId,
      phase: 'request-sent' as const,
    });
    const session = Object.freeze({
      sessionId: attempt.stableSessionId,
      process: { runtimeRef: processRef },
      requests: [{
        requestId: attempt.requestId,
        state: 'settled',
        resultRef: hostedReceipt.resultRef,
        resultDigest: hostedReceipt.resultDigest,
      }],
      exactTeacherAttempt: {
        schema: 'rasen-exact-teacher-session-attempt/1',
        recordVersion: 1,
        attemptId: attempt.attemptId,
        provider: attempt.provider!,
        processRef,
        runId: attempt.runId,
        actionId: attempt.actionId,
        invocationId: attempt.invocationId,
        attempt: attempt.attempt,
        stableSessionId: attempt.stableSessionId,
        requestId: attempt.requestId,
        journalRevision: journal.revision,
        phase: journal.phase,
      },
    });
    const module = createExactTeacherAttemptModule({
      ...options,
      loadRecoveryState: async () => {
        events.push('load-recovery');
        return Object.freeze({
          canonical: Object.freeze({
            attemptId: attempt.attemptId,
            runId: attempt.runId,
            actionId: attempt.actionId,
            invocationId: attempt.invocationId,
            attempt: attempt.attempt,
            stableSessionId: attempt.stableSessionId,
            requestId: attempt.requestId,
            settlement: 'pending' as const,
          }),
          journal,
          session: session as never,
          publication: Object.freeze({
            state: 'published-inert' as const,
            provider: attempt.provider!,
            processRef,
          }),
        });
      },
      executeRecoveryOperation: async (
        _attempt: ExactTeacherResolvedAttempt,
        operation: string
      ) => {
        events.push(`recover:${operation}`);
        return Object.freeze({
          state: 'settled' as const,
          settlement: Object.freeze({
            state: 'canonical-advice-settled' as const,
            receipt: Object.freeze({ receipt: 'recovered-advice' }) as never,
          }),
        });
      },
    } as unknown as ExactTeacherAttemptModuleOptions);

    await expect(module.executeAndSettle(locator)).resolves.toMatchObject({
      state: 'canonical-advice-settled',
    });
    expect(events).toEqual([
      'resolve-canonical',
      'load-recovery',
      'recover:quarantine-settled-result',
    ]);
  });

  it('shares one in-flight recovery operation across simultaneous canonical callers', async () => {
    const events: string[] = [];
    const options = successfulOptions(events);
    const processRef = 'process:teacher-module-concurrent';
    let resolverArrivals = 0;
    let releaseStart!: () => void;
    const startTogether = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const recovery = Object.freeze({
      canonical: Object.freeze({
        attemptId: attempt.attemptId,
        runId: attempt.runId,
        actionId: attempt.actionId,
        invocationId: attempt.invocationId,
        attempt: attempt.attempt,
        stableSessionId: attempt.stableSessionId,
        requestId: attempt.requestId,
        settlement: 'pending' as const,
      }),
      journal: Object.freeze({
        schema: 'rasen-exact-teacher-attempt-journal/1' as const,
        recordVersion: 1 as const,
        revision: 6,
        attemptId: attempt.attemptId,
        provider: attempt.provider!,
        processRef,
        runId: attempt.runId,
        actionId: attempt.actionId,
        invocationId: attempt.invocationId,
        attempt: attempt.attempt,
        stableSessionId: attempt.stableSessionId,
        requestId: attempt.requestId,
        phase: 'request-sent' as const,
      }),
      session: Object.freeze({
        sessionId: attempt.stableSessionId,
        process: { runtimeRef: processRef },
        requests: [{
          requestId: attempt.requestId,
          state: 'settled',
          resultRef: `host-result:sha256:${'b'.repeat(64)}`,
          resultDigest: 'b'.repeat(64),
        }],
        exactTeacherAttempt: {
          schema: 'rasen-exact-teacher-session-attempt/1',
          recordVersion: 1,
          attemptId: attempt.attemptId,
          provider: attempt.provider!,
          processRef,
          runId: attempt.runId,
          actionId: attempt.actionId,
          invocationId: attempt.invocationId,
          attempt: attempt.attempt,
          stableSessionId: attempt.stableSessionId,
          requestId: attempt.requestId,
          journalRevision: 6,
          phase: 'request-sent',
        },
      }) as never,
      publication: Object.freeze({
        state: 'published-inert' as const,
        provider: attempt.provider!,
        processRef,
      }),
    });
    const module = createExactTeacherAttemptModule({
      ...options,
      resolveCanonicalAttempt: async () => {
        events.push('resolve-canonical');
        resolverArrivals += 1;
        return attempt;
      },
      loadRecoveryState: async () => {
        events.push('load-recovery');
        return recovery;
      },
      executeRecoveryOperation: async (_attempt, operation) => {
        events.push(`recover:${operation}`);
        return Object.freeze({
          state: 'settled' as const,
          settlement: Object.freeze({
            state: 'canonical-advice-settled' as const,
            receipt: Object.freeze({ receipt: 'concurrent-advice' }) as never,
          }),
        });
      },
    });

    const invoke = async () => {
      await startTogether;
      return module.executeAndSettle(locator);
    };
    const first = invoke();
    const second = invoke();
    releaseStart();
    const settlements = await Promise.all([
      first,
      second,
    ]);

    expect(settlements).toEqual([
      expect.objectContaining({ state: 'canonical-advice-settled' }),
      expect.objectContaining({ state: 'canonical-advice-settled' }),
    ]);
    expect(resolverArrivals).toBe(1);
    expect(events.filter((event) => event === 'load-recovery')).toHaveLength(1);
    expect(events.filter((event) => event.startsWith('recover:'))).toHaveLength(1);
  });

  it('retains a typed conflict from a downstream phase projection', async () => {
    const events: string[] = [];
    const options = successfulOptions(events);
    const module = createExactTeacherAttemptModule({
      ...options,
      commitPhase: async (_attempt, phase) => {
        events.push(`phase:${phase}`);
        if (phase === 'request-sent') {
          throw new ExactTeacherAttemptRecoveryLoadError(
            'durable-frontier-conflict'
          );
        }
      },
    });

    await expect(module.executeAndSettle(locator)).resolves.toMatchObject({
      state: 'authority-retained',
      reason: 'durable-frontier-conflict',
      adviceAllowed: false,
      sessionReleaseAllowed: false,
      sponsoredReservationReleaseAllowed: false,
    });
    expect(events).not.toContain('execute-once');
    expect(events).not.toContain('release-sponsored-reservation');
    expect(events).not.toContain('settle-advice');
    expect(events).not.toContain('settle-unavailable');
  });

  it('retains unsafe post-activation authority without parsing, settling, or releasing', async () => {
    const events: string[] = [];
    const options = successfulOptions(events);
    const module = createExactTeacherAttemptModule({
      ...options,
      retireAuthority: async () => {
        events.push('retire-authority');
        return Object.freeze({ state: 'control-loss' as const });
      },
      classifyAuthorityRecovery: () => Object.freeze({
        state: 'retained' as const,
        reason: 'control-loss' as const,
        sessionReleaseAllowed: false as const,
        sponsoredReservationReleaseAllowed: false as const,
        adviceAllowed: false as const,
      }),
    });

    await expect(module.executeAndSettle(locator)).resolves.toMatchObject({
      state: 'authority-retained',
      reason: 'control-loss',
      adviceAllowed: false,
      sessionReleaseAllowed: false,
      sponsoredReservationReleaseAllowed: false,
    });
    expect(events).not.toContain('release-sponsored-reservation');
    expect(events).not.toContain('capture-final-observation');
    expect(events).not.toContain('validate-advice');
    expect(events).not.toContain('settle-advice');
    expect(events).not.toContain('settle-unavailable');
  });

  it('runs one persisted recovery operation and still retains if exact empty is not proven', async () => {
    const events: string[] = [];
    const options = successfulOptions(events);
    let classifications = 0;
    const module = createExactTeacherAttemptModule({
      ...options,
      retireAuthority: async () => {
        events.push('retire-authority');
        return Object.freeze({ state: 'root-exited' as const });
      },
      classifyAuthorityRecovery: () => {
        classifications += 1;
        return classifications === 1
          ? Object.freeze({
              state: 'recover' as const,
              operation: 'terminate-persisted-authority' as const,
              sessionReleaseAllowed: false as const,
              sponsoredReservationReleaseAllowed: false as const,
              adviceAllowed: false as const,
            })
          : Object.freeze({
              state: 'retained' as const,
              reason: 'authority-uncertain' as const,
              sessionReleaseAllowed: false as const,
              sponsoredReservationReleaseAllowed: false as const,
              adviceAllowed: false as const,
            });
      },
      recoverAuthority: async (_attempt, _authority, operation) => {
        events.push(`recover:${operation}`);
        return Object.freeze({ state: 'authority-uncertain' as const });
      },
    });

    await expect(module.executeAndSettle(locator)).resolves.toMatchObject({
      state: 'authority-retained',
      reason: 'authority-uncertain',
    });
    expect(events).toContain('recover:terminate-persisted-authority');
    expect(events).not.toContain('validate-advice');
  });

  it('settles pre-activation unavailability once and may release only the sponsored read', async () => {
    const events: string[] = [];
    const options = successfulOptions(events);
    const module = createExactTeacherAttemptModule({
      ...options,
      prepareAuthority: async () => {
        events.push('prepare-authority');
        return Object.freeze({
          state: 'authority-unavailable' as const,
          reason: 'provider-unavailable',
        });
      },
    });

    await expect(module.executeAndSettle(locator)).resolves.toMatchObject({
      state: 'canonical-unavailable-settled',
      reason: 'provider-unavailable',
    });
    expect(events).toEqual([
      'resolve-canonical',
      'phase:canonical-preflight',
      'capture-baseline',
      'phase:baseline-stable',
      'prepare-authority',
      'release-sponsored-reservation',
      'settle-unavailable',
    ]);
  });
});
