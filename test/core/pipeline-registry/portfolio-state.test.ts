import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  parsePortfolioState,
  readPortfolioState,
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

    it('throws on an invalid child status', () => {
      expect(() =>
        parsePortfolioState('{"parent":"p","children":[{"id":"c","pipeline":"x","status":"nope"}]}')
      ).toThrow(PortfolioStateValidationError);
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
