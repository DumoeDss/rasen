/**
 * Verify-Enhanced OPSX Workflow Command
 *
 * Enhanced verification combining OpenSpec artifact consistency checks
 * with gstack expert reviews (code review, security, QA, design review).
 * Auto-scales review depth based on change scope.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

const VERIFY_ENHANCED_INSTRUCTIONS = `Enhanced verification — combines OpenSpec completeness/correctness/consistency checks with expert reviews.

${STORE_SELECTION_GUIDANCE}

Automatically adjusts review depth based on task size. Reports saved to the OpenSpec change directory.

## When to Use

Use when: "verify", "review", "check my code", "run tests", "QA", "verify the change", "does it look right?".

## Steps

### 1. Select the Change

If a change name is provided, use it. Otherwise:
- Infer from conversation context
- Auto-select if only one active change exists
- If ambiguous, run \`openspec list --json\` and prompt for selection

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

### 3. Run OpenSpec Artifact Consistency Checks

\`\`\`bash
openspec status --change "<name>" --json
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

Write reports to the change directory:
- \`openspec/changes/<name>/review-report.md\` — code review findings
- \`openspec/changes/<name>/cso-report.md\` — security audit (if /cso ran)
- \`openspec/changes/<name>/qa-report.md\` — QA findings (if /qa ran)
- \`openspec/changes/<name>/design-review-report.md\` — design review (if /design-review ran)

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

- This command coexists with the original \`openspec-verify-change\` skill (pure artifact consistency check)
- The enhanced version adds expert review layers on top of artifact checks
- Reports written to the change directory are consumed by \`/opsx:retro\` and \`/opsx:archive\`
- \`/opsx:ship\` checks for verification reports before proceeding`;

export function getVerifyEnhancedSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-verify-enhanced',
    description: 'Enhanced verification — artifact checks + code review + security audit + browser QA + visual audit. Auto-scales by change size.',
    instructions: VERIFY_ENHANCED_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires openspec CLI.',
    metadata: { author: 'openspec', version: '1.0' },
  };
}

export function getOpsxVerifyEnhancedCommandTemplate(): CommandTemplate {
  return {
    name: 'OPSX: Verify Enhanced',
    description: 'Enhanced verification — artifact checks + code review + security audit + browser QA + visual audit',
    category: 'Workflow',
    tags: ['workflow', 'verification', 'review', 'security', 'qa'],
    content: VERIFY_ENHANCED_INSTRUCTIONS,
  };
}
