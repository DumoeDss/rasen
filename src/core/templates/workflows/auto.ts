/**
 * Auto OPSX Workflow Command
 *
 * Autopilot mode — dispatch agent analyzes task complexity, selects
 * experts, and drives the full OPSX workflow end-to-end. Includes
 * dispatch agent logic for task classification and expert selection.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';

const AUTO_INSTRUCTIONS = `Autopilot mode — drives the full OPSX workflow end-to-end.

The dispatch agent analyzes tasks, selects experts on demand, drives the DAG pipeline, and pauses for confirmation at stage transitions. User can interrupt and switch to manual mode at any time.

## When to Use

Use when: "auto", "autopilot", "end to end", "do it all", "one shot".

## Dispatch Agent Logic

### Task Complexity Classification

Analyze the task description to classify complexity:

| Classification | Indicators | Pipeline |
|---------------|------------|----------|
| **Full Feature** | New feature, multi-component, significant scope, "add system", "implement module" | office-hours → propose → expert reviews → apply → verify → ship → archive → retro |
| **Small Feature** | Single-purpose addition, enhancement, "add button", "update form" | propose → apply → verify → ship → archive |
| **Bug Fix** | Bug fix, error correction, regression, "fix", "broken", "doesn't work" | propose (simplified) → apply → verify → ship → archive |

Display the classification and allow user to override before proceeding.

### Expert Selection Matrix

Select experts based on change characteristics:

| Condition | Expert | When |
|-----------|--------|------|
| Full Feature | /autoplan | During planning phase — comprehensive task generation |
| Security-relevant (auth, crypto, input validation, data handling) | /cso | During verify phase — security audit |
| Performance-sensitive (DB queries, API endpoints, rendering, algorithms) | /benchmark | During verify phase — performance analysis |
| UI changes (.tsx/.jsx/.vue/.svelte) | /design-review | During verify phase — visual audit |
| Always for Full/Standard | /review | During verify phase — code review |
| Full Feature with UI | /qa | During verify phase — browser testing |
| Standard/Small Feature | /qa-only | During verify phase — abbreviated QA |

## Pipeline Execution

### Full Feature Pipeline

\`\`\`
Stage 1: Office Hours
  └─ /opsx:office-hours (Startup or Builder mode)
  └─ Output: office-hours-design.md

Stage 2: Propose
  └─ /opsx:propose (consumes office-hours-design.md)
  └─ Output: proposal.md, design.md, specs/, tasks.md

  ⏸ PAUSE POINT 1: "Plan complete. Review proposal and tasks before implementation?"

Stage 3: Expert Reviews (if Full Feature)
  └─ /autoplan (comprehensive planning)
  └─ /cso (if security-relevant)
  └─ /benchmark (if performance-sensitive)

Stage 4: Apply
  └─ /opsx:apply (implement all tasks)
  └─ Output: code changes, tasks marked complete

  ⏸ PAUSE POINT 2: "Implementation complete. Proceed to verification?"

Stage 5: Verify
  └─ /opsx:verify (auto-scaled based on scope)
  └─ Output: review-report.md, cso-report.md, qa-report.md

  ⏸ PAUSE POINT 3: "Verification complete. Proceed to ship?"
  └─ If critical issues found, recommend resolving first

Stage 6: Ship
  └─ /opsx:ship (test, push, PR)
  └─ Output: ship-log.md

Stage 7: Archive
  └─ /opsx:archive
  └─ Output: archived change

Stage 8: Retro
  └─ /opsx:retro <change-name>
  └─ Output: retro.md
\`\`\`

### Small Feature Pipeline

\`\`\`
Stage 1: Propose
  └─ /opsx:propose
  └─ Output: proposal.md, design.md, tasks.md

  ⏸ PAUSE POINT 1: "Plan complete. Proceed to implementation?"

Stage 2: Apply
  └─ /opsx:apply

  ⏸ PAUSE POINT 2: "Implementation complete. Proceed to verification?"

Stage 3: Verify
  └─ /opsx:verify (Standard depth)

  ⏸ PAUSE POINT 3: "Verification complete. Proceed to ship?"

Stage 4: Ship
  └─ /opsx:ship

Stage 5: Archive
  └─ /opsx:archive
\`\`\`

### Bug Fix Pipeline

\`\`\`
Stage 1: Propose (simplified)
  └─ /opsx:propose (focus on bug description and fix approach)

  ⏸ PAUSE POINT 1: "Fix planned. Proceed to implementation?"

Stage 2: Apply
  └─ /opsx:apply

  ⏸ PAUSE POINT 2: "Fix applied. Proceed to verification?"

Stage 3: Verify
  └─ /opsx:verify (Light depth — review only)

  ⏸ PAUSE POINT 3: "Verification complete. Ship the fix?"

Stage 4: Ship
  └─ /opsx:ship

Stage 5: Archive
  └─ /opsx:archive
\`\`\`

## DAG State Resume

On invocation, read current state to determine where to resume:

\`\`\`bash
openspec status --change "<name>" --json
\`\`\`

Map artifact presence to pipeline stage completion:
- \`office-hours-design.md\` exists → office-hours complete
- \`proposal.md\` exists → propose complete
- \`tasks.md\` exists with all tasks checked → apply complete
- \`review-report.md\` exists → verify complete
- \`ship-log.md\` exists → ship complete

Resume from the next incomplete stage.

If no change exists yet, start from the beginning — create a new change first.

## Pause Points

At each pause point:
1. Display a summary of what was accomplished in the completed stage
2. Show what the next stage will do
3. If critical issues were found, recommend resolution before continuing
4. Wait for user confirmation:
   - **Continue** → proceed to next stage
   - **Stop** → save progress, user can resume later with \`/opsx:auto\`
   - **Manual** → exit autopilot, user takes over with individual commands

## Output Format

\`\`\`
## Auto: <change-name>

**Classification:** Full Feature | Small Feature | Bug Fix
**Pipeline:** <stage list>
**Current Stage:** <stage name>

### Progress
- [x] Office Hours — design doc created
- [x] Propose — 7 tasks generated
- [ ] Apply — implementing...
- [ ] Verify
- [ ] Ship
- [ ] Archive

### Experts Selected
- /review (always)
- /cso (security-relevant)
- /benchmark (performance-sensitive)
\`\`\`

## Guardrails

- Always pause at the 3 defined pause points — never skip user confirmation
- If any stage fails, stop and report the failure — do not continue
- User can interrupt at any time by typing "stop" or pressing Ctrl+C
- Save progress so the pipeline can be resumed from where it left off
- Do not run /ship if verification found critical issues — warn the user first`;

export function getAutoCommandSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-opsx-auto',
    description: 'Autopilot mode — dispatch agent drives the full OPSX workflow end-to-end with task classification, expert selection, and pause points.',
    instructions: AUTO_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires openspec CLI.',
    metadata: { author: 'openspec', version: '1.0' },
  };
}

export function getOpsxAutoCommandTemplate(): CommandTemplate {
  return {
    name: 'OPSX: Auto',
    description: 'Autopilot mode — dispatch agent drives the full OPSX workflow end-to-end',
    category: 'Workflow',
    tags: ['workflow', 'autopilot', 'dispatch'],
    content: AUTO_INSTRUCTIONS,
  };
}
