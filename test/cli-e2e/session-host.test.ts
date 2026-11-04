import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runCLI } from '../helpers/run-cli.js';

const roots: string[] = [];
let cleanupEnv: NodeJS.ProcessEnv | undefined;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

afterEach(async () => {
  if (cleanupEnv) {
    await runCLI(['daemon', 'stop'], { env: cleanupEnv, timeoutMs: 30_000 }).catch(() => undefined);
    cleanupEnv = undefined;
  }
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('rasen session daemon bridge', () => {
  it('returns typed invalid-input for filesystem/backend/timeout errors without starting a daemon', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-session-cli-invalid-'));
    roots.push(root);
    const cwd = path.join(root, 'checkout');
    const data = path.join(root, 'data');
    fs.mkdirSync(cwd);
    const prompt = path.join(root, 'prompt.txt');
    fs.writeFileSync(prompt, 'valid prompt', 'utf8');
    const env = {
      RASEN_HOME: data,
      RASEN_DAEMON_PORT: String(await freePort()),
    };
    const cases = [
      ['--backend', 'claude', '--prompt-file', path.join(root, 'missing.txt'), '--cwd', cwd, '--timeout-ms', '1000'],
      ['--backend', 'claude', '--prompt-file', prompt, '--cwd', path.join(root, 'missing-cwd'), '--timeout-ms', '1000'],
      ['--backend', 'unknown', '--prompt-file', prompt, '--cwd', cwd, '--timeout-ms', '1000'],
      ['--backend', 'claude', '--prompt-file', prompt, '--cwd', cwd, '--timeout-ms', '0'],
    ];
    for (const args of cases) {
      const result = await runCLI(['session', 'exec', ...args, '--json'], { env, timeoutMs: 15_000 });
      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stdout.trim())).toMatchObject({ ok: false, code: 'invalid-input' });
      expect(fs.existsSync(path.join(data, 'daemon.json'))).toBe(false);
    }
  });

  it('creates and wakes one resident Session across CLI driver exits', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-session-cli-'));
    roots.push(root);
    const cwd = path.join(root, 'checkout');
    const data = path.join(root, 'data');
    const fixtureOutput = path.join(root, 'fixture-output');
    fs.mkdirSync(cwd);
    const prompt = path.join(root, 'prompt.txt');
    fs.writeFileSync(prompt, '第一轮\n& | ^ % --resume', 'utf8');
    fs.writeFileSync(
      path.join(cwd, '.rasen-session-fixture.json'),
      JSON.stringify({ outputRoot: fixtureOutput }),
      'utf8'
    );
    const fixture = path.resolve(
      'test/fixtures/session-host',
      process.platform === 'win32' ? 'replay-claude.cmd' : 'replay-claude.sh'
    );
    if (process.platform !== 'win32') fs.chmodSync(fixture, 0o700);
    const env = {
      RASEN_HOME: data,
      RASEN_DAEMON_PORT: String(await freePort()),
      RASEN_CLAUDE_BIN: fixture,
    };
    cleanupEnv = env;

    const first = await runCLI(
      [
        'session',
        'exec',
        '--backend',
        'claude',
        '--prompt-file',
        prompt,
        '--cwd',
        cwd,
        '--request-id',
        crypto.randomUUID(),
        '--timeout-ms',
        '10000',
        '--json',
      ],
      { env, timeoutMs: 30_000 }
    );
    const daemonLog = path.join(data, 'daemon', 'daemon.log');
    expect(
      first.exitCode,
      `${first.stderr}\n${fs.existsSync(daemonLog) ? fs.readFileSync(daemonLog, 'utf8') : ''}`
    ).toBe(0);
    const firstReceipt = JSON.parse(first.stdout.trim());
    expect(firstReceipt).toMatchObject({
      ok: true,
      result: 'fixture-result:1:第一轮\n& | ^ % --resume',
      session: { backendSessionId: 'fixture-backend-session-1', generation: 1 },
    });
    const sessionId = firstReceipt.session.sessionId as string;

    fs.writeFileSync(prompt, '第二轮', 'utf8');
    const second = await runCLI(
      [
        'session',
        'exec',
        '--backend',
        'claude',
        '--prompt-file',
        prompt,
        '--cwd',
        cwd,
        '--session',
        sessionId,
        '--request-id',
        crypto.randomUUID(),
        '--timeout-ms',
        '10000',
        '--json',
      ],
      { env, timeoutMs: 30_000 }
    );
    expect(second.exitCode, second.stderr).toBe(0);
    expect(JSON.parse(second.stdout.trim())).toMatchObject({
      ok: true,
      result: 'fixture-result:2:第二轮',
      session: { sessionId, generation: 1 },
    });

    const listed = await runCLI(['session', 'list', '--json'], { env, timeoutMs: 15_000 });
    expect(listed.exitCode, listed.stderr).toBe(0);
    expect(JSON.parse(listed.stdout.trim())).toMatchObject({
      sessions: [expect.objectContaining({ sessionId, hostState: 'idle' })],
    });

    const facts = fs.readFileSync(path.join(fixtureOutput, 'facts.ndjson'), 'utf8');
    expect(facts).not.toContain('第一轮');
    expect(facts.match(/"type":"spawn"/g)).toHaveLength(1);
    expect(facts.match(/"type":"turn"/g)).toHaveLength(2);

    const registryBytes = fs.readFileSync(
      path.join(data, 'session-host', 'registry.json'),
      'utf8'
    );
    expect(registryBytes).not.toContain('第一轮');
    expect(registryBytes).not.toContain('第二轮');

    const retired = await runCLI(['session', 'retire', sessionId, '--json'], {
      env,
      timeoutMs: 15_000,
    });
    expect(retired.exitCode, retired.stderr).toBe(0);
    expect(JSON.parse(retired.stdout.trim())).toMatchObject({
      ok: true,
      session: { sessionId, hostState: 'retired' },
    });
  }, 90_000);

  it('drives inspect, active cancel, exact restart, retire, and typed failures with one JSON receipt', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen session 空 格 cli-'));
    roots.push(root);
    const cwd = path.join(root, 'checkout with spaces 空');
    const data = path.join(root, 'data home 空');
    const fixtureOutput = path.join(root, 'fixture output');
    fs.mkdirSync(cwd);
    const prompt = path.join(root, 'prompt file 空.txt');
    fs.writeFileSync(prompt, '第一行\n" & | % ^ () --resume\n第三行', 'utf8');
    fs.writeFileSync(
      path.join(cwd, '.rasen-session-fixture.json'),
      JSON.stringify({
        outputRoot: fixtureOutput,
        script: 'delayed-result',
        delayMs: 60_000,
        delayMatch: 'active cancellation sentinel',
      }),
      'utf8'
    );
    const fixture = path.resolve(
      'test/fixtures/session-host',
      process.platform === 'win32' ? 'replay-claude.cmd' : 'replay-claude.sh'
    );
    if (process.platform !== 'win32') fs.chmodSync(fixture, 0o700);
    const env = {
      RASEN_HOME: data,
      RASEN_DAEMON_PORT: String(await freePort()),
      RASEN_CLAUDE_BIN: fixture,
    };
    cleanupEnv = env;
    const oneReceipt = (stdout: string) => {
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      expect(lines).toHaveLength(1);
      return JSON.parse(lines[0]);
    };

    const requestId = crypto.randomUUID();
    const created = await runCLI([
      'session', 'exec',
      '--backend', 'claude',
      '--prompt-file', prompt,
      '--cwd', cwd,
      '--request-id', requestId,
      '--timeout-ms', '10000',
      '--json',
    ], { env, timeoutMs: 30_000 });
    const daemonLog = path.join(data, 'daemon', 'daemon.log');
    expect(
      created.exitCode,
      `${created.stderr}\n${created.stdout}\n${fs.existsSync(daemonLog) ? fs.readFileSync(daemonLog, 'utf8') : ''}`
    ).toBe(0);
    const createdReceipt = oneReceipt(created.stdout);
    expect(createdReceipt).toMatchObject({
      ok: true,
      requestId,
      session: { hostState: 'idle', backendSessionId: 'fixture-backend-session-1' },
    });
    const sessionId = createdReceipt.session.sessionId as string;

    const inspected = await runCLI(['session', 'inspect', sessionId, '--json'], {
      env,
      timeoutMs: 15_000,
    });
    expect(inspected.exitCode, inspected.stderr).toBe(0);
    expect(oneReceipt(inspected.stdout)).toMatchObject({
      session: { sessionId, hostState: 'idle' },
    });

    fs.writeFileSync(prompt, 'active cancellation sentinel', 'utf8');
    const activeRequestId = crypto.randomUUID();
    const pendingWake = runCLI([
      'session', 'exec',
      '--backend', 'claude',
      '--prompt-file', prompt,
      '--cwd', cwd,
      '--session', sessionId,
      '--request-id', activeRequestId,
      '--timeout-ms', '30000',
      '--json',
    ], { env, timeoutMs: 45_000 });

    let active = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const probe = await runCLI(['session', 'inspect', sessionId, '--json'], {
        env,
        timeoutMs: 15_000,
      });
      if (probe.exitCode === 0 && oneReceipt(probe.stdout).session?.hostState === 'active') {
        active = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(active).toBe(true);

    const cancelled = await runCLI([
      'session', 'cancel', sessionId, '--reason', 'cli-e2e-cancel', '--json',
    ], { env, timeoutMs: 15_000 });
    expect(cancelled.exitCode, `${cancelled.stderr}\n${cancelled.stdout}`).toBe(0);
    expect(oneReceipt(cancelled.stdout)).toMatchObject({
      ok: true,
      session: { sessionId, hostState: 'interrupted', currentRequest: { state: 'ambiguous' } },
    });
    const wakeResult = await pendingWake;
    expect(wakeResult.exitCode).not.toBe(0);
    expect(oneReceipt(wakeResult.stdout), wakeResult.stdout).toMatchObject({
      ok: false,
      requestId: activeRequestId,
      code: 'turn-outcome-unknown',
    });

    const restarted = await runCLI(['session', 'restart', sessionId, '--json'], {
      env,
      timeoutMs: 15_000,
    });
    expect(restarted.exitCode, restarted.stderr).toBe(0);
    expect(oneReceipt(restarted.stdout)).toMatchObject({
      ok: true,
      session: { sessionId, hostState: 'idle', generation: 2 },
    });

    const retired = await runCLI([
      'session', 'retire', sessionId, '--reason', 'cli-e2e-retire', '--json',
    ], { env, timeoutMs: 15_000 });
    expect(retired.exitCode, retired.stderr).toBe(0);
    expect(oneReceipt(retired.stdout)).toMatchObject({
      ok: true,
      session: { sessionId, hostState: 'retired', retirementReason: 'cli-e2e-retire' },
    });

    const restartRetired = await runCLI(['session', 'restart', sessionId, '--json'], {
      env,
      timeoutMs: 15_000,
    });
    expect(restartRetired.exitCode).not.toBe(0);
    expect(oneReceipt(restartRetired.stdout)).toMatchObject({ ok: false, code: 'session-retired' });

    const invalid = await runCLI(['session', 'inspect', 'not-a-uuid', '--json'], {
      env,
      timeoutMs: 15_000,
    });
    expect(invalid.exitCode).not.toBe(0);
    expect(oneReceipt(invalid.stdout)).toMatchObject({ ok: false, code: 'invalid-input' });
  }, 90_000);
});
