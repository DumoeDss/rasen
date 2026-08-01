## MODIFIED Requirements

### Requirement: Four grill expert skills exist as source templates

The system SHALL carry the three surviving methodology bodies adapted from the grill sources (MIT, Matt Pocock), by explicit name: `codebase-design`, `tdd`, and `prototype`. (`domain-modeling` remains removed.) Each body SHALL be installed as an explicitly named Markdown reference inside its single host workflow's sidecar tree: codebase design under `rasen-propose`, TDD under `rasen-apply-change`, and prototype under `rasen-explore`. Each entry reference SHALL preserve the grill source substance, leading-word vocabulary, and checkable completion criteria, and SHALL direct the host to deeper bundled references only when needed. These references SHALL NOT be registered as independent expert skill templates.

#### Scenario: Each skill has a template and preamble reference

- **WHEN** the packaged workflow sidecars are inspected
- **THEN** `rasen-propose` SHALL carry a codebase-design entry reference
- **AND** `rasen-apply-change` SHALL carry a TDD entry reference
- **AND** `rasen-explore` SHALL carry a prototype entry reference
- **AND** no standalone `rasen-codebase-design`, `rasen-tdd`, or `rasen-prototype` template SHALL be registered
- **AND** no domain-modeling source or registration SHALL exist

#### Scenario: Reference sidecars carried in source

- **WHEN** the three host reference trees are inspected
- **THEN** the codebase-design tree SHALL contain the substantive equivalents of `DEEPENING.md` and `DESIGN-IT-TWICE.md`
- **AND** the TDD tree SHALL contain the substantive equivalents of `tests.md` and `mocking.md`
- **AND** the prototype tree SHALL contain the substantive equivalents of `LOGIC.md` and `UI.md`

#### Scenario: Grill vocabulary preserved

- **WHEN** the generated host skills and their installed references are inspected
- **THEN** the codebase-design reference SHALL contain the deep-module vocabulary (`seam`, `deep module`, `adapter`, `leverage`, `locality`)
- **AND** the TDD reference SHALL name the three anti-patterns (implementation-coupled, tautological, horizontal-slicing) and the tracer-bullet vertical-slice discipline
- **AND** the prototype reference SHALL branch into LOGIC and UI questions

### Requirement: MIT attribution on adapted content

Each adapted methodology entry reference SHALL carry an MIT attribution NOTICE (`adapted from mattpocock/skills (MIT, Copyright Matt Pocock)`). Deeper sidecar files copied largely verbatim SHALL carry the same NOTICE at their head. Moving a methodology into a host workflow SHALL preserve attribution in both packaged source and installed output.

#### Scenario: Generated skills carry the NOTICE

- **WHEN** the three host workflow skill directories are generated
- **THEN** each adapted methodology entry reference SHALL contain the strings `mattpocock/skills` and `MIT`
- **AND** each copied deeper reference SHALL retain its attribution notice

#### Scenario: AGENTS directory table lists the surviving skills

- **WHEN** `skills/experts/docs/AGENTS.md` is inspected
- **THEN** it SHALL NOT present `/codebase-design`, `/tdd`, or `/prototype` as standalone experts
- **AND** the host workflow documentation SHALL identify where those methods are available

## REMOVED Requirements

### Requirement: Four skills registered as expert templates

**Reason**: `codebase-design`, `tdd`, and `prototype` each have one workflow host and do not need independent catalog or invocation identities.

**Migration**: Use the codebase-design branch in `rasen-propose`, the TDD branch in `rasen-apply-change`, or the prototype branch in `rasen-explore`; each host lazily reads the same methodology from its bundled references.

#### Scenario: Retired methodology registrations are absent

- **WHEN** the built-in catalog and generated skill roster are enumerated after update
- **THEN** `codebase-design`, `tdd`, and `prototype` SHALL be absent as independent expert entries
- **AND** their host workflow skills SHALL contain the corresponding bundled references
