/**
 * Unit coverage for the pure draft-mutation module (pipeline-canvas-edit
 * design D2): cycle rejection, delete-with-reference-cleanup, rename
 * rewrites, EVERY-loader-field preservation, and issue-path mapping. No
 * canvas mount, no jsdom — same reasoning as `layout.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  addRequire,
  addStage,
  isDirty,
  issuePathTarget,
  removeRequire,
  removeStage,
  renameStage,
  stageIdFor,
  updateStageFields,
  wouldCreateCycle,
} from '../../src/canvas/draft.js';
import type { WirePipelineDefinition } from '../../src/api/types.js';

function baseDef(): WirePipelineDefinition {
  return {
    name: 'demo',
    description: 'A demo pipeline',
    stages: [
      { id: 'a', kind: 'standard', requires: [], gate: false, leadReview: false },
      { id: 'b', kind: 'standard', requires: ['a'], gate: false, leadReview: false },
      { id: 'c', kind: 'standard', requires: ['b'], gate: false, leadReview: false },
    ],
  };
}

describe('wouldCreateCycle', () => {
  it('rejects a direct cycle (b already requires a; a->b would close it back... a requiring b)', () => {
    const def = baseDef();
    // b requires a. Connecting b -> a (a would require b) closes an immediate loop.
    expect(wouldCreateCycle(def, 'b', 'a')).toBe(true);
  });

  it('rejects a transitive cycle', () => {
    const def = baseDef();
    // c requires b requires a. Connecting c -> a (a would require c) closes a transitive loop.
    expect(wouldCreateCycle(def, 'c', 'a')).toBe(true);
  });

  it('rejects a self-loop', () => {
    const def = baseDef();
    expect(wouldCreateCycle(def, 'a', 'a')).toBe(true);
  });

  it('allows a connection that does not create a cycle', () => {
    const def = baseDef();
    // Connecting a -> c (c would require a) is already implied transitively but not a cycle.
    expect(wouldCreateCycle(def, 'a', 'c')).toBe(false);
  });
});

describe('removeStage', () => {
  it('drops the stage and every requires reference to it', () => {
    const def = baseDef();
    const next = removeStage(def, 'b');
    expect(next.stages.map((s) => s.id)).toEqual(['a', 'c']);
    const c = next.stages.find((s) => s.id === 'c')!;
    expect(c.requires).toEqual([]); // 'b' reference cleaned up, no dangling edge
  });
});

describe('addRequire / removeRequire', () => {
  it('adds a dependency without duplicating an existing one', () => {
    const def = baseDef();
    const once = addRequire(def, 'a', 'c');
    expect(once.stages.find((s) => s.id === 'c')!.requires.sort()).toEqual(['a', 'b']);
    const twice = addRequire(once, 'a', 'c');
    expect(twice.stages.find((s) => s.id === 'c')!.requires.filter((r) => r === 'a')).toHaveLength(1);
  });

  it('removes a dependency', () => {
    const def = baseDef();
    const next = removeRequire(def, 'a', 'b');
    expect(next.stages.find((s) => s.id === 'b')!.requires).toEqual([]);
  });
});

describe('renameStage', () => {
  it('rewrites every requires reference to the renamed stage', () => {
    const def = baseDef();
    const next = renameStage(def, 'a', 'alpha');
    expect(next.stages.map((s) => s.id)).toEqual(['alpha', 'b', 'c']);
    expect(next.stages.find((s) => s.id === 'b')!.requires).toEqual(['alpha']);
  });
});

describe('stageIdFor', () => {
  it('derives an id from the skill and lowercases/collapses it', () => {
    const def: WirePipelineDefinition = { name: 'demo', stages: [] };
    expect(stageIdFor('rasen-Review Cycle!', def)).toBe('rasen-review-cycle');
  });

  it('uniquifies against existing stage ids with a numeric suffix', () => {
    const def = baseDef();
    def.stages.push({ id: 'rasen-review', kind: 'standard', requires: [], gate: false, leadReview: false });
    expect(stageIdFor('rasen-review', def)).toBe('rasen-review-2');
  });

  it('falls back to "stage" when the skill collapses to nothing (all non-alphanumeric)', () => {
    const def: WirePipelineDefinition = { name: 'demo', stages: [] };
    expect(stageIdFor('!!!', def)).toBe('stage');
    expect(stageIdFor('   ', def)).toBe('stage');
  });
});

describe('updateStageFields — EVERY-loader-field preservation', () => {
  it('preserves every unrelated definition field, byte-identical, when only one field is edited', () => {
    const def: WirePipelineDefinition = {
      name: 'full-loader-coverage',
      description: 'Exercises every loader-accepted field',
      agents: {
        planner: 'claude',
        implementer: { runtime: 'codex', sessionReuse: 'run-planner', sandbox: 'workspace-write', model: 'opus-4', effort: 'high' },
      },
      handoff: { threshold: 0.6, roles: { planner: 0.5, reviewer: { remainingTokens: 40000 } }, maxRelays: 3, stallLimit: 2 },
      reuse: { planner: 'auto', implementer: 'never', threshold: 0.4, roles: { planner: 0.3 } },
      origin: 'ui',
      stages: [
        {
          id: 'goal-stage',
          kind: 'standard',
          skill: 'rasen-goal-iterate',
          role: 'implementer',
          requires: [],
          gate: true,
          loop: {
            kind: 'goal',
            gate: { kind: 'measure', command: 'npm test', threshold: 0.9, target: 1, direction: 'gte', timeoutSec: 300 },
            maxRounds: 5,
            loopStallLimit: 2,
            runArtifact: 'goal-run.json',
          },
          parallelGroup: 'checks',
          condition: 'always',
          leadReview: true,
          verifyPolicy: 'adaptive',
          runtime: 'codex',
          sessionReuse: 'review-thread',
          sandbox: 'workspace-write',
          model: 'opus-4',
          effort: 'high',
          handoff: { threshold: 0.7, maxRelays: 1, stallLimit: 1 },
        },
        {
          id: 'review-cycle-stage',
          kind: 'standard',
          skill: 'rasen-review-cycle',
          role: 'fixer',
          requires: ['goal-stage'],
          gate: true,
          loop: { kind: 'review-cycle', maxRounds: 3 },
          leadReview: false,
        },
      ],
    };

    const patched = updateStageFields(def, 'review-cycle-stage', { gate: false });

    // The edited field changed...
    expect(patched.stages[1].gate).toBe(false);
    // ...but everything else — including the untouched first stage carrying
    // every loader field (agents/handoff/reuse/goal-loop/sessionReuse/sandbox/
    // effort) and the pipeline-level agents/handoff/reuse/origin — survives
    // byte-identical in the would-be save body.
    const { stages: patchedStages, ...patchedRest } = patched;
    const { stages: origStages, ...origRest } = def;
    expect(patchedRest).toEqual(origRest);
    expect(patchedStages[0]).toEqual(origStages[0]);
    expect(patchedStages[1]).toEqual({ ...origStages[1], gate: false });
  });
});

describe('isDirty', () => {
  it('is false for a structurally identical draft regardless of key order', () => {
    const def = baseDef();
    const reordered: WirePipelineDefinition = {
      stages: def.stages.map((s) => ({ ...s })),
      description: def.description,
      name: def.name,
    };
    expect(isDirty(reordered, def)).toBe(false);
  });

  it('is true once a field diverges', () => {
    const def = baseDef();
    const changed = updateStageFields(def, 'a', { gate: true });
    expect(isDirty(changed, def)).toBe(true);
  });
});

describe('issuePathTarget', () => {
  it('maps a stage-and-field path', () => {
    expect(issuePathTarget('/stages/2/skill')).toEqual({ stageIndex: 2, field: 'skill' });
  });

  it('maps a bare stage-index path', () => {
    expect(issuePathTarget('/stages/0')).toEqual({ stageIndex: 0 });
  });

  it('degrades pipeline-level and unrecognized paths to null (never dropped by the caller)', () => {
    expect(issuePathTarget('/stages')).toBeNull();
    expect(issuePathTarget('/')).toBeNull();
    expect(issuePathTarget('/name')).toBeNull();
  });
});

describe('addStage', () => {
  it('appends a stage verbatim', () => {
    const def = baseDef();
    const stage = { id: 'd', kind: 'standard' as const, requires: ['c'], gate: false, leadReview: false };
    const next = addStage(def, stage);
    expect(next.stages).toHaveLength(4);
    expect(next.stages[3]).toEqual(stage);
  });
});
