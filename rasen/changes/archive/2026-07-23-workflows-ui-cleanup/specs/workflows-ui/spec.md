## ADDED Requirements

### Requirement: A Workflows page lists the installable library in category sections

The web UI SHALL provide a `/workflows` route — space-agnostic, carrying no space prefix, because the workflow library is user-wide — reachable from a header navigation entry that renders whether or not a planning space is resolved. The page SHALL present every catalog unit from the workflow listing endpoint in category sections, in the order: **driver**, **task**, **expert**. The driver section SHALL carry a disclosure, collapsed by default, that reveals the library's **internal** workflows — internal units are driver plumbing, so they live inside the driver section rather than as a fourth top-level section. A category with no workflows SHALL render no section, and the internal disclosure appears only when internal workflows exist. Each card SHALL show the workflow's id, skill name, source (built-in or user), an abbreviated digest, and the unused marker on user workflows the library detects no consumer for — the enclosing section conveys the workflow's category, so cards carry no category label of their own. Invalid user entries (when present) SHALL remain in their own section with their diagnostics. A workflow's dependency slots are shown in the detail view rather than on the card, because the listing endpoint mirrors `rasen workflow list --json`, which carries no dependency data. The page SHALL use the application's existing visual idioms without introducing a new visual language.

#### Scenario: Library sectioned by category

- **WHEN** the listing renders a library containing driver, task, and expert workflows
- **THEN** the page shows a driver section, then a task section, then an expert section, and every workflow appears under the section matching its category

#### Scenario: Internal workflows revealed on demand

- **WHEN** the library contains internal workflows and the user expands the driver section's internal disclosure
- **THEN** the internal workflows appear within the driver section, having been hidden while the disclosure was in its default collapsed state

#### Scenario: Provenance stays visible inside a section

- **WHEN** a category section contains both built-in and user workflows
- **THEN** each card shows its source, and built-in cards visibly carry the lock marker

#### Scenario: Empty categories render no section

- **WHEN** the library contains no workflows of some category
- **THEN** that category's section is absent rather than shown empty

#### Scenario: Library visible from any space

- **WHEN** the user activates the Workflows navigation entry from any space, or with no space resolved
- **THEN** the UI navigates to `/workflows` and shows the same user-wide library in its category sections, with invalid entries visible when present

#### Scenario: Unused workflows are marked

- **WHEN** the listing contains a user workflow with no detected consumer
- **THEN** its card visibly carries the unused marker

## MODIFIED Requirements

### Requirement: A workflow detail view shows the full definition and usage

Selecting a workflow SHALL open a detail view presenting the full definition from the detail endpoint — identity, kind, source, digest, skill, the four `requires` slots, `recommends`, and the file inventory — together with the workflow's known usage referrers, each naming its consumer.

#### Scenario: Detail shows dependencies and referrers

- **WHEN** the user opens a workflow's detail view
- **THEN** the four `requires` slots (workflows, skills, pipelines, schemas) and `recommends` are listed — this detail view is where a workflow's dependency summary lives — and every known usage referrer is shown with its consumer kind

## REMOVED Requirements

### Requirement: A Workflows page lists the installable library

**Reason**: The provenance-grouped listing (Built-in / User sections with a per-card kind chip) is replaced by category-sectioned display: driver (with an expandable internal subsection), task, expert. Provenance moves entirely onto the card (source badge and built-in lock).

**Migration**: Superseded by "A Workflows page lists the installable library in category sections", which carries forward the space-agnostic route, the always-rendered navigation entry, the card fields, the unused marker, the invalid-entries section, and the existing-visual-idioms constraint.
