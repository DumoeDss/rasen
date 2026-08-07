import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { runCLI } from '../helpers/run-cli.js';

/** Build a Codex token_count line with lifetime spend and current-context usage. */
function tokenCountLine(
  totalTokens: number,
  modelContextWindow: number,
  contextTokens: number = totalTokens
): string {
  return JSON.stringify({
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: { total_tokens: totalTokens },
        last_token_usage: { total_tokens: contextTokens },
        model_context_window: modelContextWindow,
      },
    },
  });
}

function turnContextLine(model: string): string {
  return JSON.stringify({ type: 'turn_context', payload: { model } });
}

function sessionMeta(cwd: string): string {
  return JSON.stringify({ type: 'session_meta', payload: { cwd } });
}

/**
 * One Oh My Pi session file in the on-disk row order every real one uses. The
 * usage figures are a live capture, `totalTokens` included: it is 263 higher
 * than the occupancy, so a reader that used it would fail these assertions.
 */
function ompSessionFile(cwd: string, model: string): string {
  return (
    [
      JSON.stringify({ type: 'title', v: 1, title: '', source: 'auto', pad: ' '.repeat(64) }),
      JSON.stringify({ type: 'session', version: 3, id: 'abc', cwd }),
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          model,
          provider: 'anthropic',
          usage: {
            input: 2,
            output: 263,
            cacheRead: 122_824,
            cacheWrite: 1_275,
            totalTokens: 124_364,
          },
        },
      }),
    ].join('\n') + '\n'
  );
}

describe('CLI: agent context --latest --runtime codex', () => {
  let projectDir: string;
  let codexHome: string;

  beforeEach(() => {
    // realpathSync: on macOS os.tmpdir() sits under a /var -> /private/var
    // symlink, and a spawned child's process.cwd() reports the resolved
    // path — so session_meta.cwd must be written pre-resolved to match.
    projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-cli-codex-project-')));
    codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-cli-codex-home-'));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(codexHome, { recursive: true, force: true });
  });

  it('reports current occupancy after cumulative/current divergence and compaction', async () => {
    const rolloutPath = path.join(
      codexHome,
      'sessions',
      '2026',
      '07',
      '12',
      'rollout-2026-07-12T09-00-00-abc.jsonl'
    );
    fs.mkdirSync(path.dirname(rolloutPath), { recursive: true });
    fs.writeFileSync(
      rolloutPath,
      [
        sessionMeta(projectDir),
        turnContextLine('gpt-5.6-sol'),
        tokenCountLine(160_000_000, 258_400, 220_000),
        JSON.stringify({ type: 'event_msg', payload: { type: 'context_compacted' } }),
        tokenCountLine(164_620_250, 258_400, 40_556),
      ].join('\n') + '\n',
      'utf-8'
    );

    const result = await runCLI(['agent', 'context', '--latest', '--runtime', 'codex', '--json'], {
      cwd: projectDir,
      env: { CODEX_HOME: codexHome },
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.available).toBe(true);
    expect(parsed.contextTokens).toBe(40_556);
    expect(parsed.limit).toBe(258_400);
    expect(parsed.model).toBe('gpt-5.6-sol');
    expect(parsed.transcript).toBe(rolloutPath);
  });

  it('exits non-zero without fabricating occupancy for a matching unsupported rollout', async () => {
    const rolloutPath = path.join(
      codexHome,
      'sessions',
      '2026',
      '07',
      '12',
      'rollout-2026-07-12T09-05-00-legacy.jsonl'
    );
    fs.mkdirSync(path.dirname(rolloutPath), { recursive: true });
    fs.writeFileSync(
      rolloutPath,
      [
        sessionMeta(projectDir),
        turnContextLine('gpt-5.6-sol'),
        JSON.stringify({
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              total_token_usage: { total_tokens: 164_620_250 },
              model_context_window: 258_400,
            },
          },
        }),
      ].join('\n') + '\n',
      'utf-8'
    );

    const result = await runCLI(['agent', 'context', '--latest', '--runtime', 'codex', '--json'], {
      cwd: projectDir,
      env: { CODEX_HOME: codexHome },
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/current-context.*last_token_usage\.total_tokens/i);
    expect(result.stdout).not.toContain('"contextTokens"');
  });

  it('reports the unavailable shape and exits 0 when no rollout matches', async () => {
    fs.mkdirSync(path.join(codexHome, 'sessions'), { recursive: true });

    const result = await runCLI(['agent', 'context', '--latest', '--runtime', 'codex', '--json'], {
      cwd: projectDir,
      env: { CODEX_HOME: codexHome },
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.available).toBe(false);
    expect(parsed.reason).toBe('no-transcript');
    expect(typeof parsed.detail).toBe('string');
  });

  // The command layer forwards no `env` to `probeAgentContextSafe`, so the host
  // it resolves comes from the spawned process's own environment. Only a real
  // CLI invocation covers that inheritance — including that the Oh My Pi agent
  // directory is resolved from the child's env, not the parent's.
  it('reports an Oh My Pi host its own session under an implicit --latest', async () => {
    const agentDir = path.join(projectDir, 'omp-agent');
    // A legacy-named bucket, deliberately: a locator that derived the current
    // hashed name from the cwd would find nothing here and report absence.
    const sessionPath = path.join(agentDir, 'sessions', '-legacy-bucket', 'live.jsonl');
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, ompSessionFile(projectDir, 'claude-opus-5'), 'utf-8');

    const result = await runCLI(['agent', 'context', '--latest', '--json'], {
      cwd: projectDir,
      env: { OMPCODE: '1', CLAUDECODE: '1', PI_CODING_AGENT_DIR: agentDir },
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.available).toBe(true);
    expect(parsed.runtime).toBe('omp');
    // 2 + 122_824 + 1_275 — NOT the 124_364 `totalTokens` the same row records.
    expect(parsed.contextTokens).toBe(124_101);
    expect(parsed.limit).toBe(1_000_000);
    expect(parsed.transcript).toBe(sessionPath);
  });

  it('reports the ordinary absence shape when an Oh My Pi host has no session', async () => {
    const agentDir = path.join(projectDir, 'omp-agent-empty');
    fs.mkdirSync(path.join(agentDir, 'sessions'), { recursive: true });

    const result = await runCLI(['agent', 'context', '--latest', '--json'], {
      cwd: projectDir,
      env: { OMPCODE: '1', CLAUDECODE: '1', PI_CODING_AGENT_DIR: agentDir },
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.available).toBe(false);
    expect(parsed.reason).toBe('no-transcript');
    expect(result.stdout).not.toContain('"contextTokens"');
  });

  it('still refuses an implicit --latest under a host with no probe adapter', async () => {
    // `zed` is registered with no context reader and has no host fingerprint, so
    // the explicit runtime override is the only way to reach the refusal now.
    const result = await runCLI(['agent', 'context', '--latest', '--json'], {
      cwd: projectDir,
      env: { RASEN_AGENT_RUNTIME: 'zed' },
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed).toEqual({
      available: false,
      reason: 'unsupported-host',
      detail: expect.stringContaining('"zed"'),
    });
    expect(result.stdout).not.toContain('"contextTokens"');
  });

  it('reads an explicitly named Oh My Pi session file instead of refusing it', async () => {
    const ompPath = path.join(projectDir, 'omp-session.jsonl');
    fs.writeFileSync(ompPath, ompSessionFile(projectDir, 'claude-opus-5'), 'utf-8');

    const result = await runCLI(['agent', 'context', '--transcript', ompPath, '--json'], {
      cwd: projectDir,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.runtime).toBe('omp');
    expect(parsed.contextTokens).toBe(124_101);
    expect(parsed.transcript).toBe(ompPath);
  });

  it('reports an honest unknown window for a model with no known context size', async () => {
    const ompPath = path.join(projectDir, 'omp-unknown-model.jsonl');
    fs.writeFileSync(ompPath, ompSessionFile(projectDir, 'some-vendor/mystery-7b'), 'utf-8');

    const result = await runCLI(['agent', 'context', '--transcript', ompPath, '--json'], {
      cwd: projectDir,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.contextTokens).toBe(124_101);
    expect(parsed.limit).toBe(0);
    expect(parsed.pct).toBe(0);
    // Never the 200_000 conservative default: a percentage against a guessed
    // window is indistinguishable from a correct one.
    expect(parsed.limit).not.toBe(200_000);
  });
});
