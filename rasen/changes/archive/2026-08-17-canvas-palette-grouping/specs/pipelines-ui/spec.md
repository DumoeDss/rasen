## ADDED Requirements

### Requirement: The palette groups the stage vocabulary

The assembly palette SHALL present the installed skill vocabulary in ordered groups: the
common core stages first (propose, apply, review, ship, archive, in pipeline order),
then the ordinary workflows, then the experts in their own visually distinct section,
then the internal workflows in their own section. Within every group the palette SHALL
preserve the catalog's own order, so the same catalog always renders the same palette.
Grouping SHALL rest on the skill's declared workflow kind as delivered by the pipeline
catalog, and the palette SHALL NOT infer a skill's kind from its name or any other
heuristic. A skill the catalog delivers without a kind SHALL render in the workflows
group. A core stage the catalog does not deliver SHALL simply not render; the palette
SHALL NOT show a placeholder for it. Every listed skill SHALL keep its bindability
state exactly as before grouping (a disabled skill stays listed, visibly disabled, in
its group), and both palette renderings (the version 1 skill cards and the version 2
Stage gesture expansion) SHALL present the same grouped order.

#### Scenario: The core stages lead the palette

- **WHEN** the palette renders a catalog that contains the core stage skills
- **THEN** those five skills appear first, in pipeline order (propose, apply, review, ship, archive), ahead of every other skill

#### Scenario: Experts render in their own distinct section

- **WHEN** the palette renders a catalog containing expert-kind skills
- **THEN** those skills appear in a separate, visually distinct experts section after the ordinary workflows, not interleaved with them

#### Scenario: Ordinary and internal workflows keep stable order in their own sections

- **WHEN** the palette renders the same catalog twice, or a catalog whose entries arrive in a different order
- **THEN** each section's members are exactly the skills of its kind, in the catalog's own order within the section, and internal workflows appear in their own section after the experts section

#### Scenario: A catalog without kind metadata still groups

- **WHEN** the palette renders a catalog whose skills carry no kind field
- **THEN** every such skill renders in the workflows section and the palette renders without error

#### Scenario: Both palette branches present the same groups

- **WHEN** a version 1 draft and a version 2 draft render the palette in the same space
- **THEN** the version 1 skill cards and the version 2 Stage gesture expansion list the same skills in the same grouped order

#### Scenario: Grouping never changes bindability

- **WHEN** a disabled skill renders in any group
- **THEN** it stays listed, visibly disabled, and behaves exactly as it did before grouping
