# Handoff: store-project-partitions-planning-worktrees — lead #1

## Original intent

> `$rasen-auto auto-decompose 开始实现！创建worktree，基于最新的dev/0.1.7创建开发分支，完成后提pr`

Implement the complete accepted design in `docs/zh/store-project-partitions-and-planning-worktrees.md` (including its corrections to the file-placement model) and deliver one PR against `dev/0.1.7`.

User override (this session): finish Change 2 completely (fix → independent re-review → ship/archive). For Changes 3–7 run only planner → implementer serially; defer verify/review-loop/ship/archive. After all five apply stages complete, review/fix all Changes, then ship/archive locally, then create one PR.

## Position

Pipeline: `auto-decompose` with child pipeline `small-feature`. Host: Codex native, Tier A. Gate policy: `off` (global). Portfolio mode: serial, executionStrategy = `implementation-first-review-deferred` (user-override, effective from child 3).

Completed children: `store-planning-foundation-v2` (done; shipped + archived locally; impl commit `a7135669`, archive/spec-sync commit `b86fbb6b`).

In-progress child: `store-planning-scope-routing`.
- propose: done (planner `/root/portfolio_planner`)
- apply: done (implementer `/root/scope_routing_implementer_2`; one handoff → fresh successor completed)
- verify: done (reviewer `/root/scope_routing_reviewer`; 9 findings: S1–S3, P1–P6)
- review-loop: **in progress**, round 1. Fixer agent `/root/scope_routing_fixer_r1` is LIVE and in-session — NOT dead. It has completed the substantive fixes (scope-routing hardening, fail-closed guards, zero-write tests, compatibility/finalization boundaries). It was last classifying full-suite test failures into "expected by new design (old flat Store writes now forbidden)" vs "environment pollution" and refreshing the final review-cycle-report evidence. Focused suites pass: scope-routing matrix 90/90, sequential lifecycle matrix 198/198; tsc + lint + build green.

Pending children (DAG order): `store-layout-v2-migration` (g-003), `store-planning-worktree-bindings` (g-004), `store-finalization-outcomes-v2` (g-005), `store-scoped-issues-management` (g-006), `store-v2-compat-hardening` (g-007).

## Done / Remaining

Done:
- Worktree + dev branch `feat/store-project-partitions-planning-worktrees` off `origin/dev/0.1.7` (`588afca`).
- Child 1 full pipeline (done, shipped, archived).
- Child 2 propose + apply + verify + fixer round-1 substantive work.

Remaining (in order):
1. **Complete Change 2 review-loop round 1.** The fixer `/root/scope_routing_fixer_r1` is alive — use `followup_task` to resume it (do NOT cold-reconstruct). It must: finish triaging the remaining full-suite failures, refresh `rasen/changes/store-planning-scope-routing/evidence/review-cycle-report.md`, and return `DONE`.
2. **Independent re-review (author ≠ verifier).** Dispatch a FRESH reviewer (NOT `/root/scope_routing_reviewer` and NOT `/root/scope_routing_fixer_r1`) to re-review only the delta and confirm all 9 findings (S1–S3, P1–P6) are resolved. If clean, proceed; if not, another fix round (round cap 3, soft).
3. **Ship + archive Change 2 locally** (commit only, no push).
4. **Mark Change 2 done** in `portfolio-run.json`.
5. **Children 3–7: planner → implementer only.** Re-engage the persistent planner `/root/portfolio_planner` via `followup_task` for each propose (probe reuse threshold first; retire-between-children if over 0.25). Then dispatch a fresh implementer per child. Record verify/review-loop/ship/archive as deferred (not passed).
6. **After all 5 apply stages: deferred reviews** serially, author ≠ verifier, fix to clean, then ship/archive locally.
7. **Parent integration:** full `pnpm test` + build + lint, then `rasen review` over the aggregate diff.
8. **Push + create ONE PR** against `dev/0.1.7` (delivery.mode = pr, baseRef = dev/0.1.7).

## Key decisions (and why)

- **Implementation-first strategy for children 3–7** — user explicit override to speed up: planner → implementer per child, defer all reviews/ship/archive until every apply is done. Recorded in `portfolio-run.json.executionStrategy` and in `planning-context.md` "Execution strategy override" section. This supersedes the normal per-child review-clean dependency gate for children 3–7 ONLY; Change 2 must be review-clean before child 3 starts.
- **One path authority for Store v2** — no dual writes. Project planning content lives under `rasen/projects/<projectId>/`; there is no writable flat Store `rasen/changes`/`rasen/specs` namespace in layout v2.
- **Store planning, execution context, and finalization authority are separate capabilities.**
- **Legacy Archives must not fabricate outcome, target-line, or workspace-pair facts** that legacy evidence cannot prove.
- `storeUid`, `projectId`, `targetLineId` are orthogonal stable identity dimensions; Git branch names are mutable locators.
- Only finalization outcome `landed` may update canonical specs.
- Children ship **local** (commit only); the portfolio pushes / creates the PR ONCE at the parent level after ALL children complete.
- The original working tree (`OpenSpec-code`) is dirty with unrelated user work — do NOT edit, move, or clean it. All implementation is in the worktree.
- Handoff bug fix: automatic context compaction alone is NOT a handoff trigger (fixed this session). Workers stay flat leaves; never spawn subagents; never edit run-state.

## Dead ends & gotchas

- **Context probe reports `no-transcript`** because my LEAD session's cwd is the original repo, not the worktree where the Codex rollout lives. This is normal — occupancy is unmeasurable, not "below threshold". Omit `pct` from the run-state record.
- **The fixer was interrupted by a 429 rate limit** (infra/transient death, not context death). It consumed NO relay budget and was resumed via `followup_task` on the same agent id, per the H.4a taxonomy.
- **Full-suite tests (`pnpm test`) have pre-existing environment-pollution failures** unrelated to this change. The fixer was classifying these vs. real regressions. Use focused suites (`vitest run <path>`) for iteration; run the full suite once at parent integration.
- **Some full-suite failures are EXPECTED by the new design** — the old flat Store write paths are now forbidden in layout v2; tests that assert the old flat-write behavior must be updated to expect project-partitioned writes. Do not "fix" the implementation to restore old behavior.
- **Persistent planner `/root/portfolio_planner`** — before each re-engagement apply the H.2 warm-continue guard (probe reuse threshold 0.25); if over, retire-between-children and dual-source seed a fresh planner.
- **Skill templates parity test** (`test/core/templates/skill-templates-parity.test.ts`) is sensitive to workflow template edits — it must be updated when templates change.

## Eliminated hypotheses

- "The fixer died and needs cold reconstruction" — RULED OUT: it is alive and in-session, returning progress signals. Resume via `followup_task`, never cold-reconstruct.
- "Context compaction = handoff" — RULED OUT: this was the bug, now fixed. Compaction is resolved in place; only genuine budget/recall degradation triggers handoff.

## Working set

Worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/workflow/Reference/OpenSpec-code-wt-store-project-planning-v2`
Branch: `feat/store-project-partitions-planning-worktrees`

Key files (Change 2 diff, 79 files / +2944 −1197):
- `src/core/root-selection.ts` — +451 lines, scope routing core
- `src/core/config-api/project-addressing.ts` — +171, project/store selectors
- `src/core/management-api/session-launch-context.ts` — ±389
- `src/core/archive.ts` — +99, finalization boundary guards
- `src/locales/{en,ja,zh-cn}.json` — +108 each, new error messages

Change 2 evidence:
- `rasen/changes/store-planning-scope-routing/evidence/review-report.md` (canonical review, 9 findings)
- `rasen/changes/store-planning-scope-routing/evidence/review-cycle-report.md` (fixer output, being refreshed)
- `rasen/changes/store-planning-scope-routing/evidence/caller-inventory.md`

Change 2 run-state: `.rasen/changes/store-planning-scope-routing/ephemera/auto-run.json`
Portfolio run-state: `.rasen/changes/store-project-partitions-planning-worktrees/ephemera/portfolio-run.json`
Design source: `docs/zh/store-project-partitions-and-planning-worktrees.md`
Planning context: `rasen/changes/store-project-partitions-planning-worktrees/planning-context.md`

Build/test: `pnpm run build` before CLI tests; `pnpm exec vitest run <path>` for focused; `pnpm test` for full suite (has pre-existing env pollution — interpret selectively).

## Next action

Resume the LIVE fixer `/root/scope_routing_fixer_r1` via `followup_task` with: "Finish triaging the full-suite test failures, refresh review-cycle-report.md, and return DONE." Then dispatch a FRESH non-author reviewer to confirm all 9 findings are resolved. Do NOT cold-reconstruct the fixer.
