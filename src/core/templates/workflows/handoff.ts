/**
 * Handoff OPSX Workflow Command
 *
 * Writes a distilled handoff document so a fresh agent (a new session's LEAD,
 * or a successor worker) can continue the work without replaying the exhausted
 * agent's transcript. The document carries what the change-directory blackboard
 * cannot: decision rationale, eliminated hypotheses, dead ends, and the next
 * concrete action. Session-level use is manual (`/opsx:handoff`); worker-level
 * use is driven by the orchestration playbook's handoff protocol (Step H).
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';

const HANDOFF_INSTRUCTIONS = `Write a handoff document — distill the current working context so a fresh agent can continue without replaying this conversation.

Context-window occupancy is measured, never guessed: \`openspec agent context --latest\` reads the exact API usage from the session transcript (\`--transcript <path>\` probes a specific worker transcript instead). The handoff document is a DISTILLATION CHECKPOINT on top of the change-directory blackboard, not a replacement for it — tasks.md ticks and on-disk artifacts stay the primary state; the document carries only what the blackboard cannot record.

## When to Use

Use when: "handoff", "交接", context usage is high and a fresh session is planned, before intentionally ending a long session mid-change, or when the orchestration playbook directs a worker to hand off mid-stage.

## Session-level flow (the default when a user invokes this)

1. **Probe first.** Run \`openspec agent context --latest --json\` and report \`{ contextTokens, limit, pct }\` to the user. This is informational — the user decides; do not refuse to hand off below any threshold.
2. **Select the change.** Use the active change being driven (infer from conversation / \`openspec list --json\`; prompt only if genuinely ambiguous). If no change is active, write the document to \`openspec/handoff/<topic-slug>.md\` instead and skip the run-state update.
3. **Write the document** to \`openspec/changes/<name>/handoff/lead-<n>.md\` where \`<n>\` is 1 + the highest existing lead-* number (never overwrite a predecessor). Use the template below.
4. **Update run-state** (\`openspec/changes/<name>/auto-run.json\`): set top-level \`sessionHandoff\` to \`{ "path": "handoff/lead-<n>.md", "pct": <probe pct>, "afterStage": "<last completed stage>", "at": "<ISO timestamp>" }\`. Create the file with just that field if no run-state exists yet.
5. **Tell the user how to resume**: start a fresh session and run \`/opsx:auto <change>\` (or \`openspec pipeline resume <change> --json\` manually) — resume reports the sessionHandoff pointer and the new LEAD reads the document FIRST, before any transcript warm-seeding.

## Worker-level use (directed by the orchestration playbook)

A worker told to hand off mid-stage writes \`openspec/changes/<name>/handoff/<role>-<n>.md\` with the same template, then returns the structured \`HANDOFF\` result to the LEAD. Workers NEVER update run-state — the LEAD does that accounting (single-writer invariant).

## Handoff document template

\`\`\`markdown
# Handoff: <change> — <role> #<n>

## Original intent
<What the user actually asked for, verbatim where it matters — not "what I was doing".>

## Position
Pipeline: <name>. Completed stages: <...>. Current stage: <id> (<what part of it>).

## Done / Remaining
Done: <task ids/short labels — reference tasks.md, do not copy it>.
Remaining: <task ids + anything discovered that tasks.md does not list>.

## Key decisions (and why)
- <decision> — <rationale; the successor must not re-litigate or silently reverse these>

## Dead ends & gotchas
- <approach tried and abandoned — why; traps in the code/tooling that cost time>

## Eliminated hypotheses (MANDATORY for fixer/debugger roles)
- <hypothesis> — ruled out by <evidence>. Current best hypothesis: <...>.

## Working set
<Files touched / mid-edit; commands or test invocations that matter.>

## Next action
<The single concrete first step the successor should take.>
\`\`\`

Sections with nothing to say state "none" rather than being dropped — an explicit "no dead ends" is information. Write for a reader with ZERO shared context: no conversation shorthand, no unexplained labels.

## Guardrails

- Never overwrite an existing handoff document; numbering is append-only.
- The document must not contradict the blackboard — if tasks.md is stale, fix tasks.md rather than describing the divergence.
- Do not paste large code/diff bodies into the document; point at files and line ranges instead.`;

export function getHandoffSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-handoff',
    description:
      'Write a handoff document — probe context usage (openspec agent context), distill decisions / dead ends / eliminated hypotheses / next action to the change directory, and record the sessionHandoff pointer so a fresh session or successor worker resumes from the distillate instead of a raw transcript.',
    instructions: HANDOFF_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires openspec CLI.',
    metadata: { author: 'openspec', version: '1.0' },
  };
}

export function getOpsxHandoffCommandTemplate(): CommandTemplate {
  return {
    name: 'OPSX: Handoff',
    description:
      'Write a handoff document distilling the current session or worker context so a fresh agent can continue the change',
    category: 'Workflow',
    tags: ['workflow', 'handoff', 'context', 'orchestration'],
    content: HANDOFF_INSTRUCTIONS,
  };
}
