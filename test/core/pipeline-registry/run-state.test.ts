import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  parseRunState,
  readRunState,
  writeRunState,
  completedStages,
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
});
