import { describe, expect, it } from 'vitest';

import { ChangeRunRuntimeError } from '../../../src/core/change-run/facade.js';
import { createChangePipelineRuntime } from '../../../src/core/change-run/internal/facade-runtime.js';
import { createInMemoryRunStore } from '../../../src/core/change-run/internal/run-store.js';
import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import { agentAction, startRecord } from './reconciler-fixture.js';
import type { RuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import { digestLaunchIntent } from '../../../src/core/change-run/internal/identity.js';
import { createCanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';

const branded = <T>(value: string): T => value as T;

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
      buildAction: (descriptor) => {
        const node = plan.nodes.find((n) => n.nodeId === descriptor.nodeId)!;
        return agentAction(plan, node.hierarchicalPath, descriptor.occurrence);
      },
    });
    const launchDigest = digestLaunchIntent({ pipeline: 'linear', inputs: {} });

    const started = await runtime.start(
      {
        change: {
          projectRoot: '/root',
          changeId: 'fixture-change',
        },
        pipeline: 'linear',
        launchRequestId: branded(`launch:${'1'.repeat(60)}1111`),
        launchRequestDigest: launchDigest,
      },
      { deliveryMode: 'grant' }
    );
    expect(started.disposition).toBe('created');
    expect(started.actions).toHaveLength(1); // root/a admitted + granted
    expect(started.actions[0]!.nodeId).toBe(plan.nodes[0]!.nodeId);

    const reused = await runtime.start(
      {
        change: { projectRoot: '/root', changeId: 'fixture-change' },
        pipeline: 'linear',
        launchRequestId: branded(`launch:${'1'.repeat(60)}1111`),
        launchRequestDigest: launchDigest,
      },
      { deliveryMode: 'grant' }
    );
    expect(reused.disposition).toBe('reused');
    expect(reused.actions).toEqual([]);
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

  it('resume grants a ready admit candidate (advanced)', async () => {
    const plan = linearPlan();
    const store = createInMemoryRunStore();
    store.create(plan.runId, startRecord(plan));
    const runtime = createChangePipelineRuntime({
      store,
      plan,
      initialRecord: startRecord(plan),
      buildAction: (descriptor) => {
        const node = plan.nodes.find((n) => n.nodeId === descriptor.nodeId)!;
        return agentAction(plan, node.hierarchicalPath, descriptor.occurrence);
      },
    });
    const resumed = await runtime.resume(
      { change: { projectRoot: '/root', changeId: 'fixture-change' }, runId: plan.runId },
      { deliveryMode: 'grant' }
    );
    // root/a is ready and not yet admitted -> resume grants it (advanced).
    expect(resumed.disposition).toBe('advanced');
    expect(resumed.actions).toHaveLength(1);
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
      buildAction: (descriptor) => {
        const node = plan.nodes.find((n) => n.nodeId === descriptor.nodeId)!;
        return agentAction(plan, node.hierarchicalPath, descriptor.occurrence);
      },
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
