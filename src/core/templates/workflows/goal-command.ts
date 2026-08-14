/**
 * Goal Rasen Workflow Command (ECP-3: thinned launcher)
 *
 * Single user-facing entry for goal-driven iteration. The LEAD runs the
 * pre-flight + classification, selects ONE backend goal-loop pipeline
 * (explicit override wins), then launches a canonical reconciler-engine Run.
 * The reconciler owns the loop mechanics (rounds, phases, stall, exhaustion);
 * this launcher does NOT own mechanical state.
 */
import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

const GOAL_INSTRUCTIONS = `Goal-driven iteration — drive a task whose "done" is a condition (a measurable threshold or a quality judgment), not a code-change document. The reconciler-engine Run owns the loop mechanics; you classify, launch, and report.

${STORE_SELECTION_GUIDANCE}

You are the **LEAD**. You classify the task, select ONE backend goal-loop pipeline, launch a canonical Run, and drive it by orchestrating role-isolated subagents through \`rasen pipeline resume\`. You pause at gates and the user can switch to manual at any time.

## When to Use

Use when: "drive this score to 90", "optimize p99 latency", "hit the lighthouse budget", "make this rubric-clean", "research and write a report on X". Use \`rasen-auto\` for tasks whose product is a single reviewable code change (propose -> apply -> verify -> ship); use \`rasen-goal\` when the product is a *condition* met by iteration.

## 0. Pre-flight context probe (once, non-blocking)

Before anything else run \`rasen agent context --latest --json\` — it measures YOUR (the LEAD session's) context occupancy. At or above the session handoff threshold (default 0.5), offer the user a three-way choice: (a) automatic relay now; (b) continue this session; (c) handle it manually via rasen-handoff. Proceed on the user's say-so; below the threshold, proceed silently.

## 1. Classify and select the backend pipeline (explicit wins)

**Input**: \`rasen-goal [measure|evaluate|research] [--pipeline goal-loop-<variant>] <task description>\`.

Choose the pipeline in this order:
1. **Explicit** — if the invocation has \`--pipeline <name>\`, OR its first token is one of \`measure\` / \`evaluate\` / \`research\` (a variant selector), use the matching \`goal-loop-<variant>\` pipeline. Strip the selector token; the rest is the task description.
2. **Classify by keyword** (suggestion only; explicit wins):
   - \`score|latency|optimize|lighthouse|benchmark|p99|memory|throughput\` -> **goal-loop-measure**
   - \`rubric|quality|clean|standard|refactor-quality\` -> **goal-loop-evaluate**
   - \`research|investigate|write report|write brief|autoresearch|literature\` -> **goal-loop-research**
3. **Ambiguous** -> default to **goal-loop-evaluate** (a quality judgment is the most general gate; a measure command can be refined during define-goal if the task turns out to be quantifiable).

DISPLAY the chosen pipeline and let the user change it before proceeding.

Built-in goal-loop pipelines (see \`rasen pipeline list --json\`):
- **goal-loop-measure** — define-goal -> iterate (measure gate) -> ship -> retain -> archive  _(quantifiable targets)_
- **goal-loop-evaluate** — define-goal -> iterate (evaluate gate) -> ship -> retain -> archive  _(rubric/quality)_
- **goal-loop-research** — define-goal -> iterate (evaluate gate) -> report only  _(research/writing; prose work product, earlier relay; no ship, retain, or archive)_

## 2. Launch the canonical Run

\`\`\`bash
rasen pipeline start <change> goal-loop-<variant> --json
\`\`\`

This creates a reconciler-engine Run. The reconciler owns the loop mechanics: rounds, work→judge phases, stall detection, maxRounds cap, and termination (satisfied/exhausted). The \`goal-run.json\` file is a derived compatibility projection — it CANNOT back-drive the Run.

**Engine policy applies here too.** \`rasen pipeline start\` resolves the engine from \`--engine\` over \`runs.engine\` (project > store > global) over the default \`auto\`. Goal loops REQUIRE the reconciler, so a project that has turned the reconciler off (\`runs.engine: legacy\`) gets a typed \`engine_disabled_by_config\` refusal naming the deciding layer — report that as the cause rather than retrying, since there is no legacy goal-loop path to fall back to. Pass \`--engine reconciler\` only when the user explicitly wants to override a configured policy for this one launch.

## 3. Drive the Run (preview → render → admit)

At each quiescent boundary:

1. Consume the prompt-free \`candidates[]\` returned by \`start\` or \`complete\`, or reproduce it with \`rasen pipeline resume-run <change> goal-loop-<variant> --json\`. An unchanged canonical head reproduces the identical candidate; resume does not admit an agent Action.
2. For every candidate, render the existing complete role-isolated prompt from these trusted source instructions plus the frozen candidate descriptor and canonical goal state. Write private ephemera as \`{ "format": "agent-turn-input-manifest/1", "candidates": [{ "candidateId": "<exact id>", "prompt": "<complete prompt>" }] }\`. Include every preview candidate exactly once; never persist or print prompt bodies.
3. Run \`rasen pipeline admit <change> --run <runId> --turn-input-file <private-manifest-path> --json\`. Only \`admit\` creates and grants the bound Actions. A stale, wrong, missing, duplicate, or extra candidate fails closed; preview again rather than editing an old id.
4. Dispatch the returned \`actions[]\`, transporting prompt bytes identical to those authenticated at admission. Use an implementer for work and a different reviewer for judge; the reconciler rejects same-actor judging.
5. Commit each phase with \`rasen pipeline complete <change> --run <runId> --from <receipt.json> --json\`. Completion returns the next preview and never auto-admits an agent successor.

\`rasen pipeline status <change> goal-loop-<variant> --json\` includes a \`goal\` section with: \`variant\`, \`round\`, \`phase\` (work|judge), \`outcome\` (satisfied|exhausted|undefined), \`lastScore\`, \`lastGaps\`, \`stallStreak\`, \`budget\` (used/max), and \`waitReason\`.

Read the goal section to report progress instead of owning loop state. The canonical Record + projector is the authoritative spine.

## Termination

The reconciler handles termination:
- **satisfied**: goal-cycle outcome is \`satisfied\` → the bounded-loop succeeds → downstream stages (ship/archive or report) proceed.
- **exhausted**: maxRounds reached without satisfaction → the Run escalates with \`goal_cycle_exhausted\`.

On exhaustion, mark the outcome honestly — NEVER report success when the gate was never satisfied.

## Resume

\`\`\`bash
rasen pipeline resume-run <change> goal-loop-<variant> --json
\`\`\`

The reconciler replays all committed events from the canonical Record. The next ready action is deterministic — same nodeId, same phase, same round. Completed actions are never re-admitted. Score, gaps, and stall state are fully reconstructable from the plan + Record.

## Output Format

\`\`\`
## Goal: <change-name>

Pipeline: goal-loop-<variant>      Gate: measure | evaluate

### Loop (from goal/1 section)
- [x] define-goal  — goal-plan.md (gate: <type>)
- [ ] iterate      — round 2/5, last score 87 (threshold 90)

### Tail (show only the selected pipeline's tail)
- [ ] ship -> retain -> archive  — measure/evaluate
- [ ] report only                — research; no ship, retain, or archive

### Outcome
satisfied | maxRounds-exhausted | in-progress
\`\`\`

## Guardrails

- Under the default gate policy, pause at the define-goal gate — confirm the goal + gate before any round runs.
- The reconciler enforces actor separation (worker ≠ judge) and stall detection — you do NOT track these manually.
- Save nothing mechanical — the canonical Record is the authoritative spine. \`goal-run.json\` is a read-only projection.`;

export function getGoalCommandSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-goal',
    description:
      'Goal-driven iteration entry — the LEAD classifies the task (measure | evaluate | research), selects one backend goal-loop pipeline, and launches a canonical reconciler-engine Run. The reconciler owns loop mechanics (rounds, phases, stall, exhaustion).',
    instructions: GOAL_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires rasen CLI.',
    metadata: { author: 'rasen', version: '1.0' },
  };
}
