import { describe, expect, it } from 'vitest';

import type {
  ActionId,
  ChangeInstanceId,
  Digest,
  EffectId,
  EvidenceRef,
  PlanningSpaceId,
  RunId,
} from '../../../src/core/change-run/contracts.js';
import { buildAgentActor } from '../../../src/core/change-run/internal/actors.js';
import {
  ReviewCycleDomainError,
  applyReviewCycleEvent,
  assertReviewCycleMayShip,
  initialReviewCycleState,
  reduceReviewCycleEvents,
  type ReviewCycleEvent,
} from '../../../src/core/change-run/internal/review-cycle.js';

const branded = <T>(value: string): T => value as T;
const digest = (char: string) =>
  branded<Digest>(`sha256:${char.repeat(64)}`);

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

function evidence(char: string): EvidenceRef {
  return {
    format: 'change-run-evidence-ref/1',
    store: 'change-run',
    evidenceDigest: digest(char),
    contentDigest: digest(char),
    mediaType: 'application/json',
    size: 1,
    observationKind: 'review-cycle-test',
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
      runId: branded<RunId>(`run:${'3'.repeat(64)}`),
      actionId: branded<ActionId>(`action:${'4'.repeat(64)}`),
      effectId: branded<EffectId>(`effect:${'5'.repeat(64)}`),
      treeDigest: digest('6'),
      schema: 'review-cycle-test/1',
    },
  };
}

const reviewer = actor('a', 'reviewer');
const triager = actor('e', 'triager');
const fixer = actor('f', 'fixer');
const verifier = actor('7', 'verifier');

function event(
  round: number,
  phase: ReviewCycleEvent['phase'],
  eventActor: ReviewCycleEvent['actor'],
  result: ReviewCycleEvent['result']
): ReviewCycleEvent {
  return {
    round,
    phase,
    actor: eventActor,
    result,
    evidence: [evidence('8')],
  };
}

function reviewWithMajor(round = 1): ReviewCycleEvent {
  return event(round, 'review', reviewer, {
    contract: 'review-cycle/review-result/1',
    outcome: 'findings',
    findings: [
      {
        id: 'F-1',
        severity: 'major',
        claim: 'The durable invariant is broken.',
        evidence: [evidence('9')],
        status: 'open',
      },
    ],
  });
}

function triage(round = 1): ReviewCycleEvent {
  return event(round, 'triage', triager, {
    contract: 'review-cycle/triage-result/1',
    decisions: [
      {
        findingId: 'F-1',
        disposition: 'route_fixer',
        rationale: 'A code change is required.',
      },
    ],
  });
}

function fix(round = 1): ReviewCycleEvent {
  return event(round, 'fix', fixer, {
    contract: 'review-cycle/fix-result/1',
    findingIds: ['F-1'],
    beforeTree: digest('a'),
    afterTree: digest('b'),
    delta: evidence('c'),
    tests: [evidence('d')],
  });
}

function reReview(
  verdict: 'resolved' | 'still_open',
  round = 1,
  eventActor = verifier
): ReviewCycleEvent {
  return event(round, 're-review', eventActor, {
    contract: 'review-cycle/verification-result/1',
    verifications: [
      {
        findingId: 'F-1',
        verdict,
        evidence: [evidence('e')],
      },
    ],
  });
}

describe('ReviewCycle domain reducer', () => {
  it('drives finding -> triage -> fix -> independent re-review -> clean', () => {
    const state = reduceReviewCycleEvents(
      [reviewWithMajor(), triage(), fix(), reReview('resolved')],
      3
    );

    expect(state).toMatchObject({
      round: 1,
      phase: 're-review',
      outcome: 'clean',
      openFindingIds: [],
      eventCount: 4,
    });
    expect(state.fixerActor?.identityDigest).toBe(fixer.identityDigest);
    expect(state.verifierActor?.identityDigest).toBe(verifier.identityDigest);
    expect(() => assertReviewCycleMayShip(state)).not.toThrow();
  });

  it('rejects malformed review results before they can affect state', () => {
    const malformed = event(1, 'review', reviewer, {
      contract: 'review-cycle/review-result/1',
      outcome: 'clean',
      findings: [
        {
          id: 'F-1',
          severity: 'major',
          claim: 'Still open.',
          evidence: [evidence('9')],
          status: 'open',
        },
      ],
    });

    expect(() =>
      applyReviewCycleEvent(initialReviewCycleState(), malformed, 3)
    ).toThrowError(
      expect.objectContaining<Partial<ReviewCycleDomainError>>({
        code: 'malformed_review_cycle_result',
      })
    );
  });

  it('rejects a fixer attempting to verify the same fix', () => {
    expect(() =>
      reduceReviewCycleEvents(
        [reviewWithMajor(), triage(), fix(), reReview('resolved', 1, fixer)],
        3
      )
    ).toThrowError(
      expect.objectContaining<Partial<ReviewCycleDomainError>>({
        code: 'review_cycle_actor_separation',
      })
    );
  });

  it('exhausts at maxRounds while preserving the open Major ship guard', () => {
    const state = reduceReviewCycleEvents(
      [reviewWithMajor(), triage(), fix(), reReview('still_open')],
      1
    );

    expect(state).toMatchObject({
      round: 1,
      phase: 're-review',
      outcome: 'exhausted',
      openFindingIds: ['F-1'],
    });
    expect(() => assertReviewCycleMayShip(state)).toThrowError(
      expect.objectContaining<Partial<ReviewCycleDomainError>>({
        code: 'review_cycle_ship_guard',
      })
    );
  });

  it('advances to a fresh round instead of reopening a completed invocation', () => {
    const state = reduceReviewCycleEvents(
      [reviewWithMajor(), triage(), fix(), reReview('still_open')],
      3
    );

    expect(state).toMatchObject({
      round: 2,
      phase: 'review',
      openFindingIds: ['F-1'],
      eventCount: 4,
    });
    expect(state.outcome).toBeUndefined();
  });

  it('rejects out-of-order or repeated phase completions', () => {
    expect(() =>
      reduceReviewCycleEvents([reviewWithMajor(), fix()], 3)
    ).toThrowError(
      expect.objectContaining<Partial<ReviewCycleDomainError>>({
        code: 'invalid_review_cycle_transition',
      })
    );
  });
});
