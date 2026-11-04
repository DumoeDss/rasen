import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertTaskLoopMayDeliver,
  assertTaskLoopPlanIdentity,
  decodeTaskLoopInput,
  projectTaskLoopSection,
  TASK_LOOP_ACTOR_ATTESTATION_SCHEMA,
  TASK_LOOP_CRITERION_EVIDENCE_SCHEMA,
  TASK_LOOP_WORK_EVIDENCE_SCHEMA,
  TaskLoopDomainError,
  validateTaskLoopJudgment,
  writeTaskLoopReport,
} from '../../../src/core/change-run/internal/task-loop.js';
import { buildEvidenceRef } from '../../../src/core/change-run/internal/evidence.js';
import { buildAgentActor } from '../../../src/core/change-run/internal/actors.js';
import { decodeCanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import { reconcile } from '../../../src/core/change-run/internal/reconciler.js';
import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import { projectGoalCycleProgress } from '../../../src/core/change-run/internal/goal-cycle-runtime.js';
import { projectRunView } from '../../../src/core/change-run/internal/projector.js';
import { createInMemoryRunStore } from '../../../src/core/change-run/internal/run-store.js';
import { createChangePipelineRuntime } from '../../../src/core/change-run/internal/facade-runtime.js';
import {
  agentAction,
  evidenceFor,
  fixtureDigests,
  startRecord,
} from './reconciler-fixture.js';
import type { CanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import type { JsonValue, RunAction } from '../../../src/core/change-run/contracts.js';
import { fixtureRuntimeLoop } from './bounded-loop-fixture.js';

const projectRoot = path.resolve('temporary task-loop workspace', '项目');

const existingProjectRoot = process.cwd();

function validInput() {
  return {
    format: 'task-loop-input/1' as const,
    goal: 'Make the focused result observable.',
    artifactTargets: ['src/feature.ts'],
    bar: [
      {
        id: 'focused-check',
        criterion: 'The focused check passes.',
        evidenceHint: 'Run pnpm exec vitest run test/feature.test.ts.',
      },
    ],
    constraints: ['Do not change the public command tree.'],
  };
}

describe('task-loop input contract', () => {
  it('freezes a valid task-loop-input/1 contract', () => {
    const contract = decodeTaskLoopInput(validInput(), { projectRoot: existingProjectRoot });

    expect(contract).toEqual(validInput());
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.bar)).toBe(true);
    expect(Object.isFrozen(contract.bar[0])).toBe(true);
  });

  it.each([
    [undefined, 'task_loop_input_missing'],
    [{ ...validInput(), format: 'task-loop-input/2' }, 'task_loop_input_invalid'],
    [{ ...validInput(), goal: '' }, 'task_loop_input_invalid'],
    [{ ...validInput(), artifactTargets: [] }, 'task_loop_bar_unprovable'],
    [{ ...validInput(), bar: [] }, 'task_loop_bar_unprovable'],
    [
      {
        ...validInput(),
        bar: [
          validInput().bar[0],
          { ...validInput().bar[0], criterion: 'A duplicate is rejected.' },
        ],
      },
      'task_loop_input_invalid',
    ],
    [
      {
        ...validInput(),
        bar: [{ ...validInput().bar[0], evidenceHint: '' }],
      },
      'task_loop_bar_unprovable',
    ],
  ])('rejects invalid contract %# with a stable code', (input, code) => {
    expect(() => decodeTaskLoopInput(input, { projectRoot: existingProjectRoot })).toThrowError(
      expect.objectContaining<TaskLoopDomainError>({ code })
    );
  });

  it('accepts authorized absolute, spaced, and non-ASCII local targets', () => {
    const projectRoot = existingProjectRoot;
    const absolute = path.join(projectRoot, 'src', '带 空格.ts');
    const contract = decodeTaskLoopInput(
      {
        ...validInput(),
        artifactTargets: [absolute, path.join('src', '另一个 文件.ts')],
      },
      { projectRoot: existingProjectRoot }
    );

    expect(contract.artifactTargets).toEqual([
      absolute,
      path.join('src', '另一个 文件.ts'),
    ]);
  });

  it('rejects local targets that escape the authorized project root', () => {
    expect(() =>
      decodeTaskLoopInput(
        { ...validInput(), artifactTargets: [path.join('..', 'outside.ts')] },
        { projectRoot: existingProjectRoot }
      )
    ).toThrowError(
      expect.objectContaining<TaskLoopDomainError>({
        code: 'task_loop_input_invalid',
      })
    );
  });
});

describe('task-loop critic contract', () => {
  const contract = decodeTaskLoopInput(validInput(), { projectRoot: existingProjectRoot });
  const evidenceFixture = canonicalTaskLoopFixture();
  const evidenceAction = agentAction(
    evidenceFixture.plan,
    'root/iterate/round:1/phase:judge'
  );
  const rawEvidence = [
    buildEvidenceRef({
      content: new TextEncoder().encode('focused-check passed'),
      mediaType: 'text/plain',
      observationKind: 'focused-check',
      producer: {
        id: 'task-loop-test',
        version: '1',
        identityDigest: fixtureDigests.capabilityDigest,
      },
      binding: {
        planningSpaceId: evidenceFixture.record.change.planningSpaceId,
        changeInstanceId: evidenceFixture.record.change.instanceId,
        projectId: evidenceFixture.record.change.projectId,
        changeId: evidenceFixture.record.change.changeId,
        runId: evidenceFixture.record.runId,
        actionId: evidenceAction.actionId,
        schema: TASK_LOOP_CRITERION_EVIDENCE_SCHEMA,
      },
    }),
  ];

  function judgment(overrides: Record<string, unknown> = {}) {
    return {
      contract: 'goal-cycle/evaluate-judge/1',
      satisfied: true,
      gaps: [],
      criteria: [
        {
          id: 'focused-check',
          satisfied: true,
          evidence: 'src/feature.ts: focused vitest output passed',
          evidenceDigests: [rawEvidence[0]!.evidenceDigest],
        },
      ],
      ...overrides,
    };
  }

  it('accepts exact, target-bound, raw-evidenced satisfaction', () => {
    expect(
      validateTaskLoopJudgment({
        contract,
        result: judgment(),
        rawEvidence,
        criticSessionIdentity: 'critic-new',
        priorCriticSessionIdentities: [],
      })
    ).toEqual(expect.objectContaining({ satisfied: true, gaps: [] }));
  });

  it.each([
    [
      'task_loop_bar_mismatch',
      judgment({ criteria: [] }),
      rawEvidence,
    ],
    [
      'task_loop_bar_mismatch',
      judgment({
        criteria: [
          judgment().criteria[0],
          { ...judgment().criteria[0], id: 'extra-check' },
        ],
      }),
      rawEvidence,
    ],
    [
      'task_loop_evidence_missing',
      judgment({
        criteria: [{ ...judgment().criteria[0], evidence: 'looks good' }],
      }),
      rawEvidence,
    ],
    ['task_loop_evidence_missing', judgment(), []],
    [
      'task_loop_false_satisfaction',
      judgment({
        criteria: [{ ...judgment().criteria[0], satisfied: false }],
      }),
      rawEvidence,
    ],
  ])('rejects invalid criticism with %s', (code, result, evidence) => {
    expect(() =>
      validateTaskLoopJudgment({
        contract,
        result,
        rawEvidence: evidence as never,
        criticSessionIdentity: 'critic-new',
        priorCriticSessionIdentities: [],
      })
    ).toThrowError(expect.objectContaining<TaskLoopDomainError>({ code }));
  });

  it('requires one largest gap and an explicit pass condition when unsatisfied', () => {
    const result = validateTaskLoopJudgment({
      contract,
      result: judgment({
        satisfied: false,
        gaps: ['The focused check still fails.'],
        largestGap: 'The focused check still fails.',
        passCondition: 'pnpm exec vitest run test/feature.test.ts exits zero.',
        criteria: [{ ...judgment().criteria[0], satisfied: false }],
      }),
      rawEvidence,
      criticSessionIdentity: 'critic-new',
      priorCriticSessionIdentities: [],
    });

    expect(result).toEqual(
      expect.objectContaining({
        satisfied: false,
        largestGap: 'The focused check still fails.',
        passCondition: 'pnpm exec vitest run test/feature.test.ts exits zero.',
      })
    );
  });

  it('rejects every critic identity used by an earlier round', () => {
    expect(() =>
      validateTaskLoopJudgment({
        contract,
        result: judgment(),
        rawEvidence,
        criticSessionIdentity: 'critic-round-1',
        priorCriticSessionIdentities: ['critic-round-1'],
      })
    ).toThrowError(
      expect.objectContaining<TaskLoopDomainError>({
        code: 'task_loop_critic_reused',
      })
    );
  });

  it.each([
    ['wrong action', { actionId: `action:${'9'.repeat(64)}` }],
    ['wrong run', { runId: `run:${'9'.repeat(64)}` }],
    ['wrong change', { changeId: 'another-change' }],
    ['wrong schema', { schema: 'unrelated/1' }],
    ['stale tree', { treeDigest: `sha256:${'9'.repeat(64)}` }],
  ])('rejects criterion evidence bound to the %s', (_label, overrides) => {
    const expectedTree = `sha256:${'2'.repeat(64)}` as never;
    const ref = buildEvidenceRef({
      content: new TextEncoder().encode(`bound-evidence:${_label}`),
      mediaType: 'application/json',
      observationKind: 'task-loop-bound-evidence',
      producer: {
        id: 'task-loop-test',
        version: '1',
        identityDigest: fixtureDigests.capabilityDigest,
      },
      binding: {
        planningSpaceId: evidenceFixture.record.change.planningSpaceId,
        changeInstanceId: evidenceFixture.record.change.instanceId,
        projectId: evidenceFixture.record.change.projectId,
        changeId: evidenceFixture.record.change.changeId,
        runId: evidenceFixture.record.runId,
        actionId: evidenceAction.actionId,
        schema: TASK_LOOP_CRITERION_EVIDENCE_SCHEMA,
        treeDigest: expectedTree,
        ...overrides,
      } as never,
    });
    const result = judgment({
      criteria: [
        {
          ...judgment().criteria[0],
          evidenceDigests: [ref.evidenceDigest],
        },
      ],
    });

    expect(() =>
      validateTaskLoopJudgment({
        contract,
        result,
        rawEvidence: [ref],
        criticSessionIdentity: 'critic-new',
        priorCriticSessionIdentities: [],
        evidenceContext: {
          record: evidenceFixture.record,
          actionId: evidenceAction.actionId,
          treeDigest: expectedTree,
        },
      })
    ).toThrowError(
      expect.objectContaining({ code: 'task_loop_evidence_missing' })
    );
  });
});

function canonicalTaskLoopFixture() {
  const plan = createRuntimePlan({
    runId: fixtureDigests.runId,
    pipeline: 'task-loop',
    planDigest: fixtureDigests.planDigest,
    profileDigest: fixtureDigests.profileDigest,
    sourceRevisionDigest: fixtureDigests.sourceRevisionDigest,
    capabilityDigest: fixtureDigests.capabilityDigest,
    policyDigest: fixtureDigests.policyDigest,
    implicitFinishOutcome: 'task-loop-completed',
    nodes: [
      {
        kind: 'bounded-loop',
        hierarchicalPath: 'root/iterate',
        requires: [],
        ...fixtureRuntimeLoop(2, 16, 'task_loop_exhausted'),
        body: {
          kind: 'goal-cycle',
          variant: 'evaluate',
          phases: [
            {
              phase: 'work',
              profilePath: 'declaration:task-loop/node:work',
              admissionKind: 'agent',
              workspace: { access: 'write' },
            },
            {
              phase: 'judge',
              profilePath: 'declaration:task-loop/node:judge',
              admissionKind: 'agent',
              workspace: { access: 'read' },
            },
          ],
        },
        outcomes: { clean: 'satisfied', exhausted: 'task_loop_exhausted' },
      },
      {
        kind: 'atomic',
        hierarchicalPath: 'root/ship',
        requires: ['root/iterate'],
        admissionKind: 'agent',
        workspace: { access: 'write' },
      },
      {
        kind: 'atomic',
        hierarchicalPath: 'root/archive',
        requires: ['root/ship'],
        admissionKind: 'agent',
        workspace: { access: 'write' },
      },
    ],
  });
  const record = decodeCanonicalRunRecord({
    ...startRecord(plan),
    inputs: {
      taskLoop: validInput(),
      gatePolicy: { effective: 'off', source: 'flag' },
    },
  });
  return { plan, record };
}

function fixtureActor(
  char: string,
  role: string,
  options: { sessionChar?: string; runtime?: string } = {}
) {
  const sessionChar = options.sessionChar ??
    (char === 'f' ? '0' : String.fromCharCode(char.charCodeAt(0) + 1));
  return buildAgentActor({
    role,
    provider: 'fixture',
    runtime: options.runtime ?? 'codex',
    principalIdentityDigest: `sha256:${char.repeat(64)}` as never,
    sessionIdentityDigest: `sha256:${sessionChar.repeat(64)}` as never,
    adapter: {
      id: `adapter-${role}`,
      version: '1',
      artifactDigest: fixtureDigests.capabilityDigest,
    },
  });
}

function reduce(record: CanonicalRunRecord, stimulus: Parameters<typeof reduceCanonicalRunRecord>[1]) {
  const result = reduceCanonicalRunRecord(record, stimulus);
  if (!result.ok) throw new Error(result.failure.message);
  return result.record;
}

function commitPhase(
  fixture: ReturnType<typeof canonicalTaskLoopFixture>,
  record: CanonicalRunRecord,
  pathName: string,
  actor: ReturnType<typeof fixtureActor>,
  result: JsonValue
): CanonicalRunRecord {
  const baseAction = agentAction(fixture.plan, pathName);
  const expectedRole = pathName.includes('phase:judge')
    ? 'reviewer'
    : pathName === 'root/ship' || pathName === 'root/archive'
      ? 'shipper'
      : 'implementer';
  const priorAfterTree = Object.values(record.actions)
    .flatMap((entry) => {
      const value = entry.result?.result;
      return value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof (value as { afterTree?: unknown }).afterTree === 'string'
        ? [(value as { afterTree: string }).afterTree]
        : [];
    })
    .at(-1);
  const resultObject = result as Readonly<Record<string, JsonValue>>;
  const treeDigest = (
    pathName.includes('phase:work') && typeof resultObject.afterTree === 'string'
      ? resultObject.afterTree
      : priorAfterTree ?? record.initialWorkspaceRevision.treeDigest
  ) as never;
  const action = {
    ...baseAction,
    expectedBeforeWorkspace: {
      ...baseAction.expectedBeforeWorkspace,
      treeDigest: (priorAfterTree ?? record.initialWorkspaceRevision.treeDigest) as never,
    },
    workspace: {
      ...baseAction.workspace,
      access: pathName.includes('phase:judge') ? 'read' : 'write',
    },
    agent: {
      ...baseAction.agent,
      role: expectedRole,
      sandbox: pathName.includes('phase:judge') ? 'read-only' : 'workspace-write',
    },
  } as RunAction;
  const mainSchema = pathName.includes('phase:work')
    ? TASK_LOOP_WORK_EVIDENCE_SCHEMA
    : pathName.includes('phase:judge')
      ? TASK_LOOP_CRITERION_EVIDENCE_SCHEMA
      : 'fixture/1';
  const evidenceRef = buildEvidenceRef({
    content: new TextEncoder().encode(`evidence:${pathName}`),
    mediaType: 'application/json',
    observationKind: 'task-loop-fixture',
    producer: {
      id: 'task-loop-fixture',
      version: '1',
      identityDigest: fixtureDigests.capabilityDigest,
    },
    binding: {
      planningSpaceId: record.change.planningSpaceId,
      changeInstanceId: record.change.instanceId,
      projectId: record.change.projectId,
      changeId: record.change.changeId,
      runId: record.runId,
      actionId: action.actionId,
      schema: mainSchema,
      treeDigest,
    },
  });
  const actorAttestation = buildEvidenceRef({
    content: new TextEncoder().encode(`attestation:${pathName}`),
    mediaType: 'application/json',
    observationKind: 'task-loop-actor-attestation',
    producer: {
      id: 'task-loop-actor-fixture',
      version: '1',
      identityDigest: actor.identityDigest,
    },
    binding: {
      planningSpaceId: record.change.planningSpaceId,
      changeInstanceId: record.change.instanceId,
      projectId: record.change.projectId,
      changeId: record.change.changeId,
      runId: record.runId,
      actionId: action.actionId,
      schema: TASK_LOOP_ACTOR_ATTESTATION_SCHEMA,
      treeDigest,
    },
  });
  const evidence = [evidenceRef];
  const committedResult: JsonValue = pathName.includes('phase:work')
    ? ({ ...resultObject, delta: evidenceRef } as JsonValue)
    : pathName.includes('phase:judge') && Array.isArray(resultObject.criteria)
      ? ({
          ...resultObject,
          criteria: resultObject.criteria.map((criterion) => ({
            ...(criterion as Readonly<Record<string, JsonValue>>),
            evidenceDigests: [evidenceRef.evidenceDigest],
          })),
        } as JsonValue)
      : result;
  let next = reduce(record, {
    kind: 'admit-action',
    action,
    attemptOrdinal: 0,
    deliveryMode: 'grant',
  });
  next = reduce(next, {
    kind: 'observe-effect',
    actionId: action.actionId,
    effectId: action.effects[0]!.effectId,
    status: 'succeeded',
    receiptDigest: fixtureDigests.receiptDigest,
    observation: { ok: true },
    evidence,
  });
  next = reduce(next, {
    kind: 'commit-action-result',
    actionId: action.actionId,
    status: 'succeeded',
    receiptDigest: fixtureDigests.receiptDigest,
    result: committedResult,
    evidence,
    actor,
    actorAttestation,
  });
  return next;
}

function commitTerminalPhase(
  fixture: ReturnType<typeof canonicalTaskLoopFixture>,
  record: CanonicalRunRecord,
  pathName: string,
  status: 'failed' | 'blocked'
): CanonicalRunRecord {
  const action = agentAction(fixture.plan, pathName);
  const evidence = evidenceFor(fixture.plan, action.actionId);
  let next = reduce(record, {
    kind: 'admit-action',
    action,
    attemptOrdinal: 0,
    deliveryMode: 'grant',
  });
  next = reduce(next, {
    kind: 'observe-effect',
    actionId: action.actionId,
    effectId: action.effects[0]!.effectId,
    status: 'succeeded',
    receiptDigest: fixtureDigests.receiptDigest,
    observation: { ok: true },
    evidence,
  });
  return reduce(next, {
    kind: 'commit-action-result',
    actionId: action.actionId,
    status,
    receiptDigest: fixtureDigests.receiptDigest,
    result: status === 'blocked'
      ? {
          contract: 'bounded-loop/blocked/1',
          reasonCode: 'fixture_blocked',
          blockerKey: 'fixture-blocker',
        }
      : { reasonCode: 'fixture_failed' },
    evidence,
  });
}

function workResult(fixture: ReturnType<typeof canonicalTaskLoopFixture>, pathName: string) {
  const action = agentAction(fixture.plan, pathName);
  const round = Number.parseInt(/round:(\d+)/.exec(pathName)?.[1] ?? '1', 10);
  return {
    contract: 'goal-cycle/work-result/1',
    workDescription: `work at ${pathName}`,
    beforeTree: round === 1
      ? fixtureDigests.workspaceDigest
      : `sha256:${String(round).repeat(64)}`,
    afterTree: `sha256:${String(round + 1).repeat(64)}`,
    delta: evidenceFor(fixture.plan, action.actionId)[0]!,
  };
}

function unsatisfiedJudgment() {
  return {
    contract: 'goal-cycle/evaluate-judge/1',
    satisfied: false,
    gaps: ['The focused check still fails.'],
    largestGap: 'The focused check still fails.',
    passCondition: 'pnpm exec vitest run test/feature.test.ts exits zero.',
    criteria: [
      {
        id: 'focused-check',
        satisfied: false,
        evidence: 'src/feature.ts: focused vitest output still fails',
      },
    ],
  };
}

function observedWorkspace(
  record: CanonicalRunRecord,
  treeDigest: string
) {
  return {
    ...record.currentWorkspaceRevision,
    treeDigest,
  } as typeof record.currentWorkspaceRevision;
}

describe('task-loop canonical integration', () => {
  it.each([
    ['wrong ship identity', (plan: ReturnType<typeof canonicalTaskLoopFixture>['plan']) => ({
      ...plan,
      nodes: plan.nodes.map((node) =>
        node.kind === 'atomic' && node.hierarchicalPath === 'root/ship'
          ? { ...node, hierarchicalPath: 'root/publish' }
          : node
      ),
    })],
    ['wrong judge access', (plan: ReturnType<typeof canonicalTaskLoopFixture>['plan']) => ({
      ...plan,
      nodes: plan.nodes.map((node) =>
        node.kind === 'bounded-loop' && node.body.kind === 'goal-cycle'
          ? {
              ...node,
              body: {
                ...node.body,
                phases: node.body.phases.map((phase) =>
                  phase.phase === 'judge'
                    ? { ...phase, workspace: { access: 'write' as const } }
                    : phase
                ),
              },
            }
          : node
      ),
    })],
    ['wrong critic profile', (plan: ReturnType<typeof canonicalTaskLoopFixture>['plan']) => ({
      ...plan,
      nodes: plan.nodes.map((node) =>
        node.kind === 'bounded-loop' && node.body.kind === 'goal-cycle'
          ? {
              ...node,
              body: {
                ...node.body,
                phases: node.body.phases.map((phase) =>
                  phase.phase === 'judge'
                    ? { ...phase, profilePath: 'declaration:other/node:judge' }
                    : phase
                ),
              },
            }
          : node
      ),
    })],
  ])('rejects a task-loop plan with %s', (_label, mutate) => {
    const fixture = canonicalTaskLoopFixture();
    expect(() => assertTaskLoopPlanIdentity(mutate(fixture.plan) as never))
      .toThrowError(
        expect.objectContaining({ code: 'task_loop_pipeline_identity' })
      );
  });

  it('projects phase-safe action input, satisfaction status, delivery, and a non-authoritative report', () => {
    const fixture = canonicalTaskLoopFixture();
    const first = reconcile(fixture.plan, fixture.record);
    expect(first.ok).toBe(true);
    if (!first.ok) throw first.failure;
    const workAdmit = first.actions.find((action) => action.kind === 'admit');
    expect(workAdmit).toEqual(
      expect.objectContaining({
        input: expect.objectContaining({
          taskLoop: expect.objectContaining({
            contract: validInput(),
            phase: 'work',
          }),
        }),
      })
    );

    const workPath = 'root/iterate/round:1/phase:work';
    const workAction = agentAction(fixture.plan, workPath);
    const delta = evidenceFor(fixture.plan, workAction.actionId)[0]!;
    let record = commitPhase(
      fixture,
      fixture.record,
      workPath,
      fixtureActor('a', 'implementer'),
      {
        contract: 'goal-cycle/work-result/1',
        workDescription: 'Builder-private narrative must not enter critic input.',
        beforeTree: fixtureDigests.workspaceDigest,
        afterTree: `sha256:${'2'.repeat(64)}`,
        delta,
      }
    );

    const second = reconcile(fixture.plan, record);
    expect(second.ok).toBe(true);
    if (!second.ok) throw second.failure;
    const judgeAdmit = second.actions.find((action) => action.kind === 'admit');
    expect(judgeAdmit).toEqual(
      expect.objectContaining({
        input: expect.objectContaining({
          taskLoop: expect.objectContaining({
            phase: 'judge',
            artifactTargets: ['src/feature.ts'],
            rawEvidence: expect.any(Array),
          }),
        }),
      })
    );
    expect(JSON.stringify(judgeAdmit)).not.toContain('Builder-private narrative');

    const judgePath = 'root/iterate/round:1/phase:judge';
    record = commitPhase(
      fixture,
      record,
      judgePath,
      fixtureActor('c', 'reviewer'),
      {
        contract: 'goal-cycle/evaluate-judge/1',
        satisfied: true,
        gaps: [],
        criteria: [
          {
            id: 'focused-check',
            satisfied: true,
            evidence: 'src/feature.ts: focused vitest output passed',
          },
        ],
      }
    );

    assertTaskLoopMayDeliver(
      fixture.plan,
      record,
      observedWorkspace(record, `sha256:${'2'.repeat(64)}`)
    );
    const afterJudge = reconcile(fixture.plan, record);
    expect(afterJudge.ok).toBe(true);
    if (!afterJudge.ok) throw afterJudge.failure;
    expect(afterJudge.actions).toEqual([
      expect.objectContaining({ kind: 'admit', nodeId: fixture.plan.nodes[1]!.nodeId }),
    ]);

    const loop = fixture.plan.nodes[0];
    if (loop?.kind !== 'bounded-loop') throw new Error('missing loop');
    const progress = projectGoalCycleProgress(fixture.plan, loop, record);
    const section = projectTaskLoopSection(fixture.plan, record, loop, progress);
    expect(section).toEqual(
      expect.objectContaining({
        kind: 'task-loop',
        outcome: 'satisfied',
        nextAction: 'ship',
        gatePolicy: { effective: 'off', source: 'flag' },
      })
    );
    expect(projectRunView(record, 'active', fixture.plan).sections).toContainEqual(section);

    const reportRoot = mkdtempSync(path.join(tmpdir(), 'rasen-task-loop-report-'));
    try {
      const reportPath = writeTaskLoopReport(reportRoot, fixture.plan, record)!;
      expect(readFileSync(reportPath, 'utf8')).toContain('Contract digest: sha256:');
      const beforeEdit = projectRunView(record, 'active', fixture.plan);
      writeFileSync(reportPath, '# forged satisfaction\n', 'utf8');
      expect(projectRunView(record, 'active', fixture.plan)).toEqual(beforeEdit);
    } finally {
      rmSync(reportRoot, { recursive: true, force: true });
    }

    record = commitPhase(
      fixture,
      record,
      'root/ship',
      fixtureActor('e', 'shipper'),
      { delivered: true }
    );
    const afterShip = reconcile(fixture.plan, record);
    expect(afterShip.ok).toBe(true);
    if (!afterShip.ok) throw afterShip.failure;
    expect(afterShip.actions).toEqual([
      expect.objectContaining({ kind: 'admit', nodeId: fixture.plan.nodes[2]!.nodeId }),
    ]);

    record = commitPhase(
      fixture,
      record,
      'root/archive',
      fixtureActor('f', 'shipper'),
      { archived: true }
    );
    const afterArchive = reconcile(fixture.plan, record);
    expect(afterArchive.ok).toBe(true);
    if (!afterArchive.ok) throw afterArchive.failure;
    expect(afterArchive.actions).toEqual([
      { kind: 'finish', outcome: 'task-loop-completed' },
    ]);
    record = reduce(record, {
      kind: 'finish',
      outcome: 'task-loop-completed',
    });
    expect(record.status).toBe('completed');
  });

  it.each(['blocked', 'failed'] as const)(
    'treats a %s builder as terminal and never exposes delivery actions',
    (status) => {
      const fixture = canonicalTaskLoopFixture();
      const record = commitTerminalPhase(
        fixture,
        fixture.record,
        'root/iterate/round:1/phase:work',
        status
      );
      const outcome = reconcile(fixture.plan, record);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw outcome.failure;
      expect(outcome.actions).toEqual([
        expect.objectContaining({ kind: 'escalate', code: 'task_loop_blocked' }),
      ]);
      expect(outcome.actions).not.toContainEqual(
        expect.objectContaining({ kind: 'admit', nodeId: fixture.plan.nodes[1]!.nodeId })
      );
      expect(() => assertTaskLoopMayDeliver(fixture.plan, record)).toThrowError(
        expect.objectContaining({ code: 'task_loop_delivery_guard' })
      );
    }
  );

  it('regenerates a missing, stale, or edited report from canonical status and surfaces write failure', async () => {
    const fixture = canonicalTaskLoopFixture();
    let record = commitPhase(
      fixture,
      fixture.record,
      'root/iterate/round:1/phase:work',
      fixtureActor('a', 'implementer'),
      workResult(fixture, 'root/iterate/round:1/phase:work')
    );
    record = commitPhase(
      fixture,
      record,
      'root/iterate/round:1/phase:judge',
      fixtureActor('c', 'reviewer'),
      {
        contract: 'goal-cycle/evaluate-judge/1',
        satisfied: true,
        gaps: [],
        criteria: [
          {
            id: 'focused-check',
            satisfied: true,
            evidence: 'src/feature.ts: focused vitest output passed',
          },
        ],
      }
    );
    const reportRoot = mkdtempSync(path.join(tmpdir(), 'rasen-report-regenerate-'));
    try {
      const store = createInMemoryRunStore();
      store.create(fixture.plan.runId, record);
      const runtime = createChangePipelineRuntime({
        store,
        plan: fixture.plan,
        initialRecord: fixture.record,
        buildAction: (descriptor) =>
          agentAction(fixture.plan, descriptor.profilePath ?? 'root/ship'),
        taskLoopEvidenceDir: reportRoot,
      });
      const ref = {
        change: { projectRoot: existingProjectRoot, changeId: record.change.changeId },
        runId: record.runId,
      } as const;
      await runtime.inspect(ref);
      const reportPath = path.join(reportRoot, 'task-loop-report.md');
      const canonical = readFileSync(reportPath, 'utf8');
      expect(canonical).toContain('## Raw evidence');
      expect(canonical).toContain('| action action:');
      expect(canonical).toContain('| tree sha256:');

      writeFileSync(reportPath, '# forged\n', 'utf8');
      await runtime.inspect(ref);
      expect(readFileSync(reportPath, 'utf8')).toBe(canonical);
      rmSync(reportPath);
      await runtime.resume(ref, { deliveryMode: 'defer' });
      expect(readFileSync(reportPath, 'utf8')).toBe(canonical);

      const unavailable = path.join(reportRoot, 'not-a-directory');
      writeFileSync(unavailable, 'file', 'utf8');
      const failingRuntime = createChangePipelineRuntime({
        store,
        plan: fixture.plan,
        initialRecord: fixture.record,
        buildAction: (descriptor) =>
          agentAction(fixture.plan, descriptor.profilePath ?? 'root/ship'),
        taskLoopEvidenceDir: unavailable,
      });
      expect(() => failingRuntime.inspect(ref)).toThrowError(
        expect.objectContaining({ code: 'run_store_unavailable' })
      );
    } finally {
      rmSync(reportRoot, { recursive: true, force: true });
    }
  });

  it('revalidates the stored final judgment at the delivery boundary', () => {
    const fixture = canonicalTaskLoopFixture();
    let record = commitPhase(
      fixture,
      fixture.record,
      'root/iterate/round:1/phase:work',
      fixtureActor('a', 'implementer'),
      workResult(fixture, 'root/iterate/round:1/phase:work')
    );
    record = commitPhase(
      fixture,
      record,
      'root/iterate/round:1/phase:judge',
      fixtureActor('c', 'reviewer'),
      {
        contract: 'goal-cycle/evaluate-judge/1',
        satisfied: true,
        gaps: [],
        criteria: [
          {
            id: 'wrong-check',
            satisfied: true,
            evidence: 'src/feature.ts: unrelated output passed',
          },
        ],
      }
    );

    expect(() =>
      assertTaskLoopMayDeliver(
        fixture.plan,
        record,
        observedWorkspace(record, `sha256:${'2'.repeat(64)}`)
      )
    ).toThrowError(
      expect.objectContaining({ code: 'task_loop_bar_mismatch' })
    );
  });

  it.each([
    [
      'same builder session',
      fixtureActor('c', 'reviewer', { sessionChar: 'b' }),
      'task_loop_critic_reused',
    ],
    [
      'wrong role',
      fixtureActor('c', 'implementer'),
      'task_loop_actor_invalid',
    ],
    [
      'wrong runtime',
      fixtureActor('c', 'reviewer', { runtime: 'claude' }),
      'task_loop_actor_invalid',
    ],
  ])('rejects a critic with %s', (_label, critic, code) => {
    const fixture = canonicalTaskLoopFixture();
    let record = commitPhase(
      fixture,
      fixture.record,
      'root/iterate/round:1/phase:work',
      fixtureActor('a', 'implementer'),
      workResult(fixture, 'root/iterate/round:1/phase:work')
    );
    record = commitPhase(
      fixture,
      record,
      'root/iterate/round:1/phase:judge',
      critic,
      {
        contract: 'goal-cycle/evaluate-judge/1',
        satisfied: true,
        gaps: [],
        criteria: [
          {
            id: 'focused-check',
            satisfied: true,
            evidence: 'src/feature.ts: focused vitest output passed',
          },
        ],
      }
    );

    expect(() =>
      assertTaskLoopMayDeliver(
        fixture.plan,
        record,
        observedWorkspace(record, `sha256:${'2'.repeat(64)}`)
      )
    ).toThrowError(expect.objectContaining({ code }));
  });

  it('rejects a critic completion with a missing actor attestation', () => {
    const fixture = canonicalTaskLoopFixture();
    let record = commitPhase(
      fixture,
      fixture.record,
      'root/iterate/round:1/phase:work',
      fixtureActor('a', 'implementer'),
      workResult(fixture, 'root/iterate/round:1/phase:work')
    );
    record = commitPhase(
      fixture,
      record,
      'root/iterate/round:1/phase:judge',
      fixtureActor('c', 'reviewer'),
      {
        contract: 'goal-cycle/evaluate-judge/1',
        satisfied: true,
        gaps: [],
        criteria: [
          {
            id: 'focused-check',
            satisfied: true,
            evidence: 'src/feature.ts: focused vitest output passed',
          },
        ],
      }
    );
    const judgeEntry = Object.entries(record.actions).find(
      ([, entry]) => entry.result?.actor?.role === 'reviewer'
    );
    if (judgeEntry === undefined) throw new Error('missing judge fixture');
    const [judgeActionId, judge] = judgeEntry;
    const { actorAttestation: _removed, ...resultWithoutAttestation } = judge.result!;
    const missingAttestation = decodeCanonicalRunRecord({
      ...record,
      actions: {
        ...record.actions,
        [judgeActionId]: { ...judge, result: resultWithoutAttestation },
      },
    });

    expect(() =>
      assertTaskLoopMayDeliver(
        fixture.plan,
        missingAttestation,
        observedWorkspace(missingAttestation, `sha256:${'2'.repeat(64)}`)
      )
    ).toThrowError(
      expect.objectContaining({ code: 'malformed_goal_cycle_result' })
    );
  });

  it('feeds the exact prior gap into round two and exhausts without spec fallback or delivery', () => {
    const fixture = canonicalTaskLoopFixture();
    let record = commitPhase(
      fixture,
      fixture.record,
      'root/iterate/round:1/phase:work',
      fixtureActor('a', 'implementer'),
      workResult(fixture, 'root/iterate/round:1/phase:work')
    );
    record = commitPhase(
      fixture,
      record,
      'root/iterate/round:1/phase:judge',
      fixtureActor('c', 'reviewer'),
      unsatisfiedJudgment()
    );

    const roundTwo = reconcile(fixture.plan, record);
    expect(roundTwo.ok).toBe(true);
    if (!roundTwo.ok) throw roundTwo.failure;
    expect(roundTwo.actions).toContainEqual(
      expect.objectContaining({
        kind: 'admit',
        input: expect.objectContaining({
          taskLoop: expect.objectContaining({
            phase: 'work',
            feedback: {
              largestGap: 'The focused check still fails.',
              passCondition: 'pnpm exec vitest run test/feature.test.ts exits zero.',
            },
          }),
        }),
      })
    );

    record = commitPhase(
      fixture,
      record,
      'root/iterate/round:2/phase:work',
      fixtureActor('a', 'implementer'),
      workResult(fixture, 'root/iterate/round:2/phase:work')
    );
    record = commitPhase(
      fixture,
      record,
      'root/iterate/round:2/phase:judge',
      fixtureActor('d', 'reviewer'),
      unsatisfiedJudgment()
    );

    const exhausted = reconcile(fixture.plan, record);
    expect(exhausted.ok).toBe(true);
    if (!exhausted.ok) throw exhausted.failure;
    expect(exhausted.actions).toEqual([
      expect.objectContaining({ kind: 'escalate', code: 'task_loop_exhausted' }),
    ]);
    expect(exhausted.actions).not.toContainEqual(
      expect.objectContaining({ kind: 'admit', nodeId: fixture.plan.nodes[1]!.nodeId })
    );
    expect(() => assertTaskLoopMayDeliver(fixture.plan, record)).toThrowError(
      expect.objectContaining({ code: 'task_loop_delivery_guard' })
    );
  });

  it('keeps no-gate task loops non-deliverable before satisfaction and after cancellation', () => {
    const fixture = canonicalTaskLoopFixture();
    expect(() => assertTaskLoopMayDeliver(fixture.plan, fixture.record)).toThrowError(
      expect.objectContaining({ code: 'task_loop_delivery_guard' })
    );
    const cancelled = reduce(fixture.record, {
      kind: 'cancel',
      reason: 'user stopped the loop',
    });
    const outcome = reconcile(fixture.plan, cancelled);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw outcome.failure;
    expect(outcome.actions).toEqual([]);
    expect(() => assertTaskLoopMayDeliver(fixture.plan, cancelled)).toThrowError(
      expect.objectContaining({ code: 'task_loop_delivery_guard' })
    );
  });
});
