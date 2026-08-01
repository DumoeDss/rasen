import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  ChangeRunContractError,
  decodeActorRef,
  decodeChangeRunReceipt,
  decodeChangeRunView,
  decodeCompletion,
  decodeControl,
  decodeEvidenceRef,
  decodeRunAction,
  decodeWorkspaceRevision,
  deriveReceiptDisposition,
  type ChangePipelineRuntime,
  type CompleteRunAction,
  type ExactChangeRunRef,
  type ResumeChangePipeline,
} from '../../../src/core/change-run/index.js';

const ids = {
  planningSpaceId: `planning-space:${'1'.repeat(64)}`,
  changeInstanceId: `change-instance:${'2'.repeat(64)}`,
  workspaceInstanceId: `workspace-instance:${'3'.repeat(64)}`,
  runId: `run:${'4'.repeat(64)}`,
  nodeId: `node:${'5'.repeat(64)}`,
  invocationId: `invocation:${'6'.repeat(64)}`,
  attemptId: `attempt:${'7'.repeat(64)}`,
  actionId: `action:${'8'.repeat(64)}`,
  effectId: `effect:${'9'.repeat(64)}`,
  waitId: `wait:${'a'.repeat(64)}`,
  digest: `sha256:${'b'.repeat(64)}`,
} as const;

const revision = {
  format: 'workspace-revision/1',
  head: { kind: 'commit', digest: ids.digest, detached: false },
  treeDigest: ids.digest,
  dirtyWorktreeDigest: ids.digest,
} as const;

const evidence = {
  format: 'change-run-evidence-ref/1',
  store: 'change-run',
  evidenceDigest: ids.digest,
  contentDigest: ids.digest,
  mediaType: 'application/json',
  size: 4,
  observationKind: 'contract-test',
  producer: { id: 'fixture', version: '1', identityDigest: ids.digest },
  binding: {
    planningSpaceId: ids.planningSpaceId,
    changeInstanceId: ids.changeInstanceId,
    projectId: 'project-fixture',
    changeId: 'fixture-change',
    runId: ids.runId,
    actionId: ids.actionId,
    effectId: ids.effectId,
    treeDigest: ids.digest,
    schema: 'fixture/1',
  },
} as const;

const actor = {
  format: 'change-run-actor/1',
  kind: 'agent',
  identityDigest: ids.digest,
  role: 'implementer',
  provider: 'openai',
  runtime: 'codex',
  principalIdentityDigest: ids.digest,
  sessionIdentityDigest: ids.digest,
  adapter: { id: 'codex', version: '1', artifactDigest: ids.digest },
} as const;

const action = {
  format: 'change-run-action/1',
  kind: 'agent',
  runId: ids.runId,
  nodeId: ids.nodeId,
  invocationId: ids.invocationId,
  attemptId: ids.attemptId,
  actionId: ids.actionId,
  effects: [
    {
      slot: 'workspace',
      effectId: ids.effectId,
      kind: 'workspace',
      resource: 'worktree',
      recovery: 'suspend-if-ambiguous',
      operation: {
        operationKey: 'fixture',
        ownershipMarkerContract: 'effect-owner/1',
        conflictPolicy: 'uncertain',
      },
    },
  ],
  executionProfileDigest: ids.digest,
  capability: {
    id: 'skill:rasen-apply-change',
    authoredVersion: 'legacy',
    contractId: 'apply-change',
    contractVersion: '1',
    contractDigest: ids.digest,
    artifact: { id: 'rasen-apply-change', version: '1', contentDigest: ids.digest },
  },
  resultContractDigest: ids.digest,
  evidenceContractDigest: ids.digest,
  policyDigest: ids.digest,
  workspace: { access: 'write', resources: ['worktree'] },
  expectedBeforeWorkspace: revision,
  agent: {
    role: 'implementer',
    model: 'gpt-5',
    reasoningEffort: 'high',
    runtime: 'codex',
    sandbox: 'workspace-write',
    input: { change: 'fixture-change' },
    session: {
      reuse: 'never',
      handoffTokenLimit: 10_000,
      reuseRoundLimit: 1,
    },
  },
} as const;

function view() {
  return {
    format: 'change-run-view/1',
    engine: 'reconciler',
    runId: ids.runId,
    change: {
      planningSpaceId: ids.planningSpaceId,
      projectId: 'project-fixture',
      changeId: 'fixture-change',
      instanceId: ids.changeInstanceId,
    },
    recordVersion: 1,
    status: 'running',
    sourceState: 'active',
    workspace: { instanceId: ids.workspaceInstanceId, scope: 'current' },
    drift: {
      definition: 'unchanged',
      sourceRevision: {
        provenance: 'unchanged',
        content: 'unchanged',
        semantic: 'unchanged',
      },
      capability: 'unchanged',
      policy: 'unchanged',
      workspace: 'unchanged',
    },
    sections: [
      {
        kind: 'root-dag',
        version: 1,
        frontier: [],
        activeInvocations: [
          {
            invocationId: ids.invocationId,
            nodeId: ids.nodeId,
            attemptId: ids.attemptId,
            actionIds: [ids.actionId],
            effects: [
              { slot: 'workspace', effectId: ids.effectId, state: 'admitted' },
            ],
          },
        ],
        actions: [
          {
            format: 'change-run-action-view/1',
            kind: 'agent',
            actionId: ids.actionId,
            invocationId: ids.invocationId,
            attemptId: ids.attemptId,
            nodeId: ids.nodeId,
            deliveryState: 'granted',
            capability: {
              id: 'skill:rasen-apply-change',
              contractVersion: '1',
              contractDigest: ids.digest,
              artifactDigest: ids.digest,
            },
            effects: [
              { slot: 'workspace', effectId: ids.effectId, state: 'admitted' },
            ],
          },
        ],
        waits: [],
        workspace: { current: revision, expectedByActiveWriters: [revision] },
        effectDiagnostics: [
          { effectId: ids.effectId, slot: 'workspace', state: 'admitted' },
        ],
        allowedControls: [{ kind: 'cancel' }],
      },
    ],
  };
}

describe('ChangePipelineRuntime public facade contract', () => {
  it('keeps exact Run selection inside every post-start facade request', () => {
    expectTypeOf<keyof ChangePipelineRuntime>().toEqualTypeOf<
      'start' | 'resume' | 'complete' | 'inspect' | 'control'
    >();
    expectTypeOf<Parameters<ChangePipelineRuntime['resume']>[0]>().toEqualTypeOf<
      ResumeChangePipeline
    >();
    expectTypeOf<ResumeChangePipeline>().toMatchTypeOf<ExactChangeRunRef>();
    expectTypeOf<CompleteRunAction['runId']>().toEqualTypeOf<
      ExactChangeRunRef['runId']
    >();
  });
});

describe('closed change-run codecs', () => {
  it('accepts strict workspace, evidence, actor, action, completion and control values', () => {
    expect(decodeWorkspaceRevision(revision)).toEqual(revision);
    expect(decodeEvidenceRef(evidence)).toEqual(evidence);
    expect(decodeActorRef(actor)).toEqual(actor);
    expect(decodeRunAction(action)).toEqual(action);
    expect(
      decodeCompletion({
        format: 'change-run-completion/1',
        kind: 'effect-observation',
        change: { projectRoot: '.', changeId: 'fixture-change' },
        runId: ids.runId,
        actionId: ids.actionId,
        invocationId: ids.invocationId,
        receiptDigest: ids.digest,
        actor,
        actorAttestation: evidence,
        evidence: [evidence],
        effectId: ids.effectId,
        status: 'not_executed',
        observation: { checked: true },
      })
    ).toEqual(expect.objectContaining({ kind: 'effect-observation' }));
    expect(
      decodeControl({
        format: 'change-run-control/1',
        ref: {
          change: { projectRoot: '.', changeId: 'fixture-change' },
          runId: ids.runId,
        },
        expectedRecordVersion: 1,
        command: { kind: 'resume', waitId: ids.waitId },
      })
    ).toEqual(expect.objectContaining({ expectedRecordVersion: 1 }));
  });

  it('rejects unknown majors, cross-variant fields, and extras', () => {
    expect(() =>
      decodeWorkspaceRevision({ ...revision, format: 'workspace-revision/2' })
    ).toThrowError(expect.objectContaining({ code: 'unsupported_contract_version' }));
    expect(() => decodeActorRef({ ...actor, token: 'secret' })).toThrow(
      ChangeRunContractError
    );
    expect(() =>
      decodeActorRef({ ...actor, format: 'change-run-actor/2' })
    ).toThrowError(expect.objectContaining({ code: 'unsupported_contract_version' }));
    expect(() =>
      decodeEvidenceRef({ ...evidence, format: 'change-run-evidence-ref/2' })
    ).toThrowError(expect.objectContaining({ code: 'unsupported_contract_version' }));
    expect(() => decodeRunAction({ ...action, command: {} })).toThrow(
      ChangeRunContractError
    );
    expect(() =>
      decodeRunAction({ ...action, format: 'change-run-action/2' })
    ).toThrowError(expect.objectContaining({ code: 'unsupported_contract_version' }));
    expect(() =>
      decodeCompletion({
        format: 'change-run-completion/1',
        kind: 'domain-action-result',
        change: { projectRoot: '.', changeId: 'fixture-change' },
        runId: ids.runId,
        actionId: ids.actionId,
        invocationId: ids.invocationId,
        receiptDigest: ids.digest,
        actor,
        actorAttestation: evidence,
        evidence: [evidence],
        effectId: ids.effectId,
        status: 'succeeded',
        result: {},
      })
    ).toThrow(ChangeRunContractError);
    expect(() =>
      decodeControl({
        format: 'change-run-control/2',
        ref: {
          change: { projectRoot: '.', changeId: 'fixture-change' },
          runId: ids.runId,
        },
        expectedRecordVersion: 1,
        command: { kind: 'cancel' },
      })
    ).toThrowError(expect.objectContaining({ code: 'unsupported_contract_version' }));
  });

  it('preserves additive view sections but rejects unknown top-level majors', () => {
    const candidate = view();
    candidate.sections.push({
      kind: 'future-diagnostics',
      version: 1,
      note: 'preserved',
    } as never);
    expect(decodeChangeRunView(candidate).sections[1]).toEqual({
      kind: 'future-diagnostics',
      version: 1,
      note: 'preserved',
    });
    expect(() =>
      decodeChangeRunView({ ...candidate, format: 'change-run-view/2' })
    ).toThrowError(expect.objectContaining({ code: 'unsupported_view_version' }));
  });

  it('strictly decodes known goal/lifecycle sections and preserves future lifecycle versions', () => {
    const candidate = view();
    candidate.sections.push({
      kind: 'goal',
      version: 1,
      loopPath: 'root/goal-loop',
      variant: 'measure',
      round: 2,
      phase: 'judge',
      lastScore: 0.72,
      lastGaps: [],
    } as never);
    candidate.sections.push({
      kind: 'bounded-loop-lifecycle',
      version: 1,
      loopPath: 'root/goal-loop',
      bodyKind: 'goal-cycle',
      state: 'running',
      iteration: 2,
      phase: 'judge',
      limits: {
        iterations: { used: 2, max: 5 },
        actions: { used: 4, max: 12 },
        budget: { used: 4, max: 12 },
      },
      progressFingerprint: ids.digest,
      stallStreak: 1,
      blockedStreak: 0,
      strategy: { attempts: 0, maxAttempts: 2 },
    } as never);
    candidate.sections.push({
      kind: 'bounded-loop-lifecycle',
      version: 2,
      loopPath: 'root/future-loop',
      futureCounter: 99,
    } as never);

    const decoded = decodeChangeRunView(candidate);
    expect(decoded.sections[1]).toMatchObject({ kind: 'goal', lastScore: 0.72 });
    expect(decoded.sections[2]).toMatchObject({
      kind: 'bounded-loop-lifecycle',
      version: 1,
      limits: { actions: { used: 4, max: 12 } },
    });
    expect(decoded.sections[3]).toEqual({
      kind: 'bounded-loop-lifecycle',
      version: 2,
      loopPath: 'root/future-loop',
      futureCounter: 99,
    });

    const invalidKnown = view();
    invalidKnown.sections.push({
      kind: 'goal', version: 1, loopPath: 'root/goal-loop', variant: 'measure',
      round: 1, phase: 'judge', lastGaps: [], lifecycleCounter: 1,
    } as never);
    expect(() => decodeChangeRunView(invalidKnown)).toThrow(ChangeRunContractError);
  });

  it('enforces stable arrays, closure, status, scope and receipt grant invariants', () => {
    const unsorted = view();
    const section = unsorted.sections[0]!;
    section.frontier = [
      `node:${'f'.repeat(64)}`,
      `node:${'0'.repeat(64)}`,
    ];
    expect(() => decodeChangeRunView(unsorted)).toThrowError(
      expect.objectContaining({ code: 'invalid_run_invariant' })
    );

    const other = view();
    other.workspace.scope = 'other';
    expect(() => decodeChangeRunView(other)).toThrowError(
      expect.objectContaining({ code: 'invalid_run_invariant' })
    );

    expect(() =>
      decodeChangeRunReceipt({
        format: 'change-run-receipt/1',
        disposition: 'reused',
        view: view(),
        actions: [action],
      })
    ).toThrowError(expect.objectContaining({ code: 'invalid_run_invariant' }));

    expect(
      decodeChangeRunReceipt({
        format: 'change-run-receipt/1',
        disposition: 'advanced',
        view: view(),
        actions: [action],
      }).actions
    ).toHaveLength(1);
  });

  it('allows branch-local waits beside active Actions and forbids terminal overlap', () => {
    const coexist = view();
    coexist.sections[0]!.waits = [
      {
        kind: 'gate',
        waitId: ids.waitId,
        nodeId: `node:${'c'.repeat(64)}`,
        invocationId: `invocation:${'d'.repeat(64)}`,
        occurrence: 0,
        gateId: 'approve',
        decisionIds: ['approved', 'rejected'],
      },
    ];
    expect(decodeChangeRunView(coexist).status).toBe('running');

    const terminal = view();
    terminal.status = 'completed';
    terminal.sections[0]!.terminal = { kind: 'completed', outcome: 'done' };
    expect(() => decodeChangeRunView(terminal)).toThrowError(
      expect.objectContaining({ code: 'invalid_run_invariant' })
    );

    const mismatched = view();
    mismatched.status = 'waiting';
    expect(() => decodeChangeRunView(mismatched)).toThrowError(
      expect.objectContaining({ code: 'invalid_run_invariant' })
    );
  });

  it('derives receipt disposition in the exact contract priority order', () => {
    const base = {
      created: false,
      reused: false,
      idempotent: false,
      becameTerminal: false,
      grantedActionCount: 1,
      waitCount: 1,
    };
    expect(deriveReceiptDisposition({ ...base, created: true, reused: true })).toBe(
      'created'
    );
    expect(
      deriveReceiptDisposition({ ...base, reused: true, idempotent: true })
    ).toBe('reused');
    expect(
      deriveReceiptDisposition({
        ...base,
        idempotent: true,
        becameTerminal: true,
      })
    ).toBe('idempotent');
    expect(
      deriveReceiptDisposition({ ...base, becameTerminal: true })
    ).toBe('terminal');
    expect(
      deriveReceiptDisposition({
        ...base,
        grantedActionCount: 0,
        waitCount: 2,
      })
    ).toBe('waiting');
    expect(deriveReceiptDisposition(base)).toBe('advanced');
  });
});
