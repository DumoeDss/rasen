/**
 * Retro OPSX Workflow Command
 *
 * Engineering retrospective — analyzes commit history, work patterns,
 * and code quality metrics. Supports change-scoped, general, and global
 * retrospective modes. Report saved to the OpenSpec change directory.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';

const RETRO_INSTRUCTIONS = `Engineering retrospective — analyze what shipped, patterns, and learnings.

Supports three scopes: change-scoped, general, and global. Retro report saved to the OpenSpec change directory.

## When to Use

Use when: "retro", "retrospective", "what did we ship?", "weekly retro", "global retro".

## Steps

### 1. Determine Scope

Parse the input to determine retro scope:

- \`/opsx:retro <change-name>\` → **Change-scoped**: analyze a specific change
- \`/opsx:retro\` (no args) → Prompt user to select: change-scoped (pick a change) or general
- \`/opsx:retro global\` → **Global**: cross-project retrospective

### 2A. Change-Scoped Retro

Read all available artifacts from the change directory:

**Planning Artifacts:**
- \`proposal.md\` — what was planned
- \`design.md\` — how it was designed
- \`tasks.md\` — task breakdown and completion status
- \`specs/\` — delta specifications

**Outcome Artifacts:**
- \`review-report.md\` — code review findings
- \`qa-report.md\` — QA findings
- \`cso-report.md\` — security audit findings
- \`ship-log.md\` — shipping details (PR URL, deploy status)
- \`office-hours-design.md\` — product validation session

**Analysis:**
- Correlate planning vs outcome: did we build what we planned?
- Task completion rate and timeline
- Review iteration count (how many rounds of review?)
- Issues found during verification vs issues found in production
- Note which artifacts were missing and what analysis was skipped

### 2B. General Retro

Analyze recent repository activity:
- Run \`git log --oneline --since="1 week ago"\` to see recent commits
- Analyze commit patterns (frequency, time of day, areas of code)
- Identify areas of high churn
- Look for patterns in commit messages
- Invoke the \`/retro\` expert skill for detailed analysis

### 2C. Global Retro

Delegate to the \`/retro\` expert skill with the \`global\` flag:
- Cross-project analysis if multiple repos are accessible
- Aggregate shipping streaks and work patterns
- Compare productivity across projects

### 3. Generate Report

**Change-scoped report structure:**

\`\`\`markdown
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
\`\`\`

**General report structure:**

\`\`\`markdown
# Retro: Weekly Summary

**Date:** <date>
**Scope:** General
**Period:** <start> to <end>

## Commit Summary
- Total commits: <count>
- Contributors: <list>
- Most active areas: <code areas>

## Patterns Observed
- <pattern 1>
- <pattern 2>

## Improvement Suggestions
1. <suggestion 1>
2. <suggestion 2>
3. <suggestion 3>
\`\`\`

### 4. Write Report

**Change-scoped:** Write to \`openspec/changes/<name>/retro.md\`

**General:** Write to \`openspec/retro-latest.md\`

**Global:** Write to \`openspec/retro-global-latest.md\`

### 5. Display Summary

After writing the report:
- Display the full report to the user
- Highlight the **top 3 actionable takeaways**
- Suggest next steps based on findings

## Integration Notes

- Change-scoped retro is most valuable after \`/opsx:ship\` completes
- The retro report is consumed by \`/opsx:archive\` as part of the archive quality summary
- General retro can be run weekly as a habit — suggest it proactively at the end of a work week`;

export function getRetroCommandSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-opsx-retro',
    description: 'Engineering retrospective — analyze what shipped, patterns, and learnings. Supports change-scoped, general, and global modes.',
    instructions: RETRO_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires openspec CLI.',
    metadata: { author: 'openspec', version: '1.0' },
  };
}

export function getOpsxRetroCommandTemplate(): CommandTemplate {
  return {
    name: 'OPSX: Retro',
    description: 'Engineering retrospective — analyze what shipped, patterns, and learnings',
    category: 'Workflow',
    tags: ['workflow', 'retrospective', 'analysis'],
    content: RETRO_INSTRUCTIONS,
  };
}
