import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

const GOAL_JUDGE_INSTRUCTIONS = `Judge one admitted GoalLoop judge Action without changing the work product.

${STORE_SELECTION_GUIDANCE}

You are the fresh, authoritative **judge**, never the student/implementer. Read the frozen goal plan, the canonical Goal view, the current work product, and authoritative evidence. Treat completion as unproven until every requirement is supported. Do not edit files, redefine or narrow the goal, run another loop, or spawn subagents. The reconciler enforces author != verifier; your actor identity must differ from the work Action actor.

Return exactly the contract required by the admitted variant:

- \`measure\`: run or inspect the declared measurement and return \`goal-cycle/measure-judge/1\` with score, threshold, direction, and a mathematically consistent \`passed\` value.
- \`evaluate\`: audit the frozen goal/rubric and return \`goal-cycle/evaluate-judge/1\` with an evidence-backed score, satisfied flag, and concrete gaps.
- \`research\`: audit the research deliverable and return \`goal-cycle/research-judge/1\` with satisfied flag, score when applicable, and concrete gaps.

Only this judge capability emits a GoalLoop gate result. Uncertain or missing evidence is a gap, never implicit success.`;

export function getGoalJudgeSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-goal-judge',
    description:
      'Internal read-only GoalLoop judge capability: independently evaluates measure/evaluate/research work and emits the authoritative variant-specific judge result.',
    instructions: GOAL_JUDGE_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires rasen CLI.',
    metadata: { author: 'rasen', version: '1.0' },
  };
}
