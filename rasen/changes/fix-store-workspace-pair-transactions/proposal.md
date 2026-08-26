# Proposal: fix-store-workspace-pair-transactions

## Why

The official transaction that prepares (or re-prepares) a Change workspace pair — `rasen store workspace plan` + `apply` — is unusable on a live target line: during a real delivery in `elftia-store` (codex session `01a02fb2`, 2026-08-24..26) it blocked the official verified-checkout route for retention of two fully-merged Changes, forcing the session to close them under a retention waiver. Two distinct defects in the one flow produced consecutive fail-closed refusals before any write:

1. **Stale-tip freeze (plan side).** The plan freezes the integration tip it resolved at plan time and requires it byte-identical at apply time, but the two steps are separate invocations and normal retention activity advances the very ref between them (elftia's local `main` gained 10 `Merge archive *` commits inside the session window). On an active line the plan is born stale — or is stale by the time apply runs — and the transaction invalidates itself.
2. **New-worktree identity misjudge (apply side).** For a side the plan will *create*, apply compares the machine index entry's recorded `worktreeInstanceId` against a live survey of the planned destination. A not-yet-created destination has no identity, so whenever a previous pair for the same Change survives in the index (worktree deleted, or a fresh destination requested), apply refuses with `workspace_plan_stale` — and the refusal's own repair ("re-plan") reproduces the identical situation forever. Re-preparation, which the spec explicitly promises ("Re-preparing an existing Change changes the pair identity"), is wedged.

Defect 2 converts defect 1's designed, self-healing refusal into a permanent dead end. Fail-closed protected the stores (nothing was corrupted), and the delivery itself landed: the session fell back to hand-assembled worktrees, waived only the verified-checkout retention step, and the finalization engine archived both Changes soundly on 2026-08-25 (`outcome: landed`, real digests, code merge recorded). But the waiver was forced by these defects, and every future delivery on an active line faces the same forced waiver until the flow is fixed.

## What Changes

- **Apply treats absence as what a create-plan requires.** For a create-disposition side, revalidation succeeds when the destination does not exist (that is the precondition creation needs); the recorded-identity comparison applies only to the idempotent-resume case — a destination that exists on the planned ref — and only when the index entry's recorded root is the planned root. No staleness check is skipped; the misdirected one is aimed at the state it actually guards.
- **Plan reconciles a surviving recorded pair instead of ignoring it.** When the machine index already records a pair for the same Change: a still-live recorded worktree at a *different* root than the planned one is an unsatisfied precondition naming the recorded pair and the cleanup repair (one Change, one pair); a *vanished* recorded worktree is a satisfied precondition that states the re-creation in the plan preview. Plan and apply stop judging the same world differently.
- **One-invocation preparation closes the self-race window.** A compound prepare (plan + immediate apply under one lock hold) becomes the official way to create a fresh verified checkout, so the frozen tip cannot go stale between two CLI invocations of the same session's own flow. The two-step preview path remains for inspection; a genuinely moved ref still refuses stale — and, with the wedge fixed, re-running converges.
- **A pair branch an earlier pair left behind is reattached, not re-minted.** Found during implementation, once the apply-side fix stopped refusing earlier: neither `git worktree remove` nor `workspace cleanup` deletes a branch — by design, because a branch may carry commits — so every re-preparation meets its own pair branch, and creating a worktree with `git worktree add -b` fails outright on one that exists. The plan now reports what it found for each created side's branch: absent (minted from the line's frozen tip), existing and free (reattached at the branch's OWN frozen tip, so commits on it are neither discarded nor rewound), or held by another worktree (refused, naming it). Applying revalidates a reattached branch's tip against the frozen commit exactly as it does the line's refs. Without this the flow still could not complete, so the two fixes above would have relocated the refusal without making re-preparation converge.
- **The plan preview names the frozen tip.** The preview reports which ref and commit each created side will be born from, so an operator can see what was frozen before applying.
- End-to-end real-git tests pin both defects with failing-first guards, plus the re-preparation flows the spec already promises (torn-down pair, fresh-destination pair, mid-flow ref advance then re-plan convergence). Suites carry explicit per-test timeouts.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `store-planning-worktree-bindings`: the apply-revalidation requirement's created-destination semantics (absence satisfies a create plan; identity comparison scoped to the resumable, existing destination); the plan/token requirement gains recorded-pair reconciliation preconditions, the frozen-tip disclosure, and the one-invocation prepare orchestration.

## Impact

- `src/core/store/workspace/apply.ts` — create-side revalidation (the misdirected identity comparison).
- `src/core/store/workspace/plan.ts` — recorded-pair reconciliation preconditions; frozen-tip precondition in the preview.
- `src/core/store/workspace/module.ts` — compound prepare orchestration (plan + apply in one lock hold).
- `src/core/store/workspace/dependencies.ts` — `addWorktree` gains an optional `createBranch` (default true), so an existing pair branch is attached rather than minted. Same Git verb; the closed verb set and its source guard are unchanged.
- `src/commands/workspace.ts` — CLI surface for the compound prepare.
- `src/core/completions/command-registry.ts` and `src/locales/{en,ja,zh-cn}.json` — the `--apply` flag's completion entry and its help copy in all three locales.
- Tests: `test/core/store/` workspace suites — new real-git end-to-end suite for both defect scenarios and the re-preparation paths.
- NOT touched (sibling ownership): `src/core/store-planning/internal/resolver.ts`, `src/core/store/identity.ts` (change A `fix-store-retention-scope-resolution` owns the resolver/registry/gate seam); target-line locator semantics (`src/core/store/target-lines.ts`) are unchanged.
- Operators: after landing, rebuild `dist` and reinstall the dogfood CLI so external sessions pick up the fix; the next elftia retention can run through the official verified-checkout flow with no waiver.
