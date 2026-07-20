import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from '../workflows/store-selection.js';

const BODY = `
# /workflow-author — Installable Workflow Authoring

Create a portable user workflow through a staging directory. The Rasen CLI's
static validator is the security boundary; semantic review is a separate
quality gate. Never edit the user-wide workflow registry directly.

## 1. Define the contract

Before writing files, establish these six items with the user. Ask only for
information that cannot be inferred from the repository or request:

1. Purpose — the bounded job this workflow owns.
2. Trigger — when an agent should select it.
3. Inputs — required files, arguments, and preconditions.
4. Expected output — files, decisions, or reports it produces.
5. Completion condition — observable proof that the workflow is done.
6. Prohibited actions — destructive, network, secret, or external-write boundaries.

## 2. Check the library and choose staging

Run \`rasen workflow list --json\` and inspect workflow IDs, skill names, and
command IDs before choosing a portable lowercase ID. Pick a writable staging
directory outside the final user-wide registry. Then scaffold explicitly:

\`\`\`sh
rasen workflow init <id> --output <staging-parent>/<id>
\`\`\`

If the environment cannot write the user-wide library, that is acceptable:
finish in staging and hand the user the validated path and exact import command.

## 3. Author the smallest source tree

Edit only \`workflow.yaml\`, \`SKILL.md\`, and sidecars that are actually needed.

- Put workflow dependencies in \`requires.workflows\`, not only in prose.
- Put always-installed expert dependencies in \`requires.skills\`.
- Put optional related workflows in \`recommends.workflows\`.
- Declare every sidecar and script in the manifest.
- Keep paths relative and portable; never embed an absolute machine path.
- Do not add binary files, generated output, credentials, or machine metadata.
- Do not execute sidecar scripts while authoring, validating, or importing.

## 4. Static validation loop

Run \`rasen workflow validate <staging-path> --json\`. Fix every error by its
stable diagnostic code and repeat until the result is valid. Warnings must be
reported and either resolved or explicitly explained; never hide them.

## 5. Independent semantic review

Invoke \`rasen:workflow-review\` on the validated staging directory. When
multi-agent execution is available, dispatch a reviewer that did not author the
draft. Otherwise perform a clearly separated second pass using the review
checklist. Static validity does not replace this review.

Apply required findings in staging, then run
\`rasen workflow validate <staging-path> --json\` again until it is valid.

## 6. Handoff and optional import

Present:

- the staged file tree;
- workflow ID and skill/command identity;
- required and recommended dependencies;
- every declared script and its purpose;
- the final validation result and content digest;
- unresolved warnings or semantic risks.

Do not install implicitly. Only after the user asks to install, run:

\`\`\`sh
rasen workflow import <staging-path>
rasen workflow validate <id> --json
rasen workflow show <id> --json
\`\`\`

If import is unavailable, return the exact command instead. Never claim that a
workflow was imported, reviewed, or validated unless that action actually ran.
`;

export function getWorkflowAuthorSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen:workflow-author',
    description: 'Author installable workflows safely — stage, statically validate, independently review, and import only with user approval',
    instructions: `${BODY.trim()}\n\n${STORE_SELECTION_GUIDANCE}`,
    metadata: { author: 'rasen', version: '1.0' },
  };
}
