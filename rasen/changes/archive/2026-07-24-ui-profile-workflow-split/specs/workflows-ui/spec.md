# workflows-ui Delta Specification

## REMOVED Requirements

### Requirement: The page offers per-space workflow enablement

**Reason**: Responsibility split (this change): per-workflow space toggling conflated the library surface with selection. Editing a *list* of enabled workflows is now the Profiles page's job (editing a named profile's membership), and actually switching what a space installs is the Config page's Profile selector (profile lock + apply). The space picker, the mode banner, and the per-card enablement toggles leave the Workflows page.

**Migration**: Manage membership lists on the Profiles page (`profiles-ui`); switch a space's effective profile from that space's Config → Local → Project tab (`config-ui-package`), which also surfaces and can reset a legacy per-space selection override. The enablement API's enable/disable/reset operations remain supported (`space-workflow-enablement`).

### Requirement: Workflow cards share a uniform anatomy with a corner enablement switch

**Reason**: Renamed and narrowed (REMOVED+ADDED pair): the uniform card anatomy survives as a shared presentation, but the corner switch is no longer a Workflows-page behavior — the switch slot belongs to the shared card component and is exercised by the Profiles page.

**Migration**: See the ADDED requirement "Workflow cards share a uniform anatomy" below and `profiles-ui` for the switch behavior.

## ADDED Requirements

### Requirement: Workflow cards share a uniform anatomy

Workflow cards SHALL share one uniform anatomy: equal card sizes within a section's grid (content differences never producing ragged card heights in a row) and a fixed slot order — title and id, metadata badges, actions pinned to a consistent footer position, with library actions (export, delete) rendered as quiet footer actions. The sectioned card presentation (category sections, internal-plumbing disclosure, uniform cards with an optional corner-switch slot) SHALL be a single shared presentation used by both the Workflows page and the Profiles page, so the two surfaces cannot drift apart; on the Workflows page the switch slot stays empty.

#### Scenario: Cards render uniformly despite differing content

- **WHEN** a section's grid renders workflow cards whose titles, ids, and badges differ in length
- **THEN** the cards in each row share equal heights with title, metadata, and actions in the same positions on every card

#### Scenario: No enablement switches on the Workflows page

- **WHEN** the user browses the Workflows page
- **THEN** no card offers an enable/disable switch and no space picker is present

## MODIFIED Requirements

### Requirement: The page manages the library only

The Workflows page SHALL NOT offer model, handoff, or gate controls — a workflow definition carries no such field, and per-stage runtime configuration belongs to the pipeline surface. The page SHALL NOT present pipelines as workflows or merge the two concepts. The page SHALL NOT offer per-space enablement or profile-membership editing — it is the library's viewing and management surface only (list, detail, init, import, validate, export, delete); selection lives on the Profiles page and each space's Config page.

#### Scenario: No runtime controls on the workflow surface

- **WHEN** the user explores a workflow's card and detail view
- **THEN** no model, handoff, or gate setting is offered anywhere on the page

#### Scenario: Library management actions remain complete

- **WHEN** the user works the Workflows page after the responsibility split
- **THEN** listing, detail, New draft, Import, Validate, Export, and Delete all remain available exactly as before
