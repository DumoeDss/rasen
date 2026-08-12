/**
 * Ship Rasen Workflow Command
 *
 * Self-contained release workflow — commit, resolve the delivery mode
 * (pr / push / local), run tests only when evidence demands it, then deliver.
 * The ship execution contract is inlined here (no expert delegation).
 * PR body sourced from proposal summary. Ship log written to the change's
 * evidence directory (`evidenceDir` from `rasen status --json`; sticky-legacy
 * fallback to the legacy work directory or the change directory). Archive timing (`archive.timing` from the same
 * status payload) decides whether the archive engine's plan/apply transaction
 * and publication run inside this ship stage (`in-ship`) or are deferred to a
 * later archive gated on merge confirmation (`on-merge`, the default). In-ship
 * publication always targets the planning root's archive (`archive.archiveDir`,
 * same payload) — there is no destination axis, identical to
 * `rasen-archive-change`'s engine-owned publication.
 */
import type { SkillTemplate } from '../types.js';
import { GENERATED_ARCHIVE_COMMAND_EXAMPLES } from '../../archive-consumer-invocation.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

const SHIP_INSTRUCTIONS = `Release workflow — commit, resolve the delivery mode (pr / push / local), test when evidence demands it, deliver, optionally merge and deploy.

${STORE_SELECTION_GUIDANCE}

**Store finalization hard gate:** inspect the first resolved Change/status payload before tests, commits, delivery, spec sync, or Archive work. If root.scope.kind is 'store-project' and the resolved archive timing is 'in-ship', pass \`--outcome landed\` explicitly to the archive command. Delivery having happened is NOT sufficient on its own: if the delivered commit is not yet reachable from the code ref the change's target line declares for its project, the CLI refuses — report the unfinalized state and why, leave the change active, and NEVER retry by choosing another outcome, by adding \`--skip-specs\`, or by supplying a different commit. A change whose committed metadata declares no implementation finalizes as landed with no commit; do not fabricate one. If root.scope.kind is 'legacy-store', REFUSE with 'legacy_flat_store_requires_migration' — the legacy flat Store planning tree is read-only until 'rasen store migrate-layout <store-id>' has migrated it. Any other scope proceeds as before, with no outcome required or recorded.

PR body comes from proposal summary. Ship log recorded to the change's evidence directory (\`evidenceDir\` from \`rasen status --change <name> --json\`; sticky-legacy: a file that already lives in the legacy \`workDir\` or the change directory is used in place) — it is evidence, so it travels with the change and is delivered with the Archive.

Resolve \`archive.timing\` from the same status payload (\`archive.timing\`, default \`on-merge\` when absent). Under **in-ship** timing, also resolve \`archive.archiveDir\` (the planning root's archive directory, always present) from the same payload — the engine-owned plan/apply transaction in step 4.5 publishes there unconditionally, exactly like \`rasen-archive-change\`'s engine-owned publication. **There is no destination axis:** a legacy \`archive.destination\` in the config changes nothing, and ship never moves a change to the machine home nor deletes one. Recorded ship-log facts (delivery mode, PR URL, archived-in-ship marker) for a delivery that already happened always outrank a later re-resolved config value — the timing axis is consulted only for decisions not yet taken.

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
- Check if \`verification-report.md\` (from \`rasen-verify-change\`), \`review-report.md\`, \`review-cycle-report.md\` (from the review loop), or any other expert \`*-report.md\` exists in the change's evidence directory (\`evidenceDir\` from \`rasen status --change <name> --json\`; sticky-legacy: a file that already lives in the legacy \`workDir\` or the change directory is used in place) — any of these counts as verification evidence
- If no verification report found, warn: "No verification report found. Run rasen-verify-change first."
- Prompt user to confirm proceeding without verification

**b. Task Completion**
- Read the tasks artifact from \`artifactPaths.tasks.existingOutputPaths\` in the same status payload; do not assume its filename or reconstruct a Change path
- Verify all tasks are marked complete (\`- [x]\`)
- If incomplete tasks exist, list them and prompt for confirmation

**c. Working Tree State**
- Run \`git status --porcelain\`
- Uncommitted changes do NOT block — committing them is the ship phase's own job (step 3b)
- If on detached HEAD, warn and suggest creating a branch

**d. Reserved ship-log heading**
- Resolve the sticky-legacy ship-log candidate in the same order archive uses: \`evidenceDir/ship-log.md\`, then an existing legacy \`workDir/ship-log.md\`, then \`changeRoot/ship-log.md\`
- If the selected existing log contains a level-two \`## Archive\` heading, **STOP before commit, delivery, deployment, or any evidence write**. Report that the heading is reserved for the archive engine and require the operator to remove or rename the change-authored section.
- Never add an \`## Archive\` heading or placeholder when creating/updating the ship log; the archive engine adds the section only inside its verified transaction.

**e. All Checks Pass**
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
- Under **in-ship timing**, keep the change active through code commit, delivery, optional deployment decision, and ship-log finalization. Capture proposal/task/store review material now, but do not move, delete, or archive the change in this step.
- Stage the change's code and planning files and commit with a conventional message derived from the change name / proposal summary.
- Pre-commit hooks (lint, format) may reject the commit: fix the reported issues and retry — NEVER bypass with \`--no-verify\`
- If the working tree is already clean, skip this code-commit step. In-ship archive bookkeeping happens later through the authoritative engine and may require a separate follow-up commit/push.

**c. Merge the integration base (pr mode ONLY)**
- \`git fetch origin <base> && git merge origin/<base> --no-edit\` so the test gate runs against the merged state — \`<base>\` is the base resolved in (a), never a guessed default
- If the merge produces conflicts that cannot be resolved automatically, **STOP** and surface the conflicts — do not deliver
- If already up to date, continue silently
- In **push** or **local** mode, skip this step entirely — there is no merge event to pre-validate

**d. Evidence-based test gate (all modes)**

First derive the **required verification scope** from the delivered diff,
project instructions, and any commits merged in step (c):
- A localized change defaults to its regression test plus directly affected
  module or package checks.
- Broaden for shared or global contracts, dependency/build/config/CI changes,
  concurrency, persistence, migrations, security boundaries, cross-platform
  behavior, broad multi-module edits, or focused failures outside the expected
  area.
- A full repository suite is required only when the user or project
  instructions explicitly require it, or when affected behavior cannot be
  bounded more narrowly. A merge in step (c) requires recalculating the scope
  against the merged diff; it does not by itself prove that the full suite is
  necessary.

Then inspect \`verification-report.md\`, \`review-report.md\`,
\`review-cycle-report.md\`, other verification reports, and run-state.
**Scoped green evidence** is reusable only when it records passing exact
commands, a scope/rationale that covers the required verification scope, and a
content tree fingerprint (\`git rev-parse HEAD^{tree}\`) matching the current
tree. The tree hash is content-addressed, so a commit that changes no content
does not invalidate evidence; lint, review, merge, or archive fixes that change
the tree do.

- Matching scoped green evidence → skip already-covered checks.
- Missing or insufficient evidence → run only the uncovered checks in the
  required verification scope.
- The user explicitly requesting tests → run the requested scope; do not
  reinterpret an unspecified request as an automatic full-suite request.

**Never silently escalate** from focused checks to the project's full detected
test command (\`pnpm test\` / \`npm test\` / \`bun test\` / \`cargo test\` /
\`pytest\` / etc.). Before a full suite expected to exceed 60 seconds, state the
trigger and expected cost. Never repeat an unchanged full-suite command that
already timed out; shard it, use CI, or ask for direction.

If any required check fails, **STOP** and do NOT deliver (a genuinely
pre-existing failure unrelated to this change's diff may be noted and triaged,
but when in doubt treat it as blocking).

**e. Review the diff for obvious structural issues**
- Scan the change's diff (\`git diff origin/<base>...HEAD\` in pr mode; the commits being delivered otherwise) for accidental debug output, secrets, obviously broken logic, or leftover TODO markers before delivering

**PR Body Generation (pr mode):**

Read the proposal from \`artifactPaths.proposal.existingOutputPaths\` in the status JSON already fetched for the landing directories (step 2a / step (b)). That scope-resolved artifact path works for standalone and Store-backed Changes without a root-relative fallback.

Under **in-ship** timing, the change remains active until delivery facts and the ship log are final, so read the proposal from \`<changeRoot>\` normally before the later engine invocation.

Under **on-merge** timing (or when nothing was captured because timing was on-merge), if \`<changeRoot>/proposal.md\` exists:
- Extract "Why" and "What Changes" sections
- Use as PR body with proper markdown formatting
- Derive PR title from change name or proposal summary

If no proposal.md (and nothing was captured in step (b).1):
- Generate PR body from commit messages
- Use change name as PR title
- Note that no proposal was available

**Store-mode embedding (\`sha-cross-stamping\`):** when the status JSON's \`root.store_id\` is present (the resolved planning root is a registered store — see Store selection above), additionally carry the change's review material in the PR body, since a store-rooted change's own diff carries no delta spec:
- Embed the proposal's "Why"/"What Changes" (already read above) and the change's delta spec content inside collapsed \`<details><summary>Review material from planning store</summary>...</details>\` blocks, so a reviewer sees intent and contract delta without leaving the PR. Read it while the change is active; under in-ship timing the engine invocation occurs only after this delivery material and the ship log are final.
- If the combined delta spec content is extremely large, do not embed all of it — link the store path instead and note the size (reviewer ergonomics over completeness; no hard byte threshold is prescribed).
- Stamp traceability: the change's store path (\`<changeRoot>\`) and the store repository's HEAD SHA — run \`git -C <root.path> rev-parse HEAD\` (agent-side git; the CLI itself never shells out).
  - Dirty store tree: if \`git -C <root.path> status --porcelain\` is non-empty, stamp the SHA as \`<sha> (store tree dirty at ship time)\` — never a clean-looking SHA alone.
  - Non-git store (\`<root.path>\` is not a git repository): stamp \`(store not under git)\` instead of a SHA — the embedding still happens.
- Record the same store identity and SHA in the ship log (step 4): \`Store:\`/\`Store commit:\` lines.

Repo-mode PR bodies are unchanged beyond the store-safe proposal read above.

**f. Fresh-verification gate (before delivery)**
- If any code changed after the last green evidence — for example from review fixes in step (e) or lint fixes in step (b) — re-run the invalidated checks from the same required verification scope and require fresh passing output before delivering. Do not widen to the full suite unless a full-suite trigger above now applies. Stale results are not acceptable.
- If the re-run fails, **STOP** and fix before proceeding — do not deliver.

**g. Deliver per mode**
- **pr**: \`git push -u origin <branch>\` (upstream tracking; never force-push), then \`gh pr create --base <base> --title "<title>" --body "<body>"\` using PR Body Generation above; output the PR URL
- **push**: \`git push origin <branch>\` (never force-push); no PR
- **local**: nothing to push — record in the ship log that delivery is deferred to the portfolio/parent level

### 4. Write Ship Log

After successful delivery in ANY mode, write \`ship-log.md\` while the change is still active, to its evidence directory (\`evidenceDir\` from status JSON; sticky-legacy: update an existing legacy \`workDir\` or change-root log in place). Under in-ship timing this must contain every final delivery fact, PR URL, and optional deployment outcome before the engine runs. The generated log MUST omit the engine-reserved \`## Archive\` section and every placeholder for it.

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

## Pre-Flight Results
- Verification: <pass/skip>
- Tasks: <N/M complete>

## Test Gate
- Required scope: <focused commands / package / full repository>
- Rationale: <why this scope covers the delivered risk>
- Tests: <exact commands and green result> | skipped — scoped green evidence at <evidence source>
- Tree: <fingerprint>

## Deployment
Status: Pending (run rasen-ship --deploy to continue)   (pr mode only)
\`\`\`

### 4.5 In-ship archive engine (in-ship timing only)

If deployment was requested, complete step 5 and write its final outcome before continuing. Then run \`${GENERATED_ARCHIVE_COMMAND_EXAMPLES.intentTemplate}\`, complete an external intent including empty-handoff or probe-only intent, and run \`${GENERATED_ARCHIVE_COMMAND_EXAMPLES.savedPreview}\`. Inspect the immutable plan and require no blockers, capture its exact \`planToken\`, then run \`${GENERATED_ARCHIVE_COMMAND_EXAMPLES.apply}\`. Branch on structured disposition: if \`manualRecoveryAction\` exists, follow only that verified manual guidance; otherwise \`recoverable\` uses only its returned exact-token recovery command, \`abort-required\` uses only its returned \`${GENERATED_ARCHIVE_COMMAND_EXAMPLES.abort}\` before correction and a fresh plan, and \`blocked\` stops before mutation. Never replay a deterministic conflict or replan a recoverable transaction. This is the only archive bookkeeping path: never invoke an external spec-sync command, directly move/remove the change, create an archive directory, write \`archive.json\`, or repair a journal.

The engine stages and verifies the payload, adds the archive section to the staged ship log, captures quality, publishes source-last, and returns the final path/journal/accounting result. Stage and commit the engine-produced planning-root archive delta with a path-scoped conventional archive message that may reference the already-recorded ship short SHA, then non-force push that follow-up commit when the selected delivery mode requires the remote to receive it. A recoverable or \`abort-required\` result is not success; report its journal and disposition.

### 5. Optional: Land and Deploy (pr mode only)

If the user opts into deployment (or passes \`--deploy\`):

1. Wait for CI checks to pass on the PR
2. Merge the PR (squash or merge based on repo convention)
3. Wait for deployment pipeline to complete
4. Run production verification checks
5. Update ship-log.md with deployment status only while the change is active; under in-ship timing this occurs before step 4.5 and no evidence write is allowed afterward

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
- Update ship-log.md with failure details only before any in-ship engine invocation

### 6. Post-Ship

Present next steps in lifecycle order. First, present the installed retention handoff:
- Run \`rasen-retain <change-name>\` for the profile's retention step — \`report\` writes a retrospective, \`codify\` captures durable learnings as managed skills, and \`off\` completes as a no-op (\`rasen-retro\` remains a compatibility alias for report mode).
- Under **on-merge** timing, retention is the next lifecycle action and completes before any later archive action. This ship workflow presents the handoff only; it does NOT execute retention inline.

Then give timing- and mode-aware archive guidance from facts recorded in the ship log, not a re-resolved config value:
- **in-ship timing:** report the authoritative engine result from step 4.5, including final path, transaction, accounting verification, and any required follow-up non-force push. The engine's archive section is already part of the hashed evidence; never append a post-hash commit identifier or deployment rewrite afterward. Do not suggest a second archive invocation after success.
- **on-merge timing, \`pr\` mode:** the change stays ACTIVE during PR review — status, resume, loop, and fix-forward keep working. Do NOT suggest archiving immediately; after retention, state that archive follows merge confirmation (\`rasen-archive-change\` checks the PR's merge state on each invocation, no polling).
- **on-merge timing, \`push\`/\`local\` mode:** delivery is complete at ship with no merge event to await — after retention, suggest running \`rasen-archive-change\`.

Also suggest updating project documentation (README, architecture notes, changelog) to match what shipped, so the docs do not drift from the release.

## Output

\`\`\`
## Ship: <change-name>

### Pre-Flight
- [x] Verification: passed
- [x] Tasks: 7/7 complete

### Ship
- Mode: pr
- Branch: feature/add-auth
- Tests: skipped — scoped green evidence at review-cycle-report.md, tree <fingerprint>
- PR: https://github.com/org/repo/pull/42
- Status: Created

### Next Steps
- Monitor CI: gh pr checks 42
- Deploy: rasen-ship --deploy
- Retain: rasen-retain <change-name>
\`\`\``;

export function getShipCommandSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-ship',
    description: 'Ship the change — commit, resolve the delivery mode (pr / push / local), test when evidence demands it, deliver. PR body from proposal. Ship log saved to the evidence directory.',
    instructions: SHIP_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires rasen CLI.',
    metadata: { author: 'rasen', version: '1.0' },
  };
}
