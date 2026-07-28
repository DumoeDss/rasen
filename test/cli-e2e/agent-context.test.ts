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
});
