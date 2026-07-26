import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  parsePortfolioState,
  readPortfolioState,
  readPortfolioStateDetailed,
  writePortfolioState,
  portfolioStatePath,
  runnableChildren,
  interruptedChildren,
  escalatedChildren,
  isPortfolioComplete,
  PortfolioStateValidationError,
  PORTFOLIO_STATE_FILENAME,
  type PortfolioState,
} from '../../../src/core/pipeline-registry/portfolio-state.js';

describe('portfolio run-state', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-portfolio-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('parse / read / write', () => {
    it('uses the canonical portfolio-run.json filename', () => {
      expect(portfolioStatePath(dir).endsWith(PORTFOLIO_STATE_FILENAME)).toBe(true);
    });

    it('round-trips through write + read', () => {
      const state: PortfolioState = {
        parent: 'big-feature',
        childPipeline: 'small-feature',
        tier: 'A',
        children: [
          { id: 'big-feature-api', pipeline: 'small-feature', dependsOn: [], status: 'done' },
          { id: 'big-feature-ui', pipeline: 'full-feature', dependsOn: ['big-feature-api'], status: 'pending' },
        ],
      };
      writePortfolioState(dir, state);
      const back = readPortfolioState(dir);
      expect(back?.parent).toBe('big-feature');
      expect(back?.children).toHaveLength(2);
      expect(back?.children[1].pipeline).toBe('full-feature');
      expect(back?.children[1].dependsOn).toEqual(['big-feature-api']);
    });

    it('applies child defaults (dependsOn [], status pending)', () => {
      const s = parsePortfolioState(
        JSON.stringify({ parent: 'p', children: [{ id: 'c1', pipeline: 'small-feature' }] })
      );
      expect(s.children[0].dependsOn).toEqual([]);
      expect(s.children[0].status).toBe('pending');
    });

    it('keeps unknown passthrough fields', () => {
      const s = parsePortfolioState('{"parent":"p","planSummary":"split into 3"}') as PortfolioState & {
        planSummary?: string;
      };
      expect(s.planSummary).toBe('split into 3');
    });

    it('round-trips the run-level persistent planner pointer', () => {
      const state: PortfolioState = {
        parent: 'big-feature',
        planner: { role: 'planner', agentId: 'plan-1', transcript: 'agent-plan-1.jsonl' },
        children: [],
      };
      writePortfolioState(dir, state);
      expect(readPortfolioState(dir)?.planner).toEqual({
        role: 'planner',
        agentId: 'plan-1',
        transcript: 'agent-plan-1.jsonl',
      });
    });

    it('accepts a bare-string planner label and absent planner', () => {
      expect(parsePortfolioState('{"parent":"p","planner":"planner-1"}').planner).toBe('planner-1');
      expect(parsePortfolioState('{"parent":"p"}').planner).toBeUndefined();
    });

    it('readPortfolioState returns null when absent', () => {
      expect(readPortfolioState(dir)).toBeNull();
    });

    it('readPortfolioState returns null on malformed content', () => {
      fs.writeFileSync(portfolioStatePath(dir), '{ broken', 'utf-8');
      expect(readPortfolioState(dir)).toBeNull();
    });

    it('throws on schema mismatch (missing parent)', () => {
      expect(() => parsePortfolioState('{"children":[]}')).toThrow(PortfolioStateValidationError);
    });

    // Previously this threw PortfolioStateValidationError. It no longer does:
    // an unrecognized child status normalizes to non-terminal `unknown` rather
    // than making the whole portfolio unreadable. See the normalization
    // describe block below for the full contract.
    it('does not throw on an unrecognized child status (normalizes instead)', () => {
      const s = parsePortfolioState(
        '{"parent":"p","children":[{"id":"c","pipeline":"x","status":"nope"}]}'
      );
      expect(s.children[0].status).toBe('unknown');
      expect(s.children[0].statusRaw).toBe('nope');
    });
  });

  // The child progress vocabulary and its read tolerance. Ordering matters:
  // tolerance means vocabulary drift degrades to "not done" (safe), never to
  // "portfolio invisible" (unsafe — that is what let a paused parent fall
  // through to a stage-based resume that offered `ship`).
  describe('child progress vocabulary', () => {
    it('accepts `proposed` and counts it unfinished', () => {
      const s = parsePortfolioState(
        JSON.stringify({
          parent: 'p',
          children: [
            { id: 'A', pipeline: 'small-feature', dependsOn: [], status: 'done' },
            { id: 'B', pipeline: 'small-feature', dependsOn: [], status: 'proposed' },
          ],
        })
      );
      expect(s.children[1].status).toBe('proposed');
      expect(isPortfolioComplete(s)).toBe(false);
      // `proposed` is not `pending`: the proposal is done, so it is not a
      // fresh start, and it is not offered as a runnable root.
      expect(runnableChildren(s)).toEqual([]);
    });

    it('preserves an unrecognized status under statusRaw and treats it as unfinished', () => {
      const s = parsePortfolioState(
        JSON.stringify({
          parent: 'p',
          children: [{ id: 'F', pipeline: 'small-feature', dependsOn: [], status: 'propose-done' }],
        })
      );
      expect(s.children[0].status).toBe('unknown');
      expect(s.children[0].statusRaw).toBe('propose-done');
      expect(isPortfolioComplete(s)).toBe(false);
    });

    it('an unrecognized status cannot complete a portfolio whose other children are done', () => {
      const s = parsePortfolioState(
        JSON.stringify({
          parent: 'p',
          children: [
            { id: 'A', pipeline: 'small-feature', dependsOn: [], status: 'done' },
            { id: 'B', pipeline: 'small-feature', dependsOn: [], status: 'skipped' },
            { id: 'C', pipeline: 'small-feature', dependsOn: [], status: 'who-knows' },
          ],
        })
      );
      expect(isPortfolioComplete(s)).toBe(false);
    });

    it('does not disturb a recognized status (no statusRaw on canonical records)', () => {
      const s = parsePortfolioState(
        JSON.stringify({
          parent: 'p',
          children: [{ id: 'A', pipeline: 'small-feature', dependsOn: [], status: 'in_progress' }],
        })
      );
      expect(s.children[0].status).toBe('in_progress');
      expect(s.children[0].statusRaw).toBeUndefined();
    });

    it('does not satisfy a dependent through an unrecognized prerequisite', () => {
      const s = parsePortfolioState(
        JSON.stringify({
          parent: 'p',
          children: [
            { id: 'A', pipeline: 'small-feature', dependsOn: [], status: 'mystery' },
            { id: 'B', pipeline: 'small-feature', dependsOn: ['A'], status: 'pending' },
          ],
        })
      );
      expect(runnableChildren(s)).toEqual([]);
    });
  });

  // readPortfolioStateDetailed: resume needs "present but unreadable" to be
  // distinguishable from "never split", because the lenient reader's null
  // makes the two look identical.
  describe('readPortfolioStateDetailed', () => {
    it('reports absent when no file exists', () => {
      expect(readPortfolioStateDetailed(dir)).toEqual({ kind: 'absent' });
    });

    it('reports ok with the parsed state when the file is readable', () => {
      writePortfolioState(dir, {
        parent: 'p',
        children: [{ id: 'A', pipeline: 'small-feature', dependsOn: [], status: 'pending' }],
      });
      const read = readPortfolioStateDetailed(dir);
      expect(read.kind).toBe('ok');
      if (read.kind === 'ok') expect(read.state.parent).toBe('p');
    });

    it('reports invalid with a reason for malformed JSON', () => {
      fs.writeFileSync(portfolioStatePath(dir), '{ broken', 'utf-8');
      const read = readPortfolioStateDetailed(dir);
      expect(read.kind).toBe('invalid');
      if (read.kind === 'invalid') expect(read.reason.length).toBeGreaterThan(0);
    });

    it('reports invalid with a reason for a schema mismatch', () => {
      fs.writeFileSync(portfolioStatePath(dir), JSON.stringify({ children: [] }), 'utf-8');
      const read = readPortfolioStateDetailed(dir);
      expect(read.kind).toBe('invalid');
      if (read.kind === 'invalid') expect(read.reason).toContain('parent');
    });

    it('leaves readPortfolioState lenient (still null on the same broken file)', () => {
      fs.writeFileSync(portfolioStatePath(dir), '{ broken', 'utf-8');
      expect(readPortfolioState(dir)).toBeNull();
    });
  });

  // design D1: parsePortfolioState reuses normalizeRunStateWorkerRecord for
  // the `planner` field (portfolio-state.ts normalizePortfolioStateJson),
  // since planner shares the worker shape. Review finding (Minor): this was
  // previously unguarded by any dedicated test.
  describe('parsePortfolioState host-tolerant planner normalization (design D1)', () => {
    it('parses a Codex-LEAD-written planner record (transcript: null, non-enum runtime)', () => {
      const s = parsePortfolioState(
        JSON.stringify({
          parent: 'big-feature',
          planner: { transcript: null, runtime: 'codex-host-fallback', agentId: 'plan-1' },
          children: [],
        })
      );
      const planner = s.planner as Record<string, unknown>;
      expect(planner.transcript).toBeUndefined();
      expect(planner.runtime).toBeUndefined();
      expect(planner.runtimeRaw).toBe('codex-host-fallback');
      expect(planner.agentId).toBe('plan-1');
    });

    it('parses byte-identical for a canonical planner record (no runtimeRaw, no removed fields)', () => {
      const input = {
        parent: 'big-feature',
        planner: { transcript: 'agent-plan-1.jsonl', runtime: 'codex', agentId: 'plan-1' },
        children: [],
      };
      const s = parsePortfolioState(JSON.stringify(input));
      const planner = s.planner as Record<string, unknown>;
      expect(planner).toEqual({ transcript: 'agent-plan-1.jsonl', runtime: 'codex', agentId: 'plan-1' });
      expect(planner.runtimeRaw).toBeUndefined();
    });

    it('leaves a bare-string planner label untouched', () => {
      const s = parsePortfolioState(JSON.stringify({ parent: 'p', planner: 'planner-1', children: [] }));
      expect(s.planner).toBe('planner-1');
    });

    // Review finding (Major, transitively Minor #3 for this call site):
    // runtime: null must be stripped (treated as absent), not left to reach
    // AgentRuntimeSchema.optional() (which rejects null) or routed into
    // runtimeRaw (no raw string value to preserve).
    it('strips planner runtime: null (treated as absent, no runtimeRaw) — previously threw', () => {
      const s = parsePortfolioState(
        JSON.stringify({
          parent: 'big-feature',
          planner: { runtime: null, agentId: 'plan-2' },
          children: [],
        })
      );
      const planner = s.planner as Record<string, unknown>;
      expect(planner.runtime).toBeUndefined();
      expect(planner.runtimeRaw).toBeUndefined();
      expect(planner.agentId).toBe('plan-2');
    });

    it('strips planner runtime: null combined with transcript: null', () => {
      const s = parsePortfolioState(
        JSON.stringify({
          parent: 'big-feature',
          planner: { runtime: null, transcript: null, agentId: 'plan-3' },
          children: [],
        })
      );
      const planner = s.planner as Record<string, unknown>;
      expect(planner.runtime).toBeUndefined();
      expect(planner.runtimeRaw).toBeUndefined();
      expect(planner.transcript).toBeUndefined();
      expect(planner.agentId).toBe('plan-3');
    });
  });

  describe('runnableChildren (frontier from the DAG)', () => {
    const chain = (): PortfolioState => ({
      parent: 'p',
      children: [
        { id: 'A', pipeline: 'small-feature', dependsOn: [], status: 'pending' },
        { id: 'B', pipeline: 'small-feature', dependsOn: ['A'], status: 'pending' },
        { id: 'C', pipeline: 'small-feature', dependsOn: ['B'], status: 'pending' },
      ],
    });

    it('starts with only the roots', () => {
      expect(runnableChildren(chain())).toEqual(['A']);
    });

    it('advances along the chain as prerequisites complete', () => {
      const s = chain();
      s.children[0].status = 'done'; // A done
      expect(runnableChildren(s)).toEqual(['B']);
    });

    it('treats skipped prerequisites as satisfied', () => {
      const s = chain();
      s.children[0].status = 'skipped';
      expect(runnableChildren(s)).toEqual(['B']);
    });

    it('returns independent roots together, sorted', () => {
      const s: PortfolioState = {
        parent: 'p',
        children: [
          { id: 'x', pipeline: 'small-feature', dependsOn: [], status: 'pending' },
          { id: 'a', pipeline: 'small-feature', dependsOn: [], status: 'pending' },
        ],
      };
      expect(runnableChildren(s)).toEqual(['a', 'x']);
    });

    it('partial failure stops the dependent chain (escalated prereq blocks dependents)', () => {
      const s = chain();
      s.children[0].status = 'escalated'; // A failed/escalated
      // B is NOT runnable because its prerequisite A is not satisfied
      expect(runnableChildren(s)).toEqual([]);
    });

    it('an in-progress prerequisite does not unblock its dependent', () => {
      const s = chain();
      s.children[0].status = 'in_progress';
      expect(runnableChildren(s)).toEqual([]);
    });
  });

  describe('interruptedChildren / escalatedChildren (P3: never strand)', () => {
    const mixed = (): PortfolioState => ({
      parent: 'p',
      children: [
        { id: 'A', pipeline: 'small-feature', dependsOn: [], status: 'done' },
        { id: 'B', pipeline: 'small-feature', dependsOn: ['A'], status: 'in_progress' },
        { id: 'C', pipeline: 'small-feature', dependsOn: [], status: 'escalated' },
        { id: 'D', pipeline: 'small-feature', dependsOn: [], status: 'pending' },
      ],
    });

    it('surfaces in_progress children separately from the runnable frontier', () => {
      const s = mixed();
      // B (in_progress) is NOT runnable (runnable = pending + deps satisfied)...
      expect(runnableChildren(s)).toEqual(['D']);
      // ...but it is re-offered as interrupted so resume does not strand it.
      expect(interruptedChildren(s)).toEqual(['B']);
    });

    it('surfaces escalated children for human attention', () => {
      expect(escalatedChildren(mixed())).toEqual(['C']);
    });

    it('return [] when there are none', () => {
      const s: PortfolioState = {
        parent: 'p',
        children: [{ id: 'A', pipeline: 'small-feature', dependsOn: [], status: 'done' }],
      };
      expect(interruptedChildren(s)).toEqual([]);
      expect(escalatedChildren(s)).toEqual([]);
    });
  });

  describe('isPortfolioComplete', () => {
    // A portfolio with no children has nothing that finished, so it cannot be
    // complete. `[].every(...)` is vacuously true, which would otherwise report
    // a record written before its children were appended as a finished
    // portfolio — the same "reported done with no evidence" failure this module
    // exists to prevent, reached by a different route.
    it('is false for a record with no children (not vacuously true)', () => {
      expect(isPortfolioComplete({ parent: 'p', children: [] })).toBe(false);
      // Including the schema default, which is where the empty array comes from.
      expect(isPortfolioComplete(parsePortfolioState('{"parent":"p"}'))).toBe(false);
    });

    it('is true only when every child is done or skipped', () => {
      const s: PortfolioState = {
        parent: 'p',
        children: [
          { id: 'A', pipeline: 'small-feature', dependsOn: [], status: 'done' },
          { id: 'B', pipeline: 'small-feature', dependsOn: ['A'], status: 'skipped' },
        ],
      };
      expect(isPortfolioComplete(s)).toBe(true);
      s.children[1].status = 'pending';
      expect(isPortfolioComplete(s)).toBe(false);
    });
  });
});
