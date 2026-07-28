import { describe, expect, it } from 'vitest';

import {
  ChangeRunIdentityError,
  decodePhysicalIdentity,
  deriveActionId,
  deriveAttemptId,
  deriveChangeInstanceId,
  deriveEffectId,
  deriveInvocationId,
  deriveNodeId,
  derivePlanningSpaceId,
  deriveRunId,
  deriveWaitId,
  deriveWorkspaceInstanceId,
  digestLaunchIntent,
  encodePhysicalIdentity,
  normalizeLaunchIntent,
} from '../../../src/core/change-run/internal/identity.js';

describe('domain-separated change-run identities', () => {
  it('matches the frozen golden vector for every v1 identity domain', () => {
    const physical = {
      format: 'physical-identity/1',
      platform: 'posix',
      device: 4n,
      fileIndex: 8n,
      birthIdentity: 15n,
    } as const;
    const planningSpaceId = derivePlanningSpaceId('autonomy-ladder-1e42477e');
    const changeInstanceId = deriveChangeInstanceId(
      planningSpaceId,
      'fixture-change',
      physical
    );
    const workspaceInstanceId = deriveWorkspaceInstanceId(
      planningSpaceId,
      physical
    );
    const runId = deriveRunId(
      planningSpaceId,
      changeInstanceId,
      'fixture-change',
      'launch-fixture'
    );
    const nodeId = deriveNodeId(runId, 'root/stage:apply');
    const invocationId = deriveInvocationId(runId, nodeId, 0);
    const attemptId = deriveAttemptId(invocationId, 0);
    const effectId = deriveEffectId(invocationId, 'workspace');
    const actionId = deriveActionId(attemptId, 'agent', [
      { slot: 'workspace', effectId },
    ]);
    const waitId = deriveWaitId({
      runId,
      kind: 'uncertain-effect',
      nodeId,
      invocationId,
      occurrence: 0,
      attemptId,
      actionId,
      effectIds: [effectId],
    });

    expect({
      planningSpaceId,
      changeInstanceId,
      workspaceInstanceId,
      runId,
      nodeId,
      invocationId,
      attemptId,
      effectId,
      actionId,
      waitId,
    }).toEqual({
      planningSpaceId:
        'planning-space:69dc00f526fbd7bc49f5a90fa8e29331caddb7034df126c31868d44fc052fa92',
      changeInstanceId:
        'change-instance:a348f268a4f97438ce4816619a28fcb5a0241f0e0fd0f0f4c80ca9c8808eda92',
      workspaceInstanceId:
        'workspace-instance:3f108eb076e100b766a825b7468cead881fb2eaf011e607a748e548d8b9638bc',
      runId:
        'run:1cf55b57a1d811c5295314696a93de7e7b6fa55de582d4f9f0c47770160f037a',
      nodeId:
        'node:81ea62ba4464042902956d8f5a58e8bfc9de05031b1a2a71ceb3a4c8fe4edf83',
      invocationId:
        'invocation:2785e77bd0275470d8e001655a18cd0f1c997d6f86743b55de437b842ff1fd68',
      attemptId:
        'attempt:32ade96141335dd4bcd8e21b23f2d7a60a1699329aa9256aec7f30f04d4b80b2',
      effectId:
        'effect:65bcbd5462100cd60ae770ad2f1e373378b3084037a965fc51816f4610dc06d2',
      actionId:
        'action:ff31519c48eff098b57d3fe2bb390f648e8454813088b31b80d0558217354b81',
      waitId:
        'wait:f35ea7e1dd54e432e8b71794b8e27eb61f94f47d4aac3cfe35e3dfea3e2b0d23',
    });
  });

  it('sorts effect descriptors and exact wait context without clocks or paths', () => {
    const planning = derivePlanningSpaceId('home-a');
    const physical = {
      format: 'physical-identity/1',
      platform: 'windows',
      volume: 3n,
      fileIndex: 9n,
      creationIdentity: 27n,
    } as const;
    const change = deriveChangeInstanceId(planning, 'fixture-change', physical);
    const run = deriveRunId(planning, change, 'fixture-change', 'same-key');
    const node = deriveNodeId(run, 'root/stage:ship');
    const invocation = deriveInvocationId(run, node, 0);
    const attempt = deriveAttemptId(invocation, 1);
    const push = deriveEffectId(invocation, 'push');
    const pr = deriveEffectId(invocation, 'pr');

    expect(
      deriveActionId(attempt, 'host', [
        { slot: 'push', effectId: push },
        { slot: 'pr', effectId: pr },
      ])
    ).toBe(
      deriveActionId(attempt, 'host', [
        { slot: 'pr', effectId: pr },
        { slot: 'push', effectId: push },
      ])
    );
    expect(derivePlanningSpaceId('home-a')).not.toBe(
      derivePlanningSpaceId('home-b')
    );
    expect(run).toBe(
      deriveRunId(planning, change, 'fixture-change', 'same-key')
    );
  });
});

describe('physical identity codec', () => {
  it.each([
    {
      identity: {
        format: 'physical-identity/1',
        platform: 'posix',
        device: 0x0102n,
        fileIndex: 0x0304n,
        birthIdentity: 0x0506n,
      } as const,
      platformTag: 1,
    },
    {
      identity: {
        format: 'physical-identity/1',
        platform: 'windows',
        volume: 0x0102n,
        fileIndex: 0x0304n,
        creationIdentity: 0x0506n,
      } as const,
      platformTag: 2,
    },
  ])('round-trips fixed-width $identity.platform bytes', ({ identity, platformTag }) => {
    const encoded = encodePhysicalIdentity(identity);
    expect(encoded).toHaveLength(25);
    expect(encoded[0]).toBe(platformTag);
    expect(decodePhysicalIdentity(encoded)).toEqual(identity);
  });

  it('fails closed on zero, truncated, unavailable, or over-width identity fields', () => {
    expect(() =>
      encodePhysicalIdentity({
        format: 'physical-identity/1',
        platform: 'posix',
        device: 1n,
        fileIndex: 2n,
        birthIdentity: 0n,
      })
    ).toThrow(ChangeRunIdentityError);
    expect(() => decodePhysicalIdentity(new Uint8Array(24))).toThrow(
      ChangeRunIdentityError
    );
    expect(() =>
      encodePhysicalIdentity({
        format: 'physical-identity/1',
        platform: 'windows',
        volume: 1n << 64n,
        fileIndex: 2n,
        creationIdentity: 3n,
      })
    ).toThrow(ChangeRunIdentityError);
  });
});

describe('launch intent normalization', () => {
  it('binds key-order-independent inputs and exact Pipeline/engine intent', () => {
    const left = normalizeLaunchIntent({
      pipeline: 'bug-fix',
      engine: 'reconciler',
      inputs: { z: [2, 1], a: { y: true, x: null } },
    });
    const right = normalizeLaunchIntent({
      inputs: { a: { x: null, y: true }, z: [2, 1] },
      engine: 'reconciler',
      pipeline: 'bug-fix',
    });
    expect(left).toEqual(right);
    expect(digestLaunchIntent(left)).toBe(digestLaunchIntent(right));
    expect(
      digestLaunchIntent({ ...right, pipeline: 'small-feature' })
    ).not.toBe(digestLaunchIntent(right));
  });
});
