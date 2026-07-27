## ADDED Requirements

### Requirement: Task detail presents Change-run Operations

The Task detail page SHALL present reconciler Run summaries for each Change in
the Task and SHALL let the user open one exact Run detail. The detail SHALL
consume the `change-run-view/1` core and closed `root-dag/1` section, rendering
ordered frontier, active invocations/actions/effects, waits/terminal,
workspace/effect diagnostics, allowed controls, source state, and
SourceRevision/Definition/capability/policy/workspace drift. It SHALL NOT
independently infer state from sessions, task checkboxes, Pipeline names, or
legacy files.

#### Scenario: Single Change shows its reconciler Runs

- **WHEN** a single-item Task has one or more reconciler Runs
- **THEN** its Operations section lists each exact Run identity and status and
  can open its canonical detail

#### Scenario: Portfolio keeps child ownership visible

- **WHEN** a portfolio Task has reconciler Runs on several child Changes
- **THEN** Operations groups each Run under its owning child and does not merge
  their frontiers

#### Scenario: Run detail shows one projection

- **WHEN** a user opens a Run waiting with an active invocation and source drift
- **THEN** the page shows the exact projected `root-dag/1` fields, Record
  version, and drift warning from the detail response

#### Scenario: Concurrent waits and actions remain visible

- **WHEN** one root branch waits at a Gate while another Action remains active,
  or two Gates wait concurrently
- **THEN** the page renders the stable-sorted waits and independent Actions
- **AND** each wait-scoped control carries only that wait's exact WaitId

#### Scenario: Legacy sessions remain available

- **WHEN** a Task also has supervised sessions or legacy Run-file state
- **THEN** the existing session launch, tail, kill, and legacy lifecycle
  experience remains available alongside the engine-tagged reconciler section

### Requirement: Task detail submits only allowed versioned controls

The Operations section SHALL render only controls declared as allowed by the
current Run view. It SHALL submit the displayed expected Record version through
the shared API client, disable duplicate submission while in flight, and
refetch committed detail after success or conflict. It SHALL never
optimistically mark a node complete or expose a free-form Adapter result form.

#### Scenario: Gate decision uses displayed version

- **WHEN** a user selects one allowed decision on a Gate wait
- **THEN** the UI submits that decision with the displayed Record version and
  exact WaitId and renders the committed response
- **AND** any downstream Action is shown as admitted_undelivered without an
  executable payload; trusted CLI resume owns first delivery

#### Scenario: Stale control refreshes current truth

- **WHEN** a control loses a Record-version race
- **THEN** the UI explains that the Run changed and refetches the current
  detail instead of retaining an optimistic decision

#### Scenario: Cancel requires confirmation

- **WHEN** a user chooses cancel on a non-terminal Run
- **THEN** the UI confirms first and submits a versioned cancel only after confirmation

#### Scenario: Terminal Run has no mutation controls

- **WHEN** a Run is completed, escalated, failed, or cancelled
- **THEN** its detail shows the terminal reason and no resume, decision,
  escalation, or cancel control

#### Scenario: Uncertain effect cannot be resumed by a human

- **WHEN** a Run is suspended on an uncertain-effect wait
- **THEN** the UI shows the exact Action/Effect identity but no resume action
- **AND** escalation and confirmed cancel remain available according to the
  projected allowed controls

#### Scenario: Typed waits remain distinct

- **WHEN** a Run has a domain-blocked, infrastructure, workspace-drift, or
  workspace-reservation wait
- **THEN** the UI renders its typed reason/evidence/effect diagnostics and only
  server-projected controls
- **AND** workspace drift offers no ordinary resume
- **AND** workspace reservation offers exact WaitId retry without exposing
  another Run

#### Scenario: Other-worktree Run is read only

- **WHEN** exact detail marks `workspace.scope: other`
- **THEN** the page shows WorkspaceInstanceId/context but no mutation controls
- **AND** the default Operations list remains current-worktree only

### Requirement: Operations loading and errors preserve space context

Every Run list/detail/control request from Task detail SHALL carry the page's
opaque selected-space token. Loading, not-found, invalid-Run, unauthorized, and
control-conflict states SHALL be explicit and SHALL preserve the rest of the
Task page rather than replacing healthy planning/session data with stale
Operations content.

#### Scenario: Store Task reads store Runs only

- **WHEN** a Task detail page is scoped to store `S`
- **THEN** every Operations list/detail/control request carries `store:S` and
  same-named Runs from another space are absent

#### Scenario: Duplicate project clones keep exact opaque route scope

- **WHEN** two clones share projectId and the page is opened with one
  server-issued exact selected-space token
- **THEN** list, detail, cursor, and control requests retain that opaque token
  rather than collapsing it to projectId
- **AND** an ambiguous project-only response shows a selection error and sends
  no control

#### Scenario: One invalid Run does not blank the Task

- **WHEN** one Run detail is invalid or unavailable
- **THEN** its Operations panel shows the error while the child roster,
  checklist, and session column remain usable

#### Scenario: Archived in-flight Run remains operable

- **WHEN** the child Change source is archived/missing but its machine-home Run
  remains incomplete
- **THEN** Operations keeps the Run visible with source state and exact detail
  while unrelated Task content remains usable

#### Scenario: Additive view section does not break older UI

- **WHEN** a v1 detail includes an unknown future section beside root-dag
- **THEN** the UI ignores/preserves it and renders the known core/root section
- **AND** an unknown top-level major produces a typed unsupported-version state

#### Scenario: Unauthorized follows shared handling

- **WHEN** an Operations request returns 401
- **THEN** the app uses the existing full-screen re-launch notice rather than
  an unauthenticated inline control
