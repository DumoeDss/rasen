## ADDED Requirements

### Requirement: Minimal OpenSpec preamble replaces gstack preamble
The `generatePreambleBash` function in `gen-skill-docs.ts` SHALL generate a minimal preamble that only detects the current git branch. It SHALL NOT call any gstack binaries, create session files, or read external config.

#### Scenario: Preamble output contains only branch detection
- **WHEN** `generatePreambleBash` is called for any host
- **THEN** the output SHALL contain only git branch detection (`git branch --show-current`) and echo of the branch value

#### Scenario: No gstack binary calls in preamble
- **WHEN** any generated SKILL.md file is inspected
- **THEN** the preamble bash block SHALL NOT contain references to `gstack-update-check`, `gstack-config`, `gstack-repo-mode`, or session file operations

### Requirement: generatePreamble composition updated
The `generatePreamble` composite function SHALL call only these sub-generators:
1. `generatePreambleBash` (rewritten — branch only)
2. `generateAskUserFormat` (kept as-is)
3. `generateCompletenessSection` (rewritten — no gstack branding)
4. `generateRepoModeSection` (kept — uses embedded config value)
5. `generateSearchBeforeBuildingSection` (kept as-is)
6. `generateCompletionStatus` (kept as-is)

It SHALL NOT call `generateUpgradeCheck`, `generateLakeIntro`, or `generateContributorMode`.

#### Scenario: Preamble does not include upgrade check
- **WHEN** a skill template uses `{{PREAMBLE}}`
- **THEN** the generated output SHALL NOT contain text about `UPGRADE_AVAILABLE` or `JUST_UPGRADED`

#### Scenario: Preamble does not include lake intro
- **WHEN** a skill template uses `{{PREAMBLE}}`
- **THEN** the generated output SHALL NOT contain `completeness-intro-seen` or `garryslist.org`

#### Scenario: Preamble does not include contributor mode
- **WHEN** a skill template uses `{{PREAMBLE}}`
- **THEN** the generated output SHALL NOT contain `_CONTRIB`, `contributor mode`, `field report`, or `gstack team`

### Requirement: gstack-slug replaced with inline bash
All `source <(~/.openspec/bin/gstack-slug ...)` calls in `.tmpl` files and generator functions SHALL be replaced with inline bash:
```bash
SLUG=$(basename "$(git remote get-url origin 2>/dev/null)" .git 2>/dev/null || basename "$(pwd)")
```

#### Scenario: No gstack-slug binary reference in generated files
- **WHEN** any generated SKILL.md is inspected
- **THEN** it SHALL NOT contain `gstack-slug`
- **AND** project slug resolution SHALL use inline git/basename commands

### Requirement: Review dashboard calls soft-removed
All `gstack-review-read` and `gstack-review-log` binary calls in generator functions and `.tmpl` files SHALL be replaced with a comment: `# Review dashboard: pending OpenSpec integration`

#### Scenario: No gstack-review-read binary call in generated files
- **WHEN** any generated SKILL.md is inspected
- **THEN** it SHALL NOT contain executable `gstack-review-read` or `gstack-review-log` commands
- **AND** the location SHALL have a placeholder comment indicating deferred integration
