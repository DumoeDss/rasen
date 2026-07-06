import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  parseRunState,
  readRunState,
  writeRunState,
  completedStages,
  normalizeWorker,
  stageWorkers,
  stagesWithStatus,
  latestStageHandoffs,
  runStatePath,
  RunStateValidationError,
  RUN_STATE_FILENAME,
  type RunState,
} from '../../../src/core/pipeline-registry/run-state.js';

describe('pipeline run-state', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-runstate-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('parseRunState', () => {
    it('parses a minimal state ({ pipeline })', () => {
      const s = parseRunState('{"pipeline":"full-feature"}');
      expect(s.pipeline).toBe('full-feature');
    });

    it('parses a rich state with stages, tier, rounds', () => {
      const s = parseRunState(
        JSON.stringify({
          pipeline: 'small-feature',
          classification: 'small-feature',
          tier: 'A',
          stages: { propose: { status: 'done', worker: 'planner-1' }, apply: { status: 'in_progress' } },
          rounds: 1,
        })
      );
      expect(s.tier).toBe('A');
      expect(s.stages?.propose.status).toBe('done');
    });

    it('keeps unknown passthrough fields', () => {
      const s = parseRunState('{"pipeline":"bug-fix","customNote":"x"}') as RunState & { customNote?: string };
      expect(s.customNote).toBe('x');
    });

    it('throws on malformed JSON', () => {
      expect(() => parseRunState('{ not json }')).toThrow();
    });

    it('throws RunStateValidationError on schema mismatch (missing pipeline)', () => {
      expect(() => parseRunState('{"completed":["propose"]}')).toThrow(RunStateValidationError);
    });

    it('throws on an invalid stage status', () => {
      expect(() =>
        parseRunState('{"pipeline":"bug-fix","stages":{"propose":{"status":"nope"}}}')
      ).toThrow(RunStateValidationError);
    });
  });

  describe('readRunState', () => {
    it('returns null when the file is absent', () => {
      expect(readRunState(dir)).toBeNull();
    });

    it('returns null on malformed content (degrades gracefully)', () => {
      fs.writeFileSync(runStatePath(dir), '{ broken', 'utf-8');
      expect(readRunState(dir)).toBeNull();
    });

    it('reads a valid run-state file', () => {
      fs.writeFileSync(runStatePath(dir), '{"pipeline":"full-feature","completed":["propose"]}', 'utf-8');
      const s = readRunState(dir);
      expect(s?.pipeline).toBe('full-feature');
      expect(s?.completed).toEqual(['propose']);
    });

    it('uses the canonical auto-run.json filename', () => {
      expect(runStatePath(dir).endsWith(RUN_STATE_FILENAME)).toBe(true);
    });
  });

  describe('writeRunState', () => {
    it('round-trips through write + read', () => {
      const state: RunState = { pipeline: 'bug-fix', tier: 'B', completed: ['propose', 'apply'] };
      writeRunState(dir, state);
      const back = readRunState(dir);
      expect(back?.pipeline).toBe('bug-fix');
      expect(back?.completed).toEqual(['propose', 'apply']);
    });

    it('creates the directory if missing', () => {
      const nested = path.join(dir, 'a', 'b');
      writeRunState(nested, { pipeline: 'small-feature' });
      expect(fs.existsSync(runStatePath(nested))).toBe(true);
    });
  });

  describe('completedStages', () => {
    it('derives done|skipped from the stages map', () => {
      const s: RunState = {
        pipeline: 'full-feature',
        stages: {
          propose: { status: 'done' },
          apply: { status: 'skipped' },
          verify: { status: 'in_progress' },
          ship: { status: 'pending' },
        },
      };
      expect(completedStages(s).sort()).toEqual(['apply', 'propose']);
    });

    it('falls back to the completed[] convenience array when stages is absent', () => {
      expect(completedStages({ pipeline: 'bug-fix', completed: ['propose'] })).toEqual(['propose']);
    });

    it('returns [] when neither stages nor completed is present', () => {
      expect(completedStages({ pipeline: 'bug-fix' })).toEqual([]);
    });
  });

  describe('worker (warm-seed pointer)', () => {
    it('accepts a bare-string worker (legacy / role label)', () => {
      const s = parseRunState(
        '{"pipeline":"small-feature","stages":{"propose":{"status":"done","worker":"planner-1"}}}'
      );
      expect(s.stages?.propose.worker).toBe('planner-1');
    });

    it('accepts a structured worker with agentId + transcript', () => {
      const s = parseRunState(
        JSON.stringify({
          pipeline: 'small-feature',
          stages: {
            verify: {
              status: 'done',
              worker: { role: 'reviewer', agentId: 'abc123', transcript: '/p/agent-abc123.jsonl' },
            },
          },
        })
      );
      const w = s.stages?.verify.worker;
      expect(typeof w).toBe('object');
      expect((w as { transcript?: string }).transcript).toBe('/p/agent-abc123.jsonl');
    });

    it('accepts a Codex worker with threadId + turnId', () => {
      const s = parseRunState(
        JSON.stringify({
          pipeline: 'small-feature',
          stages: {
            verify: {
              status: 'done',
              worker: {
                runtime: 'codex',
                role: 'reviewer',
                threadId: 'thread-review-1',
                turnId: 'turn-7',
                sandbox: 'read-only',
              },
            },
          },
        })
      );
      const w = s.stages?.verify.worker;
      expect(typeof w).toBe('object');
      expect((w as { threadId?: string }).threadId).toBe('thread-review-1');
    });

    it('round-trips a structured worker through write + read', () => {
      const state: RunState = {
        pipeline: 'small-feature',
        stages: {
          verify: { status: 'done', worker: { role: 'reviewer', agentId: 'abc', transcript: 'agent-abc.jsonl' } },
        },
      };
      writeRunState(dir, state);
      const back = readRunState(dir);
      expect(back?.stages?.verify.worker).toEqual({
        role: 'reviewer',
        agentId: 'abc',
        transcript: 'agent-abc.jsonl',
      });
    });

    it('normalizeWorker coerces a bare string to { role }', () => {
      expect(normalizeWorker('reviewer')).toEqual({ role: 'reviewer' });
      expect(normalizeWorker(undefined)).toBeUndefined();
      expect(normalizeWorker({ agentId: 'x' })).toEqual({ agentId: 'x' });
    });

    it('stageWorkers returns only stages with a reusable pointer (agentId/transcript/threadId)', () => {
      const s: RunState = {
        pipeline: 'small-feature',
        stages: {
          propose: { status: 'done', worker: 'planner-1' }, // bare string → nothing to seed from
          verify: { status: 'done', worker: { role: 'reviewer', agentId: 'abc', transcript: 'agent-abc.jsonl' } },
          reviewLoop: { status: 'done', worker: { runtime: 'codex', role: 'reviewer', threadId: 'thread-r1' } },
          apply: { status: 'in_progress' }, // no worker
        },
      };
      expect(stageWorkers(s)).toEqual({
        reviewLoop: { runtime: 'codex', role: 'reviewer', threadId: 'thread-r1' },
        verify: { role: 'reviewer', agentId: 'abc', transcript: 'agent-abc.jsonl' },
      });
    });
  });

  describe('stagesWithStatus (P3: surface non-terminal stages)', () => {
    const s: RunState = {
      pipeline: 'small-feature',
      stages: {
        propose: { status: 'done' },
        apply: { status: 'in_progress' },
        verify: { status: 'escalated' },
        review: { status: 'in_progress' },
      },
    };

    it('returns the sorted stage ids in the requested status', () => {
      expect(stagesWithStatus(s, 'in_progress')).toEqual(['apply', 'review']);
      expect(stagesWithStatus(s, 'escalated')).toEqual(['verify']);
      expect(stagesWithStatus(s, 'pending')).toEqual([]);
    });

    it('returns [] when stages is absent (completed[] carries no status)', () => {
      expect(stagesWithStatus({ pipeline: 'bug-fix', completed: ['propose'] }, 'escalated')).toEqual([]);
    });
  });

  describe('handoff records (backward compatible)', () => {
    it('parses a top-level sessionHandoff and per-stage handoffs[]', () => {
      const s = parseRunState(
        JSON.stringify({
          pipeline: 'full-feature',
          sessionHandoff: { path: 'handoff/lead-1.md', pct: 0.52, afterStage: 'apply', at: '2026-01-01T00:00:00Z' },
          stages: {
            apply: {
              status: 'in_progress',
              handoffs: [
                { n: 1, path: 'handoff/implementer-1.md', reason: 'compaction', completed: ['1.1'], remaining: ['1.2'], at: '2026-01-01T00:00:00Z' },
              ],
            },
          },
        })
      );
      expect(s.sessionHandoff?.path).toBe('handoff/lead-1.md');
      expect(s.sessionHandoff?.pct).toBe(0.52);
      expect(s.stages?.apply.handoffs?.[0].path).toBe('handoff/implementer-1.md');
    });

    it('parses a handoff record with only the required path field', () => {
      const s = parseRunState(
        JSON.stringify({
          pipeline: 'bug-fix',
          stages: { apply: { status: 'done', handoffs: [{ path: 'handoff/implementer-2.md' }] } },
        })
      );
      expect(s.stages?.apply.handoffs?.[0].path).toBe('handoff/implementer-2.md');
    });

    it('old run-states without the new fields parse exactly as before', () => {
      const s = parseRunState('{"pipeline":"bug-fix","stages":{"apply":{"status":"done"}}}');
      expect(s.sessionHandoff).toBeUndefined();
      expect(s.stages?.apply.handoffs).toBeUndefined();
    });

    it('round-trips handoff records through write + read', () => {
      const state: RunState = {
        pipeline: 'full-feature',
        sessionHandoff: { path: 'handoff/lead-1.md', pct: 0.5 },
        stages: { apply: { status: 'in_progress', handoffs: [{ n: 1, path: 'handoff/implementer-1.md' }] } },
      };
      writeRunState(dir, state);
      const back = readRunState(dir);
      expect(back?.sessionHandoff?.path).toBe('handoff/lead-1.md');
      expect(back?.stages?.apply.handoffs?.[0].path).toBe('handoff/implementer-1.md');
    });

    describe('latestStageHandoffs', () => {
      it('returns the highest-n handoff path per stage', () => {
        const s: RunState = {
          pipeline: 'full-feature',
          stages: {
            apply: {
              status: 'in_progress',
              handoffs: [
                { n: 1, path: 'handoff/implementer-1.md' },
                { n: 2, path: 'handoff/implementer-2.md' },
              ],
            },
            review: { status: 'done' }, // no handoffs → omitted
          },
        };
        expect(latestStageHandoffs(s)).toEqual({ apply: 'handoff/implementer-2.md' });
      });

      it('falls back to the last array element when n is absent', () => {
        const s: RunState = {
          pipeline: 'bug-fix',
          stages: {
            apply: {
              status: 'in_progress',
              handoffs: [{ path: 'handoff/a.md' }, { path: 'handoff/b.md' }],
            },
          },
        };
        expect(latestStageHandoffs(s)).toEqual({ apply: 'handoff/b.md' });
      });

      it('returns {} when no stage has handoffs', () => {
        expect(latestStageHandoffs({ pipeline: 'bug-fix', stages: { a: { status: 'done' } } })).toEqual({});
      });
    });
  });
});
