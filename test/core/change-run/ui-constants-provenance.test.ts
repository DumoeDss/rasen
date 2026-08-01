import { describe, expect, it } from 'vitest';

import { buildAgentActor } from '../../../src/core/change-run/internal/actors.js';
import { projectRunView } from '../../../src/core/change-run/internal/projector.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import {
  agentAction,
  evidenceFor,
  fixtureDigests,
  startRecord,
} from './reconciler-fixture.js';
import type { CanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import type { RuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import type {
  ActorRef,
  Digest,
  EvidenceRef,
  JsonValue,
  RunId,
} from '../../../src/core/change-run/index.js';
import { fixtureRuntimeLoop } from './bounded-loop-fixture.js';

// The UI parity suites and this test read the SAME data module. `packages/ui`
// cannot import the root `src/`, so the module lives on the UI side and the
// kernel side reaches across to it — the one direction that keeps the anchor
// (the projector) authoritative and the copy (the UI constants) derived.
import {
  CANONICAL_CHOICE,
  CANONICAL_CHOICE_UNDECIDED,
  CANONICAL_PARALLEL,
  CANONICAL_PARALLEL_FAILED,
  CANONICAL_REVIEW_CYCLE,
  CANONICAL_REVIEW_CYCLE_ESCALATED,
} from '../../../packages/ui/test/fixtures/canonical-sections.js';

/**
 * PROVENANCE BY CONSTRUCTION (ECP-5 task 4.4, design D5).
 *
 * `packages/ui/test/fixtures/canonical-sections.ts` is the single data module
 * the UI parity suites assert their DOM against. A parity suite whose planes
 * all read one copied literal can only prove the planes agree with each other
 * — the shared-reader lesson from ECP-4, where three planes were wrong
 * identically. This test anchors that module to the KERNEL: each constant is
 * deep-equalled against `projectRunView(record, 'active', plan)` for the
 * fixture documented on the constant, in its JSON wire form.
 *
 * If a projector change alters a section, this test fails FIRST — before any UI
 * test can quietly keep asserting the stale shape.
 *
 * `reviewer-r3-ui-constants-provenance.test.ts` is deliberately left untouched
 * as the regression probe it was kept as; this file supersedes its constant
 * duplication for every section added from here on.
 */

const branded = <T>(value: string): T => value as T;
const digest = (char: string) => branded<Digest>(`sha256:${char.repeat(64)}`);
const RUN_ID = branded<RunId>(`run:${'a'.repeat(64)}`);

function planFor(
  pipeline: string,
  nodes: Parameters<typeof createRuntimePlan>[0]['nodes']
): RuntimePlan {
  return createRuntimePlan({
    runId: RUN_ID,
    pipeline,
    planDigest: branded(`sha256:${'2'.repeat(64)}`),
    profileDigest: branded(`sha256:${'3'.repeat(64)}`),
    sourceRevisionDigest: branded(`sha256:${'4'.repeat(64)}`),
    capabilityDigest: branded(`sha256:${'5'.repeat(64)}`),
    policyDigest: branded(`sha256:${'6'.repeat(64)}`),
    implicitFinishOutcome: 'completed',
    nodes,
  });
}

// --- ECP-4 fixtures: the plans the parallel/choice constants are projected from

function parallelPlan(): RuntimePlan {
  const members = [
    { id: 'review', required: true, condition: 'always' },
    { id: 'cso', required: false, condition: 'security-relevant' },
    { id: 'benchmark', required: false, condition: 'performance-sensitive' },
  ];
  return planFor('ecp4-projection', [
    {
      kind: 'fan-out',
      hierarchicalPath: 'root:experts',
      requires: [],
      admissionKind: 'agent',
      workspace: { access: 'none' },
      fanOut: {
        members: members.map((m) => ({
          hierarchicalPath: `root:experts/${m.id}`,
          required: m.required,
          condition: m.condition,
        })),
        concurrencyCap: 2,
        budget: 3,
        joinNodeId: 'root:experts-join',
      },
    },
    ...members.map((m) => ({
      kind: 'atomic' as const,
      hierarchicalPath: `root:experts/${m.id}`,
      requires: ['root:experts'],
      admissionKind: 'agent' as const,
      workspace: { access: 'read' as const },
      fanOutTag: { nodeId: 'root:experts', required: m.required },
    })),
    {
      kind: 'join',
      hierarchicalPath: 'root:experts-join',
      requires: members.map((m) => `root:experts/${m.id}`),
      join: {
        requiredMembers: ['root:experts/review'],
        optionalMembers: ['root:experts/cso', 'root:experts/benchmark'],
        outcomes: { proceed: 'experts-done', failed: 'experts-failed' },
      },
    },
  ]);
}

function choicePlan(): RuntimePlan {
  return planFor('ecp4-projection', [
    {
      kind: 'choice',
      hierarchicalPath: 'root:pick',
      requires: [],
      admissionKind: 'agent',
      workspace: { access: 'none' },
      choice: {
        outcomes: ['simple', 'complex'],
        branches: { simple: 'root:simple-path', complex: 'root:complex-path' },
      },
    },
    {
      kind: 'atomic',
      hierarchicalPath: 'root:simple-path',
      requires: ['root:pick'],
      admissionKind: 'agent',
      workspace: { access: 'write' },
    },
    {
      kind: 'atomic',
      hierarchicalPath: 'root:complex-path',
      requires: ['root:pick'],
      admissionKind: 'agent',
      workspace: { access: 'write' },
    },
  ]);
}

// --- ECP-1 fixture: the canonical 4-phase ReviewCycle BoundedLoop -----------

function reviewCyclePlan(maxIterations: number): RuntimePlan {
  return planFor('ui-constants-provenance', [
    {
      kind: 'bounded-loop',
      hierarchicalPath: 'root/review-cycle',
      requires: [],
      ...fixtureRuntimeLoop(
        maxIterations,
        maxIterations * 16,
        'review_cycle_exhausted'
      ),
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
      outcomes: { clean: 'clean', exhausted: 'review_cycle_exhausted' },
    },
  ]);
}

// --- Record driving --------------------------------------------------------

function apply(
  record: CanonicalRunRecord,
  stimulus: Parameters<typeof reduceCanonicalRunRecord>[1]
): CanonicalRunRecord {
  const result = reduceCanonicalRunRecord(record, stimulus);
  if (!result.ok) {
    throw new Error(`fixture reducer failed (${result.failure.code}): ${result.failure.message}`);
  }
  return result.record;
}

/** Admit + observe + commit one node's Action, optionally binding an actor. */
function commitNode(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  path: string,
  result: JsonValue = { ok: true },
  status: 'succeeded' | 'failed' = 'succeeded',
  actor?: ActorRef
): CanonicalRunRecord {
  const action = agentAction(plan, path);
  let next = apply(record, {
    kind: 'admit-action',
    action,
    attemptOrdinal: 0,
    deliveryMode: 'grant',
  });
  next = apply(next, {
    kind: 'observe-effect',
    actionId: action.actionId,
    effectId: action.effects[0]!.effectId,
    status: 'succeeded',
    receiptDigest: fixtureDigests.receiptDigest,
    observation: { ok: true } as JsonValue,
    evidence: evidenceFor(plan, action.actionId),
  });
  return apply(next, {
    kind: 'commit-action-result',
    actionId: action.actionId,
    status,
    receiptDigest: fixtureDigests.receiptDigest,
    result,
    evidence: evidenceFor(plan, action.actionId),
    // ReviewCycle phases only become events when the committed result carries
    // BOTH an actor and its attestation (`review-cycle-runtime.ts`); non-loop
    // nodes ignore them.
    ...(actor === undefined
      ? {}
      : { actor, actorAttestation: evidenceFor(plan, action.actionId)[0]! }),
  });
}

/** Admit an Action without committing it — the "in flight" state. */
function admitNode(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  path: string
): CanonicalRunRecord {
  return apply(record, {
    kind: 'admit-action',
    action: agentAction(plan, path),
    attemptOrdinal: 0,
    deliveryMode: 'grant',
  });
}

/** The JSON wire form of one projected section (undefined keys dropped). */
function wireSection(plan: RuntimePlan, record: CanonicalRunRecord, kind: string): unknown {
  const view = projectRunView(record, 'active', plan) as unknown as {
    sections: readonly { kind: string }[];
  };
  return JSON.parse(JSON.stringify(view.sections.find((s) => s.kind === kind)));
}

function reviewActor(char: string, role: string): ActorRef {
  return buildAgentActor({
    role,
    provider: 'fixture',
    runtime: 'vitest',
    principalIdentityDigest: digest(char),
    sessionIdentityDigest: digest(char === 'a' ? 'b' : 'a'),
    adapter: { id: `adapter-${role}`, version: '1', artifactDigest: digest('c') },
  });
}

function phasePath(round: number, phase: string): string {
  return `root/review-cycle/round:${round}/phase:${phase}`;
}

function findingEvidence(plan: RuntimePlan, path: string): EvidenceRef {
  return evidenceFor(plan, agentAction(plan, path).actionId)[0]!;
}

const F1 = {
  id: 'F-1',
  severity: 'major',
  location: 'src/core/change-run/internal/reconciler.ts:212',
  claim: 'The bounded-loop cap is not enforced on resume.',
  status: 'open',
} as const;

const F2 = {
  id: 'F-2',
  severity: 'minor',
  claim: 'The wait reason is not surfaced in the CLI renderer.',
  status: 'open',
} as const;

/** Drive round 1 review -> triage -> fix, leaving re-review as the next phase. */
function throughRoundOneFix(
  plan: RuntimePlan,
  findings: readonly (typeof F1 | typeof F2)[]
): CanonicalRunRecord {
  const reviewer = reviewActor('a', 'reviewer');
  const triager = reviewActor('e', 'triager');
  const fixer = reviewActor('f', 'fixer');
  const reviewEvidence = findingEvidence(plan, phasePath(1, 'review'));
  const fixEvidence = findingEvidence(plan, phasePath(1, 'fix'));

  let record = startRecord(plan);
  record = commitNode(
    plan,
    record,
    phasePath(1, 'review'),
    {
      contract: 'review-cycle/review-result/1',
      outcome: 'findings',
      findings: findings.map((finding) => ({ ...finding, evidence: [reviewEvidence] })),
    } as unknown as JsonValue,
    'succeeded',
    reviewer
  );
  record = commitNode(
    plan,
    record,
    phasePath(1, 'triage'),
    {
      contract: 'review-cycle/triage-result/1',
      decisions: findings.map((finding) => ({
        findingId: finding.id,
        disposition: finding.severity === 'major' ? 'route_fixer' : 'fix_inline',
        rationale:
          finding.severity === 'major'
            ? 'A code change is required.'
            : 'A one-line renderer fix.',
      })),
    } as unknown as JsonValue,
    'succeeded',
    triager
  );
  return commitNode(
    plan,
    record,
    phasePath(1, 'fix'),
    {
      contract: 'review-cycle/fix-result/1',
      // Only the open Blocker/Major findings must be addressed; the kernel
      // rejects a fix that omits one and tolerates one that skips a minor.
      findingIds: findings.filter((f) => f.severity === 'major').map((f) => f.id),
      beforeTree: digest('1'),
      afterTree: digest('2'),
      delta: fixEvidence,
      tests: [fixEvidence],
    } as unknown as JsonValue,
    'succeeded',
    fixer
  );
}

describe('UI parity constants are the real projection (ECP-5 4.4)', () => {
  it('CANONICAL_PARALLEL is the real projection of the documented fixture', () => {
    const plan = parallelPlan();
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:experts', {
      activeMembers: ['root:experts/review', 'root:experts/cso'],
      inactiveMembers: ['root:experts/benchmark'],
    });
    record = commitNode(plan, record, 'root:experts/review', { ok: true });
    expect(wireSection(plan, record, 'parallel')).toEqual(CANONICAL_PARALLEL);
  });

  it('CANONICAL_PARALLEL_FAILED is the real projection of the documented fixture', () => {
    const plan = parallelPlan();
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:experts', {
      activeMembers: ['root:experts/review', 'root:experts/cso'],
      inactiveMembers: ['root:experts/benchmark'],
    });
    record = commitNode(plan, record, 'root:experts/review', { error: 'blocker' }, 'failed');
    record = commitNode(plan, record, 'root:experts/cso', { ok: true });
    expect(wireSection(plan, record, 'parallel')).toEqual(CANONICAL_PARALLEL_FAILED);
  });

  it('CANONICAL_CHOICE is the real projection of the documented fixture', () => {
    const plan = choicePlan();
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:pick', { outcome: 'simple' });
    expect(wireSection(plan, record, 'choice')).toEqual(CANONICAL_CHOICE);
  });

  it('CANONICAL_CHOICE_UNDECIDED is the real projection of the fresh Record', () => {
    const plan = choicePlan();
    const record = startRecord(plan);
    expect(wireSection(plan, record, 'choice')).toEqual(CANONICAL_CHOICE_UNDECIDED);
  });

  it('CANONICAL_REVIEW_CYCLE is the real projection of the mid-round fixture', () => {
    const plan = reviewCyclePlan(3);
    let record = throughRoundOneFix(plan, [F1, F2]);
    // The re-review Action is admitted but NOT committed: the projector reports
    // `waitReason: 'action-active'` for exactly this state.
    record = admitNode(plan, record, phasePath(1, 're-review'));
    expect(wireSection(plan, record, 'review-cycle')).toEqual(CANONICAL_REVIEW_CYCLE);
  });

  it('CANONICAL_REVIEW_CYCLE_ESCALATED is the real projection at the round cap', () => {
    const plan = reviewCyclePlan(1);
    let record = throughRoundOneFix(plan, [F1]);
    const verifier = reviewActor('7', 'verifier');
    record = commitNode(
      plan,
      record,
      phasePath(1, 're-review'),
      {
        contract: 'review-cycle/verification-result/1',
        verifications: [
          {
            findingId: 'F-1',
            verdict: 'still_open',
            evidence: [findingEvidence(plan, phasePath(1, 're-review'))],
          },
        ],
      } as unknown as JsonValue,
      'succeeded',
      verifier
    );
    expect(wireSection(plan, record, 'review-cycle')).toEqual(
      CANONICAL_REVIEW_CYCLE_ESCALATED
    );
  });

  it('the escalated fixture really is the kernel refusing to call an open Major clean', () => {
    // Guards the constant's MEANING, not just its bytes: `exhausted` here is
    // the bounded-loop cap firing with a Blocker/Major still open — the rule
    // the converged `rasen-auto` deletes its prompt-owned copy of.
    expect(CANONICAL_REVIEW_CYCLE_ESCALATED.outcome).toBe('exhausted');
    expect(CANONICAL_REVIEW_CYCLE_ESCALATED.round).toBe(
      CANONICAL_REVIEW_CYCLE_ESCALATED.maxRounds
    );
    expect(
      CANONICAL_REVIEW_CYCLE_ESCALATED.findings.some(
        (finding) => finding.severity === 'major' && finding.status === 'open'
      )
    ).toBe(true);
    // And the independent-verifier rule: the fixer never verified its own fix.
    expect(CANONICAL_REVIEW_CYCLE_ESCALATED.actors.verifier?.identityDigest).not.toBe(
      CANONICAL_REVIEW_CYCLE_ESCALATED.actors.fixer?.identityDigest
    );
  });
});
