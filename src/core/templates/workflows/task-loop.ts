import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

const TASK_LOOP_INSTRUCTIONS = `Execute exactly one phase of an internal task-loop round over the real artifact targets.

${STORE_SELECTION_GUIDANCE}

The canonical Action input contains \`taskLoop.phase\`, the frozen contract, contract digest, round, and phase-specific context. It replaces proposal/design/specs/tasks/goal-plan for this lifecycle. Never create those planning artifacts and never switch or fall back to another Pipeline.

## Shared rules

- Work only against the frozen goal, artifactTargets, bar, and constraints. Never weaken or rewrite them.
- Inspect the real artifact targets and direct file/test/render/runtime/measurement evidence. A prose summary is not evidence.
- Do one phase, return one structured canonical completion, and stop. The reconciler owns iteration, budget, resume, and terminal state.
- Never spawn subagents. Builder and critic context separation is owned by the LEAD/reconciler.

## When taskLoop.phase is work (builder)

- Inspect and materially improve the real targets. For round > 1, focus on only the supplied prior \`largestGap\` and \`passCondition\`.
- Run the smallest direct checks that produce raw evidence for changed targets.
- Return \`goal-cycle/work-result/1\` with distinct beforeTree/afterTree values and a bound delta EvidenceRef.
- Do not declare the bar satisfied. Builder completion claims are non-authoritative.

## When taskLoop.phase is judge (fresh critic)

- Start from the frozen contract, target locations, afterTree, and rawEvidence in the Action input. Independently inspect the real artifacts/evidence; do not seek or grade builder reasoning or summaries.
- Return \`goal-cycle/evaluate-judge/1\`. Cover every frozen criterion ID exactly once; each criterion carries a boolean and evidence text naming a frozen target.
- Set \`satisfied: true\` only when every criterion passes, raw evidence exists, \`gaps\` is empty, and omit \`largestGap\`/\`passCondition\`.
- Otherwise set \`satisfied: false\`, return exactly one gap, repeat it in \`largestGap\`, and provide one explicit testable \`passCondition\` for the next builder.
- Never judge a round you built. Every round requires a critic identity not used by an earlier task-loop judgment.

Blocked, failed, exhausted, cancelled, or explicitly stopped loops remain non-deliverable. \`--no-gate\` cannot waive contract, evidence, safety, terminal, ship, or archive guards.`;

export function getTaskLoopSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-task-loop',
    description:
      'Internal task-loop builder/critic phase contract over real artifacts; fresh evidence-based criticism and one-gap feedback.',
    instructions: TASK_LOOP_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires rasen CLI reconciler engine.',
    metadata: { author: 'rasen', version: '1.0' },
  };
}
