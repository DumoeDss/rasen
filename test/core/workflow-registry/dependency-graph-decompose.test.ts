import { describe, it, expect, vi } from 'vitest';

// A synthetic pipeline registry so the decompose one-level traversal (design
// D7) can be exercised deterministically, independent of the shipped built-in
// pipeline YAML. `parent-pipe` has a decompose stage pointing at `child-pipe`,
// whose unconditional stage names a skill owned by another catalog unit — so
// that owner must appear in the driver's strong closure ONLY via the decompose
// childPipeline walk.
vi.mock('../../../src/core/pipeline-registry/resolver.js', () => ({
  loadPipelineByName: (name: string) => {
    if (name === 'parent-pipe') {
      return { name, stages: [{ kind: 'decompose', childPipeline: 'child-pipe' }] };
    }
    if (name === 'child-pipe') {
      return {
        name,
        stages: [
          { kind: 'standard', skill: 'child-skill' }, // unconditional → strong
          { kind: 'standard', skill: 'weak-skill', condition: 'security-relevant' }, // gated → weak
        ],
      };
    }
    if (name === 'strong-then-weak') {
      // `mid-skill` is unconditional (→ strong direct); `expert-skill` is gated
      // (→ weak direct) — but `mid`'s owner requires the expert as a workflow,
      // so the expert is in the TRANSITIVE strong closure and must not also be
      // an enhancer (t7).
      return {
        name,
        stages: [
          { kind: 'standard', skill: 'mid-skill' },
          { kind: 'standard', skill: 'expert-skill', condition: 'security-relevant' },
        ],
      };
    }
    throw new Error(`unknown pipeline ${name}`);
  },
  resolveChildPipelineName: (stage: { childPipeline?: string }) => stage.childPipeline ?? 'default',
}));

import {
  computeWorkflowDependencyGraph,
  type WorkflowCatalog,
} from '../../../src/core/workflow-registry/index.js';

interface FakeDef {
  id: string;
  skillName: string;
  pipelines?: string[];
  workflows?: string[];
}

function fakeCatalog(defs: FakeDef[]): WorkflowCatalog {
  const definitions = defs.map((d) => ({
    id: d.id,
    skill: { template: { name: d.skillName }, dirName: d.skillName },
    requires: { workflows: d.workflows ?? [], skills: [], pipelines: d.pipelines ?? [], schemas: [] },
  }));
  const byId = new Map(definitions.map((d) => [d.id, d]));
  return {
    definitions,
    get: (id: string) => byId.get(id),
    has: (id: string) => byId.has(id),
  } as unknown as WorkflowCatalog;
}

describe('computeWorkflowDependencyGraph — decompose childPipeline traversal (design D7)', () => {
  it('walks a decompose stage’s child pipeline: strong owner via child, weak owner via gated child stage', () => {
    const graph = computeWorkflowDependencyGraph(
      fakeCatalog([
        { id: 'driver', skillName: 'driver-skill', pipelines: ['parent-pipe'] },
        { id: 'child-owner', skillName: 'child-skill' },
        { id: 'weak-owner', skillName: 'weak-skill' },
      ])
    );
    const map = new Map(graph.entries.map((e) => [e.id, e]));
    // Reached ONLY through parent-pipe → decompose → child-pipe.
    expect(map.get('driver')!.requires).toContain('child-owner');
    expect(map.get('driver')!.requires).not.toContain('weak-owner');
    // The gated child stage's owner enhances the driver (weak), not requires.
    expect(map.get('weak-owner')!.enhances).toContain('driver');
  });

  it('a unit in the transitive strong closure is not also listed as a weak enhancer (t7)', () => {
    const graph = computeWorkflowDependencyGraph(
      fakeCatalog([
        { id: 'driver', skillName: 'driver-skill', pipelines: ['strong-then-weak'] },
        { id: 'mid', skillName: 'mid-skill', workflows: ['expert'] },
        { id: 'expert', skillName: 'expert-skill' },
      ])
    );
    const map = new Map(graph.entries.map((e) => [e.id, e]));
    // expert is reachable via mid (transitive strong), so it is a hard require…
    expect(map.get('driver')!.requires).toEqual(expect.arrayContaining(['mid', 'expert']));
    // …and therefore NOT also a weak enhancer of driver.
    expect(map.get('expert')!.enhances).not.toContain('driver');
  });
});
