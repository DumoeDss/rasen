import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { Command } from 'commander';

import { createProgram } from '../../src/cli/index.js';
import { registerSessionCommand } from '../../src/commands/session.js';
import { writeDaemonState } from '../../src/core/management-api/daemon-state.js';
import type { ReusableSessionService } from '../../src/core/management-api/reusable-session-api.js';
import { REUSABLE_SESSION_API_SCHEMA } from '../../src/core/management-api/wire-types.js';
import {
  agentAction,
  bugFixPlan,
} from '../core/change-run/reconciler-fixture.js';
import { cleanupTempPathAsync } from '../helpers/temp-cleanup.js';

describe('session CLI resident-owner output', () => {
  let root: string | undefined;
  let server: http.Server | undefined;
  let previousEnv: NodeJS.ProcessEnv;

  afterEach(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => error ? reject(error) : resolve())
      );
    }
    server = undefined;
    process.exitCode = undefined;
    process.env = previousEnv;
    if (root !== undefined) await cleanupTempPathAsync(root);
    root = undefined;
  });

  it('reports foreground ownership and drains it after command completion', async () => {
    previousEnv = { ...process.env };
    process.env.RASEN_LANG = 'en';
    process.env.RASEN_TELEMETRY = '0';
    const ownerShutdown = vi.fn(async () => ({ ok: true as const }));
    const service = {
      list: vi.fn(async () => ({
        schema: REUSABLE_SESSION_API_SCHEMA,
        ok: true as const,
        operation: 'list' as const,
        code: 'listed',
        runId: `run:${'c'.repeat(64)}`,
        sessions: [],
      })),
      wake: vi.fn(),
      retire: vi.fn(),
      updateTouchPolicy: vi.fn(),
      ownerShutdown,
    } as unknown as ReusableSessionService;
    const program = new Command().name('rasen');
    registerSessionCommand(program, 'en', {
      selectOwner: async () => ({
        ok: true,
        mode: 'foreground',
        service,
      }),
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await program.parseAsync([
        'session',
        'list',
        '--run',
        `run:${'c'.repeat(64)}`,
        '--json',
      ], { from: 'user' });
      expect(log).toHaveBeenCalledOnce();
      expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({
        schema: 'rasen-session-command/1',
        command: 'list',
        ownerMode: 'foreground',
        ok: true,
      });
      expect(ownerShutdown).toHaveBeenCalledOnce();
    } finally {
      log.mockRestore();
    }
  });

  it('replaces foreground success with one owner-shutdown failure document', async () => {
    previousEnv = { ...process.env };
    process.env.RASEN_LANG = 'en';
    process.env.RASEN_TELEMETRY = '0';
    const service = {
      list: vi.fn(async () => ({
        schema: REUSABLE_SESSION_API_SCHEMA,
        ok: true as const,
        operation: 'list' as const,
        code: 'listed',
        runId: `run:${'d'.repeat(64)}`,
        sessions: [],
      })),
      wake: vi.fn(),
      retire: vi.fn(),
      updateTouchPolicy: vi.fn(),
      ownerShutdown: vi.fn(async () => ({
        ok: false as const,
        code: 'owner_shutdown_failed' as const,
        message: 'safe aggregate',
        failures: [
          {
            runId: `run:${'d'.repeat(64)}`,
            code: 'registry_write_failed',
            message: 'safe registry failure',
          },
        ],
      })),
    } as unknown as ReusableSessionService;
    const program = new Command().name('rasen');
    registerSessionCommand(program, 'en', {
      selectOwner: async () => ({
        ok: true,
        mode: 'foreground',
        service,
      }),
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await program.parseAsync([
        'session',
        'list',
        '--run',
        `run:${'d'.repeat(64)}`,
        '--json',
      ], { from: 'user' });
      expect(process.exitCode).toBe(1);
      expect(log).toHaveBeenCalledOnce();
      expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({
        schema: 'rasen-session-command/1',
        command: 'list',
        ownerMode: 'foreground',
        ok: false,
        outcome: {
          code: 'owner_shutdown_failed',
          failures: [
            {
              runId: `run:${'d'.repeat(64)}`,
              code: 'registry_write_failed',
              message: 'safe registry failure',
            },
          ],
        },
      });
      expect(JSON.stringify(JSON.parse(String(log.mock.calls[0]![0]))))
        .not.toMatch(/token|prompt|owner-secret|raw-message-id|lock-path/u);

      process.exitCode = undefined;
      const humanProgram = new Command().name('rasen');
      registerSessionCommand(humanProgram, 'en', {
        selectOwner: async () => ({
          ok: true,
          mode: 'foreground',
          service,
        }),
      });
      await humanProgram.parseAsync([
        'session',
        'list',
        '--run',
        `run:${'d'.repeat(64)}`,
      ], { from: 'user' });
      const human = error.mock.calls.flat().join('\n');
      expect(process.exitCode).toBe(1);
      expect(human).toContain('owner_shutdown_failed');
      expect(human).toContain(`run:${'d'.repeat(64)}`);
      expect(human).toContain('registry_write_failed');
      expect(human).toContain('safe registry failure');
      expect(human).not.toMatch(
        /token|prompt|owner-secret|raw-message-id|lock-path/u
      );
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });

  it('keeps foreground exec/list/retire human and JSON outcomes equivalent', async () => {
    previousEnv = { ...process.env };
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-session-foreground-'));
    process.env.RASEN_LANG = 'en';
    process.env.RASEN_TELEMETRY = '0';
    const plan = bugFixPlan();
    const action = agentAction(plan, 'root/apply');
    const actionPath = path.join(root, 'action.json');
    fs.writeFileSync(actionPath, JSON.stringify({
      ...action,
      agent: { ...action.agent, runtime: 'claude' },
    }));
    const projection = {
      runId: plan.runId,
      sessionKey: 'reviewer',
      role: 'implementer',
      status: 'idle' as const,
      cwd: root,
      lifecycle: {
        createdAt: '2026-07-30T09:00:00.000Z',
        updatedAt: '2026-07-30T09:00:00.000Z',
      },
      touchPolicy: {
        mode: 'never' as const,
        maxTouches: 0,
        touchesUsed: 0,
        deadlineAction: 'stop' as const,
      },
      wakes: [],
    };
    const service = {
      wake: vi.fn(async () => ({
        schema: REUSABLE_SESSION_API_SCHEMA,
        ok: true as const,
        operation: 'wake' as const,
        code: 'completed',
        runId: plan.runId,
        sessionKey: 'reviewer',
        disposition: 'completed' as const,
        terminalDisposition: 'completed' as const,
        session: projection,
      })),
      list: vi.fn(async () => ({
        schema: REUSABLE_SESSION_API_SCHEMA,
        ok: true as const,
        operation: 'list' as const,
        code: 'listed',
        runId: plan.runId,
        sessions: [projection],
      })),
      retire: vi.fn(async () => ({
        schema: REUSABLE_SESSION_API_SCHEMA,
        ok: true as const,
        operation: 'retire' as const,
        code: 'retired',
        runId: plan.runId,
        sessionKey: 'reviewer',
        session: { ...projection, status: 'retired' as const },
      })),
      updateTouchPolicy: vi.fn(),
      ownerShutdown: vi.fn(async () => ({ ok: true as const })),
    } as unknown as ReusableSessionService;
    const selectOwner = async () => ({
      ok: true as const,
      mode: 'foreground' as const,
      service,
    });
    const cases = [
      {
        command: 'exec',
        args: [
          'session', 'exec',
          '--run', plan.runId,
          '--session', 'reviewer',
          '--action', actionPath,
          '--cwd', root,
        ],
        human: 'completed',
      },
      {
        command: 'list',
        args: ['session', 'list', '--run', plan.runId],
        human: 'Reusable sessions (1):',
      },
      {
        command: 'retire',
        args: [
          'session', 'retire',
          '--run', plan.runId,
          '--session', 'reviewer',
        ],
        human: 'retired',
      },
    ] as const;
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      for (const value of cases) {
        log.mockClear();
        const jsonProgram = new Command().name('rasen');
        registerSessionCommand(jsonProgram, 'en', { selectOwner });
        await jsonProgram.parseAsync([...value.args, '--json'], {
          from: 'user',
        });
        expect(log).toHaveBeenCalledOnce();
        expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({
          schema: 'rasen-session-command/1',
          command: value.command,
          ownerMode: 'foreground',
          ok: true,
        });

        log.mockClear();
        const humanProgram = new Command().name('rasen');
        registerSessionCommand(humanProgram, 'en', { selectOwner });
        await humanProgram.parseAsync([...value.args], { from: 'user' });
        expect(log.mock.calls.flat().join('\n')).toContain(value.human);
      }
      expect(service.ownerShutdown).toHaveBeenCalledTimes(6);
    } finally {
      log.mockRestore();
    }
  });

  it('emits equivalent exec/list/retire results and never falls back after identity drift', async () => {
    previousEnv = { ...process.env };
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-session-e2e-'));
    process.env.RASEN_HOME = root;
    process.env.RASEN_LANG = 'en';
    process.env.RASEN_TELEMETRY = '0';
    const token = 'resident-owner-token';
    const version = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')
    ).version as string;
    const plan = bugFixPlan();
    const baseAction = agentAction(plan, 'root/apply');
    const action = {
      ...baseAction,
      agent: { ...baseAction.agent, runtime: 'claude' },
    };
    const actionPath = path.join(root, 'action.json');
    fs.writeFileSync(actionPath, JSON.stringify(action));
    let driftBusinessIdentity = false;
    let forcedOutcome:
      | 'duplicate'
      | 'busy'
      | 'unavailable'
      | 'uncertain'
      | 'owner-shutdown'
      | 'extra-field'
      | 'wrong-projection'
      | 'wrong-list-run'
      | 'exact-limit'
      | 'oversized'
      | 'truncated'
      | 'response-error'
      | undefined;
    const businessPaths: string[] = [];
    server = http.createServer((request, response) => {
      const isStatus = request.url === '/api/v1/status';
      if (!isStatus) businessPaths.push(request.url ?? '');
      const stampedVersion =
        !isStatus && driftBusinessIdentity ? 'replaced-daemon' : version;
      response.setHeader('x-rasen-daemon', stampedVersion);
      response.setHeader('x-rasen-pid', String(process.pid));
      if (isStatus) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{}');
        return;
      }
      request.resume();
      if (request.headers.authorization !== `Bearer ${token}`) {
        response.writeHead(401);
        response.end('{}');
        return;
      }
      const projection = {
        runId: plan.runId,
        sessionKey: 'reviewer',
        role: 'implementer',
        status: request.url?.endsWith('/retire') ? 'retired' : 'idle',
        cwd: root!,
        lifecycle: {
          createdAt: '2026-07-30T09:00:00.000Z',
          updatedAt: '2026-07-30T09:00:00.000Z',
        },
        touchPolicy: {
          mode: 'never',
          maxTouches: 0,
          touchesUsed: 0,
          deadlineAction: 'stop',
        },
        wakes: [],
      };
      const operation = request.url?.includes('/wake')
        ? 'wake'
        : request.url?.includes('/retire')
          ? 'retire'
          : 'list';
      response.writeHead(200, { 'Content-Type': 'application/json' });
      if (
        forcedOutcome === 'busy'
        || forcedOutcome === 'unavailable'
        || forcedOutcome === 'uncertain'
        || forcedOutcome === 'owner-shutdown'
      ) {
        response.end(JSON.stringify({
          schema: REUSABLE_SESSION_API_SCHEMA,
          ok: false,
          operation,
          code:
            forcedOutcome === 'busy'
              ? 'wake_busy'
              : forcedOutcome === 'unavailable'
                ? 'session_not_found'
                : forcedOutcome === 'uncertain'
                  ? 'delivery_uncertain'
                  : 'owner_shutdown_failed',
          message: 'safe failure',
          runId: plan.runId,
          sessionKey: 'reviewer',
          ...(forcedOutcome === 'owner-shutdown'
            ? {
                failures: [
                  {
                    runId: plan.runId,
                    code: 'registry_write_failed',
                    message:
                      'The reusable-session coordinator failed to shut down cleanly.',
                  },
                ],
              }
            : {}),
        }));
        return;
      }
      const payload: Record<string, unknown> = {
        schema: REUSABLE_SESSION_API_SCHEMA,
        ok: true,
        operation,
        code:
          forcedOutcome === 'duplicate'
            ? 'duplicate_completed'
            : operation === 'list'
            ? 'listed'
            : operation === 'retire'
              ? 'retired'
              : 'completed',
        runId: plan.runId,
        ...(operation === 'list'
          ? { sessions: [projection] }
          : {
              sessionKey: 'reviewer',
              session: projection,
              ...(operation === 'wake'
                ? {
                    disposition:
                      forcedOutcome === 'duplicate'
                        ? 'duplicate'
                        : 'completed',
                    terminalDisposition: 'completed',
                  }
                : {}),
            }),
      };
      if (forcedOutcome === 'extra-field') {
        payload.bearerToken = 'must-never-reach-stdout';
      }
      if (forcedOutcome === 'wrong-projection') {
        delete payload.sessions;
        payload.session = projection;
      }
      if (forcedOutcome === 'wrong-list-run') {
        payload.sessions = [
          {
            ...projection,
            runId: `run:${'b'.repeat(64)}`,
            cwd: 'must-never-reach-stdout',
          },
        ];
      }
      let encoded = Buffer.from(JSON.stringify(payload), 'utf-8');
      if (forcedOutcome === 'exact-limit' || forcedOutcome === 'oversized') {
        encoded = Buffer.concat([
          encoded,
          Buffer.alloc(
            2 * 1024 * 1024
              - encoded.byteLength
              + (forcedOutcome === 'oversized' ? 1 : 0),
            0x20
          ),
        ]);
      }
      if (
        forcedOutcome === 'truncated'
        || forcedOutcome === 'response-error'
      ) {
        response.write(encoded.subarray(0, Math.floor(encoded.byteLength / 2)));
        response.destroy(
          forcedOutcome === 'response-error'
            ? new Error('injected response error')
            : undefined
        );
        return;
      }
      response.end(encoded);
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Expected a TCP test listener.');
    }
    writeDaemonState({
      version,
      pid: process.pid,
      port: address.port,
      token,
      startedAt: Date.now(),
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await createProgram({ locale: 'en' }).parseAsync([
        'node', 'rasen', 'session', 'exec',
        '--run', plan.runId,
        '--session', 'reviewer',
        '--action', actionPath,
        '--cwd', root,
        '--json',
      ]);
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
        schema: 'rasen-session-command/1',
        command: 'exec',
        ownerMode: 'daemon',
        ok: true,
        outcome: { code: 'completed' },
        session: { runId: plan.runId, sessionKey: 'reviewer' },
      });
      process.exitCode = undefined;
      log.mockClear();
      error.mockClear();
      await createProgram({ locale: 'en' }).parseAsync([
        'node', 'rasen', 'session', 'exec',
        '--run', plan.runId,
        '--session', 'reviewer',
        '--action', actionPath,
        '--cwd', root,
      ]);
      expect(process.exitCode ?? 0).toBe(0);
      expect(log.mock.calls.flat().join('\n')).toContain(
        'Session turn completed.'
      );

      forcedOutcome = 'duplicate';
      log.mockClear();
      await createProgram({ locale: 'en' }).parseAsync([
        'node', 'rasen', 'session', 'exec',
        '--run', plan.runId,
        '--session', 'reviewer',
        '--action', actionPath,
        '--cwd', root,
      ]);
      expect(log.mock.calls.flat().join('\n'))
        .toContain('already completed');
      process.exitCode = undefined;
      log.mockClear();
      error.mockClear();
      await createProgram({ locale: 'en' }).parseAsync([
        'node', 'rasen', 'session', 'exec',
        '--run', plan.runId,
        '--session', 'reviewer',
        '--action', actionPath,
        '--cwd', root,
        '--json',
      ]);
      expect(process.exitCode ?? 0).toBe(0);
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
        command: 'exec',
        ownerMode: 'daemon',
        ok: true,
        outcome: {
          code: 'duplicate_completed',
          disposition: 'duplicate',
          terminalDisposition: 'completed',
        },
      });

      forcedOutcome = 'busy';
      process.exitCode = undefined;
      log.mockClear();
      await createProgram({ locale: 'en' }).parseAsync([
        'node', 'rasen', 'session', 'exec',
        '--run', plan.runId,
        '--session', 'reviewer',
        '--action', actionPath,
        '--cwd', root,
        '--json',
      ]);
      expect(process.exitCode).toBe(3);
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0])))
        .toMatchObject({ outcome: { code: 'wake_busy' } });
      process.exitCode = undefined;
      log.mockClear();
      error.mockClear();
      await createProgram({ locale: 'en' }).parseAsync([
        'node', 'rasen', 'session', 'exec',
        '--run', plan.runId,
        '--session', 'reviewer',
        '--action', actionPath,
        '--cwd', root,
      ]);
      expect(process.exitCode).toBe(3);
      expect(error.mock.calls.flat().join('\n')).toContain(
        "Another owner holds this session's wake lease."
      );

      forcedOutcome = 'unavailable';
      process.exitCode = undefined;
      log.mockClear();
      await createProgram({ locale: 'en' }).parseAsync([
        'node', 'rasen', 'session', 'exec',
        '--run', plan.runId,
        '--session', 'reviewer',
        '--action', actionPath,
        '--cwd', root,
        '--json',
      ]);
      expect(process.exitCode).toBe(4);
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0])))
        .toMatchObject({ outcome: { code: 'session_not_found' } });
      process.exitCode = undefined;
      log.mockClear();
      error.mockClear();
      await createProgram({ locale: 'en' }).parseAsync([
        'node', 'rasen', 'session', 'exec',
        '--run', plan.runId,
        '--session', 'reviewer',
        '--action', actionPath,
        '--cwd', root,
      ]);
      expect(process.exitCode).toBe(4);
      expect(error.mock.calls.flat().join('\n')).toContain(
        'The reusable session was not found.'
      );

      forcedOutcome = 'uncertain';
      process.exitCode = undefined;
      log.mockClear();
      await createProgram({ locale: 'en' }).parseAsync([
        'node', 'rasen', 'session', 'exec',
        '--run', plan.runId,
        '--session', 'reviewer',
        '--action', actionPath,
        '--cwd', root,
        '--json',
      ]);
      expect(process.exitCode).toBe(5);
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0])))
        .toMatchObject({ outcome: { code: 'delivery_uncertain' } });
      process.exitCode = undefined;
      log.mockClear();
      error.mockClear();
      await createProgram({ locale: 'en' }).parseAsync([
        'node', 'rasen', 'session', 'exec',
        '--run', plan.runId,
        '--session', 'reviewer',
        '--action', actionPath,
        '--cwd', root,
      ]);
      expect(process.exitCode).toBe(5);
      expect(error.mock.calls.flat().join('\n')).toContain(
        'Delivery may have reached the agent and was not replayed.'
      );

      forcedOutcome = undefined;
      process.exitCode = undefined;
      log.mockClear();
      await createProgram({ locale: 'en' }).parseAsync([
        'node', 'rasen', 'session', 'list',
        '--run', plan.runId,
      ]);
      expect(log.mock.calls.flat().join('\n'))
        .toContain('Reusable sessions (1):');
      process.exitCode = undefined;
      log.mockClear();
      error.mockClear();
      await createProgram({ locale: 'en' }).parseAsync([
        'node', 'rasen', 'session', 'list',
        '--run', plan.runId,
        '--json',
      ]);
      expect(process.exitCode ?? 0).toBe(0);
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
        command: 'list',
        ownerMode: 'daemon',
        ok: true,
        outcome: { code: 'listed' },
        sessions: [{ runId: plan.runId, sessionKey: 'reviewer' }],
      });

      log.mockClear();
      await createProgram({ locale: 'en' }).parseAsync([
        'node', 'rasen', 'session', 'retire',
        '--run', plan.runId,
        '--session', 'reviewer',
        '--json',
      ]);
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
        command: 'retire',
        ownerMode: 'daemon',
        ok: true,
        outcome: { code: 'retired' },
        session: {
          runId: plan.runId,
          sessionKey: 'reviewer',
          status: 'retired',
        },
      });
      process.exitCode = undefined;
      log.mockClear();
      error.mockClear();
      await createProgram({ locale: 'en' }).parseAsync([
        'node', 'rasen', 'session', 'retire',
        '--run', plan.runId,
        '--session', 'reviewer',
      ]);
      expect(process.exitCode ?? 0).toBe(0);
      expect(log.mock.calls.flat().join('\n')).toContain(
        'Reusable session retired.'
      );

      forcedOutcome = 'owner-shutdown';
      process.exitCode = undefined;
      log.mockClear();
      error.mockClear();
      await createProgram({ locale: 'en' }).parseAsync([
        'node', 'rasen', 'session', 'exec',
        '--run', plan.runId,
        '--session', 'reviewer',
        '--action', actionPath,
        '--cwd', root,
        '--json',
      ]);
      expect(process.exitCode).toBe(1);
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
        command: 'exec',
        ownerMode: 'daemon',
        ok: false,
        outcome: {
          code: 'owner_shutdown_failed',
          failures: [
            {
              runId: plan.runId,
              code: 'registry_write_failed',
              message:
                'The reusable-session coordinator failed to shut down cleanly.',
            },
          ],
        },
      });
      process.exitCode = undefined;
      log.mockClear();
      error.mockClear();
      await createProgram({ locale: 'en' }).parseAsync([
        'node', 'rasen', 'session', 'exec',
        '--run', plan.runId,
        '--session', 'reviewer',
        '--action', actionPath,
        '--cwd', root,
      ]);
      expect(process.exitCode).toBe(1);
      const shutdownHuman = error.mock.calls.flat().join('\n');
      expect(shutdownHuman).toContain(
        'The reusable-session owner could not shut down cleanly.'
      );
      expect(shutdownHuman).toContain(plan.runId);
      expect(shutdownHuman).toContain('registry_write_failed');

      for (const strictCase of [
        'extra-field',
        'wrong-projection',
        'wrong-list-run',
        'oversized',
        'truncated',
        'response-error',
      ] as const) {
        forcedOutcome = strictCase;
        process.exitCode = undefined;
        log.mockClear();
        await createProgram({ locale: 'en' }).parseAsync([
          'node', 'rasen', 'session', 'list',
          '--run', plan.runId,
          '--json',
        ]);
        expect(process.exitCode).toBe(5);
        expect(log).toHaveBeenCalledOnce();
        const document = JSON.parse(
          String(log.mock.calls.at(-1)?.[0])
        ) as Record<string, unknown>;
        expect(document).toMatchObject({
          command: 'list',
          ok: false,
          outcome: { code: 'transport_uncertain' },
        });
        expect(JSON.stringify(document))
          .not.toContain('must-never-reach-stdout');

        process.exitCode = undefined;
        log.mockClear();
        error.mockClear();
        await createProgram({ locale: 'en' }).parseAsync([
          'node', 'rasen', 'session', 'list',
          '--run', plan.runId,
        ]);
        expect(process.exitCode).toBe(5);
        const strictHuman = error.mock.calls.flat().join('\n');
        expect(strictHuman).toContain(
          'The daemon request may have been admitted.'
        );
        expect(strictHuman).not.toContain('must-never-reach-stdout');
      }

      forcedOutcome = 'exact-limit';
      process.exitCode = undefined;
      log.mockClear();
      await createProgram({ locale: 'en' }).parseAsync([
        'node', 'rasen', 'session', 'list',
        '--run', plan.runId,
        '--json',
      ]);
      expect(process.exitCode).toBe(0);
      expect(log).toHaveBeenCalledOnce();
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
        command: 'list',
        ok: true,
      });

      forcedOutcome = undefined;
      driftBusinessIdentity = true;
      process.exitCode = undefined;
      log.mockClear();
      const before = businessPaths.length;
      await createProgram({ locale: 'en' }).parseAsync([
        'node', 'rasen', 'session', 'list',
        '--run', plan.runId,
        '--json',
      ]);
      expect(process.exitCode).toBe(5);
      expect(businessPaths).toHaveLength(before + 1);
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
        command: 'list',
        ownerMode: 'daemon',
        ok: false,
        outcome: { code: 'transport_uncertain' },
      });
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});
