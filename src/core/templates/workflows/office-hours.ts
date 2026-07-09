/**
 * Office-Hours Rasen Workflow Command
 *
 * YC-style product validation — routes by product: Diagnosis (six forcing
 * questions validating a venture) or Design (fork-first feedback and
 * convergence on a design or plan). Produces a design doc dual-written to
 * the Rasen change directory.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

const OFFICE_HOURS_INSTRUCTIONS = `YC-style product validation — integrates /office-hours into the Rasen workflow.

${STORE_SELECTION_GUIDANCE}

Routes by product, not by mode or identity:
- **Diagnosis product**: Six forcing questions that expose demand reality — validates whether a venture is worth building
- **Design product**: Fork-first feedback and convergence on a design or plan already in hand, or a vague idea still being shaped

## When to Use

Use when: "is this worth building?", "office hours", "validate my idea", "brainstorm this", "I have an idea", "product validation".

Positioned between /rasen:explore (technical exploration) and /rasen:propose (create change).

## Steps

### 1. Product Routing

Route the session by which product the user is buying — the object of the request, not their identity (this routing is the command's value-add). The six-questions / design-feedback descriptions below ALSO serve as the **fallback pre-brief** used only if the \`/office-hours\` expert is unavailable (Step 2) — they are NOT a facilitation script run alongside the expert.

If the product isn't clear from the opening message, prompt the user:

- **Diagnosis product**: For validating whether a venture is worth building. Asks six forcing questions covering:
  1. Problem — What specific problem are you solving?
  2. Audience — Who exactly has this problem? How many?
  3. Existing Alternatives — What do people use today? Why is that insufficient?
  4. Unique Value — What's your unfair advantage or unique insight?
  5. Risks — What could kill this? Technical risks, market risks, timing risks?
  6. Success Metrics — How will you know this is working? First milestone?

- **Design product**: For fork-first feedback and design thinking sessions. Explores:
  - Architecture options and trade-offs
  - Implementation approaches
  - Technology choices
  - Scope definition (MVP vs full vision)

### 2. Delegate the session to the /office-hours expert (single facilitation authority)

**The \`/office-hours\` expert skill (\`rasen-office-hours\`) is the single authority for session facilitation.** Invoke it to run the session — it holds the full, hardened facilitation logic (the forcing questions, the fork-scan procedure, and the dialogue discipline). Do NOT re-run the question set inline as a separate second pass; this command's value-add is **lifecycle integration** (product routing in Step 1, the dual-write location in Step 4, and the \`/rasen:propose\` handoff), NOT facilitation.

**Fallback (only when the expert is unavailable):** if the \`/office-hours\` expert skill cannot be invoked, run the inline product-routed description from Step 1 as a pre-brief and carry the session yourself. This is a documented fallback, never a second facilitation pass alongside the expert. **Precedence: when both the inline description and the expert exist, the expert wins.**

### 3. Produce the design document (once)

The session produces the design document **exactly once** (whether facilitated by the expert or, in the fallback, inline) — never a second doc-production pass. Sections:
- Executive Summary
- Problem Statement (Diagnosis) / Idea Overview (Design)
- Key Findings / Design Decisions
- Recommended Next Steps
- Open Questions

### 4. Dual-Write Output

**If an active Rasen change context exists:**
- Write output to \`office-hours-design.md\` under \`changeRoot\` (from \`rasen status --json\`), NOT a literal repo-relative \`rasen/changes/<name>/\` path
- This is the change's single validation doc — a stable name within the task directory, just like \`proposal.md\`. Re-running office-hours on the same change refines this file in place.
- This document will be automatically consumed by \`/rasen:propose\` as input context

**If no active change exists:**
- Derive a kebab-case slug from the topic — the **verbatim** kebab-case of the description, with NO abbreviation (e.g. "real-time collaboration" → \`real-time-collaboration\`), exactly the way \`/rasen:propose\` derives a change name from a description (so the two slugs converge and propose can auto-detect this file)
- Write output to \`<topic-slug>.md\` under the \`office-hours/\` directory that is the sibling of \`planningHome.changesDir\` (from \`rasen status --json\`), NOT a literal repo-relative \`rasen/office-hours/\` path — **one file per topic**, so separate validation sessions never overwrite each other (do NOT use a single fixed filename)
- If that exact filename already exists for an UNRELATED topic, disambiguate with a short suffix (\`-2\`, \`-alt\`, …) rather than overwriting
- Inform the user of the path. When they later run \`/rasen:propose\` with the same topic, propose AUTO-DETECTS this file — its no-active-change scan looks for \`<change-name>.md\` in this \`office-hours\` directory, and because both derive the same kebab slug, a matching change name lines up with this filename.

### 5. Next Steps

After the session, suggest:
- Run \`/rasen:propose\` to create a formal change proposal based on the design doc
- Or continue exploring with \`/rasen:explore\`

## Output Format

\`\`\`
## Office Hours: <topic>

**Product:** Diagnosis | Design
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

The \`/rasen:propose\` command auto-detects this session's design doc and incorporates its insights into the proposal. It scans **both** locations this command writes to: (1) \`office-hours-design.md\` in the change directory (the active-change dual-write), and (2) \`<change-name>.md\` in the \`office-hours\` directory alongside the changes directory (the no-active-change write, discoverable because office-hours and propose derive the same kebab slug). Paths are resolved from \`rasen status --json\`, not hardcoded.`;

export function getOfficeHoursCommandSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-office-hours-command',
    description: 'YC-style product validation — validate demand reality before building. Routes by product: Diagnosis (six forcing questions) or Design (fork-first feedback and brainstorm).',
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
