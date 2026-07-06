/**
 * Ship OPSX Workflow Command
 *
 * Self-contained release workflow — test, push, create PR, optionally merge
 * and deploy. The ship execution contract is inlined here (no expert delegation).
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

Run the ship contract directly — this workflow is self-contained and does NOT delegate to any expert skill.

**a. Detect the base branch**
- Prefer an existing PR's base: \`gh pr view --json baseRefName -q .baseRefName\`
- Else the repo default: \`gh repo view --json defaultBranchRef -q .defaultBranchRef.name\`
- Else fall back to \`main\`. Use this value wherever the steps below say \`<base>\`.

**b. Merge the base branch BEFORE tests**
- \`git fetch origin <base> && git merge origin/<base> --no-edit\` so tests run against the merged state
- If the merge produces conflicts that cannot be resolved automatically, **STOP** and surface the conflicts — do not push
- If already up to date, continue silently

**c. Run tests on the merged code**
- Detect and run the project's test command (\`pnpm test\` / \`npm test\` / \`bun test\` / \`cargo test\` / \`pytest\` / etc. — infer from the repo, do not hardcode a runner)
- Read the output and check pass/fail
- If any in-branch test fails, **STOP** and do NOT push (a genuinely pre-existing failure unrelated to this branch's diff may be noted and triaged, but when in doubt treat it as blocking)

**d. Review the diff for obvious structural issues**
- \`git diff origin/<base>...HEAD\` — scan for accidental debug output, secrets, obviously broken logic, or leftover TODO markers before pushing

**PR Body Generation:**

If \`openspec/changes/<name>/proposal.md\` exists:
- Extract "Why" and "What Changes" sections
- Use as PR body with proper markdown formatting
- Derive PR title from change name or proposal summary

If no proposal.md:
- Generate PR body from commit messages
- Use change name as PR title
- Note that no proposal was available

**e. Fresh-verification gate (before push)**
- If any code changed after step (c)'s test run — for example from review fixes in step (d) — re-run the test suite and require fresh passing output before pushing. Stale results from the earlier run are not acceptable.
- If the re-run fails, **STOP** and fix before proceeding — do not push.

**f. Push the branch**
- \`git push -u origin <branch>\` (push with upstream tracking; never force-push)

**g. Create the PR**
- \`gh pr create --base <base> --title "<title>" --body "<body>"\` using the title/body from PR Body Generation above
- Output the PR URL

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
- Update project documentation (README, architecture notes, changelog) to match what shipped, so the docs do not drift from the release

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
