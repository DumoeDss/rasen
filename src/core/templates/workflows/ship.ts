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
 * confirmation (`on-merge`, the default). When timing is `in-ship`, archive
 * destination (`archive.destination`/`archiveDir`, same payload) decides
 * where that bookkeeping lands (in-repo move / external move / prune
 * delete) — identical branch to `rasen-archive-change`'s bookkeeping step.
 */
import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

const SHIP_INSTRUCTIONS = `Release workflow — commit, resolve the delivery mode (pr / push / local), test when evidence demands it, deliver, optionally merge and deploy.

${STORE_SELECTION_GUIDANCE}

PR body comes from proposal summary. Ship log recorded to the change's work directory (resolve \`workDir\` from \`rasen status --change <name> --json\`; fall back to the change directory when it is absent or \`ship-log.md\` already lives there).

Resolve \`archive.timing\` from the same status payload (\`archive.timing\`, default \`on-merge\` when absent). Under **in-ship** timing, also resolve \`archive.destination\` (\`in-repo\` | \`external\` | \`prune\`) and \`archive.archiveDir\` (absent for \`prune\` and for an unresolvable \`external\`) from the same payload — the in-ship bookkeeping move/delete in step 3b branches on these exactly like \`rasen-archive-change\`'s bookkeeping step. Recorded ship-log facts (delivery mode, PR URL, archived-in-ship/pruned-in-ship marker) for a delivery that already happened always outrank a later re-resolved config value — the timing and destination axes are consulted only for decisions not yet taken.

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
- Check if \`verification-report.md\` (from \`rasen-verify-change\`), \`review-report.md\`, \`review-cycle-report.md\` (from the review loop), or any other expert \`*-report.md\` exists in the work directory (\`workDir\` from \`rasen status --change <name> --json\`; fall back to the change directory) — any of these counts as verification evidence
- If no verification report found, warn: "No verification report found. Run rasen-verify-change first."
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
- **In-ship timing only, before staging/committing:** run the change's archive bookkeeping now, inside the ship stage, so its results ride this same delivery. Order matters — the change directory is about to move or disappear:
  1. Capture what later ship steps need from the change directory FIRST: PR-body sections from \`<changeRoot>/proposal.md\` (the CLI-resolved change root from the status JSON already fetched for \`workDir\`), task-completion facts, and — when \`root.store_id\` is present (the store-mode embedding below needs it) — the change's delta spec content from \`<changeRoot>/specs/**/spec.md\`, read and held now, before the move. The store-mode embedding step gets no second chance at a fresh read once this step moves or deletes the directory.
  2. Sync delta specs into main specs (the \`rasen-sync-specs\` step — same sync the archive skill runs).
  3. **Destination-aware bookkeeping** (resolve \`archive.destination\`/\`archiveDir\` per the note above; the committed-state precondition that gates \`external\`/\`prune\` elsewhere is inherently satisfied here — this move/delete happens immediately BEFORE ship's own commit of the change's files, so nothing uncommitted is being destroyed):
     - \`in-repo\` (default, or the fallback for \`external\` with no \`archiveDir\` in the payload — state the fallback explicitly, never escalate it to deletion): move the change directory to \`<changesDir>/archive/YYYY-MM-DD-<name>\` (the same collision rule as \`rasen-archive-change\`'s bookkeeping step).
     - \`external\`: move the change directory to \`<archiveDir>/YYYY-MM-DD-<name>\` instead — the repo-side removal rides this delivery; the archive copy stays machine-local.
     - \`prune\`: delete the change directory (no move) — no archive copy anywhere; git history is the archive. \`prune\` still requires its own named confirmation before deleting, even inside ship.
  4. Record the destination outcome for the ship log (step 4): \`Archived in ship: <path>\` (in-repo/external) or \`Pruned: true\` (prune — the literal token \`Pruned:\`, unified with every other prune writer: \`rasen-archive-change\`, \`rasen-bulk-archive-change\`) — so a later archive invocation on this name recognizes the outcome via its ship-log tombstone check.
  5. **Store-rooted change (\`root.store_id\` present):** steps 2-3 above (spec sync, destination-aware move/delete) mutated the STORE's working tree at \`<root.path>\`, NOT the code repo — the commit this step (b) makes right after is a code-repo commit and does not and cannot contain them. This workflow does not commit the store repo on your behalf. If you commit the store-side bookkeeping separately (agent's own action, following the store's own conventions), record that commit's SHA for step 4's \`## Archive\` section below; otherwise record it there as pending. Full store-commit orchestration is a known-open follow-up (see \`rasen/changes/externalize-artifacts/planning-context.md\`), not something this template invents.
- Stage the change's files — under in-ship timing, this also includes the synced main specs and, for \`in-repo\`/\`external\`, the moved change directory from the steps above (a \`prune\`d change directory no longer exists to stage) — and commit with a conventional message derived from the change name / proposal summary
- Pre-commit hooks (lint, format) may reject the commit: fix the reported issues and retry — NEVER bypass with \`--no-verify\`
- If the working tree is already clean, skip this step (on-merge timing only — in-ship timing always has the sync + move/delete above to commit)

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

Read the proposal from \`<changeRoot>/proposal.md\` — the CLI-resolved change root from the status JSON already fetched for \`workDir\` (step 2a / step (b)), never the repo-relative literal \`rasen/changes/<name>/proposal.md\`. \`changeRoot\` resolves store-side for a registered store, closing a latent bug where a store-rooted change's PR body silently fell back to "no proposal was available" even though the proposal existed in the store.

Under **in-ship** timing, the change directory already moved in step (b) — use the PR-body sections CAPTURED in step (b).1 (read from \`<changeRoot>/proposal.md\` before the move), never a fresh read after the move — the path no longer exists there, and treating its absence as "no proposal was available" would be false.

Under **on-merge** timing (or when nothing was captured because timing was on-merge), if \`<changeRoot>/proposal.md\` exists:
- Extract "Why" and "What Changes" sections
- Use as PR body with proper markdown formatting
- Derive PR title from change name or proposal summary

If no proposal.md (and nothing was captured in step (b).1):
- Generate PR body from commit messages
- Use change name as PR title
- Note that no proposal was available

**Store-mode embedding (\`sha-cross-stamping\`):** when the status JSON's \`root.store_id\` is present (the resolved planning root is a registered store — see Store selection above), additionally carry the change's review material in the PR body, since a store-rooted change's own diff carries no delta spec:
- Embed the proposal's "Why"/"What Changes" (already read above) and the change's delta spec content inside collapsed \`<details><summary>Review material from planning store</summary>...</details>\` blocks, so a reviewer sees intent and contract delta without leaving the PR. Under **in-ship** timing, use the delta spec content CAPTURED in step (b).1 (read before the move) — never a fresh read of \`<changeRoot>/specs/**/spec.md\` after the move, the directory may no longer exist there (same rule as the proposal read above). Under **on-merge** timing, read fresh from \`<changeRoot>/specs/**/spec.md\`.
- If the combined delta spec content is extremely large, do not embed all of it — link the store path instead and note the size (reviewer ergonomics over completeness; no hard byte threshold is prescribed).
- Stamp traceability: the change's store path (\`<changeRoot>\`) and the store repository's HEAD SHA — run \`git -C <root.path> rev-parse HEAD\` (agent-side git; the CLI itself never shells out).
  - Dirty store tree: if \`git -C <root.path> status --porcelain\` is non-empty, stamp the SHA as \`<sha> (store tree dirty at ship time)\` — never a clean-looking SHA alone.
  - Non-git store (\`<root.path>\` is not a git repository): stamp \`(store not under git)\` instead of a SHA — the embedding still happens.
- Record the same store identity and SHA in the ship log (step 4): \`Store:\`/\`Store commit:\` lines.

Repo-mode PR bodies are unchanged beyond the store-safe proposal read above.

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
**Store:** <store-path>            (pr mode, store-rooted change only — the registered store's path, from \`root.path\`)
**Store commit:** <sha>            (pr mode, store-rooted change only — store repo HEAD SHA at ship time, with the same dirty/non-git qualifiers stamped in the PR body)
**Status:** PR Created | Pushed | Committed (delivery deferred to portfolio level)
**Archived in ship:** <path>       (in-ship timing, destination in-repo/external — omit under on-merge)
**Pruned:** true                  (in-ship timing, destination prune — the same literal token every prune writer uses; mutually exclusive with the line above; omit under on-merge)

## Pre-Flight Results
- Verification: <pass/skip>
- Tasks: <N/M complete>

## Test Gate
- Tests: ran green | skipped — green at <evidence source>, tree <fingerprint>

## Archive
(in-ship timing only — under on-merge timing this section does not exist yet; the archive workflow appends it later, once it runs)
**Date:** <timestamp>
**Ship commit:** <commit-hash>     (identical to \`Commit:\` above)
**Archive commit:** <commit-hash>  (repo-rooted change: identical to \`Commit:\` above — in-ship bookkeeping and delivery share one commit, so both ends of the chain are this SHA. Store-rooted change (\`root.store_id\` present): NEVER identical — the bookkeeping in step (b).2/.3 mutated the STORE's working tree at \`<root.path>\`, a different repository this workflow's own commit does not touch. Per step (b).5: if that store-side change was committed separately, record ITS SHA here; otherwise write \`pending — store-side bookkeeping not committed by this workflow\` and leave the SHA blank. Never write the code-repo \`Commit:\` value here for a store-rooted change — that would be recording a fact that isn't true.)
**Outcome:** archived in ship — see \`Archived in ship:\`/\`Pruned:\` above (store-rooted change: also note the store path \`<root.path>\` where the bookkeeping actually landed)

## Deployment
Status: Pending (run rasen-ship --deploy to continue)   (pr mode only)
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
- **in-ship timing:** the change's archive bookkeeping is already done — see the ship log's \`Archived in ship:\` path (in-repo/external) or \`Pruned:\` marker (prune); its \`## Archive\` section already closes the delivery chain for a repo-rooted change (ship commit == archive commit) — no later append is needed. For a store-rooted change, check whether that section's \`Archive commit:\` is \`pending\`; if so, the store-side bookkeeping still needs a commit in the store repo (step (b).5) before the chain is truly closed. Do NOT suggest \`rasen-archive-change\`; because the change directory has already moved or been deleted, \`rasen status --change <name>\` for it will THROW "not found" — a later archive invocation recovers via its own early directory/external/tombstone scan (step 1.5, before it ever calls status) and reports the already-archived-or-pruned outcome, not from a successful status call.
- **on-merge timing, \`pr\` mode:** the change stays ACTIVE during PR review — status, resume, loop, and fix-forward keep working. Do NOT suggest archiving immediately; state that archive follows merge confirmation (\`rasen-archive-change\` checks the PR's merge state on each invocation, no polling).
- **on-merge timing, \`push\`/\`local\` mode:** delivery is complete at ship with no merge event to await — suggest running \`rasen-archive-change\` now.

Always suggest:
- Run \`rasen-retro\` for a retrospective on the change
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
- Deploy: rasen-ship --deploy
- Retro: rasen-retro <change-name>
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
