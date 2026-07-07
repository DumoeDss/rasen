import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from '../workflows/store-selection.js';

const BODY = `
# /careful — Destructive Command Guardrails

Safety mode is now **active**. Every bash command will be checked for destructive
patterns before running. If a destructive command is detected, you'll be warned
and can choose to proceed or cancel.

## What's protected

| Pattern | Example | Risk |
|---------|---------|------|
| \`rm -rf\` / \`rm -r\` / \`rm --recursive\` | \`rm -rf /var/data\` | Recursive delete |
| \`DROP TABLE\` / \`DROP DATABASE\` | \`DROP TABLE users;\` | Data loss |
| \`TRUNCATE\` | \`TRUNCATE orders;\` | Data loss |
| \`git push --force\` / \`-f\` | \`git push -f origin main\` | History rewrite |
| \`git reset --hard\` | \`git reset --hard HEAD~3\` | Uncommitted work loss |
| \`git checkout .\` / \`git restore .\` | \`git checkout .\` | Uncommitted work loss |
| \`kubectl delete\` | \`kubectl delete pod\` | Production impact |
| \`docker rm -f\` / \`docker system prune\` | \`docker system prune -a\` | Container/image loss |

## Safe exceptions

These patterns are allowed without warning:
- \`rm -rf node_modules\` / \`.next\` / \`dist\` / \`__pycache__\` / \`.cache\` / \`build\` / \`.turbo\` / \`coverage\`

## How it works

The hook reads the command from the tool input JSON, checks it against the
patterns above, and returns \`permissionDecision: "ask"\` with a warning message
if a match is found. You can always override the warning and proceed.

To deactivate, end the conversation or start a new one. Hooks are session-scoped.
`;

export function getCarefulSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec:careful',
    description: '|',
    instructions: `${BODY.trim()}\n\n${STORE_SELECTION_GUIDANCE}`,
    metadata: { author: 'openspec', version: '1.0' },
  };
}
