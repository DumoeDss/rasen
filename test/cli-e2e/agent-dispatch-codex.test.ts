import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { bindCodexThreadCwd } from '../../src/core/codex/index.js';
import { cliProjectRoot, ensureCliBuilt, runCLI } from '../helpers/run-cli.js';
import { cleanupTempPathAsync } from '../helpers/temp-cleanup.js';

const fixtureBinary = path.join(
  cliProjectRoot,
  'test',
  'fixtures',
  'codex',
  process.platform === 'win32' ? 'fake-codex.cmd' : 'fake-codex.mjs'
);

let cwd: string;
let threadId: string;

beforeAll(() => {
  if (process.platform !== 'win32') fs.chmodSync(fixtureBinary, 0o755);
});

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen codex 中文 '));
  threadId = `thread-${randomUUID()}`;
});

afterEach(async () => cleanupTempPathAsync(cwd));

function prompt(mode: string, extra = ''): string {
  const file = path.join(cwd, `prompt ${mode}.txt`);
  fs.writeFileSync(file, `MODE=${mode}\nTHREAD_ID=${threadId}\n${extra}`, 'utf8');
  return file;
}

async function dispatch(
  mode: string,
  extraArgs: string[] = [],
  contract = 'leaf',
  promptExtra = '第一行\n第二行 "quoted" & | > < ^ % !'
) {
  return runCLI(
    [
      'agent', 'dispatch',
      '--runtime', 'codex',
      '--prompt-file', prompt(mode, promptExtra),
      '--contract', contract,
      '--sandbox', 'read-only',
      '--cwd', cwd,
      '--timeout-ms', '5000',
      '--json',
      ...extraArgs,
    ],
    { env: { RASEN_CODEX_BIN: fixtureBinary }, timeoutMs: 20_000 }
  );
}

async function waitForFile(file: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!fs.existsSync(file)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function receipt(stdout: string): Record<string, any> {
  expect(stdout.trim().split(/\r?\n/)).toHaveLength(1);
  return JSON.parse(stdout.trim());
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (pidIsAlive(pid)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for fixture process ${pid}.`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function waitForClose(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', () => resolve());
  });
}

describe('rasen agent dispatch --runtime codex', () => {
  it('dispatches generic model/effort values through stdin with EOF and resumes the exact thread', async () => {
    const fresh = await dispatch('success', ['--model', 'gpt-5.6-luna', '--effort', 'max']);
    expect(fresh.exitCode).toBe(0);
    expect(fresh.stderr).toBe('');
    const freshReceipt = receipt(fresh.stdout);
    expect(freshReceipt).toMatchObject({
      ok: true,
      runtime: 'codex',
      dispatchMode: 'exec-bridge',
      bridge: 'codex-exec',
      threadId,
      model: 'gpt-5.6-luna',
      effort: 'max',
      cwd: fs.realpathSync.native(cwd),
    });
    const summary = JSON.parse(freshReceipt.result.summary);
    expect(summary.eof).toBe(true);
    expect(summary.prompt).toContain('第一行\n第二行 "quoted" & | > < ^ % !');
    expect(summary.prompt).toContain('You are a leaf worker.');
    expect(summary.args.join(' ')).not.toContain('第一行');

    const resumed = await dispatch('success', [
      '--resume', threadId,
      '--sandbox', 'workspace-write',
      '--model', 'gpt-5.6-terra',
      '--effort', 'high',
    ]);
    expect(resumed.exitCode).toBe(0);
    expect(receipt(resumed.stdout)).toMatchObject({
      ok: true,
      threadId,
      sandbox: 'read-only',
      model: 'gpt-5.6-terra',
      effort: 'high',
    });
    const resumeSummary = JSON.parse(receipt(resumed.stdout).result.summary);
    expect(resumeSummary.args.slice(0, 3)).toEqual(['exec', 'resume', threadId]);
    expect(resumeSummary.args).not.toContain('-s');
  });

  it('omits unknown sandbox metadata when resuming a legacy cwd-only thread record', async () => {
    const stateHome = path.join(cwd, 'legacy-rasen-home');
    const env = { ...process.env, RASEN_HOME: stateHome };
    await bindCodexThreadCwd(threadId, cwd, { env });

    const result = await runCLI([
      'agent', 'dispatch', '--runtime', 'codex',
      '--prompt-file', prompt('success'),
      '--contract', 'leaf', '--sandbox', 'workspace-write', '--cwd', cwd,
      '--timeout-ms', '5000', '--resume', threadId, '--json',
    ], {
      env: { RASEN_HOME: stateHome, RASEN_CODEX_BIN: fixtureBinary },
      timeoutMs: 20_000,
    });

    const parsed = receipt(result.stdout);
    expect(parsed).toMatchObject({ ok: true, threadId });
    expect(parsed).not.toHaveProperty('sandbox');
    expect(parsed.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/sandbox.*ignored/i)])
    );
  });

  it('accepts an opaque non-empty model id without a built-in allow-list', async () => {
    const result = await dispatch('success', ['--model', 'vendor/custom-codex-42']);
    expect(result.exitCode).toBe(0);
    expect(receipt(result.stdout)).toMatchObject({
      ok: true,
      model: 'vendor/custom-codex-42',
    });
  });

  it('returns a typed evaluate result', async () => {
    const result = await dispatch('evaluate', [], 'evaluate');
    expect(result.exitCode).toBe(0);
    expect(receipt(result.stdout)).toMatchObject({
      ok: true,
      result: { satisfied: false, gaps: ['fixture gap'] },
    });
  });

  it.each([
    ['missing-thread', 'thread-id-missing'],
    ['missing-last', 'last-message-missing'],
    ['malformed-last', 'last-message-invalid'],
    ['oversized-last', 'output-limit'],
    ['invalid-contract', 'contract-invalid'],
    ['nonzero', 'nonzero-exit'],
    ['overflow', 'output-limit'],
  ])('fails closed for %s', async (mode, kind) => {
    const result = await dispatch(mode);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    const parsed = receipt(result.stdout);
    expect(parsed).toMatchObject({ ok: false, failure: { kind } });
    if (mode === 'nonzero') {
      expect(JSON.stringify(parsed.diagnostics)).toContain('<redacted>');
      expect(JSON.stringify(parsed.diagnostics)).not.toContain('secret-value');
    }
  });

  it('rejects a conflicting thread id on exact resume', async () => {
    const result = await dispatch('thread-mismatch', ['--resume', threadId]);
    expect(result.exitCode).toBe(1);
    expect(receipt(result.stdout)).toMatchObject({
      ok: false,
      threadId,
      failure: { kind: 'thread-id-mismatch' },
    });
  });

  it('enforces one cross-process writer per exact thread', async () => {
    const marker = path.join(cwd, 'writer.marker');
    const release = path.join(cwd, 'release.marker');
    const first = dispatch(
      'hold',
      ['--resume', threadId],
      'leaf',
      `MARKER_FILE=${marker}\nRELEASE_FILE=${release}`
    );
    await waitForFile(marker);
    let duplicate;
    try {
      duplicate = await dispatch('success', ['--resume', threadId]);
    } finally {
      fs.writeFileSync(release, 'release\n', 'utf8');
    }
    expect(receipt(duplicate.stdout)).toMatchObject({
      ok: false,
      threadId,
      failure: { kind: 'thread-busy' },
    });
    expect(receipt((await first).stdout)).toMatchObject({ ok: true, threadId });
  });

  it('keeps the exact thread busy when only the bridge parent dies and its worker survives', async () => {
    await ensureCliBuilt();
    const marker = path.join(cwd, 'orphan-worker.marker');
    const release = path.join(cwd, 'orphan-release.marker');
    const duplicateMarker = path.join(cwd, 'orphan-duplicate.marker');
    const stateHome = path.join(cwd, 'isolated-rasen-home');
    const cliEntry = path.join(cliProjectRoot, 'dist', 'cli', 'index.js');
    const promptFile = prompt('hold', `MARKER_FILE=${marker}\nRELEASE_FILE=${release}`);
    const first = spawn(process.execPath, [
      cliEntry,
      'agent', 'dispatch', '--runtime', 'codex', '--prompt-file', promptFile,
      '--contract', 'leaf', '--sandbox', 'read-only', '--cwd', cwd,
      '--timeout-ms', '20000', '--resume', threadId, '--json',
    ], {
      cwd: cliProjectRoot,
      env: {
        ...process.env,
        RASEN_HOME: stateHome,
        RASEN_CODEX_BIN: fixtureBinary,
        RASEN_LANG: 'en',
        RASEN_TELEMETRY: '0',
        OPEN_SPEC_INTERACTIVE: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    first.stdout?.resume();
    first.stderr?.resume();
    const firstClosed = waitForClose(first);

    let workerPid: number | undefined;
    try {
      await waitForFile(marker);
      workerPid = (JSON.parse(fs.readFileSync(marker, 'utf8')) as { pid: number }).pid;
      expect(pidIsAlive(workerPid)).toBe(true);
      expect(first.kill('SIGKILL')).toBe(true);
      await firstClosed;
      expect(pidIsAlive(workerPid)).toBe(true);

      const duplicate = await runCLI([
        'agent', 'dispatch', '--runtime', 'codex',
        '--prompt-file', prompt('success', `MARKER_FILE=${duplicateMarker}`),
        '--contract', 'leaf', '--sandbox', 'read-only', '--cwd', cwd,
        '--timeout-ms', '5000', '--resume', threadId, '--json',
      ], {
        env: { RASEN_HOME: stateHome, RASEN_CODEX_BIN: fixtureBinary },
        timeoutMs: 20_000,
      });
      expect(receipt(duplicate.stdout)).toMatchObject({
        ok: false,
        threadId,
        failure: { kind: 'thread-busy' },
      });
      expect(fs.existsSync(duplicateMarker)).toBe(false);
    } finally {
      fs.writeFileSync(release, 'release\n', 'utf8');
      if (workerPid !== undefined) await waitForPidExit(workerPid);
    }
  });

  it('rejects exact-thread resume from a different canonical cwd before spawn', async () => {
    expect((await dispatch('success')).exitCode).toBe(0);
    const otherCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-codex-other-'));
    const marker = path.join(cwd, 'wrong-cwd-spawn.marker');
    try {
      const result = await runCLI([
        'agent', 'dispatch', '--runtime', 'codex',
        '--prompt-file', prompt('success', `MARKER_FILE=${marker}`),
        '--contract', 'leaf', '--sandbox', 'read-only', '--cwd', otherCwd,
        '--timeout-ms', '5000', '--resume', threadId, '--json',
      ], { env: { RASEN_CODEX_BIN: fixtureBinary }, timeoutMs: 20_000 });
      expect(receipt(result.stdout)).toMatchObject({
        ok: false,
        threadId,
        cwd: fs.realpathSync.native(otherCwd),
        failure: { kind: 'resume-cwd-mismatch' },
      });
      expect(fs.existsSync(marker)).toBe(false);
    } finally {
      fs.rmSync(otherCwd, { recursive: true, force: true });
    }
  });

  it('returns one spawn-failed receipt when the Codex runtime is unavailable', async () => {
    const missingBinary = path.join(cwd, 'missing-codex-runtime.exe');
    const result = await runCLI([
      'agent', 'dispatch', '--runtime', 'codex', '--prompt-file', prompt('success'),
      '--contract', 'leaf', '--sandbox', 'read-only', '--cwd', cwd,
      '--timeout-ms', '5000', '--json',
    ], { env: { RASEN_CODEX_BIN: missingBinary }, timeoutMs: 20_000 });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(receipt(result.stdout)).toMatchObject({
      ok: false,
      failure: { kind: 'spawn-failed' },
    });
  });

  it('returns runtime-unavailable when Codex is absent from configuration and PATH', async () => {
    const result = await runCLI([
      'agent', 'dispatch', '--runtime', 'codex', '--prompt-file', prompt('success'),
      '--contract', 'leaf', '--sandbox', 'read-only', '--cwd', cwd,
      '--timeout-ms', '5000', '--json',
    ], {
      env: { PATH: '', RASEN_CODEX_BIN: '' },
      timeoutMs: 20_000,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(receipt(result.stdout)).toMatchObject({
      ok: false,
      failure: { kind: 'runtime-unavailable' },
    });
  });

  it('bounds timeout and rejects ultra before launch', async () => {
    const timedOut = await runCLI(
      [
        'agent', 'dispatch', '--runtime', 'codex', '--prompt-file', prompt('timeout'),
        '--contract', 'leaf', '--sandbox', 'read-only', '--cwd', cwd,
        '--timeout-ms', '100', '--json',
      ],
      { env: { RASEN_CODEX_BIN: fixtureBinary }, timeoutMs: 20_000 }
    );
    expect(receipt(timedOut.stdout)).toMatchObject({ ok: false, failure: { kind: 'timeout' } });

    const invalid = await dispatch('success', ['--effort', 'ultra']);
    expect(receipt(invalid.stdout)).toMatchObject({ ok: false, failure: { kind: 'invalid-input' } });
  });
});
