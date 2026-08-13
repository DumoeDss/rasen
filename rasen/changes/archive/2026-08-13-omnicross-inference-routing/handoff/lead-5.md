# Handoff: omnicross-inference-routing — lead #5

## Position

Ship is DONE. **PR #156 (draft) → `dev/0.2.0`**, commits `0a32156a` (change) + `6a4bd586` (ship log), pushed. Review loop closed at round 5: no Blocker, no Major.

The rebase onto current `dev/0.2.0` was **started and deliberately aborted**. This document records why, what was already resolved, and exactly how to finish it. Nothing is lost — the 10 resolved files are preserved on disk (see Working set).

Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-omnicross-inference-routing` (do NOT create a new one). Every shell command must `cd` in explicitly. Backup ref of the pre-rebase branch: `backup/pre-rebase-omnicross` = `6a4bd586`.

## What lead-5 completed

1. **Closed the review loop.** Round 4's residual Major (shared deterministic staging path → lost update) was independently reproduced, then fixed with per-attempt `stagingPathFor` + exclusive-create `link(2)` publication in `run-store-fs.ts`. Reviewer confirmed the lost-update CLASS closed, not just the instance. Four Minors fixed; N1/N2/N3 accepted-known with follow-ups in `evidence/review-report.md`.
2. **Corrected a false premise in the tree.** `run-store-fs.ts` claimed "on Windows [rename] fails when the target EXISTS". Measured false: Node's `renameSync` REPLACES on Windows too (libuv passes `MOVEFILE_REPLACE_EXISTING`). The pre-existing TOCTOU was cross-platform, not POSIX-only. Comment corrected.
3. **Shipped.** Fixed 7 pre-existing whitespace-gate violations found in the staged diff (byte-level, to avoid corrupting a file containing Chinese). PR body documents the scope expansion and the accepted-known Minors.

## Why the rebase was aborted (measurement, not impression)

Branch point `75c3366a`; `origin/dev/0.2.0` is 28 commits ahead; 43 files overlap. `git rebase origin/dev/0.2.0` produced **22 conflicted files / 62 hunks**.

The blocker is one file. On `src/core/change-run/internal/facade-runtime.ts`:

| Side | Diff vs `75c3366a` |
| --- | --- |
| base (`origin/dev/0.2.0`) | **+636 / −36** |
| this change (`0a32156a`) | **+273 / −47** |

Two large independent feature threads run through the *same* functions:

- **base** threads `continuationGrants` / `continuationIds` through `receipt()`, `collectSettleStimuli`, `settle`, adds `releaseTerminalReservations`, consultation stimuli, and a whole `consult()` method.
- **this change** threads `candidates` / `reserved` through the same functions, adds `buildAction` to `receipt()`, `discardPendingReservations` / `finalizePendingReservations`, and a whole `admit()` method.

Both changed `receipt()`'s signature, both changed `collectSettleStimuli`'s return type, both changed `settle`'s signature, both wrapped `store.commit` in error handling. Hunk 10 is 385 lines where git could not align `consult()` against `admit()` at all.

**This file needs a port, not a merge**, and the port lands in the authority-critical path that just took five review rounds to verify. Attempting it plus the remaining 31 hunks, the digest rebaseline, a ~35 min full suite and a ~40 min review pass exceeded the remaining session budget with the care it requires. A half-finished merge in this seam is worse than a clean stopping point, so the rebase was aborted rather than left in progress.

## Resolutions already made — reuse these, do not re-derive

Preserved at `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\rebase-resolutions-omnicross\`, one file per resolved path with `/` → `__`. After re-running the rebase, copy each back over its conflicted path and `git add` it.

| File | Resolution |
| --- | --- |
| `pipelines/{bug-fix,full-feature,small-feature}/pipeline.yaml` | Conflict is only the `skill:rasen-review-cycle` capability digest. Kept base's value as a **placeholder**; every digest is recomputed in the rebaseline step anyway. |
| `src/core/worker-contracts.ts` | Kept base's three-way contract and my Zod schema, reconciled: `WorkerContractZodSchema = z.enum(['leaf','consultable-leaf','evaluate'])` with `WorkerContract = z.infer<...>`. Base's `workerContractJsonSchema` already handles `'consultable-leaf'`, so the enum must include it. |
| `src/core/frozen-action-executor/index.ts` | Pure export lists. Kept base's teacher exports, added my `./omnicross-lifecycle.js` export as its own block. |
| `src/core/pipeline-registry/types.ts` | Kept both imports (base's `CONSULTATION_SERVER_LIMITS`, my omnicross contracts import + re-export). |
| `src/core/runtime-adapters.ts` | **Correctness catch — do not regress.** Base added `omp` (Oh My Pi) as a recognized host that is NOT dispatch-capable, replacing `host === 'unknown'` with `hasRuntimeCapability(host,'canDispatch')`. My `externalInference` branch guarded on `host === 'unknown'`, which would have let an `omp` host reach the `claude-print` bridge — exactly the residual hazard `detectHostRuntime`'s own comment documents. Merged version guards **both** branches on `canDispatch`. |
| `src/core/templates/workflows/_orchestration.ts` | Both edited the same prose paragraph. Kept base's line (which adds severity normalization from `34d91322`) and re-inserted my `frozenInference` sentence after "(Step B).". File contains em-dashes; resolved byte-safely, U+FFFD verified 0 before and after. |
| `src/core/change-run/contracts.ts` | Resolved to base byte-safely (base's inline `session` block carries load-bearing PLACEHOLDER comments warning that enforcing `reuseRoundLimit: 1` would forbid reviewer reuse), then re-added my side surgically: the two imports, `JsonValueSchema` transform, `candidates` on the receipt core schema, `'candidates'` in the `Omit` + `readonly candidates`, and `candidates: core.candidates ?? []` in `deepFreeze`. **Known redundancy left in place:** base's inline `session` in the `.extend()` overrides `AgentCandidateSessionSchema` at the dispatch schema. Shapes are identical so behaviour is unchanged; tidy it only if you also preserve those comments. |
| `src/core/change-run/internal/runtime-context.ts` | Kept my `actionKind` switch (agent/command/host with the `renderedTurnInput` requirement) and folded in base's `consultationBinding` spread plus `stage: stage as never`. |

## Remaining conflicts (46 hunks, none resolved)

| File | Hunks |
| --- | --- |
| `src/core/change-run/internal/facade-runtime.ts` | 15 — the port described above |
| `src/core/frozen-action-executor/action-outcome.ts` | 4 |
| `src/core/frozen-action-executor/executor.ts` | 4 |
| `src/core/frozen-action-executor/production-executor.ts` | 3 |
| `src/core/management-api/frozen-action-executor.ts` | 2 |
| `test/core/management-api/frozen-action-executor.test.ts` | 6 |
| `test/core/change-run/runtime-context.test.ts` | 5 |
| `test/core/frozen-action-executor/production-executor.test.ts` | 2 |
| `test/core/templates/skill-templates-parity.test.ts` | 2 — hash table, will be rebaselined |
| `test/core/change-run/contracts.test.ts` | 1 |
| `test/core/pipeline-registry/builtin-v2-package-audit.test.ts` | 1 — pin table, will be rebaselined |
| `test/core/pipeline-registry/execution-validation.test.ts` | 1 |

## The facade-runtime port — what the merged shape must be

`receipt()` must take **both** sets of new parameters. Base's signature ends `continuationGrants: readonly AgentContinuationGrant[] = []`; mine adds `buildAction?: RuntimeDeps['buildAction'], candidates?: readonly AgentTurnInputCandidate[]`. Merge to `(..., plan, buildAction?, candidates?, continuationGrants = [])` and update **every** call site to the merged argument order — `tsc` will enforce this, so lean on it.

Then, in order:
- `collectSettleStimuli` returns both `continuationIds` (base) and `reserved` (mine).
- `settle` returns both `continuationGrants` (base) and `reserved` (mine).
- Commit error handling keeps both: `discardPendingReservations` on throw + `finalizePendingReservations` on success (mine), and `releaseTerminalReservations` (base).
- `admit()` and `consult()` both exist as sibling methods.

Suggested method: `git checkout --ours -- <facade-runtime>` to take base whole, then re-apply `git diff 75c3366a 0a32156a -- src/core/change-run/internal/facade-runtime.ts` by hand onto it. Do **not** use `git checkout --theirs` on a whole file anywhere in this rebase — it silently drops the other side's entries.

## Gotchas that cost time this session

- **`git checkout --` cannot be used to revert a mutation in this repo** — autocrlf rewrites the working tree to CRLF. Revert by editing back.
- **During a rebase `--ours` is the BASE and `--theirs` is your commit** — inverted from merge intuition.
- **Working-tree files written by git during the rebase are CRLF**, so PowerShell patterns anchored with `$` (e.g. `'^=======$'`) silently fail on the trailing `\r`. Compare with `.TrimEnd("`r")`.
- **`Select-String -SimpleMatch` makes `^` literal** — it silently reported 0 conflict hunks everywhere.
- **.NET calls like `[System.IO.File]::ReadAllBytes` use the process CWD, not PowerShell's location** — pass absolute paths.
- **The whitespace gate scans the whole PR diff.** 7 pre-existing violations surfaced only at `git add` time. Check `git diff --cached --check` before every commit.

## Next action

1. `cd` into the worktree; confirm `git status` is clean and on `feat/omnicross-inference-routing` at `6a4bd586`.
2. `git rebase origin/dev/0.2.0`.
3. Copy the 10 preserved resolutions over their paths, `git add` each.
4. Port `facade-runtime.ts` per the shape above; then the 4 remaining executor/management-api files; then the test files.
5. `git rebase --continue`.
6. Rebaseline `EXACT_CAPABILITY_PINS` (`builtin-v2-package-audit.test.ts`) and the `skill-templates-parity.test.ts` hash tables from the production generators (`loadWorkflowCatalog` + `computeBuiltInWorkflowDigest`) — **never** hand-copied from `.claude/skills/` output.
7. `tsc --noEmit`, build, full `pnpm test`, `git diff --check`.
8. **Re-dispatch the reviewer against the rebased tree.** The 5-round review verified `facade-runtime.ts`, `executor.ts` and `contracts.ts` pre-rebase; those files are materially different after the port. Authority properties must be re-established, not assumed to carry over. Reviewer session `f64a92e9-f9d6-4c16-8f3d-e57d55c9503a`.
9. `git push --force-with-lease` and mark PR #156 ready for review.

## Standing verification limitation

Q6 mutation discrimination for the four publication-path guards was measured by the LEAD and independently *derived* by the reviewer with identical results (2/4/1/1 red, same tests), but was never verifier-*executed*: the test runner is refused at the permission layer in dispatched workers (`pnpm`, `npx`, `node -e` all blocked; `node --version` and `git` pass). Two dispatches failed on this. Treat it as an open follow-up, not a receipt.
