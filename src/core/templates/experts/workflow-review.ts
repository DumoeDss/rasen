import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from '../workflows/store-selection.js';

const BODY = `
# /workflow-review — Independent Workflow Review

Review a staged installable workflow for semantic quality, safety, and
portability. Read \`checklist.md\` beside this skill before reviewing. The review
is read-only unless the user separately asks for fixes.

## Preconditions

1. Review a staging directory, never the final user-wide registry.
2. Run \`rasen workflow validate <path> --json\` first. Static errors block the
   semantic review and must be returned to the author.
3. Do not execute scripts from the workflow.
4. When multi-agent execution is available, the reviewer must be distinct from
   the author. Otherwise declare that this is a separated second pass.

## Review procedure

Read the complete \`workflow.yaml\`, \`SKILL.md\`, and every declared sidecar.
Use \`checklist.md\` and verify:

- purpose, trigger, scope, inputs, outputs, completion, and escalation;
- manifest \`requires\` / \`recommends\` agreement with instruction references;
- responsibility overlap with built-in workflows and always-installed experts;
- skill-only versus command delivery and cross-tool portability;
- confirmation boundaries for destructive, network, secret, and external writes;
- shell interpolation, path traversal, credential handling, and absolute paths;
- profile/pipeline input-output contracts and deterministic failure behavior;
- bounded loops, recovery behavior, and a clear terminal condition.

## Findings contract

Return each real finding in this exact shape:

\`\`\`text
[severity] location
Evidence: concrete text or behavior
Required fix: specific correction and acceptance condition
\`\`\`

Severity is \`critical\`, \`high\`, \`medium\`, or \`low\`. Do not report stylistic
preferences as defects. End with one verdict: \`APPROVE\`, \`CHANGES REQUIRED\`,
or \`BLOCK\`, followed by the reason.

After fixes, rerun static validation and review only the changed surface plus
affected dependencies. A successful review is not a signature or attestation:
do not add a reviewed flag to the workflow or package, and do not import it.
`;

export function getWorkflowReviewSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen:workflow-review',
    description: 'Review installable workflows independently — semantic quality, security boundaries, portability, dependencies, and completion',
    instructions: `${BODY.trim()}\n\n${STORE_SELECTION_GUIDANCE}`,
    metadata: { author: 'rasen', version: '1.0' },
  };
}
