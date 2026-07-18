import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { AgentCommand } from '../../../src/commands/agent.js';

function tokenCountLine(totalTokens: number, modelContextWindow: number): string {
  return JSON.stringify({
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: { total_tokens: totalTokens },
        model_context_window: modelContextWindow,
      },
    },
  });
}

const SESSION_META_LINE = JSON.stringify({ type: 'session_meta', payload: { cli_version: '0.144.1' } });
const TURN_CONTEXT_LINE = JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.6-sol' } });

describe('AgentCommand.context — Codex rollout support', () => {
  let dir: string;
  let cmd: AgentCommand;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-agentcmd-'));
    cmd = new AgentCommand();

    // Isolate global config reads (resolveHandoffThresholdReport consults
    // it) from the shared vitest safety-net machine root.
    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = dir;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeRollout(name: string, lines: string[]): string {
    const p = path.join(dir, name);
    fs.writeFileSync(p, lines.join('\n') + '\n', 'utf-8');
    return p;
  }

  it('--json reports occupancy for a Codex rollout fixture', async () => {
    const p = writeRollout('rollout-2026-01-01T00-00-00-abc.jsonl', [
      SESSION_META_LINE,
      TURN_CONTEXT_LINE,
      tokenCountLine(12_885, 353_400),
    ]);

    const logs: string[] = [];
    const orig = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg));
    try {
      await cmd.context({ transcript: p, json: true });
    } finally {
      console.log = orig;
    }

    const parsed = JSON.parse(logs[0]);
    expect(parsed.contextTokens).toBe(12_885);
    expect(parsed.limit).toBe(353_400);
    expect(parsed.model).toBe('gpt-5.6-sol');
    expect(parsed.remainingTokens).toBe(353_400 - 12_885);
    expect(parsed.transcript).toBe(p);
  });

  it('an explicit --limit recomputes remainingTokens', async () => {
    const p = writeRollout('rollout-2026-01-01T00-00-08-abc.jsonl', [
      SESSION_META_LINE,
      TURN_CONTEXT_LINE,
      tokenCountLine(12_885, 353_400),
    ]);

    const logs: string[] = [];
    const orig = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg));
    try {
      await cmd.context({ transcript: p, limit: 1_000_000, json: true });
    } finally {
      console.log = orig;
    }

    const parsed = JSON.parse(logs[0]);
    expect(parsed.limit).toBe(1_000_000);
    expect(parsed.remainingTokens).toBe(1_000_000 - 12_885);
  });

  it('a zero-turn rollout exits 0 (no throw) with zero occupancy', async () => {
    const p = writeRollout('rollout-2026-01-01T00-00-01-abc.jsonl', [SESSION_META_LINE]);

    const logs: string[] = [];
    const orig = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg));
    try {
      await expect(cmd.context({ transcript: p, json: true })).resolves.toBeUndefined();
    } finally {
      console.log = orig;
    }

    const parsed = JSON.parse(logs[0]);
    expect(parsed.contextTokens).toBe(0);
    expect(parsed.pct).toBe(0);
  });

  it('--runtime bogus errors actionably', async () => {
    const p = writeRollout('rollout-2026-01-01T00-00-02-abc.jsonl', [SESSION_META_LINE]);
    await expect(cmd.context({ transcript: p, runtime: 'bogus' })).rejects.toThrow(
      /--runtime must be "claude" or "codex"/
    );
  });

  it('--runtime codex forces a rollout read on a non-conforming filename', async () => {
    const p = writeRollout('renamed.jsonl', [SESSION_META_LINE, tokenCountLine(500, 1_000)]);

    const logs: string[] = [];
    const orig = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg));
    try {
      await cmd.context({ transcript: p, runtime: 'codex', json: true });
    } finally {
      console.log = orig;
    }

    expect(JSON.parse(logs[0]).contextTokens).toBe(500);
  });

  it('--json includes threshold, thresholdSource, and shouldHandoff (MIN6b)', async () => {
    const { saveGlobalConfig } = await import('../../../src/core/global-config.js');
    saveGlobalConfig({ handoff: { threshold: 0.05 } } as never);

    const p = writeRollout('rollout-2026-01-01T00-00-03-abc.jsonl', [
      SESSION_META_LINE,
      TURN_CONTEXT_LINE,
      tokenCountLine(50_000, 100_000), // 50% occupancy, well above the 0.05 threshold
    ]);

    const logs: string[] = [];
    const orig = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg));
    try {
      await cmd.context({ transcript: p, json: true });
    } finally {
      console.log = orig;
    }

    const parsed = JSON.parse(logs[0]);
    expect(parsed.threshold).toBe(0.05);
    expect(parsed.thresholdSource).toBe('global');
    expect(parsed.shouldHandoff).toBe(true);
  });

  it('--json includes threshold as the absolute { remainingTokens } form when configured', async () => {
    const { saveGlobalConfig } = await import('../../../src/core/global-config.js');
    saveGlobalConfig({ handoff: { threshold: { remainingTokens: 60_000 } } } as never);

    const p = writeRollout('rollout-2026-01-01T00-00-05-abc.jsonl', [
      SESSION_META_LINE,
      TURN_CONTEXT_LINE,
      tokenCountLine(300_000, 353_400), // remaining = 53_400, below the 60_000 floor
    ]);

    const logs: string[] = [];
    const orig = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg));
    try {
      await cmd.context({ transcript: p, json: true });
    } finally {
      console.log = orig;
    }

    const parsed = JSON.parse(logs[0]);
    expect(parsed.threshold).toEqual({ remainingTokens: 60_000 });
    expect(parsed.thresholdSource).toBe('global');
    expect(parsed.shouldHandoff).toBe(true);
  });

  it('the human-readable line reports the resolved threshold and verdict', async () => {
    const p = writeRollout('rollout-2026-01-01T00-00-04-abc.jsonl', [
      SESSION_META_LINE,
      TURN_CONTEXT_LINE,
      tokenCountLine(1_000, 353_400), // low occupancy, default 0.5 threshold not met
    ]);

    const logs: string[] = [];
    const orig = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg));
    try {
      await cmd.context({ transcript: p });
    } finally {
      console.log = orig;
    }

    expect(logs[0]).toContain('handoff not yet needed');
    expect(logs[0]).toContain('50%');
    expect(logs[0]).toContain('default');
  });

  it('a successful --json probe carries available: true', async () => {
    const p = writeRollout('rollout-2026-01-01T00-00-06-abc.jsonl', [
      SESSION_META_LINE,
      TURN_CONTEXT_LINE,
      tokenCountLine(100, 1_000),
    ]);

    const logs: string[] = [];
    const orig = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg));
    try {
      await cmd.context({ transcript: p, json: true });
    } finally {
      console.log = orig;
    }

    expect(JSON.parse(logs[0]).available).toBe(true);
  });

  // design D2: environmental absence under --latest degrades gracefully
  // (no throw, exit 0 at the CLI layer) instead of erroring.
  describe('--latest graceful degradation (design D2)', () => {
    it('--json reports {available:false, reason:"no-transcript"} when the projects dir is absent, without throwing', async () => {
      const logs: string[] = [];
      const orig = console.log;
      console.log = (msg?: unknown) => logs.push(String(msg));
      try {
        await expect(
          cmd.context({ latest: true, dir: path.join(dir, 'missing'), json: true })
        ).resolves.toBeUndefined();
      } finally {
        console.log = orig;
      }

      const parsed = JSON.parse(logs[0]);
      expect(parsed.available).toBe(false);
      expect(parsed.reason).toBe('no-transcript');
      expect(typeof parsed.detail).toBe('string');
      expect(parsed.model).toBeUndefined();
      expect(parsed.contextTokens).toBeUndefined();
    });

    it('text mode prints one "context unavailable: ..." line without throwing', async () => {
      const logs: string[] = [];
      const orig = console.log;
      console.log = (msg?: unknown) => logs.push(String(msg));
      try {
        await expect(
          cmd.context({ latest: true, dir: path.join(dir, 'missing') })
        ).resolves.toBeUndefined();
      } finally {
        console.log = orig;
      }

      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatch(/^context unavailable: /);
    });

    it('an explicit --transcript that is missing still throws (input error, exit 1 at CLI layer)', async () => {
      await expect(
        cmd.context({ transcript: path.join(dir, 'nope.jsonl') })
      ).rejects.toThrow(/Cannot read transcript/);
    });
  });
});
