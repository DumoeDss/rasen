import { describe, expect, it, vi } from 'vitest';

import {
  SESSION_TOUCH_BACKOFF_BASE_MS,
  SESSION_TOUCH_BACKOFF_MAX_MS,
  SESSION_TOUCH_CADENCE_MS,
  SESSION_TOUCH_COLD_GAP_MS,
  SESSION_TOUCH_MESSAGE,
  SESSION_TOUCH_SCAN_INTERVAL_MS,
  classifySessionTouchCandidate,
  createSessionTouchScheduler,
  reconstructSessionTouchAttempt,
  sessionTouchMessageId,
  type ConditionalTouchOutcome,
  type ConditionalTouchRequest,
  type PolicyUpdateOutcome,
  type PolicyUpdateRequest,
  type ReusableSessionProjection,
  type ReusableSessionTouchClient,
  type SessionTouchClock,
  type SessionTouchTimer,
  type SilentRetireRequest,
  type TouchClientCallOptions,
  type TouchClientResult,
} from '../../../src/core/management-api/session-touch-scheduler.js';

const MINUTE = 60_000;
const BASE_NOW = Date.parse('2026-07-30T10:00:00.000Z');

function iso(value: number): string {
  return new Date(value).toISOString();
}

function session(
  overrides: Partial<ReusableSessionProjection> = {}
): ReusableSessionProjection {
  return {
    runId: 'run-1',
    sessionKey: 'reviewer',
    role: 'reviewer',
    status: 'idle',
    cwd: 'C:\\repo',
    lifecycle: {
      createdAt: iso(BASE_NOW - 2 * 60 * MINUTE),
      updatedAt: iso(BASE_NOW - 50 * MINUTE),
      lastWakeAt: iso(BASE_NOW - 50 * MINUTE),
    },
    touchPolicy: {
      mode: 'auto',
      deadlineAt: iso(BASE_NOW + 2 * 60 * MINUTE),
      maxTouches: 3,
      touchesUsed: 0,
      deadlineAction: 'stop',
    },
    wakes: [],
    ...overrides,
  };
}

class FakeClock implements SessionTouchClock {
  constructor(public value = BASE_NOW) {}
  now(): number {
    return this.value;
  }
}

class FakeTimer implements SessionTouchTimer {
  callback?: () => void;
  intervalMs?: number;
  clears = 0;

  setInterval(callback: () => void, intervalMs: number): unknown {
    this.callback = callback;
    this.intervalMs = intervalMs;
    return { fake: true };
  }

  clearInterval(): void {
    this.clears += 1;
  }

  fire(): void {
    this.callback?.();
  }
}

class FakeClient implements ReusableSessionTouchClient {
  sessions: ReusableSessionProjection[] = [];
  lists = 0;
  touches: ConditionalTouchRequest[] = [];
  policies: PolicyUpdateRequest[] = [];
  retires: SilentRetireRequest[] = [];
  touchResult: TouchClientResult<ConditionalTouchOutcome> = {
    ok: true,
    value: { code: 'completed' },
  };

  async listAll() {
    this.lists += 1;
    return { ok: true as const, value: this.sessions };
  }

  async conditionalTouch(
    request: ConditionalTouchRequest
  ): Promise<TouchClientResult<ConditionalTouchOutcome>> {
    this.touches.push(request);
    return this.touchResult;
  }

  async updateTouchPolicy(
    request: PolicyUpdateRequest
  ): Promise<TouchClientResult<PolicyUpdateOutcome>> {
    this.policies.push(request);
    const projected =
      this.sessions.find(
        (candidate) =>
          candidate.runId === request.runId
          && candidate.sessionKey === request.sessionKey
      ) ?? session();
    return {
      ok: true as const,
      value: { code: 'updated', session: projected },
    };
  }

  async retireSilent(request: SilentRetireRequest) {
    this.retires.push(request);
    return {
      ok: true as const,
      value: this.sessions.find(
        (candidate) =>
          candidate.runId === request.runId
          && candidate.sessionKey === request.sessionKey
      ) ?? session(),
    };
  }
}

describe('session touch candidate classification', () => {
  it('exports the measured production timing and bounded message constants', () => {
    expect(SESSION_TOUCH_CADENCE_MS).toBe(50 * MINUTE);
    expect(SESSION_TOUCH_COLD_GAP_MS).toBe(60 * MINUTE);
    expect(SESSION_TOUCH_SCAN_INTERVAL_MS).toBe(MINUTE);
    expect(SESSION_TOUCH_BACKOFF_BASE_MS).toBe(MINUTE);
    expect(SESSION_TOUCH_BACKOFF_MAX_MS).toBe(10 * MINUTE);
    expect(SESSION_TOUCH_MESSAGE).toContain('Reply with exactly: OK');
  });

  it.each([
    {
      name: 'recent',
      value: session({
        lifecycle: {
          createdAt: iso(BASE_NOW - 60 * MINUTE),
          updatedAt: iso(BASE_NOW - 49 * MINUTE),
          lastWakeAt: iso(BASE_NOW - 49 * MINUTE),
        },
      }),
      expected: 'recent',
    },
    { name: 'eligible at cadence', value: session(), expected: 'eligible' },
    {
      name: 'eligible at cold boundary',
      value: session({
        lifecycle: {
          createdAt: iso(BASE_NOW - 2 * 60 * MINUTE),
          updatedAt: iso(BASE_NOW - 60 * MINUTE),
          lastWakeAt: iso(BASE_NOW - 60 * MINUTE),
        },
      }),
      expected: 'eligible',
    },
    {
      name: 'cold beyond boundary',
      value: session({
        lifecycle: {
          createdAt: iso(BASE_NOW - 2 * 60 * MINUTE),
          updatedAt: iso(BASE_NOW - 61 * MINUTE),
          lastWakeAt: iso(BASE_NOW - 61 * MINUTE),
        },
      }),
      expected: 'cold',
    },
    {
      name: 'backward clock',
      value: session({
        lifecycle: {
          createdAt: iso(BASE_NOW),
          updatedAt: iso(BASE_NOW + MINUTE),
          lastWakeAt: iso(BASE_NOW + MINUTE),
        },
      }),
      expected: 'clock-backward',
    },
    {
      name: 'exhausted',
      value: session({
        touchPolicy: {
          mode: 'auto',
          deadlineAt: iso(BASE_NOW + MINUTE),
          maxTouches: 2,
          touchesUsed: 2,
          deadlineAction: 'stop',
        },
      }),
      expected: 'exhausted',
    },
    {
      name: 'active',
      value: session({ status: 'waking' }),
      expected: 'not-idle',
    },
  ])('classifies $name without side effects', ({ value, expected }) => {
    expect(classifySessionTouchCandidate(value, BASE_NOW).kind).toBe(expected);
  });

  it('fails closed for missing/invalid policy facts', () => {
    expect(
      classifySessionTouchCandidate(
        session({
          touchPolicy: {
            mode: 'auto',
            maxTouches: 1,
            touchesUsed: 0,
            deadlineAction: 'stop',
          },
        }),
        BASE_NOW
      ).kind
    ).toBe('invalid');
    expect(
      classifySessionTouchCandidate(
        session({
          lifecycle: {
            createdAt: iso(BASE_NOW),
            updatedAt: iso(BASE_NOW),
          },
        }),
        BASE_NOW
      ).kind
    ).toBe('invalid');
  });

  it('applies stop/retire deadline before cold handling after a forward jump', () => {
    const coldAndExpired = session({
      lifecycle: {
        createdAt: iso(BASE_NOW - 2 * 60 * MINUTE),
        updatedAt: iso(BASE_NOW - 61 * MINUTE),
        lastWakeAt: iso(BASE_NOW - 61 * MINUTE),
      },
      touchPolicy: {
        mode: 'auto',
        deadlineAt: iso(BASE_NOW),
        maxTouches: 3,
        touchesUsed: 0,
        deadlineAction: 'retire-silent',
      },
    });
    expect(
      classifySessionTouchCandidate(coldAndExpired, BASE_NOW).kind
    ).toBe('deadline-retire');
    expect(
      classifySessionTouchCandidate(
        {
          ...coldAndExpired,
          touchPolicy: {
            ...coldAndExpired.touchPolicy,
            deadlineAction: 'stop',
          },
        },
        BASE_NOW
      ).kind
    ).toBe('deadline-stop');
  });
});

describe('stable touch identity and durable reconstruction', () => {
  it('hashes exact run/session/ordinal/attempt facts deterministically', () => {
    const first = sessionTouchMessageId('run-1', 'reviewer', 1, 1);
    expect(first).toMatch(/^rasen-touch-v1-[0-9a-f]{64}$/);
    expect(sessionTouchMessageId('run-1', 'reviewer', 1, 1)).toBe(first);
    expect(sessionTouchMessageId('run-1', 'reviewer', 1, 2)).not.toBe(first);
    expect(sessionTouchMessageId('run-1', 'planner', 1, 1)).not.toBe(first);
  });

  it('reuses consuming terminals for accounting and advances proven failures', () => {
    const completed = session({
      wakes: [
        {
          admittedAt: iso(BASE_NOW - 2 * MINUTE),
          settledAt: iso(BASE_NOW - MINUTE),
          outcome: 'completed',
          kind: 'touch',
          touchOrdinal: 1,
          touchAttempt: 2,
        },
      ],
    });
    expect(reconstructSessionTouchAttempt(completed)).toMatchObject({
      ordinal: 1,
      attempt: 2,
      reconcileTerminal: true,
      terminalOutcome: 'completed',
    });

    const failed = session({
      wakes: [
        {
          admittedAt: iso(BASE_NOW - 3 * MINUTE),
          settledAt: iso(BASE_NOW - 2 * MINUTE),
          outcome: 'pre_delivery_failed',
          kind: 'touch',
          touchOrdinal: 1,
          touchAttempt: 1,
        },
        {
          admittedAt: iso(BASE_NOW - 2 * MINUTE),
          settledAt: iso(BASE_NOW - MINUTE),
          outcome: 'pre_delivery_failed',
          kind: 'touch',
          touchOrdinal: 1,
          touchAttempt: 2,
        },
      ],
    });
    expect(reconstructSessionTouchAttempt(failed)).toMatchObject({
      ordinal: 1,
      attempt: 3,
      reconcileTerminal: false,
      terminalOutcome: 'pre_delivery_failed',
      retryNotBefore: BASE_NOW + MINUTE,
    });
  });
});

describe('session touch scheduler', () => {
  it('runs an immediate startup scan and sends an exact conditional touch', async () => {
    const client = new FakeClient();
    client.sessions = [session()];
    const timer = new FakeTimer();
    const scheduler = createSessionTouchScheduler({
      client,
      timer,
      clock: new FakeClock(),
    });

    scheduler.start();
    expect(client.lists).toBe(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(timer.intervalMs).toBe(SESSION_TOUCH_SCAN_INTERVAL_MS);
    expect(client.touches).toEqual([
      {
        runId: 'run-1',
        sessionKey: 'reviewer',
        message: SESSION_TOUCH_MESSAGE,
        messageId: sessionTouchMessageId('run-1', 'reviewer', 1, 1),
        expectedLastWakeAt: iso(BASE_NOW - 50 * MINUTE),
        touchOrdinal: 1,
        touchAttempt: 1,
      },
    ]);
    await scheduler.stop();
  });

  it('routes deadline and cold actions through the client without a wake', async () => {
    const client = new FakeClient();
    client.sessions = [
      session({
        sessionKey: 'stop',
        touchPolicy: {
          mode: 'auto',
          deadlineAt: iso(BASE_NOW),
          maxTouches: 2,
          touchesUsed: 0,
          deadlineAction: 'stop',
        },
      }),
      session({
        sessionKey: 'retire',
        touchPolicy: {
          mode: 'auto',
          deadlineAt: iso(BASE_NOW),
          maxTouches: 2,
          touchesUsed: 0,
          deadlineAction: 'retire-silent',
        },
      }),
      session({
        sessionKey: 'cold',
        lifecycle: {
          createdAt: iso(BASE_NOW - 70 * MINUTE),
          updatedAt: iso(BASE_NOW - 61 * MINUTE),
          lastWakeAt: iso(BASE_NOW - 61 * MINUTE),
        },
      }),
    ];
    const scheduler = createSessionTouchScheduler({
      client,
      clock: new FakeClock(),
    });

    await scheduler.scanNow();
    expect(client.touches).toHaveLength(0);
    expect(client.retires).toEqual([
      {
        runId: 'run-1',
        sessionKey: 'retire',
        reason: 'touch-deadline-expired',
      },
    ]);
    expect(client.policies.map((request) => request.sessionKey).sort()).toEqual([
      'cold',
      'stop',
    ]);
    expect(client.policies.every((request) => request.policy.mode === 'never'))
      .toBe(true);
  });

  it('treats an interactive-wins stale cold update as a benign skip', async () => {
    const client = new FakeClient();
    const cold = session({
      lifecycle: {
        createdAt: iso(BASE_NOW - 70 * MINUTE),
        updatedAt: iso(BASE_NOW - 61 * MINUTE),
        lastWakeAt: iso(BASE_NOW - 61 * MINUTE),
      },
    });
    client.sessions = [cold];
    client.updateTouchPolicy = vi.fn(
      async (
        request: PolicyUpdateRequest
      ): Promise<TouchClientResult<PolicyUpdateOutcome>> => {
        client.policies.push(request);
        return {
          ok: true,
          value: {
            code: 'stale',
            session: {
              ...cold,
              lifecycle: {
                ...cold.lifecycle,
                lastWakeAt: iso(BASE_NOW),
                updatedAt: iso(BASE_NOW),
              },
            },
          },
        };
      }
    );
    const scheduler = createSessionTouchScheduler({
      client,
      clock: new FakeClock(),
    });

    await scheduler.scanNow();
    expect(client.policies).toHaveLength(1);
    expect(client.policies[0]?.expectedLastWakeAt).toBe(
      iso(BASE_NOW - 61 * MINUTE)
    );
    expect(client.touches).toHaveLength(0);
    expect(client.retires).toHaveLength(0);
  });

  it('treats stale/contention as benign and isolates one failed session', async () => {
    const client = new FakeClient();
    client.sessions = [
      session({ sessionKey: 'one' }),
      session({ sessionKey: 'two' }),
    ];
    client.conditionalTouch = vi.fn(async (request: ConditionalTouchRequest) => {
      client.touches.push(request);
      if (request.sessionKey === 'one') {
        return {
          ok: false as const,
          phase: 'service' as const,
          code: 'unavailable',
          message: 'temporary',
        };
      }
      return {
        ok: true as const,
        value: { code: 'stale' as const },
      };
    });
    const scheduler = createSessionTouchScheduler({
      client,
      clock: new FakeClock(),
    });

    await scheduler.scanNow();
    expect(client.touches.map((request) => request.sessionKey).sort()).toEqual([
      'one',
      'two',
    ]);
  });

  it('retries a transport-uncertain request with the exact same identity after backoff', async () => {
    const client = new FakeClient();
    client.sessions = [session()];
    const clock = new FakeClock();
    client.conditionalTouch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        phase: 'transport_uncertain',
        code: 'ECONNRESET',
        message: 'reset after finish',
      })
      .mockResolvedValue({
        ok: true,
        value: { code: 'duplicate', terminalDisposition: 'completed' },
      });
    const scheduler = createSessionTouchScheduler({ client, clock });

    await scheduler.scanNow();
    expect(client.conditionalTouch).toHaveBeenCalledTimes(1);
    clock.value += SESSION_TOUCH_BACKOFF_BASE_MS - 1;
    await scheduler.scanNow();
    expect(client.conditionalTouch).toHaveBeenCalledTimes(1);
    clock.value += 1;
    await scheduler.scanNow();
    expect(client.conditionalTouch).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(client.conditionalTouch).mock.calls;
    expect(calls[1]![0].messageId).toBe(calls[0]![0].messageId);
    expect(calls[1]![0].touchAttempt).toBe(calls[0]![0].touchAttempt);
  });

  it('caps deterministic per-session exponential backoff', async () => {
    const client = new FakeClient();
    client.sessions = [session()];
    const clock = new FakeClock();
    client.conditionalTouch = vi.fn(async () => ({
      ok: false as const,
      phase: 'pre_delivery' as const,
      code: 'ECONNREFUSED',
      message: 'not admitted',
    }));
    const scheduler = createSessionTouchScheduler({
      client,
      clock,
      backoffBaseMs: 10,
      backoffMaxMs: 40,
    });

    for (const delay of [10, 20, 40, 40]) {
      await scheduler.scanNow();
      const admittedCalls = vi.mocked(client.conditionalTouch).mock.calls.length;
      clock.value += delay - 1;
      await scheduler.scanNow();
      expect(client.conditionalTouch).toHaveBeenCalledTimes(admittedCalls);
      clock.value += 1;
    }
    await scheduler.scanNow();
    expect(client.conditionalTouch).toHaveBeenCalledTimes(5);
  });

  it('reconciles a completed or uncertain durable terminal without replay identity drift', async () => {
    const client = new FakeClient();
    client.sessions = [
      session({
        wakes: [
          {
            admittedAt: iso(BASE_NOW - 2 * MINUTE),
            settledAt: iso(BASE_NOW - MINUTE),
            outcome: 'delivery_uncertain',
            kind: 'touch',
            touchOrdinal: 1,
            touchAttempt: 3,
          },
        ],
      }),
    ];
    const scheduler = createSessionTouchScheduler({
      client,
      clock: new FakeClock(),
    });
    await scheduler.scanNow();
    expect(client.touches[0]).toMatchObject({
      messageId: sessionTouchMessageId('run-1', 'reviewer', 1, 3),
      touchOrdinal: 1,
      touchAttempt: 3,
    });
  });

  it('coalesces repeated ticks into one follow-up and never overlaps scans', async () => {
    let release!: () => void;
    let active = 0;
    let maximumActive = 0;
    let lists = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client = new FakeClient();
    client.listAll = vi.fn(async () => {
      lists += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (lists === 1) await gate;
      active -= 1;
      return { ok: true as const, value: [] };
    });
    const scheduler = createSessionTouchScheduler({ client });

    const first = scheduler.scanNow();
    const second = scheduler.scanNow();
    const third = scheduler.scanNow();
    expect(lists).toBe(1);
    release();
    await Promise.all([first, second, third]);
    expect(lists).toBe(2);
    expect(maximumActive).toBe(1);
  });

  it('drains one committed uncertain attempt on stop without replaying its exact ID', async () => {
    let release!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const touchStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const events: string[] = [];
    const client = new FakeClient();
    client.sessions = [session()];
    client.conditionalTouch = vi.fn(async (request: ConditionalTouchRequest) => {
      client.touches.push(request);
      events.push('touch-start');
      markStarted();
      await gate;
      events.push('touch-end');
      return {
        ok: false as const,
        phase: 'transport_uncertain' as const,
        code: 'request_timeout',
        message: 'committed request classified within its operation bound',
      };
    });
    const timer = new FakeTimer();
    const scheduler = createSessionTouchScheduler({
      client,
      timer,
      clock: new FakeClock(),
      stopDrainMs: 100,
    });
    expect(client.lists).toBe(0);

    scheduler.start();
    await touchStarted;
    const stopped = scheduler.stop().then(() => events.push('stopped'));
    expect(events).toEqual(['touch-start']);
    timer.fire();
    release();
    await stopped;
    expect(events).toEqual(['touch-start', 'touch-end', 'stopped']);
    expect(timer.clears).toBe(1);
    expect(client.lists).toBe(1);
    expect(client.touches).toHaveLength(1);
    expect(client.touches[0]).toMatchObject({
      messageId: sessionTouchMessageId('run-1', 'reviewer', 1, 1),
      touchOrdinal: 1,
      touchAttempt: 1,
    });
  });

  it('closes the admission gate while list is pending and starts zero side effects after stop', async () => {
    let releaseList!: () => void;
    let markListStarted!: () => void;
    let observedSignal: AbortSignal | undefined;
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    const listStarted = new Promise<void>((resolve) => {
      markListStarted = resolve;
    });
    const client = new FakeClient();
    client.sessions = [
      session(),
      session({
        sessionKey: 'cold',
        lifecycle: {
          createdAt: iso(BASE_NOW - 70 * MINUTE),
          updatedAt: iso(BASE_NOW - 61 * MINUTE),
          lastWakeAt: iso(BASE_NOW - 61 * MINUTE),
        },
      }),
      session({
        sessionKey: 'retire',
        touchPolicy: {
          mode: 'auto',
          deadlineAt: iso(BASE_NOW),
          maxTouches: 2,
          touchesUsed: 0,
          deadlineAction: 'retire-silent',
        },
      }),
    ];
    client.listAll = vi.fn(async (options?: TouchClientCallOptions) => {
      observedSignal = options?.signal;
      markListStarted();
      await listGate;
      return { ok: true as const, value: client.sessions };
    });
    const scheduler = createSessionTouchScheduler({
      client,
      clock: new FakeClock(),
      stopDrainMs: 100,
    });

    const scan = scheduler.scanNow();
    await listStarted;
    const stopped = scheduler.stop();
    expect(observedSignal?.aborted).toBe(true);
    releaseList();
    await Promise.all([scan, stopped]);
    expect(client.touches).toHaveLength(0);
    expect(client.policies).toHaveLength(0);
    expect(client.retires).toHaveLength(0);
  });
});
