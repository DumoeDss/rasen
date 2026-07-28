import { describe, expect, it } from 'vitest';

import type {
  ActionId,
  ChangeInstanceId,
  Digest,
  EvidenceRef,
  JsonValue,
  PlanningSpaceId,
  RunAction,
  RunId,
} from '../../../src/core/change-run/contracts.js';
import { buildAgentAction } from '../../../src/core/change-run/internal/actions.js';
import { buildAgentActor } from '../../../src/core/change-run/internal/actors.js';
import { computeCompletionReceiptDigest } from '../../../src/core/change-run/internal/completion.js';
import { createChangePipelineRuntime } from '../../../src/core/change-run/internal/facade-runtime.js';
import { createInMemoryRunStore } from '../../../src/core/change-run/internal/run-store.js';
import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import type { RuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import { startRecord } from './reconciler-fixture.js';

const branded = <T>(value: string): T => value as T;
const digest = (char: string) =>
  branded<Digest>(`sha256:${char.repeat(64)}`);

function plan(maxIterations = 3): RuntimePlan {
  return createRuntimePlan({
    runId: branded<RunId>(`run:${'a'.repeat(64)}`),
    pipeline: 'review-cycle-runtime',
    planDigest: digest('1'),
    profileDigest: digest('2'),
    sourceRevisionDigest: digest('3'),
    capabilityDigest: digest('4'),
    policyDigest: digest('5'),
    implicitFinishOutcome: 'review-clean',
    nodes: [
      {
        kind: 'bounded-loop',
        hierarchicalPath: 'root/review-cycle',
        requires: [],
        maxIterations,
        body: {
          kind: 'review-cycle',
          phases: [
            {
              phase: 'review',
              profilePath: 'declaration:review-cycle/node:review',
              admissionKind: 'agent',
              workspace: { access: 'read' },
            },
            {
              phase: 'triage',
              profilePath: 'declaration:review-cycle/node:triage',
              admissionKind: 'agent',
              workspace: { access: 'read' },
            },
            {
              phase: 'fix',
              profilePath: 'declaration:review-cycle/node:fix',
              admissionKind: 'agent',
              workspace: { access: 'write' },
            },
            {
              phase: 're-review',
              profilePath: 'declaration:review-cycle/node:re-review',
              admissionKind: 'agent',
              workspace: { access: 'read' },
            },
          ],
        },
        outcomes: {
          clean: 'clean',
          exhausted: 'review_cycle_exhausted',
        },
      },
    ],
  });
}

function actor(char: string, role: string) {
  return buildAgentActor({
    role,
    provider: 'fixture',
    runtime: 'vitest',
    principalIdentityDigest: digest(char),
    sessionIdentityDigest: digest(char === 'a' ? 'b' : 'a'),
    adapter: {
      id: `adapter-${role}`,
      version: '1',
      artifactDigest: digest('c'),
    },
  });
}

function evidence(action: RunAction, char: string): EvidenceRef {
  return {
    format: 'change-run-evidence-ref/1',
    store: 'change-run',
    evidenceDigest: digest(char),
    contentDigest: digest(char),
    mediaType: 'application/json',
    size: 1,
    observationKind: 'review-cycle-runtime-test',
    producer: {
      id: 'vitest',
      version: '1',
      identityDigest: digest('d'),
    },
    binding: {
      planningSpaceId: branded<PlanningSpaceId>(
        `planning-space:${'1'.repeat(64)}`
      ),
      changeInstanceId: branded<ChangeInstanceId>(
        `change-instance:${'2'.repeat(64)}`
      ),
      projectId: 'fixture-project',
      changeId: 'fixture-change',
      runId: action.runId as RunId,
      actionId: action.actionId as ActionId,
      treeDigest: digest('6'),
      schema: 'review-cycle-runtime-test/1',
    },
  };
}

function createHarness(maxIterations = 3) {
  const runtimePlan = plan(maxIterations);
  const initial = startRecord(runtimePlan);
  const store = createInMemoryRunStore();
  const buildAction = (descriptor: {
    nodeId: string;
    occurrence: number;
    admissionKind: 'agent' | 'command' | 'host';
    profilePath?: string;
    input?: JsonValue;
  }): RunAction => {
    if (descriptor.admissionKind !== 'agent' || descriptor.profilePath === undefined) {
      throw new Error('ReviewCycle fixture expects one profile-bound Agent action.');
    }
    const role = descriptor.profilePath.split(':').at(-1)!;
    const access = role === 'fix' ? 'write' : 'read';
    return buildAgentAction(
      {
        capability: {
          nodeId: descriptor.profilePath,
          authoredCapability: {
            id: `review-cycle:${role}`,
            version: '1',
          },
          contract: {
            id: `review-cycle:${role}`,
            version: '1',
            digest: digest('7'),
          },
          actionKind: 'agent',
          resultContract: {
            id: `review-cycle:${role}-result`,
            version: '1',
            digest: digest('8'),
          },
          evidenceContract: {
            id: 'review-cycle-evidence',
            version: '1',
            digest: digest('9'),
          },
          recovery: 'suspend-if-ambiguous',
          workspace: { access, resources: access === 'write' ? ['worktree'] : [] },
          effects: [],
          adapter: {
            id: `adapter:${role}`,
            version: '1',
            contentDigest: digest('b'),
          },
        },
        stage: {
          nodeId: descriptor.profilePath,
          role,
          model: 'fixture',
          effort: 'default',
          runtime: 'vitest',
          sandbox: access === 'write' ? 'workspace-write' : 'read-only',
          gate: false,
          sessionReuse: 'never',
          handoffTokenLimit: 1000,
          reuseRoundLimit: 1,
          provenance: {
            role: 'fixture',
            model: 'fixture',
            effort: 'fixture',
            runtime: 'fixture',
            sandbox: 'fixture',
            gate: 'fixture',
            sessionReuse: 'fixture',
            handoffTokenLimit: 'fixture',
            reuseRoundLimit: 'fixture',
          },
        },
        executionProfileDigest: runtimePlan.profileDigest,
        policyDigest: runtimePlan.policyDigest,
      },
      {
        runId: runtimePlan.runId,
        nodeId: descriptor.nodeId as never,
        occurrence: descriptor.occurrence,
        attemptOrdinal: 0,
        expectedBeforeWorkspace: initial.currentWorkspaceRevision,
      },
      { input: descriptor.input ?? {} }
    );
  };
  return {
    plan: runtimePlan,
    store,
    runtime: createChangePipelineRuntime({
      store,
      plan: runtimePlan,
      initialRecord: initial,
      buildAction,
    }),
  };
}

async function complete(
  harness: ReturnType<typeof createHarness>,
  action: RunAction,
  eventActor: ReturnType<typeof actor>,
  result: JsonValue
) {
  const attestation = evidence(action, 'c');
  const proof = evidence(action, 'e');
  const base = {
    format: 'change-run-completion/1' as const,
    kind: 'domain-action-result' as const,
    change: { projectRoot: '/root', changeId: 'fixture-change' },
    runId: action.runId,
    actionId: action.actionId,
    invocationId: action.invocationId,
    receiptDigest: digest('0'),
    actor: eventActor,
    actorAttestation: attestation,
    evidence: [proof],
    status: 'succeeded' as const,
    result,
  };
  return harness.runtime.complete(
    {
      ...base,
      receiptDigest: computeCompletionReceiptDigest(base),
    },
    { deliveryMode: 'grant' }
  );
}

function expectOneAction(receipt: { actions: readonly RunAction[] }): RunAction {
  expect(receipt.actions).toHaveLength(1);
  return receipt.actions[0]!;
}

describe('ReviewCycle canonical Runtime', () => {
  it('runs finding -> fix -> independent re-review and persists actor truth', async () => {
    const harness = createHarness();
    const reviewer = actor('a', 'reviewer');
    const triager = actor('e', 'triager');
    const fixer = actor('f', 'fixer');
    const verifier = actor('7', 'verifier');

    const started = await harness.runtime.start(
      {
        change: { projectRoot: '/root', changeId: 'fixture-change' },
        pipeline: harness.plan.pipeline,
        launchRequestId: branded(`launch:${'1'.repeat(64)}`),
      },
      { deliveryMode: 'grant' }
    );
    const review = expectOneAction(started);
    expect(review.agent.input).toMatchObject({
      reviewCycle: { round: 1, phase: 'review' },
    });

    const afterReview = await complete(harness, review, reviewer, {
      contract: 'review-cycle/review-result/1',
      outcome: 'findings',
      findings: [
        {
          id: 'F-1',
          severity: 'major',
          claim: 'The invariant is broken.',
          evidence: [evidence(review, 'f')],
          status: 'open',
        },
      ],
    });
    const triage = expectOneAction(afterReview);
    expect(triage.agent.input).toMatchObject({
      reviewCycle: { round: 1, phase: 'triage', openFindingIds: ['F-1'] },
    });

    const afterTriage = await complete(harness, triage, triager, {
      contract: 'review-cycle/triage-result/1',
      decisions: [
        {
          findingId: 'F-1',
          disposition: 'route_fixer',
          rationale: 'A code change is required.',
        },
      ],
    });
    const fix = expectOneAction(afterTriage);

    const afterFix = await complete(harness, fix, fixer, {
      contract: 'review-cycle/fix-result/1',
      findingIds: ['F-1'],
      beforeTree: digest('1'),
      afterTree: digest('2'),
      delta: evidence(fix, '3'),
      tests: [evidence(fix, '4')],
    });
    const reReview = expectOneAction(afterFix);

    await expect(
      complete(harness, reReview, fixer, {
        contract: 'review-cycle/verification-result/1',
        verifications: [
          {
            findingId: 'F-1',
            verdict: 'resolved',
            evidence: [evidence(reReview, '5')],
          },
        ],
      })
    ).rejects.toMatchObject({ code: 'review_cycle_actor_separation' });

    const finished = await complete(harness, reReview, verifier, {
      contract: 'review-cycle/verification-result/1',
      verifications: [
        {
          findingId: 'F-1',
          verdict: 'resolved',
          evidence: [evidence(reReview, '5')],
        },
      ],
    });
    expect(finished.disposition).toBe('terminal');
    expect(finished.view.status).toBe('completed');

    const head = harness.store.load(harness.plan.runId);
    const fixResult = Object.values(head.actions).find(
      (entry) => entry.action.nodeId === fix.nodeId
    )?.result;
    expect(fixResult?.actor?.identityDigest).toBe(fixer.identityDigest);
    expect(fixResult?.actorAttestation).toBeDefined();
  });

  it('escalates at the round cap and never finishes clean with an open Major', async () => {
    const harness = createHarness(1);
    const reviewer = actor('a', 'reviewer');
    const triager = actor('e', 'triager');
    const fixer = actor('f', 'fixer');
    const verifier = actor('7', 'verifier');

    let action = expectOneAction(
      await harness.runtime.start(
        {
          change: { projectRoot: '/root', changeId: 'fixture-change' },
          pipeline: harness.plan.pipeline,
          launchRequestId: branded(`launch:${'2'.repeat(64)}`),
        },
        { deliveryMode: 'grant' }
      )
    );
    action = expectOneAction(
      await complete(harness, action, reviewer, {
        contract: 'review-cycle/review-result/1',
        outcome: 'findings',
        findings: [
          {
            id: 'F-1',
            severity: 'major',
            claim: 'Still broken.',
            evidence: [evidence(action, 'f')],
            status: 'open',
          },
        ],
      })
    );
    action = expectOneAction(
      await complete(harness, action, triager, {
        contract: 'review-cycle/triage-result/1',
        decisions: [
          {
            findingId: 'F-1',
            disposition: 'route_fixer',
            rationale: 'Fix required.',
          },
        ],
      })
    );
    action = expectOneAction(
      await complete(harness, action, fixer, {
        contract: 'review-cycle/fix-result/1',
        findingIds: ['F-1'],
        beforeTree: digest('1'),
        afterTree: digest('2'),
        delta: evidence(action, '3'),
        tests: [],
      })
    );
    const exhausted = await complete(harness, action, verifier, {
      contract: 'review-cycle/verification-result/1',
      verifications: [
        {
          findingId: 'F-1',
          verdict: 'still_open',
          evidence: [evidence(action, '4')],
        },
      ],
    });

    expect(exhausted.disposition).toBe('terminal');
    expect(exhausted.view.status).toBe('escalated');
    expect(harness.store.load(harness.plan.runId).terminal).toMatchObject({
      kind: 'escalated',
      code: 'review_cycle_exhausted',
    });
  });
});
