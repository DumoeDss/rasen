import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { Command } from 'commander';

import { createProgram } from '../../src/cli/index.js';
import {
  readSessionActionSource,
  registerSessionCommand,
  selectSessionOwner,
  sessionCommandExitCode,
} from '../../src/commands/session.js';
import { writeDaemonState } from '../../src/core/management-api/daemon-state.js';
import { getLocaleCatalog } from '../../src/locales/index.js';
import {
  decodeReusableSessionApiResponse,
  REUSABLE_SESSION_API_SCHEMA,
  type ReusableSessionApiResponseExpectation,
} from '../../src/core/management-api/wire-types.js';
import type { CliLocale } from '../../src/utils/locale.js';
import { cleanupTempPathAsync } from '../helpers/temp-cleanup.js';
import {
  agentAction,
  bugFixPlan,
} from '../core/change-run/reconciler-fixture.js';

const RUN_ID = `run:${'a'.repeat(64)}`;
const temporaryPaths: string[] = [];

function failure(code: string) {
  return {
    schema: REUSABLE_SESSION_API_SCHEMA,
    ok: false as const,
    operation: 'wake' as const,
    code,
    message: 'safe diagnostic',
  };
}

function responseProjection(runId = RUN_ID, sessionKey = 'reviewer') {
  return {
    runId,
    sessionKey,
    role: 'implementer',
    status: 'idle' as const,
    cwd: 'C:\\workspace',
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
}

afterEach(async () => {
  process.exitCode = undefined;
  while (temporaryPaths.length > 0) {
    await cleanupTempPathAsync(temporaryPaths.pop()!);
  }
});

describe('public reusable-session command surface', () => {
  it.each([
    {
      name: 'wrong top-level run identity',
      expectation: {
        operation: 'wake',
        runId: RUN_ID,
        sessionKey: 'reviewer',
      },
      response: {
        schema: REUSABLE_SESSION_API_SCHEMA,
        ok: true,
        operation: 'wake',
        code: 'completed',
        runId: `run:${'b'.repeat(64)}`,
        sessionKey: 'reviewer',
        disposition: 'completed',
        terminalDisposition: 'completed',
        session: responseProjection(),
      },
    },
    {
      name: 'wrong nested wake session identity',
      expectation: {
        operation: 'wake',
        runId: RUN_ID,
        sessionKey: 'reviewer',
      },
      response: {
        schema: REUSABLE_SESSION_API_SCHEMA,
        ok: true,
        operation: 'wake',
        code: 'completed',
        runId: RUN_ID,
        sessionKey: 'reviewer',
        disposition: 'completed',
        terminalDisposition: 'completed',
        session: responseProjection(RUN_ID, 'other-session'),
      },
    },
    {
      name: 'wrong nested retire run identity',
      expectation: {
        operation: 'retire',
        runId: RUN_ID,
        sessionKey: 'reviewer',
      },
      response: {
        schema: REUSABLE_SESSION_API_SCHEMA,
        ok: true,
        operation: 'retire',
        code: 'retired',
        runId: RUN_ID,
        sessionKey: 'reviewer',
        session: responseProjection(`run:${'b'.repeat(64)}`),
      },
    },
    {
      name: 'wrong nested failure session identity',
      expectation: {
        operation: 'wake',
        runId: RUN_ID,
        sessionKey: 'reviewer',
      },
      response: {
        schema: REUSABLE_SESSION_API_SCHEMA,
        ok: false,
        operation: 'wake',
        code: 'session_not_found',
        message: 'safe failure',
        runId: RUN_ID,
        sessionKey: 'reviewer',
        session: responseProjection(RUN_ID, 'other-session'),
      },
    },
    {
      name: 'wrong-run exact-list item',
      expectation: {
        operation: 'list',
        runId: RUN_ID,
      },
      response: {
        schema: REUSABLE_SESSION_API_SCHEMA,
        ok: true,
        operation: 'list',
        code: 'listed',
        runId: RUN_ID,
        sessions: [responseProjection(`run:${'b'.repeat(64)}`)],
      },
    },
  ] satisfies Array<{
    name: string;
    expectation: ReusableSessionApiResponseExpectation;
    response: unknown;
  }>)(
    'rejects a strictly-shaped daemon response with $name',
    ({ expectation, response }) => {
      expect(
        decodeReusableSessionApiResponse(response, expectation)
      ).toBeNull();
    }
  );

  it('allows multiple runs only for the explicit all-scope list expectation', () => {
    const response = {
      schema: REUSABLE_SESSION_API_SCHEMA,
      ok: true,
      operation: 'list',
      code: 'listed',
      sessions: [
        responseProjection(RUN_ID),
        responseProjection(`run:${'b'.repeat(64)}`, 'other-session'),
      ],
    };
    expect(
      decodeReusableSessionApiResponse(response, {
        operation: 'list',
        scope: 'all',
      })
    ).not.toBeNull();
    expect(
      decodeReusableSessionApiResponse(
        { ...response, runId: RUN_ID },
        { operation: 'list', runId: RUN_ID }
      )
    ).toBeNull();
  });

  it('renders localized nested help and examples in all catalogues', () => {
    for (const locale of ['en', 'ja', 'zh-cn'] as const) {
      const program = createProgram({ locale });
      const session = program.commands.find(
        (command) => command.name() === 'session'
      );
      const exec = session?.commands.find(
        (command) => command.name() === 'exec'
      );
      let output = '';
      exec?.configureOutput({
        writeOut: (text) => {
          output += text;
        },
      });
      exec?.outputHelp();
      const catalog = getLocaleCatalog(locale);
      expect(output).toContain(
        catalog.cli.root.commands.session.commands.exec.description
      );
      expect(output).toContain(catalog.session.examples.exec);
      expect(output).toContain('--touch <mode>');
      expect(output).toContain('--deadline-action <action>');
    }
  });

  it('maps stable public outcomes into exit classes 0 through 5', () => {
    const completed = {
      schema: REUSABLE_SESSION_API_SCHEMA,
      ok: true as const,
      operation: 'wake' as const,
      code: 'completed',
    };
    expect(sessionCommandExitCode(completed)).toBe(0);
    expect(sessionCommandExitCode(failure('registry_write_failed'))).toBe(1);
    expect(sessionCommandExitCode(failure('invalid_action'))).toBe(2);
    expect(sessionCommandExitCode(failure('wake_busy'))).toBe(3);
    expect(sessionCommandExitCode(failure('session_not_found'))).toBe(4);
    expect(sessionCommandExitCode(failure('transport_uncertain'))).toBe(5);
  });

  it('rejects malformed action input before ownership and emits one JSON document', async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rasen-session-command-')
    );
    temporaryPaths.push(directory);
    const actionPath = path.join(directory, 'action.json');
    fs.writeFileSync(actionPath, '{"schema":');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const previousTelemetry = process.env.RASEN_TELEMETRY;
    process.env.RASEN_TELEMETRY = '0';
    try {
      const program = createProgram({ locale: 'en' });
      await program.parseAsync([
        'node',
        'rasen',
        'session',
        'exec',
        '--run',
        RUN_ID,
        '--session',
        'reviewer',
        '--action',
        actionPath,
        '--cwd',
        directory,
        '--json',
      ]);
      expect(process.exitCode).toBe(2);
      expect(log).toHaveBeenCalledOnce();
      const document = JSON.parse(String(log.mock.calls[0][0])) as Record<
        string,
        unknown
      >;
      expect(document).toMatchObject({
        schema: 'rasen-session-command/1',
        command: 'exec',
        ok: false,
        outcome: { code: 'invalid_action' },
      });
      expect(JSON.stringify(document)).not.toContain('Bearer');
      expect(JSON.stringify(document)).not.toContain('messageId');
    } finally {
      log.mockRestore();
      if (previousTelemetry === undefined) {
        delete process.env.RASEN_TELEMETRY;
      } else {
        process.env.RASEN_TELEMETRY = previousTelemetry;
      }
    }
  });

  it('rejects an incomplete auto-touch policy before selecting an owner', async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rasen-session-policy-')
    );
    temporaryPaths.push(directory);
    const plan = bugFixPlan();
    const base = agentAction(plan, 'root/apply');
    const actionPath = path.join(directory, 'action.json');
    fs.writeFileSync(actionPath, JSON.stringify({
      ...base,
      agent: { ...base.agent, runtime: 'claude' },
    }));
    const selectOwner = vi.fn();
    const program = new Command().name('rasen');
    registerSessionCommand(program, 'en', { selectOwner });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await program.parseAsync([
        'session',
        'exec',
        '--run',
        plan.runId,
        '--session',
        'reviewer',
        '--action',
        actionPath,
        '--cwd',
        directory,
        '--touch',
        'auto',
        '--max-touches',
        '2',
        '--json',
      ], { from: 'user' });
      expect(process.exitCode).toBe(2);
      expect(selectOwner).not.toHaveBeenCalled();
      expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({
        outcome: { code: 'invalid_action' },
      });
    } finally {
      log.mockRestore();
    }
  });

  it('keeps missing required operands inside one JSON document and stable human output', async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rasen-session-missing-')
    );
    temporaryPaths.push(directory);
    const cases = [
      {
        command: 'exec',
        args: [
          'session',
          'exec',
          '--run',
          RUN_ID,
          '--session',
          'reviewer',
          '--cwd',
          directory,
        ],
      },
      {
        command: 'retire',
        args: ['session', 'retire', '--run', RUN_ID],
      },
    ] as const;
    const selectOwner = vi.fn();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (const value of cases) {
        process.exitCode = undefined;
        log.mockClear();
        error.mockClear();
        const jsonProgram = new Command().name('rasen');
        registerSessionCommand(jsonProgram, 'en', { selectOwner });
        await jsonProgram.parseAsync([...value.args, '--json'], {
          from: 'user',
        });
        expect(process.exitCode).toBe(2);
        expect(log).toHaveBeenCalledOnce();
        expect(error).not.toHaveBeenCalled();
        expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({
          schema: 'rasen-session-command/1',
          command: value.command,
          ok: false,
          outcome: { code: 'invalid_request' },
        });

        process.exitCode = undefined;
        log.mockClear();
        error.mockClear();
        const humanProgram = new Command().name('rasen');
        registerSessionCommand(humanProgram, 'en', { selectOwner });
        await humanProgram.parseAsync([...value.args], { from: 'user' });
        expect(process.exitCode).toBe(2);
        expect(log).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledOnce();
      }
      expect(selectOwner).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });

  it('bounds exact-limit and oversized file/stdin action sources while reading', async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rasen-session-action-limit-')
    );
    temporaryPaths.push(directory);
    const action = agentAction(bugFixPlan(), 'root/apply');
    const encoded = Buffer.from(JSON.stringify(action), 'utf-8');
    const limit = 1024 * 1024;
    const exact = Buffer.concat([
      encoded,
      Buffer.alloc(limit - encoded.byteLength, 0x20),
    ]);
    const oversized = Buffer.concat([exact, Buffer.from(' ')]);
    const exactPath = path.join(directory, 'exact.json');
    const oversizedPath = path.join(directory, 'oversized.json');
    fs.writeFileSync(exactPath, exact);
    fs.writeFileSync(oversizedPath, oversized);

    expect(await readSessionActionSource(exactPath)).toMatchObject({
      actionId: action.actionId,
    });
    expect(await readSessionActionSource(oversizedPath)).toEqual({
      error: `The action document exceeds ${limit} bytes.`,
    });
    expect(
      await readSessionActionSource('-', Readable.from([exact]))
    ).toMatchObject({ actionId: action.actionId });
    expect(
      await readSessionActionSource('-', Readable.from([oversized]))
    ).toEqual({
      error: `The action document exceeds ${limit} bytes.`,
    });
  });

  it('fails closed for ambiguous probes and a live recorded PID, but foregrounds proven absence', async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rasen-session-probe-')
    );
    temporaryPaths.push(root);
    const previousEnv = { ...process.env };
    const reserve = http.createServer();
    await new Promise<void>((resolve) =>
      reserve.listen(0, '127.0.0.1', () => resolve())
    );
    const address = reserve.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Expected a TCP listener.');
    }
    const port = address.port;
    await new Promise<void>((resolve) => reserve.close(() => resolve()));
    process.env.RASEN_HOME = root;
    process.env.RASEN_DAEMON_PORT = String(port);
    writeDaemonState({
      version: 'recorded',
      pid: process.pid,
      port,
      token: 'recorded-token',
      startedAt: Date.now(),
    });
    let hanging: http.Server | undefined;
    try {
      expect(await selectSessionOwner()).toMatchObject({
        ok: false,
        code: 'daemon_identity_ambiguous',
      });

      process.env.RASEN_HOME = path.join(root, 'without-state');
      const foreground = await selectSessionOwner();
      expect(foreground).toMatchObject({ ok: true, mode: 'foreground' });
      if (foreground.ok && foreground.mode === 'foreground') {
        expect(await foreground.service.ownerShutdown()).toEqual({ ok: true });
      }

      hanging = http.createServer();
      await new Promise<void>((resolve) =>
        hanging.listen(0, '127.0.0.1', () => resolve())
      );
      const hangingAddress = hanging.address();
      if (hangingAddress === null || typeof hangingAddress === 'string') {
        throw new Error('Expected a hanging TCP listener.');
      }
      process.env.RASEN_DAEMON_PORT = String(hangingAddress.port);
      expect(await selectSessionOwner()).toMatchObject({
        ok: false,
        code: 'daemon_identity_ambiguous',
      });
      await new Promise<void>((resolve) => hanging!.close(() => resolve()));
      hanging = undefined;
    } finally {
      if (hanging?.listening) {
        await new Promise<void>((resolve) => hanging!.close(() => resolve()));
      }
      process.env = previousEnv;
    }
  });

  it('keeps locale catalogue shapes exact for session messages', () => {
    const keys = (locale: CliLocale) =>
      Object.keys(getLocaleCatalog(locale).session).sort();
    expect(keys('ja')).toEqual(keys('en'));
    expect(keys('zh-cn')).toEqual(keys('en'));
    expect(
      Object.keys(getLocaleCatalog('ja').session.outcomes).sort()
    ).toEqual(
      Object.keys(getLocaleCatalog('en').session.outcomes).sort()
    );
    expect(
      Object.keys(getLocaleCatalog('zh-cn').session.outcomes).sort()
    ).toEqual(
      Object.keys(getLocaleCatalog('en').session.outcomes).sort()
    );
  });
});
