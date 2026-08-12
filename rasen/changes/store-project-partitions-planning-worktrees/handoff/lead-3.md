# Handoff: store-project-partitions-planning-worktrees — lead #3

## Original intent

> `$rasen-auto auto-decompose 开始实现！创建worktree，基于最新的dev/0.1.7创建开发分支，完成后提pr`

Implement the complete accepted design in `docs/zh/store-project-partitions-and-planning-worktrees.md`
and deliver ONE PR against `dev/0.1.7`.

Runtime and model policy are unchanged from lead-2: **Claude Code subagents only,
no Codex. ship/archive = sonnet, everything else = opus.**

**Concurrency: the user set a cap of 2–3 simultaneous agents** (lead-2's session
was killed by a quota limit while running 14). Respect it.

## Position

Worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/workflow/Reference/OpenSpec-code-wt-store-project-planning-v2`,
branch `feat/store-project-partitions-planning-worktrees`, base `588afca1` (origin/dev/0.1.7).
A fresh session lands in the sibling checkout `.../OpenSpec-code` by default and MUST
re-enter this worktree first. The sibling checkout is dirty with unrelated user
work — do not edit, move, or clean it.

### Child status

| # | Change | Status | Tasks |
|---|---|---|---|
| 1 | store-planning-foundation-v2 | done — shipped + archived (lead-1) | 23/23 |
| 2 | store-planning-scope-routing | done — shipped + archived (lead-2), 3 review rounds | 56/56 |
| 3 | store-layout-v2-migration | apply complete; **reviewed (lead-3), fix round 1 in progress** | 83/83 |
| 4 | store-planning-worktree-bindings | apply complete; **reviewed (lead-3), fix round 1 in progress** | 98/98 |
| 5 | store-finalization-outcomes-v2 | **apply in progress** (was 67/101 at session start) | — |
| 6 | store-scoped-issues-management | propose done, apply NOT started | 0/102 |
| 7 | store-v2-compat-hardening | **propose done (lead-3)**, apply not started | 0/81 |

Children 3, 4, 5 (and now 7's proposal) are all **uncommitted working-tree
content**. Only children 1 and 2 are committed and archived.

## What lead-3 did

- Child 7 proposal authored: 8 files, 81 tasks, 4 spec deltas, `validate --strict`
  green (independently re-run by the lead).
- Child 4 independently reviewed: **12 findings (3 HIGH, 2 MEDIUM, 7 LOW)** plus a
  guard-discrimination table naming 4 non-discriminating guards.
- Child 3 independently reviewed: **2 HIGH, 4 MEDIUM, 2 LOW, 2 INFO** plus 6
  non-discriminating guards.
- Fix round 1 dispatched for both children 3 and 4 (separate agents from the
  reviewers — author != verifier holds).

## Decisions made this session (do not re-litigate)

- **Scope: the user re-confirmed the FULL seven-child scope** after being shown a
  task-count breakdown proving the partitioning proper is ~79 tasks and the other
  ~301 are three independently-motivated features. The cheapest cut point (child 6
  at 102 tasks / zero progress, child 7 unproposed) was declined deliberately.
  Full rationale and the breakdown table are in `planning-context.md` under
  "Scope re-confirmation (lead-3, 2026-08-07)". **Do not re-raise this and do not
  silently narrow the scope.**
- **The two operations the siblings deferred are excluded BY THE DESIGN, not
  orphaned.** (a) Merging a planning branch into its Store integration ref: §16
  forbids Rasen automating merge/rebase/force-delete; §9.2 assigns the tool
  detect-and-report, which child 7's consistency gate delivers. (b) Upgrading a
  relocated legacy Archive entry to an Archive v2 record: §8.1 requires `landed`
  to prove commit reachability and every non-landed outcome to carry a non-empty
  operator reason — no batch pass can supply either, so this is an operator
  declaration per entry and belongs to `ChangeFinalizationModule` (child 5), not
  to a compatibility sweep. Citations are written into child 7's `design.md` §10.
  Note: **§11.2's priority list governs `projectId` only** — do not cite it as
  authority over outcome facts.
- **Child 3's H1 (`membership.ts` readers do not dispatch on layout) is child 3's
  to fix**, because child 3's own ticked task 7.3 claims it. Child 7's task 3.2
  currently pre-classifies `membership.ts` as a "frozen legacy adapter"; that was
  written against the broken code and **must be rewritten before child 7 apply
  starts**, or it will re-freeze a now-correct adapter.

## Dead ends & gotchas discovered this session

- **`scratchpad/title-check.mjs` is NOT reusable** despite being delivered as
  such. It hard-codes `CHANGE = 'store-v2-compat-hardening'` and applies sibling
  deltas in array order rather than DAG order — and order is load-bearing here.
  The child 3 reviewer wrote a correct per-change checker mirroring
  `src/core/specs-apply.ts:290-310`; prefer that, or write your own.
- **Concurrent rebuilds tear `dist/`.** With more than one agent in this tree, a
  rebuild can leave `dist/cli/index.js` present while `dist/commands/validate.js`
  is momentarily absent. Symptom: `ERR_MODULE_NOT_FOUND`, or a CLI call returning
  empty stdout, which surfaces as "Could not parse JSON" or an unexpected exit 1.
  Two failures (`pipeline.test.ts`, `workspace-cli.test.ts`) were misdiagnosed as
  defects this way and cleared. **The final parent integration gate MUST run with
  no other agent active.** The NEW-12 build fingerprint does not protect against
  two concurrent writers.
- **"Ticked task" is not evidence.** Both of child 3's HIGH findings are tasks
  that are ticked and documented as done in `caller-inventory.md`, and are not
  done. When reviewing, treat a cited line count as a lower bound and re-enumerate
  the full set yourself.
- **A test can be blind by construction.** Child 4's finding 1 (cleanup deletes a
  worktree out from under a live session) was invisible to the entire suite
  because `test/helpers/store-workspace-fixture.ts:295` passes a `globalDataDir`
  that the real CLI never passes. Fixing the production line without closing that
  fixture blindness leaves the whole class open.
- All of lead-2's gotchas still apply: never `git checkout -- <file>`, never
  `git stash` (shared stack), the 5 environmental `config*.test.ts` failures,
  `tsc --noEmit` excluding `test/`, the archive-engine traps in
  `planning-context.md` "Ship and archive gotchas", and archive order being
  load-bearing because deltas apply at archive time.

## Working set

- Design source: `docs/zh/store-project-partitions-and-planning-worktrees.md`
- Locked decisions / lessons / ship gotchas: `rasen/changes/store-project-partitions-planning-worktrees/planning-context.md`
- Review reports: `rasen/changes/store-layout-v2-migration/evidence/review-report.md`,
  `rasen/changes/store-planning-worktree-bindings/evidence/review-report.md`
- Child 5 working handoff: `rasen/changes/store-finalization-outcomes-v2/handoff/implementer-1.md`
- Scenario-drift detector: `scratchpad/scenario-drift.mjs` (positive-controlled
  against child 2's pre-fix delta) — run before each archive.

Build/test: `pnpm run build:if-stale` before CLI tests; `pnpm exec vitest run <path>`
focused; `pnpm test` full (5 environmental failures — interpret selectively).

## Next action

1. Land fix round 1 for children 3 and 4, then re-review the delta (the reviewer
   agent for each child is still resumable by name and holds its context).
2. Finish child 5 apply, then review + fix it.
3. Child 6 apply (102 tasks) — **must wait for child 5**, it shares
   `management-api/router.ts` and `whitelist.ts` with child 5's finalize endpoint,
   and child 5's task 14.5 requires child 6's `management-http-api` delta to copy
   the post-child-5 scenario set of "Loopback and bearer security across the
   CLI-backed mutation surface".
4. Correct child 7 task 3.2, then child 7 apply, then review + fix.
5. Parent integration gate — full `pnpm test` + build + lint + `git diff --check`
   over the aggregate diff, **with no other agent running**, then `rasen review`.
6. Ship + archive children 3–7 locally, **in DAG order**.
7. Push + ONE PR against `dev/0.1.7`. **Requires explicit user authorization.**
