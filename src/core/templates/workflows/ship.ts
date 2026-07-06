/**
 * Ship OPSX Workflow Command
 *
 * Release workflow — merges gstack /ship (test, push, create PR) and
 * /land-and-deploy (merge, CI, deploy, verify production).
 * PR body sourced from proposal summary. Ship log written to change directory.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

const SHIP_INSTRUCTIONS = `Release workflow — test, push, create PR, optionally merge and deploy.

${STORE_SELECTION_GUIDANCE}

PR body comes from proposal summary. Ship log recorded to the OpenSpec change directory.

## When to Use

Use when: "ship it", "deploy", "create PR", "push", "land it", "merge", "release", "go live".

## Steps

### 1. Select the Change

If a change name is provided, use it. Otherwise:
- Infer from conversation context
- Auto-select if only one active change exists
- If ambiguous, run \`openspec list --json\` and prompt for selection

### 2. Pre-Flight Checks

Run all checks before shipping:

**a. Verification Status**
- Check if \`openspec/changes/<name>/review-report.md\` exists (or \`review-cycle-report.md\` from the review loop, or any other expert \`*-report.md\` — any of these counts as verification evidence)
- If no verification report found, warn: "No verification report found. Run /opsx:verify first."
- Prompt user to confirm proceeding without verification

**b. Task Completion**
- Read \`openspec/changes/<name>/tasks.md\`
- Verify all tasks are marked complete (\`- [x]\`)
- If incomplete tasks exist, list them and prompt for confirmation

**c. Clean Git Status**
- Run \`git status --porcelain\`
- If uncommitted changes exist, prompt user to commit or stash
- If on detached HEAD, warn and suggest creating a branch

**d. All Checks Pass**
- If all checks pass, proceed directly to ship phase

### 3. Ship Phase

Invoke the \`/ship\` expert skill which handles:
- Running tests (\`npm test\` / \`pnpm test\` / detected test command)
- Reviewing the diff for obvious issues
- Pushing the branch to remote
- Creating a pull request via \`gh pr create\`

**PR Body Generation:**

If \`openspec/changes/<name>/proposal.md\` exists:
- Extract "Why" and "What Changes" sections
- Use as PR body with proper markdown formatting
- Derive PR title from change name or proposal summary

If no proposal.md:
- Generate PR body from commit messages
- Use change name as PR title
- Note that no proposal was available

**Fallback (if /ship skill fails):**
- Run tests directly: detect and execute project test command
- Push branch: \`git push -u origin <branch>\`
- Create PR: \`gh pr create --title "<title>" --body "<body>"\`

### 4. Write Ship Log

After successful PR creation, write \`openspec/changes/<name>/ship-log.md\`:

\`\`\`markdown
# Ship Log: <change-name>

**Date:** <timestamp>
**Branch:** <branch-name>
**PR:** <PR-URL>
**Status:** PR Created

## Pre-Flight Results
- Verification: <pass/skip>
- Tasks: <N/M complete>
- Git status: clean

## Deployment
Status: Pending (run /opsx:ship --deploy to continue)
\`\`\`

### 5. Optional: Land and Deploy

If the user opts into deployment (or passes \`--deploy\`):

1. Wait for CI checks to pass on the PR
2. Merge the PR (squash or merge based on repo convention)
3. Wait for deployment pipeline to complete
4. Run production verification checks
5. Update ship-log.md with deployment status

\`\`\`
## Deployment
Status: Deployed
Merged: <merge-commit>
CI: Passed
Production: Verified
\`\`\`

If CI fails:
- Report the failure details
- Do NOT proceed with deployment
- Update ship-log.md with failure details

### 6. Post-Ship

After shipping, suggest:
- Run \`/opsx:retro\` for a retrospective on the change
- Run \`/opsx:archive\` to archive the completed change
- Run \`/document-release\` to update project documentation

## Output

\`\`\`
## Ship: <change-name>

### Pre-Flight
- [x] Verification: passed
- [x] Tasks: 7/7 complete
- [x] Git: clean

### Ship
- Branch: feature/add-auth
- PR: https://github.com/org/repo/pull/42
- Status: Created

### Next Steps
- Monitor CI: gh pr checks 42
- Deploy: /opsx:ship --deploy
- Retro: /opsx:retro <change-name>
\`\`\``;

export function getShipCommandSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-opsx-ship',
    description: 'Ship the change — test, push, create PR, optionally merge and deploy. PR body from proposal. Ship log saved to change directory.',
    instructions: SHIP_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires openspec CLI.',
    metadata: { author: 'openspec', version: '1.0' },
  };
}

export function getOpsxShipCommandTemplate(): CommandTemplate {
  return {
    name: 'OPSX: Ship',
    description: 'Ship the change — test, push, create PR, optionally merge and deploy',
    category: 'Workflow',
    tags: ['workflow', 'release', 'ship', 'deploy'],
    content: SHIP_INSTRUCTIONS,
  };
}
