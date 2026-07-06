## MODIFIED Requirements

### Requirement: Navigator maps OPSX and the experts, reflecting the post-absorb state
The navigator body SHALL present a four-part map: a main flow (`/opsx:explore` or `/opsx:office-hours` → `/opsx:propose` → `/opsx:apply` → review/verify → `/opsx:ship` → `/opsx:archive` → `/opsx:retro`, with `/opsx:auto` as the driver), on-ramps, a vocabulary layer (`/domain-modeling`, `/codebase-design`), and standalone specialists, each with a one-line "when to reach for it". It SHALL reflect the post-absorb reality and SHALL NOT reference grill skills absent from this fork, nor any of the removed parallel-lifecycle skills. The map SHALL NOT contain a Deploy family section, a Plan family section, a standalone `/retro` entry, or a `/document-release` entry.

#### Scenario: Four-part map present
- **WHEN** the generated navigator skill is inspected
- **THEN** it SHALL contain a main flow, on-ramps, a vocabulary layer, and a standalone section
- **AND** each named skill SHALL have a one-line "when to use"

#### Scenario: Reflects absorbed skills
- **WHEN** the navigator map is inspected
- **THEN** `/investigate` SHALL be described as refusing to hypothesise before a red-capable feedback loop
- **AND** `/review` SHALL be described as a two-axis (Standards + Spec) review

#### Scenario: No fork-absent grill skills referenced
- **WHEN** the navigator map is inspected
- **THEN** it SHALL NOT reference `/to-prd`, `/to-issues`, `/implement`, `/triage`, `/improve-codebase-architecture`, `/research`, `/teach`, `/grill-me`, `/grill-with-docs`, or `/setup-matt-pocock-skills`

#### Scenario: No removed parallel-lifecycle skills referenced
- **WHEN** the navigator map is inspected
- **THEN** it SHALL NOT reference `/autoplan`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/land-and-deploy`, `/setup-deploy`, `/canary`, `/document-release`, or a standalone `/retro` expert
- **AND** the `/opsx:ship` and `/opsx:retro` entries in the main flow SHALL remain
