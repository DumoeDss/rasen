import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  computeWorkflowDependencyGraph,
  loadWorkflowCatalog,
  type WorkflowCatalog,
} from '../../../src/core/workflow-registry/index.js';

describe('computeWorkflowDependencyGraph (design D7) — shipped built-ins', () => {
  let tempHome: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // An empty RASEN_HOME keeps user workflows out so the graph reflects only
    // the shipped built-in catalog.
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-depgraph-'));
    originalEnv = { ...process.env };
    process.env.RASEN_HOME = tempHome;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  function entryMap() {
    const graph = computeWorkflowDependencyGraph(loadWorkflowCatalog());
    return new Map(graph.entries.map((e) => [e.id, e]));
  }

  it('the auto driver’s strong closure includes its pipelines’ unconditional stage owners, review among them', () => {
    const entry = entryMap().get('auto-command')!;
    for (const id of [
      'propose',
      'apply',
      'review-cycle',
      'ship-command',
      'archive',
      'retain-command',
      'office-hours-command',
      'review',
    ]) {
      expect(entry.requires).toContain(id);
    }
    // No self-reference.
    expect(entry.requires).not.toContain('auto-command');
    // Each id appears once.
    expect(new Set(entry.requires).size).toBe(entry.requires.length);
  });

  it('the goal driver’s strong closure includes the goal-loop family', () => {
    const entry = entryMap().get('goal-command')!;
    for (const id of ['goal-plan', 'goal-iterate', 'goal-report']) {
      expect(entry.requires).toContain(id);
    }
  });

  it('the enhanced-verify workflow strongly requires its five quality experts', () => {
    const entry = entryMap().get('verify-enhanced-command')!;
    for (const id of ['cso', 'design-review', 'qa', 'qa-only', 'review']) {
      expect(entry.requires).toContain(id);
    }
  });

  it('condition-gated experts enhance the auto driver and are not in its strong closure', () => {
    const map = entryMap();
    const auto = map.get('auto-command')!;
    for (const expert of ['cso', 'benchmark', 'design-review', 'qa', 'qa-only']) {
      expect(map.get(expert)!.enhances).toContain('auto-command');
      expect(auto.requires).not.toContain(expert);
    }
  });

  it('the always-dispatched review expert is strong, never a weak enhancer', () => {
    const review = entryMap().get('review')!;
    // review is the unconditional stage — it enhances nothing weakly.
    expect(review.enhances).toEqual([]);
  });

  it('serves one entry per catalog unit', () => {
    const catalog = loadWorkflowCatalog();
    const graph = computeWorkflowDependencyGraph(catalog);
    expect(graph.entries.map((e) => e.id).sort()).toEqual(
      catalog.definitions.map((d) => d.id).sort()
    );
  });
});

describe('computeWorkflowDependencyGraph — fault tolerance (design D7)', () => {
  interface FakeDef {
    id: string;
    skillName: string;
    workflows?: string[];
    skills?: string[];
    pipelines?: string[];
  }

  function fakeCatalog(defs: FakeDef[]): WorkflowCatalog {
    const definitions = defs.map((d) => ({
      id: d.id,
      skill: { template: { name: d.skillName }, dirName: d.skillName },
      requires: {
        workflows: d.workflows ?? [],
        skills: d.skills ?? [],
        pipelines: d.pipelines ?? [],
        schemas: [],
      },
    }));
    const byId = new Map(definitions.map((d) => [d.id, d]));
    return {
      definitions,
      get: (id: string) => byId.get(id),
      has: (id: string) => byId.has(id),
    } as unknown as WorkflowCatalog;
  }

  it('a missing required pipeline contributes nothing (no error)', () => {
    const graph = computeWorkflowDependencyGraph(
      fakeCatalog([{ id: 'a', skillName: 'a', pipelines: ['no-such-pipeline'] }])
    );
    expect(graph.entries.find((e) => e.id === 'a')!.requires).toEqual([]);
  });

  it('a required skill no unit owns is skipped', () => {
    const graph = computeWorkflowDependencyGraph(
      fakeCatalog([{ id: 'a', skillName: 'a', skills: ['ghost-skill'] }])
    );
    expect(graph.entries.find((e) => e.id === 'a')!.requires).toEqual([]);
  });

  it('a required-workflow cycle is tolerated (no infinite loop, self excluded)', () => {
    const graph = computeWorkflowDependencyGraph(
      fakeCatalog([
        { id: 'a', skillName: 'a', workflows: ['b'] },
        { id: 'b', skillName: 'b', workflows: ['a'] },
      ])
    );
    const map = new Map(graph.entries.map((e) => [e.id, e]));
    expect(map.get('a')!.requires).toEqual(['b']);
    expect(map.get('b')!.requires).toEqual(['a']);
  });

  it('a self-referencing required workflow is dropped', () => {
    const graph = computeWorkflowDependencyGraph(
      fakeCatalog([{ id: 'a', skillName: 'a', workflows: ['a'] }])
    );
    expect(graph.entries.find((e) => e.id === 'a')!.requires).toEqual([]);
  });
});
