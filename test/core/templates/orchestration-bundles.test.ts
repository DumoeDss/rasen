import { describe, expect, it } from 'vitest';

import { generateSkillContent } from '../../../src/core/shared/skill-generation.js';
import {
  getAutoCommandSkillTemplate,
  getGoalCommandSkillTemplate,
  getReviewCycleSkillTemplate,
} from '../../../src/core/templates/skill-templates.js';
import {
  AUTO_ORCHESTRATION_PLAYBOOK,
  GOAL_ORCHESTRATION_PLAYBOOK,
  ORCHESTRATION_PLAYBOOK,
  REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK,
} from '../../../src/core/templates/workflows/_orchestration.js';

const SHARED_STEPS = [
  'A',
  'A.1',
  'B',
  'B.2',
  'B.3',
  'B.4',
  'C',
  'F',
  'F.1',
  'H',
] as const;

const CANONICAL_STEP_ORDER = [
  'A',
  'A.1',
  'B',
  'B.1',
  'B.2',
  'B.3',
  'B.4',
  'C',
  'D',
  'E',
  'L',
  'F',
  'F.1',
  'G',
  'G.1',
  'H',
] as const;

function stepHeading(step: string): string {
  return `### Step ${step} `;
}

function expectSteps(
  playbook: string,
  included: readonly string[],
  excluded: readonly string[]
): void {
  for (const step of included) {
    expect(playbook, `included Step ${step}`).toContain(stepHeading(step));
  }
  for (const step of excluded) {
    expect(playbook, `excluded Step ${step}`).not.toContain(stepHeading(step));
  }
}

function expectCanonicalOrder(
  playbook: string,
  included: readonly string[]
): void {
  const positions = CANONICAL_STEP_ORDER
    .filter(step => included.includes(step))
    .map(step => playbook.indexOf(stepHeading(step)));

  expect(positions.every(position => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((left, right) => left - right));
}

function expectForbiddenSemantics(
  playbook: string,
  forbidden: readonly string[]
): void {
  for (const clause of forbidden) {
    expect(playbook, `forbidden semantic clause: ${clause}`).not.toContain(
      clause
    );
  }
}

describe('selective orchestration bundles', () => {
  it('keeps auto byte-stable and complete', () => {
    expect(AUTO_ORCHESTRATION_PLAYBOOK).toBe(ORCHESTRATION_PLAYBOOK);
    expectSteps(
      AUTO_ORCHESTRATION_PLAYBOOK,
      CANONICAL_STEP_ORDER,
      []
    );
    expectCanonicalOrder(
      AUTO_ORCHESTRATION_PLAYBOOK,
      CANONICAL_STEP_ORDER
    );
  });

  it('composes the goal capability set without review, planner, or portfolio rules', () => {
    const included = [...SHARED_STEPS, 'D', 'L'];
    expectSteps(
      GOAL_ORCHESTRATION_PLAYBOOK,
      included,
      ['B.1', 'E', 'G', 'G.1']
    );
    expectCanonicalOrder(GOAL_ORCHESTRATION_PLAYBOOK, included);

    expect(GOAL_ORCHESTRATION_PLAYBOOK).not.toMatch(/Step B\.1\b/);
    expect(GOAL_ORCHESTRATION_PLAYBOOK).not.toMatch(/Step E(?:\b|\.)/);
    expect(GOAL_ORCHESTRATION_PLAYBOOK).not.toMatch(/Step G(?:\b|\.)/);
    expect(GOAL_ORCHESTRATION_PLAYBOOK).not.toContain('LOOP_BOUND');
    expect(GOAL_ORCHESTRATION_PLAYBOOK).not.toContain('MILESTONE_BOUND');
    expect(GOAL_ORCHESTRATION_PLAYBOOK).not.toContain('review-loop reviewer/fixer');
    expect(GOAL_ORCHESTRATION_PLAYBOOK).not.toContain('persistent planner');
    expectForbiddenSemantics(GOAL_ORCHESTRATION_PLAYBOOK, [
      'portfolio-run.json',
      'For a decomposed parent',
      '`runnableChildren`',
      '`interruptedChildren`',
      '`escalatedChildren`',
      '`completedChildren`',
      'cross-child implementer reuse',
      'other portfolio children',
      'dependent or subsequent child change',
      'a full child pipeline',
      'child change so the main line can move',
      'recommend decomposing',
      'recommend decompose',
      'decompose signal',
      'decompose budget',
      'decompose the obstruction',
      'review `rounds`',
      '`openFindings`',
      'delta re-review',
      'review-cycle\'s single-dispatch-per-round shape',
      'like review-cycle reuses the fixer thread',
    ]);
  });

  it('composes the review-cycle capability set without planner, metadata, goal, or portfolio rules', () => {
    const included = [...SHARED_STEPS, 'E'];
    expectSteps(
      REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK,
      included,
      ['B.1', 'D', 'L', 'G', 'G.1']
    );
    expectCanonicalOrder(REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK, included);

    expect(REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK).not.toMatch(/Step B\.1\b/);
    expect(REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK).not.toMatch(/Step D\b/);
    expect(REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK).not.toMatch(/Step L\b/);
    expect(REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK).not.toMatch(/Step G(?:\b|\.)/);
    expect(REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK).toContain('LOOP_BOUND');
    expect(REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK).not.toContain('MILESTONE_BOUND');
    expect(REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK).not.toContain('persistent planner');
    expectForbiddenSemantics(REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK, [
      'evaluate-gate schema',
      'leaf-return/evaluate-gate contract',
      'goal-loop run artifact',
      'goal-run.json',
      '`loopStallLimit`',
      '`blockedThreshold`',
      '`evaluateSatisfied`',
      '`measurePassed`',
      'goal rounds',
      'portfolio-run.json',
      'For a decomposed parent',
      '`runnableChildren`',
      '`interruptedChildren`',
      '`escalatedChildren`',
      '`completedChildren`',
      'cross-child implementer reuse',
      'other portfolio children',
      'dependent or subsequent child change',
      'a full child pipeline',
      'child change so the main line can move',
      'recommend decomposing',
      'recommend decompose',
      'decompose signal',
      'decompose budget',
      'goal-loop',
    ]);
  });

  it('retains the shared dispatch, isolation, state, resume, and handoff rules', () => {
    for (const playbook of [
      AUTO_ORCHESTRATION_PLAYBOOK,
      GOAL_ORCHESTRATION_PLAYBOOK,
      REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK,
    ]) {
      expect(playbook).toContain('role-isolated worker');
      expect(playbook).toContain('author != verifier');
      expect(playbook).toContain('Maintain run-state');
      expect(playbook).toContain('Resume a run');
      expect(playbook).toContain('Worker self-handoff');
      expect(playbook).toContain('Workers NEVER write run-state');
      expect(playbook).toContain(
        'design-level rework — send the problem back to the planner'
      );
    }
  });

  it('keeps fully generated SKILL.md files within their UTF-8 byte budgets', () => {
    const cases = [
      ['auto', getAutoCommandSkillTemplate, 106],
      ['goal', getGoalCommandSkillTemplate, 70],
      ['review-cycle', getReviewCycleSkillTemplate, 60],
    ] as const;

    for (const [name, createTemplate, maxKiB] of cases) {
      const content = generateSkillContent(createTemplate(), 'SIZE-BUDGET');
      expect(
        Buffer.byteLength(content, 'utf8'),
        `${name} generated SKILL.md exceeds ${maxKiB} KiB`
      ).toBeLessThanOrEqual(maxKiB * 1024);
    }
  });
});
