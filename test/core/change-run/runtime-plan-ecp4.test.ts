import { describe, expect, it } from 'vitest';

import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import type { RuntimePlanInput } from '../../../src/core/change-run/internal/runtime-plan.js';
import { RuntimePlanError } from '../../../src/core/change-run/internal/runtime-plan.js';

const branded = <T>(value: string): T => value as T;
const digest = (char: string) => branded<never>(`sha256:${char.repeat(64)}`);

function basePlanInput(nodes: RuntimePlanInput['nodes']): RuntimePlanInput {
  return {
    runId: branded<never>('run:ecp4'),
    pipeline: 'ecp4-test',
    planDigest: digest('1'),
    profileDigest: digest('2'),
    sourceRevisionDigest: digest('3'),
    capabilityDigest: digest('4'),
    policyDigest: digest('5'),
    implicitFinishOutcome: 'done',
    nodes,
  };
}

describe('runtime-plan ECP-4: choice / fan-out / join', () => {
  describe('valid plans', () => {
    it('accepts a valid choice node', () => {
      const plan = createRuntimePlan(basePlanInput([
        {
          kind: 'choice',
          hierarchicalPath: 'root:my-choice',
          requires: [],
          admissionKind: 'agent',
          choice: {
            outcomes: ['simple', 'complex'],
            branches: { simple: 'root:simple-path', complex: 'root:complex-path' },
          },
        },
        {
          kind: 'atomic',
          hierarchicalPath: 'root:simple-path',
          requires: ['root:my-choice'],
          admissionKind: 'agent',
        },
        {
          kind: 'atomic',
          hierarchicalPath: 'root:complex-path',
          requires: ['root:my-choice'],
          admissionKind: 'agent',
        },
      ]));
      const choice = plan.nodes.find((n) => n.kind === 'choice');
      expect(choice).toBeDefined();
      expect(choice!.kind).toBe('choice');
    });

    it('accepts a valid fan-out + join + member structure', () => {
      const plan = createRuntimePlan(basePlanInput([
        {
          kind: 'fan-out',
          hierarchicalPath: 'root:experts',
          requires: [],
          admissionKind: 'agent',
          fanOut: {
            members: [
              { hierarchicalPath: 'root:experts/review', required: true, condition: 'always' },
              { hierarchicalPath: 'root:experts/cso', required: false, condition: 'security-relevant' },
            ],
            concurrencyCap: 2,
            budget: 2,
            joinNodeId: 'root:experts-join',
          },
        },
        {
          kind: 'atomic',
          hierarchicalPath: 'root:experts/review',
          requires: ['root:experts'],
          admissionKind: 'agent',
          workspace: { access: 'read' },
          fanOutTag: { nodeId: 'root:experts', required: true },
        },
        {
          kind: 'atomic',
          hierarchicalPath: 'root:experts/cso',
          requires: ['root:experts'],
          admissionKind: 'agent',
          workspace: { access: 'read' },
          fanOutTag: { nodeId: 'root:experts', required: false },
        },
        {
          kind: 'join',
          hierarchicalPath: 'root:experts-join',
          requires: ['root:experts/review', 'root:experts/cso'],
          join: {
            requiredMembers: ['root:experts/review'],
            optionalMembers: ['root:experts/cso'],
            outcomes: { proceed: 'experts-done', failed: 'experts-failed' },
          },
        },
      ]));
      const fanOut = plan.nodes.find((n) => n.kind === 'fan-out');
      expect(fanOut).toBeDefined();
      const join = plan.nodes.find((n) => n.kind === 'join');
      expect(join).toBeDefined();
      // Verify fanOut tag on atomic nodes
      const review = plan.nodes.find(
        (n) => n.kind === 'atomic' && n.hierarchicalPath === 'root:experts/review'
      );
      expect(review!.kind).toBe('atomic');
      if (review!.kind === 'atomic') {
        expect(review!.fanOut).toBeDefined();
        expect(review!.fanOut!.required).toBe(true);
      }
    });
  });

  describe('invalid plans', () => {
    it('rejects choice with < 2 outcomes', () => {
      expect(() => createRuntimePlan(basePlanInput([
        {
          kind: 'choice',
          hierarchicalPath: 'root:c',
          requires: [],
          choice: {
            outcomes: ['only'],
            branches: { only: 'root:x' },
          },
        },
        {
          kind: 'atomic',
          hierarchicalPath: 'root:x',
          requires: ['root:c'],
          admissionKind: 'agent',
        },
      ]))).toThrow(RuntimePlanError);
    });

    it('rejects fan-out with concurrencyCap > 32', () => {
      expect(() => createRuntimePlan(basePlanInput([
        {
          kind: 'fan-out',
          hierarchicalPath: 'root:fo',
          requires: [],
          fanOut: {
            members: [
              { hierarchicalPath: 'root:fo/a', required: true, condition: 'always' },
            ],
            concurrencyCap: 33,
            budget: 1,
            joinNodeId: 'root:j',
          },
        },
        {
          kind: 'atomic',
          hierarchicalPath: 'root:fo/a',
          requires: ['root:fo'],
          admissionKind: 'agent',
          fanOutTag: { nodeId: 'root:fo', required: true },
        },
        {
          kind: 'join',
          hierarchicalPath: 'root:j',
          requires: ['root:fo/a'],
          join: {
            requiredMembers: ['root:fo/a'],
            optionalMembers: [],
            outcomes: { proceed: 'done', failed: 'failed' },
          },
        },
      ]))).toThrow(RuntimePlanError);
    });

    it('rejects fan-out with budget < required member count', () => {
      expect(() => createRuntimePlan(basePlanInput([
        {
          kind: 'fan-out',
          hierarchicalPath: 'root:fo',
          requires: [],
          fanOut: {
            members: [
              { hierarchicalPath: 'root:fo/a', required: true, condition: 'always' },
              { hierarchicalPath: 'root:fo/b', required: true, condition: 'always' },
            ],
            concurrencyCap: 2,
            budget: 1,
            joinNodeId: 'root:j',
          },
        },
        {
          kind: 'atomic',
          hierarchicalPath: 'root:fo/a',
          requires: ['root:fo'],
          admissionKind: 'agent',
          fanOutTag: { nodeId: 'root:fo', required: true },
        },
        {
          kind: 'atomic',
          hierarchicalPath: 'root:fo/b',
          requires: ['root:fo'],
          admissionKind: 'agent',
          fanOutTag: { nodeId: 'root:fo', required: true },
        },
        {
          kind: 'join',
          hierarchicalPath: 'root:j',
          requires: ['root:fo/a', 'root:fo/b'],
          join: {
            requiredMembers: ['root:fo/a', 'root:fo/b'],
            optionalMembers: [],
            outcomes: { proceed: 'done', failed: 'failed' },
          },
        },
      ]))).toThrow(RuntimePlanError);
    });

    it('rejects join with overlapping required/optional members', () => {
      expect(() => createRuntimePlan(basePlanInput([
        {
          kind: 'fan-out',
          hierarchicalPath: 'root:fo',
          requires: [],
          fanOut: {
            members: [
              { hierarchicalPath: 'root:fo/a', required: true, condition: 'always' },
            ],
            concurrencyCap: 1,
            budget: 1,
            joinNodeId: 'root:j',
          },
        },
        {
          kind: 'atomic',
          hierarchicalPath: 'root:fo/a',
          requires: ['root:fo'],
          admissionKind: 'agent',
          fanOutTag: { nodeId: 'root:fo', required: true },
        },
        {
          kind: 'join',
          hierarchicalPath: 'root:j',
          requires: ['root:fo/a'],
          join: {
            requiredMembers: ['root:fo/a'],
            optionalMembers: ['root:fo/a'],
            outcomes: { proceed: 'done', failed: 'failed' },
          },
        },
      ]))).toThrow(RuntimePlanError);
    });

    it('rejects fan-out with duplicate member paths', () => {
      expect(() => createRuntimePlan(basePlanInput([
        {
          kind: 'fan-out',
          hierarchicalPath: 'root:fo',
          requires: [],
          fanOut: {
            members: [
              { hierarchicalPath: 'root:fo/a', required: true, condition: 'always' },
              { hierarchicalPath: 'root:fo/a', required: false, condition: 'x' },
            ],
            concurrencyCap: 2,
            budget: 1,
            joinNodeId: 'root:j',
          },
        },
        {
          kind: 'atomic',
          hierarchicalPath: 'root:fo/a',
          requires: ['root:fo'],
          admissionKind: 'agent',
          fanOutTag: { nodeId: 'root:fo', required: true },
        },
        {
          kind: 'join',
          hierarchicalPath: 'root:j',
          requires: ['root:fo/a'],
          join: {
            requiredMembers: ['root:fo/a'],
            optionalMembers: [],
            outcomes: { proceed: 'done', failed: 'failed' },
          },
        },
      ]))).toThrow(RuntimePlanError);
    });
  });
});
