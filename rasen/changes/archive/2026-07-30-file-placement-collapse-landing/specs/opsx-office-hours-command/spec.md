## MODIFIED Requirements

### Requirement: Dual-Write Output

Output SHALL land in the planning root, never the machine root (`file-placement` capability: generated templates carry no direct machine-root writes). Which of the two in-root locations is used depends on context: with an active Rasen change, the document goes to `office-hours-design.md` under `changeRoot`; with no active change, it goes to `<topic-slug>.md` under the `office-hours/` directory resolved from the planning home. Both paths SHALL be resolved from status JSON per the "Office-Hours Resolves Its Output Paths From Status JSON" requirement. The office-hours *expert* skill's own design document is a root-level design doc and lands in `<planningRoot>/rasen/design-docs/` (`file-placement` capability).

#### Scenario: Output when active change exists

- **WHEN** office-hours completes
- **AND** an active Rasen change context exists
- **THEN** the output document SHALL be written to `office-hours-design.md` under the change directory resolved from status JSON
- **AND** nothing SHALL be written under the machine root

#### Scenario: Output when no active change exists

- **WHEN** office-hours completes
- **AND** no active change exists
- **THEN** the output SHALL go to `rasen/office-hours/<topic-slug>.md`, where `<topic-slug>` is a kebab-case slug derived from the session topic (the same way `/rasen-propose` derives a change name)
- **AND** the filename SHALL NOT be a single fixed name, so that separate validation sessions do not overwrite one another
- **AND** if the derived filename already exists for an unrelated topic, the agent SHALL disambiguate with a short suffix rather than overwriting
