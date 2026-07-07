/**
 * Goal OPSX Workflow Command
 *
 * Single user-facing entry for goal-driven iteration. The LEAD runs the
 * pre-flight + classification, selects ONE backend goal-loop pipeline
 * (explicit override wins), then drives it via the SAME orchestration playbook.
 * The three backend pipelines are homogeneous (one gate type each):
 *  - goal-loop-measure  — measure gate, code iterate, ship -> archive
 *  - goal-loop-evaluate — evaluate gate, code iterate, ship -> archive
 *  - goal-loop-research — evaluate gate, prose/research iterate, report tail
 * This mirrors how \`/opsx:auto\` classifies among full/small/bug-fix today; it
 * does NOT reimplement orchestration (it embeds the shared playbook).
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';
import { ORCHESTRATION_PLAYBOOK } from './_orchestration.js';

const GOAL_INSTRUCTIONS = `Goal-driven iteration — drive a task whose "done" is a condition (a measurable threshold or a quality judgment), not a code-change document. Repeat modify -> judge until the gate is satisfied or the round cap is hit.

${STORE_SELECTION_GUIDANCE}

You are the **LEAD**. You classify the task, select ONE backend goal-loop pipeline, and drive it by orchestrating role-isolated subagents. You pause at gates and the user can switch to manual at any time.

## When to Use

Use when: "drive this score to 90", "optimize p99 latency", "hit the lighthouse budget", "make this rubric-clean", "research and write a report on X". Use \`/opsx:auto\` for tasks whose product is a single reviewable code change (propose -> apply -> verify -> ship); use \`/opsx:goal\` when the product is a *condition* met by iteration.

## 0. Pre-flight context probe (once, non-blocking)

Before anything else run \`openspec agent context --latest --json\` — it measures YOUR (the LEAD session's) context occupancy. At or above the session handoff threshold (default 0.5; see the playbook's Step H), offer the user a three-way choice: (a) automatic relay now; (b) continue this session; (c) handle it manually via /opsx:handoff. Proceed on the user's say-so; below the threshold, proceed silently.

## 1. Classify and select the backend pipeline (explicit wins)

**Input**: \`/opsx:goal [measure|evaluate|research] [--pipeline goal-loop-<variant>] <task description>\`.

Choose the pipeline in this order:
1. **Explicit** — if the invocation has \`--pipeline <name>\`, OR its first token is one of \`measure\` / \`evaluate\` / \`research\` (a variant selector), use the matching \`goal-loop-<variant>\` pipeline. Strip the selector token; the rest is the task description.
2. **Classify by keyword** (suggestion only; explicit wins):
   - \`score|latency|optimize|lighthouse|benchmark|p99|memory|throughput\` -> **goal-loop-measure**
   - \`rubric|quality|clean|standard|refactor-quality\` -> **goal-loop-evaluate**
   - \`research|investigate|write report|write brief|autoresearch|literature\` -> **goal-loop-research**
3. **Ambiguous** -> default to **goal-loop-evaluate** (a quality judgment is the most general gate; a measure command can be refined during define-goal if the task turns out to be quantifiable).

DISPLAY the chosen pipeline and let the user change it before proceeding.

Built-in goal-loop pipelines (see \`openspec pipeline list --json\`):
- **goal-loop-measure** — define-goal -> iterate (measure gate) -> ship -> archive  _(quantifiable targets)_
- **goal-loop-evaluate** — define-goal -> iterate (evaluate gate) -> ship -> archive  _(rubric/quality)_
- **goal-loop-research** — define-goal -> iterate (evaluate gate) -> report  _(research/writing; prose work product, earlier relay)_

## 2. Fetch the selected pipeline's stage DAG

\`\`\`bash
openspec pipeline show <name> --json   # -> { name, description, buildOrder, stages }
\`\`\`

Execute stages in \`buildOrder\`. The \`iterate\` stage carries a \`loop: { kind: goal, gate: {...} }\` — the LEAD interprets it via **Step L** of the playbook (single dispatch per round, warm-reused implementer, the gate, goal-run.json). The \`define-goal\` stage's \`gate: true\` lets the user confirm a measure command before any round runs.

## 3. Execute the pipeline as the LEAD

${ORCHESTRATION_PLAYBOOK}

## Termination Invariants (non-negotiable)

- **maxRounds cap (default 5).** The loop is bounded. On exhaustion, proceed to the tail but mark \`outcome: maxRounds-exhausted\` — NEVER report success when the gate was never satisfied.
- **author != verifier.** For an evaluate gate, a FRESH reviewer worker (≠ the implementer) judges each round. For a measure gate, the neutral command is the verifier.
- **loopStallLimit (default 2).** Consecutive no-progress rounds trigger the LEAD strategy review (Step H.5) — never silently burn rounds.
- **Flat hierarchy.** The implementer NEVER spawns child subagents. Research is done inline by the implementer + Step H.3 relay.

## Resume

On invocation for an existing change, read \`goal-run.json\` (the authoritative loop spine) and run \`openspec pipeline resume <change> --json\` to find the next incomplete stage. The goal-loop resume protocol (playbook Step L): last record satisfied -> tail; last record not-passed -> resume at lastRound+1; no record -> round 1.

## Output Format

\`\`\`
## Goal: <change-name>

Pipeline: goal-loop-<variant>      Gate: measure | evaluate      Tier: A | B | C

### Loop
- [x] define-goal  — goal-plan.md (gate: <type>)
- [ ] iterate      — round 2/5, last score 87 (threshold 90)
- [ ] ship | report

### Outcome
satisfied | maxRounds-exhausted | in-progress
\`\`\`

## Guardrails

- Always pause at the define-goal gate — never skip human confirmation of a measure command.
- Save run-state + goal-run.json so the loop is resumable.
- Enforce author != verifier (evaluate: fresh reviewer each round; measure: the command).
- If the loop stalls (loopStallLimit consecutive no-progress rounds), run the Step H.5 escalation ladder before interrupting a human.`;

export function getGoalCommandSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-opsx-goal',
    description:
      'Goal-driven iteration entry — the LEAD classifies the task (measure | evaluate | research), selects one backend goal-loop pipeline, and drives it via the shared orchestration playbook. Repeats modify -> judge until a gate is satisfied or maxRounds is hit.',
    instructions: GOAL_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires openspec CLI.',
    metadata: { author: 'openspec', version: '1.0' },
  };
}

export function getOpsxGoalCommandTemplate(): CommandTemplate {
  return {
    name: 'OPSX: Goal',
    description:
      'Goal-driven iteration — LEAD classifies and drives a measure | evaluate | research goal-loop pipeline to a gate condition or maxRounds',
    category: 'Workflow',
    tags: ['workflow', 'goal-loop', 'iteration', 'orchestration'],
    content: GOAL_INSTRUCTIONS,
  };
}
