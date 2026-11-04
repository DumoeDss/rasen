import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn as spawnProcess, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  CLAUDE_SESSION_STREAM_ARGS,
  createClaudeSessionBackend as createProductClaudeSessionBackend,
} from '../../../src/core/session-host/claude-backend.js';
import type { BackendOpenInput } from '../../../src/core/session-host/backend.js';
import { reduceBackendTurnEvents } from '../../../src/core/session-host/protocol.js';
import { asProcessRef, type ProcessScope } from '../../../src/core/session-host/process-scope.js';

type TestBackendOptions = Parameters<typeof createProductClaudeSessionBackend>[0] & {
  spawn?: typeof spawnProcess;
  terminateTree?: (pid: number, graceMs: number) => Promise<void>;
};

function childProcessScope(options: TestBackendOptions): ProcessScope {
  const spawn = options.spawn ?? spawnProcess;
  const terminateTree = options.terminateTree ?? (async (pid: number) => {
    try { process.kill(pid, 'SIGKILL'); } catch { /* exact test-owned child */ }
  });
  const children = new Map<string, ChildProcess>();
  return {
    async prepare(input) {
      const child = spawn(input.command, [...input.args], {
        cwd: input.cwd,
        env: {
          ...input.env,
          ...(options.env?.RASEN_SESSION_FIXTURE_SCRIPT
            ? { RASEN_SESSION_FIXTURE_SCRIPT: options.env.RASEN_SESSION_FIXTURE_SCRIPT }
            : {}),
          ...(options.env?.RASEN_SESSION_FIXTURE_OUTPUT
            ? { RASEN_SESSION_FIXTURE_OUTPUT: options.env.RASEN_SESSION_FIXTURE_OUTPUT }
            : {}),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
        ...(input.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
      });
      const ref = asProcessRef(
        `rasen-process-scope/1:${Buffer.from(crypto.randomUUID()).toString('base64url')}`
      );
      if (!child.stdin || !child.stdout || !child.stderr) {
        if (typeof child.pid === 'number') await terminateTree(child.pid, 5_000);
        throw new Error('test ProcessScope child pipes unavailable');
      }
      children.set(String(ref), child);
      const rootExited = new Promise<{
        state: 'root-exited'; code: number | null; signal: string | null;
      }>((resolve) => {
        child.once('error', () => resolve({ state: 'root-exited', code: 1, signal: null }));
        child.once('close', (code, signal) => resolve({ state: 'root-exited', code, signal }));
      });
      const closed = rootExited.then(() => ({ state: 'scope-empty' as const }));
      void rootExited.then(() => {
        children.delete(String(ref));
      });
      return {
        ref,
        ...(typeof child.pid === 'number' ? { displayPid: child.pid } : {}),
        async activate() {
          return {
            ref,
            displayPid: child.pid,
            stdin: child.stdin!,
            stdout: child.stdout!,
            stderr: child.stderr!,
            rootExited,
            closed,
          };
        },
        async abort() {
          if (typeof child.pid === 'number') await terminateTree(child.pid, 5_000);
          return { state: 'closed' as const, gracefulAttempted: false, forced: true };
        },
      };
    },
    async inspect(ref) {
      return children.has(String(ref))
        ? { state: 'live' as const, controllable: true as const }
        : { state: 'foreign' as const, controllable: false as const };
    },
    async terminate(ref, intent) {
      const child = children.get(String(ref));
      if (child?.pid) await terminateTree(child.pid, intent.graceMs);
      children.delete(String(ref));
      return { state: 'closed' as const, gracefulAttempted: true, forced: true };
    },
  };
}

function createClaudeSessionBackend(options: TestBackendOptions = {}) {
  const { spawn: _spawn, terminateTree: _terminateTree, ...productOptions } = options;
  const backend = createProductClaudeSessionBackend({
    ...productOptions,
    processScope: options.processScope ?? childProcessScope(options),
  });
  return Object.assign(backend, {
    async open(input: BackendOpenInput) {
      const prepared = await backend.prepare(input);
      return prepared.activate();
    },
  });
}

function fakeChild() {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, {
    pid: 4242,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  return child as ChildProcess & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
  };
}

const limits = {
  timeoutMs: 2000,
  maxInputBytes: 4096,
  maxOutputBytes: 4096,
  maxLineBytes: 1024,
  maxDiagnosticBytes: 128,
};

function openInput(
  overrides: {
    cwd?: string;
    limits?: typeof limits;
    resumeSessionId?: string;
    sandbox?: 'read-only' | 'workspace-write';
  } = {}
): BackendOpenInput {
  return {
    cwd: overrides.cwd ?? process.cwd(),
    limits: overrides.limits ?? limits,
    sandbox: overrides.sandbox ?? 'workspace-write',
    ...(overrides.resumeSessionId ? { resumeSessionId: overrides.resumeSessionId } : {}),
    signal: new AbortController().signal,
  };
}

describe('Claude resident Session backend', () => {
  it('returns typed spawn failures and reaps a child missing required pipes', async () => {
    const thrown = createClaudeSessionBackend({
      resolveBinary: async () => '/opt/claude',
      verifyProtocol: async () => ({ ok: true, version: '2.1.220' }),
      spawn: () => {
        throw new Error('spawn denied');
      },
    });
    await expect(thrown.open(openInput())).rejects.toMatchObject({
      code: 'backend-spawn-failed',
    });

    const broken = fakeChild();
    Object.assign(broken, { stdout: null });
    const terminateTree = vi.fn(async () => undefined);
    const missingPipe = createClaudeSessionBackend({
      resolveBinary: async () => '/opt/claude',
      verifyProtocol: async () => ({ ok: true, version: '2.1.220' }),
      spawn: () => broken,
      terminateTree,
    });
    await expect(missingPipe.open(openInput())).rejects.toMatchObject({
      code: 'backend-spawn-failed',
    });
    expect(terminateTree).toHaveBeenCalledWith(4242, 5000);

    for (const pipe of ['stdin', 'stderr'] as const) {
      const anotherBroken = fakeChild();
      Object.assign(anotherBroken, { [pipe]: null });
      const reap = vi.fn(async () => undefined);
      const backend = createClaudeSessionBackend({
        resolveBinary: async () => '/opt/claude',
        verifyProtocol: async () => ({ ok: true, version: '2.1.220' }),
        spawn: () => anotherBroken,
        terminateTree: reap,
      });
      await expect(backend.open(openInput())).rejects.toMatchObject({
        code: 'backend-spawn-failed',
      });
      expect(reap).toHaveBeenCalledWith(4242, 5000);
    }
  });

  it('turns a child error/early close into one typed active-turn failure', async () => {
    for (const close of ['error', 'nonzero'] as const) {
      const child = fakeChild();
      const backend = createClaudeSessionBackend({
        resolveBinary: async () => '/opt/claude',
        verifyProtocol: async () => ({ ok: true, version: '2.1.220' }),
        spawn: () => child,
        terminateTree: async () => undefined,
      });
      const transport = await backend.open(openInput());
      const pending = (async () => {
        const values = [];
        for await (const event of transport.send({
          requestId: crypto.randomUUID(),
          input: close,
          limits,
        })) values.push(event);
        return values;
      })();
      if (close === 'error') child.emit('error', new Error('injected child error'));
      else child.emit('close', 19, null);
      await expect(pending).rejects.toBeInstanceOf(Error);
      await expect(transport.closed).resolves.toBeUndefined();
    }
  });

  it('spawns direct stream-json argv with canonical cwd and no prompt in argv or env', async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const executable = path.resolve('test-fixtures', 'claude');
    const backend = createClaudeSessionBackend({
      resolveBinary: async () => executable,
      verifyProtocol: async () => ({ ok: true, version: '2.1.220' }),
      spawn,
      env: { PATH: 'safe' },
      terminateTree: async () => undefined,
    });
    const transport = await backend.open(openInput());
    const input = '多行\n" & | % ^ () --resume';
    const events = (async () => {
      const values = [];
      for await (const event of transport.send({ requestId: crypto.randomUUID(), input, limits })) {
        values.push(event);
      }
      return values;
    })();
    await new Promise((resolve) => setTimeout(resolve, 0));
    child.stdout.write('{"type":"system","subtype":"init","session_id":"claude-1"}\n');
    child.stdout.write('{"type":"result","session_id":"claude-1","result":"ok"}\n');
    expect(await events).toEqual([
      { type: 'init', sessionId: 'claude-1' },
      { type: 'result', sessionId: 'claude-1', content: 'ok' },
    ]);

    expect(spawn).toHaveBeenCalledWith(
      executable,
      [...CLAUDE_SESSION_STREAM_ARGS, '--permission-mode', 'acceptEdits'],
      expect.objectContaining({
        cwd: expect.any(String),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      })
    );
    expect(JSON.stringify(spawn.mock.calls)).not.toContain(input);
    const sent = child.stdin.read()?.toString('utf8') ?? '';
    expect(JSON.parse(sent).message.content[0].text).toBe(input);
  });

  it('uses exact resume identity and reuses one transport for later turns', async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const backend = createClaudeSessionBackend({
      resolveBinary: async () => '/opt/claude',
      verifyProtocol: async () => ({ ok: true, version: '2.1.220' }),
      spawn,
      terminateTree: async () => undefined,
    });
    const transport = await backend.open(openInput({ resumeSessionId: 'claude-exact' }));
    expect(spawn.mock.calls[0][1]).toEqual([
      ...CLAUDE_SESSION_STREAM_ARGS,
      '--permission-mode',
      'acceptEdits',
      '--resume',
      'claude-exact',
    ]);

    const first = (async () => {
      const values = [];
      for await (const event of transport.send({ requestId: crypto.randomUUID(), input: 'one', limits })) values.push(event);
      return values;
    })();
    child.stdout.write('{"type":"system","subtype":"init","session_id":"claude-exact"}\n');
    child.stdout.write('{"type":"result","session_id":"claude-exact","result":"one"}\n');
    await expect(first).resolves.toHaveLength(2);

    const second = (async () => {
      const values = [];
      for await (const event of transport.send({ requestId: crypto.randomUUID(), input: 'two', limits })) values.push(event);
      return values;
    })();
    child.stdout.write('{"type":"result","session_id":"claude-exact","result":"two"}\n');
    await expect(second).resolves.toEqual([
      { type: 'init', sessionId: 'claude-exact' },
      { type: 'result', sessionId: 'claude-exact', content: 'two' },
    ]);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('maps a read-only hosted Session to Claude plan permission before spawn', async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const backend = createClaudeSessionBackend({
      resolveBinary: async () => '/opt/claude',
      verifyProtocol: async () => ({ ok: true, version: '2.1.220' }),
      spawn,
      terminateTree: async () => undefined,
    });
    await backend.open(openInput({ sandbox: 'read-only' }));
    expect(spawn.mock.calls[0][1]).toEqual([
      ...CLAUDE_SESSION_STREAM_ARGS,
      '--permission-mode',
      'plan',
    ]);
  });

  it('runs a real read-only Teacher mutation attempt and leaves the workspace bytes unchanged', async () => {
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rasen-teacher-read-only-')
    );
    const factsRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rasen-teacher-read-only-facts-')
    );
    const target = path.join(workspace, 'protected.txt');
    fs.writeFileSync(target, 'canonical-before', 'utf8');
    fs.writeFileSync(
      path.join(workspace, '.rasen-session-fixture.json'),
      JSON.stringify({
        script: 'attempt-workspace-mutation',
        outputRoot: factsRoot,
        mutationTarget: 'protected.txt',
      }),
      'utf8'
    );
    const fixture = path.resolve(
      'test/fixtures/session-host',
      process.platform === 'win32' ? 'replay-claude.cmd' : 'replay-claude.sh'
    );
    if (process.platform !== 'win32') fs.chmodSync(fixture, 0o700);
    const backend = createClaudeSessionBackend({
      resolveBinary: async () => fixture,
      killGraceMs: 100,
    });
    const transport = await backend.open(
      openInput({ cwd: workspace, sandbox: 'read-only' })
    );
    const events = [];
    for await (const event of transport.send({
      requestId: crypto.randomUUID(),
      input: 'Attempt to modify protected.txt, then advise.',
      limits,
    })) {
      events.push(event);
    }
    await transport.terminate('mutation-attempt-complete');

    expect(events).toContainEqual({
      type: 'result',
      sessionId: 'fixture-backend-session-1',
      content: 'mutation-blocked',
    });
    expect(fs.readFileSync(target, 'utf8')).toBe('canonical-before');
    const facts = fs
      .readFileSync(path.join(factsRoot, 'facts.ndjson'), 'utf8')
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(facts).toContainEqual(
      expect.objectContaining({
        type: 'mutation-attempt',
        permissionMode: 'plan',
        blocked: true,
      })
    );
  });

  it('forwards a duplicate same-identity init so the production path rejects it', async () => {
    const child = fakeChild();
    const backend = createClaudeSessionBackend({
      resolveBinary: async () => '/opt/claude',
      verifyProtocol: async () => ({ ok: true, version: '2.1.220' }),
      spawn: () => child,
      terminateTree: async () => undefined,
    });
    const transport = await backend.open(openInput());
    const collect = async (input: string) => {
      const values = [];
      for await (const event of transport.send({ requestId: crypto.randomUUID(), input, limits })) {
        values.push(event);
      }
      return values;
    };
    const first = collect('first');
    child.stdout.write('{"type":"system","subtype":"init","session_id":"duplicate-init"}\n');
    child.stdout.write('{"type":"result","session_id":"duplicate-init","result":"first"}\n');
    await first;

    const second = collect('second');
    child.stdout.write('{"type":"system","subtype":"init","session_id":"duplicate-init"}\n');
    child.stdout.write('{"type":"result","session_id":"duplicate-init","result":"second"}\n');
    const events = await second;
    expect(() => reduceBackendTurnEvents(events, {
      expectedBackendSessionId: 'duplicate-init',
      maxDiagnosticBytes: 128,
    })).toThrow(expect.objectContaining({ code: 'protocol-duplicate-init' }));
  });

  it('poisons the resident transport on a duplicate terminal result', async () => {
    const child = fakeChild();
    const backend = createClaudeSessionBackend({
      resolveBinary: async () => '/opt/claude',
      verifyProtocol: async () => ({ ok: true, version: '2.1.220' }),
      spawn: () => child,
      terminateTree: async () => undefined,
    });
    const transport = await backend.open(openInput());
    const pending = (async () => {
      const values = [];
      for await (const event of transport.send({
        requestId: crypto.randomUUID(),
        input: 'one',
        limits,
      })) values.push(event);
      return values;
    })();
    child.stdout.write([
      '{"type":"system","subtype":"init","session_id":"claude-exact"}',
      '{"type":"result","session_id":"claude-exact","result":"one"}',
      '{"type":"result","session_id":"claude-exact","result":"duplicate"}',
      '',
    ].join('\n'));
    await expect(pending).rejects.toMatchObject({ code: 'backend-protocol-failed' });
    expect(() => transport.send({
      requestId: crypto.randomUUID(),
      input: 'two',
      limits,
    })).toThrow(expect.objectContaining({ code: 'backend-protocol-failed' }));
  });

  it('resets raw stdout byte accounting for every resident turn', async () => {
    const child = fakeChild();
    const backend = createClaudeSessionBackend({
      resolveBinary: async () => '/opt/claude',
      verifyProtocol: async () => ({ ok: true, version: '2.1.220' }),
      spawn: () => child,
      terminateTree: async () => undefined,
    });
    const perTurnLimits = {
      ...limits,
      maxOutputBytes: 140,
      maxLineBytes: 100,
    };
    const transport = await backend.open(openInput({ limits: perTurnLimits }));
    const collect = async (input: string) => {
      const values = [];
      for await (const event of transport.send({
        requestId: crypto.randomUUID(),
        input,
        limits: perTurnLimits,
      })) values.push(event);
      return values;
    };

    const first = collect('one');
    child.stdout.write('{"type":"system","subtype":"init","session_id":"budget"}\n');
    child.stdout.write('{"type":"result","session_id":"budget","result":"one"}\n');
    await expect(first).resolves.toHaveLength(2);

    const second = collect('two');
    child.stdout.write('{"type":"result","session_id":"budget","result":"two"}\n');
    await expect(second).resolves.toEqual([
      { type: 'init', sessionId: 'budget' },
      { type: 'result', sessionId: 'budget', content: 'two' },
    ]);
  });

  it('decodes fragmented UTF-8 and rejects unsupported installed protocol before spawn', async () => {
    const noSpawn = vi.fn();
    const unsupported = createClaudeSessionBackend({
      resolveBinary: async () => '/opt/claude',
      verifyProtocol: async () => ({ ok: false, version: 'old', missing: ['--input-format'] }),
      spawn: noSpawn,
    });
    await expect(unsupported.open(openInput())).rejects.toMatchObject({
      code: 'backend-protocol-unsupported',
    });
    expect(noSpawn).not.toHaveBeenCalled();

    const child = fakeChild();
    const backend = createClaudeSessionBackend({
      resolveBinary: async () => '/opt/claude',
      verifyProtocol: async () => ({ ok: true, version: '2.1.220' }),
      spawn: () => child,
      terminateTree: async () => undefined,
    });
    const transport = await backend.open(openInput());
    const pending = (async () => {
      const values = [];
      for await (const event of transport.send({ requestId: crypto.randomUUID(), input: '你好', limits })) values.push(event);
      return values;
    })();
    const bytes = Buffer.from(
      '{"type":"system","subtype":"init","session_id":"cjk"}\n{"type":"result","session_id":"cjk","result":"你好"}\n',
      'utf8'
    );
    for (const byte of bytes) child.stdout.write(Buffer.from([byte]));
    await expect(pending).resolves.toEqual([
      { type: 'init', sessionId: 'cjk' },
      { type: 'result', sessionId: 'cjk', content: '你好' },
    ]);
  });

  it('runs the production spawn/protocol path against a real no-network resident process', async () => {
    const fixture = path.resolve(
      'test/fixtures/session-host',
      process.platform === 'win32' ? 'replay-claude.cmd' : 'replay-claude.sh'
    );
    if (process.platform !== 'win32') fs.chmodSync(fixture, 0o700);
    const backend = createClaudeSessionBackend({
      resolveBinary: async () => fixture,
      killGraceMs: 100,
    });
    const transport = await backend.open(openInput());

    const collect = async (input: string) => {
      const values = [];
      for await (const event of transport.send({ requestId: crypto.randomUUID(), input, limits })) {
        values.push(event);
      }
      return values;
    };
    await expect(collect('你好 & | ^')).resolves.toEqual([
      { type: 'init', sessionId: 'fixture-backend-session-1' },
      {
        type: 'result',
        sessionId: 'fixture-backend-session-1',
        content: 'fixture-result:1:你好 & | ^',
      },
    ]);
    await expect(collect('second')).resolves.toEqual([
      { type: 'init', sessionId: 'fixture-backend-session-1' },
      {
        type: 'result',
        sessionId: 'fixture-backend-session-1',
        content: 'fixture-result:2:second',
      },
    ]);
    await transport.terminate('test-complete');
  });

  it('keeps shell metacharacters, option prefixes, Unicode, and newlines in stdin across real wrappers', async () => {
    const wrappers = process.platform === 'win32'
      ? ['replay-claude.cmd', 'replay-claude.bat']
      : ['replay-claude.sh'];
    const payloads = [
      '"double" & ampersand | pipe %percent% ^caret (paren)',
      '--resume=attacker --output-format=text',
      '多行 Unicode 空 格\nsecond line\r\nthird line',
      "'single' ; $HOME `substitution` $(never-run)",
    ];
    for (const wrapper of wrappers) {
      const fixture = path.resolve('test/fixtures/session-host', wrapper);
      if (process.platform !== 'win32') fs.chmodSync(fixture, 0o700);
      const backend = createClaudeSessionBackend({
        resolveBinary: async () => fixture,
        killGraceMs: 100,
      });
      const transport = await backend.open(openInput());
      try {
        for (let index = 0; index < payloads.length; index += 1) {
          const values = [];
          for await (const event of transport.send({
            requestId: crypto.randomUUID(),
            input: payloads[index],
            limits,
          })) values.push(event);
          expect(values).toEqual([
            { type: 'init', sessionId: 'fixture-backend-session-1' },
            {
              type: 'result',
              sessionId: 'fixture-backend-session-1',
              content: `fixture-result:${index + 1}:${payloads[index]}`,
            },
          ]);
        }
      } finally {
        await transport.terminate(`wrapper-${wrapper}`);
      }
    }
  });

  it('classifies deterministic malformed, oversized, crash, delay, and identity-drift scripts', async () => {
    const fixture = path.resolve(
      'test/fixtures/session-host',
      process.platform === 'win32' ? 'replay-claude.cmd' : 'replay-claude.sh'
    );
    if (process.platform !== 'win32') fs.chmodSync(fixture, 0o700);
    const open = async (script: string) => createClaudeSessionBackend({
      resolveBinary: async () => fixture,
      env: {
        ...process.env,
        ...(process.env.ComSpec ? { ComSpec: process.env.ComSpec } : {}),
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        RASEN_SESSION_FIXTURE_SCRIPT: script,
      },
      killGraceMs: 50,
    }).open(openInput());
    const collect = async (script: string) => {
      const transport = await open(script);
      try {
        const events = [];
        for await (const event of transport.send({
          requestId: crypto.randomUUID(),
          input: 'fault-matrix-input',
          limits,
        })) events.push(event);
        return events;
      } finally {
        await transport.terminate('fault-matrix-complete');
      }
    };

    await expect(collect('malformed-event')).rejects.toMatchObject({
      code: 'protocol-malformed-json',
    });
    await expect(collect('oversized-event')).rejects.toMatchObject({
      code: 'protocol-output-limit',
    });
    await expect(collect('crash-after-init')).rejects.toMatchObject({
      code: 'backend-protocol-failed',
    });
    await expect(collect('crash-after-input-acceptance')).rejects.toMatchObject({
      code: 'backend-protocol-failed',
    });
    await expect(collect('crash-before-init')).rejects.toMatchObject({
      code: 'backend-protocol-failed',
    });
    await expect(collect('nonzero-exit')).rejects.toMatchObject({
      code: 'backend-protocol-failed',
    });
    await expect(collect('delayed-result')).resolves.toEqual([
      { type: 'init', sessionId: 'fixture-backend-session-1' },
      {
        type: 'result',
        sessionId: 'fixture-backend-session-1',
        content: 'fixture-result:1:fault-matrix-input',
      },
    ]);
    const mismatched = await collect('mismatched-session-id');
    expect(() => reduceBackendTurnEvents(mismatched, {
      maxDiagnosticBytes: 128,
    })).toThrow(expect.objectContaining({ code: 'protocol-session-mismatch' }));
  });

});
