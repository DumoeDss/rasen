/**
 * Goal-Report Skill Template (the `report` tail of the goal-loop-research
 * pipeline).
 *
 * Shipper role, research pipeline ONLY. Summarizes the canonical Run view
 * (rounds, scores/satisfaction, outcome) into a final report artifact. No code
 * to ship. It MUST surface maxRounds-exhausted honestly — never report success
 * when the gate was never satisfied.
 */
import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

const GOAL_REPORT_INSTRUCTIONS = `Summarize the goal-loop run into a final report — the research pipeline's tail.

${STORE_SELECTION_GUIDANCE}

You are the **shipper** for the report stage of a goal-loop-research run. There is no code to ship; your job is to turn the loop's recorded history into a final report artifact that states the real outcome.

## Input

- The canonical Run view (authoritative) — run \`rasen pipeline status --change <name> --json\` and read the \`sections[].kind === 'goal'\` entry. This section carries \`variant\`, \`round\`, \`phase\`, \`outcome\` ('satisfied' | 'exhausted' | undefined), \`lastScore\`, \`lastGaps\`, \`stallStreak\`, and \`budget\`. The canonical Record is the sole source of truth — do not consult \`goal-run.json\` for Run state.
- \`goal-plan.md\` — the original goal and gate.
- The work-product artifact (the document the implementer researched/wrote across rounds).

## Output: report

Write a final report (e.g. \`report.md\` or the artifact named in goal-plan.md) to the change directory containing:

- **Goal** — the success criterion, verbatim from goal-plan.md.
- **Outcome** — \`satisfied\` if the Run's goal section \`outcome\` is \`satisfied\`; \`maxRounds-exhausted\` if \`outcome\` is \`exhausted\`. NEVER report success when the gate was never satisfied — surface the shortfall honestly.
- **Rounds** — summarize the progression: final round, phase, score/gaps from the goal section.
- **Final state of the work product** — what was produced and where it lives.
- **Open gaps** — unresolved gaps from the final round (\`lastGaps\` in the goal section), if any.

## Constraints

- Read the canonical Run view (\`rasen pipeline status --change <name> --json\` → goal section) as the source of truth; do not infer outcomes from the work product alone or from the legacy \`goal-run.json\` file.
- If the implementer's last round was a HANDOFF (no gate record yet), say so — do not guess whether it would have passed.
- This stage does NOT run another gate round or edit the work product. It reports.`;

export function getGoalReportSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-goal-report',
    description:
      'Goal-loop report tail (shipper role, research pipeline only) — summarizes the canonical Run view into a final report artifact. No code to ship; surfaces maxRounds-exhausted honestly.',
    instructions: GOAL_REPORT_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires rasen CLI.',
    metadata: { author: 'rasen', version: '1.0' },
  };
}
