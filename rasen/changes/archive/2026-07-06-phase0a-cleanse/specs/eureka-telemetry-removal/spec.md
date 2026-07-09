## ADDED Requirements

### Requirement: Eureka file-telemetry writer removed
The system SHALL NOT write eureka moments to `~/.openspec/analytics/eureka.jsonl`. The jq-append block in `gen-skill-docs.ts` `generateSearchBeforeBuildingSection` SHALL be removed. The surrounding Search-Before-Building methodology prose and the EUREKA-naming sentence SHALL be retained (their wholesale removal is deferred to the preamble-removal phase).

#### Scenario: No eureka.jsonl write in generator
- **WHEN** `scripts/gen-skill-docs.ts` is inspected
- **THEN** it SHALL NOT contain the string `eureka.jsonl`
- **AND** it SHALL NOT contain a jq append to `~/.openspec/analytics/`

#### Scenario: No eureka.jsonl write in generated output
- **WHEN** all SKILL.md files are regenerated and inspected
- **THEN** none SHALL contain instructions to append to `eureka.jsonl`

### Requirement: Eureka file-telemetry reader removed
The system SHALL NOT read `~/.openspec/analytics/eureka.jsonl`. The `retro` skill's "Eureka Moments" metrics section, which exists solely to read that file, SHALL be removed from `skills/gstack/retro/SKILL.md.tmpl`.

#### Scenario: No eureka read in retro source
- **WHEN** `skills/gstack/retro/SKILL.md.tmpl` is inspected
- **THEN** it SHALL NOT contain the string `eureka.jsonl`
- **AND** it SHALL NOT contain an "Eureka Moments" metrics row that reads the analytics file

### Requirement: Eureka logging clauses removed from skill bodies
The system SHALL remove "log the eureka moment (see preamble)" telemetry clauses from `office-hours` and `design-consultation` while retaining the EUREKA-naming reasoning technique itself.

#### Scenario: EUREKA naming kept, logging clause dropped
- **WHEN** `skills/gstack/office-hours/SKILL.md.tmpl` and `skills/gstack/design-consultation/SKILL.md.tmpl` are inspected
- **THEN** each MAY still instruct naming a first-principles EUREKA insight in prose
- **AND** neither SHALL instruct logging the eureka moment to a file

### Requirement: PostHog telemetry unaffected
The removal SHALL be scoped to the eureka.jsonl file-telemetry only and SHALL NOT alter the `src/telemetry/` PostHog module or its behavior.

#### Scenario: PostHog telemetry module untouched
- **WHEN** the change diff is inspected
- **THEN** it SHALL NOT modify files under `src/telemetry/`
