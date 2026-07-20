import type { SessionDetailResponse, SessionsResponse } from '../../src/api/types.js';

/**
 * Fixtures shaped exactly like the settled wire contract from
 * `src/core/management-api/wire-types.ts` (child 1, `slice3-session-runtime`).
 * `satisfies SessionsResponse` is the compile-time drift tripwire — see
 * `test/api/fixtures.test.ts` for the runtime half.
 */
export const sessionsListFixture = {
  sessions: [
    {
      session: {
        id: 'sess-live-with-progress',
        kind: 'auto',
        task: 'Add sessions UI',
        cwd: '/proj',
        pid: 4242,
        agentSessionId: 'claude-abc123',
        state: 'running',
        startedAt: 1_700_000_000_000,
        lastOutputAt: 1_700_000_060_000,
        changeName: 'slice3-sessions-ui',
      },
      runState: {
        name: 'slice3-sessions-ui',
        kind: 'ok',
        autoRun: {
          kind: 'ok',
          state: {
            pipeline: 'full-feature',
            stages: {
              propose: { status: 'done' },
              apply: { status: 'in_progress' },
              review: { status: 'pending' },
            },
          },
        },
        portfolio: { kind: 'absent' },
        goalRun: { kind: 'absent' },
      },
    },
    {
      session: {
        id: 'sess-exited-killed',
        kind: 'goal',
        task: 'Explore a spike',
        cwd: '/proj',
        state: 'exited',
        startedAt: 1_699_999_000_000,
        lastOutputAt: 1_699_999_500_000,
        endedAt: 1_699_999_600_000,
        exitCode: null,
        exitSignal: 'SIGTERM',
        terminationReason: 'killed',
      },
      runState: { kind: 'absent' },
    },
    {
      session: {
        id: 'sess-no-change',
        kind: 'auto',
        task: 'A run with no changeName yet',
        cwd: '/proj',
        state: 'starting',
        startedAt: 1_700_000_100_000,
        lastOutputAt: 1_700_000_100_000,
      },
      runState: { kind: 'absent' },
    },
    {
      session: {
        id: 'sess-invalid-run-state',
        kind: 'auto',
        task: 'A run whose state file is malformed',
        cwd: '/proj',
        state: 'running',
        startedAt: 1_700_000_200_000,
        lastOutputAt: 1_700_000_200_000,
        changeName: 'broken-change',
      },
      runState: {
        name: 'broken-change',
        kind: 'ok',
        autoRun: { kind: 'invalid', reason: 'auto-run.json failed schema validation' },
        portfolio: { kind: 'absent' },
        goalRun: { kind: 'absent' },
      },
    },
  ],
} satisfies SessionsResponse;

export const sessionDetailFixture = {
  session: sessionsListFixture.sessions[0]!.session,
  tails: { stdout: 'building...\ndone.\n', stderr: '' },
} satisfies SessionDetailResponse;
