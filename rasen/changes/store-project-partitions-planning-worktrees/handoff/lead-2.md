# Handoff: store-project-partitions-planning-worktrees — lead #2

## Original intent

> `$rasen-auto auto-decompose 开始实现！创建worktree，基于最新的dev/0.1.7创建开发分支，完成后提pr`

Implement the complete accepted design in `docs/zh/store-project-partitions-and-planning-worktrees.md`
and deliver ONE PR against `dev/0.1.7`.

User override (lead-2, this session): **switch the entire remaining portfolio from
Codex to Claude Code agents.** Model policy: **ship/archive = sonnet, everything
else (planner/implementer/reviewer/fixer) = opus.** All work below was done by
Claude Code subagents on that policy. Do not dispatch Codex.

Children 3–7 use `implementation-first-review-deferred`: run propose → apply per
child in DAG order, **defer verify/review-loop/ship/archive until every apply is
done**, then review/fix all five serially, ship/archive locally, then ONE PR.
Only child 2 was fully review-cycled (3 rounds) before its successors started.

## Position

Pipeline: `auto-decompose`, child pipeline `small-feature`. Host: **Claude Code**
(switched from Codex this session). Gate policy: `off` (global). Portfolio mode:
serial. Worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/workflow/Reference/OpenSpec-code-wt-store-project-planning-v2`,
branch `feat/store-project-partitions-planning-worktrees`, base `588afca1` (origin/dev/0.1.7).

**This lead session was itself interrupted by a Claude quota limit** (the child-5
implementer hit its session limit; the user stopped all 14 background agents).
Resume by re-entering the worktree and continuing from "Next action".

### Child status (read this table first)

| # | Change | Status | Tasks | Gate |
|---|---|---|---|---|
| 1 | store-planning-foundation-v2 | **done** — shipped + archived (lead-1, Codex) | — | — |
| 2 | store-planning-scope-routing | **done** — shipped + archived (lead-2, Claude), 3 review rounds, CLEAN | — | 5 env-only fail / 6191 pass |
| 3 | store-layout-v2-migration | **apply complete**, review DEFERRED | 83/83 | clean (5 env-only) |
| 4 | store-planning-worktree-bindings | **apply complete**, review DEFERRED | 98/98 | clean (5 env-only) |
| 5 | store-finalization-outcomes-v2 | **apply IN PROGRESS** (rate-limited at 67/101) | 67/101 | not yet run |
| 6 | store-scoped-issues-management | **propose done**, apply not started | 0/102 | — |
| 7 | store-v2-compat-hardening | not started (no proposal yet) | — | — |

Children 3, 4, 5 are **all uncommitted working-tree content** in the worktree —
nothing of theirs is committed. Child 2 is the only one committed+archived.

## Done / Remaining

Done:
- Worktree + dev branch off origin/dev/0.1.7.
- Child 1 full pipeline (Codex, lead-1): shipped `a7135669`, archived `b86fbb6b`.
- Child 2 full pipeline (Claude, lead-2): 3 review rounds, 31 findings, 9 inverted
  tests restored, a destroyed-and-reconstructed `sessions.ts` verified on
  independent evidence. Shipped as 7 commits (`3b050663`..`4ec00140`, plus
  `1850d774` title fix and `6d806dbd` archive notes). Archived to
  `rasen/changes/archive/2026-08-06-store-planning-scope-routing/`.
- Children 3, 4 apply complete + gate green (uncommitted).
- Child 5 apply at 67/101 (uncommitted); child 6 proposal complete; child 7 pending.
- Scenario-drift detector written to the scratchpad (see Working set).
- Lessons + ship/archive gotchas written into `planning-context.md`.

Remaining (in order):
1. **Finish child 5 apply.** Read `rasen/changes/store-finalization-outcomes-v2/handoff/implementer-1.md`
   — sections 1–11 done, refusal lifted, real CLI finalization works end-to-end.
   Remaining: section 12's three surfaces (argv consumers 12.4/12.5, management
   finalize endpoint 12.6, parity test 12.7, CLI suite 12.8), the 8 named unit
   suites (3.8/4.8/5.7/6.8/7.7/8.8/9.8/10.7), and the journey updates. Dispatch
   a fresh opus implementer (cold — the prior agentIds are dead after the quota
   stop); seed it from the handoff doc + the change dir.
2. **Child 6 apply** (store-scoped-issues-management, 102 tasks, proposal done).
3. **Child 7 propose + apply** (store-v2-compat-hardening — no proposal yet).
4. **Deferred reviews** for children 3–7 serially (author ≠ verifier, opus), fix
   to clean, ship/archive each locally (sonnet).
5. **Parent integration gate**: full `pnpm test` + build + lint + `git diff --check`
   over the aggregate diff, then `rasen review`.
6. **Push + create ONE PR** against `dev/0.1.7` (requires user authorization).

## Key decisions (and why — do not re-litigate or silently reverse)

- **Runtime = Claude Code, not Codex.** The prior Codex agentIds
  (`/root/portfolio_planner`, `/root/scope_routing_*`) are unreachable from a
  Claude session and are retained only as authorship provenance for the
  author ≠ verifier invariant. Resume via fresh Claude subagents.
- **Model policy: ship/archive = sonnet, all else = opus.** User directive.
- **Child 3 §10b: legacy-flat Store `new`/`archive` write refusal was deferred
  out of child 2 into child 3**, where the migration remedy lives. Child 2 kept
  legacy writes working; child 3 restored the refusal beside `store migrate-layout`.
  Child 3's `tasks.md` §10b.1–10b.5 is the executable record. Do not move this back.
- **Child 4 CLI group = `rasen store workspace`**, not top-level `workspace`.
  `workspace` is a RETIRED command name kept dead by
  `test/commands/legacy-groups-removed.test.ts`; the top level already has
  work/workset/workflow; a workspace pair is inherently a Store concept. Internal
  vocabulary (Module, `WorkspacePairId`, planning-seam names) stays `workspace`.
  Both legacy-groups cases pass untouched — that is the proof the rename is done.
  `vocabulary-sweep.test.ts` was extended by enumerating all 31 `workspace_*`
  codes individually (no prefix rule) so a 32nd unexpected token still fails.
- **Child 2 corrected a false proposal claim that child 3 inherited:** a migrated
  Store regains *planning writes*, NOT archiving. Archiving arrives only via
  child 5. Child 3's journeys assert `store_v2_finalization_unavailable` BY NAME
  so they fail loudly when child 5 lands — updating them is designed-in work.
- **`sessions.ts` was reconstructed, not restored.** A `git checkout --` in child 2
  destroyed the uncommitted file; it was rebuilt from 4 sources. The space-identity
  filter residue is CLOSED on independent evidence (see
  `rasen/changes/archive/2026-08-06-store-planning-scope-routing/evidence/sessions-ts-reconstruction-verification.md`).
  Residues (b) comment wording and (c) untested behavior remain open by construction.
- **Only `landed` may update canonical specs.** `superseded`/`cancelled`/`abandoned`
  are passive history. Legacy Archives must never fabricate outcome/target-line/
  workspace-pair facts they cannot prove.
- **Children ship LOCAL (commit only); the portfolio pushes/creates the PR ONCE
  at parent level after ALL children complete.**
- **The original working tree (`OpenSpec-code`) is dirty with unrelated user work —
  do NOT edit, move, or clean it.** All implementation is in the worktree. A fresh
  session lands in the original repo by default and MUST re-enter the worktree
  (`EnterWorktree` with the path above) before any work.

## Dead ends & gotchas

- **Never `git checkout -- <file>` and never `git stash` in this worktree.** A
  `checkout --` destroyed uncommitted `sessions.ts` mid-child-2. The stash stack
  is shared across worktrees/sessions. Revert by editing.
- **NEW-12 build fingerprint is live** (`build.js`, `vitest.setup.ts`):
  `dist/.build-fingerprint.json` is written after a successful compile, and
  `ensureCliBuildFresh()` rebuilds only on a fingerprint mismatch. Concurrent
  vitest processes no longer destroy the shared `dist/`. First invocation after
  a source change compiles once; later ones print "dist/ matches the current
  sources; skipping build." `pnpm run build:if-stale` is the non-destructive entry.
- **Five test failures are ENVIRONMENTAL, not defects:** `config.test.ts` ×1 and
  `config-editor.test.ts` ×4. Cause: `%LOCALAPPDATA%\rasen` (the old-scheme
  Windows data home) is an ancestor of `os.tmpdir()`, so
  `findRepoPlanningRootSync` finds a `rasen/` dir above every fixture. PROVEN by
  controlled experiment (repoint TMP/TEMP off %LOCALAPPDATA% → 87/87 pass). NEVER
  "fix" these. Recorded as a separate-Change item for the user.
- **`tsc --noEmit` EXCLUDES `test/`**; ESLint is the only type-aware gate over
  test code. Combined with no `noUnusedLocals` and `no-unused-vars` disabled,
  the static gates over test/ are weak. Sweep by hand.
- **Archive engine traps** (full detail in `planning-context.md` "Ship and archive
  gotchas"): scenario titles in MODIFIED must byte-match canonical (archive refuses
  on mismatch; validate does NOT catch it); a pre-written `## Archive` heading in a
  ship log poisons the archive (`archive_recovery_required`); the engine leaves a
  trailing blank line at EOF that `git diff --check` rejects; archiving a NEW
  capability writes a placeholder Purpose (`TBD - created by archiving`) that fails
  `source-specs-normalization.test.ts` — grep must return empty after every archive.
- **`git commit -- <pathspec>` commits only named paths**; staged deletions of the
  pre-archive change dir are left in the index and need their own commit. Never use
  a broad `rasen/changes/` pathspec — this worktree holds sibling children's scaffolding.
- **Deltas apply at ARCHIVE time**, so a later child's canonical baseline is current
  canonical PLUS every earlier sibling's delta. Archive order is load-bearing —
  children MUST archive in DAG order. A drift check flagging a "missing" title may
  be correct-but-not-yet-shipped: grep the unshipped siblings before treating it as drift.
- **One surface is never proof for a repository-wide invariant.** When you touch a
  retirement/guard/refusal, grep the TOKEN across all of `test/`, not just the file
  you expect. Seen 3×: child 2 missed sibling call sites; child 3 swept CLI and
  missed the management API; child 4 verified one retirement pin and missed
  `vocabulary-sweep.test.ts`.
- **Never rewrite a test to match your code.** 9 inverted tests in child 2 passed
  CI and hid the worst defects. Verify each new test DISCRIMINATES (revert the fix,
  confirm that test and only that test fails).
- **Exercise the real CLI, not just the module.** Child 3's `apply` and child 4's
  `plan` both shipped broken because nothing executed them; real-CLI journeys found
  8+ defects instantly.
- **Inline heredocs with backticks break the shell** and mangle `\n` in string
  literals. Write patch scripts to the scratchpad and run by path.

## Eliminated hypotheses

- "Context compaction = handoff trigger" — RULED OUT (lead-1 bug, fixed). Compaction
  resolves in place; only genuine budget/recall degradation triggers handoff.
- "The fixer died and needs cold reconstruction" (child 2) — RULED OUT. Was alive;
  resumed. (Moot now — all Codex agents are dead post-quota-stop; cold-recreate
  Claude agents instead.)
- "Option (i): enforce legacy-flat write refusal in child 2 + rewrite 11 tests" —
  RULED OUT in favor of option (ii): defer to child 3 where the remedy lives.
  Rewriting 5 end-to-end journeys into "step one is refused" would have destroyed
  the only live gate over the externalized-planning product.

## Working set

Worktree (absolute): `E:/AI/ChatAI/Agents/VibeCodingProjects/workflow/Reference/OpenSpec-code-wt-store-project-planning-v2`

Committed (on branch, 7 commits since `b86fbb6b`): child 2 impl `3b050663`, child-1
Purpose fix `48ccbf85`, scenario-title restore `42d6625d`, archive `f08ebdf7`,
cleanup `4ec00140`, title-contradiction fix `1850d774`, archive-notes `6d806dbd`.

Uncommitted (children 3, 4, 5 — ~190 files): `src/core/store/{layout-migration,workspace,finalization}/**`,
`src/core/store-planning/**` (modified), `src/commands/{store-migrate-layout,store-target-line,workspace,store}.ts`,
`src/core/archive*.ts`, `src/core/session-runtime-context.ts`, `src/core/management-api/**`,
`src/core/templates/workflows/*.ts`, `test/**` (many new + modified), locales, plus
the child 3/4/5 change dirs under `rasen/changes/`.

Scenario-drift detector: `C:/Users/Sayo/AppData/Local/Temp/claude/E--AI-ChatAI-Agents-VibeCodingProjects-workflow-Reference-OpenSpec-code/71581ee2-b7af-44cb-a367-f4c5a1a05301/scratchpad/scenario-drift.mjs`
— run `node <path> <change-id>` before each archive. Positive-controlled against
child 2's pre-fix delta.

Key docs in the worktree:
- Design source: `docs/zh/store-project-partitions-and-planning-worktrees.md`
- Planning context (locked decisions, lessons, gotchas): `rasen/changes/store-project-partitions-planning-worktrees/planning-context.md`
- Portfolio run-state: `.rasen/changes/store-project-partitions-planning-worktrees/ephemera/portfolio-run.json`
- Child 5 active handoff: `rasen/changes/store-finalization-outcomes-v2/handoff/implementer-1.md`
- Child 5 report: `rasen/changes/store-finalization-outcomes-v2/evidence/implementation-report.md`

Build/test: `pnpm run build` before CLI tests; `pnpm exec vitest run <path>` for
focused; `pnpm test` for full suite (has 5 env failures — interpret selectively).

## Next action

1. Re-enter the worktree: `EnterWorktree` path `E:/AI/ChatAI/Agents/VibeCodingProjects/workflow/Reference/OpenSpec-code-wt-store-project-planning-v2`.
2. Dispatch a fresh opus implementer for **child 5** (`store-finalization-outcomes-v2`),
   seeded from `handoff/implementer-1.md` + the change dir. It lifts
   `store_v2_finalization_unavailable` (already done in sections 1–11) and must
   finish section 12's surfaces + the unit suites + the journey updates. Remind it:
   the three journeys asserting `store_v2_finalization_unavailable` BY NAME are
   designed to break when finalization lands — update them to assert real behavior,
   do not weaken them.
3. After child 5 apply completes, run the full-suite gate, then child 6 apply
   (proposal done, 102 tasks), then child 7 propose+apply.
4. Then the deferred reviews → ship/archive → parent gate → ONE PR.
