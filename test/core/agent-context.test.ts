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
  computeContextFromOmpSession,
  claudeProjectsDir,
  findLatestMainTranscript,
  findLatestOmpSession,
  findLatestRollout,
  resolveTranscriptPath,
  probeAgentContext,
  probeAgentContextSafe,
  tryContextEstimate,
  DEFAULT_CONTEXT_LIMIT,
  AgentContextUnavailableError,
} from '../../src/core/agent-context.js';
import {
  RUNTIME_ADAPTER_IDS,
  SNIFF_FALLBACK_RUNTIME,
} from '../../src/core/runtime-adapters.js';
import {
  SESSION_STORE_LIST,
  detectSessionOwner,
} from '../../src/core/runtimes/session-stores.js';

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

/**
 * Oh My Pi reserves a fixed-width `title` row at file creation; the `pad`
 * field is what lets the title be rewritten in place later. Captured from a
 * real session file under `~/.omp/agent/sessions/`.
 */
const OMP_TITLE_LINE = JSON.stringify({
  type: 'title',
  v: 1,
  title: 'Refactor runtime adapter registry',
  source: 'auto',
  updatedAt: '2026-08-06T04:43:28.560Z',
  pad: ' '.repeat(125),
});
const OMP_SESSION_LINE = JSON.stringify({
  type: 'session',
  version: 3,
  id: '019fd520-9cc1-7000-8f0d-54e210c25bca',
  timestamp: '2026-08-06T03:31:52.129Z',
  cwd: '/Users/example/project',
});
/** One Oh My Pi assistant row: the field names that make the Claude reader report zero. */
const OMP_MESSAGE_LINE = JSON.stringify({
  type: 'message',
  message: { role: 'assistant', usage: { input: 87_848, cacheRead: 0, cacheWrite: 12_000 } },
});
/** A session header row recording an arbitrary cwd — the field the locator confirms. */
function ompSessionLine(cwd: string): string {
  return JSON.stringify({
    type: 'session',
    version: 3,
    id: '019fd520-9cc1-7000-8f0d-54e210c25bca',
    timestamp: '2026-08-06T03:31:52.129Z',
    cwd,
  });
}
/**
 * One Oh My Pi message row carrying the model, plus the `totalTokens` a real
 * row also records. `totalTokens` is included on purpose: it is the trap field
 * (it adds the turn's output), so a reader that used it would fail the
 * arithmetic assertions instead of passing them.
 */
function ompMessageLine(
  model: string,
  usage: { input: number; cacheRead: number; cacheWrite: number; output: number }
): string {
  return JSON.stringify({
    type: 'message',
    message: {
      role: 'assistant',
      model,
      provider: 'anthropic',
      usage: {
        ...usage,
        totalTokens: usage.input + usage.cacheRead + usage.cacheWrite + usage.output,
        cost: { input: 0.00001, output: 0.025, cacheRead: 0.06, cacheWrite: 0.008, total: 0.09 },
        cttl: { ephemeral1h: usage.cacheWrite },
      },
    },
  });
}
/** A `model_change` row — provider-prefixed, as Oh My Pi writes it. */
function ompModelChangeLine(model: string): string {
  return JSON.stringify({
    type: 'model_change',
    id: 'a22658f7',
    parentId: null,
    timestamp: '2026-08-06T03:31:52.272Z',
    model,
    resolvedModelIsFallback: false,
  });
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

  /** An Oh My Pi session file, in the on-disk row order every real one uses. */
  function writeOmpSession(name: string): string {
    return writeTranscript(name, [OMP_TITLE_LINE, OMP_SESSION_LINE, OMP_MESSAGE_LINE]);
  }

  /** One session file inside a bucket: its filename, its header cwd, and rows. */
  interface OmpSessionSpec {
    name: string;
    cwd: string;
    /** Rows after the title/session header. Defaults to one usage-bearing message. */
    rows?: string[];
    /** Explicit mtime, so newest-wins ordering is deterministic rather than raced. */
    mtimeMs?: number;
    /** Write into `<bucket>/<subdir>/` — how Oh My Pi stores SUBAGENT journals. */
    subdir?: string;
  }

  /**
   * An Oh My Pi `sessions/` directory with the given buckets, returning its path.
   * Buckets are named by the caller so a test can put a legacy-named bucket and
   * a current hashed-named one side by side, which is the layout the locator
   * exists for.
   */
  function writeOmpSessionsTree(buckets: Record<string, OmpSessionSpec[]>): string {
    const sessionsDir = path.join(dir, 'omp-sessions');
    for (const [bucket, sessions] of Object.entries(buckets)) {
      for (const session of sessions) {
        const holder = session.subdir
          ? path.join(sessionsDir, bucket, session.subdir)
          : path.join(sessionsDir, bucket);
        fs.mkdirSync(holder, { recursive: true });
        const file = path.join(holder, session.name);
        fs.writeFileSync(
          file,
          [
            OMP_TITLE_LINE,
            ompSessionLine(session.cwd),
            ...(session.rows ?? [OMP_MESSAGE_LINE]),
          ].join('\n') + '\n',
          'utf-8'
        );
        if (session.mtimeMs !== undefined) {
          const when = session.mtimeMs / 1000;
          fs.utimesSync(file, when, when);
        }
      }
    }
    return sessionsDir;
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

  describe('findLatestOmpSession', () => {
    const PROJECT = path.join('/', 'Users', 'example', 'project');
    const OTHER = path.join('/', 'Users', 'example', 'other');

    /**
     * Reproduces the live finding this locator exists for: one working directory
     * with sessions under two bucket layouts at once, the NEWER one sitting in
     * the legacy home-relative bucket rather than the current hashed one. A
     * locator that derived a single bucket name from the cwd would read the
     * hashed bucket and report the older session as the live one.
     */
    it('returns the newest session for the cwd even when a legacy bucket holds it', () => {
      const sessions = writeOmpSessionsTree({
        'home-project-0a97387b3087316e0000000000000000': [
          { name: '2026-08-05T07-01-52-329Z_old.jsonl', cwd: PROJECT, mtimeMs: 1_000_000 },
        ],
        '-Users-example-project': [
          { name: '2026-08-06T10-37-00-000Z_new.jsonl', cwd: PROJECT, mtimeMs: 2_000_000 },
        ],
      });
      expect(findLatestOmpSession(sessions, PROJECT)).toBe(
        path.join(sessions, '-Users-example-project', '2026-08-06T10-37-00-000Z_new.jsonl')
      );
    });

    it('rejects a bucket whose header records another cwd, however its name reads', () => {
      // The bucket NAME says this repository; the header says otherwise, and the
      // header is what Oh My Pi itself trusts when it splits colliding legacy
      // buckets. A name-derived locator would return this file.
      const sessions = writeOmpSessionsTree({
        '-Users-example-project': [
          { name: '2026-08-06T11-00-00-000Z_foreign.jsonl', cwd: OTHER, mtimeMs: 3_000_000 },
        ],
        'home-project-abc': [
          { name: '2026-08-06T09-00-00-000Z_ours.jsonl', cwd: PROJECT, mtimeMs: 1_000_000 },
        ],
      });
      expect(findLatestOmpSession(sessions, PROJECT)).toBe(
        path.join(sessions, 'home-project-abc', '2026-08-06T09-00-00-000Z_ours.jsonl')
      );
    });

    it('does not privilege a bucket named by the current hashing scheme', () => {
      // Ordering is by mtime across every layout. A locator that special-cased
      // the derived name — or merely preferred it on a tie — would return the
      // hashed bucket's older file here.
      const sessions = writeOmpSessionsTree({
        'home-project-0a97387b3087316e0000000000000000': [
          { name: 'hashed-older.jsonl', cwd: PROJECT, mtimeMs: 1_000_000 },
        ],
        '-tmp-project': [{ name: 'temp-newer.jsonl', cwd: PROJECT, mtimeMs: 5_000_000 }],
        '--Users-example-project--': [
          { name: 'absolute-middle.jsonl', cwd: PROJECT, mtimeMs: 3_000_000 },
        ],
      });
      expect(findLatestOmpSession(sessions, PROJECT)).toBe(
        path.join(sessions, '-tmp-project', 'temp-newer.jsonl')
      );
    });

    it('finds our older session when a mixed bucket holds a newer foreign one', () => {
      // Oh My Pi splits colliding legacy buckets by header cwd, so one bucket
      // CAN hold two directories' sessions. Taking each bucket's newest file
      // before confirming the cwd would miss ours entirely.
      const sessions = writeOmpSessionsTree({
        '-Users-example-project': [
          { name: 'mixed-foreign-newer.jsonl', cwd: OTHER, mtimeMs: 4_000_000 },
          { name: 'mixed-ours-older.jsonl', cwd: PROJECT, mtimeMs: 2_000_000 },
        ],
      });
      expect(findLatestOmpSession(sessions, PROJECT)).toBe(
        path.join(sessions, '-Users-example-project', 'mixed-ours-older.jsonl')
      );
    });

    it('never returns a subagent journal, which records the LEAD cwd and header', () => {
      // Oh My Pi writes each subagent's journal to
      // `<bucket>/<lead session basename>/<AgentName>.jsonl`, with the same cwd
      // and the same title/session rows as its LEAD — indistinguishable by
      // content, so only depth separates them. This is the Oh My Pi analog of
      // excluding Claude's `agent-*.jsonl`.
      const sessions = writeOmpSessionsTree({
        '-Users-example-project': [
          { name: 'lead.jsonl', cwd: PROJECT, mtimeMs: 1_000_000 },
          {
            name: 'ReviewWorker.jsonl',
            cwd: PROJECT,
            mtimeMs: 9_000_000,
            subdir: '2026-08-06T10-37-00-000Z_lead',
          },
        ],
      });
      expect(findLatestOmpSession(sessions, PROJECT)).toBe(
        path.join(sessions, '-Users-example-project', 'lead.jsonl')
      );
    });

    it('skips a candidate whose header cannot be read or parsed', () => {
      const sessions = writeOmpSessionsTree({
        'home-project-abc': [{ name: 'ours.jsonl', cwd: PROJECT, mtimeMs: 1_000_000 }],
      });
      fs.writeFileSync(
        path.join(sessions, 'home-project-abc', 'corrupt.jsonl'),
        '{not json\n{"type":"session"\n',
        'utf-8'
      );
      fs.utimesSync(path.join(sessions, 'home-project-abc', 'corrupt.jsonl'), 9_000, 9_000);
      expect(findLatestOmpSession(sessions, PROJECT)).toBe(
        path.join(sessions, 'home-project-abc', 'ours.jsonl')
      );
    });

    it('compares resolved absolute paths, tolerating a non-normalized probe cwd', () => {
      const sessions = writeOmpSessionsTree({
        'home-project-abc': [{ name: 'ours.jsonl', cwd: PROJECT }],
      });
      const messy = path.join(PROJECT, '..', 'project');
      expect(findLatestOmpSession(sessions, messy)).toBe(
        path.join(sessions, 'home-project-abc', 'ours.jsonl')
      );
    });

    it('throws AgentContextUnavailableError when the sessions root is missing', () => {
      expect(() => findLatestOmpSession(path.join(dir, 'absent'), PROJECT)).toThrow(
        AgentContextUnavailableError
      );
    });

    it('throws AgentContextUnavailableError when no bucket records the cwd', () => {
      const sessions = writeOmpSessionsTree({
        '-Users-example-other': [{ name: 'foreign.jsonl', cwd: OTHER }],
      });
      expect(() => findLatestOmpSession(sessions, PROJECT)).toThrow(AgentContextUnavailableError);
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

    it('reports an Oh My Pi host its OWN session, not another harness store', () => {
      const sessions = writeOmpSessionsTree({
        '-tmp-project': [{ name: '2026-08-07T00-00-00-000Z_live.jsonl', cwd: dir }],
      });
      // A Claude transcript sits in the same suite temp dir; a reading that
      // came from it would report 10 tokens instead of the session's own.
      writeTranscript('foreign.jsonl', [assistantLine('claude-opus-4-8', { input_tokens: 10 })]);
      const result = probeAgentContextSafe({
        latest: true,
        dir: sessions,
        cwd: dir,
        env: { OMPCODE: '1', CLAUDECODE: '1' },
      });
      expect(result.available).toBe(true);
      if (result.available) {
        expect(result.runtime).toBe('omp');
        expect(result.contextTokens).toBe(99_848);
      }
    });

    it('reports the ordinary no-transcript absence when an Oh My Pi host has no session', () => {
      const sessions = path.join(dir, 'omp-sessions-empty');
      fs.mkdirSync(sessions, { recursive: true });
      const result = probeAgentContextSafe({
        latest: true,
        dir: sessions,
        cwd: dir,
        env: { OMPCODE: '1', CLAUDECODE: '1' },
      });
      // The absence path, NOT `unsupported-host`: Oh My Pi has a probe adapter,
      // it simply has no session for this directory yet.
      expect(result).toEqual({
        available: false,
        reason: 'no-transcript',
        detail: expect.stringContaining('No Oh My Pi session found under'),
      });
    });

    it('still refuses an implicit --latest probe on a host with no context-probe adapter', () => {
      const p = writeTranscript('foreign.jsonl', [
        assistantLine('claude-opus-4-8', { input_tokens: 10 }),
      ]);
      expect(fs.existsSync(p)).toBe(true);
      // `zed` is registered with no probe adapter and has no host fingerprint,
      // so the explicit override is the only way to reach the refusal now
      // (design D11 — the contract narrows, it is not deleted).
      const result = probeAgentContextSafe({
        latest: true,
        dir,
        env: { RASEN_AGENT_RUNTIME: 'zed' },
      });
      // Exhaustive: `toEqual` on the whole result rejects an EXTRA fabricated
      // field as well as a missing one, which a list of `not.toHaveProperty`
      // calls against a three-key literal cannot do.
      expect(result).toEqual({
        available: false,
        reason: 'unsupported-host',
        detail: expect.stringContaining('No context probe exists for the detected host runtime "zed"'),
      });
    });

    // Regression: the host gate returns before `probeAgentContext`, which is
    // where `--limit` is validated. Without hoisting that check the gate
    // answers exit-0 `unsupported-host` for a `--limit` typo, telling the
    // user their HOST is the problem — and the docstring's own rule
    // ("invalid --runtime/--limit ... must stay hard errors") is broken on
    // exactly the host this gate exists for.
    it.each([0, -1, 1.5, Number.NaN])(
      'still throws for an invalid --limit (%s) before refusing an unsupported host',
      (limit) => {
        expect(() =>
          probeAgentContextSafe({
            latest: true,
            dir,
            limit,
            env: { RASEN_AGENT_RUNTIME: 'zed' },
          })
        ).toThrow(/--limit must be a positive integer/);
      }
    );

    it('honours an explicit --transcript from a host with no context-probe adapter', () => {
      const p = writeTranscript('explicit-from-zed.jsonl', [
        assistantLine('claude-opus-4-8', { input_tokens: 10 }),
      ]);
      const result = probeAgentContextSafe({
        transcript: p,
        env: { RASEN_AGENT_RUNTIME: 'zed' },
      });
      expect(result.available).toBe(true);
      if (result.available) expect(result.contextTokens).toBe(10);
    });

    it('honours an explicit --runtime from a host with no context-probe adapter', () => {
      writeTranscript('main.jsonl', [assistantLine('claude-opus-4-8', { input_tokens: 7 })]);
      const result = probeAgentContextSafe({
        latest: true,
        runtime: 'claude',
        dir,
        env: { RASEN_AGENT_RUNTIME: 'zed' },
      });
      expect(result.available).toBe(true);
      if (result.available) expect(result.contextTokens).toBe(7);
    });

    // A Codex host is probe-capable, so implicit --latest is NOT gated and
    // keeps resolving through the Claude store exactly as it did before.
    it('leaves probe-capable hosts and an unidentified host resolving as before', () => {
      writeTranscript('main-claude.jsonl', [
        assistantLine('claude-opus-4-8', { input_tokens: 4 }),
      ]);
      for (const env of [{ CLAUDECODE: '1' }, { CODEX_THREAD_ID: 'thread-1' }, {}]) {
        const result = probeAgentContextSafe({ latest: true, dir, env });
        expect(result.available, JSON.stringify(env)).toBe(true);
        if (result.available) expect(result.contextTokens, JSON.stringify(env)).toBe(4);
      }
    });

    it('keeps a Codex host pinned to the fallback store, not its own rollouts', () => {
      // `cli-agent-context` requires a Claude or Codex host's implicit
      // discovery to stay byte-identical, so the host-aware resolution added
      // for Oh My Pi must NOT reach Codex. Both stores hold a session for this
      // cwd here and the assertion is which one answered: routing to Codex's
      // own rollouts is a better answer and a separate change.
      writeTranscript('main-claude.jsonl', [
        assistantLine('claude-opus-4-8', { input_tokens: 4 }),
      ]);
      const result = probeAgentContextSafe({
        latest: true,
        dir,
        env: { CODEX_THREAD_ID: 'thread-1' },
      });
      expect(result.available).toBe(true);
      if (result.available) {
        expect(result.runtime).toBe('claude');
        expect(result.contextTokens).toBe(4);
      }
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

  describe('computeContextFromOmpSession', () => {
    /** The exact figures a live session on this machine recorded. */
    const LIVE = { input: 2, cacheRead: 122_824, cacheWrite: 1_275, output: 263 };
    const LIVE_OCCUPANCY = LIVE.input + LIVE.cacheRead + LIVE.cacheWrite; // 124_101
    const LIVE_TOTAL_TOKENS = LIVE_OCCUPANCY + LIVE.output; // 124_364

    function writeSession(name: string, rows: string[]): string {
      return writeTranscript(name, [OMP_TITLE_LINE, OMP_SESSION_LINE, ...rows]);
    }

    it('sums what was sent to the model, cached input included', () => {
      const p = writeSession('live.jsonl', [ompMessageLine('claude-opus-5', LIVE)]);
      const result = computeContextFromOmpSession(p);
      expect(result).toEqual({
        runtime: 'omp',
        model: 'claude-opus-5',
        contextTokens: LIVE_OCCUPANCY,
        limit: 1_000_000,
        pct: 0.124101,
        remainingTokens: 875_899,
        transcript: p,
      });
    });

    it('does NOT report totalTokens, which adds the turn output', () => {
      // The trap this reader exists to avoid: `totalTokens` is present on every
      // real row and is 263 higher than the occupancy. Using it would overstate
      // occupancy by one turn's output on every reading, making an Oh My Pi
      // session cross the handoff threshold earlier than a Claude session at
      // the same real occupancy.
      const p = writeSession('total-trap.jsonl', [ompMessageLine('claude-opus-5', LIVE)]);
      expect(LIVE_TOTAL_TOKENS).toBe(124_364);
      expect(computeContextFromOmpSession(p).contextTokens).not.toBe(LIVE_TOTAL_TOKENS);
      expect(computeContextFromOmpSession(p).contextTokens).toBe(124_101);
    });

    it('uses the LAST usage-bearing message', () => {
      const p = writeSession('last-wins.jsonl', [
        ompMessageLine('claude-opus-5', { input: 1, cacheRead: 10, cacheWrite: 0, output: 5 }),
        JSON.stringify({ type: 'custom', payload: { note: 'no usage here' } }),
        ompMessageLine('claude-opus-5', LIVE),
      ]);
      expect(computeContextFromOmpSession(p).contextTokens).toBe(LIVE_OCCUPANCY);
    });

    it('skips the fixed-width title row and any malformed line', () => {
      const p = writeSession('malformed.jsonl', [
        '{ not json',
        '',
        ompMessageLine('claude-opus-5', LIVE),
      ]);
      expect(computeContextFromOmpSession(p).contextTokens).toBe(LIVE_OCCUPANCY);
    });

    it('reports an unknown window as unknown rather than substituting a default', () => {
      // Oh My Pi routes to dozens of providers whose real windows span a few
      // thousand tokens to over a million, so `DEFAULT_CONTEXT_LIMIT` would be a
      // confident percentage describing nothing.
      const p = writeSession('unknown-model.jsonl', [
        ompMessageLine('some-vendor/experimental-7b', LIVE),
      ]);
      const result = computeContextFromOmpSession(p);
      expect(result.model).toBe('some-vendor/experimental-7b');
      expect(result.limit).toBe(0);
      expect(result.pct).toBe(0);
      expect(result.remainingTokens).toBe(0);
      expect(result.contextTokens).toBe(LIVE_OCCUPANCY);
      expect(result.limit).not.toBe(DEFAULT_CONTEXT_LIMIT);
    });

    it('resolves a known model to its own preset window', () => {
      const p = writeSession('known-model.jsonl', [ompMessageLine('gpt-5.6-sol', LIVE)]);
      expect(computeContextFromOmpSession(p).limit).toBe(272_000);
    });

    it('honours an explicit limit over both the preset and the unknown fallback', () => {
      const known = writeSession('override-known.jsonl', [ompMessageLine('claude-opus-5', LIVE)]);
      const unknown = writeSession('override-unknown.jsonl', [ompMessageLine('mystery-1', LIVE)]);
      expect(computeContextFromOmpSession(known, { limit: 50_000 }).limit).toBe(50_000);
      expect(computeContextFromOmpSession(unknown, { limit: 50_000 }).limit).toBe(50_000);
    });

    it('falls back to the last model_change when the message carries no model', () => {
      // A `model_change` id is provider-prefixed (`anthropic/claude-opus-5`);
      // preset matching is substring-based, so the window still resolves.
      const p = writeSession('model-change.jsonl', [
        ompModelChangeLine('anthropic/claude-sonnet-4-5'),
        ompModelChangeLine('anthropic/claude-opus-5'),
        OMP_MESSAGE_LINE,
      ]);
      const result = computeContextFromOmpSession(p);
      expect(result.model).toBe('anthropic/claude-opus-5');
      expect(result.limit).toBe(1_000_000);
    });

    it("prefers the measured message's own model over a later model_change", () => {
      // The model that produced the measured usage is the one attached to it; a
      // `model_change` can precede a turn that never completed.
      const p = writeSession('model-precedence.jsonl', [
        ompMessageLine('gpt-5.6-sol', LIVE),
        ompModelChangeLine('anthropic/claude-opus-5'),
      ]);
      expect(computeContextFromOmpSession(p).model).toBe('gpt-5.6-sol');
      expect(computeContextFromOmpSession(p).limit).toBe(272_000);
    });

    it("reports 'unknown' when neither a message model nor a model_change exists", () => {
      const p = writeSession('no-model.jsonl', [OMP_MESSAGE_LINE]);
      expect(computeContextFromOmpSession(p).model).toBe('unknown');
    });

    it('refuses a session with no completed assistant turn, naming the file', () => {
      // Refusal, not a zero: the Codex young-rollout zero is right for a rollout
      // that has not reported `token_count` yet, but an Oh My Pi journal records
      // usage on its first completed turn, so absence means it is not measurable.
      const p = writeSession('no-usage.jsonl', [ompModelChangeLine('anthropic/claude-opus-5')]);
      expect(() => computeContextFromOmpSession(p)).toThrow(/No assistant usage found/);
      expect(() => computeContextFromOmpSession(p)).toThrow(p);
    });

    it('throws an actionable error on an unreadable file', () => {
      expect(() => computeContextFromOmpSession(path.join(dir, 'absent.jsonl'))).toThrow(
        /Cannot read Oh My Pi session/
      );
    });
  });

  describe('detectSessionOwner', () => {
    it('an explicit override wins outright, regardless of filename or content', () => {
      const p = writeTranscript('rollout-2026-01-01T00-00-00-abc.jsonl', [SESSION_META_LINE]);
      expect(detectSessionOwner(p, 'claude')).toBe('claude');
      expect(detectSessionOwner(p, 'codex')).toBe('codex');
    });

    it.each(['zed', 'bogus'])(
      'rejects non-probe runtime %s with the accepted runtimes in the error',
      (runtime) => {
      // `omp` is deliberately absent: it declares `canProbeContext` now, so it
      // is an accepted `--runtime` value and is covered as a positive case below.
      const p = writeTranscript('t.jsonl', [assistantLine('claude-opus-4-8', { input_tokens: 1 })]);
      expect(() => probeAgentContext({ transcript: p, runtime })).toThrow(
        /--runtime must be "claude" or "codex" or "omp"/
      );
      }
    );

    it('the rollout-*.jsonl filename convention selects codex with zero content I/O', () => {
      // A nonexistent file still detects codex from the name alone — proves no read happens.
      const p = path.join(dir, 'rollout-2026-01-01T00-00-00-abc.jsonl');
      expect(detectSessionOwner(p)).toBe('codex');
    });

    it('sniffs a renamed rollout (session_meta first row) as codex', () => {
      const p = writeTranscript('renamed-copy.jsonl', [SESSION_META_LINE, turnContextLine('gpt-5.6-sol')]);
      expect(detectSessionOwner(p)).toBe('codex');
    });

    it('sniffs the real captured rollout fixture as codex', () => {
      expect(detectSessionOwner(FIXTURE_ROLLOUT)).toBe('codex');
    });

    it('claims a Claude transcript for claude', () => {
      const p = writeTranscript('renamed-claude.jsonl', [
        assistantLine('claude-opus-4-8', { input_tokens: 1 }),
      ]);
      expect(detectSessionOwner(p)).toBe('claude');
    });

    it('claims a Zed thread database by path, without reading it', () => {
      // Never written: recognition by extension must not depend on content.
      expect(detectSessionOwner(path.join(dir, 'threads.db'))).toBe('zed');
      expect(detectSessionOwner(path.join(dir, 'archive.sqlite'))).toBe('zed');
    });

    it('claims an Oh My Pi session file despite the shared .jsonl convention', () => {
      expect(detectSessionOwner(writeOmpSession('omp-session.jsonl'))).toBe('omp');
    });

    it('claims an Oh My Pi session file whose title row was never reserved', () => {
      const p = writeTranscript('omp-untitled.jsonl', [OMP_SESSION_LINE]);
      expect(detectSessionOwner(p)).toBe('omp');
    });

    it('resolves an unclaimed target to the declared fallback', () => {
      expect(detectSessionOwner(writeTranscript('unclaimed.jsonl', ['{"nothing":1}']))).toBe(
        SNIFF_FALLBACK_RUNTIME
      );
      expect(detectSessionOwner(writeTranscript('empty.jsonl', []))).toBe(SNIFF_FALLBACK_RUNTIME);
      expect(detectSessionOwner(path.join(dir, 'does-not-exist.jsonl'))).toBe(
        SNIFF_FALLBACK_RUNTIME
      );
      expect(SNIFF_FALLBACK_RUNTIME).toBe('claude');
    });

    it('refuses to read a target that is not a regular file', () => {
      // Recognition is reached for ANY target now that probe and audit share
      // it, including paths no harness wrote. Reading a character device to
      // find "the first line" never returns: `agent audit /dev/zero` hung with
      // no output where it previously failed actionably. A directory covers the
      // same guard on every platform; the device case is POSIX-only.
      const started = Date.now();
      expect(detectSessionOwner(dir)).toBe(SNIFF_FALLBACK_RUNTIME);
      if (process.platform !== 'win32') {
        expect(detectSessionOwner('/dev/zero')).toBe(SNIFF_FALLBACK_RUNTIME);
      }
      expect(Date.now() - started).toBeLessThan(2_000);
    });

    it('consults every registered runtime, so a new store cannot be left out of the pass', () => {
      expect([...SESSION_STORE_LIST].map((store) => store.id).sort()).toEqual(
        [...RUNTIME_ADAPTER_IDS].sort()
      );
    });
  });

  describe('an explicitly named Oh My Pi session', () => {
    it('is read by name rather than refused for want of a reader', () => {
      const p = writeOmpSession('omp-explicit.jsonl');
      const result = probeAgentContext({ transcript: p });
      expect(result.runtime).toBe('omp');
      expect(result.contextTokens).toBe(99_848); // 87_848 + 0 + 12_000
      expect(result.transcript).toBe(p);
    });

    it('is accepted as an explicit --runtime value', () => {
      const p = writeOmpSession('omp-runtime-flag.jsonl');
      expect(probeAgentContext({ transcript: p, runtime: 'omp' }).runtime).toBe('omp');
    });

    it('names Oh My Pi among what Rasen can probe when a runtime IS unreadable', () => {
      // The refusal contract narrows rather than disappearing: `zed` is still
      // registered with no context reader, and its advice must now list `omp`.
      const p = path.join(dir, 'threads.db');
      fs.writeFileSync(p, '', 'utf-8');
      expect(() => probeAgentContext({ transcript: p })).toThrow(
        /No context reader exists for the recognized session runtime "zed"/
      );
      expect(() => probeAgentContext({ transcript: p })).toThrow(/claude and codex and omp/);
    });

    it('yields an estimate from the opportunistic path instead of absence', () => {
      const p = writeOmpSession('omp-estimate.jsonl');
      expect(tryContextEstimate(p)).toEqual({
        contextTokens: 99_848,
        // No model on the row and no `model_change`, so the window is honestly
        // unknown — an estimate with no fraction, never a fabricated 200k.
        limit: 0,
        pct: 0,
        remainingTokens: 0,
      });
    });

    it('still reports absence for a harness that genuinely has no reader', () => {
      const p = path.join(dir, 'threads.sqlite');
      fs.writeFileSync(p, '', 'utf-8');
      expect(tryContextEstimate(p)).toBeUndefined();
    });

    it('still measures a Claude transcript that merely lives beside one', () => {
      writeOmpSession('omp-neighbour.jsonl');
      const claude = writeTranscript('real-claude.jsonl', [
        assistantLine('claude-opus-4-8', { input_tokens: 250_000 }),
      ]);
      expect(probeAgentContext({ transcript: claude }).contextTokens).toBe(250_000);
    });
  });

  describe('computeContextFromRollout', () => {
    it('maps current context rather than cumulative spend to the result shape', () => {
      const p = writeTranscript('rollout-2026-01-01T00-00-00-abc.jsonl', [
        SESSION_META_LINE,
        turnContextLine('gpt-5.6-sol'),
        tokenCountLine(164_620_250, 258_400, 40_556),
      ]);
      const r = computeContextFromRollout(p);
      expect(r.contextTokens).toBe(40_556);
      expect(r.limit).toBe(258_400);
      expect(r.model).toBe('gpt-5.6-sol');
      expect(r.pct).toBeCloseTo(40_556 / 258_400, 6);
      expect(r.remainingTokens).toBe(258_400 - 40_556);
      expect(r.transcript).toBe(p);
    });

    it('uses the last valid token_count snapshot and the last turn_context model', () => {
      const p = writeTranscript('rollout-2026-01-01T00-00-01-abc.jsonl', [
        SESSION_META_LINE,
        turnContextLine('gpt-5-earlier'),
        tokenCountLine(400, 1_000, 100),
        turnContextLine('gpt-5.6-sol'),
        tokenCountLine(900, 2_000, 500),
        'not json',
        JSON.stringify({
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              total_token_usage: { total_tokens: 1_100 },
              last_token_usage: {},
              model_context_window: 3_000,
            },
          },
        }),
      ]);
      const r = computeContextFromRollout(p);
      expect(r.contextTokens).toBe(500);
      expect(r.limit).toBe(2_000);
      expect(r.model).toBe('gpt-5.6-sol');
    });

    it('honors an explicit limit override and recomputes pct', () => {
      const p = writeTranscript('rollout-2026-01-01T00-00-02-abc.jsonl', [
        SESSION_META_LINE,
        tokenCountLine(1_500_000, 353_400, 500_000),
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

    it('fails actionably when token counts exist without current-context usage', () => {
      const p = writeTranscript('rollout-2026-01-01T00-00-legacy.jsonl', [
        SESSION_META_LINE,
        JSON.stringify({
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              total_token_usage: { total_tokens: 12_885 },
              model_context_window: 353_400,
            },
          },
        }),
      ]);

      expect(() => computeContextFromRollout(p)).toThrow(
        /current-context.*last_token_usage\.total_tokens/i
      );
      expect(tryContextEstimate(p)).toBeUndefined();
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

    const result = await resolveHandoffThresholdReport(0.3, 700_000, outsideDir);

    expect(result).toEqual({ threshold: 0.5, thresholdSource: 'default', shouldHandoff: false });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it('uses the looser codex default threshold (0.85) for a codex runtime', async () => {
    const { resolveHandoffThresholdReport } = await import('../../src/core/agent-context.js');
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-agentctx-codex-default-'));

    // 0.8 occupancy hands off under claude's 0.5 default but NOT under codex's
    // 0.85 default — codex has a larger window and low-loss auto-compact, so a
    // worker can keep working past where claude would retire.
    const result = await resolveHandoffThresholdReport(0.8, 40_000, 'codex', outsideDir);

    expect(result).toEqual({ threshold: 0.85, thresholdSource: 'default', shouldHandoff: false });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it('reports shouldHandoff true when occupancy meets a project threshold', async () => {
    const { resolveHandoffThresholdReport } = await import('../../src/core/agent-context.js');
    const projectRoot = path.join(tempDir, 'project');
    writeProjectConfig(projectRoot, 'schema: spec-driven\nhandoff:\n  threshold: 0.6\n');

    const result = await resolveHandoffThresholdReport(0.62, 380_000, projectRoot);

    expect(result).toEqual({ threshold: 0.6, thresholdSource: 'project', shouldHandoff: true });
  });

  it('falls back to global config when no project threshold is set', async () => {
    const { saveGlobalConfig } = await import('../../src/core/global-config.js');
    saveGlobalConfig({ handoff: { threshold: 0.65 } } as never);

    const { resolveHandoffThresholdReport } = await import('../../src/core/agent-context.js');
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-agentctx-global-'));

    const result = await resolveHandoffThresholdReport(0.5, 500_000, outsideDir);

    expect(result).toEqual({ threshold: 0.65, thresholdSource: 'global', shouldHandoff: false });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it('compares remainingTokens (not pct) against an absolute { remainingTokens } threshold', async () => {
    const { saveGlobalConfig } = await import('../../src/core/global-config.js');
    saveGlobalConfig({ handoff: { threshold: { remainingTokens: 60_000 } } } as never);

    const { resolveHandoffThresholdReport } = await import('../../src/core/agent-context.js');
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-agentctx-global-abs-'));

    // Low pct but remainingTokens under the floor: should still fire.
    const result = await resolveHandoffThresholdReport(0.1, 50_000, outsideDir);

    expect(result).toEqual({
      threshold: { remainingTokens: 60_000 },
      thresholdSource: 'global',
      shouldHandoff: true,
    });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it('reports the inherited store threshold when the project sets none', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-agentctx-store-data-'));
    process.env.XDG_DATA_HOME = dataDir;
    const { registerStore, getGlobalDataDir } = await import('../../src/core/index.js');
    // Register into the SAME machine data dir the production probe reads
    // (resolveConfigStoreLayer -> listRegisteredStores() with no pathOptions).
    const globalDataDir = getGlobalDataDir();

    // A registered store declaring a handoff threshold.
    const storeRoot = path.join(tempDir, 'ctx-store');
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'specs'), { recursive: true });
    fs.writeFileSync(
      path.join(storeRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\nhandoff:\n  threshold: 0.7\n'
    );
    await registerStore({ id: 'ctx-store', localPath: storeRoot, globalDataDir });

    // A member project with local planning + `store:` pointer, no own threshold.
    const projectRoot = path.join(tempDir, 'ctx-member');
    fs.mkdirSync(path.join(projectRoot, 'rasen', 'specs'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\nstore: ctx-store\n'
    );

    const { resolveHandoffThresholdReport } = await import('../../src/core/agent-context.js');
    const result = await resolveHandoffThresholdReport(0.72, 100_000, projectRoot);

    expect(result).toEqual({ threshold: 0.7, thresholdSource: 'store', shouldHandoff: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});
