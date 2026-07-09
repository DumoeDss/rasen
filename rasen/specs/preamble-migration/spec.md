# preamble-migration Specification

## Purpose
Replace the gstack preamble with a minimal Rasen preamble and update preamble composition accordingly.
## Requirements
### Requirement: Minimal Rasen preamble replaces gstack preamble
The `generatePreambleBash` function in `gen-skill-docs.ts` SHALL generate a minimal preamble that only detects the current git branch. It SHALL NOT call any gstack binaries, create session files, or read external config.

#### Scenario: Preamble output contains only branch detection
- **WHEN** `generatePreambleBash` is called for any host
- **THEN** the output SHALL contain only git branch detection (`git branch --show-current`) and echo of the branch value

#### Scenario: No gstack binary calls in preamble
- **WHEN** any generated SKILL.md file is inspected
- **THEN** the preamble bash block SHALL NOT contain references to `gstack-update-check`, `gstack-config`, `gstack-repo-mode`, or session file operations

### Requirement: generatePreamble composition updated
The `generatePreamble` composite function SHALL call only these sub-generators:
1. `generatePreambleBash` (branch detection only)
2. `generateAskUserFormat` (kept)
3. `generateRepoModeSection` (kept — uses embedded config value)
4. `generateCompletionStatus` (kept — functional status protocol)

It SHALL NOT call `generateUpgradeCheck`, `generateLakeIntro`, `generateContributorMode`, `generateCompletenessSection`, or `generateSearchBeforeBuildingSection`. The two ethos sub-generators (`generateCompletenessSection` — "Boil the Lake"; `generateSearchBeforeBuildingSection` — "Search Before Building") SHALL be deleted from `gen-skill-docs.ts`.

#### Scenario: Preamble does not include upgrade check
- **WHEN** a skill template uses `{{PREAMBLE}}`
- **THEN** the generated output SHALL NOT contain text about `UPGRADE_AVAILABLE` or `JUST_UPGRADED`

#### Scenario: Preamble does not include lake intro
- **WHEN** a skill template uses `{{PREAMBLE}}`
- **THEN** the generated output SHALL NOT contain `completeness-intro-seen` or `garryslist.org`

#### Scenario: Preamble does not include contributor mode
- **WHEN** a skill template uses `{{PREAMBLE}}`
- **THEN** the generated output SHALL NOT contain `_CONTRIB`, `contributor mode`, `field report`, or `gstack team`

#### Scenario: Preamble does not include the ethos sections
- **WHEN** a skill template uses `{{PREAMBLE}}` and is regenerated
- **THEN** the generated output SHALL NOT contain a "Completeness Principle" / "Boil the Lake" section
- **AND** SHALL NOT contain a "Search Before Building" section
- **AND** SHALL still contain the functional sections (branch detection, AskUserQuestion format, Repo mode, Completion status)

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

### Requirement: ETHOS.md deleted
The redundant builder-ethos document `skills/gstack/docs/ETHOS.md` SHALL be deleted. It is not read by the generator; its content was inlined into the (now removed) ethos sub-generators.

#### Scenario: ETHOS.md absent
- **WHEN** the source tree is inspected
- **THEN** `skills/gstack/docs/ETHOS.md` SHALL NOT exist

### Requirement: Dangling ETHOS references removed
All textual references instructing the reader to "Read ETHOS.md" SHALL be removed from skill sources and docs, by explicit file lookup: `skills/gstack/office-hours/SKILL.md.tmpl` and `skills/gstack/docs/ARCHITECTURE.md`. Cross-references to the removed Completeness Principle (e.g. in `generateAskUserFormat`) SHALL be softened so they do not point at a deleted section.

#### Scenario: No ETHOS pointer in skill sources
- **WHEN** `skills/gstack/office-hours/SKILL.md.tmpl` and its regenerated `SKILL.md` are inspected
- **THEN** none SHALL contain the string `ETHOS.md`

#### Scenario: No ETHOS pointer in docs
- **WHEN** `skills/gstack/docs/ARCHITECTURE.md` is inspected
- **THEN** it SHALL NOT reference `ETHOS.md`

#### Scenario: No dangling Completeness Principle cross-reference
- **WHEN** the generated AskUserQuestion-format section is inspected
- **THEN** it SHALL NOT direct the reader to a "Completeness Principle" section that no longer exists

