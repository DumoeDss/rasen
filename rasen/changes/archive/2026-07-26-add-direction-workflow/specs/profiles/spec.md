## ADDED Requirements

### Requirement: Direction workflow profile placement and localization

The built-in Direction workflow SHALL have stable id `direction`, skill name
and directory `rasen-direction`, and localized profile-picker metadata in
English, Japanese, and Simplified Chinese. It SHALL be available through the
full profile and explicit custom selections while the streamlined core profile
remains unchanged.

#### Scenario: Full profile includes Direction

- **WHEN** the selected profile is `full`
- **THEN** the resolved workflow selection SHALL contain `direction`
- **AND** init/update SHALL generate `rasen-direction/SKILL.md` for configured
  adapted tools

#### Scenario: Core profile does not include Direction

- **WHEN** the selected profile is `core`
- **THEN** the resolved workflow selection SHALL NOT contain `direction`
- **AND** init/update SHALL NOT generate `rasen-direction/SKILL.md` solely from
  the core preset

#### Scenario: Custom profile explicitly selects Direction

- **WHEN** a custom or named profile includes workflow id `direction`
- **THEN** Direction SHALL resolve through the normal catalog and generation
  path without requiring a parallel registration or installer

#### Scenario: Direction picker entry is localized

- **WHEN** the workflow picker is displayed in English, Japanese, or Simplified
  Chinese
- **THEN** the `direction` row SHALL have a non-empty localized name and
  description in that locale
- **AND** the stable stored workflow id SHALL remain `direction`
