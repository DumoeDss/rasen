import { describe, expect, it } from 'vitest';

import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import type {
  RuntimePlanInput,
  RuntimePlanCompositeBodyInput,
} from '../../../src/core/change-run/internal/runtime-plan.js';
import { RuntimePlanError } from '../../../src/core/change-run/internal/runtime-plan.js';

const branded = <T>(value: string): T => value as T;
const digest = (char: string) => branded<ReturnType<typeof digest>>(`sha256:${char.repeat(64)}`) as never;

function compositeBodyInput(): RuntimePlanCompositeBodyInput {
  return {
    kind: 'composite',
    declarationId: 'my-composite',
    stages: [
      {
        hierarchicalPath: 'root/loop/stage-a',
        profilePath: 'declaration:my-composite/node:a',
        admissionKind: 'agent',
        workspace: { access: 'write' },
        requires: [],
      },
      {
        hierarchicalPath: 'root/loop/stage-b',
        profilePath: 'declaration:my-composite/node:b',
        admissionKind: 'agent',
        workspace: { access: 'write' },
        requires: ['root/loop/stage-a'],
      },
    ],
    outcomes: { done: 'success' },
  };
}

function basePlanInput(
  body: RuntimePlanCompositeBodyInput
): RuntimePlanInput {
  return {
    runId: branded<never>('run:abc'),
    pipeline: 'composite-test',
    planDigest: digest('1') as never,
    profileDigest: digest('2') as never,
    sourceRevisionDigest: digest('3') as never,
    capabilityDigest: digest('4') as never,
    policyDigest: digest('5') as never,
    implicitFinishOutcome: 'done',
    nodes: [
      {
        kind: 'bounded-loop',
        hierarchicalPath: 'root/loop',
        requires: [],
        maxIterations: 3,
        body,
        outcomes: { clean: 'success', exhausted: 'exhausted' },
      },
    ],
  };
}

describe('createRuntimePlan — composite body kind', () => {
  describe('failure-first', () => {
    it('rejects composite body with zero stages', () => {
      const input = basePlanInput({
        kind: 'composite',
        declarationId: 'empty',
        stages: [],
        outcomes: { done: 'success' },
      });
      expect(() => createRuntimePlan(input)).toThrow(RuntimePlanError);
      expect(() => createRuntimePlan(input)).toThrow(
        /at least one stage/
      );
    });

    it('rejects duplicate hierarchical paths in composite body', () => {
      const input = basePlanInput({
        kind: 'composite',
        declarationId: 'dup',
        stages: [
          {
            hierarchicalPath: 'root/loop/dup',
            profilePath: 'declaration:dup/node:a',
            admissionKind: 'agent',
            workspace: { access: 'write' },
            requires: [],
          },
          {
            hierarchicalPath: 'root/loop/dup',
            profilePath: 'declaration:dup/node:b',
            admissionKind: 'agent',
            workspace: { access: 'write' },
            requires: [],
          },
        ],
        outcomes: { done: 'success' },
      });
      expect(() => createRuntimePlan(input)).toThrow(/declared more than once/);
    });

    it('rejects cyclic body-internal requires', () => {
      const input = basePlanInput({
        kind: 'composite',
        declarationId: 'cyclic',
        stages: [
          {
            hierarchicalPath: 'root/loop/a',
            profilePath: 'declaration:cyclic/node:a',
            admissionKind: 'agent',
            workspace: { access: 'write' },
            requires: ['root/loop/b'],
          },
          {
            hierarchicalPath: 'root/loop/b',
            profilePath: 'declaration:cyclic/node:b',
            admissionKind: 'agent',
            workspace: { access: 'write' },
            requires: ['root/loop/a'],
          },
        ],
        outcomes: { done: 'success' },
      });
      expect(() => createRuntimePlan(input)).toThrow(/acyclic/);
    });

    it('rejects empty outcome key', () => {
      const input = basePlanInput({
        kind: 'composite',
        declarationId: 'empty-outcome',
        stages: [
          {
            hierarchicalPath: 'root/loop/a',
            profilePath: 'declaration:empty-outcome/node:a',
            admissionKind: 'agent',
            workspace: { access: 'write' },
            requires: [],
          },
        ],
        outcomes: { '': 'success' },
      });
      expect(() => createRuntimePlan(input)).toThrow(/empty outcome keys/);
    });
  });

  describe('happy-path', () => {
    it('produces a frozen bounded-loop node with body.kind === composite', () => {
      const plan = createRuntimePlan(basePlanInput(compositeBodyInput()));
      const loop = plan.nodes.find((n) => n.kind === 'bounded-loop');
      expect(loop).toBeDefined();
      expect(loop!.kind).toBe('bounded-loop');
      if (loop!.kind !== 'bounded-loop') return;
      expect(loop!.body.kind).toBe('composite');
      if (loop!.body.kind !== 'composite') return;
      expect(loop!.body.declarationId).toBe('my-composite');
      expect(loop!.body.stages).toHaveLength(2);
      expect(loop!.body.stages[0]!.hierarchicalPath).toBe('root/loop/stage-a');
      expect(loop!.body.stages[1]!.hierarchicalPath).toBe('root/loop/stage-b');
      expect(loop!.body.stages[1]!.requires).toHaveLength(1);
      expect(loop!.body.outcomes).toEqual({ done: 'success' });
      expect(Object.isFrozen(loop)).toBe(true);
      expect(Object.isFrozen(loop!.body)).toBe(true);
      expect(Object.isFrozen(loop!.body.stages)).toBe(true);
    });
  });
});
