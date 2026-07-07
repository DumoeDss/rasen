import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from '../workflows/store-selection.js';

const BODY = `
# /unfreeze — Clear Freeze Boundary

Remove the edit restriction set by \`/freeze\`, allowing edits to all directories.

## Clear the boundary

\`\`\`bash
STATE_DIR="\${CLAUDE_PLUGIN_DATA:-$HOME/.gstack}"
if [ -f "$STATE_DIR/freeze-dir.txt" ]; then
  PREV=$(cat "$STATE_DIR/freeze-dir.txt")
  rm -f "$STATE_DIR/freeze-dir.txt"
  echo "Freeze boundary cleared (was: $PREV). Edits are now allowed everywhere."
else
  echo "No freeze boundary was set."
fi
\`\`\`

Tell the user the result. Note that \`/freeze\` hooks are still registered for the
session — they will just allow everything since no state file exists. To re-freeze,
run \`/freeze\` again.
`;

export function getUnfreezeSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec:unfreeze',
    description: '|',
    instructions: `${BODY.trim()}\n\n${STORE_SELECTION_GUIDANCE}`,
    metadata: { author: 'openspec', version: '1.0' },
  };
}
