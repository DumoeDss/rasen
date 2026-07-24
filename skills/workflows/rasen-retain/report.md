# Retention: report branch

Engineering retrospective — analyze what shipped, patterns, and learnings. This
is the `report` branch of `rasen-retain`. It preserves the retrospective
reporting contract unchanged; it never creates, updates, promotes, or retires a
learned skill.

Supports three scopes: change-scoped, general, and global. Reports are written to
the same paths as before.

## Steps

### 1. Determine Scope

- A change name (from the pipeline or `rasen-retro <change-name>`) → **Change-scoped**: analyze that change.
- No change name → prompt the user to select: change-scoped (pick a change) or general.
- `global` → **Global**: cross-project retrospective.

### 2A. Change-Scoped Report

Read all available artifacts:

**Planning Artifacts** (the change directory — `changeRoot` from status JSON):
- `proposal.md` — what was planned
- `design.md` — how it was designed
- `tasks.md` — task breakdown and completion status
- `specs/` — delta specifications
- `office-hours-design.md` — product validation session

**Outcome Artifacts** (the work directory — `workDir` from status JSON; fall back to the change directory when `workDir` is absent or a file already lives there — legacy fallback):
- `review-report.md` — code review findings
- `qa-report.md` — QA findings
- `cso-report.md` — security audit findings
- `ship-log.md` — shipping details (PR URL, deploy status)

**Analysis:**
- Correlate planning vs outcome: did we build what we planned?
- Task completion rate and timeline
- Review iteration count (how many rounds of review?)
- Issues found during verification vs issues found in production
- Note which artifacts were missing and what analysis was skipped

### 2B. General Report

Run a self-contained git-analysis contract over recent repository activity (default window: last 7 days; accept an explicit window like `24h`, `14d`, `30d`). Detect the repo's default branch first (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`, fall back to `main`) and analyze `origin/<default>`.

**Gather (run these git queries):**
- Commits with author, timestamp, and per-commit stat: `git log origin/<default> --since="<window>" --format="%H|%aN|%ae|%ai|%s" --shortstat`
- Per-commit numstat for LOC and test-vs-production split (test files match `test/|spec/|__tests__/`): `git log origin/<default> --since="<window>" --format="COMMIT:%H|%aN" --numstat`
- File hotspots: `git log origin/<default> --since="<window>" --format="" --name-only | grep -v '^$' | sort | uniq -c | sort -rn`
- Per-author commit counts: `git shortlog origin/<default> --since="<window>" -sn --no-merges`
- Streak (consecutive days with ≥1 commit, counted back from today): `git log origin/<default> --format="%ad" --date=format:"%Y-%m-%d" | sort -u`

**Compute:**
- The metrics table (commits, contributors, insertions/deletions, net LOC, test LOC ratio, active days, streak)
- A **per-author leaderboard** sorted by commits descending (contributor, commits, +/-, top area), with the current user (`git config user.name`) listed first as "You (name)"
- Commit-type mix (feat/fix/refactor/test/chore/docs), hotspot list, and any notable patterns (peak hours, churn, high fix ratio)

Use all timestamps in the user's local timezone. If the window has zero commits, say so and suggest a different window.

### 2C. Global Report

Run the same git-analysis contract as 2B, but across every accessible repository (cross-project):
- For each repo the user has configured or that is reachable, gather the same commit/author/LOC/hotspot/streak data
- Aggregate shipping streaks and work patterns across projects and compare productivity between them
- If only the current repo is accessible, note that and report it as a single-project global report

Do NOT persist legacy `.context/retros/*.json` snapshots or run history-compare against them — write only to Rasen's own report path (Step 4).

### 3. Generate Report

**Change-scoped report structure:**

```markdown
# Retro: <change-name>

**Date:** <date>
**Scope:** Change-scoped
**Change:** <change-name>

## What Went Well
- <positive observation 1>
- <positive observation 2>

## What Could Improve
- <improvement area 1>
- <improvement area 2>

## Key Metrics
- Time from proposal to ship: <duration>
- Tasks: <completed>/<total>
- Review iterations: <count>
- Verification issues found: <count>

## Actionable Takeaways
1. <takeaway 1>
2. <takeaway 2>
3. <takeaway 3>
```

**General / Global report structure:**

```markdown
# Retro: Weekly Summary

**Date:** <date>
**Scope:** General
**Period:** <start> to <end>

## Metrics
| Metric | Value |
|--------|-------|
| Commits | <count> |
| Contributors | <count> |
| Net LOC | +<ins>/-<del> |
| Test LOC ratio | <pct>% |
| Active days | <count> |
| Streak | <days> consecutive days |

## Per-Author Leaderboard
| Contributor | Commits | +/- | Top area |
|-------------|---------|-----|----------|
| You (<name>) | <n> | +<ins>/-<del> | <dir> |
| <author> | <n> | +<ins>/-<del> | <dir> |

## Patterns Observed
- <pattern 1: commit-type mix, peak hours, hotspots>
- <pattern 2>

## Improvement Suggestions
1. <suggestion 1>
2. <suggestion 2>
3. <suggestion 3>
```

### 4. Write Report

**Change-scoped:** Write to `rasen/changes/<name>/retro.md`

**General:** Write to `rasen/retro-latest.md`

**Global:** Write to `rasen/retro-global-latest.md`

### 5. Display Summary

After writing the report:
- Display the full report to the user
- Highlight the **top 3 actionable takeaways**
- Suggest next steps based on findings

## Integration Notes

- Change-scoped report mode is most valuable after `rasen-ship` completes and before `rasen-archive-change`.
- The change-scoped `retro.md` is archived with the rest of the change; archive does not generate a second report.
- General report mode can be run weekly as a habit — suggest it proactively at the end of a work week.
