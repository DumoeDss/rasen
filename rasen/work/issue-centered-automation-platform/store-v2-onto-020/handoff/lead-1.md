# Handoff: store-v2-onto-020 — LEAD session 1

## Original intent
Land 0.1.7's Store-v2 onto 0.2.0 (including 0.3.0-adjacent Store-Issue content, per operator
decision: "if Store-v2 touches the 0.3.0 boundary, include it; land Store-v2 on 0.2.0"). This
session established the sub-direction and did the sweep; the next session does the first slice.

## Position
- Sub-direction `issue-centered-automation-platform/store-v2-onto-020/` is **drafted + calibrated**
  (target-state, roadmap, first slice `store-v2-foundation`). `status: draft`, no `activeSlice` yet.
- **PR #155** (`chore/store-v2-direction-and-backport-archive` → `dev/0.2.0`) carries the Direction
  docs + the backport archive. **Awaiting merge.**
- First slice `store-v2-foundation` (port store base v2 + `store/issues/`) is spec'd and ready to project.

## Done this session
- Backport #153 was merged but unarchived → archived as `2026-08-12-backport-archive-validate-defects`
  (delta specs `cli-archive`/`cli-validate` synced into main specs). Commit `f6b46e25`.
- Direction established (work.yaml / target-state / roadmap / slices). Commit `1fe8b8a4`.
- **Calibrated baseline:** 0.1.7 is **released** (tag v0.1.7; `dev/0.1.7` HEAD `a3f49007`; `dev/0.1.8`
  cut as bugfix line). The full Store-v2 stack — **including the coordinator-bridge** (PR #154 merged,
  archived `9472d7dc`) — is a frozen, tagged reference. L8 is therefore **unblocked**. dev/0.2.0 at `34d91322`.
- PR #155 opened.

## Next action (Step 2 — fresh session)
1. Once PR #155 merges, open a **fresh worktree off `origin/dev/0.2.0`** (NOT this one — `merge-017-into-020`
   is on the PR branch and is now done; `EnterWorktree` branches off `origin/main`/HEAD, so use a manual
   `git worktree add` off `origin/dev/0.2.0`).
2. **Activate the Direction:** set `status: active` and `activeSlice: slices/store-v2-foundation` in
   `rasen/work/issue-centered-automation-platform/store-v2-onto-020/work.yaml`.
3. **Project the first slice:** `rasen-propose` (or `/rasen-propose`) for `store-v2-foundation` — port
   the 0.1.7 store base v2 model + `src/core/store/issues/` onto 0.2.0. The released 0.1.7 is a
   **read-only behavior reference, not a copy target**. Acceptance: ported store/issues suites green +
   a real Issue lifecycle on 0.2.0 + no regression to change-run/daemon/ECP.

## Locked decisions (target-state.md D1–D5)
- **D1** include 0.3.0-adjacent Store-Issue content on 0.2.0 (operator override of parent roadmap §0).
- **D2** adopt 0.1.7's explicit-capability execution root (`resolvedExecutionProjectRoot`); remove 0.2.0's
  cwd-probe `resolveExecutionRoot` (goal-mandated: runtime cwd ≠ durable target binding).
- **D3** `DISPATCH_ADAPTERS` is the target dispatch model — decision locked now, **work sequenced AFTER the
  foundation** (it is execution-domain, orthogonal to the planning-domain spine, and the largest daemon seam).
- **D4** finalization + stored-plan (TOCTOU) as ONE slice; must coexist with the B1 `mergeConfirmed` gate.
- **D5** one Issue serializer / lock / store; receipt is historical evidence, never a live store.

## Roadmap shape
- **NOW:** `store-v2-foundation` (L0 store base v2 + L1 Issues module).
- **LATER:** `layout-migration` (L2) → `coordinator-bridge` (L8, now unblocked) → `store-session-execution-context`
  (L6) → `finalization+stored-plan` (L3+L5) → `dispatch-adapter` (L4) → `router/runs/management-api seams` (L7).
- **NOT NOW (parent direction Phase 0–8):** Issue Dispatch agent, Execution Plan DAG scheduling,
  auto-decompose uplift, Board/Operations UI, Issue acceptance, external tracker.

## Gotchas
- 0.1.7 ↔ 0.2.0 are **bidirectionally divergent** on store/archive/dispatch/router — every seam is a
  re-implementation on 0.2.0, not a port (merge/cherry-pick both proven unviable).
- The repo's commit hook flags trailing blank-line-at-EOF in archive-rebuilt specs (a regen artifact);
  fix with `perl -0pi -e 's/\n+\z/\n/' <file>` then re-stage. Do NOT use `--no-verify`.
- Direction docs are written in **English** for byte-safety (this Write tool mangles multibyte Chinese to U+FFFD).
- `EnterWorktree` branches off `origin/main`/HEAD, NOT `dev/0.2.0` — Step 2's worktree needs a manual `git worktree add`.

## Working set
- This worktree: `merge-017-into-020`, branch `chore/store-v2-direction-and-backport-archive` (PR #155).
- Direction: `rasen/work/issue-centered-automation-platform/store-v2-onto-020/`.
- Released 0.1.7 reference: `origin/dev/0.1.7` (`a3f49007`); coordinator-bridge archived `9472d7dc`.
- Target line: `origin/dev/0.2.0` (`34d91322`).
