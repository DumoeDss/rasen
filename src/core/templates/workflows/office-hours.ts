/**
 * Office-Hours Rasen Workflow Command
 *
 * YC-style product validation — two modes: Startup (six forcing questions)
 * and Builder (design thinking brainstorm). Produces a design doc
 * dual-written to Rasen change directory.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

const OFFICE_HOURS_INSTRUCTIONS = `YC-style product validation — integrates /office-hours into the Rasen workflow.

${STORE_SELECTION_GUIDANCE}

Two modes:
- **Startup mode**: Six forcing questions that expose demand reality
- **Builder mode**: Design thinking brainstorm for side projects, hackathons, learning, and open source

## When to Use

Use when: "is this worth building?", "office hours", "validate my idea", "brainstorm this", "I have an idea", "product validation".

Positioned between /rasen:explore (technical exploration) and /rasen:propose (create change).

## Steps

### 1. Mode Selection

If no mode is specified, prompt the user:

- **Startup mode**: For validating whether something is worth building. Asks six forcing questions covering:
  1. Problem — What specific problem are you solving?
  2. Audience — Who exactly has this problem? How many?
  3. Existing Alternatives — What do people use today? Why is that insufficient?
  4. Unique Value — What's your unfair advantage or unique insight?
  5. Risks — What could kill this? Technical risks, market risks, timing risks?
  6. Success Metrics — How will you know this is working? First milestone?

- **Builder mode**: For design thinking brainstorm sessions. Explores:
  - Architecture options and trade-offs
  - Implementation approaches
  - Technology choices
  - Scope definition (MVP vs full vision)

### 2. Execute the Session

**Startup mode**:
- Walk through each of the six forcing questions in order
- Require a substantive answer before proceeding to the next question
- Challenge weak answers — push for specificity
- After all six questions, synthesize findings into a design document

**Builder mode**:
- Start with understanding the user's idea
- Explore multiple architecture options
- Discuss trade-offs for each approach
- Converge on a recommended direction
- Produce a design document summarizing the brainstorm

### 3. Invoke Expert Skill

Invoke the \`/office-hours\` expert skill for the detailed session execution. The expert skill contains the full facilitation logic.

### 4. Produce Output

Generate a design document with sections:
- Executive Summary
- Problem Statement (Startup) / Idea Overview (Builder)
- Key Findings / Design Decisions
- Recommended Next Steps
- Open Questions

### 5. Dual-Write Output

**If an active Rasen change context exists:**
- Write output to \`rasen/changes/<name>/office-hours-design.md\`
- This is the change's single validation doc — a stable name within the task directory, just like \`proposal.md\`. Re-running office-hours on the same change refines this file in place.
- This document will be automatically consumed by \`/rasen:propose\` as input context

**If no active change exists:**
- Derive a descriptive kebab-case slug from the topic (e.g. "real-time collaboration" → \`real-time-collaboration\`), exactly the way \`/rasen:propose\` derives a change name from a description
- Write output to \`rasen/office-hours/<topic-slug>.md\` — **one file per topic**, so separate validation sessions never overwrite each other (do NOT use a single fixed filename)
- If that exact filename already exists for an UNRELATED topic, disambiguate with a short suffix (\`-2\`, \`-alt\`, …) rather than overwriting
- Inform the user of the path and that they can reference it when creating a new change

### 6. Next Steps

After the session, suggest:
- Run \`/rasen:propose\` to create a formal change proposal based on the design doc
- Or continue exploring with \`/rasen:explore\`

## Output Format

\`\`\`
## Office Hours: <topic>

**Mode:** Startup | Builder
**Date:** <date>

### Summary
<executive summary>

### Findings
<key findings or design decisions>

### Recommended Next Steps
<actionable next steps>

### Open Questions
<unresolved questions>
\`\`\`

## Downstream Integration

The \`/rasen:propose\` command auto-detects \`office-hours-design.md\` in the change directory and incorporates its insights into the proposal.`;

export function getOfficeHoursCommandSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-office-hours-command',
    description: 'YC-style product validation — validate demand reality before building. Two modes: Startup (six forcing questions) and Builder (design brainstorm).',
    instructions: OFFICE_HOURS_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires rasen CLI.',
    metadata: { author: 'rasen', version: '1.0' },
  };
}

export function getOpsxOfficeHoursCommandTemplate(): CommandTemplate {
  return {
    name: 'Rasen: Office Hours',
    description: 'YC-style product validation — validate demand reality before building',
    category: 'Workflow',
    tags: ['workflow', 'validation', 'product'],
    content: OFFICE_HOURS_INSTRUCTIONS,
  };
}
