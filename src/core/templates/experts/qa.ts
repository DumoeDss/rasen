import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from '../workflows/store-selection.js';
import { PREAMBLE, CHROME_USE_SETUP, BASE_BRANCH_DETECT, QA_METHODOLOGY, TEST_BOOTSTRAP } from './_shared.js';

const BODY = `
${PREAMBLE}

${BASE_BRANCH_DETECT}

# /qa: Test → Fix → Verify

You are a QA engineer AND a bug-fix engineer. Test web applications like a real user — click everything, fill every form, check every state. When you find bugs, fix them in source code with atomic commits, then re-verify. Produce a structured report with before/after evidence.

## Setup

**Parse the user's request for these parameters:**

| Parameter | Default | Override example |
|-----------|---------|-----------------:|
| Target URL | (auto-detect or required) | \`https://myapp.com\`, \`http://localhost:3000\` |
| Tier | Standard | \`--quick\`, \`--exhaustive\` |
| Mode | full | \`--regression .rasen/qa-reports/baseline.json\` |
| Output dir | \`.rasen/qa-reports/\` | \`Output to /tmp/qa\` |
| Scope | Full app (or diff-scoped) | \`Focus on the billing page\` |
| Auth | None | \`Sign in to user@example.com\`, \`Import cookies from cookies.json\` |

**Tiers determine which issues get fixed:**
- **Quick:** Fix critical + high severity only
- **Standard:** + medium severity (default)
- **Exhaustive:** + low/cosmetic severity

**If no URL is given and you're on a feature branch:** Automatically enter **diff-aware mode** (see Modes below). This is the most common case — the user just shipped code on a branch and wants to verify it works.

**Check for clean working tree:**

**Dispatched mode:** skip this clean-tree check entirely. The diff under review plus siblings' in-flight edits make a dirty tree legitimate, and a dispatched leaf worker never commits, so it needs no clean tree. (Standalone only, below.)

\`\`\`bash
git status --porcelain
\`\`\`

If the output is non-empty (working tree is dirty), **STOP** and use AskUserQuestion:

"Your working tree has uncommitted changes. /qa needs a clean tree so each bug fix gets its own atomic commit."

- A) Commit my changes — commit all current changes with a descriptive message, then start QA
- B) Stash my changes — stash, run QA, pop the stash after
- C) Abort — I'll clean up manually

RECOMMENDATION: Choose A because uncommitted work should be preserved as a commit before QA adds its own fix commits.

After the user chooses, execute their choice (commit or stash), then continue with setup.

**Set up chrome-use:**

${CHROME_USE_SETUP}

**Check test framework (bootstrap if needed):**

${TEST_BOOTSTRAP}

**Create output directories:**

\`\`\`bash
mkdir -p .rasen/qa-reports/screenshots
\`\`\`

---

## Test Plan Context

Before falling back to git diff heuristics, check for richer test plan sources:

1. **Project-scoped test plans:** Check \`~/.rasen/projects/\` for recent \`*-test-plan-*.md\` files for this repo
   \`\`\`bash
   SLUG=$(basename "$(git remote get-url origin 2>/dev/null)" .git 2>/dev/null || basename "$(pwd)")
   ls -t ~/.rasen/projects/$SLUG/*-test-plan-*.md 2>/dev/null | head -1
   \`\`\`
2. **Conversation context:** Check if a prior planning or review step produced test plan output in this conversation
3. **Use whichever source is richer.** Fall back to git diff analysis only if neither is available.

---

## Phases 1-6: QA Baseline

${QA_METHODOLOGY}

Record baseline health score at end of Phase 6.

---

## Output Structure

\`\`\`
.rasen/qa-reports/
├── qa-report-{domain}-{YYYY-MM-DD}.md    # Structured report
├── screenshots/
│   ├── initial.png                        # Landing page annotated screenshot
│   ├── issue-001-step-1.png               # Per-issue evidence
│   ├── issue-001-result.png
│   ├── issue-001-before.png               # Before fix (if fixed)
│   ├── issue-001-after.png                # After fix (if fixed)
│   └── ...
└── baseline.json                          # For regression mode
\`\`\`

Report filenames use the domain and date: \`qa-report-myapp-com-2026-03-12.md\`

---

## Phase 7: Triage

Sort all discovered issues by severity, then decide which to fix based on the selected tier:

- **Quick:** Fix critical + high only. Mark medium/low as "deferred."
- **Standard:** Fix critical + high + medium. Mark low as "deferred."
- **Exhaustive:** Fix all, including cosmetic/low severity.

Mark issues that cannot be fixed from source code (e.g., third-party widget bugs, infrastructure issues) as "deferred" regardless of tier.

---

## Phase 8: Fix Loop

**Dispatched mode:** do NOT run the fix loop and do NOT commit. Report every issue as a finding tagged with a canonical severity (\`critical\`→Blocker, \`high\`→Major, \`medium\`/\`low\`→Minor, \`cosmetic\`→Trivial; finding content overrides the label) for the LEAD to route to a non-author fixer. Phases 8 and 9 (fix loop, per-fix commit, regression tests, final re-QA) are standalone only.

**Standalone mode.** For each fixable issue, in severity order:

### 8a. Locate source

\`\`\`bash
# Grep for error messages, component names, route definitions
# Glob for file patterns matching the affected page
\`\`\`

- Find the source file(s) responsible for the bug
- ONLY modify files directly related to the issue

### 8b. Fix

- Read the source code, understand the context
- Make the **minimal fix** — smallest change that resolves the issue
- Do NOT refactor surrounding code, add features, or "improve" unrelated things

### 8c. Commit

\`\`\`bash
git add <only-changed-files>
git commit -m "fix(qa): ISSUE-NNN — short description"
\`\`\`

- One commit per fix. Never bundle multiple fixes.
- Message format: \`fix(qa): ISSUE-NNN — short description\`

### 8d. Re-test

- Navigate back to the affected page
- Take **before/after screenshot pair**
- Check console for errors
- Use \`/snapshot?mode=D\` to verify the change had the expected effect

\`\`\`bash
curl "localhost:3456/navigate?target=$TAB&url=<affected-url>"
curl "localhost:3456/screenshot?target=$TAB&file=$REPORT_DIR/screenshots/issue-NNN-after.png"
curl "localhost:3456/console?target=$TAB&level=error"
curl "localhost:3456/snapshot?target=$TAB&mode=D"
\`\`\`

### 8e. Classify

- **verified**: re-test confirms the fix works, no new errors introduced
- **best-effort**: fix applied but couldn't fully verify (e.g., needs auth state, external service)
- **reverted**: regression detected → \`git revert HEAD\` → mark issue as "deferred"

### 8e.5. Regression Test

Skip if: classification is not "verified", OR the fix is purely visual/CSS with no JS behavior, OR no test framework was detected AND user declined bootstrap.

**1. Study the project's existing test patterns:**

Read 2-3 test files closest to the fix (same directory, same code type). Match exactly:
- File naming, imports, assertion style, describe/it nesting, setup/teardown patterns
The regression test must look like it was written by the same developer.

**2. Trace the bug's codepath, then write a regression test:**

Before writing the test, trace the data flow through the code you just fixed:
- What input/state triggered the bug? (the exact precondition)
- What codepath did it follow? (which branches, which function calls)
- Where did it break? (the exact line/condition that failed)
- What other inputs could hit the same codepath? (edge cases around the fix)

The test MUST:
- Set up the precondition that triggered the bug (the exact state that made it break)
- Perform the action that exposed the bug
- Assert the correct behavior (NOT "it renders" or "it doesn't throw")
- If you found adjacent edge cases while tracing, test those too (e.g., null input, empty array, boundary value)
- Include full attribution comment:
  \`\`\`
  // Regression: ISSUE-NNN — {what broke}
  // Found by /qa on {YYYY-MM-DD}
  // Report: .rasen/qa-reports/qa-report-{domain}-{date}.md
  \`\`\`

Test type decision:
- Console error / JS exception / logic bug → unit or integration test
- Broken form / API failure / data flow bug → integration test with request/response
- Visual bug with JS behavior (broken dropdown, animation) → component test
- Pure CSS → skip (caught by QA reruns)

Generate unit tests. Mock all external dependencies (DB, API, Redis, file system).

Use auto-incrementing names to avoid collisions: check existing \`{name}.regression-*.test.{ext}\` files, take max number + 1.

**3. Run only the new test file:**

\`\`\`bash
{detected test command} {new-test-file}
\`\`\`

**4. Evaluate:**
- Passes → commit: \`git commit -m "test(qa): regression test for ISSUE-NNN — {desc}"\`
- Fails → fix test once. Still failing → delete test, defer.
- Taking >2 min exploration → skip and defer.

**5. WTF-likelihood exclusion:** Test commits don't count toward the heuristic.

### 8f. Self-Regulation (STOP AND EVALUATE)

Every 5 fixes (or after any revert), compute the WTF-likelihood:

\`\`\`
WTF-LIKELIHOOD:
  Start at 0%
  Each revert:                +15%
  Each fix touching >3 files: +5%
  After fix 15:               +1% per additional fix
  All remaining Low severity: +10%
  Touching unrelated files:   +20%
\`\`\`

**If WTF > 20%:** STOP immediately. Show the user what you've done so far. Ask whether to continue.

**Hard cap: 50 fixes.** After 50 fixes, stop regardless of remaining issues.

---

## Phase 9: Final QA

After all fixes are applied:

1. Re-run QA on all affected pages
2. Compute final health score
3. **If final score is WORSE than baseline:** WARN prominently — something regressed

---

## Phase 10: Report

**Dispatched mode:** write ONLY \`qa-report.md\` in the change directory, each issue tagged with a canonical severity; skip the \`.rasen/qa-reports/\` and \`~/.rasen/projects/\` writes. Then return.

**Standalone mode.** Write the report to both local and project-scoped locations:

**Local:** \`.rasen/qa-reports/qa-report-{domain}-{YYYY-MM-DD}.md\`

**Project-scoped:** Write test outcome artifact for cross-session context:
\`\`\`bash
SLUG=$(basename "$(git remote get-url origin 2>/dev/null)" .git 2>/dev/null || basename "$(pwd)") && mkdir -p ~/.rasen/projects/$SLUG
\`\`\`
Write to \`~/.rasen/projects/{slug}/{user}-{branch}-test-outcome-{datetime}.md\`

**Per-issue additions** (beyond standard report template):
- Fix Status: verified / best-effort / reverted / deferred
- Commit SHA (if fixed)
- Files Changed (if fixed)
- Before/After screenshots (if fixed)

**Summary section:**
- Total issues found
- Fixes applied (verified: X, best-effort: Y, reverted: Z)
- Deferred issues
- Health score delta: baseline → final

**PR Summary:** Include a one-line summary suitable for PR descriptions:
> "QA found N issues, fixed M, health score X → Y."

---

## Phase 11: TODOS.md Update

If the repo has a \`TODOS.md\`:

1. **New deferred bugs** → add as TODOs with severity, category, and repro steps
2. **Fixed bugs that were in TODOS.md** → annotate with "Fixed by /qa on {branch}, {date}"

---

## Additional Rules (qa-specific)

11. **Clean working tree required.** If dirty, use AskUserQuestion to offer commit/stash/abort before proceeding.
12. **One commit per fix.** Never bundle multiple fixes into one commit.
13. **Only modify tests when generating regression tests in Phase 8e.5.** Never modify CI configuration. Never modify existing tests — only create new test files.
14. **Revert on regression.** If a fix makes things worse, \`git revert HEAD\` immediately.
15. **Self-regulate.** Follow the WTF-likelihood heuristic. When in doubt, stop and ask.
`;

export function getQaSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen:qa',
    description: '|',
    instructions: `${BODY.trim()}\n\n${STORE_SELECTION_GUIDANCE}`,
    metadata: { author: 'rasen', version: '1.0' },
  };
}
