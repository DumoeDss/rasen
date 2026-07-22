# workflows-ui Delta Specification

## ADDED Requirements

### Requirement: A Workflows page lists the installable library

The web UI SHALL provide a `/workflows` route — space-agnostic, carrying no space prefix, because the workflow library is user-wide — reachable from a header navigation entry that renders whether or not a planning space is resolved. The page SHALL list every catalog unit from the workflow listing endpoint as cards grouped by provenance: built-in workflows, user workflows, and (when present) invalid user entries with their diagnostics. Each card SHALL show the workflow's id, kind (task, driver, expert, or internal), source, skill name, an abbreviated digest, and the unused marker on user workflows the library detects no consumer for. A workflow's dependency slots are shown in the detail view rather than on the card, because the listing endpoint mirrors `rasen workflow list --json`, which carries no dependency data. The page SHALL use the application's existing visual idioms without introducing a new visual language.

#### Scenario: Library visible from any space

- **WHEN** the user activates the Workflows navigation entry from any space, or with no space resolved
- **THEN** the UI navigates to `/workflows` and shows the same user-wide library, grouped built-in and user, with invalid entries visible when present

#### Scenario: Unused workflows are marked

- **WHEN** the listing contains a user workflow with no detected consumer
- **THEN** its card visibly carries the unused marker

#### Scenario: Kind is visible per card

- **WHEN** the listing renders
- **THEN** every card shows its kind so drivers, tasks, experts, and internal units are distinguishable at a glance

### Requirement: A workflow detail view shows the full definition and usage

Selecting a workflow SHALL open a detail view presenting the full definition from the detail endpoint — identity, kind, source, digest, skill, command, the four `requires` slots, `recommends`, and the file inventory — together with the workflow's known usage referrers, each naming its consumer.

#### Scenario: Detail shows dependencies and referrers

- **WHEN** the user opens a workflow's detail view
- **THEN** the four `requires` slots (workflows, skills, pipelines, schemas) and `recommends` are listed — this detail view is where a workflow's dependency summary lives — and every known usage referrer is shown with its consumer kind

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
