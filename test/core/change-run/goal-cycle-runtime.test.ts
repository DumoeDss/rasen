import { describe, expect, it } from 'vitest';

import type {
  ActionId,
  ChangeInstanceId,
  Digest,
  EvidenceRef,
  PlanningSpaceId,
  RunId,
} from '../../../src/core/change-run/contracts.js';
import { deriveNodeId } from '../../../src/core/change-run/internal/identity.js';
import {
  createRuntimePlan,
  type RuntimePlan,
} from '../../../src/core/change-run/internal/runtime-plan.js';
import {
  goalCycleInvocation,
  projectGoalCycleProgress,
  goalCycleInvocationPath,
} from '../../../src/core/change-run/internal/goal-cycle-runtime.js';
import {
  startRecord,
} from './reconciler-fixture.js';
import type { CanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';

const branded = <T>(value: string): T => value as T;
const digest = (hex: string) =>
  branded<Digest>(`sha256:${hex.padEnd(64, '0').slice(0, 64)}`);

function plan(variant: 'measure' | 'evaluate' | 'research' = 'measure', maxIterations = 3): RuntimePlan {
  return createRuntimePlan({
    runId: branded<RunId>(`run:${'a'.repeat(64)}`),
    pipeline: 'goal-cycle-runtime',
    planDigest: digest('1'),
    profileDigest: digest('2'),
    sourceRevisionDigest: digest('3'),
    capabilityDigest: digest('4'),
    policyDigest: digest('5'),
    implicitFinishOutcome: 'goal-satisfied',
    nodes: [
      {
        kind: 'bounded-loop',
        hierarchicalPath: 'root/goal-cycle',
        requires: [],
        maxIterations,
        body: {
          kind: 'goal-cycle',
          variant,
          phases: [
            {
              phase: 'work',
              profilePath: 'declaration:goal-cycle/node:work',
              admissionKind: 'agent',
              workspace: { access: 'write' },
            },
            {
              phase: 'judge',
              profilePath: 'declaration:goal-cycle/node:judge',
              admissionKind: 'agent',
              workspace: { access: 'read' },
            },
          ],
        },
        outcomes: {
          clean: 'satisfied',
          exhausted: 'goal_cycle_exhausted',
        },
      },
    ],
  });
}

function recordFor(p: RuntimePlan): CanonicalRunRecord {
  return startRecord(p);
}

describe('goal-cycle-runtime — projectGoalCycleProgress (task 3.6)', () => {
  it('empty record → ready round 1 work', () => {
    const p = plan('measure');
    const record = recordFor(p);
    const loop = p.nodes[0]!;
    const progress = projectGoalCycleProgress(p, loop as never, record);
    expect(progress.kind).toBe('ready');
    if (progress.kind !== 'ready') return;
    expect(progress.state.round).toBe(1);
    expect(progress.state.phase).toBe('work');
    expect(progress.next.round).toBe(1);
    expect(progress.next.phase).toBe('work');
  });

  it('goalCycleInvocationPath derives correct hierarchical path', () => {
    const path = goalCycleInvocationPath('root/goal-cycle', 2, 'judge');
    expect(path).toBe('root/goal-cycle/round:2/phase:judge');
  });

  it('goalCycleInvocation derives correct nodeId', () => {
    const p = plan('evaluate');
    const loop = p.nodes[0]!;
    const descriptor = goalCycleInvocation(
      p,
      loop as never,
      1,
      (loop as { body: { phases: { phase: 'work'; profilePath: string; admissionKind: 'agent'; workspace: { access: 'write' } }[] } })
        .body.phases[0] as never
    );
    expect(descriptor.round).toBe(1);
    expect(descriptor.phase).toBe('work');
    expect(descriptor.hierarchicalPath).toBe('root/goal-cycle/round:1/phase:work');
    expect(descriptor.nodeId).toBeDefined();
  });

  it('variant is propagated from the plan body', () => {
    const p = plan('research');
    const record = recordFor(p);
    const loop = p.nodes[0]!;
    const progress = projectGoalCycleProgress(p, loop as never, record);
    expect(progress.kind).toBe('ready');
    if (progress.kind !== 'ready') return;
    expect(progress.state.variant).toBe('research');
  });

  it('initial state has correct defaults', () => {
    const p = plan('measure');
    const record = recordFor(p);
    const loop = p.nodes[0]!;
    const progress = projectGoalCycleProgress(p, loop as never, record);
    if (progress.kind !== 'ready') return;
    expect(progress.state.eventCount).toBe(0);
    expect(progress.state.stallStreak).toBe(0);
    expect(progress.state.lastGaps).toEqual([]);
    expect(progress.state.outcome).toBeUndefined();
    expect(progress.state.lastScore).toBeUndefined();
  });
});
