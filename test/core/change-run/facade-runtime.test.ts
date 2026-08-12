import { describe, expect, it } from 'vitest';

import { ChangeRunRuntimeError } from '../../../src/core/change-run/facade.js';
import { createChangePipelineRuntime } from '../../../src/core/change-run/internal/facade-runtime.js';
import { createInMemoryRunStore } from '../../../src/core/change-run/internal/run-store.js';
import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import { agentAction, startRecord } from './reconciler-fixture.js';
import type { RuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import { digestLaunchIntent } from '../../../src/core/change-run/internal/identity.js';
import { createCanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import { deriveAgentTurnInputBinding } from '../../../src/core/change-run/internal/actions.js';
import type { RunAction } from '../../../src/core/change-run/contracts.js';

const branded = <T>(value: string): T => value as T;

function buildBoundAgentAction(
  plan: RuntimePlan,
  descriptor: {
    readonly nodeId: string;
    readonly occurrence: number;
    readonly renderedTurnInput?: string;
  }
): RunAction {
  if (descriptor.renderedTurnInput === undefined) {
    throw new Error('trusted rendered turn input required');
  }
  const node = plan.nodes.find((entry) => entry.nodeId === descriptor.nodeId)!;
  const action = agentAction(
    plan,
    node.hierarchicalPath,
    descriptor.occurrence
  );
  if (action.kind !== 'agent') throw new Error('expected agent Action');
  return {
    ...action,
    agent: {
      ...action.agent,
      turnInput: deriveAgentTurnInputBinding(descriptor.renderedTurnInput),
    },
  };
}

function linearPlan(): RuntimePlan {
  return createRuntimePlan({
    runId: branded(`run:${'a'.repeat(64)}`),
    pipeline: 'linear',
    planDigest: branded(`sha256:${'2'.repeat(64)}`),
    profileDigest: branded(`sha256:${'3'.repeat(64)}`),
    sourceRevisionDigest: branded(`sha256:${'4'.repeat(64)}`),
    capabilityDigest: branded(`sha256:${'5'.repeat(64)}`),
    policyDigest: branded(`sha256:${'6'.repeat(64)}`),
    implicitFinishOutcome: 'linear-completed',
    nodes: [
      {
        kind: 'atomic',
        hierarchicalPath: 'root/a',
        requires: [],
        admissionKind: 'agent',
        workspace: { access: 'write' },
      },
    ],
  });
}

describe('ChangePipelineRuntime facade (10.1/10.2)', () => {
  it('starts once (created), reuses on repeat start, and inspects the view', async () => {
    const plan = linearPlan();
    const store = createInMemoryRunStore();
    const initial = startRecord(plan);
    const runtime = createChangePipelineRuntime({
      store,
      plan,
      initialRecord: initial,
      buildAction: (descriptor) => buildBoundAgentAction(plan, descriptor),
    });
    const launchIntent = {
      pipeline: 'linear',
      engine: 'reconciler' as const,
      inputs: {},
    };
    const launchDigest = digestLaunchIntent(launchIntent);
    const launchRequest = {
      change: {
        projectRoot: '/root',
        changeId: 'fixture-change',
      },
      ...launchIntent,
      launchRequestId: branded(`launch:${'1'.repeat(60)}1111`),
      launchRequestDigest: launchDigest,
    };

    const started = await runtime.start(launchRequest, {
      deliveryMode: 'grant',
    });
    expect(started.disposition).toBe('created');
    expect(started.actions).toEqual([]);
    expect(started.candidates).toHaveLength(1);
    expect(started.candidates[0]).toMatchObject({
      format: 'change-run-agent-candidate/1',
      runId: plan.runId,
      nodeId: plan.nodes[0]!.nodeId,
      occurrence: 0,
      recordVersion: initial.recordVersion,
    });
    expect(started.candidates[0]).not.toHaveProperty('agent');
    expect(started.candidates[0]).not.toHaveProperty('prompt');
    expect(store.load(plan.runId)).toEqual(initial);

    const reused = await runtime.start(launchRequest, {
      deliveryMode: 'grant',
    });
    expect(reused.disposition).toBe('reused');
    expect(reused.actions).toEqual([]);
    expect(reused.candidates).toEqual(started.candidates);
    expect(store.load(plan.runId)).toEqual(initial);

    const resumed = await runtime.resume(
      { change: launchRequest.change, runId: plan.runId },
      { deliveryMode: 'grant' }
    );
    expect(resumed.disposition).toBe('advanced');
    expect(resumed.actions).toEqual([]);
    expect(resumed.candidates).toEqual(started.candidates);
    expect(store.load(plan.runId)).toEqual(initial);

    const prompt = 'trusted start prompt\n雪';
    const admitted = await runtime.admit(
      { change: launchRequest.change, runId: plan.runId },
      {
        deliveryMode: 'grant',
        resolveAgentTurnInput: (candidate) => {
          expect(candidate).toEqual(started.candidates[0]);
          return prompt;
        },
      }
    );
    expect(admitted.disposition).toBe('advanced');
    expect(admitted.actions).toHaveLength(1);
    expect(admitted.actions[0]).toMatchObject({
      kind: 'agent',
      nodeId: plan.nodes[0]!.nodeId,
      agent: { turnInput: deriveAgentTurnInputBinding(prompt) },
    });
    expect(Object.keys(store.load(plan.runId).actions)).toHaveLength(1);
    expect(() =>
      runtime.admit(
        { change: launchRequest.change, runId: plan.runId },
        { deliveryMode: 'grant', resolveAgentTurnInput: () => prompt }
      )
    ).toThrowError(expect.objectContaining({ code: 'candidate_stale' }));

    const beforeConflict = store.load(plan.runId);

    expect(() =>
      runtime.start(
        {
          change: { projectRoot: '/root', changeId: 'fixture-change' },
          pipeline: 'another-pipeline',
          launchRequestId: branded(`launch:${'1'.repeat(60)}1111`),
          launchRequestDigest: branded(`sha256:${'f'.repeat(64)}`),
        },
        { deliveryMode: 'grant' }
      )
    ).toThrowError(
      expect.objectContaining<ChangeRunRuntimeError>({
        code: 'launch_request_conflict',
      })
    );
    expect(store.load(plan.runId)).toBe(beforeConflict);

    expect(() =>
      runtime.start(
        {
          change: { projectRoot: '/root', changeId: 'fixture-change' },
          pipeline: 'linear',
          launchRequestId: branded(`launch:${'1'.repeat(60)}1111`),
          inputs: { changed: true },
          launchRequestDigest: launchDigest,
        },
        { deliveryMode: 'grant' }
      )
    ).toThrowError(
      expect.objectContaining<ChangeRunRuntimeError>({
        code: 'launch_request_conflict',
      })
    );

    const view = await runtime.inspect({
      change: { projectRoot: '/root', changeId: 'fixture-change' },
      runId: plan.runId,
    });
    expect(view.status).toBe('running');
  });

  it('resume previews a ready candidate before explicit trusted admission', async () => {
    const plan = linearPlan();
    const store = createInMemoryRunStore();
    const initial = startRecord(plan);
    store.create(plan.runId, initial);
    const runtime = createChangePipelineRuntime({
      store,
      plan,
      initialRecord: initial,
      buildAction: (descriptor) => buildBoundAgentAction(plan, descriptor),
    });
    const runRef = {
      change: { projectRoot: '/root', changeId: 'fixture-change' },
      runId: plan.runId,
    };
    const resumed = await runtime.resume(runRef, { deliveryMode: 'grant' });
    expect(resumed.disposition).toBe('advanced');
    expect(resumed.actions).toEqual([]);
    expect(resumed.candidates).toHaveLength(1);
    expect(resumed.candidates[0]).not.toHaveProperty('agent');
    expect(resumed.candidates[0]).not.toHaveProperty('prompt');
    expect(store.load(plan.runId)).toEqual(initial);

    const repeated = await runtime.resume(runRef, { deliveryMode: 'grant' });
    expect(repeated.actions).toEqual([]);
    expect(repeated.candidates).toEqual(resumed.candidates);
    expect(store.load(plan.runId)).toEqual(initial);

    const prompt = 'trusted resume prompt\n雪';
    const admitted = await runtime.admit(runRef, {
      deliveryMode: 'grant',
      resolveAgentTurnInput: (candidate) => {
        expect(candidate).toEqual(resumed.candidates[0]);
        return prompt;
      },
    });
    expect(admitted.disposition).toBe('advanced');
    expect(admitted.actions).toHaveLength(1);
    expect(admitted.actions[0]).toMatchObject({
      kind: 'agent',
      nodeId: plan.nodes[0]!.nodeId,
      agent: { turnInput: deriveAgentTurnInputBinding(prompt) },
    });
    expect(Object.keys(store.load(plan.runId).actions)).toHaveLength(1);
    expect(() =>
      runtime.admit(runRef, {
        deliveryMode: 'grant',
        resolveAgentTurnInput: () => prompt,
      })
    ).toThrowError(expect.objectContaining({ code: 'candidate_stale' }));
  });

  it('normalizes input key order and derives non-empty launch identity inside the facade', async () => {
    const plan = linearPlan();
    const base = startRecord(plan);
    const frozenInputs = {
      beta: { second: true, first: false },
      alpha: 1,
    } as const;
    const launchRequestDigest = digestLaunchIntent({
      pipeline: 'linear',
      inputs: frozenInputs,
    });
    const initial = createCanonicalRunRecord({
      runId: base.runId,
      runOrdinal: base.runOrdinal,
      change: base.change,
      workspaceInstanceId: base.workspaceInstanceId,
      pipeline: base.pipeline,
      launchRequestDigest,
      planDigest: base.planDigest,
      sourceRevisionDigest: base.sourceRevisionDigest,
      capabilityDigest: base.capabilityDigest,
      policyDigest: base.policyDigest,
      executionProfileDigest: base.executionProfileDigest,
      initialWorkspaceRevision: base.initialWorkspaceRevision,
      inputs: frozenInputs,
      limits: base.limits,
    });
    const store = createInMemoryRunStore();
    const runtime = createChangePipelineRuntime({
      store,
      plan,
      initialRecord: initial,
      buildAction: (descriptor) => buildBoundAgentAction(plan, descriptor),
    });
    const request = {
      change: { projectRoot: '/root', changeId: 'fixture-change' },
      pipeline: 'linear',
      launchRequestId: branded(`launch:${'1'.repeat(60)}1111`),
      inputs: {
        alpha: 1,
        beta: { first: false, second: true },
      },
      launchRequestDigest,
    } as const;

    expect((await runtime.start(request, { deliveryMode: 'defer' })).disposition)
      .toBe('created');
    expect((await runtime.start(request, { deliveryMode: 'defer' })).disposition)
      .toBe('reused');
  });
});
