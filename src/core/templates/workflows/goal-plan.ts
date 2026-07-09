/**
 * Goal-Plan Skill Template (the `define-goal` stage of a goal-loop pipeline).
 *
 * Planner role. Input = the task description. Output = `goal-plan.md` carrying
 * the goal (NL), the gate (measure XOR evaluate — chosen by task nature), the
 * work product (code | prose), and maxRounds. It does NOT produce
 * proposal/design/specs — a goal-loop is condition-driven, not document-driven.
 * The `gate: 'vet'` on the stage lets the user confirm a measure command (also
 * the safety valve for "measure.command is arbitrary shell") — it is the hard
 * autopilot-gate-policy carve-out, never auto-approved by `--no-gate`.
 */
import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

const GOAL_PLAN_INSTRUCTIONS = `Define the goal and gate for a goal-loop task — produce goal-plan.md.

${STORE_SELECTION_GUIDANCE}

You are the **planner** for a goal-driven iteration loop. Your output is the contract the implementer iterates against and the LEAD injects before round 1. You do NOT produce proposal.md / design.md / specs — a goal-loop is condition-driven, not document-driven.

## Input

The task description (what condition the user wants driven to satisfaction) plus any change-directory context. If the task is ambiguous about the success condition, clarify it before proceeding; do not invent a gate the user did not ask for.

## Output: goal-plan.md

Write \`goal-plan.md\` to the change directory with these fields:

\`\`\`markdown
# Goal Plan

## Goal
<one-to-three sentence NL success criterion — what "done" means>

## Gate
<exactly ONE of the following>

### measure  (quantifiable target — score / latency / memory / throughput)
- command: <shell command whose stdout is JSON { score: number, passed?: number, detail?: string }>
- threshold: <number>          # score stop threshold
- target: <number>             # optional passed-count target
- direction: gte | lte         # gte = higher is better; lte = lower is better (latency/memory)
- timeoutSec: <number>         # default 120

### evaluate  (quality judgment against a rubric)
- goal: <NL success criterion the reviewer judges>
- rubric: <optional structured rubric / acceptance bullets>

## Work Product
code | prose   # code = edit the codebase; prose = research + write a document (research pipeline)

## maxRounds
<number>   # default 5; research/evaluate MAY set lower (e.g. 3)
\`\`\`

## Choosing the gate

Pick exactly ONE gate type by task nature — never both:
- **measure** when the target is quantifiable and a deterministic command can emit \`{score, passed}\`. Examples: Lighthouse score, p99 latency, memory peak, benchmark throughput, test-pass count.
- **evaluate** when "done" is a quality judgment against a standard that no command can score. Examples: code-quality against a rubric, refactor cleanliness, research-report completeness.

## measure.command safety

\`measure.command\` is arbitrary shell. The define-goal stage carries \`gate: 'vet'\`, so the user confirms the command before any round runs — and, unlike an ordinary gate, this confirmation is NEVER auto-approved by \`--no-gate\` or an \`autopilot.gates: off\` project default (autopilot-gate-policy). Prefer commands that are read-only or idempotent. State the command plainly in goal-plan.md so the user can vet it at the gate. Do NOT add sandbox enforcement beyond that confirmation.

## Constraints

- Exactly ONE gate (measure XOR evaluate). Do not combine.
- The concrete \`command\`/\`threshold\` (measure) or \`goal\`/\`rubric\` (evaluate) live HERE — the pipeline YAML registers only the gate TYPE; the LEAD reads this file to inject them into \`iterate.loopConfig\`.
- Keep the goal falsifiable: a future round must be able to tell satisfied from not-satisfied.
- This is a planning stage. Do NOT edit code or write the work product here — that is the implementer's job in the iterate stage.`;

export function getGoalPlanSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-goal-plan',
    description:
      'Goal-loop define-goal stage (planner role) — produces goal-plan.md with the goal, a measure XOR evaluate gate, work product, and maxRounds. Does NOT produce proposal/design/specs.',
    instructions: GOAL_PLAN_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires rasen CLI.',
    metadata: { author: 'rasen', version: '1.0' },
  };
}
