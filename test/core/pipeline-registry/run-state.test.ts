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
  stagesLackingDurableHandle,
  detectDuplicateKeys,
  latestStageHandoffs,
  sessionHandoffGeneration,
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

    // autopilot-gate-policy: the resolved gate policy recorded at run start,
    // plus a per-stage gateDecision left when a gate was auto-approved rather
    // than confirmed by a human.
    it('parses a recorded gatePolicy and a stage gateDecision', () => {
      const s = parseRunState(
        JSON.stringify({
          pipeline: 'small-feature',
          gatePolicy: { effective: 'off', source: 'flag' },
          stages: {
            propose: {
              status: 'done',
              gateDecision: 'auto-approved (--no-gate)',
            },
          },
        })
      );
      expect(s.gatePolicy).toEqual({ effective: 'off', source: 'flag' });
      expect(s.stages?.propose.gateDecision).toBe('auto-approved (--no-gate)');
    });

    it('a run-state with no gatePolicy leaves it undefined (older runs pre-date this field)', () => {
      const s = parseRunState('{"pipeline":"small-feature"}');
      expect(s.gatePolicy).toBeUndefined();
    });

    it('rejects an invalid gatePolicy.effective value', () => {
      expect(() =>
        parseRunState(
          JSON.stringify({ pipeline: 'small-feature', gatePolicy: { effective: 'maybe', source: 'flag' } })
        )
      ).toThrow(RunStateValidationError);
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

  // design D1: host-tolerant parse-boundary normalization for a non-Claude
  // (e.g. Codex) LEAD's legitimate write variance.
  describe('parseRunState host-tolerant normalization (design D1)', () => {
    it('parses a Codex-LEAD-written worker record (transcript: null, non-enum runtime)', () => {
      const s = parseRunState(
        JSON.stringify({
          pipeline: 'small-feature',
          stages: {
            apply: {
              status: 'done',
              worker: { transcript: null, runtime: 'codex-host-fallback', agentId: 'a1' },
            },
          },
        })
      );
      const worker = s.stages?.apply.worker as Record<string, unknown>;
      expect(worker.transcript).toBeUndefined();
      expect(worker.runtime).toBeUndefined();
      expect(worker.runtimeRaw).toBe('codex-host-fallback');
      expect(worker.agentId).toBe('a1');
    });

    it('parses byte-identical for a canonical record (no runtimeRaw, no removed fields)', () => {
      const input = {
        pipeline: 'small-feature',
        stages: {
          apply: { status: 'done', worker: { transcript: 't.jsonl', runtime: 'codex', agentId: 'a1' } },
        },
      };
      const s = parseRunState(JSON.stringify(input));
      const worker = s.stages?.apply.worker as Record<string, unknown>;
      expect(worker).toEqual({ transcript: 't.jsonl', runtime: 'codex', agentId: 'a1' });
      expect(worker.runtimeRaw).toBeUndefined();
    });

    it('leaves a bare-string worker untouched', () => {
      const s = parseRunState(
        JSON.stringify({ pipeline: 'small-feature', stages: { propose: { status: 'done', worker: 'planner-1' } } })
      );
      expect(s.stages?.propose.worker).toBe('planner-1');
    });

    it('strips null on other nullable-optional string fields (threadId, role, etc.)', () => {
      const s = parseRunState(
        JSON.stringify({
          pipeline: 'small-feature',
          stages: {
            review: {
              status: 'done',
              worker: { role: null, threadId: null, model: null, agentId: 'a2' },
            },
          },
        })
      );
      const worker = s.stages?.review.worker as Record<string, unknown>;
      expect(worker.role).toBeUndefined();
      expect(worker.threadId).toBeUndefined();
      expect(worker.model).toBeUndefined();
      expect(worker.agentId).toBe('a2');
    });

    // Review finding (Major): runtime: null is the same "field known, value
    // unknown" statement as null on any other nullable field — must be
    // stripped (treated as absent) like the rest, not routed to runtimeRaw
    // (there is no raw string value to preserve) and never left to reach
    // z.enum(...).optional(), which rejects null.
    it('strips runtime: null (treated as absent, no runtimeRaw)', () => {
      const s = parseRunState(
        JSON.stringify({
          pipeline: 'small-feature',
          stages: {
            apply: { status: 'done', worker: { runtime: null, agentId: 'a3' } },
          },
        })
      );
      const worker = s.stages?.apply.worker as Record<string, unknown>;
      expect(worker.runtime).toBeUndefined();
      expect(worker.runtimeRaw).toBeUndefined();
      expect(worker.agentId).toBe('a3');
    });

    it('strips runtime: null combined with other null fields (transcript, threadId)', () => {
      const s = parseRunState(
        JSON.stringify({
          pipeline: 'small-feature',
          stages: {
            apply: {
              status: 'done',
              worker: { runtime: null, transcript: null, threadId: null, agentId: 'a4' },
            },
          },
        })
      );
      const worker = s.stages?.apply.worker as Record<string, unknown>;
      expect(worker.runtime).toBeUndefined();
      expect(worker.runtimeRaw).toBeUndefined();
      expect(worker.transcript).toBeUndefined();
      expect(worker.threadId).toBeUndefined();
      expect(worker.agentId).toBe('a4');
    });
  });

  describe('writeRunState still rejects non-canonical values (design D1)', () => {
    it('rejects transcript: null', () => {
      expect(() =>
        writeRunState(dir, {
          pipeline: 'small-feature',
          stages: { apply: { status: 'done', worker: { transcript: null as unknown as string } } },
        } as RunState)
      ).toThrow();
    });

    it('rejects a non-enum runtime', () => {
      expect(() =>
        writeRunState(dir, {
          pipeline: 'small-feature',
          stages: {
            apply: {
              status: 'done',
              worker: { runtime: 'codex-host-fallback' as unknown as 'codex' },
            },
          },
        } as RunState)
      ).toThrow();
    });

    it('rejects runtime: null', () => {
      expect(() =>
        writeRunState(dir, {
          pipeline: 'small-feature',
          stages: {
            apply: { status: 'done', worker: { runtime: null as unknown as 'codex' } },
          },
        } as RunState)
      ).toThrow();
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

    it('accepts a worker with a reusedFrom lineage marker (round-trips)', () => {
      const state: RunState = {
        pipeline: 'small-feature',
        stages: {
          apply: {
            status: 'done',
            worker: {
              role: 'implementer',
              agentId: 'abc',
              transcript: 'agent-abc.jsonl',
              reusedFrom: 'child-1',
            },
          },
        },
      };
      writeRunState(dir, state);
      const back = readRunState(dir);
      expect((back?.stages?.apply.worker as { reusedFrom?: string }).reusedFrom).toBe('child-1');
    });

    it('parses a worker without reusedFrom exactly as before (field absent)', () => {
      const s = parseRunState(
        JSON.stringify({
          pipeline: 'small-feature',
          stages: {
            apply: { status: 'done', worker: { role: 'implementer', agentId: 'abc' } },
          },
        })
      );
      const w = s.stages?.apply.worker as { reusedFrom?: string };
      expect(w.reusedFrom).toBeUndefined();
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

    it('parses a sessionHandoff with a relay generation n', () => {
      const s = parseRunState(
        JSON.stringify({
          pipeline: 'full-feature',
          sessionHandoff: { path: 'handoff/lead-2.md', n: 2, pct: 0.55 },
        })
      );
      expect(s.sessionHandoff?.n).toBe(2);
      expect(sessionHandoffGeneration(s.sessionHandoff!)).toBe(2);
    });

    it('treats a sessionHandoff without n as generation 1', () => {
      const s = parseRunState(
        JSON.stringify({
          pipeline: 'full-feature',
          sessionHandoff: { path: 'handoff/lead-1.md' },
        })
      );
      expect(s.sessionHandoff?.n).toBeUndefined();
      expect(sessionHandoffGeneration(s.sessionHandoff!)).toBe(1);
    });

    it('rejects a non-positive sessionHandoff generation', () => {
      expect(() =>
        parseRunState(
          JSON.stringify({
            pipeline: 'full-feature',
            sessionHandoff: { path: 'handoff/lead-1.md', n: 0 },
          })
        )
      ).toThrow(RunStateValidationError);
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

  describe('loopConfig (goal-loop measure gate)', () => {
    it('preserves a configured timeoutSec through parse (goal-plan -> loopConfig)', () => {
      const s = parseRunState(
        JSON.stringify({
          pipeline: 'small-feature',
          loopConfig: {
            kind: 'goal',
            gate: {
              kind: 'measure',
              command: './lighthouse',
              threshold: 90,
              direction: 'gte',
              timeoutSec: 30,
            },
            maxRounds: 5,
            loopStallLimit: 2,
            workProduct: 'code',
          },
        })
      );
      expect(s.loopConfig?.kind).toBe('goal');
      if (s.loopConfig?.kind === 'goal' && s.loopConfig.gate.kind === 'measure') {
        expect(s.loopConfig.gate.command).toBe('./lighthouse');
        expect(s.loopConfig.gate.threshold).toBe(90);
        // The configured per-task timeout survives the strict nested object
        // (the core of the fix ��� previously Zod stripped it).
        expect(s.loopConfig.gate.timeoutSec).toBe(30);
      }
    });

    it('defaults timeoutSec to 120 when not configured (backward compatible)', () => {
      const s = parseRunState(
        JSON.stringify({
          pipeline: 'small-feature',
          loopConfig: {
            kind: 'goal',
            gate: { kind: 'measure', command: './score', threshold: 80, direction: 'gte' },
            maxRounds: 3,
            loopStallLimit: 2,
            workProduct: 'code',
          },
        })
      );
      if (s.loopConfig?.kind === 'goal' && s.loopConfig.gate.kind === 'measure') {
        expect(s.loopConfig.gate.timeoutSec).toBe(120);
      }
    });

    it('round-trips a configured timeoutSec through write + read', () => {
      const state: RunState = {
        pipeline: 'small-feature',
        loopConfig: {
          kind: 'goal',
          gate: { kind: 'measure', command: './bench', threshold: 1000, direction: 'lte', timeoutSec: 45 },
          maxRounds: 5,
          loopStallLimit: 2,
          workProduct: 'code',
        },
      };
      writeRunState(dir, state);
      const back = readRunState(dir);
      if (back?.loopConfig?.kind === 'goal' && back.loopConfig.gate.kind === 'measure') {
        expect(back.loopConfig.gate.timeoutSec).toBe(45);
      }
    });

    // goal-loop-core covered the measure `gte` + `threshold` path only. These
    // fill the evaluate-gate, `direction: lte`, and `target` stop-condition
    // variants — all deterministic run-state round-trip surfaces.
    it('round-trips an evaluate-gate loopConfig (goal + rubric, narrows on evaluate)', () => {
      const state: RunState = {
        pipeline: 'goal-loop-evaluate',
        loopConfig: {
          kind: 'goal',
          gate: { kind: 'evaluate', goal: 'module error handling satisfies the rubric', rubric: 'no swallowed errors' },
          maxRounds: 3,
          loopStallLimit: 2,
          workProduct: 'code',
        },
      };
      writeRunState(dir, state);
      const back = readRunState(dir);
      expect(back?.loopConfig?.kind).toBe('goal');
      // Narrows correctly on the evaluate gate variant.
      if (back?.loopConfig?.kind === 'goal' && back.loopConfig.gate.kind === 'evaluate') {
        expect(back.loopConfig.gate.goal).toBe('module error handling satisfies the rubric');
        expect(back.loopConfig.gate.rubric).toBe('no swallowed errors');
      } else {
        throw new Error('expected evaluate gate to narrow');
      }
    });

    it('round-trips a measure gate with direction lte (smaller-is-better)', () => {
      const state: RunState = {
        pipeline: 'goal-loop-measure',
        loopConfig: {
          kind: 'goal',
          // lte = smaller is better (latency/memory tuning). goal-loop-core
          // exercised gte only; this covers the lte branch.
          gate: { kind: 'measure', command: './latency', threshold: 50, direction: 'lte' },
          maxRounds: 5,
          loopStallLimit: 2,
          workProduct: 'code',
        },
      };
      writeRunState(dir, state);
      const back = readRunState(dir);
      if (back?.loopConfig?.kind === 'goal' && back.loopConfig.gate.kind === 'measure') {
        expect(back.loopConfig.gate.direction).toBe('lte');
        expect(back.loopConfig.gate.threshold).toBe(50);
      } else {
        throw new Error('expected measure gate to narrow');
      }
    });

    it('round-trips a measure gate with a target (passed-count) stop condition', () => {
      const state: RunState = {
        pipeline: 'goal-loop-measure',
        loopConfig: {
          kind: 'goal',
          // target = passed-count stop condition (vs threshold). goal-loop-core
          // covered threshold only; this covers the target branch.
          gate: { kind: 'measure', command: './tests --json', target: 10, direction: 'gte' },
          maxRounds: 5,
          loopStallLimit: 2,
          workProduct: 'code',
        },
      };
      writeRunState(dir, state);
      const back = readRunState(dir);
      if (back?.loopConfig?.kind === 'goal' && back.loopConfig.gate.kind === 'measure') {
        expect(back.loopConfig.gate.target).toBe(10);
        // threshold is absent (target-driven stop condition).
        expect(back.loopConfig.gate.threshold).toBeUndefined();
      } else {
        throw new Error('expected measure gate to narrow');
      }
    });
  });

  // loopProgress is the best-effort derived cache (authoritative record is
  // goal-run.json). goal-loop-core round-trip-tested loopConfig only; this
  // covers the loopProgress block for both gate kinds + backward compatibility.
  describe('loopProgress (goal-loop round-trip)', () => {
    it('round-trips a measure-gate loopProgress block through write + read', () => {
      const state: RunState = {
        pipeline: 'goal-loop-measure',
        loopProgress: {
          kind: 'goal',
          round: 2,
          lastScore: 78,
          measurePassed: false,
          stallStreak: 1,
          historyRef: 'goal-run.json',
        },
      };
      writeRunState(dir, state);
      const back = readRunState(dir);
      expect(back?.loopProgress).toEqual({
        kind: 'goal',
        round: 2,
        lastScore: 78,
        measurePassed: false,
        stallStreak: 1,
        historyRef: 'goal-run.json',
      });
    });

    it('parses an evaluate-gate loopProgress (evaluateSatisfied instead of measurePassed)', () => {
      const s = parseRunState(
        JSON.stringify({
          pipeline: 'goal-loop-evaluate',
          loopProgress: {
            kind: 'goal',
            round: 1,
            evaluateSatisfied: false,
            stallStreak: 0,
            historyRef: 'goal-run.json',
          },
        })
      );
      expect(s.loopProgress?.kind).toBe('goal');
      expect(s.loopProgress?.round).toBe(1);
      expect(s.loopProgress?.evaluateSatisfied).toBe(false);
      // measurePassed is absent on an evaluate-gate progress record.
      expect(s.loopProgress?.measurePassed).toBeUndefined();
      expect(s.loopProgress?.historyRef).toBe('goal-run.json');
    });

    it('a run-state without loopProgress parses unchanged (backward compatible)', () => {
      const s = parseRunState('{"pipeline":"small-feature","completed":["propose"]}');
      expect(s.loopProgress).toBeUndefined();
      expect(s.loopConfig).toBeUndefined();
      expect(s.completed).toEqual(['propose']);
    });
  });

  // detectDuplicateKeys scans the RAW run-state text (it does not parse) for
  // keys repeated at the same object level — invisible to JSON.parse, which
  // silently collapses them to the last value. Advisory only (never throws,
  // never changes the parsed value). Design D3.
  describe('detectDuplicateKeys (raw-text duplicate-key scanner)', () => {
    it('reports a duplicate key at the top (root) level', () => {
      // Hand-written JSON: two `rounds` keys at the root object.
      const content = '{\n  "pipeline": "bug-fix",\n  "rounds": 1,\n  "rounds": 2\n}';
      expect(detectDuplicateKeys(content)).toContainEqual({ path: '$', key: 'rounds' });
    });

    it('reports a duplicate key nested under stages', () => {
      const content =
        '{\n  "pipeline": "bug-fix",\n  "stages": {\n    "propose": { "status": "done" },\n    "propose": { "status": "done" }\n  }\n}';
      expect(detectDuplicateKeys(content)).toContainEqual({ path: '$.stages', key: 'propose' });
    });

    it('does NOT report the same key at two different object levels', () => {
      // `a` appears at the root AND inside the nested object — not a duplicate.
      const content = '{\n  "a": {\n    "a": 1\n  }\n}';
      expect(detectDuplicateKeys(content)).toEqual([]);
    });

    it('returns [] for clean input', () => {
      const content = JSON.stringify({
        pipeline: 'bug-fix',
        rounds: 1,
        stages: { propose: { status: 'done' }, apply: { status: 'in_progress' } },
      });
      expect(detectDuplicateKeys(content)).toEqual([]);
    });

    it('ignores structural characters inside string literals', () => {
      // The value string carries a colon, braces, and a comma; none of them are
      // structural. `rounds` appears only inside the string — no duplicate.
      const content =
        '{\n  "note": "a: { \\"rounds\\": 9 } and a , comma",\n  "rounds": 1\n}';
      expect(detectDuplicateKeys(content)).toEqual([]);
    });
  });

  // stagesLackingDurableHandle surfaces worker records that carry no durable
  // handle (agentId/transcript/threadId) so they are not silently dropped from
  // the warm-seed set by stageWorkers. Advisory only — never mutates state.
  describe('stagesLackingDurableHandle (worker-handle validation)', () => {
    it('reports a name-only worker and lists name in keys', () => {
      // `name` is a passthrough key (not in the schema) — the exact drift this
      // warning exists to surface.
      const s = parseRunState(
        JSON.stringify({
          pipeline: 'small-feature',
          stages: { apply: { status: 'in_progress', worker: { name: 'implementer' } } },
        })
      );
      expect(stagesLackingDurableHandle(s)).toContainEqual({ stage: 'apply', keys: ['name'] });
    });

    it('reports a role-only structured worker with keys: []', () => {
      const s: RunState = {
        pipeline: 'small-feature',
        stages: { apply: { status: 'in_progress', worker: { role: 'implementer' } } },
      };
      expect(stagesLackingDurableHandle(s)).toContainEqual({ stage: 'apply', keys: [] });
    });

    it('reports a bare-string worker (role label) with keys: []', () => {
      const s: RunState = {
        pipeline: 'small-feature',
        stages: { propose: { status: 'done', worker: 'planner-1' } },
      };
      expect(stagesLackingDurableHandle(s)).toContainEqual({ stage: 'propose', keys: [] });
    });

    it('does NOT report workers carrying a durable handle', () => {
      const s: RunState = {
        pipeline: 'small-feature',
        stages: {
          apply: { status: 'done', worker: { role: 'implementer', agentId: 'imp-7' } },
          verify: { status: 'done', worker: { role: 'reviewer', transcript: 'agent-r.jsonl' } },
          reviewLoop: {
            status: 'done',
            worker: { runtime: 'codex', role: 'reviewer', threadId: 'thread-r1' },
          },
        },
      };
      expect(stagesLackingDurableHandle(s)).toEqual([]);
    });

    it('does NOT report a stage with no worker recorded', () => {
      const s: RunState = {
        pipeline: 'small-feature',
        stages: { apply: { status: 'in_progress' } },
      };
      expect(stagesLackingDurableHandle(s)).toEqual([]);
    });
  });

  // Regression guard: the new validation is layered ON TOP of stageWorkers —
  // stageWorkers' inclusion/drop behavior must not change. A name-only record is
  // still omitted from stageWorkers (so it carries no warm-seed); the fix is
  // that resume now WARNS about that drop instead of leaving it silently useful.
  describe('stageWorkers regression guard (durable-handle inclusion unchanged)', () => {
    it('still surfaces durable-handle workers and still omits name-only records', () => {
      const s = parseRunState(
        JSON.stringify({
          pipeline: 'small-feature',
          stages: {
            // name-only → omitted from stageWorkers, now warned about instead.
            propose: { status: 'done', worker: { name: 'planner' } },
            apply: {
              status: 'done',
              worker: { role: 'implementer', agentId: 'imp-7', transcript: 'agent-imp-7.jsonl' },
            },
            verify: {
              status: 'done',
              worker: { runtime: 'codex', role: 'reviewer', threadId: 'thread-r1' },
            },
            ship: { status: 'pending', worker: 'shipper-1' }, // bare string → omitted
          },
        })
      );
      // Unchanged: only durable-handle workers are surfaced.
      expect(stageWorkers(s)).toEqual({
        apply: { role: 'implementer', agentId: 'imp-7', transcript: 'agent-imp-7.jsonl' },
        verify: { runtime: 'codex', role: 'reviewer', threadId: 'thread-r1' },
      });
      // The omitted name-only propose worker is exactly what resume now warns on.
      expect(stagesLackingDurableHandle(s)).toContainEqual({ stage: 'propose', keys: ['name'] });
    });
  });
});
