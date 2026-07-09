/**
 * Ship Rasen Workflow Command
 *
 * Self-contained release workflow — commit, resolve the delivery mode
 * (pr / push / local), run tests only when evidence demands it, then deliver.
 * The ship execution contract is inlined here (no expert delegation).
 * PR body sourced from proposal summary. Ship log written to the change's
 * external work directory (resolved via `rasen status --json`; fallback:
 * the change directory). Archive timing (`archive.timing` from the same
 * status payload) decides whether spec sync + bookkeeping run inside this
 * ship stage (`in-ship`) or are deferred to a later archive gated on merge
 * confirmation (`on-merge`, the default).
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

const SHIP_INSTRUCTIONS = `Release workflow — commit, resolve the delivery mode (pr / push / local), test when evidence demands it, deliver, optionally merge and deploy.

${STORE_SELECTION_GUIDANCE}

PR body comes from proposal summary. Ship log recorded to the change's work directory (resolve \`workDir\` from \`rasen status --change <name> --json\`; fall back to the change directory when it is absent or \`ship-log.md\` already lives there).

Resolve \`archive.timing\` from the same status payload (\`archive.timing\`, default \`on-merge\` when absent). Recorded ship-log facts (delivery mode, PR URL, archived-in-ship marker) for a delivery that already happened always outrank a later re-resolved config value — the timing axis is consulted only for decisions not yet taken.

## When to Use

Use when: "ship it", "deploy", "create PR", "push", "land it", "merge", "release", "go live".

## Steps

### 1. Select the Change

If a change name is provided, use it. Otherwise:
- Infer from conversation context
- Auto-select if only one active change exists
- If ambiguous, run \`rasen list --json\` and prompt for selection

### 2. Pre-Flight Checks

Run all checks before shipping:

**a. Verification Status**
- Check if \`verification-report.md\` (from \`/rasen:verify\`), \`review-report.md\`, \`review-cycle-report.md\` (from the review loop), or any other expert \`*-report.md\` exists in the work directory (\`workDir\` from \`rasen status --change <name> --json\`; fall back to the change directory) — any of these counts as verification evidence
- If no verification report found, warn: "No verification report found. Run /rasen:verify first."
- Prompt user to confirm proceeding without verification

**b. Task Completion**
- Read \`rasen/changes/<name>/tasks.md\`
- Verify all tasks are marked complete (\`- [x]\`)
- If incomplete tasks exist, list them and prompt for confirmation

**c. Working Tree State**
- Run \`git status --porcelain\`
- Uncommitted changes do NOT block — committing them is the ship phase's own job (step 3b)
- If on detached HEAD, warn and suggest creating a branch

**d. All Checks Pass**
- If all checks pass, proceed directly to ship phase

### 3. Ship Phase

Run the ship contract directly — this workflow is self-contained and does NOT delegate to any expert skill.

**a. Resolve the delivery mode**

Exactly one of three modes:
- **pr** — deliver via pull request against a resolved integration base.
- **push** — commit to the current branch and push it directly; no PR (repos where the working branch IS the integration branch).
- **local** — commit only; no push, no PR. For decomposed child changes sharing a working tree: delivery happens ONCE at the portfolio/parent level after ALL children complete.

Resolution precedence (first match wins):
1. An explicit argument or pipeline stage metadata (e.g. \`--mode\`, \`--base\`).
2. An existing open PR for the current branch (\`gh pr view --json baseRefName -q .baseRefName\`) → mode **pr**, base = that PR's base.
3. Repository convention — project instructions (CLAUDE.md etc.) or the branch's git history (a branch that is routinely committed to and pushed directly implies **push**).
4. Ask the user.

NEVER resolve an integration base by falling back to the repository's default branch — a branch whose target you had to guess is a branch you must ask about.

**b. Commit the change (all modes)**
- **In-ship timing only, before staging/committing:** run the change's archive now, inside the ship stage, so its results ride this same delivery. Order matters — the change directory is about to move:
  1. Capture what later ship steps need from the change directory FIRST: PR-body sections from \`proposal.md\`, task-completion facts.
  2. Sync delta specs into main specs (the \`rasen-sync-specs\` step — same sync the archive skill runs).
  3. Move the change directory to \`<changesDir>/archive/YYYY-MM-DD-<name>\` (the same collision rule as \`/rasen:archive\`'s bookkeeping step).
  4. Record \`Archived in ship: <path>\` for the ship log (step 4).
- Stage the change's files — under in-ship timing, this also includes the synced main specs and the moved change directory from the steps above — and commit with a conventional message derived from the change name / proposal summary
- Pre-commit hooks (lint, format) may reject the commit: fix the reported issues and retry — NEVER bypass with \`--no-verify\`
- If the working tree is already clean, skip this step (on-merge timing only — in-ship timing always has the sync + move above to commit)

**c. Merge the integration base (pr mode ONLY)**
- \`git fetch origin <base> && git merge origin/<base> --no-edit\` so the test gate runs against the merged state — \`<base>\` is the base resolved in (a), never a guessed default
- If the merge produces conflicts that cannot be resolved automatically, **STOP** and surface the conflicts — do not deliver
- If already up to date, continue silently
- In **push** or **local** mode, skip this step entirely — there is no merge event to pre-validate

**d. Evidence-based test gate (all modes)**

Run the project's detected test command (\`pnpm test\` / \`npm test\` / \`bun test\` / \`cargo test\` / \`pytest\` / etc. — infer from the repo, do not hardcode a runner) ONLY if at least one holds:
1. Step (c) merged in new commits — the merged state has never been tested.
2. No green test evidence exists for the current code state. Evidence = a recorded passing test run (in \`verification-report.md\`, \`review-report.md\`, \`review-cycle-report.md\`, another verification report, or run-state) whose recorded content tree fingerprint (\`git rev-parse HEAD^{tree}\`) matches the current one. The tree hash is content-addressed — it changes if and only if the tracked tree content changes — so the commit in (b), which moves HEAD but changes no content, does not invalidate evidence; lint or review fixes change the tree and DO.
3. The user explicitly asks for a test run.

Otherwise SKIP the run and record \`tests: skipped — green at <evidence source>, tree <fingerprint>\` for the ship log. Missing evidence means RUN — the gate skips on proof, never on hope.

If tests run and any in-branch test fails, **STOP** and do NOT deliver (a genuinely pre-existing failure unrelated to this change's diff may be noted and triaged, but when in doubt treat it as blocking).

**e. Review the diff for obvious structural issues**
- Scan the change's diff (\`git diff origin/<base>...HEAD\` in pr mode; the commits being delivered otherwise) for accidental debug output, secrets, obviously broken logic, or leftover TODO markers before delivering

**PR Body Generation (pr mode):**

Under **in-ship** timing, the change directory already moved in step (b) — use the PR-body sections CAPTURED in step (b).1 (read from \`proposal.md\` before the move), never a fresh read of \`rasen/changes/<name>/proposal.md\` — it no longer exists there, and treating its absence as "no proposal was available" would be false.

Under **on-merge** timing (or when nothing was captured because timing was on-merge), if \`rasen/changes/<name>/proposal.md\` exists:
- Extract "Why" and "What Changes" sections
- Use as PR body with proper markdown formatting
- Derive PR title from change name or proposal summary

If no proposal.md (and nothing was captured in step (b).1):
- Generate PR body from commit messages
- Use change name as PR title
- Note that no proposal was available

**f. Fresh-verification gate (before delivery)**
- If any code changed after the last green test run — for example from review fixes in step (e) or lint fixes in step (b) — re-run the test suite and require fresh passing output before delivering. Stale results are not acceptable.
- If the re-run fails, **STOP** and fix before proceeding — do not deliver.

**g. Deliver per mode**
- **pr**: \`git push -u origin <branch>\` (upstream tracking; never force-push), then \`gh pr create --base <base> --title "<title>" --body "<body>"\` using PR Body Generation above; output the PR URL
- **push**: \`git push origin <branch>\` (never force-push); no PR
- **local**: nothing to push — record in the ship log that delivery is deferred to the portfolio/parent level

### 4. Write Ship Log

After successful delivery in ANY mode, write \`ship-log.md\` to the work directory (fallback: \`rasen/changes/<name>/ship-log.md\` — EXCEPT under **in-ship** timing, where the change directory already moved in step (b): fall back to the archived path recorded in step (b).3 instead, never to the original \`rasen/changes/<name>/\`, which would resurrect an empty directory there and strand the log outside the archive):

\`\`\`markdown
# Ship Log: <change-name>

**Date:** <timestamp>
**Mode:** pr | push | local
**Branch:** <branch-name>
**Commit:** <commit-hash>
**Tree:** <tree-fingerprint>       (content tree fingerprint, \`git rev-parse HEAD^{tree}\`)
**Base:** <base-branch>            (pr mode only)
**PR:** <PR-URL>                   (pr mode only)
**Status:** PR Created | Pushed | Committed (delivery deferred to portfolio level)
**Archived in ship:** <path>       (in-ship timing only — omit this line under on-merge)

## Pre-Flight Results
- Verification: <pass/skip>
- Tasks: <N/M complete>

## Test Gate
- Tests: ran green | skipped — green at <evidence source>, tree <fingerprint>

## Deployment
Status: Pending (run /rasen:ship --deploy to continue)   (pr mode only)
\`\`\`

### 5. Optional: Land and Deploy (pr mode only)

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

After shipping, guidance on archiving is timing- and mode-aware (facts recorded in the ship log, not a re-resolved config value):
- **in-ship timing:** the change is already archived — see the ship log's \`Archived in ship:\` path. Do NOT suggest \`/rasen:archive\`; because the change directory has already moved, \`rasen status --change <name>\` for it will THROW "not found" — a later archive invocation recovers via its own early directory scan (step 1.5, before it ever calls status) and reports already-archived from the matched archive location, not from a successful status call.
- **on-merge timing, \`pr\` mode:** the change stays ACTIVE during PR review — status, resume, loop, and fix-forward keep working. Do NOT suggest archiving immediately; state that archive follows merge confirmation (\`/rasen:archive\` checks the PR's merge state on each invocation, no polling).
- **on-merge timing, \`push\`/\`local\` mode:** delivery is complete at ship with no merge event to await — suggest running \`/rasen:archive\` now.

Always suggest:
- Run \`/rasen:retro\` for a retrospective on the change
- Update project documentation (README, architecture notes, changelog) to match what shipped, so the docs do not drift from the release

## Output

\`\`\`
## Ship: <change-name>

### Pre-Flight
- [x] Verification: passed
- [x] Tasks: 7/7 complete

### Ship
- Mode: pr
- Branch: feature/add-auth
- Tests: skipped — green at review-cycle-report.md, tree <fingerprint>
- PR: https://github.com/org/repo/pull/42
- Status: Created

### Next Steps
- Monitor CI: gh pr checks 42
- Deploy: /rasen:ship --deploy
- Retro: /rasen:retro <change-name>
\`\`\``;

export function getShipCommandSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-ship',
    description: 'Ship the change — commit, resolve the delivery mode (pr / push / local), test when evidence demands it, deliver. PR body from proposal. Ship log saved to the work directory.',
    instructions: SHIP_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires rasen CLI.',
    metadata: { author: 'rasen', version: '1.0' },
  };
}

export function getOpsxShipCommandTemplate(): CommandTemplate {
  return {
    name: 'Rasen: Ship',
    description: 'Ship the change — commit, resolve the delivery mode (pr / push / local), test when evidence demands it, deliver',
    category: 'Workflow',
    tags: ['workflow', 'release', 'ship', 'deploy'],
    content: SHIP_INSTRUCTIONS,
  };
}
