/**
 * Verify-Enhanced Rasen Workflow Command
 *
 * Enhanced verification combining Rasen artifact consistency checks
 * with gstack expert reviews (code review, security, QA, design review).
 * Auto-scales review depth based on change scope.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

const VERIFY_ENHANCED_INSTRUCTIONS = `Enhanced verification — combines Rasen completeness/correctness/consistency checks with expert reviews.

${STORE_SELECTION_GUIDANCE}

Automatically adjusts review depth based on task size. Reports saved to the change's work directory (fallback: the change directory).

## When to Use

Use when: "verify", "review", "check my code", "run tests", "QA", "verify the change", "does it look right?".

## Steps

### 1. Select the Change

If a change name is provided, use it. Otherwise:
- Infer from conversation context
- Auto-select if only one active change exists
- If ambiguous, run \`rasen list --json\` and prompt for selection

### 2. Classify Change Scope

Determine verification depth by analyzing the change:

| Scope | Criteria | Pipeline |
|-------|----------|----------|
| **Full** | Multi-file changes, UI components, significant scope | artifact checks + /review + /cso (if security) + /qa + /design-review (if UI) |
| **Standard** | Small single-purpose feature | artifact checks + /review + conditional /cso + /qa-only |
| **Light** | Bug fix, minimal scope | artifact checks + /review only |

**Inputs for classification:**
- Number of files changed (check with \`git diff --stat\`)
- Presence of UI components (check for .tsx/.jsx/.vue/.svelte files in diff)
- Proposal scope description (read proposal.md if exists)
- Task count from tasks.md

Display the classification and allow user override.

### 3. Run Rasen Artifact Consistency Checks

\`\`\`bash
rasen status --change "<name>" --json
\`\`\`

Verify:
- All required artifacts exist and are complete
- Tasks in tasks.md match the implementation scope
- Proposal, design, and specs are consistent with each other

Report any inconsistencies found.

### 4. Run Expert Reviews Based on Scope

**Full scope:**
1. Invoke \`/review\` — adversarial code review with auto-scaled depth + test coverage audit
2. If security-relevant (touches auth, input validation, crypto, data handling): invoke \`/cso\` — security audit
3. Invoke \`/qa\` — browser-based quality assurance testing
4. If UI change: invoke \`/design-review\` — visual audit + auto-fix suggestions

**Standard scope:**
1. Invoke \`/review\` — code review
2. If security-relevant: invoke \`/cso\` — security audit
3. Invoke \`/qa-only\` — abbreviated QA check (no browser)

**Light scope:**
1. Invoke \`/review\` — code review only

### 5. Save Reports

Write reports to the change's work directory (resolve \`workDir\` from \`rasen status --change <name> --json\`; fall back to the change directory when it is absent or a report already lives there):
- \`review-report.md\` — code review findings
- \`cso-report.md\` — security audit (if /cso ran)
- \`qa-report.md\` — QA findings (if /qa ran)
- \`design-review-report.md\` — design review (if /design-review ran)

**Canonical verdict + status line.** Map every finding across the stages onto the canonical Blocker/Major/Minor/Trivial scale defined by the \`canonical-severity-vocabulary\` in the expert PREAMBLE (reference it; do NOT re-define the scale): a Critical Issue / a stage FAIL on a blocking check → **Blocker**; a Warning → **Major**; a nice-to-fix → **Minor** or **Trivial**. Per-stage PASS/FAIL stays as a display aid in the summary below. Emit ONE machine-checkable status line into the reports you write and the conversation:

\`\`\`
VERIFY VERDICT: <CLEAN|BLOCKED> — Blocker:<n> Major:<n> Minor:<n> Trivial:<n>
\`\`\`

The verdict is **CLEAN if and only if no Blocker and no Major is open** (the review-cycle termination invariant); otherwise **BLOCKED**. This standardizes the vocabulary and the pass rule only; it does not by itself enforce an archive refusal.

**Test-evidence block (only when tests ran).** If verification executed the project's test or gate suite, record a fingerprinted test-evidence block into the report(s) so \`/rasen:ship\`'s evidence-based test-skip gate can honor it — the same schema \`review-cycle-report.md\` records:

\`\`\`
TEST EVIDENCE
- command: <exact command(s) run>
- result: pass | fail
- tree: <git rev-parse HEAD^{tree}>
\`\`\`

If no test/gate suite was run, write no test-evidence block — ship then correctly re-runs (it skips on proof, never on hope).

### 6. Consolidated Summary

Display a summary with pass/fail status for each stage:

\`\`\`
## Verification Complete: <change-name>

**Scope:** Full | Standard | Light

| Stage | Status | Issues |
|-------|--------|--------|
| Artifact Consistency | PASS/FAIL | <count> |
| Code Review (/review) | PASS/FAIL | <count> |
| Security (/cso) | PASS/FAIL | <count> |
| QA (/qa) | PASS/FAIL | <count> |
| Design Review | PASS/FAIL | <count> |

### Critical Issues (must fix before shipping)
- <issue 1>
- <issue 2>

### Warnings (recommended to fix)
- <warning 1>

### Reports
- review-report.md
- cso-report.md (if applicable)
- qa-report.md (if applicable)
\`\`\`

## Integration Notes

- This command coexists with the original \`rasen-verify-change\` skill (pure artifact consistency check)
- The enhanced version adds expert review layers on top of artifact checks
- Reports written to the work directory are consumed by \`/rasen:retro\` and \`/rasen:archive\`
- \`/rasen:ship\` checks for verification reports before proceeding`;

export function getVerifyEnhancedSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-verify-enhanced',
    description: 'Enhanced verification — artifact checks + code review + security audit + browser QA + visual audit. Auto-scales by change size.',
    instructions: VERIFY_ENHANCED_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires rasen CLI.',
    metadata: { author: 'rasen', version: '1.0' },
  };
}

export function getOpsxVerifyEnhancedCommandTemplate(): CommandTemplate {
  return {
    name: 'Rasen: Verify Enhanced',
    description: 'Enhanced verification — artifact checks + code review + security audit + browser QA + visual audit',
    category: 'Workflow',
    tags: ['workflow', 'verification', 'review', 'security', 'qa'],
    content: VERIFY_ENHANCED_INSTRUCTIONS,
  };
}
