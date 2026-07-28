import { describe, expect, it } from 'vitest';

import {
  ActionBuildError,
  buildAgentAction,
  buildCommandAction,
  buildHostAction,
  type ActionBuildContext,
  type ActionIdentity,
} from '../../../src/core/change-run/internal/actions.js';
import type { RuntimeCapabilityBinding } from '../../../src/core/pipeline-registry/execution-plan-internal.js';
import { deriveNodeId } from '../../../src/core/change-run/internal/identity.js';
import type {
  Digest,
  RunId,
  WorkspaceInstanceId,
} from '../../../src/core/change-run/index.js';

const branded = <T>(value: string): T => value as T;
const runId = branded<RunId>(`run:${'a'.repeat(64)}`);
const workspaceDigest = branded<Digest>(`sha256:${'c'.repeat(64)}`);
const workspaceInstanceId = branded<WorkspaceInstanceId>(
  `workspace-instance:${'3'.repeat(64)}`
);
const expectedBeforeWorkspace = {
  format: 'workspace-revision/1',
  head: { kind: 'commit' as const, digest: workspaceDigest, detached: false },
  treeDigest: workspaceDigest,
  dirtyWorktreeDigest: workspaceDigest,
};
const nodeId = deriveNodeId(runId, 'stage:apply');

function capability(
  actionKind: 'agent' | 'command' | 'host'
): RuntimeCapabilityBinding {
  return {
    nodeId: 'stage:apply',
    authoredCapability: { id: 'skill:rasen-apply-change', version: 'legacy' },
    contract: {
      id: 'apply-change',
      version: '1',
      digest: branded(`sha256:${'1'.repeat(64)}`),
    },
    actionKind,
    resultContract: {
      id: 'apply-change-result',
      version: '1',
      digest: branded(`sha256:${'2'.repeat(64)}`),
    },
    evidenceContract: {
      id: 'apply-change-evidence',
      version: '1',
      digest: branded(`sha256:${'3'.repeat(64)}`),
    },
    recovery: 'suspend-if-ambiguous',
    workspace: { access: 'write', resources: ['worktree'] },
    effects: [
      {
        slot: 'workspace',
        kind: 'workspace',
        resource: 'worktree',
        recovery: 'suspend-if-ambiguous',
      },
    ],
    adapter: {
      id: 'adapter:apply-change',
      version: '1',
      contentDigest: branded(`sha256:${'4'.repeat(64)}`),
    },
  } as RuntimeCapabilityBinding;
}

function ctx(actionKind: 'agent' | 'command' | 'host'): ActionBuildContext {
  return {
    capability: capability(actionKind),
    stage: {
      nodeId: 'stage:apply',
      role: 'implementer',
      model: 'sonnet',
      effort: 'medium',
      runtime: 'codex',
      sandbox: 'workspace-write',
      gate: false,
      sessionReuse: 'never',
      handoffTokenLimit: 10_000,
      reuseRoundLimit: 1,
      provenance: {
        role: 'stage',
        model: 'default',
        effort: 'default',
        runtime: 'stage',
        sandbox: 'stage',
        gate: 'stage',
        sessionReuse: 'default',
        handoffTokenLimit: 'default',
        reuseRoundLimit: 'default',
      },
    },
    executionProfileDigest: branded(`sha256:${'5'.repeat(64)}`),
    policyDigest: branded(`sha256:${'6'.repeat(64)}`),
  };
}

const identity: ActionIdentity = {
  runId,
  nodeId,
  occurrence: 0,
  attemptOrdinal: 0,
  expectedBeforeWorkspace,
};

describe('buildAgentAction (6.1/6.4)', () => {
  it('builds a closed agent action from the trusted capability + policy', () => {
    const action = buildAgentAction(ctx('agent'), identity, {
      input: { change: 'fixture' },
    });
    expect(action.kind).toBe('agent');
    expect(action.runId).toBe(runId);
    expect(action.nodeId).toBe(nodeId);
    expect(action.capability.contractId).toBe('apply-change');
    expect(action.agent.role).toBe('implementer');
    expect(action.agent.model).toBe('sonnet');
    expect(action.agent.session.reuse).toBe('never');
    expect(action.workspace.access).toBe('write');
    expect(action.effects[0]!.operation.operationKey).toBe(
      'apply-change:workspace'
    );
    expect(action.effects[0]!.operation.conflictPolicy).toBe('uncertain');
  });

  it('rejects a capability bound to a different action kind', () => {
    expect(() =>
      buildAgentAction(ctx('command'), identity, { input: { ok: true } })
    ).toThrowError(ActionBuildError);
  });

  it('derives identity from the frozen meaning, never trusting caller-supplied IDs', () => {
    const a = buildAgentAction(ctx('agent'), identity, { input: {} });
    const replay = buildAgentAction(ctx('agent'), identity, { input: {} });
    // Same frozen meaning -> identical canonical identity (ActionId/AttemptId/EffectId).
    expect(replay.actionId).toBe(a.actionId);
    expect(replay.attemptId).toBe(a.attemptId);
    expect(replay.effects[0]!.effectId).toBe(a.effects[0]!.effectId);
  });
});

describe('buildCommandAction (6.2/6.4)', () => {
  const command = {
    executable: {
      identity: 'adapter:apply-change',
      contentDigest: branded<Digest>(`sha256:${'4'.repeat(64)}`),
    },
    argv: ['--json'],
    env: { RASEN_LANG: 'en' },
    workspaceInstanceId,
    workingDirectory: '.',
    timeoutMs: 1000,
  };

  it('builds a closed command action with shell:false and adapter-bound artifact', () => {
    const action = buildCommandAction(ctx('command'), identity, command);
    expect(action.kind).toBe('command');
    expect(action.command.shell).toBe(false);
    expect(action.command.artifact.id).toBe('adapter:apply-change');
    expect(action.command.argv).toEqual(['--json']);
    expect(action.command.workspaceInstanceId).toBe(workspaceInstanceId);
  });

  it('rejects an over-long argv entry and an oversized argv list', () => {
    expect(() =>
      buildCommandAction(ctx('command'), identity, {
        ...command,
        argv: ['x'.repeat(64 * 1024 + 1)],
      })
    ).toThrowError(ActionBuildError);
    expect(() =>
      buildCommandAction(ctx('command'), identity, {
        ...command,
        argv: new Array(257).fill('x'),
      })
    ).toThrowError(ActionBuildError);
  });

  it('rejects disallowed env names and absolute/backslash working directories', () => {
    expect(() =>
      buildCommandAction(ctx('command'), identity, {
        ...command,
        env: { 'PATH;evil': 'x' },
      })
    ).toThrowError(ActionBuildError);
    expect(() =>
      buildCommandAction(ctx('command'), identity, {
        ...command,
        workingDirectory: '/abs',
      })
    ).toThrowError(ActionBuildError);
    expect(() =>
      buildCommandAction(ctx('command'), identity, {
        ...command,
        workingDirectory: 'a\\b',
      })
    ).toThrowError(ActionBuildError);
  });

  it('rejects a non-positive timeout and a kind mismatch', () => {
    expect(() =>
      buildCommandAction(ctx('command'), identity, { ...command, timeoutMs: 0 })
    ).toThrowError(ActionBuildError);
    expect(() =>
      buildCommandAction(ctx('agent'), identity, command)
    ).toThrowError(ActionBuildError);
  });
});

describe('buildHostAction (6.3/6.4)', () => {
  it('builds a closed host action carrying only an allowed operation + json input', () => {
    const action = buildHostAction(ctx('host'), identity, {
      operation: 'ship',
      input: { ref: 'heads/main' },
    });
    expect(action.kind).toBe('host');
    expect(action.host.operation).toBe('ship');
    expect(action.host.input).toEqual({ ref: 'heads/main' });
  });

  it('rejects an unsupported operation and a kind mismatch', () => {
    expect(() =>
      buildHostAction(ctx('host'), identity, {
        operation: 'ship',
        input: {},
      })
    ).not.toThrow();
    expect(() =>
      buildHostAction(ctx('agent'), identity, {
        operation: 'ship',
        input: {},
      })
    ).toThrowError(ActionBuildError);
  });
});
