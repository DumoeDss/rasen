# Delta: workflows-ui

## MODIFIED Requirements

### Requirement: A Workflows page lists the installable library in category sections

The web UI SHALL provide a `/workflows` route — space-agnostic, carrying no space prefix, because the workflow library is user-wide — reachable from a header navigation entry that renders whether or not a planning space is resolved. The page SHALL present every catalog unit from the workflow listing endpoint in category sections, in the order: **driver**, **task**, **expert**. The driver section SHALL carry a disclosure, collapsed by default, that reveals the library's **internal** workflows — internal units are driver plumbing, so they live inside the driver section rather than as a fourth top-level section. A category with no workflows SHALL render no section, and the internal disclosure appears only when internal workflows exist. Each card SHALL show the workflow's id, its author-declared display title when the workflow declares one (falling back to the skill name when it declares none — the same fallback rule the CLI's own profile picker applies to the same field), source (built-in or user), an abbreviated digest, and the unused marker on user workflows the library detects no consumer for — the enclosing section conveys the workflow's category, so cards carry no category label of their own. Invalid user entries (when present) SHALL remain in their own section with their diagnostics. A workflow's dependency slots are shown in the detail view rather than on the card, because the listing endpoint mirrors `rasen workflow list --json`, which carries no dependency data. The page SHALL use the application's existing visual idioms without introducing a new visual language.

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

#### Scenario: Card shows the declared title

- **WHEN** a workflow's listing entry carries a non-null `title`
- **THEN** its card shows the title in place of the skill name

#### Scenario: Card falls back to the skill name

- **WHEN** a workflow's listing entry carries a null `title`
- **THEN** its card shows the skill name, exactly as before this field existed

### Requirement: A workflow detail view shows the full definition and usage

Selecting a workflow SHALL open a detail view presenting the full definition from the detail endpoint — identity, kind, source, digest, skill, the author-declared display title, category, and tags when the workflow declares them, the four `requires` slots, `recommends`, and the file inventory — together with the workflow's known usage referrers, each naming its consumer.

#### Scenario: Detail shows dependencies and referrers

- **WHEN** the user opens a workflow's detail view
- **THEN** the four `requires` slots (workflows, skills, pipelines, schemas) and `recommends` are listed — this detail view is where a workflow's dependency summary lives — and every known usage referrer is shown with its consumer kind

#### Scenario: Detail shows the declared title, category, and tags

- **WHEN** the user opens the detail view of a workflow whose definition carries a non-null `title`, `category`, and `tags`
- **THEN** the detail view shows the title, the category, and the tags

#### Scenario: Detail omits fields the workflow does not declare

- **WHEN** the user opens the detail view of a workflow whose definition carries a null `title`, `category`, or `tags`
- **THEN** the detail view shows no row for the field(s) left null, consistent with how the rest of the panel omits what does not apply
