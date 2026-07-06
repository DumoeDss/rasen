# Ship Log: remove-gstack-parallel-lifecycle

**Date:** 2026-07-07
**Branch:** dev-harness
**Repo convention:** ship = commit + push directly to `origin dev-harness` (fork's long-lived work branch). No PR, no merge.
**Commit:** `8d6ae87` (pushed `3793c5f..8d6ae87`)
**Status:** Shipped

## Pre-Flight Results

- Review report: present (`review-report.md`), verdict **APPROVE** — 0 Blocker/Major/Minor, 2 accepted Trivials.
- Tasks: all complete (`tasks.md`, sections 1-7, including the LEAD-directed section-7 dead-pointer extension).
- Git status before staging: 73 changed paths (source deletions/modifications, `skills/gstack/<name>/` deletions, regenerated `SKILL.md` files) + 1 untracked change directory. No `.claude/skills` installed-side diff to stage — `.claude/` is fully gitignored in this repo (`.gitignore:145`), so nothing there is tracked.

## Gate Results

| Gate | Result |
|---|---|
| `pnpm build` (tsc) | PASS — clean compile, 20 gstack docs regenerated |
| `bun run skill:check` (fresh run, this session) | PASS — FRESH for all 20 generated `SKILL.md` |
| `openspec validate remove-gstack-parallel-lifecycle --strict --json` | PASS — 1/1 valid, 0 issues |
| `openspec config list` (pollution check) | PASS — 18 workflows listed (`propose, explore, new, continue, apply, ff, sync, archive, bulk-archive, verify, onboard, office-hours-command, verify-enhanced-command, ship-command, retro-command, auto-command, review-cycle, handoff`), profile `custom`/delivery `both` explicit, no removed-skill residue |
| `pnpm test` (full suite) | 1 file failed on first run: `test/commands/workset.test.ts` — `Test timed out in 10000ms` + `EPERM, Permission denied` on `%TEMP%\openspec-workset-*`. This file is **untouched** by this change (workset command, unrelated to gstack skills) and matches the pre-declared Windows temp-dir flake signature. **Isolated re-run: 41/41 tests PASS** (`pnpm vitest run test/commands/workset.test.ts`, 44s). Gate treated as passed per repo convention (untouched-file flake, green in isolation). All other files: 114/115 passed on the full run, remaining 2075/2098 individual tests green. |

## Commit

Staged all 82 changed/added/deleted paths (`git add -A` over the full diff, excluding the not-yet-written ship-log) in a single commit:

```
8d6ae87 refactor(gstack)!: remove parallel-lifecycle experts, absorb ship/retro into opsx workflows
82 files changed, 884 insertions(+), 11041 deletions(-)
```

Includes: 10 gstack expert `.ts` deletions, 18 `skills/gstack/<name>/` file deletions (9 experts x SKILL.md + SKILL.md.tmpl, `autoplan` had no separate delete count issue — all ten dirs' generated+tmpl files removed), wiring edits (`experts/index.ts`, `skill-templates.ts`, `skill-generation.ts`), workflow absorption (`ship.ts`, `retro.ts`), curated-list/doc edits (`skill-check.ts`, `AGENTS.md`, `ARCHITECTURE.md`, `gen-skill-docs.ts`, tmpl stragglers, `docs/opsx-workflow-guide.md`, `docs/zh/gen-skill-docs.md`), test count updates (`skill-generation.test.ts`), regenerated `SKILL.md` files, and the 12-file change-artifact set (`proposal.md`, `design.md`, `tasks.md`, `planning-context.md`, `review-report.md`, 5 delta specs, `.openspec.yaml`).

## Push

```
git push origin dev-harness
To https://github.com/DumoeDss/OpenSpec.git
   3793c5f..8d6ae87  dev-harness -> dev-harness
```

No force-push. No other branches touched. No PR created (per repo convention — dev-harness is pushed directly).

## Next Steps

- `/opsx:retro` for a retrospective on this change.
- `/opsx:archive` to archive `remove-gstack-parallel-lifecycle`.
- Step two of the two-step plan (`fuse-methodology-into-opsx`) audits the remaining 20 experts for logic worth fusing into the OPSX workflow — out of scope for this change.
