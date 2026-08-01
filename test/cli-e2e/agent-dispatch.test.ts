import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { cliProjectRoot, ensureCliBuilt, runCLI } from '../helpers/run-cli.js';
import { cleanupTempPathAsync } from '../helpers/temp-cleanup.js';

const fixtureBinary = path.join(
  cliProjectRoot,
  'test',
  'fixtures',
  'claude',
  process.platform === 'win32' ? 'fake-claude.cmd' : 'fake-claude.mjs'
);

let cwd: string;
let sessionId = `fixture-${randomUUID()}`;

beforeAll(() => {
  if (process.platform !== 'win32') fs.chmodSync(fixtureBinary, 0o755);
});

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-dispatch-中文-'));
});

afterEach(async () => {
  try {
    await cleanupTempPathAsync(cwd);
  } finally {
    sessionId = `fixture-${randomUUID()}`;
  }
});

function writePrompt(mode: string, suffix = ''): string {
  const file = path.join(cwd, `prompt ${mode}.txt`);
  fs.writeFileSync(
    file,
    `MODE=${mode}\nSESSION_ID=${sessionId}\n${suffix}`,
    'utf8'
  );
  return file;
}

interface DispatchOptions {
  cwd?: string;
  timeoutMs?: number;
  cliTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

function dispatchArgs(
  promptFile: string,
  extra: string[] = [],
  options: DispatchOptions = {}
): string[] {
  return [
    'agent',
    'dispatch',
    '--runtime',
    'claude',
    '--prompt-file',
    promptFile,
    '--contract',
    'leaf',
    '--sandbox',
    'read-only',
    '--cwd',
    options.cwd ?? cwd,
    '--timeout-ms',
    String(options.timeoutMs ?? 5000),
    '--json',
    ...extra,
  ];
}

async function dispatch(
  promptFile: string,
  extra: string[] = [],
  options: DispatchOptions = {}
) {
  return runCLI(
    dispatchArgs(promptFile, extra, options),
    {
      env: { RASEN_CLAUDE_BIN: fixtureBinary, ...options.env },
      timeoutMs: options.cliTimeoutMs ?? 20_000,
    }
  );
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!fs.existsSync(filePath)) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for fixture marker: ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function receipt(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  expect(trimmed.split(/\r?\n/)).toHaveLength(1);
  return JSON.parse(trimmed) as Record<string, unknown>;
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
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for fixture process ${pid} to exit.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function waitForClose(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', () => resolve());
  });
}

describe('rasen agent dispatch --runtime claude', () => {
  it('keeps missing required inputs inside the single-receipt contract', async () => {
    const result = await runCLI(['agent', 'dispatch', '--json']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(receipt(result.stdout)).toMatchObject({
      ok: false,
      runtime: 'unknown',
      failure: { kind: 'invalid-input' },
    });
  });

  it('runs a complete fresh to exact-resume chain with multiline CJK stdin', async () => {
    const prompt = writePrompt(
      'success',
      '第一行\n第二行 \"quoted\" & | > < ^ % !'
    );
    const fresh = await dispatch(prompt, ['--model', 'sonnet', '--effort', 'high']);
    expect(fresh.exitCode).toBe(0);
    expect(fresh.stderr).toBe('');
    const freshReceipt = receipt(fresh.stdout) as {
      ok: true;
      sessionId: string;
      result: { summary: string };
    };
    expect(freshReceipt.ok).toBe(true);
    expect(freshReceipt.sessionId).toBe(sessionId);
    const summary = JSON.parse(freshReceipt.result.summary) as {
      prompt: string;
      cwd: string;
      args: string[];
    };
    expect(summary.prompt).toContain('第一行\n第二行');
    expect(summary.cwd).toBe(fs.realpathSync.native(cwd));
    expect(summary.args.join(' ')).not.toContain('第一行');

    const resumed = await dispatch(prompt, ['--resume', freshReceipt.sessionId]);
    expect(resumed.exitCode).toBe(0);
    expect(receipt(resumed.stdout)).toMatchObject({
      ok: true,
      sessionId: freshReceipt.sessionId,
    });
  });

  it.each([
    ['nonzero', 'nonzero-exit'],
    ['malformed', 'invalid-json'],
    ['error-envelope', 'claude-error-result'],
    ['missing-structured', 'structured-output-missing'],
    ['invalid-contract', 'contract-invalid'],
  ])('returns one nonzero structured receipt for %s', async (mode, kind) => {
    const result = await dispatch(writePrompt(mode));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    const parsed = receipt(result.stdout);
    expect(parsed).toMatchObject({
      ok: false,
      failure: { kind },
    });
    if (mode === 'error-envelope') {
      expect(parsed).toMatchObject({
        diagnostics: {
          result: 'fixture error detail',
          errors: expect.stringContaining('fixture rejected the turn'),
        },
      });
    }
  });

  it('enforces exact-session ownership across concurrent CLI processes', async () => {
    const markerFile = path.join(cwd, 'writer-started.marker');
    const releaseFile = path.join(cwd, 'release-writer.marker');
    const prompt = writePrompt(
      'hold',
      `MARKER_FILE=${markerFile}\nRELEASE_FILE=${releaseFile}`
    );
    const busySessionId = `busy-${randomUUID()}`;

    const first = dispatch(prompt, ['--resume', busySessionId], {
      cliTimeoutMs: 30_000,
    });
    await waitForFile(markerFile);

    const duplicateSpawnMarker = path.join(cwd, 'duplicate-spawned.marker');
    let duplicate: Awaited<ReturnType<typeof dispatch>>;
    try {
      duplicate = await dispatch(
        writePrompt('success', `MARKER_FILE=${duplicateSpawnMarker}`),
        ['--resume', busySessionId]
      );
    } finally {
      fs.writeFileSync(releaseFile, 'release\n', 'utf8');
    }
    expect(duplicate.exitCode).toBe(1);
    expect(receipt(duplicate.stdout)).toMatchObject({
      ok: false,
      sessionId: busySessionId,
      failure: { kind: 'session-busy' },
    });
    expect(fs.existsSync(duplicateSpawnMarker)).toBe(false);

    const firstResult = await first;
    expect(firstResult.exitCode).toBe(0);
    expect(receipt(firstResult.stdout)).toMatchObject({
      ok: true,
      sessionId: busySessionId,
    });
  });

  it('keeps the exact session busy when only the bridge parent dies and its worker survives', async () => {
    await ensureCliBuilt();
    const markerFile = path.join(cwd, 'orphan-worker-started.marker');
    const releaseFile = path.join(cwd, 'release-orphan-worker.marker');
    const duplicateMarker = path.join(cwd, 'orphan-duplicate-spawned.marker');
    const stateHome = path.join(cwd, 'isolated-rasen-home');
    const heldSessionId = `parent-death-${randomUUID()}`;
    const heldPrompt = writePrompt(
      'hold',
      `MARKER_FILE=${markerFile}\nRELEASE_FILE=${releaseFile}`
    );
    const cliEntry = path.join(cliProjectRoot, 'dist', 'cli', 'index.js');
    const first = spawn(
      process.execPath,
      [cliEntry, ...dispatchArgs(heldPrompt, ['--resume', heldSessionId], {
        timeoutMs: 20_000,
      })],
      {
        cwd: cliProjectRoot,
        env: {
          ...process.env,
          RASEN_HOME: stateHome,
          RASEN_CLAUDE_BIN: fixtureBinary,
          RASEN_LANG: 'en',
          RASEN_TELEMETRY: '0',
          OPEN_SPEC_INTERACTIVE: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }
    );
    first.stdout?.resume();
    first.stderr?.resume();
    const firstClosed = waitForClose(first);

    let workerPid: number | undefined;
    try {
      await waitForFile(markerFile);
      workerPid = (
        JSON.parse(fs.readFileSync(markerFile, 'utf8')) as { pid: number }
      ).pid;
      expect(pidIsAlive(workerPid)).toBe(true);
      expect(first.pid).toBeTypeOf('number');

      // Deliberately kill only the Node bridge. Do not use taskkill /T or a
      // negative POSIX process-group signal: the held Claude fixture must
      // survive so the next process exercises durable worker-tree ownership.
      expect(first.kill('SIGKILL')).toBe(true);
      await firstClosed;
      expect(pidIsAlive(workerPid)).toBe(true);

      const duplicate = await dispatch(
        writePrompt('success', `MARKER_FILE=${duplicateMarker}`),
        ['--resume', heldSessionId],
        { env: { RASEN_HOME: stateHome } }
      );
      expect(duplicate.exitCode).toBe(1);
      expect(receipt(duplicate.stdout)).toMatchObject({
        ok: false,
        sessionId: heldSessionId,
        failure: { kind: 'session-busy' },
      });
      expect(fs.existsSync(duplicateMarker)).toBe(false);
    } finally {
      fs.writeFileSync(releaseFile, 'release\n', 'utf8');
      if (workerPid !== undefined) await waitForPidExit(workerPid);
    }
  });

  it('rejects a cross-process resume from a different canonical cwd before spawn', async () => {
    const prompt = writePrompt('success');
    const fresh = await dispatch(prompt);
    expect(fresh.exitCode).toBe(0);
    expect(receipt(fresh.stdout)).toMatchObject({
      ok: true,
      sessionId,
      cwd: fs.realpathSync.native(cwd),
    });

    const otherCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-dispatch-other-'));
    try {
      const resumeSpawnMarker = path.join(cwd, 'wrong-cwd-spawned.marker');
      const resumePrompt = writePrompt(
        'success',
        `MARKER_FILE=${resumeSpawnMarker}`
      );
      const resumed = await dispatch(resumePrompt, ['--resume', sessionId], {
        cwd: otherCwd,
      });
      expect(resumed.exitCode).toBe(1);
      expect(receipt(resumed.stdout)).toMatchObject({
        ok: false,
        sessionId,
        cwd: fs.realpathSync.native(otherCwd),
        failure: { kind: 'resume-cwd-mismatch' },
      });
      expect(fs.existsSync(resumeSpawnMarker)).toBe(false);
    } finally {
      fs.rmSync(otherCwd, { recursive: true, force: true });
    }
  });

  it('returns a bounded timeout receipt without child stream leakage', async () => {
    const result = await runCLI(
      [
        'agent',
        'dispatch',
        '--runtime',
        'claude',
        '--prompt-file',
        writePrompt('timeout'),
        '--contract',
        'leaf',
        '--sandbox',
        'read-only',
        '--cwd',
        cwd,
        '--timeout-ms',
        '100',
        '--json',
      ],
      {
        env: { RASEN_CLAUDE_BIN: fixtureBinary },
        // Windows process-tree teardown may outlive the bridge's own 100ms
        // timeout while taskkill closes the .cmd shim and its Node child.
        timeoutMs: 20_000,
      }
    );
    expect(result.exitCode).toBe(1);
    expect(receipt(result.stdout)).toMatchObject({
      ok: false,
      failure: { kind: 'timeout' },
    });
  });

  it.each([
    [
      ['--runtime', 'codex', '--contract', 'leaf', '--sandbox', 'read-only'],
      /runtime/,
    ],
    [
      ['--runtime', 'claude', '--contract', 'other', '--sandbox', 'read-only'],
      /contract/,
    ],
    [
      ['--runtime', 'claude', '--contract', 'leaf', '--sandbox', 'unsafe'],
      /sandbox/,
    ],
    [
      [
        '--runtime',
        'claude',
        '--contract',
        'leaf',
        '--sandbox',
        'read-only',
        '--effort',
        'ultra',
      ],
      /effort/,
    ],
  ])('validates runtime/contract/sandbox/effort before launch', async (flags, message) => {
    const result = await runCLI(
      [
        'agent',
        'dispatch',
        '--prompt-file',
        writePrompt('success'),
        '--cwd',
        cwd,
        '--json',
        ...flags,
      ],
      {
        env: { RASEN_CLAUDE_BIN: path.join(cwd, 'must-not-launch') },
      }
    );
    expect(result.exitCode).toBe(1);
    const parsed = receipt(result.stdout) as {
      failure: { kind: string; message: string };
    };
    expect(parsed.failure.kind).toBe('invalid-input');
    expect(parsed.failure.message).toMatch(message);
  });

  it('validates prompt files, cwd, timeout, and resume before launch', async () => {
    const result = await runCLI(
      [
        'agent',
        'dispatch',
        '--runtime',
        'claude',
        '--prompt-file',
        path.join(cwd, 'missing.txt'),
        '--contract',
        'leaf',
        '--sandbox',
        'read-only',
        '--cwd',
        path.join(cwd, 'missing-dir'),
        '--timeout-ms',
        '0',
        '--resume',
        'bad session',
        '--json',
      ],
      { env: { RASEN_CLAUDE_BIN: path.join(cwd, 'must-not-launch') } }
    );
    expect(result.exitCode).toBe(1);
    expect(receipt(result.stdout)).toMatchObject({
      ok: false,
      failure: { kind: 'invalid-input' },
    });
  });
});
