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
import {
  projectReviewCycleDomainSnapshot,
  projectReviewCycleProgress,
  reviewCycleInvocation,
} from '../../../src/core/change-run/internal/review-cycle-runtime.js';
import { startRecord } from './reconciler-fixture.js';

const branded = <T>(value: string): T => value as T;
const digest = (char: string) =>
  branded<Digest>(`sha256:${char.repeat(64)}`);

function plan(maxIterations = 3, withStrategy = false): RuntimePlan {
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
        limits: {
          maxIterations,
          maxActions: maxIterations * 16,
          budget: maxIterations * 16,
        },
        lifecycle: {
          version: 1,
          thresholds: { stallIterations: 99, sameBlockerAttempts: 99 },
          strategy: withStrategy
            ? {
                maxAttempts: 1,
                requireMaterialChange: true,
                capability: { id: 'review-cycle:strategy', version: '1' },
              }
            : { maxAttempts: 0, requireMaterialChange: true },
          exits: {
            iterationLimit: withStrategy
              ? { action: 'strategy' }
              : { action: 'escalate', outcome: 'review_cycle_exhausted' },
            actionLimit: { action: 'escalate', outcome: 'review_cycle_action_limit' },
            budgetLimit: { action: 'escalate', outcome: 'review_cycle_budget_limit' },
            stalled: { action: 'escalate', outcome: 'review_cycle_stalled' },
            blocked: { action: 'escalate', outcome: 'review_cycle_blocked' },
            strategyExhausted: { action: 'escalate', outcome: 'review_cycle_strategy_exhausted' },
          },
        },
        ...(withStrategy
          ? { strategyProfilePath: 'declaration:review-cycle/node:strategy' }
          : {}),
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

function createHarness(maxIterations = 3, withStrategy = false) {
  const runtimePlan = plan(maxIterations, withStrategy);
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
    initial,
    buildAction,
    runtime: createChangePipelineRuntime({
      store,
      plan: runtimePlan,
      initialRecord: initial,
      buildAction,
    }),
  };
}

function restartHarness(harness: ReturnType<typeof createHarness>): void {
  harness.runtime = createChangePipelineRuntime({
    store: harness.store,
    plan: harness.plan,
    initialRecord: harness.initial,
    buildAction: harness.buildAction,
  });
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

async function completeBlocked(
  harness: ReturnType<typeof createHarness>,
  action: RunAction,
  eventActor: ReturnType<typeof actor>
) {
  const base = {
    format: 'change-run-completion/1' as const,
    kind: 'domain-action-result' as const,
    change: { projectRoot: '/root', changeId: 'fixture-change' },
    runId: action.runId,
    actionId: action.actionId,
    invocationId: action.invocationId,
    receiptDigest: digest('0'),
    actor: eventActor,
    actorAttestation: evidence(action, 'c'),
    evidence: [evidence(action, 'e')],
    status: 'blocked' as const,
    result: {
      contract: 'bounded-loop/blocked/1',
      reasonCode: 'dependency_unavailable',
      blockerKey: 'fixture:review-dependency',
      detail: 'Retry after restoring the fixture dependency.',
    },
  };
  return harness.runtime.complete(
    { ...base, receiptDigest: computeCompletionReceiptDigest(base) },
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

  it('projects stable unresolved and accepted-known progress without actor or prose fields', async () => {
    const harness = createHarness();
    const reviewer = actor('a', 'reviewer');
    const triager = actor('e', 'triager');
    const fixer = actor('f', 'fixer');
    const verifier = actor('7', 'verifier');
    let action = expectOneAction(
      await harness.runtime.start(
        {
          change: { projectRoot: '/root', changeId: 'fixture-change' },
          pipeline: harness.plan.pipeline,
          launchRequestId: branded(`launch:${'b'.repeat(64)}`),
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
            id: 'F-Z',
            severity: 'major',
            claim: 'Prose Z is excluded.',
            evidence: [evidence(action, '1')],
            status: 'open',
          },
          {
            id: 'F-A',
            severity: 'minor',
            claim: 'Prose A is excluded.',
            evidence: [evidence(action, '2')],
            status: 'accepted_known',
          },
          {
            id: 'F-B',
            severity: 'blocker',
            claim: 'Prose B is excluded.',
            evidence: [evidence(action, '3')],
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
            findingId: 'F-Z',
            disposition: 'route_fixer',
            rationale: 'Fix Z.',
          },
          {
            findingId: 'F-B',
            disposition: 'route_fixer',
            rationale: 'Fix B.',
          },
        ],
      })
    );
    action = expectOneAction(
      await complete(harness, action, fixer, {
        contract: 'review-cycle/fix-result/1',
        findingIds: ['F-Z', 'F-B'],
        beforeTree: digest('1'),
        afterTree: digest('2'),
        delta: evidence(action, '4'),
        tests: [],
      })
    );
    await complete(harness, action, verifier, {
      contract: 'review-cycle/verification-result/1',
      verifications: [
        {
          findingId: 'F-Z',
          verdict: 'still_open',
          evidence: [evidence(action, '5')],
        },
        {
          findingId: 'F-B',
          verdict: 'still_open',
          evidence: [evidence(action, '6')],
        },
      ],
    });

    const loop = harness.plan.nodes[0]!;
    if (loop.kind !== 'bounded-loop') return;
    const snapshot = projectReviewCycleDomainSnapshot(
      harness.plan,
      loop,
      harness.store.load(harness.plan.runId)
    );
    expect(snapshot.progressHistory).toEqual([
      {
        iteration: 1,
        material: {
          unresolved: [
            { id: 'F-B', severity: 'blocker', status: 'open' },
            { id: 'F-Z', severity: 'major', status: 'open' },
          ],
          acceptedKnown: [{ id: 'F-A', severity: 'minor' }],
        },
      },
    ]);
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

describe('ReviewCycle failure-first guards', () => {
  it('rejects a malformed review result before Record mutation', async () => {
    const harness = createHarness();
    const reviewer = actor('a', 'reviewer');
    const started = await harness.runtime.start(
      {
        change: { projectRoot: '/root', changeId: 'fixture-change' },
        pipeline: harness.plan.pipeline,
        launchRequestId: branded(`launch:${'3'.repeat(64)}`),
      },
      { deliveryMode: 'grant' }
    );
    const review = expectOneAction(started);
    const recordBefore = harness.store.load(harness.plan.runId);

    await expect(
      complete(harness, review, reviewer, {
        contract: 'wrong-contract',
        outcome: 'clean',
        findings: [],
      } as never)
    ).rejects.toMatchObject({ code: 'malformed_review_cycle_result' });

    // Record was not mutated.
    expect(harness.store.load(harness.plan.runId)).toBe(recordBefore);
  });

  it('rejects same-actor fixer + verifier re-review before Record mutation', async () => {
    const harness = createHarness();
    const reviewer = actor('a', 'reviewer');
    const triager = actor('e', 'triager');
    const fixer = actor('f', 'fixer');

    let action = expectOneAction(
      await harness.runtime.start(
        {
          change: { projectRoot: '/root', changeId: 'fixture-change' },
          pipeline: harness.plan.pipeline,
          launchRequestId: branded(`launch:${'4'.repeat(64)}`),
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
            claim: 'Broken.',
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
    // Re-review with the SAME actor as fixer → must be rejected.
    const recordBefore = harness.store.load(harness.plan.runId);
    await expect(
      complete(harness, action, fixer, {
        contract: 'review-cycle/verification-result/1',
        verifications: [
          {
            findingId: 'F-1',
            verdict: 'resolved',
            evidence: [evidence(action, '5')],
          },
        ],
      })
    ).rejects.toMatchObject({ code: 'review_cycle_actor_separation' });
    expect(harness.store.load(harness.plan.runId)).toBe(recordBefore);
  });

  it('rejects a clean review while open Major findings exist (ship guard)', async () => {
    const harness = createHarness();
    const reviewer = actor('a', 'reviewer');
    const triager = actor('e', 'triager');
    const fixer = actor('f', 'fixer');
    const verifier = actor('7', 'verifier');

    // First round: find a Major, triage, fix, re-review resolved.
    let action = expectOneAction(
      await harness.runtime.start(
        {
          change: { projectRoot: '/root', changeId: 'fixture-change' },
          pipeline: harness.plan.pipeline,
          launchRequestId: branded(`launch:${'5'.repeat(64)}`),
        },
        { deliveryMode: 'grant' }
      )
    );
    // Round 1 review → findings.
    action = expectOneAction(
      await complete(harness, action, reviewer, {
        contract: 'review-cycle/review-result/1',
        outcome: 'findings',
        findings: [
          {
            id: 'F-1',
            severity: 'major',
            claim: 'Broken.',
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
            rationale: 'Fix.',
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
    // Re-review: F-1 still open → round 2.
    action = expectOneAction(
      await complete(harness, action, verifier, {
        contract: 'review-cycle/verification-result/1',
        verifications: [
          {
            findingId: 'F-1',
            verdict: 'still_open',
            evidence: [evidence(action, '4')],
          },
        ],
      })
    );
    // Round 2 review: try to claim clean while F-1 is still open.
    await expect(
      complete(harness, action, reviewer, {
        contract: 'review-cycle/review-result/1',
        outcome: 'clean',
        findings: [],
      })
    ).rejects.toMatchObject({ code: 'review_cycle_ship_guard' });
  });

  it('rejects a malformed triage result (missing open finding disposition) before commit', async () => {
    const harness = createHarness();
    const reviewer = actor('a', 'reviewer');
    const triager = actor('e', 'triager');

    let action = expectOneAction(
      await harness.runtime.start(
        {
          change: { projectRoot: '/root', changeId: 'fixture-change' },
          pipeline: harness.plan.pipeline,
          launchRequestId: branded(`launch:${'6'.repeat(64)}`),
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
            claim: 'Broken.',
            evidence: [evidence(action, 'f')],
            status: 'open',
          },
          {
            id: 'F-2',
            severity: 'minor',
            claim: 'Typo.',
            evidence: [evidence(action, '7')],
            status: 'open',
          },
        ],
      })
    );
    // Triage that omits F-2 disposition → must be rejected.
    const recordBefore = harness.store.load(harness.plan.runId);
    await expect(
      complete(harness, action, triager, {
        contract: 'review-cycle/triage-result/1',
        decisions: [
          {
            findingId: 'F-1',
            disposition: 'route_fixer',
            rationale: 'Fix F-1.',
          },
        ],
      })
    ).rejects.toMatchObject({ code: 'malformed_review_cycle_result' });
    expect(harness.store.load(harness.plan.runId)).toBe(recordBefore);
  });
});

describe('ReviewCycle happy-path and identity', () => {
  it('finishes clean on round-1 review with no findings', async () => {
    const harness = createHarness();
    const reviewer = actor('a', 'reviewer');

    const started = await harness.runtime.start(
      {
        change: { projectRoot: '/root', changeId: 'fixture-change' },
        pipeline: harness.plan.pipeline,
        launchRequestId: branded(`launch:${'7'.repeat(64)}`),
      },
      { deliveryMode: 'grant' }
    );
    const review = expectOneAction(started);

    const finished = await complete(harness, review, reviewer, {
      contract: 'review-cycle/review-result/1',
      outcome: 'clean',
      findings: [],
    });

    // A clean round-1 review should immediately complete the Run.
    expect(finished.disposition).toBe('terminal');
    expect(finished.view.status).toBe('completed');
    expect(harness.store.load(harness.plan.runId).terminal).toMatchObject({
      kind: 'completed',
    });
  });

  it('blocked -> restart -> exact resume -> fresh review attempt -> restart -> clean', async () => {
    const harness = createHarness();
    const reviewer = actor('a', 'reviewer');
    const retryReviewer = actor('f', 'reviewer');
    const started = await harness.runtime.start(
      {
        change: { projectRoot: '/root', changeId: 'fixture-change' },
        pipeline: harness.plan.pipeline,
        launchRequestId: branded(`launch:${'d'.repeat(64)}`),
      },
      { deliveryMode: 'grant' }
    );
    const firstReview = expectOneAction(started);
    const blocked = await completeBlocked(harness, firstReview, reviewer);
    expect(blocked.actions).toHaveLength(0);
    const blockedRecord = harness.store.load(harness.plan.runId);
    const domainWait = blockedRecord.waits.find((wait) => wait.kind === 'domain-blocked');
    expect(domainWait).toBeDefined();
    if (domainWait === undefined) return;

    restartHarness(harness);
    const resumed = await harness.runtime.control(
      {
        format: 'change-run-control/1',
        ref: {
          change: { projectRoot: '/root', changeId: 'fixture-change' },
          runId: harness.plan.runId,
        },
        expectedRecordVersion: blockedRecord.recordVersion,
        command: { kind: 'resume', waitId: domainWait.waitId },
      },
      { deliveryMode: 'grant' }
    );
    const retryReview = expectOneAction(resumed);
    expect(retryReview.nodeId).toBe(firstReview.nodeId);
    expect(retryReview.actionId).not.toBe(firstReview.actionId);

    restartHarness(harness);
    const finished = await complete(harness, retryReview, retryReviewer, {
      contract: 'review-cycle/review-result/1',
      outcome: 'clean',
      findings: [],
    });
    expect(finished.view.status).toBe('completed');
    expect(harness.store.load(harness.plan.runId).waits).toHaveLength(0);
  });

  it('reconstructs round, phase, finding, actor, evidence from the canonical Record alone', async () => {
    const harness = createHarness();
    const reviewer = actor('a', 'reviewer');
    const triager = actor('e', 'triager');
    const fixer = actor('f', 'fixer');
    const verifier = actor('7', 'verifier');

    const started = await harness.runtime.start(
      {
        change: { projectRoot: '/root', changeId: 'fixture-change' },
        pipeline: harness.plan.pipeline,
        launchRequestId: branded(`launch:${'8'.repeat(64)}`),
      },
      { deliveryMode: 'grant' }
    );
    const reviewAction = expectOneAction(started);

    await complete(harness, reviewAction, reviewer, {
      contract: 'review-cycle/review-result/1',
      outcome: 'findings',
      findings: [
        {
          id: 'F-1',
          severity: 'major',
          claim: 'Invariant broken.',
          evidence: [evidence(reviewAction, 'b')],
          status: 'open',
        },
      ],
    });

    // After the review, the Record should carry committed actor truth.
    const record = harness.store.load(harness.plan.runId);
    const boundedLoop = harness.plan.nodes.find(
      (node) => node.kind === 'bounded-loop'
    )!;
    if (boundedLoop.kind !== 'bounded-loop') return;

    const progress = projectReviewCycleProgress(harness.plan, boundedLoop, record);
    // After review completes, the reconciler admits triage. The progress
    // should be 'waiting' (triage action is active) or 'ready' if not yet
    // admitted.
    expect(['waiting', 'ready']).toContain(progress.kind);
    if (progress.kind !== 'waiting' && progress.kind !== 'ready') return;

    // The next expected phase should be triage, round 1.
    expect(progress.next.round).toBe(1);
    expect(progress.next.phase).toBe('triage');

    // The committed review result should carry actor + attestation.
    const reviewCommitted = Object.values(record.actions).find(
      (entry) => entry.action.nodeId === reviewAction.nodeId
    );
    expect(reviewCommitted?.result).toBeDefined();
    expect(reviewCommitted?.result?.actor?.identityDigest).toBe(
      reviewer.identityDigest
    );
    expect(reviewCommitted?.result?.actorAttestation).toBeDefined();

    // Findings should be reconstructable from the committed results.
    const reviewResult = reviewCommitted?.result?.result as Readonly<{
      findings?: readonly { id: string; severity: string }[];
    }>;
    expect(reviewResult?.findings).toHaveLength(1);
    expect(reviewResult?.findings?.[0]?.id).toBe('F-1');
    expect(reviewResult?.findings?.[0]?.severity).toBe('major');

    // Verify the hierarchical identity path is deterministic.
    const expectedPath = reviewCycleInvocation(
      harness.plan,
      boundedLoop,
      1,
      boundedLoop.body.phases.find((p) => p.phase === 'review')!
    );
    expect(expectedPath.round).toBe(1);
    expect(expectedPath.phase).toBe('review');
    expect(expectedPath.nodeId).toBe(reviewAction.nodeId as never);
  });
});

describe('ReviewCycle recovery at quiescent boundaries', () => {
  it('advances recovered ReviewCycle phases through strategy-scoped paths', async () => {
    const harness = createHarness(1, true);
    const reviewer = actor('a', 'reviewer');
    const triager = actor('e', 'triager');
    const fixer = actor('f', 'fixer');
    const verifier = actor('7', 'verifier');
    const strategist = actor('8', 'strategist');

    let action = expectOneAction(
      await harness.runtime.start(
        {
          change: { projectRoot: '/root', changeId: 'fixture-change' },
          pipeline: harness.plan.pipeline,
          launchRequestId: branded(`launch:${'d'.repeat(64)}`),
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
            claim: 'Recovery is required.',
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
    action = expectOneAction(
      await complete(harness, action, verifier, {
        contract: 'review-cycle/verification-result/1',
        verifications: [
          {
            findingId: 'F-1',
            verdict: 'still_open',
            evidence: [evidence(action, '4')],
          },
        ],
      })
    );
    expect(action.agent.input).toMatchObject({
      boundedLoopStrategy: { attempt: 1, trigger: 'iteration-limit' },
    });

    action = expectOneAction(
      await complete(harness, action, strategist, {
        contract: 'bounded-loop/strategy-result/1',
        strategyKey: 'review-recovery',
        rationale: 'Run a recovered review iteration.',
        intendedChangeSurface: ['review-cycle'],
        evidence: [],
      })
    );
    expect(action.agent.input).toMatchObject({
      reviewCycle: { round: 2, phase: 'review' },
      boundedLoopRecovery: {
        strategyAttempt: 1,
        iteration: 2,
        phase: 'review',
      },
    });

    const recoveryReview = action;
    const next = expectOneAction(
      await complete(harness, recoveryReview, reviewer, {
        contract: 'review-cycle/review-result/1',
        outcome: 'findings',
        findings: [
          {
            id: 'F-1',
            severity: 'major',
            claim: 'Still under review.',
            evidence: [evidence(recoveryReview, '9')],
            status: 'open',
          },
        ],
      })
    );
    expect(next.agent.input).toMatchObject({
      reviewCycle: { round: 2, phase: 'triage' },
      boundedLoopRecovery: {
        strategyAttempt: 1,
        iteration: 2,
        phase: 'triage',
      },
    });

    const recoveryFix = expectOneAction(await complete(harness, next, triager, {
      contract: 'review-cycle/triage-result/1',
      decisions: [{
        findingId: 'F-1',
        disposition: 'route_fixer',
        rationale: 'Apply the recovered fix.',
      }],
    }));
    const recoveryReReview = expectOneAction(await complete(harness, recoveryFix, fixer, {
      contract: 'review-cycle/fix-result/1',
      findingIds: ['F-1'],
      beforeTree: digest('2'),
      afterTree: digest('3'),
      delta: evidence(recoveryFix, '4'),
      tests: [],
    }));
    const recovered = await complete(harness, recoveryReReview, verifier, {
      contract: 'review-cycle/verification-result/1',
      verifications: [{
        findingId: 'F-1',
        verdict: 'resolved',
        evidence: [evidence(recoveryReReview, '5')],
      }],
    });
    expect(recovered.view.status).toBe('completed');
    expect(recovered.view.sections.find((section) => section.kind === 'review-cycle'))
      .toMatchObject({ outcome: 'clean' });
  });

  it('unchanged ReviewCycle recovery terminates at strategy-exhausted', async () => {
    const harness = createHarness(1, true);
    const reviewer = actor('a', 'reviewer');
    const triager = actor('e', 'triager');
    const fixer = actor('f', 'fixer');
    const verifier = actor('7', 'verifier');
    const strategist = actor('8', 'strategist');
    let action = expectOneAction(await harness.runtime.start(
      {
        change: { projectRoot: '/root', changeId: 'fixture-change' },
        pipeline: harness.plan.pipeline,
        launchRequestId: branded(`launch:${'e'.repeat(64)}`),
      },
      { deliveryMode: 'grant' }
    ));
    action = expectOneAction(await complete(harness, action, reviewer, {
      contract: 'review-cycle/review-result/1',
      outcome: 'findings',
      findings: [{
        id: 'F-1', severity: 'major', claim: 'Still open.',
        evidence: [evidence(action, '1')], status: 'open',
      }],
    }));
    action = expectOneAction(await complete(harness, action, triager, {
      contract: 'review-cycle/triage-result/1',
      decisions: [{ findingId: 'F-1', disposition: 'route_fixer', rationale: 'Fix.' }],
    }));
    action = expectOneAction(await complete(harness, action, fixer, {
      contract: 'review-cycle/fix-result/1',
      findingIds: ['F-1'], beforeTree: digest('1'), afterTree: digest('2'),
      delta: evidence(action, '3'), tests: [],
    }));
    action = expectOneAction(await complete(harness, action, verifier, {
      contract: 'review-cycle/verification-result/1',
      verifications: [{
        findingId: 'F-1', verdict: 'still_open', evidence: [evidence(action, '4')],
      }],
    }));
    action = expectOneAction(await complete(harness, action, strategist, {
      contract: 'bounded-loop/strategy-result/1',
      strategyKey: 'review-unchanged-recovery',
      rationale: 'Exercise an unchanged recovered finding set.',
      intendedChangeSurface: ['review-cycle'], evidence: [],
    }));
    action = expectOneAction(await complete(harness, action, reviewer, {
      contract: 'review-cycle/review-result/1',
      outcome: 'findings',
      findings: [{
        id: 'F-1', severity: 'major', claim: 'Still open, reworded.',
        evidence: [evidence(action, '5')], status: 'open',
      }],
    }));
    action = expectOneAction(await complete(harness, action, triager, {
      contract: 'review-cycle/triage-result/1',
      decisions: [{ findingId: 'F-1', disposition: 'route_fixer', rationale: 'Retry.' }],
    }));
    action = expectOneAction(await complete(harness, action, fixer, {
      contract: 'review-cycle/fix-result/1',
      findingIds: ['F-1'], beforeTree: digest('2'), afterTree: digest('3'),
      delta: evidence(action, '6'), tests: [],
    }));
    const exhausted = await complete(harness, action, verifier, {
      contract: 'review-cycle/verification-result/1',
      verifications: [{
        findingId: 'F-1', verdict: 'still_open', evidence: [evidence(action, '7')],
      }],
    });
    expect(exhausted.view.status).toBe('escalated');
    expect(harness.store.load(harness.plan.runId).terminal).toMatchObject({
      kind: 'escalated',
      code: 'review_cycle_strategy_exhausted',
    });
  });

  it('crash-before-commit: active review-phase action stays active on resume', async () => {
    const harness = createHarness();
    const started = await harness.runtime.start(
      {
        change: { projectRoot: '/root', changeId: 'fixture-change' },
        pipeline: harness.plan.pipeline,
        launchRequestId: branded(`launch:${'9'.repeat(64)}`),
      },
      { deliveryMode: 'grant' }
    );
    const reviewAction = expectOneAction(started);

    // Simulate restart: create a fresh facade with the same store + plan.
    const freshRuntime = createChangePipelineRuntime({
      store: harness.store,
      plan: harness.plan,
      initialRecord: startRecord(harness.plan),
      buildAction: (descriptor) => {
        // The same buildAction factory pattern from createHarness
        throw new Error('Test buildAction should not be called on resume with active action.');
      },
    });

    const resumed = await freshRuntime.resume(
      {
        change: { projectRoot: '/root', changeId: 'fixture-change' },
      },
      { deliveryMode: 'grant' }
    );

    // The review action is still active — no re-admit, the Run is waiting.
    expect(resumed.actions).toHaveLength(0);
    const record = harness.store.load(harness.plan.runId);
    const reviewCommitted = record.actions[reviewAction.actionId as ActionId];
    expect(reviewCommitted?.state).toBe('active');
  });

  it('crash-after-commit: review committed, resume admits triage', async () => {
    const harness = createHarness();
    const reviewer = actor('a', 'reviewer');

    const started = await harness.runtime.start(
      {
        change: { projectRoot: '/root', changeId: 'fixture-change' },
        pipeline: harness.plan.pipeline,
        launchRequestId: branded(`launch:${'a'.repeat(64)}`),
      },
      { deliveryMode: 'grant' }
    );
    const reviewAction = expectOneAction(started);

    // Complete the review — this commits the result AND settles the triage admit.
    // To simulate crash-after-commit but before settle, we manually commit just
    // the review result, then create a fresh facade.
    // Since the facade atomically commits both, we instead test: after the
    // complete settles, the triage action should be admitted. Then on resume
    // with a fresh facade, the triage should still be active (not re-admitted).
    await complete(harness, reviewAction, reviewer, {
      contract: 'review-cycle/review-result/1',
      outcome: 'findings',
      findings: [
        {
          id: 'F-1',
          severity: 'major',
          claim: 'Broken.',
          evidence: [evidence(reviewAction, 'b')],
          status: 'open',
        },
      ],
    });

    // Simulate restart: fresh facade.
    const freshRuntime = createChangePipelineRuntime({
      store: harness.store,
      plan: harness.plan,
      initialRecord: startRecord(harness.plan),
      buildAction: () => {
        throw new Error('Should not re-admit on resume with active triage.');
      },
    });

    const resumed = await freshRuntime.resume(
      { change: { projectRoot: '/root', changeId: 'fixture-change' } },
      { deliveryMode: 'grant' }
    );

    // Triage is already admitted — no re-admit.
    expect(resumed.actions).toHaveLength(0);
    const record = harness.store.load(harness.plan.runId);
    // Review result is committed.
    const reviewCommitted = record.actions[reviewAction.actionId as ActionId];
    expect(reviewCommitted?.result).toBeDefined();
    expect(reviewCommitted?.state).toBe('closed');
  });

  it('ack-loss: admitted+granted action stays active on restart', async () => {
    const harness = createHarness();
    const started = await harness.runtime.start(
      {
        change: { projectRoot: '/root', changeId: 'fixture-change' },
        pipeline: harness.plan.pipeline,
        launchRequestId: branded(`launch:${'b'.repeat(64)}`),
      },
      { deliveryMode: 'grant' }
    );
    // Action was admitted AND granted.
    const reviewAction = expectOneAction(started);
    const record = harness.store.load(harness.plan.runId);
    const committed = record.actions[reviewAction.actionId as ActionId];
    expect(committed?.state).toBe('active');
    expect(committed?.deliveryState).toBe('granted');

    // Simulate restart: fresh facade.
    const freshRuntime = createChangePipelineRuntime({
      store: harness.store,
      plan: harness.plan,
      initialRecord: startRecord(harness.plan),
      buildAction: () => {
        throw new Error('Should not re-admit an already-active action.');
      },
    });

    const resumed = await freshRuntime.resume(
      { change: { projectRoot: '/root', changeId: 'fixture-change' } },
      { deliveryMode: 'grant' }
    );

    // No new actions granted (the review action is still active, never completed).
    expect(resumed.actions).toHaveLength(0);
    // The Run is still running (has an active action).
    const resumedRecord = harness.store.load(harness.plan.runId);
    const stillActive = resumedRecord.actions[reviewAction.actionId as ActionId];
    expect(stillActive?.state).toBe('active');
  });

  it('mid-fix-reviews boundary: after fix completes, re-review is admitted with correct context', async () => {
    const harness = createHarness();
    const reviewer = actor('a', 'reviewer');
    const triager = actor('e', 'triager');
    const fixer = actor('f', 'fixer');

    let action = expectOneAction(
      await harness.runtime.start(
        {
          change: { projectRoot: '/root', changeId: 'fixture-change' },
          pipeline: harness.plan.pipeline,
          launchRequestId: branded(`launch:${'c'.repeat(64)}`),
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
            claim: 'Broken.',
            evidence: [evidence(action, 'b')],
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
    const fixAction = action;
    action = expectOneAction(
      await complete(harness, action, fixer, {
        contract: 'review-cycle/fix-result/1',
        findingIds: ['F-1'],
        beforeTree: digest('1'),
        afterTree: digest('2'),
        delta: evidence(fixAction, '3'),
        tests: [],
      })
    );

    // After fix completes, re-review should be admitted.
    expect(action.agent?.input).toMatchObject({
      reviewCycle: { round: 1, phase: 're-review', openFindingIds: ['F-1'] },
    });

    // Simulate restart: fresh facade.
    const freshRuntime = createChangePipelineRuntime({
      store: harness.store,
      plan: harness.plan,
      initialRecord: startRecord(harness.plan),
      buildAction: () => {
        throw new Error('Should not re-admit on resume.');
      },
    });

    const resumed = await freshRuntime.resume(
      { change: { projectRoot: '/root', changeId: 'fixture-change' } },
      { deliveryMode: 'grant' }
    );
    // The re-review action is already active — no re-admit.
    expect(resumed.actions).toHaveLength(0);
  });
});
