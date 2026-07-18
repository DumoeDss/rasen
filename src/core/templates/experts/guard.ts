import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from '../workflows/store-selection.js';

const BODY = `
# /guard — Full Safety Mode

Activates both destructive command warnings and directory-scoped edit restrictions.
This is the combination of \`/careful\` + \`/freeze\` in a single command.

**Dependency note:** This skill references hook scripts from the sibling \`/careful\`
and \`/freeze\` skill directories. Both must be installed (they are installed together
by rasen init/update).

## Setup

Ask the user which directory to restrict edits to. Use AskUserQuestion:

- Question: "Guard mode: which directory should edits be restricted to? Destructive command warnings are always on. Files outside the chosen path will be blocked from editing."
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
STATE_DIR="\${CLAUDE_PLUGIN_DATA:-$HOME/.rasen}"
mkdir -p "$STATE_DIR"
echo "$FREEZE_DIR" > "$STATE_DIR/freeze-dir.txt"
echo "Freeze boundary set: $FREEZE_DIR"
\`\`\`

Tell the user:
- "**Guard mode active.** Two protections are now running:"
- "1. **Destructive command warnings** — rm -rf, DROP TABLE, force-push, etc. will warn before executing (you can override)"
- "2. **Edit boundary** — file edits restricted to \`<path>/\`. Edits outside this directory are blocked."
- "To remove the edit boundary, run \`/unfreeze\`. To deactivate everything, end the session."

## What's protected

See \`/careful\` for the full list of destructive command patterns and safe exceptions.
See \`/freeze\` for how edit boundary enforcement works.
`;

export function getGuardSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen:guard',
    description: 'Full safety mode — destructive-command guardrails plus an edit boundary in one switch',
    instructions: `${BODY.trim()}\n\n${STORE_SELECTION_GUIDANCE}`,
    metadata: { author: 'rasen', version: '1.0' },
  };
}
