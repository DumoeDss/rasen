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
- skill identity and cross-tool portability;
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

## Reviewing a pipeline instead of a workflow

Run \`rasen pipeline validate <path> --json\` first, exactly as for a workflow —
static errors block the semantic review and go back to the author. Then read
the complete \`pipeline.yaml\` and check:

- **Stage-DAG acyclicity** — every stage's \`requires\` list resolves to a real,
  earlier stage id, with no cycle; the CLI validator already enforces this at
  parse time, so a pipeline that reaches review has passed it, but confirm the
  resulting build order still matches the author's intent.
- **Unique stage ids** — also CLI-enforced; treat a near-duplicate id
  (misleading rather than colliding) as a review finding.
- **Decompose recursion bound** — a \`kind: decompose\` stage's \`childPipeline\`
  must resolve to an installed pipeline that is itself decompose-free. Flag
  any design that assumes deeper fan-out than one level.
- **Runtime/model resolvability** — for every stage, trace the effective
  runtime (stage \`runtime\` > pipeline \`agents.<role>\` > default \`claude\`).
  A \`codex\` runtime is a portability cost: the execution preflight will
  refuse to run that stage on a machine without the codex CLI installed, so
  confirm the pipeline's docs say so and that a \`claude\` fallback path
  (role override or stage-level \`runtime: claude\`) is realistic.
- **Skill enablement** — every \`standard\` stage's \`skill\` must name a
  workflow that exists AND is enabled in the installing machine's active
  profile; a pipeline package's static validator only checks structure, not
  skill existence, so this is a review-time judgment call, not something the
  CLI already guarantees.

Apply the same static-validate-first discipline as workflow review: never
approve on the strength of \`rasen pipeline validate\` output alone, and never
treat a passing structural validation as evidence the pipeline's prose or
skill choices are safe or complete.
`;

export function getWorkflowReviewSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-workflow-review',
    description: 'Review installable workflows and pipelines independently — semantic quality, security boundaries, portability, dependencies, and completion',
    instructions: `${BODY.trim()}\n\n${STORE_SELECTION_GUIDANCE}`,
    metadata: { author: 'rasen', version: '1.0' },
  };
}
