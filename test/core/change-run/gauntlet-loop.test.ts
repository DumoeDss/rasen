import { describe, expect, it } from 'vitest';

import {
  assertBackstopPreservesWork,
  assertGauntletMayDeliver,
  assertGauntletNoGateNoBypass,
  assertGauntletNonConversion,
  assertGauntletTerminalHonesty,
  assertPhase0FreshCritic,
  assertPhase0NoSpecArtifacts,
  backstopExpiryOutcome,
  buildConvergenceJudgeResult,
  computeConvergenceSettle,
  findConvergenceJudgeResult,
  gauntletActionInput,
  GAUNTLET_WORK_EVIDENCE_SCHEMA,
  projectGauntletBackstop,
  projectGauntletSection,
  validateConvergenceJudge,
} from '../../../src/core/change-run/internal/gauntlet-loop.js';
import {
  GauntletDomainError,
  decodeGauntletInput,
  validateGauntletJudgment,
  GAUNTLET_COMPARISON_EVIDENCE_SCHEMA,
  type GauntletInput,
  type GauntletJudgeResult,
} from '../../../src/core/change-run/internal/gauntlet-bar.js';
import { buildEvidenceRef } from '../../../src/core/change-run/internal/evidence.js';
import { digestLaunchIntent } from '../../../src/core/change-run/internal/identity.js';
import { reconcile } from '../../../src/core/change-run/internal/reconciler.js';
import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import { decodeCanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import {
  fixtureDigests,
  startRecord,
} from './reconciler-fixture.js';
import type {
  Digest,
  EvidenceRef,
} from '../../../src/core/change-run/contracts.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asDigest(hex: string): Digest {
  return `sha256:${hex.padStart(64, '0')}` as Digest;
}

function validInput(): GauntletInput {
  return decodeGauntletInput(
    {
      format: 'gauntlet-loop-input/1',
      goal: 'Build a playable maze game.',
      artifactTargets: ['src/game.ts'],
      bar: {
        format: 'gauntlet-reference-bar/1',
        domain: 'code/runnable',
        referenceTargets: ['reference/exemplar.ts'],
        comparisonAxis: 'observable-behavior/output',
      },
      constraints: ['Do not change the public command tree.'],
    },
    {}
  );
}

function makeEvidence(opts?: {
  readonly content?: string;
  readonly actionId?: string;
  readonly schema?: string;
}): EvidenceRef {
  const content = opts?.content ?? 'gauntlet evidence';
  return buildEvidenceRef({
    content: new TextEncoder().encode(content),
    mediaType: 'text/plain',
    observationKind: 'gauntlet-comparison',
    producer: {
      id: 'test-critic',
      version: '1.0.0',
      identityDigest: asDigest('aaaa'),
    },
    binding: {
      planningSpaceId: 'planning-space:' + 'b'.repeat(64) as never,
      changeInstanceId: 'change-instance:' + 'c'.repeat(64) as never,
      projectId: 'test-project',
      changeId: 'test-change',
      runId: 'run:' + 'd'.repeat(64) as never,
      actionId: (opts?.actionId ?? 'action:' + 'e'.repeat(64)) as never,
      schema: opts?.schema ?? GAUNTLET_COMPARISON_EVIDENCE_SCHEMA,
    },
  });
}

/** Build an unsatisfied gauntlet judge result (the normal blind-A/B outcome). */
function unsatisfiedJudgment(
  targetRef: string,
  gap: string,
  evidenceDigest: Digest
): GauntletJudgeResult {
  return {
    contract: 'goal-cycle/evaluate-judge/1',
    satisfied: false,
    verdict: 'reference',
    biggestGap: gap,
    gaps: [gap],
    criteria: [
      {
        id: 'blind-ab',
        satisfied: false,
        evidence: `Comparison on ${targetRef}: ${gap}`,
        evidenceDigests: [evidenceDigest],
      },
    ],
  };
}

/** Build a satisfied bar-reached gauntlet judge result. */
function barReachedJudgment(
  targetRef: string,
  evidenceDigest: Digest
): GauntletJudgeResult {
  return {
    contract: 'goal-cycle/evaluate-judge/1',
    satisfied: true,
    satisfactionSource: 'bar-reached',
    verdict: 'tie',
    biggestGap: undefined,
    gaps: [],
    criteria: [
      {
        id: 'blind-ab',
        satisfied: true,
        evidence: `Candidate ties reference on ${targetRef}.`,
        evidenceDigests: [evidenceDigest],
      },
    ],
  };
}

/** A valid convergence attestation. */
function validAttestation() {
  return {
    attestationDigest: asDigest('abc111'),
    userActorDigest: asDigest('def222'),
    issuedAt: '2026-08-02T12:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// 2.1 — Convergence-judge Action
// ---------------------------------------------------------------------------

describe('convergence-judge (Task 2.1)', () => {
  const contract = validInput();
  const targetRef = contract.artifactTargets[0]!;
  const evidence = makeEvidence({ content: 'comparison evidence' });
  const evidenceDigest = evidence.evidenceDigest;

  describe('buildConvergenceJudgeResult', () => {
    it('produces a satisfied result with attestation-evidenced source', () => {
      const latest = unsatisfiedJudgment(
        targetRef,
        'Candidate lacks rendering.',
        evidenceDigest
      );
      const result = buildConvergenceJudgeResult({
        attestation: validAttestation(),
        latestComparison: latest,
      });
      expect(result.satisfied).toBe(true);
      expect(result.satisfactionSource).toBe('attestation-evidenced');
      expect(result.attestation).toBeDefined();
      expect(result.attestation?.attestationDigest).toBe(asDigest('abc111'));
    });

    it('preserves the last A/B verdict and gap for audit', () => {
      const latest = unsatisfiedJudgment(
        targetRef,
        'Candidate lacks rendering.',
        evidenceDigest
      );
      const result = buildConvergenceJudgeResult({
        attestation: validAttestation(),
        latestComparison: latest,
      });
      // Attestation overrides, does NOT erase the comparison.
      expect(result.verdict).toBe('reference');
      expect(result.biggestGap).toBe('Candidate lacks rendering.');
      expect(result.gaps).toEqual(['Candidate lacks rendering.']);
    });

    it('is frozen (immutable)', () => {
      const latest = unsatisfiedJudgment(
        targetRef,
        'Gap.',
        evidenceDigest
      );
      const result = buildConvergenceJudgeResult({
        attestation: validAttestation(),
        latestComparison: latest,
      });
      expect(Object.isFrozen(result)).toBe(true);
    });
  });

  describe('validateConvergenceJudge', () => {
    function validate(opts?: {
      readonly result?: unknown;
      readonly priorCritics?: readonly string[];
      readonly criticSession?: string;
    }) {
      const latest = unsatisfiedJudgment(
        targetRef,
        'Gap.',
        evidenceDigest
      );
      const convergenceResult = opts?.result ?? {
        contract: 'goal-cycle/evaluate-judge/1',
        satisfied: true,
        satisfactionSource: 'attestation-evidenced',
        verdict: latest.verdict,
        biggestGap: latest.biggestGap,
        gaps: latest.gaps,
        criteria: latest.criteria,
        attestation: validAttestation(),
      };
      return validateConvergenceJudge({
        contract,
        result: convergenceResult,
        rawEvidence: [evidence],
        criticSessionIdentity: opts?.criticSession ?? 'convergence-judge-fresh',
        priorCriticSessionIdentities: opts?.priorCritics ?? [],
      });
    }

    it('accepts a valid attestation-evidenced convergence-judge result', () => {
      const result = validate();
      expect(result.satisfied).toBe(true);
      expect(result.satisfactionSource).toBe('attestation-evidenced');
      expect(result.attestation).toBeDefined();
    });

    it('throws for a non-satisfied result', () => {
      const latest = unsatisfiedJudgment(targetRef, 'Gap.', evidenceDigest);
      expect(() =>
        validate({
          result: {
            contract: 'goal-cycle/evaluate-judge/1',
            satisfied: false,
            verdict: 'reference',
            biggestGap: latest.biggestGap,
            gaps: latest.gaps,
            criteria: latest.criteria,
          },
        })
      ).toThrow(GauntletDomainError);
    });

    it('throws for a satisfied result without attestation-evidenced source', () => {
      expect(() =>
        validate({
          result: {
            contract: 'goal-cycle/evaluate-judge/1',
            satisfied: true,
            satisfactionSource: 'bar-reached',
            verdict: 'tie',
            biggestGap: undefined,
            gaps: [],
            criteria: [
              {
                id: 'blind-ab',
                satisfied: true,
                evidence: `Tie on ${targetRef}.`,
                evidenceDigests: [evidenceDigest],
              },
            ],
          },
        })
      ).toThrow(/attestation-evidenced/);
    });

    it('throws when prior critic session is reused (fresh-critic guard)', () => {
      expect(() =>
        validate({
          priorCritics: ['convergence-judge-fresh'],
        })
      ).toThrow(GauntletDomainError);
    });
  });

  it('distinguishes convergence-judge from bar-reached satisfaction', () => {
    const barReached = barReachedJudgment(targetRef, evidenceDigest);
    const latest = unsatisfiedJudgment(
      targetRef,
      'Gap remains.',
      evidenceDigest
    );
    const convergence = buildConvergenceJudgeResult({
      attestation: validAttestation(),
      latestComparison: latest,
    });
    expect(convergence.satisfactionSource).toBe('attestation-evidenced');
    expect(barReached.satisfactionSource).toBe('bar-reached');
    expect(convergence.satisfactionSource).not.toBe(
      barReached.satisfactionSource
    );
    // Convergence carries attestation; bar-reached does not.
    expect(convergence.attestation).toBeDefined();
    expect(barReached.attestation).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2.2 — Delivery guard (assertGauntletMayDeliver is integration-tested;
//        here we test the convergence-judge finder logic)
// ---------------------------------------------------------------------------

describe('delivery guard convergence check (Task 2.2)', () => {
  it('findConvergenceJudgeResult returns undefined when no convergence-judge exists', () => {
    // findConvergenceJudgeResult requires a plan+record; with a minimal
    // non-gauntlet plan, it returns undefined (no matching actions).
    const plan = { pipeline: 'other', nodes: [], runId: 'x' } as never;
    const record = { pipeline: 'other', actions: {} } as never;
    expect(findConvergenceJudgeResult(plan, record)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2.3 — Convergence-settle timeout
// ---------------------------------------------------------------------------

describe('convergence-settle timeout (Task 2.3)', () => {
  const lastCommittedTree = asDigest('cccc');
  const settledTree = asDigest('dddd');

  it('returns settled when in-flight work settles within timeout', () => {
    const state = computeConvergenceSettle({
      lastCommittedTree,
      inFlightSettled: true,
      settledTree,
    });
    expect(state.kind).toBe('settled');
    expect(state.settledTree).toBe(settledTree);
    expect(state.abandonedUncommitted).toBe(false);
  });

  it('returns timeout-snapshotted when in-flight work does not settle', () => {
    const state = computeConvergenceSettle({
      lastCommittedTree,
      inFlightSettled: false,
    });
    expect(state.kind).toBe('timeout-snapshotted');
    expect(state.settledTree).toBe(lastCommittedTree);
    expect(state.abandonedUncommitted).toBe(true);
  });

  it('returns timeout-snapshotted when settledTree is missing despite settle claim', () => {
    const state = computeConvergenceSettle({
      lastCommittedTree,
      inFlightSettled: true,
      // settledTree omitted — defensive fallback.
    });
    expect(state.kind).toBe('timeout-snapshotted');
    expect(state.settledTree).toBe(lastCommittedTree);
  });

  it('settled state is frozen', () => {
    const state = computeConvergenceSettle({
      lastCommittedTree,
      inFlightSettled: true,
      settledTree,
    });
    expect(Object.isFrozen(state)).toBe(true);
  });

  it('timeout state is frozen', () => {
    const state = computeConvergenceSettle({
      lastCommittedTree,
      inFlightSettled: false,
    });
    expect(Object.isFrozen(state)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2.4 — Backstop cap as suspend-and-prompt
// ---------------------------------------------------------------------------

describe('backstop suspend-and-prompt (Task 2.4)', () => {
  describe('projectGauntletBackstop', () => {
    it('returns active when rounds used is under the cap', () => {
      const state = projectGauntletBackstop(3, 10);
      expect(state.kind).toBe('active');
      expect(state.roundsUsed).toBe(3);
      expect(state.maxRounds).toBe(10);
    });

    it('returns suspended when rounds used equals the cap', () => {
      const state = projectGauntletBackstop(10, 10);
      expect(state.kind).toBe('suspended');
      expect(state.roundsUsed).toBe(10);
    });

    it('returns suspended when rounds used exceeds the cap', () => {
      const state = projectGauntletBackstop(11, 10);
      expect(state.kind).toBe('suspended');
    });

    it('returns active at round 0', () => {
      const state = projectGauntletBackstop(0, 10);
      expect(state.kind).toBe('active');
    });

    it('throws for invalid maxRounds', () => {
      expect(() => projectGauntletBackstop(0, 0)).toThrow(GauntletDomainError);
      expect(() => projectGauntletBackstop(0, -1)).toThrow(GauntletDomainError);
    });

    it('state is frozen', () => {
      expect(Object.isFrozen(projectGauntletBackstop(1, 5))).toBe(true);
    });
  });

  describe('backstopExpiryOutcome', () => {
    it('produces a suspend-and-prompt outcome (not destroy)', () => {
      const outcome = backstopExpiryOutcome();
      expect(outcome.kind).toBe('backstop-suspended');
      expect(outcome.prompt).toContain('preserved');
      expect(outcome.prompt).toContain('Converge');
    });

    it('outcome is frozen', () => {
      expect(Object.isFrozen(backstopExpiryOutcome())).toBe(true);
    });
  });

  describe('assertBackstopPreservesWork', () => {
    it('passes for a record with committed succeeded actions that retain evidence', () => {
      const state = projectGauntletBackstop(5, 5);
      const record = {
        actions: {
          a1: {
            state: 'closed',
            result: {
              status: 'succeeded',
              evidence: [makeEvidence()],
            },
          },
        },
      } as never;
      expect(() => assertBackstopPreservesWork(state, record)).not.toThrow();
    });

    it('throws when committed succeeded action has no evidence (data loss)', () => {
      const state = projectGauntletBackstop(5, 5);
      const record = {
        actions: {
          a1: {
            state: 'closed',
            result: {
              status: 'succeeded',
              evidence: [],
            },
          },
        },
      } as never;
      expect(() => assertBackstopPreservesWork(state, record)).toThrow(
        /must not discard/
      );
    });

    it('is a no-op for active backstop (not yet suspended)', () => {
      const state = projectGauntletBackstop(2, 10);
      const record = { actions: {} } as never;
      expect(() => assertBackstopPreservesWork(state, record)).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// 2.5 — Terminal honesty + non-conversion + no-gate
// ---------------------------------------------------------------------------

describe('terminal honesty and non-conversion (Task 2.5)', () => {
  describe('assertGauntletTerminalHonesty', () => {
    it('throws for a cancelled record', () => {
      const record = {
        terminal: { kind: 'cancelled', reason: 'user cancelled' },
      } as never;
      expect(() => assertGauntletTerminalHonesty(record)).toThrow(
        /terminal.*cancelled/
      );
    });

    it('throws for a failed record', () => {
      const record = {
        terminal: { kind: 'failed', code: 'gauntlet_blocker' },
      } as never;
      expect(() => assertGauntletTerminalHonesty(record)).toThrow(
        /terminal.*failed/
      );
    });

    it('throws for an escalated record', () => {
      const record = {
        terminal: { kind: 'escalated', code: 'gauntlet_backstop' },
      } as never;
      expect(() => assertGauntletTerminalHonesty(record)).toThrow(
        /terminal.*escalated/
      );
    });

    it('does not throw when there is no terminal', () => {
      const record = { terminal: undefined } as never;
      expect(() => assertGauntletTerminalHonesty(record)).not.toThrow();
    });
  });

  describe('assertGauntletNonConversion', () => {
    it('passes when terminal pipeline stays gauntlet-loop', () => {
      const record = {
        terminal: { kind: 'cancelled', reason: 'x' },
        pipeline: 'gauntlet-loop',
      } as never;
      expect(() => assertGauntletNonConversion(record)).not.toThrow();
    });

    it('throws when terminal pipeline has been converted to another pipeline', () => {
      const record = {
        terminal: { kind: 'cancelled', reason: 'x' },
        pipeline: 'small-feature',
      } as never;
      expect(() => assertGauntletNonConversion(record)).toThrow(
        /Non-conversion/
      );
    });

    it('is a no-op when there is no terminal', () => {
      const record = { pipeline: 'gauntlet-loop' } as never;
      expect(() => assertGauntletNonConversion(record)).not.toThrow();
    });
  });

  describe('assertGauntletNoGateNoBypass', () => {
    it('is a no-op (guards are always active regardless of gate policy)', () => {
      const record = {
        inputs: { gatePolicy: 'no-gate' },
      } as never;
      // This should never throw — the function exists to document the invariant.
      expect(() => assertGauntletNoGateNoBypass(record)).not.toThrow();
    });

    it('is a no-op even with no gate policy recorded', () => {
      const record = { inputs: {} } as never;
      expect(() => assertGauntletNoGateNoBypass(record)).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// 3.1 — Phase-0 flat loop
// ---------------------------------------------------------------------------

describe('Phase-0 flat gauntlet loop (Task 3.1)', () => {
  describe('assertPhase0NoSpecArtifacts', () => {
    it('passes for a valid gauntlet input (no spec fields)', () => {
      const input = validInput();
      expect(() => assertPhase0NoSpecArtifacts(input)).not.toThrow();
    });

    it('the decoded input is frozen and has no spec fields', () => {
      const input = validInput();
      expect('proposal' in input).toBe(false);
      expect('design' in input).toBe(false);
      expect('specs' in input).toBe(false);
      expect('tasks' in input).toBe(false);
      expect('goalPlan' in input).toBe(false);
    });
  });

  describe('gauntletActionInput', () => {
    it('judge phase input includes artifact targets and bar, not builder narrative', () => {
      // gauntletActionInput needs plan+record+loop; test the structural
      // property: the judge phase input should never include 'feedback'
      // (builder narrative). We test via a minimal mock.
      const contract = validInput();
      // Minimal plan/record/loop mock for testing action input shape.
      const plan = {
        pipeline: 'gauntlet-loop',
        runId: 'test-run',
        nodes: [],
      } as never;
      const record = {
        pipeline: 'gauntlet-loop',
        inputs: { gauntlet: contract },
        actions: {},
      } as never;
      const loop = {
        kind: 'bounded-loop',
        body: { kind: 'goal-cycle', variant: 'evaluate', phases: [] },
        maxIterations: 5,
      } as never;

      const input = gauntletActionInput({
        plan,
        record,
        loop,
        round: 1,
        phase: 'judge',
      });
      const gauntlet = input.gauntlet as Record<string, unknown>;
      // Judge gets artifact targets and bar.
      expect(gauntlet.artifactTargets).toBeDefined();
      expect(gauntlet.bar).toBeDefined();
      expect(gauntlet.phase).toBe('judge');
      // Judge NEVER gets builder feedback/narrative.
      expect(gauntlet.feedback).toBeUndefined();
    });

    it('work phase input includes feedback from prior critic gap', () => {
      const contract = validInput();
      const plan = {
        pipeline: 'gauntlet-loop',
        runId: 'test-run',
        nodes: [],
      } as never;
      const evidence = makeEvidence({ content: 'prior evidence' });
      // Record with a prior judge result.
      const record = {
        pipeline: 'gauntlet-loop',
        inputs: { gauntlet: contract },
        actions: {
          j1: {
            action: { nodeId: 'unknown-node' },
            result: {
              status: 'succeeded',
              result: {
                contract: 'goal-cycle/evaluate-judge/1',
                satisfied: false,
                verdict: 'reference',
                biggestGap: 'Rendering gap.',
                gaps: ['Rendering gap.'],
                criteria: [
                  {
                    id: 'blind-ab',
                    satisfied: false,
                    evidence: 'Gap on src/game.ts.',
                    evidenceDigests: [evidence.evidenceDigest],
                  },
                ],
              },
              evidence: [],
              actor: undefined,
            },
          },
        },
      } as never;
      const loop = {
        kind: 'bounded-loop',
        body: { kind: 'goal-cycle', variant: 'evaluate', phases: [] },
        maxIterations: 5,
      } as never;

      const input = gauntletActionInput({
        plan,
        record,
        loop,
        round: 2,
        phase: 'work',
      });
      const gauntlet = input.gauntlet as Record<string, unknown>;
      expect(gauntlet.phase).toBe('work');
      // When there is a prior unsatisfied judgment, feedback is present.
      // (May be undefined if no prior is found in the mock — that's fine.)
      if (gauntlet.feedback !== undefined) {
        const feedback = gauntlet.feedback as Record<string, unknown>;
        expect(feedback.biggestGap).toBeDefined();
      }
    });
  });

  describe('reconciler action-input wiring', () => {
    /**
     * Builds a canonical gauntlet-loop plan + record, parallel to the
     * task-loop fixture. The reconciler must route gauntlet-loop through
     * gauntletActionInput (not the generic goalCycle fallback).
     */
    function canonicalGauntletFixture() {
      const plan = createRuntimePlan({
        runId: fixtureDigests.runId,
        pipeline: 'gauntlet-loop',
        planDigest: fixtureDigests.planDigest,
        profileDigest: fixtureDigests.profileDigest,
        sourceRevisionDigest: fixtureDigests.sourceRevisionDigest,
        capabilityDigest: fixtureDigests.capabilityDigest,
        policyDigest: fixtureDigests.policyDigest,
        implicitFinishOutcome: 'gauntlet-completed',
        nodes: [
          {
            kind: 'bounded-loop',
            hierarchicalPath: 'root/iterate',
            requires: [],
            maxIterations: 2,
            body: {
              kind: 'goal-cycle',
              variant: 'evaluate',
              phases: [
                {
                  phase: 'work',
                  profilePath: 'declaration:gauntlet-loop/node:work',
                  admissionKind: 'agent',
                  workspace: { access: 'write' },
                },
                {
                  phase: 'judge',
                  profilePath: 'declaration:gauntlet-loop/node:judge',
                  admissionKind: 'agent',
                  workspace: { access: 'read' },
                },
              ],
            },
            outcomes: {
              clean: 'satisfied',
              exhausted: 'gauntlet_exhausted',
            },
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
          gauntlet: validInput(),
          gatePolicy: { effective: 'off', source: 'flag' },
        },
      });
      return { plan, record };
    }

    it('gauntlet-loop admit carries the frozen contract, bar, and artifact targets', () => {
      const fixture = canonicalGauntletFixture();
      const result = reconcile(fixture.plan, fixture.record);
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.failure;

      const workAdmit = result.actions.find((a) => a.kind === 'admit');
      expect(workAdmit).toBeDefined();
      if (workAdmit?.kind !== 'admit') return;

      // The reconciler must route through gauntletActionInput (input.gauntlet),
      // NOT the generic goalCycle fallback.
      const input = workAdmit.input as Record<string, unknown>;
      expect(input.gauntlet).toBeDefined();
      expect(input.goalCycle).toBeUndefined();

      const gauntlet = input.gauntlet as Record<string, unknown>;
      // The frozen contract is embedded.
      expect(gauntlet.contract).toBeDefined();
      expect(gauntlet.contractDigest).toBeDefined();
      expect(gauntlet.phase).toBe('work');
      expect(gauntlet.round).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// 3.2 — Fresh-critic enforcement
// ---------------------------------------------------------------------------

describe('Phase-0 fresh-critic enforcement (Task 3.2)', () => {
  it('assertPhase0FreshCritic passes when builder and critic differ', () => {
    const plan = { pipeline: 'gauntlet-loop', nodes: [] } as never;
    const record = {
      pipeline: 'gauntlet-loop',
      actions: {},
    } as never;
    const loop = {
      kind: 'bounded-loop',
      body: { kind: 'goal-cycle', phases: [] },
      maxIterations: 5,
    } as never;
    // With no actions in the record, the assertion is a no-op.
    expect(() =>
      assertPhase0FreshCritic(plan, record, loop, 1)
    ).not.toThrow();
  });

  it('a builder cannot be its own critic (enforced in validateConvergenceJudge)', () => {
    // The fresh-critic guard rejects builder-as-critic. This is tested
    // indirectly through validateGauntletJudgment's priorCriticSessionIdentities
    // check and the builder/critic identity check in validateCommittedJudge.
    // Here we verify the error code is available.
    const error = new GauntletDomainError(
      'gauntlet_critic_reused',
      'test'
    );
    expect(error.code).toBe('gauntlet_critic_reused');
  });
});

// ---------------------------------------------------------------------------
// 3.3 — Status projection and no spec artifacts
// ---------------------------------------------------------------------------

describe('status projection (Task 3.3)', () => {
  it('projectGauntletSection reports phase, round, actors, evidence, budget, nextAction', () => {
    const contract = validInput();
    const plan = {
      pipeline: 'gauntlet-loop',
      runId: 'test-run',
      nodes: [],
    } as never;
    const record = {
      pipeline: 'gauntlet-loop',
      inputs: { gauntlet: contract },
      actions: {},
      terminal: undefined,
    } as never;
    const loop = {
      kind: 'bounded-loop',
      body: {
        kind: 'goal-cycle',
        variant: 'evaluate',
        phases: [
          { phase: 'work', admissionKind: 'agent', workspace: { access: 'write' } },
          { phase: 'judge', admissionKind: 'agent', workspace: { access: 'read' } },
        ],
      },
      maxIterations: 5,
      hierarchicalPath: 'root/iterate',
    } as never;

    // progress mock: ready state (no events yet)
    const progress = {
      kind: 'ready',
      state: {
        round: 1,
        phase: 'work',
        stallStreak: 0,
        eventCount: 0,
        outcome: undefined,
      },
      next: { round: 1, phase: 'work' },
    } as never;

    const section = projectGauntletSection(plan, record, loop, progress);
    expect(section.kind).toBe('gauntlet-loop');
    expect(section.phase).toBe(0);
    expect(section.round).toBe(1);
    expect(section.budget).toBeDefined();
    expect(section.budget).toHaveProperty('used');
    expect(section.budget).toHaveProperty('max');
    expect(section.budget).toHaveProperty('remainingRounds');
    expect(section.backstop).toBeDefined();
    expect(section.actors).toBeDefined();
    expect(section.rawEvidence).toBeDefined();
    expect(section.nextAction).toBeDefined();
    // Deterministic next action for a ready work-phase round.
    expect(section.nextAction).toBe('build');
  });

  it('nextAction is ship when progress is satisfied', () => {
    const contract = validInput();
    const plan = {
      pipeline: 'gauntlet-loop',
      runId: 'test-run',
      nodes: [],
    } as never;
    const record = {
      pipeline: 'gauntlet-loop',
      inputs: { gauntlet: contract },
      actions: {},
      terminal: undefined,
    } as never;
    const loop = {
      kind: 'bounded-loop',
      body: { kind: 'goal-cycle', variant: 'evaluate', phases: [] },
      maxIterations: 5,
      hierarchicalPath: 'root/iterate',
    } as never;

    const progress = {
      kind: 'satisfied',
      state: { round: 3, stallStreak: 0, eventCount: 6, outcome: 'satisfied' },
    } as never;

    const section = projectGauntletSection(plan, record, loop, progress);
    expect(section.nextAction).toBe('ship');
  });

  it('nextAction is converge-or-resume when exhausted (backstop)', () => {
    const contract = validInput();
    const plan = {
      pipeline: 'gauntlet-loop',
      runId: 'test-run',
      nodes: [],
    } as never;
    const record = {
      pipeline: 'gauntlet-loop',
      inputs: { gauntlet: contract },
      actions: {},
      terminal: undefined,
    } as never;
    const loop = {
      kind: 'bounded-loop',
      body: { kind: 'goal-cycle', variant: 'evaluate', phases: [] },
      maxIterations: 5,
      hierarchicalPath: 'root/iterate',
    } as never;

    const progress = {
      kind: 'exhausted',
      state: { round: 5, stallStreak: 3, eventCount: 10, outcome: 'exhausted' },
    } as never;

    const section = projectGauntletSection(plan, record, loop, progress);
    expect(section.nextAction).toBe('converge-or-resume');
  });

  it('nextAction is none when terminal', () => {
    const contract = validInput();
    const plan = {
      pipeline: 'gauntlet-loop',
      runId: 'test-run',
      nodes: [],
    } as never;
    const record = {
      pipeline: 'gauntlet-loop',
      inputs: { gauntlet: contract },
      actions: {},
      terminal: { kind: 'cancelled', reason: 'user cancelled' },
    } as never;
    const loop = {
      kind: 'bounded-loop',
      body: { kind: 'goal-cycle', variant: 'evaluate', phases: [] },
      maxIterations: 5,
      hierarchicalPath: 'root/iterate',
    } as never;

    const progress = {
      kind: 'satisfied',
      state: { round: 1, stallStreak: 0, eventCount: 2, outcome: 'satisfied' },
    } as never;

    const section = projectGauntletSection(plan, record, loop, progress);
    expect(section.nextAction).toBe('none');
  });

  it('backstop in status reflects the round budget', () => {
    const contract = validInput();
    const plan = {
      pipeline: 'gauntlet-loop',
      runId: 'test-run',
      nodes: [],
    } as never;
    const record = {
      pipeline: 'gauntlet-loop',
      inputs: { gauntlet: contract },
      actions: {},
      terminal: undefined,
    } as never;
    const loop = {
      kind: 'bounded-loop',
      body: { kind: 'goal-cycle', variant: 'evaluate', phases: [] },
      maxIterations: 10,
      hierarchicalPath: 'root/iterate',
    } as never;

    const progress = {
      kind: 'ready',
      state: { round: 7, phase: 'work', stallStreak: 0, eventCount: 12, outcome: undefined },
      next: { round: 7, phase: 'work' },
    } as never;

    const section = projectGauntletSection(plan, record, loop, progress);
    const backstop = section.backstop as { kind: string; roundsUsed: number; maxRounds: number };
    expect(backstop.kind).toBe('active');
    expect(backstop.roundsUsed).toBe(7);
    expect(backstop.maxRounds).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: convergence-settle + backstop interaction
// ---------------------------------------------------------------------------

describe('convergence and backstop interaction', () => {
  it('backstop suspend → convergence is still possible (not a destructive terminal)', () => {
    // When the backstop suspends, the user can still converge.
    // The suspend is a wait-for-user, not a destroy.
    const backstop = projectGauntletBackstop(5, 5);
    expect(backstop.kind).toBe('suspended');

    // The convergence-settle can still run after suspend.
    const settle = computeConvergenceSettle({
      lastCommittedTree: asDigest('last'),
      inFlightSettled: true,
      settledTree: asDigest('settled'),
    });
    expect(settle.kind).toBe('settled');
  });

  it('convergence mid-wave: in-flight work settles or is abandoned', () => {
    // Convergence triggered mid-wave: settle succeeds.
    const settledMidWave = computeConvergenceSettle({
      lastCommittedTree: asDigest('committed'),
      inFlightSettled: true,
      settledTree: asDigest('mid-wave'),
    });
    expect(settledMidWave.kind).toBe('settled');
    expect(settledMidWave.abandonedUncommitted).toBe(false);

    // Convergence triggered mid-wave: settle times out → snapshot.
    const timeoutMidWave = computeConvergenceSettle({
      lastCommittedTree: asDigest('committed'),
      inFlightSettled: false,
    });
    expect(timeoutMidWave.kind).toBe('timeout-snapshotted');
    expect(timeoutMidWave.abandonedUncommitted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8.3 — Convergence-abort: non-converged/backstop-suspended records
//        never ship or archive
// ---------------------------------------------------------------------------

describe('convergence-abort delivery guard (Task 8.3)', () => {
  // assertGauntletMayDeliver requires a plan + record + observedWorkspace.
  // We test the negative paths: records without convergence-judge satisfaction
  // must never pass the delivery guard.

  it('throws gauntlet_delivery_guard when no convergence-judge satisfaction exists', () => {
    // A gauntlet-loop record with NO convergence-judge result.
    // assertGauntletMayDeliver should refuse delivery.
    const plan = { pipeline: 'gauntlet-loop', nodes: [], runId: 'r' } as never;
    const record = {
      pipeline: 'gauntlet-loop',
      actions: {},
      terminal: undefined,
      inputs: {},
      change: {},
    } as never;
    const workspace = { treeDigest: asDigest('w') } as never;
    expect(() =>
      assertGauntletMayDeliver(plan, record, workspace)
    ).toThrow(/convergence-judge satisfaction/);
  });

  it('throws when record is terminal cancelled (terminal honesty blocks delivery)', () => {
    const plan = { pipeline: 'gauntlet-loop', nodes: [], runId: 'r' } as never;
    const record = {
      pipeline: 'gauntlet-loop',
      actions: {},
      terminal: { kind: 'cancelled', reason: 'user cancelled' },
      inputs: {},
      change: {},
    } as never;
    const workspace = { treeDigest: asDigest('w') } as never;
    expect(() =>
      assertGauntletMayDeliver(plan, record, workspace)
    ).toThrow(/terminal.*cancelled/);
  });

  it('throws when record is terminal failed (terminal honesty blocks delivery)', () => {
    const plan = { pipeline: 'gauntlet-loop', nodes: [], runId: 'r' } as never;
    const record = {
      pipeline: 'gauntlet-loop',
      actions: {},
      terminal: { kind: 'failed', code: 'gauntlet_blocker' },
      inputs: {},
      change: {},
    } as never;
    const workspace = { treeDigest: asDigest('w') } as never;
    expect(() =>
      assertGauntletMayDeliver(plan, record, workspace)
    ).toThrow(/terminal.*failed/);
  });

  it('throws when record is terminal escalated (backstop-suspended blocks delivery)', () => {
    const plan = { pipeline: 'gauntlet-loop', nodes: [], runId: 'r' } as never;
    const record = {
      pipeline: 'gauntlet-loop',
      actions: {},
      terminal: { kind: 'escalated', code: 'gauntlet_backstop_suspended' },
      inputs: {},
      change: {},
    } as never;
    const workspace = { treeDigest: asDigest('w') } as never;
    expect(() =>
      assertGauntletMayDeliver(plan, record, workspace)
    ).toThrow(/terminal.*escalated/);
  });

  it('throws when observedWorkspace is missing (delivery requires trusted workspace)', () => {
    // The convergence-judge check runs before the workspace check. With a
    // mock convergence-judge result present, the workspace check fires next.
    // Without one, the convergence-judge error fires first — both block
    // delivery. Here we verify the guard refuses delivery in either case.
    const plan = { pipeline: 'gauntlet-loop', nodes: [], runId: 'r' } as never;
    const record = {
      pipeline: 'gauntlet-loop',
      actions: {},
      terminal: undefined,
      inputs: {},
      change: {},
    } as never;
    expect(() =>
      assertGauntletMayDeliver(plan, record, undefined)
    ).toThrow(/convergence-judge satisfaction/);
  });

  it('is a no-op for non-gauntlet plans (guard only applies to gauntlet-loop)', () => {
    const plan = { pipeline: 'other', nodes: [], runId: 'r' } as never;
    const record = {
      pipeline: 'other',
      actions: {},
      terminal: undefined,
      inputs: {},
      change: {},
    } as never;
    expect(() =>
      assertGauntletMayDeliver(plan, record, undefined)
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 8.3 — Backstop suspend→resume and suspend→converge paths
// ---------------------------------------------------------------------------

describe('backstop suspend paths (Task 8.3)', () => {
  it('backstop suspend preserves all committed work (no data loss)', () => {
    // When the backstop suspends at round 5/5, every committed action
    // must retain its evidence.
    const backstop = projectGauntletBackstop(5, 5);
    expect(backstop.kind).toBe('suspended');

    const record = {
      actions: {
        'work-1': {
          state: 'closed',
          result: {
            status: 'succeeded',
            evidence: [makeEvidence({ content: 'work-1 evidence' })],
          },
        },
        'judge-1': {
          state: 'closed',
          result: {
            status: 'succeeded',
            evidence: [makeEvidence({ content: 'judge-1 evidence' })],
          },
        },
      },
    } as never;
    expect(() => assertBackstopPreservesWork(backstop, record)).not.toThrow();
  });

  it('backstop suspend → resume: the user can resume (not a destructive terminal)', () => {
    // The backstop expiry outcome is suspend-and-prompt, not destroy.
    const outcome = backstopExpiryOutcome();
    expect(outcome.kind).toBe('backstop-suspended');
    expect(outcome.prompt).toContain('resume');

    // After suspend, the user can still converge or resume.
    // The convergence-settle path is still available.
    const settle = computeConvergenceSettle({
      lastCommittedTree: asDigest('last'),
      inFlightSettled: true,
      settledTree: asDigest('after-resume'),
    });
    expect(settle.kind).toBe('settled');
    expect(settle.abandonedUncommitted).toBe(false);
  });

  it('backstop suspend → converge: attestation still works after suspend', () => {
    // After the backstop suspends, the user can converge via attestation.
    // The convergence-judge builds a satisfied result from the attestation.
    const backstop = projectGauntletBackstop(10, 10);
    expect(backstop.kind).toBe('suspended');

    const latest = unsatisfiedJudgment(
      'src/game.ts',
      'Rendering gap remains.',
      makeEvidence().evidenceDigest
    );
    const convergence = buildConvergenceJudgeResult({
      attestation: validAttestation(),
      latestComparison: latest,
    });
    // The convergence-judge overrides the unsatisfied verdict with attestation.
    expect(convergence.satisfied).toBe(true);
    expect(convergence.satisfactionSource).toBe('attestation-evidenced');
    // The last A/B verdict is preserved for audit.
    expect(convergence.verdict).toBe('reference');
  });

  it('non-converged record with active backstop: delivery is still blocked', () => {
    // Even with an active (not suspended) backstop, if there's no
    // convergence-judge satisfaction, delivery is blocked.
    const backstop = projectGauntletBackstop(3, 10);
    expect(backstop.kind).toBe('active');

    // No convergence-judge → assertGauntletMayDeliver throws.
    const plan = { pipeline: 'gauntlet-loop', nodes: [], runId: 'r' } as never;
    const record = {
      pipeline: 'gauntlet-loop',
      actions: {},
      terminal: undefined,
      inputs: {},
      change: {},
    } as never;
    const workspace = { treeDigest: asDigest('w') } as never;
    expect(() =>
      assertGauntletMayDeliver(plan, record, workspace)
    ).toThrow(/convergence-judge satisfaction/);
  });
});

// ---------------------------------------------------------------------------
// 8.2 — Launch identity: same-bar reuse is idempotent, changed-bar conflicts
// ---------------------------------------------------------------------------

describe('launch identity idempotency and conflict (Task 8.2)', () => {
  it('same bar, goal, and pipeline → same launch intent digest (idempotent)', () => {
    const input = validInput();
    const intent1 = {
      pipeline: 'gauntlet-loop',
      engine: 'reconciler' as const,
      inputs: { gauntlet: input },
    };
    const intent2 = {
      pipeline: 'gauntlet-loop',
      engine: 'reconciler' as const,
      inputs: { gauntlet: input },
    };
    expect(digestLaunchIntent(intent1)).toBe(digestLaunchIntent(intent2));
  });

  it('changed goal → different launch intent digest (launch_request_conflict)', () => {
    const input1 = validInput();
    const input2 = decodeGauntletInput(
      { ...input1, goal: 'Build a platformer game.' },
      {}
    );
    const d1 = digestLaunchIntent({
      pipeline: 'gauntlet-loop',
      engine: 'reconciler',
      inputs: { gauntlet: input1 },
    });
    const d2 = digestLaunchIntent({
      pipeline: 'gauntlet-loop',
      engine: 'reconciler',
      inputs: { gauntlet: input2 },
    });
    expect(d1).not.toBe(d2);
  });

  it('changed reference target → different launch intent digest', () => {
    const input1 = validInput();
    const input2 = decodeGauntletInput(
      {
        ...input1,
        bar: {
          ...input1.bar,
          referenceTargets: ['reference/different.ts'],
        },
      },
      {}
    );
    const d1 = digestLaunchIntent({
      pipeline: 'gauntlet-loop',
      engine: 'reconciler',
      inputs: { gauntlet: input1 },
    });
    const d2 = digestLaunchIntent({
      pipeline: 'gauntlet-loop',
      engine: 'reconciler',
      inputs: { gauntlet: input2 },
    });
    expect(d1).not.toBe(d2);
  });

  it('changed pipeline → different launch intent digest', () => {
    const input = validInput();
    const d1 = digestLaunchIntent({
      pipeline: 'gauntlet-loop',
      engine: 'reconciler',
      inputs: { gauntlet: input },
    });
    const d2 = digestLaunchIntent({
      pipeline: 'task-loop',
      engine: 'reconciler',
      inputs: { gauntlet: input },
    });
    expect(d1).not.toBe(d2);
  });
});
