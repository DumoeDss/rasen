import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from '../workflows/store-selection.js';

const BODY = `
# /freeze — Restrict Edits to a Directory

Lock file edits to a specific directory. Any Edit or Write operation targeting
a file outside the allowed path will be **blocked** (not just warned).

## Setup

Ask the user which directory to restrict edits to. Use AskUserQuestion:

- Question: "Which directory should I restrict edits to? Files outside this path will be blocked from editing."
- Text input (not multiple choice) — the user types a path.

Once the user provides a directory path:

1. Resolve it to an absolute path:
\`\`\`bash
FREEZE_DIR=$(cd "<user-provided-path>" 2>/dev/null && pwd)
echo "$FREEZE_DIR"
\`\`\`

2. Ensure trailing slash and save to the freeze state file:
\`\`\`bash
FREEZE_DIR="\${FREEZE_DIR%/}/"
STATE_DIR="\${CLAUDE_PLUGIN_DATA:-$HOME/.gstack}"
mkdir -p "$STATE_DIR"
echo "$FREEZE_DIR" > "$STATE_DIR/freeze-dir.txt"
echo "Freeze boundary set: $FREEZE_DIR"
\`\`\`

Tell the user: "Edits are now restricted to \`<path>/\`. Any Edit or Write
outside this directory will be blocked. To change the boundary, run \`/freeze\`
again. To remove it, run \`/unfreeze\` or end the session."

## How it works

The hook reads \`file_path\` from the Edit/Write tool input JSON, then checks
whether the path starts with the freeze directory. If not, it returns
\`permissionDecision: "deny"\` to block the operation.

The freeze boundary persists for the session via the state file. The hook
script reads it on every Edit/Write invocation.

## Notes

- The trailing \`/\` on the freeze directory prevents \`/src\` from matching \`/src-old\`
- Freeze applies to Edit and Write tools only — Read, Bash, Glob, Grep are unaffected
- This prevents accidental edits, not a security boundary — Bash commands like \`sed\` can still modify files outside the boundary
- To deactivate, run \`/unfreeze\` or end the conversation
`;

export function getFreezeSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec:freeze',
    description: '|',
    instructions: `${BODY.trim()}\n\n${STORE_SELECTION_GUIDANCE}`,
    metadata: { author: 'openspec', version: '1.0' },
  };
}
