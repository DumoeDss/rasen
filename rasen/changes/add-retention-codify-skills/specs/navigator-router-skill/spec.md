## MODIFIED Requirements

### Requirement: Navigator maps Rasen and the experts, reflecting the post-absorb state

The navigator body SHALL present a four-part map: a main flow (`rasen-explore` or `rasen-office-hours-command` → `rasen-propose` → `rasen-apply-change` → review/verify → `rasen-ship` → `rasen-retain` → `rasen-archive-change`, with `rasen-auto` as the driver), on-ramps, a vocabulary layer (`rasen-codebase-design`), and standalone specialists, each with a one-line "when to reach for it". Workflows and expert skills SHALL be named by their canonical skill name, not the `/rasen:*` colon form. The `rasen-retain` entry SHALL explain that report and codify are mutually exclusive profile-policy choices and that retention completes before archive. It SHALL reflect the post-absorb reality and SHALL NOT reference grill skills absent from this fork, nor any of the removed parallel-lifecycle skills, nor the removed `/domain-modeling` methodology skill. The map SHALL NOT contain a Deploy family section, a Plan family section, a standalone `/retro` entry, or a `/document-release` entry. If `rasen-retro` is mentioned, it SHALL appear only as a temporary user-invoked compatibility alias for retain report mode and SHALL NOT appear in the main flow or as a profile-selectable or model-invoked workflow.

#### Scenario: Four-part map present

- **WHEN** the generated navigator skill is inspected
- **THEN** it SHALL contain a main flow, on-ramps, a vocabulary layer, and a standalone section
- **AND** each named skill SHALL have a one-line "when to use"
- **AND** each named skill SHALL be referenced by its canonical `rasen-*` skill name, not a `/rasen:*` colon reference

#### Scenario: Reflects absorbed skills

- **WHEN** the navigator map is inspected
- **THEN** the `rasen-investigate` skill SHALL be described as refusing to hypothesise before a red-capable feedback loop
- **AND** the `rasen-review` skill SHALL be described as a two-axis (Standards + Spec) review

#### Scenario: No fork-absent grill skills referenced

- **WHEN** the navigator map is inspected
- **THEN** it SHALL NOT reference `/to-prd`, `/to-issues`, `/implement`, `/triage`, `/improve-codebase-architecture`, `/research`, `/teach`, `/grill-me`, `/grill-with-docs`, or `/setup-matt-pocock-skills`

#### Scenario: No removed parallel-lifecycle skills referenced

- **WHEN** the navigator map is inspected
- **THEN** it SHALL NOT reference `/autoplan`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/land-and-deploy`, `/setup-deploy`, `/canary`, `/document-release`, or a standalone `/retro` expert
- **AND** the `rasen-ship`, `rasen-retain`, and `rasen-archive-change` entries in the main flow SHALL remain

#### Scenario: No removed methodology skill referenced

- **WHEN** the navigator map is inspected
- **THEN** it SHALL NOT reference `/domain-modeling`

#### Scenario: Ship entry reflects the delivery modes

- **WHEN** the navigator map's main flow is inspected
- **THEN** the `rasen-ship` one-liner SHALL name the three delivery modes (pr / push / local) and evidence-gated testing
- **AND** it SHALL remain a one-line "when to reach for it" entry, not the full ship contract (resolution precedence, the merge step, and the ship-log fields stay in the ship skill)

#### Scenario: Retain precedes archive and exposes one retention policy

- **WHEN** the navigator map's main flow and `rasen-retain` entry are inspected
- **THEN** the main-flow order SHALL be `rasen-ship` → `rasen-retain` → `rasen-archive-change`
- **AND** the `rasen-retain` one-liner SHALL explain that report and codify are mutually exclusive choices in profile policy
- **AND** it SHALL explain that report preserves `retro.md`, codify completes learned-skill decisions, and archive runs afterward without codifying

#### Scenario: Retro appears only as a compatibility alias

- **WHEN** the navigator mentions `rasen-retro`
- **THEN** it SHALL identify `rasen-retro` only as a temporary user-invoked compatibility alias for `rasen-retain` report mode
- **AND** `rasen-retro` SHALL NOT appear in the main flow or as a profile-selectable or model-invoked workflow
