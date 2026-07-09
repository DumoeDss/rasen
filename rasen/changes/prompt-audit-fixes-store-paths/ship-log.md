# Ship Log: prompt-audit-fixes-store-paths

**Date:** 2026-07-09
**Mode:** local
**Branch:** main
**Commit:** (backfilled below)
**Status:** Committed (delivery deferred — portfolio delivers once at the end)

## What Shipped

Store-safe artifact path resolution fix (child #6, FINAL child of the `prompt-audit-fixes` portfolio): closes the externalization-proof subset of WF-3 (path hardcoding) plus WF-9, so archive/sync-specs/office-hours resolve their artifact paths from status JSON rather than assuming a repo-local `rasen/` layout.

1. **WF-9 — archive task-completion check reads via `artifactPaths`** (`archive-change.ts`, both getters, step 3): reads the tasks file from `artifactPaths.tasks.existingOutputPaths` in the status JSON rather than assuming a literal `tasks.md`, matching the same key `rasen-bulk-archive-change.ts` already uses.
2. **WF-3 T1 — main-spec compare resolves via `planningHome` sibling** (`archive-change.ts` step 4, `sync-specs.ts` steps 4b/4d, all getters): delta-spec-to-main-spec comparison resolves the main specs directory as the sibling of `planningHome.changesDir` from status JSON, not a literal repo-relative `rasen/specs/<capability>/spec.md` — in a registered store this correctly resolves to the store's own specs directory instead of the local repo's.
3. **WF-3 T4 — office-hours writer completes the WF-2 reader/writer symmetry** (`office-hours.ts`, Dual-Write step): both write paths (active-change and no-active-change cases) resolve from `changeRoot` / the `planningHome.changesDir` sibling rather than hardcoded paths, so the writer now agrees byte-for-byte with child #5's propose reader (`propose.ts:60-61`) — the WF-2 seam is closed symmetrically in both directions.
4. **Parity registry hash updates** (`skill-templates-parity.test.ts`): 6 function hashes + 3 content hashes for the affected sync-specs/archive-change/office-hours-command families.

Installed skills regenerated. Reviewer independently grepped the three regenerated `.claude/skills/*/SKILL.md` files and confirmed the resolution language is byte-consistent with the TS source.

## Two-Portfolio WF-3 Close-Out Note (important for the final portfolio report)

**WF-3 does NOT close entirely within this portfolio.** The original audit finding WF-3 covers three path-hardcoding tiers (T1/T2/T3/T4 in the design's numbering); this change deliberately ships only the **externalization-proof subset**: T1 (main-spec compare) and T4 (office-hours writer), plus the unrelated-but-grouped WF-9. **T3 (ephemera / workDir paths) is explicitly deferred to the separate, concurrently-running `externalize-artifacts-t3-workdir` session** — a different portfolio entirely, working on `src/core/working-set.ts` and the new `src/core/change-work.ts`. This was a deliberate scope decision (design alignment decision (b)), not an oversight: T3 touches files this portfolio doesn't own, and serializing behind the other session's in-flight work would have blocked this portfolio's completion for no benefit.

**Consequence for anyone reading the portfolio close-out:** "`prompt-audit-fixes` portfolio complete" does **not** mean "all of WF-3 landed." The T3 half of WF-3 is real, tracked, and lives in the `externalize-artifacts-t3-workdir` session's own scope — it will close there, not here. This ship-log entry is the record of that split so it isn't lost between the two efforts.

**Time-sensitivity / serialization note:** this change also deliberately shipped promptly (ahead of a natural pause point) specifically to win a file-level race: the `externalize-artifacts-t3-workdir` session has planned read-side edits to `archive-change.ts` (the same file this change edits, in non-overlapping regions — steps 3/4 here vs. the file's other sections there) but had **not yet applied them** at ship time. Landing first here means that session rebases trivially against a small, already-known diff instead of the two changes needing to be reconciled after the fact. Confirmed via reviewer's finding T-1 and the diff review above: only steps 3 and 4 of `archive-change.ts` were touched in each getter; steps 3.5/3.6 (added by child #5) are byte-untouched by this diff.

## Review Outcome

Review, first pass, verdict **CLEAN** — 0 Blocker / 0 Major / 0 Minor / 1 Trivial (informational only).

**1 Trivial, informational, no action needed:** tasks.md's own task 5.1 asserted that `git status --porcelain -- src/core/templates/workflows/ src/core/` "must show ONLY archive-change.ts, sync-specs.ts, office-hours.ts" — but the shared working tree also shows `M src/core/working-set.ts` and `?? src/core/change-work.ts`. Both are confirmed to belong to the concurrent `externalize-artifacts-t3-workdir` session's own runtime surface (workDir helpers), not this change. Not a scope breach — the task's literal wording was simply stale against a working tree shared with another active session. This is the same coordination flag noted above, not a new issue.

The reviewer's core-risk check (resolution-semantics correctness) confirmed: the "specs/ sibling of changesDir" idiom used here matches the pattern child #5's propose reader already established (`propose.ts:61`) — not invented fresh; `PlanningHomeSummary` exposes `changesDir` but no dedicated `specsDir`, so anchoring on the changesDir sibling is the correct available handle in both repo-local and store modes.

## Test Gate

- Tests: ran green — `npx vitest run test/core/templates/` -> 6/6 passed, re-run at ship time (matches reviewer's independent run).

## Pre-Flight Results

- Verification: pass (review-report.md + auto-run.json, verdict CLEAN)
- Tasks: 11/11 complete (tasks.md)

## Delivery

Local mode: committed only, no push, no PR. This is child #6, the FINAL child of the `prompt-audit-fixes` portfolio; delivery happens once at the portfolio/parent level after all children complete, per the user's decision.
