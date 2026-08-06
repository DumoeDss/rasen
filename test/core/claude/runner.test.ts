import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

import {
  buildClaudePrintInvocation,
  claimClaudeSessionWriter,
  getClaudeSessionStatePaths,
  isClaudeSessionWriterClaimed,
  parseClaudeResultEnvelope,
  runClaudePrint,
} from '../../../src/core/claude/index.js';
import { spawnAgentCli } from '../../../src/core/agent-cli-process.js';
import { detectHostRuntime } from '../../../src/core/runtime-adapters.js';

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'claude'
);
const fakeBinary = path.join(
  fixtureDir,
  process.platform === 'win32' ? 'fake-claude.cmd' : 'fake-claude.mjs'
);

let cwd: string;

beforeAll(() => {
  if (process.platform !== 'win32') fs.chmodSync(fakeBinary, 0o755);
});

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-claude-runner-'));
});

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

function invocation(
  mode: string,
  options: { contract?: 'leaf' | 'evaluate'; resumeSessionId?: string } = {}
) {
  return buildClaudePrintInvocation({
    prompt: `MODE=${mode}`,
    contract: options.contract ?? 'leaf',
    sandbox: 'read-only',
    ...(options.resumeSessionId
      ? { resumeSessionId: options.resumeSessionId }
      : {}),
  });
}

function sessionStateDir(): string {
  return path.join(cwd, '.claude-session-state');
}

function runClaude(
  options: Omit<Parameters<typeof runClaudePrint>[0], 'sessionStateDir'>
) {
  return runClaudePrint({ ...options, sessionStateDir: sessionStateDir() });
}

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function splitUtf8Spawn(envelope: unknown): ChildProcess {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, { stdout, stderr, stdin });
  queueMicrotask(() => {
    for (const byte of Buffer.from(JSON.stringify(envelope), 'utf8')) {
      stdout.write(Buffer.from([byte]));
    }
    stdout.end();
    stderr.end();
    child.emit('close', 0, null);
  });
  return child;
}

describe('Claude result envelope', () => {
  it('accepts valid leaf, handoff, and evaluate outputs', () => {
    expect(
      parseClaudeResultEnvelope(
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          session_id: 's',
          structured_output: { status: 'DONE' },
        }),
        'leaf',
        cwd
      )
    ).toMatchObject({ ok: true, sessionId: 's', result: { status: 'DONE' } });
    expect(
      parseClaudeResultEnvelope(
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          session_id: 's',
          structured_output: { status: 'HANDOFF', handoffReason: 'budget' },
        }),
        'leaf',
        cwd
      )
    ).toMatchObject({ ok: true, result: { status: 'HANDOFF' } });
    expect(
      parseClaudeResultEnvelope(
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          session_id: 's',
          structured_output: { satisfied: false, gaps: ['x'] },
        }),
        'evaluate',
        cwd
      )
    ).toMatchObject({ ok: true, result: { satisfied: false, gaps: ['x'] } });
  });

  it.each([
    ['not json', 'invalid-json'],
    [
      JSON.stringify({
        type: 'result',
        subtype: 'error',
        is_error: true,
        session_id: 's',
      }),
      'claude-error-result',
    ],
    [
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: 's',
      }),
      'structured-output-missing',
    ],
    [
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: 's',
        structured_output: { status: 'MAYBE' },
      }),
      'contract-invalid',
    ],
  ])('classifies invalid envelope %#', (text, kind) => {
    expect(parseClaudeResultEnvelope(text, 'leaf', cwd)).toMatchObject({
      ok: false,
      failure: { kind },
    });
  });

  it('preserves bounded redacted result and errors from Claude error envelopes', () => {
    const secret = 'sk-ant-secret-value-123456789';
    const parsed = parseClaudeResultEnvelope(
      JSON.stringify({
        type: 'result',
        subtype: 'error',
        is_error: true,
        session_id: 's',
        result: `request failed with Bearer ${secret}`,
        errors: [
          {
            message: 'upstream rejected credentials',
            apiKey: secret,
            detail: 'x'.repeat(20_000),
          },
        ],
      }),
      'leaf',
      cwd
    );

    expect(parsed).toMatchObject({
      ok: false,
      failure: { kind: 'claude-error-result' },
    });
    if (parsed.ok) return;
    expect(parsed.diagnostics?.result).toContain('<redacted>');
    expect(parsed.diagnostics?.errors).toContain('<redacted>');
    expect(JSON.stringify(parsed)).not.toContain(secret);
    expect(Buffer.byteLength(parsed.diagnostics?.result ?? '', 'utf8')).toBeLessThanOrEqual(
      4096
    );
    expect(Buffer.byteLength(parsed.diagnostics?.errors ?? '', 'utf8')).toBeLessThanOrEqual(
      4096
    );
    expect(parsed.diagnostics?.errors).toContain('<truncated>');
  });
});

describe('bounded Claude process runner', () => {
  it('captures fresh success, exact resume identity, cwd, and stdin prompt', async () => {
    const fresh = await runClaude({
      binary: fakeBinary,
      invocation: invocation('success'),
      cwd,
      timeoutMs: 5000,
    });
    const canonicalCwd = fs.realpathSync.native(cwd);
    expect(fresh).toMatchObject({
      ok: true,
      sessionId: 'fake-claude-session',
      cwd: canonicalCwd,
    });
    if (!fresh.ok) return;
    const summary = JSON.parse(
      (fresh.result as { summary: string }).summary
    ) as { prompt: string; args: string[]; cwd: string };
    expect(summary.prompt).toContain('MODE=success');
    expect(summary.args).not.toContain(summary.prompt);
    expect(summary.cwd).toBe(canonicalCwd);

    const resumed = await runClaude({
      binary: fakeBinary,
      invocation: invocation('success', { resumeSessionId: fresh.sessionId }),
      cwd,
      timeoutMs: 5000,
    });
    expect(resumed).toMatchObject({ ok: true, sessionId: fresh.sessionId });
  });

  it.each([
    ['nonzero', 'nonzero-exit'],
    ['malformed', 'invalid-json'],
    ['error-envelope', 'claude-error-result'],
    ['missing-structured', 'structured-output-missing'],
    ['invalid-contract', 'contract-invalid'],
  ])('classifies fixture mode %s as %s', async (mode, kind) => {
    const receipt = await runClaude({
      binary: fakeBinary,
      invocation: invocation(mode),
      cwd,
      timeoutMs: 5000,
    });
    expect(receipt).toMatchObject({ ok: false, failure: { kind } });
  });

  it('classifies timeout and output overflow while bounding diagnostics', async () => {
    const timeout = await runClaude({
      binary: fakeBinary,
      invocation: invocation('timeout'),
      cwd,
      timeoutMs: 100,
    });
    expect(timeout).toMatchObject({ ok: false, failure: { kind: 'timeout' } });

    const overflow = await runClaude({
      binary: fakeBinary,
      invocation: invocation('overflow'),
      cwd,
      timeoutMs: 5000,
      maxOutputBytes: 1024,
    });
    expect(overflow).toMatchObject({
      ok: false,
      failure: { kind: 'output-limit' },
    });
    if (!overflow.ok) {
      expect(Buffer.byteLength(overflow.diagnostics?.stdout ?? '', 'utf8')).toBeLessThanOrEqual(
        1024
      );
    }
  });

  it('rejects a spawn failure with a structured receipt', async () => {
    const receipt = await runClaude({
      binary: path.join(cwd, 'missing-claude'),
      invocation: invocation('success'),
      cwd,
      timeoutMs: 1000,
    });
    expect(receipt).toMatchObject({
      ok: false,
      failure: { kind: 'spawn-failed' },
    });
  });

  it('allows independent sessions concurrently and rejects a second writer for one session', async () => {
    const first = runClaude({
      binary: fakeBinary,
      invocation: invocation('timeout', { resumeSessionId: 'same-session' }),
      cwd,
      timeoutMs: 150,
    });
    await waitUntil(() =>
      isClaudeSessionWriterClaimed('same-session', {
        stateDir: sessionStateDir(),
      })
    );
    const duplicate = await runClaude({
      binary: fakeBinary,
      invocation: invocation('success', { resumeSessionId: 'same-session' }),
      cwd,
      timeoutMs: 5000,
    });
    expect(duplicate).toMatchObject({
      ok: false,
      failure: { kind: 'session-busy' },
    });

    const [a, b] = await Promise.all([
      runClaude({
        binary: fakeBinary,
        invocation: invocation('success', { resumeSessionId: 'session-a' }),
        cwd,
        timeoutMs: 5000,
      }),
      runClaude({
        binary: fakeBinary,
        invocation: invocation('success', { resumeSessionId: 'session-b' }),
        cwd,
        timeoutMs: 5000,
      }),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    await first;
    expect(
      await isClaudeSessionWriterClaimed('same-session', {
        stateDir: sessionStateDir(),
      })
    ).toBe(false);
  });

  it('rejects a known resumed session in a different cwd', async () => {
    const fresh = await runClaude({
      binary: fakeBinary,
      invocation: invocation('success'),
      cwd,
      timeoutMs: 5000,
    });
    expect(fresh.ok).toBe(true);
    const otherCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-claude-other-'));
    try {
      const receipt = await runClaude({
        binary: fakeBinary,
        invocation: invocation('success', {
          resumeSessionId: 'fake-claude-session',
        }),
        cwd: otherCwd,
        timeoutMs: 5000,
      });
      expect(receipt).toMatchObject({
        ok: false,
        failure: { kind: 'resume-cwd-mismatch' },
      });
    } finally {
      fs.rmSync(otherCwd, { recursive: true, force: true });
    }
  });

  it('decodes UTF-8 statefully when every output byte arrives separately', async () => {
    const receipt = await runClaude({
      binary: fakeBinary,
      invocation: invocation('success'),
      cwd,
      timeoutMs: 5000,
      spawn: (() =>
        splitUtf8Spawn({
          type: 'result',
          subtype: 'success',
          is_error: false,
          session_id: 'split-utf8-session',
          structured_output: { status: 'DONE', summary: '中文🙂' },
        })) as Parameters<typeof runClaudePrint>[0]['spawn'],
    });

    expect(receipt).toMatchObject({
      ok: true,
      result: { status: 'DONE', summary: '中文🙂' },
    });
  });

  // A child inherits the SPAWNING harness's fingerprints, and the Codex ones
  // outrank `CLAUDECODE`. Only the runner can fix this — the worker cannot
  // tell its parent's environment from its own. `RASEN_AGENT_RUNTIME` is
  // deliberately not scrubbed by the setup file, so this asserts the merge
  // rather than an ambient default.
  it.each([
    ['codex fingerprints', { CODEX_THREAD_ID: 'parent-thread', CODEX_SANDBOX: 'workspace-write' }],
    ['a harness that sets claude values of its own', { OMPCODE: '1', CLAUDECODE: '1' }],
  ])('identifies a bridged worker as claude under %s', async (_label, hostFingerprints) => {
    let childEnv: NodeJS.ProcessEnv | undefined;
    const receipt = await runClaude({
      binary: fakeBinary,
      invocation: invocation('success'),
      cwd,
      timeoutMs: 5000,
      env: { ...process.env, ...hostFingerprints, RASEN_RUNNER_CANARY: 'kept' },
      spawn: ((binary, args, options) => {
        childEnv = options.env;
        return spawnAgentCli(binary, args, options);
      }) as Parameters<typeof runClaudePrint>[0]['spawn'],
    });

    expect(receipt.ok).toBe(true);
    expect(detectHostRuntime(childEnv)).toEqual({ runtime: 'claude', source: 'env-override' });
    // Establishing identity changes nothing else: every inherited value,
    // including the host's own fingerprints, still reaches the worker.
    for (const [key, value] of Object.entries(hostFingerprints)) {
      expect(childEnv?.[key]).toBe(value);
    }
    expect(childEnv?.RASEN_RUNNER_CANARY).toBe('kept');
  });

  it('recovers a writer claim whose recorded owner is provably dead', async () => {
    const sessionId = 'stale-session';
    const stateOptions = {
      stateDir: sessionStateDir(),
      processTreeProbe: () => false,
    };
    const paths = getClaudeSessionStatePaths(sessionId, stateOptions);
    const staleClaim = await claimClaudeSessionWriter(
      sessionId,
      cwd,
      stateOptions
    );
    staleClaim.bindWorker(2_147_483_646);
    const staleToken = JSON.parse(
      fs.readFileSync(paths.writerPath, 'utf8')
    ) as Record<string, unknown>;
    staleToken.bridgePid = 2_147_483_647;
    fs.writeFileSync(paths.writerPath, `${JSON.stringify(staleToken)}\n`, 'utf8');

    const claim = await claimClaudeSessionWriter(sessionId, cwd, stateOptions);
    expect(claim.cwd).toBe(fs.realpathSync.native(cwd));
    await claim.release();
    expect(fs.existsSync(paths.writerPath)).toBe(false);
  });

  it('serializes multi-contender stale recovery without displacing the replacement owner', async () => {
    const sessionId = 'multi-contender-stale-session';
    const stateOptions = {
      stateDir: sessionStateDir(),
      processTreeProbe: () => false,
    };
    const paths = getClaudeSessionStatePaths(sessionId, stateOptions);
    const staleClaim = await claimClaudeSessionWriter(
      sessionId,
      cwd,
      stateOptions
    );
    staleClaim.bindWorker(2_147_483_646);
    const staleToken = JSON.parse(
      fs.readFileSync(paths.writerPath, 'utf8')
    ) as Record<string, unknown>;
    staleToken.bridgePid = 2_147_483_647;
    fs.writeFileSync(paths.writerPath, `${JSON.stringify(staleToken)}\n`, 'utf8');

    const contenders = await Promise.allSettled(
      Array.from({ length: 24 }, () =>
        claimClaudeSessionWriter(sessionId, cwd, stateOptions)
      )
    );
    const winners = contenders.filter(
      (
        result
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof claimClaudeSessionWriter>>
      > => result.status === 'fulfilled'
    );
    expect(winners).toHaveLength(1);
    expect(
      contenders.filter((result) => result.status === 'rejected')
    ).toHaveLength(23);
    expect(fs.existsSync(paths.writerPath)).toBe(true);
    expect(
      await isClaudeSessionWriterClaimed(sessionId, {
        ...stateOptions,
      })
    ).toBe(true);

    await winners[0].value.release();
    expect(fs.existsSync(paths.writerPath)).toBe(false);
  });

  it('fails closed when the bridge dies before publishing a worker root', async () => {
    const sessionId = 'orphaned-start-session';
    const paths = getClaudeSessionStatePaths(sessionId, {
      stateDir: sessionStateDir(),
    });
    await claimClaudeSessionWriter(sessionId, cwd, {
      stateDir: sessionStateDir(),
    });
    const startingToken = JSON.parse(
      fs.readFileSync(paths.writerPath, 'utf8')
    ) as Record<string, unknown>;
    startingToken.bridgePid = 2_147_483_647;
    fs.writeFileSync(
      paths.writerPath,
      `${JSON.stringify(startingToken)}\n`,
      'utf8'
    );

    await expect(
      claimClaudeSessionWriter(sessionId, cwd, {
        stateDir: sessionStateDir(),
      })
    ).rejects.toMatchObject({ name: 'ClaudeSessionBusyError' });
    expect(fs.existsSync(paths.writerPath)).toBe(true);
  });

  it('never removes a writer claim whose owner token changed', async () => {
    const sessionId = 'ownership-turnover-session';
    const paths = getClaudeSessionStatePaths(sessionId, {
      stateDir: sessionStateDir(),
    });
    const claim = await claimClaudeSessionWriter(sessionId, cwd, {
      stateDir: sessionStateDir(),
    });
    const replacement = `${JSON.stringify({
      version: 2,
      bridgePid: process.pid,
      nonce: 'replacement-owner',
      createdAt: new Date().toISOString(),
    })}\n`;
    fs.writeFileSync(paths.writerPath, replacement, 'utf8');

    await claim.release();
    expect(fs.readFileSync(paths.writerPath, 'utf8')).toBe(replacement);
  });
});
