# Handoff: PR `wip/ecp-shared-bounded-loop-lifecycle-resume` → `dev/0.2.0` (conflict reconciliation)

> Self-contained. A fresh session reading this + the repo can execute the whole job. Written 2026-08-09.
> Repo: `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle` (a SHARED worktree on Windows; `core.autocrlf=true`).
> Remote `origin` = `https://github.com/DumoeDss/rasen.git`. `gh` CLI is installed.

## Mission (what "conflict handling" means here)

Open a Pull Request of the **whole branch** `wip/ecp-shared-bounded-loop-lifecycle-resume` into `dev/0.2.0`, reconciling the two because they have **diverged**: the branch has work dev/0.2.0 lacks, AND dev/0.2.0 has work the branch lacks. The "conflict handling" is resolving the overlap (files both sides changed) so the merge lands cleanly. The operator confirmed: **PR the entire branch** (not just ECP-7).

## ⚠️ CRITICAL — coordinate with the live ECP session

Another session is ACTIVELY developing this branch right now (the `ecp-session-policy-and-control-parity` change: propose done, **apply in progress** — fault-matrix implementation). **Do NOT start the merge/PR until policy-parity is shipped+archived**, otherwise:
- you collide with the live worker in the shared working tree (it writes files you'd be merging), and
- the PR would miss policy-parity.

**Precondition check** (run from the repo root) — policy-parity is done when BOTH hold:
1. `Test-Path rasen/changes/archive/*ecp-session-policy-and-control-parity*` returns a directory (archived), AND
2. `rasen/changes/ecp-session-policy-and-control-parity/` no longer exists in the active changes dir.

If either is false, policy-parity isn't finished — WAIT and re-check. (If you must proceed earlier, coordinate with the live session; do not assume.)

## Step 0 — work on a SEPARATE PR branch in a separate worktree (no collision, no merge-back)

**Topology (important — this is how the two sessions integrate):**
- The LIVE ECP session owns `wip/ecp-shared-bounded-loop-lifecycle-resume` in its worktree. It finishes `ecp-session-policy-and-control-parity` (ship+archive) and then STOPS touching the branch.
- YOU create a **new PR branch** off the policy-parity-archived tip and do the dev/0.2.0 reconciliation THERE. You never commit to `wip/...`, so the two sessions never share a branch → **no in-flight merge-back is needed**. The PR itself (merged into dev/0.2.0) is the integration point.

```powershell
cd E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle
git fetch origin
# PRECONDITION: confirm policy-parity is archived (see ⚠️ above) before proceeding.
git worktree add -b pr/ecp7-to-020 E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-pr-020 wip/ecp-shared-bounded-loop-lifecycle-resume
cd E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-pr-020
```

`pr/ecp7-to-020` starts identical to the `wip/...` tip (all ECP-7 + v2 work including policy-parity). You do the dev/0.2.0 merge, push, and PR from this branch. The `wip/...` branch stays untouched (the live session keeps it).

> Why a separate branch: git forbids the same branch checked out in two worktrees at once. Operating on `wip/...` directly would conflict with the live session's worktree. A PR branch also matches normal PR workflow (PR from a feature branch, not a long-lived WIP branch).

## How the two sessions integrate (merge-back)

- **Sequential (recommended):** you start AFTER policy-parity is archived. `pr/ecp7-to-020` = the full `wip/...` tip at that moment. Nothing to merge back — your PR branch already contains everything. When your PR merges to dev/0.2.0, integration is complete. Future work (self-hosting / ECP-8, both operator-owned) branches from dev/0.2.0 post-merge.
- **If you start before policy-parity is done (parallel):** your `pr/ecp7-to-020` would miss policy-parity. To absorb it later, once the live session signals policy-parity is archived: `git fetch`/pull `wip/...` and `git merge wip/ecp-shared-bounded-loop-lifecycle-resume` into your PR branch, resolve any conflicts, then push. That single merge IS the "merge-back." Still prefer waiting — it's one fewer merge.
- **Conflicts needing ECP-7 judgment:** if a dev/0.2.0 conflict touches ECP-7-owned semantics and you can't resolve confidently, STOP and surface it (don't guess). That's the coordination valve.

## Step 1 — re-measure the divergence (numbers shift as work lands)

```powershell
$ahead  = (git log --oneline dev/0.2.0..HEAD | Measure-Object).Count
$behind = (git log --oneline HEAD..dev/0.2.0 | Measure-Object).Count
"ahead of dev/0.2.0: $ahead; behind: $behind"
```

At handoff time: ahead ~102+, behind 66. `behind` is the count of dev/0.2.0 commits the branch must reconcile. Record the final numbers for the PR body.

## Step 2 — reconcile by MERGING dev/0.2.0 INTO the branch (recommended; not rebase)

Rationale: the branch is already pushed (`origin/wip/...`); a rebase rewrites 100+ commits' history and needs a force-push (risky, and any other session's worktree breaks). A **merge** of dev/0.2.0 in preserves history, resolves conflicts locally where you can test, and pushes as a normal commit.

```powershell
# Probe first — see if there are conflicts WITHOUT committing:
git merge dev/0.2.0 --no-commit --no-ff   # if it conflicts, files are marked; you inspect
# To abort the probe:  git merge --abort
```

If the probe conflicts, resolve each:
```powershell
git status                     # list conflicted files (Unmerged paths)
# edit each conflicted file; then:
git add <resolved-file>
# when all resolved:
git commit --no-edit           # completes the merge with the default merge message
```

**Conflict-resolution principle:**
- Files OWNED by the ECP-7 / v2-authoring work on this branch (e.g. `src/core/frozen-action-executor/**`, `src/core/session-host/**`, `src/core/management-api/**`, `src/core/change-run/**`, `rasen/changes/**`, `rasen/specs/**`, `rasen/work/**`): favor THIS BRANCH's intent (dev/0.2.0 likely has no opinion on ECP-7 internals); keep branch content, add any dev additions.
- Files where dev/0.2.0 made forward progress this branch also touched (common candidates: `package.json`, `src/locales/*.json`, `docs/**`, `.github/workflows/**`, shared `src/core/*` modules): merge BOTH — take dev/0.2.0's changes AND keep this branch's; these are the ones needing real judgment.
- When unsure, do NOT guess blindly — read both sides' commit messages (`git log dev/0.2.0 -- <file>` vs `git log HEAD -- <file>`) to understand intent.

**After resolving — verify nothing broke:**
```powershell
Test-Path dist\cli\index.js    # MUST be true before vitest (else vitest wipes dist/)
npx tsc --noEmit               # typecheck
npx vitest run                 # FULL suite this time (this is the merge gate); confirm green
# also: node dist/cli/index.js validate --strict   (rasen spec validate)
```
If tsc/vitest fail after the merge, the conflict resolution broke something — fix before pushing. Do NOT push a red merge.

## Step 3 — push the PR branch

```powershell
git push -u origin pr/ecp7-to-020
```
(Regular push of the new PR branch — the merge commit + all ECP-7/v2 work go up. No force-push needed since you merged dev/0.2.0 in, not rebased.)

If the live ECP session pushed more to `wip/...` in the meantime (e.g. policy-parity landed after you branched): `git merge wip/ecp-shared-bounded-loop-lifecycle-resume` into your PR branch (resolve conflicts), then push.

## Step 4 — open the PR to dev/0.2.0

```powershell
gh pr create --base dev/0.2.0 --head pr/ecp7-to-020 `
  --title "ECP-7 session execution + self-hosting portfolio (decision-13 best-effort cutover) + v2-authoring" `
  --body-file pr-body.md
```

Draft `pr-body.md` with honest scope (template below). After creating, the PR will show a mergeable/conflicted status. If GitHub still shows conflicts, resolve them in the PR (or locally + push) until the PR is mergeable.

### PR body template (fill in the measured numbers; be honest about gaps)

```markdown
## Summary

Merges the `wip/ecp-shared-bounded-loop-lifecycle-resume` branch (the ECP-7 session-execution-and-self-hosting portfolio + the v2-authoring workstream + Direction locked decision 13) into `dev/0.2.0`.

Reconciles <N> commits ahead / <M> commits behind dev/0.2.0 (dev/0.2.0's forward progress since divergence merged in).

## What's included

**ECP-7 (session execution + self-hosting)** — shipped+archived locally on this branch:
- `ecp-platform-process-authority-foundation`, `process-authority-prepare-unavailability-outcome`
- `ecp-hosted-best-effort-cutover` (decision 13: 0.2.0 hosted = declared best-effort on all 3 OSes; Linux/Windows kernel-enforced crates parked to the upgrade path)
- `ecp-native-process-capsule-closure`, `ecp-durable-agent-session-host`
- `ecp-frozen-action-session-executor` (the trusted executor: frozen-Action consumption, OS×backend capability matrix, never-silently-reroute, execution-lost + committed-frontier resume, transactional completion, driver-face wiring)
- `ecp-session-policy-and-control-parity` (cross-driver same-Run parity, 7-mode fault matrix, configurable provenance-bearing policy source)

**Direction:** locked decision 13 (all-platform best-effort cutover) + the threat-model correction (decision 12) + Step 1 daemon-lifetime scope (decision 11).

**v2-authoring workstream** (in flight; included as committed snapshots): canvas-v2-authoring-parity, ecp-v2-authoring-loop-vertical-proof, ecp-v2-default-authoring-and-builtins, ecp-v2-authoring-loop-contract-closure.

## What is NOT in this PR (explicit gaps, follow-ups)

- `ecp-session-self-hosting-vertical-proof` — not started (operator-owned: a real non-ECP toy Change run end-to-end through the executor).
- **ECP-8 release truth** — not started (operator-owned: single clean-branch audit, remote CI matrix, version/changelog/tag).
- **Real-OS / real-backend receipts** — environment-gated (credentials / WSL / real-macOS), deferred to ECP-8 as explicit known-gaps; deterministic fault-injection + mutation-proven guards are the 0.2.0 correctness gate.
- **macOS** real-machine receipts (deferred to ECP-8; no macOS runner available in the working environment).
- **Linux/Windows kernel-enforced process-authority crates** — deliberately parked to the upgrade path by decision 13 (code retained in git as assets; NOT 0.2.0 acceptance).

## Test status

- Local: `tsc --noEmit` clean; full `vitest` suite green after the dev/0.2.0 merge reconciliation; `rasen validate --strict` clean.
- Remote CI: this branch has never been through remote CI — this PR is its first remote run. Treat the CI results as the discovery pass.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Context the new session must know (so it doesn't break things)

- **This repo's delivery model was "local-only; ECP-8 owns the single clean-branch 0.2.0 PR."** The operator is OVERRIDING that by asking for this PR now, before ECP-8. That's intentional — but it means this PR lands ECP-7 + v2 work to 0.2.0 ahead of the release-truth gate. The PR body says so honestly.
- **`core.autocrlf=true`.** Text files are LF in blobs but may show as CRLF in the working tree. Pin/hash checks MUST use committed bytes (`git show <sha>:<file>`), never the working tree.
- **vitest wipes `dist/`.** `vitest.setup.ts` calls `ensureCliBuilt()`; if `dist/cli/index.js` is absent it runs `build.js` which `rmSync('dist')`. ALWAYS confirm `dist/cli/index.js` exists before any `vitest` run.
- **Do not mutate archived evidence** (under `rasen/changes/archive/.../evidence/`). It is content-addressed (`archive.json` + the engine journal record per-file sha256s); mutating desyncs them. If you must add a note, write outside content-addressed accounting.
- **`rasen validate --strict` does NOT apply the spec delta.** The spec-projection gate is `rasen archive --dry-run --json` (`blockers: []`). Not relevant to a PR merge, but don't trust validate for spec-projection questions.
- **author≠verifier** was maintained throughout ECP-7. The merge reconciliation is mechanical git work, not verification — but if a conflict resolution changes ECP-7 semantics, treat it as needing re-verification.

## Deliverable

A mergeable PR (or a merged one, if the operator wants you to merge it) on https://github.com/DumoeDss/rasen from `wip/ecp-shared-bounded-loop-lifecycle-resume` → `dev/0.2.0`, with the dev/0.2.0 reconciliation resolved and the test suite green. Report the PR URL.

## If something blocks

- Unresolvable conflict on an ECP-7-owned file: stop, surface to the operator with the file + both sides; don't guess ECP-7 semantics.
- Test suite red after merge and you can't see why: stop, report the failures; do not push a red merge.
- `gh` auth missing: `gh auth login` (the operator may need to run this interactively — use the `!gh auth login` session prefix if needed).
