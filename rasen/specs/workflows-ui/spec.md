# workflows-ui Specification

## Purpose
Provide a space-agnostic `/workflows` page in the management web UI for browsing and managing the user-wide installable workflow library — listing, detail, and CLI-backed mutation (init, validate, import, export, delete) — through the workflow-http-api endpoints, using the application's existing visual idioms.

## Requirements

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

### Requirement: The library is managed from the page through the CLI-backed endpoints

The page SHALL offer the library's management actions, each performed through the workflow endpoints (never by the browser touching the filesystem): **init** — scaffold a new draft by entering an id and picking an output directory through the local-path browser, with the created draft's path shown on success; **validate** — validate an installed workflow, or a draft directory or package picked by path, rendering the diagnostics; **import** — pick a workflow directory or `.rasenpkg` file through the local-path browser and install it, reporting imported and reused ids; **export** — pick a destination directory and filename, and when the destination already exists, surface the refusal and offer an explicit overwrite retry; **delete** — for user workflows only, behind a confirmation dialog; a referrer-guard refusal SHALL be surfaced with the CLI's message naming the referrers, with a separately confirmed force option. Every failure SHALL show the CLI's own error message verbatim. While a mutation is in flight the page SHALL prevent submitting another.

#### Scenario: Import from a picked package

- **WHEN** the user picks a `.rasenpkg` file in the path browser and confirms the import
- **THEN** the workflow is installed and the page reflects it without a reload, naming the imported ids

#### Scenario: Export refusal offers overwrite

- **WHEN** the user exports to a destination that already exists
- **THEN** the CLI's refusal is shown and the user can explicitly retry with overwrite, which succeeds

#### Scenario: Guarded delete surfaces referrers then allows force

- **WHEN** the user confirms deletion of a workflow that is still referenced
- **THEN** the refusal names the referrers, and only a second explicit force confirmation deletes it, showing the dangling referrers reported

#### Scenario: Draft scaffold guides the next step

- **WHEN** the user scaffolds a new draft via init
- **THEN** the created draft path is shown with guidance to edit, validate, and import it

### Requirement: Built-in workflows are locked in the UI

Built-in workflows SHALL present no delete affordance — the lock is visible on the card and detail view rather than discovered through an error. Init, validate, and export remain available for built-ins where the CLI supports them; deletion is a user-workflow action only.

#### Scenario: No delete affordance on built-ins

- **WHEN** the user views a built-in workflow's card or detail view
- **THEN** no delete control is offered, and the entry is visibly a locked built-in

### Requirement: The page manages the library only

The Workflows page SHALL NOT offer model, handoff, or gate controls — a workflow definition carries no such field, and per-stage runtime configuration belongs to the pipeline surface. The page SHALL NOT present pipelines as workflows or merge the two concepts.

#### Scenario: No runtime controls on the workflow surface

- **WHEN** the user explores a workflow's card and detail view
- **THEN** no model, handoff, or gate setting is offered anywhere on the page

### Requirement: The page offers per-space workflow enablement

The Workflows page SHALL let the user pick one of their spaces and, with a space picked, show each workflow card's enabled state in that space and a toggle to enable or disable it there — performed through the per-space enablement endpoints, never by the browser touching the filesystem. Toggling SHALL affect only the picked space. The page SHALL state visibly whether the picked space follows the user-wide profile or its own selection; a space using its own selection SHALL offer a reset back to the user-wide profile behind an explicit confirmation, since resetting discards the space's own list. Units the library manages automatically carry no toggle: internal workflows, invalid entries, and units enabled only because an enabled workflow's dependency closure requires them (the card says the unit is required by an enabled workflow instead of offering a disable that the apply would immediately undo). While an enablement mutation is in flight the page SHALL prevent submitting another, and every failure SHALL show the CLI's own error message verbatim. With no space picked, the page remains exactly the user-wide library manager it is today.

#### Scenario: Toggle enables a workflow in the picked space only

- **WHEN** the user picks a space and enables a workflow that was disabled there
- **THEN** the card reflects the enabled and installed state from the server's post-apply response, and no other space's state is changed

#### Scenario: Override state is visible with a reset

- **WHEN** the picked space carries its own selection override
- **THEN** the page states the space uses its own selection and offers a reset to the user-wide profile, which takes effect only after an explicit confirmation

#### Scenario: Closure-required unit offers no disable

- **WHEN** the picked space has a workflow enabled whose closure requires an expert
- **THEN** that expert's card shows it is required by an enabled workflow and offers no disable toggle

#### Scenario: No space picked keeps today's page

- **WHEN** the user has not picked a space
- **THEN** the page shows the user-wide library with its existing management actions and no enablement toggles

### Requirement: Workflow cards share a uniform anatomy with a corner enablement switch

Workflow cards SHALL share one uniform anatomy: equal card sizes within a section's grid (content differences never producing ragged card heights in a row), a fixed slot order — title and id, metadata badges, actions pinned to a consistent footer position — and, when a space is picked for enablement, the per-space enable/disable control rendered as a switch in the card's top-right corner rather than a labeled button crowded against the state text. The enabled/installed state SHALL read as quiet metadata, not as a competing text line. A unit that cannot be toggled (required by an enabled workflow's dependency closure) SHALL show its switch-position affordance visibly inert with the reason available, preserving the existing no-toggle contract. Library actions on a card (export, delete) SHALL render as quiet actions in the card footer.

#### Scenario: Cards render uniformly despite differing content

- **WHEN** a section's grid renders workflow cards whose titles, ids, and badges differ in length
- **THEN** the cards in each row share equal heights with title, metadata, and actions in the same positions on every card

#### Scenario: Enablement is a corner switch

- **WHEN** the user picks a space and views a toggleable workflow card
- **THEN** the card shows a switch in its top-right corner reflecting the enabled state, and operating the switch performs the same per-space enable/disable as before

#### Scenario: Closure-required unit shows an inert control

- **WHEN** the picked space requires a unit through an enabled workflow's dependency closure
- **THEN** that card's switch position shows a visibly inert control with the required-by reason available, and no toggle is possible
