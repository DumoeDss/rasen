## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: ETHOS.md deleted
The redundant builder-ethos document `skills/gstack/docs/ETHOS.md` SHALL be deleted. It is not read by the generator; its content was inlined into the (now removed) ethos sub-generators.

#### Scenario: ETHOS.md absent
- **WHEN** the source tree is inspected
- **THEN** `skills/gstack/docs/ETHOS.md` SHALL NOT exist

### Requirement: Dangling ETHOS references removed
All textual references instructing the reader to "Read ETHOS.md" SHALL be removed from skill sources and docs, by explicit file lookup: `skills/gstack/office-hours/SKILL.md.tmpl`, `skills/gstack/plan-ceo-review/SKILL.md.tmpl`, and `skills/gstack/docs/ARCHITECTURE.md`. Cross-references to the removed Completeness Principle (e.g. in `generateAskUserFormat`) SHALL be softened so they do not point at a deleted section.

#### Scenario: No ETHOS pointer in skill sources
- **WHEN** `skills/gstack/office-hours/SKILL.md.tmpl`, `skills/gstack/plan-ceo-review/SKILL.md.tmpl`, and their regenerated `SKILL.md` are inspected
- **THEN** none SHALL contain the string `ETHOS.md`

#### Scenario: No ETHOS pointer in docs
- **WHEN** `skills/gstack/docs/ARCHITECTURE.md` is inspected
- **THEN** it SHALL NOT reference `ETHOS.md`

#### Scenario: No dangling Completeness Principle cross-reference
- **WHEN** the generated AskUserQuestion-format section is inspected
- **THEN** it SHALL NOT direct the reader to a "Completeness Principle" section that no longer exists
