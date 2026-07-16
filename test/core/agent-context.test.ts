import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import {
  resolveModelLimit,
  computeContextFromTranscript,
  computeContextFromRollout,
  detectTranscriptKind,
  claudeProjectsDir,
  findLatestMainTranscript,
  findLatestRollout,
  resolveTranscriptPath,
  probeAgentContext,
  probeAgentContextSafe,
  tryContextEstimate,
  DEFAULT_CONTEXT_LIMIT,
  AgentContextUnavailableError,
} from '../../src/core/agent-context.js';

/** Serialize an assistant usage entry as one transcript jsonl line. */
function assistantLine(
  model: string,
  usage: Record<string, number>
): string {
  return JSON.stringify({ type: 'assistant', message: { role: 'assistant', model, usage } });
}

const FIXTURE_ROLLOUT = path.join(
  __dirname,
  '..',
  'fixtures',
  'codex-rollout',
  'sample-rollout.jsonl'
);

/** Build a Codex rollout jsonl from event_msg token_count payloads (last wins). */
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

function turnContextLine(model: string): string {
  return JSON.stringify({ type: 'turn_context', payload: { model } });
}

const SESSION_META_LINE = JSON.stringify({ type: 'session_meta', payload: { cli_version: '0.144.1' } });

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
      expect(r.remainingTokens).toBe(999_650);
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

    // design D2: both environmental-absence cases are typed, not generic
    // Errors, so the command layer can catch ONLY these and degrade gracefully.
    it('throws AgentContextUnavailableError (typed) when the directory is absent', () => {
      expect(() => findLatestMainTranscript(path.join(dir, 'missing'))).toThrow(
        AgentContextUnavailableError
      );
    });

    it('throws AgentContextUnavailableError (typed) when only subagent transcripts exist', () => {
      writeTranscript('agent-only.jsonl', [
        assistantLine('claude-opus-4-8', { input_tokens: 1 }),
      ]);
      expect(() => findLatestMainTranscript(dir)).toThrow(AgentContextUnavailableError);
    });
  });

  describe('findLatestRollout', () => {
    function writeRolloutAt(relativePath: string, lines: string[], mtime?: Date): string {
      const full = path.join(dir, 'sessions', relativePath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, lines.join('\n') + '\n', 'utf-8');
      if (mtime) fs.utimesSync(full, mtime, mtime);
      return full;
    }

    function sessionMeta(cwd: string, extra: Record<string, unknown> = {}): string {
      return JSON.stringify({ type: 'session_meta', payload: { cwd, ...extra } });
    }

    const sessionsDir = () => path.join(dir, 'sessions');

    it('picks the newest-mtime rollout among cwd matches', () => {
      const cwd = path.join(dir, 'project');
      const older = writeRolloutAt(
        '2026/07/12/rollout-2026-07-12T09-00-00-aaa.jsonl',
        [sessionMeta(cwd)],
        new Date(1_000_000)
      );
      const newer = writeRolloutAt(
        '2026/07/12/rollout-2026-07-12T10-00-00-bbb.jsonl',
        [sessionMeta(cwd)],
        new Date(2_000_000)
      );
      void older;
      expect(findLatestRollout(sessionsDir(), cwd)).toBe(newer);
    });

    it('skips a newer rollout recorded under a different cwd', () => {
      const cwd = path.join(dir, 'project');
      const otherCwd = path.join(dir, 'other-project');
      const match = writeRolloutAt(
        '2026/07/12/rollout-2026-07-12T09-00-00-aaa.jsonl',
        [sessionMeta(cwd)],
        new Date(1_000_000)
      );
      writeRolloutAt(
        '2026/07/12/rollout-2026-07-12T10-00-00-bbb.jsonl',
        [sessionMeta(otherCwd)],
        new Date(2_000_000)
      );
      expect(findLatestRollout(sessionsDir(), cwd)).toBe(match);
    });

    it('skips a forked-child (subagent) rollout even when newest', () => {
      const cwd = path.join(dir, 'project');
      const match = writeRolloutAt(
        '2026/07/12/rollout-2026-07-12T09-00-00-aaa.jsonl',
        [sessionMeta(cwd)],
        new Date(1_000_000)
      );
      writeRolloutAt(
        '2026/07/12/rollout-2026-07-12T10-00-00-bbb.jsonl',
        [sessionMeta(cwd, { forked_from_id: 'thread-1' })],
        new Date(2_000_000)
      );
      writeRolloutAt(
        '2026/07/12/rollout-2026-07-12T11-00-00-ccc.jsonl',
        [sessionMeta(cwd, { parent_thread_id: 'thread-1' })],
        new Date(3_000_000)
      );
      expect(findLatestRollout(sessionsDir(), cwd)).toBe(match);
    });

    it('skips a candidate with a malformed first line', () => {
      const cwd = path.join(dir, 'project');
      const match = writeRolloutAt(
        '2026/07/12/rollout-2026-07-12T09-00-00-aaa.jsonl',
        [sessionMeta(cwd)],
        new Date(1_000_000)
      );
      writeRolloutAt(
        '2026/07/12/rollout-2026-07-12T10-00-00-bbb.jsonl',
        ['{ not json'],
        new Date(2_000_000)
      );
      expect(findLatestRollout(sessionsDir(), cwd)).toBe(match);
    });

    it('throws AgentContextUnavailableError when the sessions root is missing', () => {
      const cwd = path.join(dir, 'project');
      expect(() => findLatestRollout(path.join(dir, 'no-sessions'), cwd)).toThrow(
        AgentContextUnavailableError
      );
    });

    it('throws AgentContextUnavailableError when the sessions root is empty', () => {
      fs.mkdirSync(sessionsDir(), { recursive: true });
      const cwd = path.join(dir, 'project');
      expect(() => findLatestRollout(sessionsDir(), cwd)).toThrow(AgentContextUnavailableError);
    });

    it('throws AgentContextUnavailableError when no rollout matches the cwd', () => {
      const cwd = path.join(dir, 'project');
      writeRolloutAt('2026/07/12/rollout-2026-07-12T09-00-00-aaa.jsonl', [
        sessionMeta(path.join(dir, 'unrelated')),
      ]);
      expect(() => findLatestRollout(sessionsDir(), cwd)).toThrow(AgentContextUnavailableError);
    });

    it('compares resolved absolute paths, tolerating a non-normalized probe cwd', () => {
      const cwd = path.join(dir, 'project');
      const match = writeRolloutAt('2026/07/12/rollout-2026-07-12T09-00-00-aaa.jsonl', [
        sessionMeta(cwd),
      ]);
      const messyCwd = path.join(dir, 'project', '..', 'project');
      expect(findLatestRollout(sessionsDir(), messyCwd)).toBe(match);
    });
  });

  // design D2: graceful degradation for environmental absence under --latest.
  describe('probeAgentContextSafe', () => {
    it('returns {available:false, reason:"no-transcript"} when the projects dir is absent', () => {
      const result = probeAgentContextSafe({ latest: true, dir: path.join(dir, 'missing') });
      expect(result.available).toBe(false);
      if (!result.available) {
        expect(result.reason).toBe('no-transcript');
        expect(result.detail).toMatch(/No Claude transcript directory/);
      }
    });

    it('returns {available:false, reason:"no-transcript"} when the dir holds no main-session transcript', () => {
      writeTranscript('agent-only.jsonl', [
        assistantLine('claude-opus-4-8', { input_tokens: 1 }),
      ]);
      const result = probeAgentContextSafe({ latest: true, dir });
      expect(result.available).toBe(false);
      if (!result.available) {
        expect(result.reason).toBe('no-transcript');
        expect(result.detail).toMatch(/No main-session transcript/);
      }
    });

    it('returns {available:true, ...AgentContextResult} on a successful probe', () => {
      const p = writeTranscript('ok-safe.jsonl', [
        assistantLine('claude-opus-4-8', { input_tokens: 10 }),
      ]);
      const result = probeAgentContextSafe({ transcript: p });
      expect(result.available).toBe(true);
      if (result.available) {
        expect(result.contextTokens).toBe(10);
        expect(result.model).toBe('claude-opus-4-8');
      }
    });

    it('still throws for an explicit --transcript that is missing (input error, not environmental absence)', () => {
      expect(() => probeAgentContextSafe({ transcript: path.join(dir, 'nope.jsonl') })).toThrow(
        /Cannot read transcript/
      );
    });

    it('still throws for an explicit --transcript with no usage entry (input error)', () => {
      const p = writeTranscript('nousage-safe.jsonl', [
        JSON.stringify({ type: 'user', message: { role: 'user' } }),
      ]);
      expect(() => probeAgentContextSafe({ transcript: p })).toThrow(/No assistant usage/);
    });

    it('still throws for an invalid --limit (input error)', () => {
      const p = writeTranscript('bad-limit.jsonl', [
        assistantLine('claude-opus-4-8', { input_tokens: 10 }),
      ]);
      expect(() => probeAgentContextSafe({ transcript: p, limit: -1 })).toThrow(
        /--limit must be a positive integer/
      );
    });

    it('still throws when neither --transcript nor --latest is provided (input error)', () => {
      expect(() => probeAgentContextSafe({})).toThrow(/--transcript|--latest/);
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

  describe('--latest --runtime codex (design D1/D2/D3/D4)', () => {
    function writeRolloutAt(relativePath: string, lines: string[]): string {
      const full = path.join(dir, 'sessions', relativePath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, lines.join('\n') + '\n', 'utf-8');
      return full;
    }

    function sessionMeta(cwd: string): string {
      return JSON.stringify({ type: 'session_meta', payload: { cwd } });
    }

    it('probeAgentContextSafe discovers and probes the matching rollout, landing on the codex reader', () => {
      const cwd = path.join(dir, 'project');
      writeRolloutAt('2026/07/12/rollout-2026-07-12T09-00-00-aaa.jsonl', [
        sessionMeta(cwd),
        turnContextLine('gpt-5.6-sol'),
        tokenCountLine(1_234, 100_000),
      ]);

      const result = probeAgentContextSafe({
        latest: true,
        runtime: 'codex',
        dir: path.join(dir, 'sessions'),
        cwd,
      });

      expect(result.available).toBe(true);
      if (result.available) {
        expect(result.contextTokens).toBe(1_234);
        expect(result.limit).toBe(100_000);
        expect(result.model).toBe('gpt-5.6-sol');
      }
    });

    it('returns {available:false, reason:"no-transcript"} when no rollout matches', () => {
      const cwd = path.join(dir, 'project');
      const result = probeAgentContextSafe({
        latest: true,
        runtime: 'codex',
        dir: path.join(dir, 'sessions'),
        cwd,
      });
      expect(result.available).toBe(false);
      if (!result.available) {
        expect(result.reason).toBe('no-transcript');
        expect(result.detail).toMatch(/sessions/);
      }
    });

    it('--dir retargets the sessions root that is searched', () => {
      const cwd = path.join(dir, 'project');
      const altRoot = path.join(dir, 'alt-sessions');
      const full = path.join(altRoot, '2026', '07', '12', 'rollout-2026-07-12T09-00-00-aaa.jsonl');
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, [sessionMeta(cwd), tokenCountLine(1, 1_000)].join('\n') + '\n', 'utf-8');

      const result = probeAgentContextSafe({ latest: true, runtime: 'codex', dir: altRoot, cwd });
      expect(result.available).toBe(true);
      if (result.available) expect(result.transcript).toBe(full);
    });

    it('leaves Claude --latest behavior unchanged, with the unavailable detail mentioning the Codex pointer', () => {
      const result = probeAgentContextSafe({ latest: true, dir: path.join(dir, 'missing') });
      expect(result.available).toBe(false);
      if (!result.available) {
        expect(result.detail).toMatch(/--runtime codex/);
      }
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
        remainingTokens: 750_000,
      });
    });

    it('returns undefined on any read error (never throws)', () => {
      expect(tryContextEstimate(path.join(dir, 'missing.jsonl'))).toBeUndefined();
    });
  });

  describe('detectTranscriptKind', () => {
    it('an explicit override wins outright, regardless of filename or content', () => {
      const p = writeTranscript('rollout-2026-01-01T00-00-00-abc.jsonl', [SESSION_META_LINE]);
      expect(detectTranscriptKind(p, 'claude')).toBe('claude');
      expect(detectTranscriptKind(p, 'codex')).toBe('codex');
    });

    it('rejects an invalid --runtime value via probeAgentContext', () => {
      const p = writeTranscript('t.jsonl', [assistantLine('claude-opus-4-8', { input_tokens: 1 })]);
      expect(() => probeAgentContext({ transcript: p, runtime: 'bogus' })).toThrow(
        /--runtime must be "claude" or "codex"/
      );
    });

    it('the rollout-*.jsonl filename convention selects codex with zero content I/O', () => {
      // A nonexistent file still detects codex from the name alone — proves no read happens.
      const p = path.join(dir, 'rollout-2026-01-01T00-00-00-abc.jsonl');
      expect(detectTranscriptKind(p)).toBe('codex');
    });

    it('sniffs a renamed rollout (session_meta first row) as codex', () => {
      const p = writeTranscript('renamed-copy.jsonl', [SESSION_META_LINE, turnContextLine('gpt-5.6-sol')]);
      expect(detectTranscriptKind(p)).toBe('codex');
    });

    it('sniffs the real captured rollout fixture as codex', () => {
      expect(detectTranscriptKind(FIXTURE_ROLLOUT)).toBe('codex');
    });

    it('defaults to claude for a Claude-shaped or unrecognized first line', () => {
      const claudeShaped = writeTranscript('renamed-claude.jsonl', [
        assistantLine('claude-opus-4-8', { input_tokens: 1 }),
      ]);
      expect(detectTranscriptKind(claudeShaped)).toBe('claude');

      const empty = writeTranscript('empty.jsonl', []);
      expect(detectTranscriptKind(empty)).toBe('claude');

      const missing = path.join(dir, 'does-not-exist.jsonl');
      expect(detectTranscriptKind(missing)).toBe('claude');
    });
  });

  describe('computeContextFromRollout', () => {
    it('maps the last token_count event to the result shape', () => {
      const p = writeTranscript('rollout-2026-01-01T00-00-00-abc.jsonl', [
        SESSION_META_LINE,
        turnContextLine('gpt-5.6-sol'),
        tokenCountLine(12_885, 353_400),
      ]);
      const r = computeContextFromRollout(p);
      expect(r.contextTokens).toBe(12_885);
      expect(r.limit).toBe(353_400);
      expect(r.model).toBe('gpt-5.6-sol');
      expect(r.pct).toBeCloseTo(12_885 / 353_400, 6);
      expect(r.remainingTokens).toBe(353_400 - 12_885);
      expect(r.transcript).toBe(p);
    });

    it('uses the LAST token_count event and the LAST turn_context model (last wins)', () => {
      const p = writeTranscript('rollout-2026-01-01T00-00-01-abc.jsonl', [
        SESSION_META_LINE,
        turnContextLine('gpt-5-earlier'),
        tokenCountLine(100, 1_000),
        turnContextLine('gpt-5.6-sol'),
        tokenCountLine(500, 1_000),
      ]);
      const r = computeContextFromRollout(p);
      expect(r.contextTokens).toBe(500);
      expect(r.model).toBe('gpt-5.6-sol');
    });

    it('honors an explicit limit override and recomputes pct', () => {
      const p = writeTranscript('rollout-2026-01-01T00-00-02-abc.jsonl', [
        SESSION_META_LINE,
        tokenCountLine(500_000, 353_400),
      ]);
      const r = computeContextFromRollout(p, { limit: 1_000_000 });
      expect(r.limit).toBe(1_000_000);
      expect(r.pct).toBe(0.5);
    });

    it('a zero-turn rollout (no token_count yet) is SUCCESS with zero occupancy', () => {
      const p = writeTranscript('rollout-2026-01-01T00-00-03-abc.jsonl', [
        SESSION_META_LINE,
        turnContextLine('gpt-5.6-sol'),
      ]);
      const r = computeContextFromRollout(p);
      expect(r.contextTokens).toBe(0);
      expect(r.pct).toBe(0);
      expect(r.limit).toBe(0);
      expect(r.model).toBe('gpt-5.6-sol');
      // Honest zero — no window was ever reported, so remainingTokens is not fabricated.
      expect(r.remainingTokens).toBe(0);
    });

    it('an explicit --limit still applies on a zero-turn rollout', () => {
      const p = writeTranscript('rollout-2026-01-01T00-00-04-abc.jsonl', [SESSION_META_LINE]);
      const r = computeContextFromRollout(p, { limit: 1_000_000 });
      expect(r.limit).toBe(1_000_000);
      expect(r.pct).toBe(0);
      expect(r.remainingTokens).toBe(1_000_000);
    });

    it('falls back to unknown when no turn_context row carries a model', () => {
      const p = writeTranscript('rollout-2026-01-01T00-00-05-abc.jsonl', [
        SESSION_META_LINE,
        tokenCountLine(10, 1_000),
      ]);
      expect(computeContextFromRollout(p).model).toBe('unknown');
    });

    it('throws an actionable error on an unreadable rollout', () => {
      expect(() => computeContextFromRollout(path.join(dir, 'rollout-nope.jsonl'))).toThrow(
        /Cannot read Codex rollout/
      );
    });

    it('reads the real captured rollout fixture end to end', () => {
      const r = computeContextFromRollout(FIXTURE_ROLLOUT);
      expect(r.contextTokens).toBe(12_885);
      expect(r.limit).toBe(353_400);
      expect(r.model).toBe('gpt-5.6-sol');
    });
  });

  describe('probeAgentContext routes Codex rollouts through detection', () => {
    it('probes a rollout-named file end to end via the CLI-facing entrypoint', () => {
      const p = writeTranscript('rollout-2026-01-01T00-00-06-abc.jsonl', [
        SESSION_META_LINE,
        turnContextLine('gpt-5.6-sol'),
        tokenCountLine(1_000, 353_400),
      ]);
      const r = probeAgentContext({ transcript: p });
      expect(r.contextTokens).toBe(1_000);
      expect(r.limit).toBe(353_400);
      expect(r.model).toBe('gpt-5.6-sol');
    });

    it('a Claude transcript still behaves byte-identically (no regressions from routing)', () => {
      const p = writeTranscript('claude-t.jsonl', [
        assistantLine('claude-opus-4-8', {
          input_tokens: 100,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 50,
        }),
      ]);
      const r = probeAgentContext({ transcript: p });
      expect(r.contextTokens).toBe(350);
      expect(r.model).toBe('claude-opus-4-8');
      expect(r.limit).toBe(1_000_000);
    });

    it('--runtime codex forces a rollout read even on a non-conforming filename', () => {
      const p = writeTranscript('renamed-copy-2.jsonl', [
        SESSION_META_LINE,
        tokenCountLine(1_000, 353_400),
      ]);
      const r = probeAgentContext({ transcript: p, runtime: 'codex' });
      expect(r.contextTokens).toBe(1_000);
    });
  });

  describe('tryContextEstimate routes Codex rollouts through detection', () => {
    it('returns the estimate for a rollout-named file', () => {
      const p = writeTranscript('rollout-2026-01-01T00-00-07-abc.jsonl', [
        SESSION_META_LINE,
        tokenCountLine(1_000, 353_400),
      ]);
      const estimate = tryContextEstimate(p);
      expect(estimate?.contextTokens).toBe(1_000);
      expect(estimate?.limit).toBe(353_400);
      expect(estimate?.pct).toBeCloseTo(1_000 / 353_400, 6);
    });

    it('returns undefined on an unreadable rollout-named path (never throws)', () => {
      expect(tryContextEstimate(path.join(dir, 'rollout-missing-abc.jsonl'))).toBeUndefined();
    });
  });
});

describe('resolveHandoffThresholdReport', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-agentctx-threshold-'));
    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = tempDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeProjectConfig(projectRoot: string, content: string): void {
    const dir2 = path.join(projectRoot, 'rasen');
    fs.mkdirSync(dir2, { recursive: true });
    fs.writeFileSync(path.join(dir2, 'config.yaml'), content);
  }

  it('reports the default threshold outside a project with no global config', async () => {
    const { resolveHandoffThresholdReport } = await import('../../src/core/agent-context.js');
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-agentctx-outside-'));

    const result = resolveHandoffThresholdReport(0.3, 700_000, outsideDir);

    expect(result).toEqual({ threshold: 0.5, thresholdSource: 'default', shouldHandoff: false });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it('reports shouldHandoff true when occupancy meets a project threshold', async () => {
    const { resolveHandoffThresholdReport } = await import('../../src/core/agent-context.js');
    const projectRoot = path.join(tempDir, 'project');
    writeProjectConfig(projectRoot, 'schema: spec-driven\nhandoff:\n  threshold: 0.6\n');

    const result = resolveHandoffThresholdReport(0.62, 380_000, projectRoot);

    expect(result).toEqual({ threshold: 0.6, thresholdSource: 'project', shouldHandoff: true });
  });

  it('falls back to global config when no project threshold is set', async () => {
    const { saveGlobalConfig } = await import('../../src/core/global-config.js');
    saveGlobalConfig({ handoff: { threshold: 0.65 } } as never);

    const { resolveHandoffThresholdReport } = await import('../../src/core/agent-context.js');
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-agentctx-global-'));

    const result = resolveHandoffThresholdReport(0.5, 500_000, outsideDir);

    expect(result).toEqual({ threshold: 0.65, thresholdSource: 'global', shouldHandoff: false });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it('compares remainingTokens (not pct) against an absolute { remainingTokens } threshold', async () => {
    const { saveGlobalConfig } = await import('../../src/core/global-config.js');
    saveGlobalConfig({ handoff: { threshold: { remainingTokens: 60_000 } } } as never);

    const { resolveHandoffThresholdReport } = await import('../../src/core/agent-context.js');
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-agentctx-global-abs-'));

    // Low pct but remainingTokens under the floor: should still fire.
    const result = resolveHandoffThresholdReport(0.1, 50_000, outsideDir);

    expect(result).toEqual({
      threshold: { remainingTokens: 60_000 },
      thresholdSource: 'global',
      shouldHandoff: true,
    });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });
});
