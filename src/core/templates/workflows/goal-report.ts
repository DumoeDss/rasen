/**
 * Goal-Report Skill Template (the `report` tail of the goal-loop-research
 * pipeline).
 *
 * Shipper role, research pipeline ONLY. Summarizes `goal-run.json` (rounds,
 * scores/satisfaction, outcome) into a final report artifact. No code to ship.
 * It MUST surface maxRounds-exhausted honestly — never report success when the
 * gate was never satisfied.
 */
import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

const GOAL_REPORT_INSTRUCTIONS = `Summarize the goal-loop run into a final report — the research pipeline's tail.

${STORE_SELECTION_GUIDANCE}

You are the **shipper** for the report stage of a goal-loop-research run. There is no code to ship; your job is to turn the loop's recorded history into a final report artifact that states the real outcome.

## Input

- \`goal-run.json\` (authoritative) — the per-round records: \`{round, score?, measurePassed?, evaluateSatisfied?, detail?, gaps?, error?, gitTreeFingerprint}\`.
- \`goal-plan.md\` — the original goal and gate.
- The work-product artifact (the document the implementer researched/wrote across rounds).

## Output: report

Write a final report (e.g. \`report.md\` or the artifact named in goal-plan.md) to the change directory containing:

- **Goal** — the success criterion, verbatim from goal-plan.md.
- **Outcome** — \`satisfied\` if the last recorded round's gate was satisfied; \`maxRounds-exhausted\` if the cap was hit without satisfaction. NEVER report success when the gate was never satisfied — surface the shortfall honestly.
- **Rounds** — a compact table: round number, the gate judgment (score/measurePassed or evaluateSatisfied + gaps), and any error. Include the gitTreeFingerprint where relevant.
- **Final state of the work product** — what was produced and where it lives.
- **Open gaps** — unresolved gaps from the final round, if any.

## Constraints

- Read \`goal-run.json\` as the source of truth; do not infer outcomes from the work product alone.
- If the implementer's last round was a HANDOFF (no gate record yet), say so — do not guess whether it would have passed.
- This stage does NOT run another gate round or edit the work product. It reports.`;

export function getGoalReportSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-goal-report',
    description:
      'Goal-loop report tail (shipper role, research pipeline only) — summarizes goal-run.json into a final report artifact. No code to ship; surfaces maxRounds-exhausted honestly.',
    instructions: GOAL_REPORT_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires openspec CLI.',
    metadata: { author: 'openspec', version: '1.0' },
  };
}
