# dead-stub-removal Specification

## Purpose
Removes the dead `# ... pending OpenSpec integration` bash stubs — empty blocks standing in for a review-log/dashboard/diff-scope backend that does not exist in this fork — from the skill `.tmpl` sources and the generator functions, and drops the self-declared dead-end retro global-mode path. Part of the phase0a cleanse that strips transplanted residue without deleting or adding any skills.
## Requirements
### Requirement: No pending-integration stubs in skill sources
The system SHALL NOT contain `# ... pending OpenSpec integration` dead bash blocks in any skill `.tmpl` file. For each block whose surrounding passage exists only to run it, the passage SHALL be removed by explicit file lookup; for each block sitting above still-working code, only the dead block SHALL be removed and the working code retained.

#### Scenario: No pending stubs in surviving tmpl files
- **WHEN** `skills/gstack/codex/SKILL.md.tmpl` (and every other surviving skill `.tmpl`) is inspected
- **THEN** none SHALL contain the string `pending OpenSpec integration`

#### Scenario: Working diff-scope fallback retained
- **WHEN** the design-review-lite content is regenerated
- **THEN** the dead `# Diff scope detection: pending OpenSpec integration` comment SHALL be gone
- **AND** the real `git diff --name-only | grep -qE` frontend-detection fallback SHALL remain functional

### Requirement: No pending-integration stubs in generator functions
The system SHALL remove `pending OpenSpec integration` stubs from the non-preamble generator functions `generateReviewDashboard` and `generateDesignReviewLite` in `gen-skill-docs.ts`. Where a generator's entire output is a review-dashboard that depends on the non-existent review-log backend, that dead output SHALL be removed or neutralized so no stub reaches generated files.

#### Scenario: No pending stubs in generator
- **WHEN** `scripts/gen-skill-docs.ts` is inspected
- **THEN** it SHALL NOT contain the string `pending OpenSpec integration`

#### Scenario: No pending stubs in any generated skill
- **WHEN** all SKILL.md files are regenerated and inspected
- **THEN** none SHALL contain the string `pending OpenSpec integration`

