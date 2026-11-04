# Handoff: omnicross-inference-routing — lead #6

## Position

**The rebase onto current `dev/0.2.0` is DONE.** PR #156 now carries the rebased branch (force-pushed, `f1cd8fe2`). What remains is ONE design question with a bounded blast radius.

Branch `feat/omnicross-inference-routing`, worktree `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-omnicross-inference-routing` (do NOT create a new one). Pre-rebase backup ref: `backup/pre-rebase-omnicross`.

## Done

- **Rebase**: 28 base commits, 22 conflicted files, 62 hunks — all resolved. `facade-runtime.ts` was a port, not a merge (base +636/−36 vs ours +273/−47 through the same functions).
- **`tsc --noEmit` clean**, `pnpm build` clean, `git diff --check` clean.
- **Digests rebaselined from the production catalog loader** (`loadWorkflowCatalog`), never hand-copied from `.claude/skills/`: 17 `EXACT_CAPABILITY_PINS`, the `review-cycle` digest in 3 pipeline YAMLs, 30 skill-template hashes. `builtin-v2-package-audit` 5/5, `skill-templates-parity` 9/9.
- **Full suite: 8357 passed / 32 failed / 59 skipped.**

### Merge decisions worth not re-litigating

- `receipt()` carries both sides' new params: `(record, disposition, granted, resolveSourceState, plan, buildAction?, candidates?, continuationGrants = [])`. Every call site was updated; `tsc` enforces this.
- `collectSettleStimuli` returns both `continuationIds` (base) and `reserved` (ours); `settle` returns both `continuationGrants` and `reserved`.
- Commit error handling keeps BOTH `discardPendingReservations`/`finalizePendingReservations` (ours) and `releaseTerminalReservations` (base).
- **`resolveDispatchRoute` correctness catch**: base added `omp` (Oh My Pi) as a recognized but NON-dispatching host and replaced `host === 'unknown'` with `hasRuntimeCapability(host,'canDispatch')`. Our `externalInference` branch guarded on `host === 'unknown'`, which would have routed an `omp` host to the `claude-print` bridge — the exact residual hazard `detectHostRuntime` documents. Both branches now guard on `canDispatch`. **Do not regress this.**
- The resumed-run `buildAction` (`runtime-context.ts`, second one) gained the same `actionKind` switch and `renderedTurnInput` requirement as the launch path; it previously bypassed agent authority entirely.
- `WorkerContractZodSchema` is `z.enum(['leaf','consultable-leaf','evaluate'])` so the canonical Action contract matches base's three-way `WorkerContract`.

## The one open problem

**27 failures across 2 files, all one root cause.**

Base's teacher-consultation feature admits agent Actions through `consult()` and the `settleConsultation*` paths. Those paths do **not** go through this change's candidate-preview boundary, so under the new protocol they have **no trusted-render source**. Teacher and continuation Actions are therefore never admitted, and the journeys fail on action-count assertions (`expected [] to have a length of 2 but got 0`, `Cannot read properties of undefined (reading 'completionAuthority')`).

This is a **product integration gap, not a test-fixture problem.** The design question to settle:

> Should `consult()` preview a Teacher candidate that must then be admitted against trusted rendered bytes (consistent with M4), or is Teacher admission server-owned and exempt because it derives from the frozen consultation binding rather than from caller-authored content?

Answering it weakens or preserves the change's core authority property, so it is a decision for the reviewer/user, not a mechanical fix.

Files: `test/core/change-run/consultation-facade-journey.test.ts` (26 failing of 28) and `test/core/change-run/runtime-context.test.ts` (1 failing: base's `shares the default production reservation registry across RuntimeContexts`, which calls `ctx.facade.start` directly and expects an admitted Action).

### Already done toward it

- `test/helpers/change-run-admission.ts` gained an **injectable renderer**; `createAdmittingChangePipelineDriver(runtime, render?)` and the spread of `...runtime` so newer facade methods (`consult`, `settleConsultation*`) are forwarded rather than dropped.
- The consultation journeys now run through that driver, and their fixture renders `JSON.stringify(candidate.input)` because that is exactly what their dispatches assert against. **This is a fixture choice and is commented as such — production MUST NOT derive turn-input authority from `JSON.stringify(agent.input)` (task 7.5 forbids it).**
- That alignment already fixed the `execution-input-rejected` class of failure. What is left is purely "the Teacher/continuation Action was never admitted".

The simplest candidate fix for the `runtime-context.ts` one is to wrap that test's facade in `createAdmittingChangePipelineDriver` too; the consultation ones need the design answer first.

## Known flaky (not regressions)

`test/cli-e2e/capstone-journeys.test.ts` (30s timeout under parallel load; passes in isolation but with a thin margin — measured 15s idle, ~34s under load), `test/commands/pipeline.test.ts` locale-neutral, `test/commands/context.test.ts`. Re-run each in isolation before treating any as a regression.

## Standing verification limitation

Q6 mutation discrimination for the four publication-path guards was measured by the LEAD and independently *derived* by the reviewer with identical results, but never verifier-*executed*: the test runner is refused at the permission layer in dispatched workers (`pnpm`, `npx`, `node -e` blocked; `node --version`, `git` pass). Open follow-up, not a receipt.

## Next action

1. Settle the Teacher-admission design question above.
2. Fix the 27 failures accordingly; re-run `test/core/change-run/`.
3. Full `pnpm test`; confirm only the 3 known-flaky remain, each re-run in isolation.
4. **Re-dispatch the reviewer against the rebased tree** — the five review rounds verified `facade-runtime.ts`, `executor.ts` and `contracts.ts` PRE-rebase and those files are materially different now. Authority properties must be re-established, not assumed. Reviewer session `f64a92e9-f9d6-4c16-8f3d-e57d55c9503a`.
5. Mark PR #156 ready for review.

## Gotchas that cost time

- During a rebase `--ours` is the BASE and `--theirs` is your commit — inverted from merge intuition.
- `git checkout --` cannot revert a mutation here: autocrlf rewrites the tree to CRLF. Revert by editing.
- PowerShell `>` redirection writes CRLF, which makes `git apply` fail with "patch does not apply". Use `git diff --output=<file>` so git writes it, and `git apply -C1` when context has drifted.
- `Select-String -SimpleMatch` makes `^` literal — it silently reported 0 conflict hunks everywhere.
- `[System.IO.File]::*` uses the process CWD, not PowerShell's location. Pass absolute paths.
- A node script that rewrites a file can leave CRLF where the index has LF; `git diff --check` then flags every line as trailing whitespace.
