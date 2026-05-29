## ADDED Requirements

### Requirement: generateUpgradeCheck removed
The `generateUpgradeCheck` function SHALL be deleted from `gen-skill-docs.ts`. No generated SKILL.md SHALL contain upgrade check logic.

#### Scenario: No upgrade check in any skill
- **WHEN** all SKILL.md files are regenerated
- **THEN** none SHALL contain `UPGRADE_AVAILABLE`, `JUST_UPGRADED`, `gstack-update-check`, or `gstack-upgrade/SKILL.md`

### Requirement: generateLakeIntro removed
The `generateLakeIntro` function SHALL be deleted from `gen-skill-docs.ts`.

#### Scenario: No lake intro in any skill
- **WHEN** all SKILL.md files are regenerated
- **THEN** none SHALL contain `completeness-intro-seen`, `LAKE_INTRO`, or `garryslist.org`

### Requirement: generateContributorMode removed
The `generateContributorMode` function SHALL be deleted from `gen-skill-docs.ts`.

#### Scenario: No contributor mode in any skill
- **WHEN** all SKILL.md files are regenerated
- **THEN** none SHALL contain `_CONTRIB`, `contributor mode`, `field report`, `contributor-logs`, or `Hey gstack team`

### Requirement: Session tracking removed
The preamble SHALL NOT create, touch, find, or clean session files under `~/.openspec/sessions/`.

#### Scenario: No session operations in any skill
- **WHEN** all SKILL.md files are regenerated
- **THEN** none SHALL contain `sessions/$PPID`, `~/.openspec/sessions`, or `_SESSIONS`

### Requirement: gstack-global-discover references removed
All references to `gstack-global-discover` binary SHALL be removed from `.tmpl` files and generator functions.

#### Scenario: No global-discover in any skill
- **WHEN** all SKILL.md files are regenerated
- **THEN** none SHALL contain `gstack-global-discover`
