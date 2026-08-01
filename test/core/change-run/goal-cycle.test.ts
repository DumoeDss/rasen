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
  GoalCycleDomainError,
  applyGoalCycleEvent,
  assertGoalCycleMayShip,
  initialGoalCycleState,
  reduceGoalCycleEvents,
  type GoalCycleEvent,
  type GoalCycleVariant,
} from '../../../src/core/change-run/internal/goal-cycle.js';

const branded = <T>(value: string): T => value as T;
const digest = (hex: string) =>
  branded<Digest>(`sha256:${hex.padEnd(64, '0').slice(0, 64)}`);

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

function evidence(hex: string): EvidenceRef {
  return {
    format: 'change-run-evidence-ref/1',
    store: 'change-run',
    evidenceDigest: digest(hex),
    contentDigest: digest(hex),
    mediaType: 'application/json',
    size: 1,
    observationKind: 'goal-cycle-test',
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
      schema: 'goal-cycle-test/1',
    },
  };
}

const worker = actor('a', 'implementer');
const worker2 = actor('f', 'implementer');
const judge = actor('7', 'reviewer');

function event(
  round: number,
  phase: GoalCycleEvent['phase'],
  actorRef: ReturnType<typeof actor>,
  result: unknown,
  variant: GoalCycleVariant
): GoalCycleEvent {
  // Build the correct result for the phase+variant
  if (phase === 'work') {
    if (variant === 'research') {
      return {
        round,
        phase,
        actor: actorRef,
        result: {
          contract: 'goal-cycle/research-work/1',
          documentPath: 'docs/report.md',
          beforeTree: digest('1'),
          afterTree: digest('2'),
          delta: evidence('e'),
        },
        evidence: [evidence('e')],
      };
    }
    return {
      round,
      phase,
      actor: actorRef,
      result: {
        contract: 'goal-cycle/work-result/1',
        workDescription: 'Improved performance',
        beforeTree: digest('1'),
        afterTree: digest('2'),
        delta: evidence('e'),
      },
      evidence: [evidence('e')],
    };
  }
  // judge phase
  switch (variant) {
    case 'measure':
      return {
        round,
        phase,
        actor: actorRef,
        result: {
          contract: 'goal-cycle/measure-judge/1',
          score: 85,
          threshold: 80,
          direction: 'gte' as const,
          passed: true,
        },
        evidence: [evidence('9')],
      };
    case 'evaluate':
      return {
        round,
        phase,
        actor: actorRef,
        result: {
          contract: 'goal-cycle/evaluate-judge/1',
          satisfied: true,
          gaps: [],
          criteria: [
            { id: 'crit-1', satisfied: true, evidence: 'all tests pass' },
          ],
        },
        evidence: [evidence('8')],
      };
    case 'research':
      return {
        round,
        phase,
        actor: actorRef,
        result: {
          contract: 'goal-cycle/research-judge/1',
          satisfied: true,
          gaps: [],
          qualityAssessment: 'Document is comprehensive',
        },
        evidence: [evidence('7')],
      };
  }
}

const WORK_RESULT = {
  contract: 'goal-cycle/work-result/1',
  workDescription: 'Improved performance',
  beforeTree: digest('1'),
  afterTree: digest('2'),
  delta: evidence('e'),
};

const RESEARCH_WORK_RESULT = {
  contract: 'goal-cycle/research-work/1',
  documentPath: 'docs/report.md',
  beforeTree: digest('1'),
  afterTree: digest('2'),
  delta: evidence('e'),
};

// ---------------------------------------------------------------------------
// Failure-first tests (task 1.7)
// ---------------------------------------------------------------------------

describe('goal-cycle domain reducer — failure-first', () => {
  describe('malformed work result', () => {
    it('rejects work result with identical before/after trees', () => {
      const state = initialGoalCycleState('measure');
      const badEvent: GoalCycleEvent = {
        round: 1,
        phase: 'work',
        actor: worker,
        result: {
          contract: 'goal-cycle/work-result/1',
          workDescription: 'no change',
          beforeTree: digest('1'),
          afterTree: digest('1'),
          delta: evidence('e'),
        },
        evidence: [evidence('e')],
      };
      expect(() => applyGoalCycleEvent(state, badEvent, 5)).toThrow(GoalCycleDomainError);
      expect(() => applyGoalCycleEvent(state, badEvent, 5)).toThrow(/material tree change/);
    });

    it('rejects work result with wrong contract string', () => {
      const state = initialGoalCycleState('measure');
      const badEvent: GoalCycleEvent = {
        round: 1,
        phase: 'work',
        actor: worker,
        result: {
          contract: 'review-cycle/fix-result/1',
          findingIds: ['f1'],
          beforeTree: digest('1'),
          afterTree: digest('2'),
          delta: evidence('e'),
          tests: [],
        },
        evidence: [evidence('e')],
      };
      expect(() => applyGoalCycleEvent(state, badEvent, 5)).toThrow(GoalCycleDomainError);
    });

    it('rejects research work result for measure variant', () => {
      const state = initialGoalCycleState('measure');
      const badEvent: GoalCycleEvent = {
        round: 1,
        phase: 'work',
        actor: worker,
        result: RESEARCH_WORK_RESULT,
        evidence: [evidence('e')],
      };
      expect(() => applyGoalCycleEvent(state, badEvent, 5)).toThrow(GoalCycleDomainError);
    });
  });

  describe('malformed judge result per variant', () => {
    it('rejects evaluate judge result for measure variant', () => {
      let state = initialGoalCycleState('measure');
      state = applyGoalCycleEvent(state, event(1, 'work', worker, WORK_RESULT, 'measure'), 5);
      const badEvent: GoalCycleEvent = {
        round: 1,
        phase: 'judge',
        actor: judge,
        result: {
          contract: 'goal-cycle/evaluate-judge/1',
          satisfied: true,
          gaps: [],
          criteria: [{ id: 'c1', satisfied: true, evidence: 'ok' }],
        },
        evidence: [evidence('9')],
      };
      expect(() => applyGoalCycleEvent(state, badEvent, 5)).toThrow(GoalCycleDomainError);
    });

    it('rejects measure judge result with inconsistent passed flag', () => {
      let state = initialGoalCycleState('measure');
      state = applyGoalCycleEvent(state, event(1, 'work', worker, WORK_RESULT, 'measure'), 5);
      const badEvent: GoalCycleEvent = {
        round: 1,
        phase: 'judge',
        actor: judge,
        result: {
          contract: 'goal-cycle/measure-judge/1',
          score: 50,
          threshold: 80,
          direction: 'gte',
          passed: true, // wrong — score < threshold
        },
        evidence: [evidence('9')],
      };
      expect(() => applyGoalCycleEvent(state, badEvent, 5)).toThrow(GoalCycleDomainError);
      expect(() => applyGoalCycleEvent(state, badEvent, 5)).toThrow(/inconsistent/);
    });

    it('rejects research judge result for evaluate variant', () => {
      let state = initialGoalCycleState('evaluate');
      state = applyGoalCycleEvent(state, event(1, 'work', worker, WORK_RESULT, 'evaluate'), 5);
      const badEvent: GoalCycleEvent = {
        round: 1,
        phase: 'judge',
        actor: judge,
        result: {
          contract: 'goal-cycle/research-judge/1',
          satisfied: true,
          gaps: [],
          qualityAssessment: 'good',
        },
        evidence: [evidence('9')],
      };
      expect(() => applyGoalCycleEvent(state, badEvent, 5)).toThrow(GoalCycleDomainError);
    });

    it('rejects evaluate criteria with duplicate ids', () => {
      let state = initialGoalCycleState('evaluate');
      state = applyGoalCycleEvent(state, event(1, 'work', worker, WORK_RESULT, 'evaluate'), 5);
      const badEvent: GoalCycleEvent = {
        round: 1,
        phase: 'judge',
        actor: judge,
        result: {
          contract: 'goal-cycle/evaluate-judge/1',
          satisfied: true,
          gaps: [],
          criteria: [
            { id: 'dup', satisfied: true, evidence: 'a' },
            { id: 'dup', satisfied: true, evidence: 'b' },
          ],
        },
        evidence: [evidence('9')],
      };
      expect(() => applyGoalCycleEvent(state, badEvent, 5)).toThrow(GoalCycleDomainError);
      expect(() => applyGoalCycleEvent(state, badEvent, 5)).toThrow(/duplicate/);
    });
  });

  describe('same-actor work+judge rejection', () => {
    it('rejects judge from same actor as worker', () => {
      let state = initialGoalCycleState('measure');
      state = applyGoalCycleEvent(state, event(1, 'work', worker, WORK_RESULT, 'measure'), 5);
      const sameActorEvent: GoalCycleEvent = {
        round: 1,
        phase: 'judge',
        actor: worker, // same actor!
        result: {
          contract: 'goal-cycle/measure-judge/1',
          score: 90,
          threshold: 80,
          direction: 'gte',
          passed: true,
        },
        evidence: [evidence('9')],
      };
      expect(() => applyGoalCycleEvent(state, sameActorEvent, 5)).toThrow(GoalCycleDomainError);
      expect(() => applyGoalCycleEvent(state, sameActorEvent, 5)).toThrow(/worker cannot judge/);
    });
  });

  describe('invalid transitions', () => {
    it('rejects event for wrong round', () => {
      const state = initialGoalCycleState('measure');
      const badEvent = event(2, 'work', worker, WORK_RESULT, 'measure');
      expect(() => applyGoalCycleEvent(state, badEvent, 5)).toThrow(GoalCycleDomainError);
      expect(() => applyGoalCycleEvent(state, badEvent, 5)).toThrow(/Expected round 1/);
    });

    it('rejects event for terminal state', () => {
      let state = initialGoalCycleState('measure');
      state = applyGoalCycleEvent(state, event(1, 'work', worker, WORK_RESULT, 'measure'), 5);
      state = applyGoalCycleEvent(state, event(1, 'judge', judge, null, 'measure'), 5);
      const extraEvent = event(2, 'work', worker, WORK_RESULT, 'measure');
      expect(() => applyGoalCycleEvent(state, extraEvent, 5)).toThrow(/terminal/);
    });

    it('rejects judge event when work phase expected', () => {
      const state = initialGoalCycleState('measure');
      const badEvent = event(1, 'judge', judge, null, 'measure');
      expect(() => applyGoalCycleEvent(state, badEvent, 5)).toThrow(/Expected round 1 phase work/);
    });
  });
});

// ---------------------------------------------------------------------------
// Happy-path tests (task 1.8)
// ---------------------------------------------------------------------------

describe('goal-cycle domain reducer — happy-path', () => {
  describe('measure variant', () => {
    it('satisfies when score >= threshold (gte)', () => {
      let state = initialGoalCycleState('measure');
      state = applyGoalCycleEvent(state, event(1, 'work', worker, WORK_RESULT, 'measure'), 5);
      expect(state.phase).toBe('judge');
      state = applyGoalCycleEvent(state, event(1, 'judge', judge, null, 'measure'), 5);
      expect(state.outcome).toBe('satisfied');
      expect(state.lastScore).toBe(85);
    });

    it('progresses to next round when not passed', () => {
      let state = initialGoalCycleState('measure');
      state = applyGoalCycleEvent(state, event(1, 'work', worker, WORK_RESULT, 'measure'), 5);
      const failJudge: GoalCycleEvent = {
        round: 1,
        phase: 'judge',
        actor: judge,
        result: {
          contract: 'goal-cycle/measure-judge/1',
          score: 50,
          threshold: 80,
          direction: 'gte',
          passed: false,
        },
        evidence: [evidence('9')],
      };
      state = applyGoalCycleEvent(state, failJudge, 5);
      expect(state.outcome).toBeUndefined();
      expect(state.round).toBe(2);
      expect(state.phase).toBe('work');
      expect(state.lastScore).toBe(50);
    });

    it('exhausts at maxIterations', () => {
      const maxIter = 2;
      const events: GoalCycleEvent[] = [];
      for (let round = 1; round <= maxIter; round++) {
        events.push(event(round, 'work', round === 1 ? worker : worker2, WORK_RESULT, 'measure'));
        events.push({
          round,
          phase: 'judge',
          actor: judge,
          result: {
            contract: 'goal-cycle/measure-judge/1',
            score: 50,
            threshold: 80,
            direction: 'gte',
            passed: false,
          },
          evidence: [evidence('9')],
        });
      }
      const state = reduceGoalCycleEvents(events, maxIter, 'measure');
      expect(state.outcome).toBe('exhausted');
      expect(state.round).toBe(maxIter);
    });

    it('tracks score progression while shared lifecycle owns stall detection', () => {
      let state = initialGoalCycleState('measure');
      // Round 1: score 50, not passed
      state = applyGoalCycleEvent(state, event(1, 'work', worker, WORK_RESULT, 'measure'), 5);
      state = applyGoalCycleEvent(state, {
        round: 1, phase: 'judge', actor: judge,
        result: { contract: 'goal-cycle/measure-judge/1', score: 50, threshold: 80, direction: 'gte', passed: false },
        evidence: [evidence('9')],
      }, 5);
      expect(state.lastScore).toBe(50);
      // Round 2: score 70, still not passed but improved
      state = applyGoalCycleEvent(state, event(2, 'work', worker2, WORK_RESULT, 'measure'), 5);
      state = applyGoalCycleEvent(state, {
        round: 2, phase: 'judge', actor: judge,
        result: { contract: 'goal-cycle/measure-judge/1', score: 70, threshold: 80, direction: 'gte', passed: false },
        evidence: [evidence('9')],
      }, 5);
      expect(state.lastScore).toBe(70);
      // Round 3: score 70 again; the domain keeps score truth while the
      // shared lifecycle compares progress fingerprints.
      state = applyGoalCycleEvent(state, event(3, 'work', worker, WORK_RESULT, 'measure'), 5);
      state = applyGoalCycleEvent(state, {
        round: 3, phase: 'judge', actor: judge,
        result: { contract: 'goal-cycle/measure-judge/1', score: 70, threshold: 80, direction: 'gte', passed: false },
        evidence: [evidence('9')],
      }, 5);
      expect(state.lastScore).toBe(70);
    });
  });

  describe('evaluate variant', () => {
    it('satisfies when gaps empty and satisfied true', () => {
      let state = initialGoalCycleState('evaluate');
      state = applyGoalCycleEvent(state, event(1, 'work', worker, WORK_RESULT, 'evaluate'), 5);
      state = applyGoalCycleEvent(state, event(1, 'judge', judge, null, 'evaluate'), 5);
      expect(state.outcome).toBe('satisfied');
      expect(state.lastSatisfied).toBe(true);
    });

    it('progresses when not satisfied', () => {
      let state = initialGoalCycleState('evaluate');
      state = applyGoalCycleEvent(state, event(1, 'work', worker, WORK_RESULT, 'evaluate'), 5);
      state = applyGoalCycleEvent(state, {
        round: 1, phase: 'judge', actor: judge,
        result: {
          contract: 'goal-cycle/evaluate-judge/1',
          satisfied: false,
          gaps: ['missing tests'],
          criteria: [{ id: 'c1', satisfied: false, evidence: 'no tests' }],
        },
        evidence: [evidence('9')],
      }, 5);
      expect(state.outcome).toBeUndefined();
      expect(state.round).toBe(2);
      expect(state.lastGaps).toEqual(['missing tests']);
    });
  });

  describe('research variant', () => {
    it('satisfies when document quality judged satisfactory', () => {
      let state = initialGoalCycleState('research');
      state = applyGoalCycleEvent(state, event(1, 'work', worker, RESEARCH_WORK_RESULT, 'research'), 5);
      state = applyGoalCycleEvent(state, event(1, 'judge', judge, null, 'research'), 5);
      expect(state.outcome).toBe('satisfied');
    });

    it('uses research work contract for work phase', () => {
      const state = initialGoalCycleState('research');
      const newState = applyGoalCycleEvent(state, event(1, 'work', worker, RESEARCH_WORK_RESULT, 'research'), 5);
      expect(newState.phase).toBe('judge');
      expect(newState.workerActor).toBeDefined();
    });
  });

  describe('ship guard', () => {
    it('passes when satisfied', () => {
      let state = initialGoalCycleState('measure');
      state = applyGoalCycleEvent(state, event(1, 'work', worker, WORK_RESULT, 'measure'), 5);
      state = applyGoalCycleEvent(state, event(1, 'judge', judge, null, 'measure'), 5);
      expect(() => assertGoalCycleMayShip(state)).not.toThrow();
    });

    it('fails when exhausted', () => {
      let state = initialGoalCycleState('measure');
      state = applyGoalCycleEvent(state, event(1, 'work', worker, WORK_RESULT, 'measure'), 1);
      state = applyGoalCycleEvent(state, {
        round: 1, phase: 'judge', actor: judge,
        result: { contract: 'goal-cycle/measure-judge/1', score: 50, threshold: 80, direction: 'gte', passed: false },
        evidence: [evidence('9')],
      }, 1);
      expect(() => assertGoalCycleMayShip(state)).toThrow(GoalCycleDomainError);
    });

    it('fails when not terminal', () => {
      const state = initialGoalCycleState('measure');
      expect(() => assertGoalCycleMayShip(state)).toThrow(GoalCycleDomainError);
    });
  });
});
