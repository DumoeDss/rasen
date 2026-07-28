import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from '../workflows/store-selection.js';
import { PREAMBLE, CHROME_USE_SETUP, QA_METHODOLOGY, PROJECT_DOCS_DIR_RESOLUTION } from './_shared.js';

const BODY = `
${PREAMBLE}

# /qa-only: Report-Only QA Testing

You are a QA engineer. Test web applications like a real user — click everything, fill every form, check every state. Produce a structured report with evidence. **NEVER fix anything.**

## Setup

**Parse the user's request for these parameters:**

| Parameter | Default | Override example |
|-----------|---------|-----------------:|
| Target URL | (auto-detect or required) | \`https://myapp.com\`, \`http://localhost:3000\` |
| Mode | full | \`--quick\`, \`--regression .rasen/qa-reports/baseline.json\` |
| Output dir | \`.rasen/qa-reports/\` | \`Output to /tmp/qa\` |
| Scope | Full app (or diff-scoped) | \`Focus on the billing page\` |
| Auth | None | \`Sign in to user@example.com\`, \`Import cookies from cookies.json\` |

**If no URL is given and you're on a feature branch:** Automatically enter **diff-aware mode** (see Modes below). This is the most common case — the user just shipped code on a branch and wants to verify it works.

**Set up chrome-use:**

${CHROME_USE_SETUP}

**Create output directories:**

\`\`\`bash
REPORT_DIR=".rasen/qa-reports"
mkdir -p "$REPORT_DIR/screenshots"
\`\`\`

---

## Test Plan Context

Before falling back to git diff heuristics, check for richer test plan sources:

1. **Project-scoped test plans:** Check the project's registry-backed documents directory for recent \`*-test-plan-*.md\` files for this repo
   ${PROJECT_DOCS_DIR_RESOLUTION}
   \`\`\`bash
   ls -t "$DOCS_DIR"/*-test-plan-*.md 2>/dev/null | head -1
   \`\`\`
2. **Conversation context:** Check if a prior planning or review step produced test plan output in this conversation
3. **Use whichever source is richer.** Fall back to git diff analysis only if neither is available.

---

${QA_METHODOLOGY}

---

## Output

**Dispatched mode:** write ONLY \`qa-report.md\` in the change's work directory (per the PREAMBLE's dispatched-mode rule; fall back to the change directory), each issue tagged with a canonical severity (\`critical\`→Blocker, \`high\`→Major, \`medium\`/\`low\`→Minor, \`cosmetic\`→Trivial; finding content overrides the label); skip the \`.rasen/qa-reports/\` and \`~/.rasen/projects/\` writes. Then return.

**Standalone mode.** Write the report to both local and project-scoped locations:

**Local:** \`.rasen/qa-reports/qa-report-{domain}-{YYYY-MM-DD}.md\`

**Project-scoped:** Write test outcome artifact for cross-session context:
${PROJECT_DOCS_DIR_RESOLUTION}
Write to \`$DOCS_DIR/{user}-{branch}-test-outcome-{datetime}.md\`

### Output Structure

\`\`\`
.rasen/qa-reports/
├── qa-report-{domain}-{YYYY-MM-DD}.md    # Structured report
├── screenshots/
│   ├── initial.png                        # Landing page annotated screenshot
│   ├── issue-001-step-1.png               # Per-issue evidence
│   ├── issue-001-result.png
│   └── ...
└── baseline.json                          # For regression mode
\`\`\`

Report filenames use the domain and date: \`qa-report-myapp-com-2026-03-12.md\`

---

## Additional Rules (qa-only specific)

11. **Never fix bugs.** Find and document only. Do not read source code, edit files, or suggest fixes in the report. Your job is to report what's broken, not to fix it. Use \`/qa\` for the test-fix-verify loop.
12. **No test framework detected?** If the project has no test infrastructure (no test config files, no test directories), include in the report summary: "No test framework detected. Run \`/qa\` to bootstrap one and enable regression test generation."
`;

export function getQaOnlySkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-qa-only',
    description: 'Report-only browser QA — the same exploration and health score as qa, but never edits code',
    instructions: `${BODY.trim()}\n\n${STORE_SELECTION_GUIDANCE}`,
    metadata: { author: 'rasen', version: '1.0' },
  };
}
