## MODIFIED Requirements

### Requirement: No pending-integration stubs in skill sources
The system SHALL NOT contain `# ... pending OpenSpec integration` dead bash blocks in any skill `.tmpl` file. For each block whose surrounding passage exists only to run it, the passage SHALL be removed by explicit file lookup; for each block sitting above still-working code, only the dead block SHALL be removed and the working code retained.

#### Scenario: No pending stubs in surviving tmpl files
- **WHEN** `skills/gstack/codex/SKILL.md.tmpl` (and every other surviving skill `.tmpl`) is inspected
- **THEN** none SHALL contain the string `pending OpenSpec integration`

#### Scenario: Working diff-scope fallback retained
- **WHEN** the design-review-lite content is regenerated
- **THEN** the dead `# Diff scope detection: pending OpenSpec integration` comment SHALL be gone
- **AND** the real `git diff --name-only | grep -qE` frontend-detection fallback SHALL remain functional

## REMOVED Requirements

### Requirement: Retro global-mode dead path removed
**Reason**: The `retro` expert skill was removed in change `remove-gstack-parallel-lifecycle`; this requirement constrains a deleted `skills/gstack/retro/SKILL.md.tmpl`.
**Migration**: The retrospective flow now lives in the `/opsx:retro` workflow template, whose global scope is self-contained (see the `opsx-retro-command` capability). Historical record of this cleanup remains in `openspec/changes/archive/2026-07-06-phase0a-cleanse/`.
