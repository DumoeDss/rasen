# unlinked-changes-ui Specification

## Purpose

Define Store-scoped discovery and explicit association of provably unlinked Changes, including
evidence-based eligibility, safe attach and create workflows with revision checks, honest partial
outcomes, and no synthesized Issue state.

## Requirements
### Requirement: The Unlinked Changes surface shows only provably unlinked Changes

The Store's Unlinked Changes surface SHALL consider active and archived Change occurrences from all
declared project and target-line groups. It SHALL show a Change as unlinked only when the Change has
one stable, unambiguous instance identity, the complete latest-readable-Execution-Plan scan finds no
Issue node naming that instance, and all evidence needed to make that absence claim was searched.
Changes with missing or ambiguous identity, unreadable plans, unreadable refs, or other incomplete
evidence SHALL be reported as unknown with the reason and SHALL NOT be offered as attachable.

#### Scenario: An active Change with no link is shown

- **WHEN** a complete scan finds an active stable Change instance in no latest Issue plan
- **THEN** the surface lists it as an unlinked active Change with its project and target line

#### Scenario: An archived Change with no link is shown

- **WHEN** a complete scan finds an archived stable Change instance in no latest Issue plan
- **THEN** the surface lists it as an unlinked historical Change with its archive facts, project,
  and target line

#### Scenario: A linked Change is not called unlinked

- **WHEN** any latest readable Issue plan names a Change instance
- **THEN** that occurrence is reported as linked with its Issue links and is absent from the
  attachable-unlinked collection

#### Scenario: Incomplete evidence cannot prove absence

- **WHEN** an Issue's latest plan or a Store ref could not be read and no readable plan proves a
  candidate's link
- **THEN** the candidate is reported unknown with the incompleteness facts and is not attachable

#### Scenario: Missing or duplicate identity is ineligible

- **WHEN** a Change occurrence has no stable instance identity or the same instance has ambiguous
  claimants
- **THEN** the surface reports the exact identity problem and offers no attach or create action

### Requirement: A bare Change remains visibly a Change

Each row SHALL identify itself as a Change and display the evidence's Change alias, stable instance
when present, active/archive kind, project, target line, and source ref. The surface SHALL NOT create
an Issue-shaped card, Issue state, Issue phase, or title for a Change until an operator explicitly
creates an Issue. Grouping or filtering by project SHALL remain presentation only and SHALL NOT turn
project membership into Issue ownership.

#### Scenario: An unlinked row carries Change identity

- **WHEN** an unlinked Change renders
- **THEN** its row is labelled as a Change and carries its exact alias, instance, project, target
  line, occurrence kind, and evidence source

#### Scenario: No Issue fact is synthesized

- **WHEN** a Change has no Issue link
- **THEN** the surface shows “no Issue link” and does not assign an Issue id, title, phase, health,
  or progress

#### Scenario: Project grouping does not become ownership

- **WHEN** Changes are grouped or filtered by member project
- **THEN** the grouping changes only their presentation and creates no Store or Issue record

### Requirement: Attaching a Change publishes one confirmed plan revision

An attach flow SHALL target an existing open Issue and SHALL preview the exact Change identity,
project, target line, proposed node id, target Issue, and target Issue revision before mutation. It
SHALL require explicit confirmation, preserve every field of every existing plan node, append exactly
one required Change node with no inferred dependency, and publish a new immutable revision based on
the previewed revision. The complete Store/project/target-line/instance scope SHALL come from the
Change link read; missing scope, a now-linked Change, a terminal or unreadable Issue, a duplicate
node id, or a changed base revision SHALL make the action unavailable or refused with nothing
written.

#### Scenario: Attach preview writes nothing

- **WHEN** an operator opens attach and reviews its Change, scope, node, Issue, and base revision
- **THEN** no Store file changes until the operator confirms

#### Scenario: Confirmed attach preserves the current graph

- **WHEN** the operator confirms attachment to an open Issue whose base revision is unchanged
- **THEN** one new revision preserves every existing node field and adds exactly one node naming the
  selected Change's stable instance and complete scope

#### Scenario: Node identity is explicit

- **WHEN** the Change alias collides with an existing node id
- **THEN** the flow requires a valid non-conflicting node id and does not silently merge or replace
  either node

#### Scenario: A stale attach writes nothing

- **WHEN** another plan revision is published after the preview and before the confirmed attach
- **THEN** publication is refused as a conflict, the fresh Issue is reloaded, and no stale graph is
  published

#### Scenario: Scope is never inferred

- **WHEN** any of project, target line, or stable Change instance is absent or ambiguous
- **THEN** attach is unavailable and no sole member, current filter, cwd, alias, or branch fills the
  missing fact

### Requirement: Creating a single-Change Issue is explicit and recoverable

The create flow SHALL require an operator-authored Issue id and title, show a confirmation preview,
create the Store-level Issue through the existing Issue mutation, and then conditionally publish its
first plan from the no-plan base with exactly one Change node. The UI SHALL report success only after
both writes succeed. Because Issue deletion is not a declared mutation, a first-plan failure SHALL
leave the created Issue intact, report that the Change is still unlinked, and offer the explicit
attach-to-that-Issue recovery; it SHALL NOT silently delete, hide, or call the partial outcome a
single-Change Issue.

#### Scenario: Create preview requires authored Issue intent

- **WHEN** an operator chooses create for an unlinked Change
- **THEN** a valid Issue id and non-empty title plus the exact Change scope are shown for confirmation
  and no write occurs before confirmation

#### Scenario: Both writes produce a single-Change Issue

- **WHEN** Issue creation and conditional first-plan publication both succeed
- **THEN** the new open Issue's first revision contains exactly the selected Change node and the
  Change link read reports it linked

#### Scenario: Existing Issue id is refused without overwrite

- **WHEN** the authored Issue id already exists
- **THEN** creation is refused, the existing Issue is unchanged, and no plan is published by this flow

#### Scenario: First-plan failure is an honest partial outcome

- **WHEN** the Issue record is created but first-plan publication fails
- **THEN** the surface names the created Issue, reports the Change still unlinked, and offers a
  confirmed attach recovery without deleting or disguising either resource

### Requirement: Unlinked Changes refreshes from Store evidence and is Store-only

The surface SHALL be reachable only inside a Store space and SHALL refresh its Change-to-Issue link
read and current open-Issue choices after every successful or partial mutation and on explicit
refresh. It SHALL persist no link, “unlinked” status, dialog choice, or project filter client-side.

#### Scenario: Store navigation reaches Unlinked Changes

- **WHEN** a viewer is in a Store space
- **THEN** navigation offers the Unlinked Changes surface and its URL can be opened directly

#### Scenario: A project space offers no Unlinked Changes surface

- **WHEN** a viewer is in a project space
- **THEN** navigation and routing offer no project-scoped Unlinked Changes page

#### Scenario: Refresh reflects a new link

- **WHEN** a Change is attached and the surface refreshes
- **THEN** the fresh Store read removes it from the provably-unlinked collection without consulting a
  client cache
