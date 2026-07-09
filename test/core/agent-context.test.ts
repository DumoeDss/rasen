import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  resolveModelLimit,
  computeContextFromTranscript,
  claudeProjectsDir,
  findLatestMainTranscript,
  resolveTranscriptPath,
  probeAgentContext,
  tryContextEstimate,
  DEFAULT_CONTEXT_LIMIT,
} from '../../src/core/agent-context.js';

/** Serialize an assistant usage entry as one transcript jsonl line. */
function assistantLine(
  model: string,
  usage: Record<string, number>
): string {
  return JSON.stringify({ type: 'assistant', message: { role: 'assistant', model, usage } });
}

describe('agent-context', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-agentctx-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeTranscript(name: string, lines: string[]): string {
    const p = path.join(dir, name);
    fs.writeFileSync(p, lines.join('\n') + '\n', 'utf-8');
    return p;
  }

  describe('resolveModelLimit', () => {
    it('maps current large-context generations to 1M', () => {
      expect(resolveModelLimit('claude-opus-4-8')).toBe(1_000_000);
      expect(resolveModelLimit('claude-sonnet-5')).toBe(1_000_000);
      expect(resolveModelLimit('claude-sonnet-4-6')).toBe(1_000_000);
      expect(resolveModelLimit('claude-fable-5')).toBe(1_000_000);
      expect(resolveModelLimit('claude-mythos-5')).toBe(1_000_000);
    });

    it('maps haiku to 200k', () => {
      expect(resolveModelLimit('claude-haiku-4-5-20251001')).toBe(200_000);
    });

    it('falls back to the conservative default for unknown models', () => {
      expect(resolveModelLimit('some-unknown-model')).toBe(DEFAULT_CONTEXT_LIMIT);
      expect(resolveModelLimit(undefined)).toBe(DEFAULT_CONTEXT_LIMIT);
      expect(resolveModelLimit(null)).toBe(DEFAULT_CONTEXT_LIMIT);
    });
  });

  describe('computeContextFromTranscript', () => {
    it('sums the three usage fields, treating missing fields as 0', () => {
      const p = writeTranscript('t.jsonl', [
        assistantLine('claude-opus-4-8', {
          input_tokens: 100,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 50,
        }),
      ]);
      const r = computeContextFromTranscript(p);
      expect(r.contextTokens).toBe(350);
      expect(r.model).toBe('claude-opus-4-8');
      expect(r.limit).toBe(1_000_000);
      expect(r.pct).toBe(0.00035);
      expect(r.transcript).toBe(p);
    });

    it('treats absent usage fields as 0', () => {
      const p = writeTranscript('partial.jsonl', [
        assistantLine('claude-opus-4-8', { input_tokens: 100 }),
      ]);
      expect(computeContextFromTranscript(p).contextTokens).toBe(100);
    });

    it('uses the LAST usage-bearing entry (last-entry-wins)', () => {
      const p = writeTranscript('multi.jsonl', [
        assistantLine('claude-opus-4-8', { input_tokens: 100 }),
        JSON.stringify({ type: 'user', message: { role: 'user' } }),
        assistantLine('claude-sonnet-5', {
          input_tokens: 500,
          cache_read_input_tokens: 500,
        }),
      ]);
      const r = computeContextFromTranscript(p);
      expect(r.contextTokens).toBe(1000);
      expect(r.model).toBe('claude-sonnet-5');
    });

    it('skips malformed/blank lines', () => {
      const p = writeTranscript('noisy.jsonl', [
        '',
        '{ not json',
        assistantLine('claude-opus-4-8', { input_tokens: 42 }),
        '   ',
      ]);
      expect(computeContextFromTranscript(p).contextTokens).toBe(42);
    });

    it('honors an explicit limit override', () => {
      const p = writeTranscript('override.jsonl', [
        assistantLine('unknown-model', { input_tokens: 500_000 }),
      ]);
      const r = computeContextFromTranscript(p, { limit: 1_000_000 });
      expect(r.limit).toBe(1_000_000);
      expect(r.pct).toBe(0.5);
    });

    it('throws an actionable error on a usage-free transcript', () => {
      const p = writeTranscript('nousage.jsonl', [
        JSON.stringify({ type: 'user', message: { role: 'user' } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'x' } }),
      ]);
      expect(() => computeContextFromTranscript(p)).toThrow(/no entry carrying message.usage|No assistant usage/i);
    });

    it('throws an actionable error on a missing file', () => {
      expect(() => computeContextFromTranscript(path.join(dir, 'nope.jsonl'))).toThrow(
        /Cannot read transcript/
      );
    });
  });

  describe('claudeProjectsDir', () => {
    it('slugs the cwd by replacing : and separators with -', () => {
      const home = path.join('C:', 'home');
      const result = claudeProjectsDir('E:\\AI\\ChatAI\\Rasen-code', home);
      expect(result).toBe(
        path.join(home, '.claude', 'projects', 'E--AI-ChatAI-Rasen-code')
      );
    });

    it('also replaces dots (Claude Code project-dir convention)', () => {
      const home = path.join('C:', 'home');
      const result = claudeProjectsDir('E:\\work\\my.app', home);
      expect(result).toBe(path.join(home, '.claude', 'projects', 'E--work-my-app'));
    });
  });

  describe('findLatestMainTranscript', () => {
    it('picks the newest main-session file, excluding agent-*.jsonl', () => {
      const older = writeTranscript('11111111-old.jsonl', [
        assistantLine('claude-opus-4-8', { input_tokens: 1 }),
      ]);
      const newer = writeTranscript('22222222-new.jsonl', [
        assistantLine('claude-opus-4-8', { input_tokens: 2 }),
      ]);
      // A subagent transcript that is the NEWEST file overall — must be excluded.
      const agent = writeTranscript('agent-zzz.jsonl', [
        assistantLine('claude-opus-4-8', { input_tokens: 3 }),
      ]);

      fs.utimesSync(older, new Date(1_000_000), new Date(1_000_000));
      fs.utimesSync(newer, new Date(2_000_000), new Date(2_000_000));
      fs.utimesSync(agent, new Date(3_000_000), new Date(3_000_000));

      expect(findLatestMainTranscript(dir)).toBe(newer);
    });

    it('throws when the directory is absent', () => {
      expect(() => findLatestMainTranscript(path.join(dir, 'missing'))).toThrow(
        /No Claude transcript directory/
      );
    });

    it('throws when only subagent transcripts exist', () => {
      writeTranscript('agent-only.jsonl', [
        assistantLine('claude-opus-4-8', { input_tokens: 1 }),
      ]);
      expect(() => findLatestMainTranscript(dir)).toThrow(/No main-session transcript/);
    });
  });

  describe('resolveTranscriptPath / probeAgentContext', () => {
    it('rejects a non-positive or non-integer limit override', () => {
      const p = writeTranscript('aaaa1111-x.jsonl', [
        assistantLine('claude-opus-4-8', { input_tokens: 10 }),
      ]);
      for (const bad of [0, -5, 1.5, Number.NaN]) {
        expect(() => probeAgentContext({ transcript: p, limit: bad })).toThrow(
          /--limit must be a positive integer/
        );
      }
    });

    it('prefers an explicit --transcript', () => {
      const p = writeTranscript('explicit.jsonl', [
        assistantLine('claude-opus-4-8', { input_tokens: 10 }),
      ]);
      expect(resolveTranscriptPath({ transcript: p })).toBe(p);
    });

    it('resolves --latest against an overridden --dir', () => {
      const p = writeTranscript('main.jsonl', [
        assistantLine('claude-opus-4-8', { input_tokens: 10 }),
      ]);
      const r = probeAgentContext({ latest: true, dir: dir });
      expect(r.transcript).toBe(p);
      expect(r.contextTokens).toBe(10);
    });

    it('throws when neither transcript nor latest is provided', () => {
      expect(() => resolveTranscriptPath({})).toThrow(/--transcript|--latest/);
    });
  });

  describe('tryContextEstimate', () => {
    it('returns the estimate for a readable transcript', () => {
      const p = writeTranscript('ok.jsonl', [
        assistantLine('claude-opus-4-8', { input_tokens: 250_000 }),
      ]);
      expect(tryContextEstimate(p)).toEqual({
        contextTokens: 250_000,
        limit: 1_000_000,
        pct: 0.25,
      });
    });

    it('returns undefined on any read error (never throws)', () => {
      expect(tryContextEstimate(path.join(dir, 'missing.jsonl'))).toBeUndefined();
    });
  });
});
