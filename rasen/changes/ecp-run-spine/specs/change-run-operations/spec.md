## ADDED Requirements

### Requirement: Change-run Operations list and detail share one projection

Rasen SHALL provide a space-scoped list of reconciler Runs and a detail view
for one exact Change/Run identity. Both SHALL expose the closed
`change-run-view/1` core and the same closed, ordered `root-dag/1` section from
the read-only Change-run projector used by CLI status. That section SHALL carry
frontier, zero-or-more active invocations/actions and full effect IDs, waits,
terminal, workspace/effect diagnostics, and allowed controls.
`waits[]` SHALL be stable-sorted by WaitId and MAY coexist with actions.
Summaries SHALL expose PlanningSpaceId, ChangeInstanceId, and
WorkspaceInstanceId/scope and SHALL use bounded cursor pagination.

#### Scenario: List summarizes a reconciler Run

- **WHEN** Operations lists a planning space containing a reconciler Run
- **THEN** the matching Change entry includes an engine-tagged summary with
  exact Run identity, status, Record version, and current waits or terminal state

#### Scenario: Detail exposes the canonical frontier

- **WHEN** Operations opens an exact Run detail
- **THEN** it receives the complete `root-dag/1` section and drift from the
  same committed Record version

#### Scenario: Actions and multiple waits coexist

- **WHEN** independent branches expose one active Action and two Gate waits
- **THEN** detail preserves all three, addresses each wait by WaitId, and keeps
  running status until no branch can progress

#### Scenario: CLI and Operations agree

- **WHEN** CLI status and Operations detail inspect the same Run without an intervening commit
- **THEN** their canonical Change-run view fields are deeply equal

#### Scenario: Additive section is forward compatible

- **WHEN** a `change-run-view/1` producer includes an unknown future section
  alongside `root-dag/1`
- **THEN** an older Operations consumer preserves or ignores that section and
  still renders the closed v1 core/root section

#### Scenario: Unknown view major fails typed

- **WHEN** detail receives an unsupported top-level Change-run view major
- **THEN** it reports `unsupported_view_version` rather than guessing v1 fields

#### Scenario: Invalid Run does not hide healthy Runs

- **WHEN** one canonical Run has a corrupt/gapped/abnormally named published
  ledger while other Changes have valid Runs
- **THEN** list reports the malformed entry with its reason and still returns
  the healthy Run summaries
- **AND** detail for the invalid Run exposes no fallback frontier or actions

### Requirement: Operations controls are safe projections of runtime control

Operations SHALL show only controls allowed by the current Change-run view.
Submitting a control SHALL include the displayed Record version and the exact
WaitId for a wait-scoped command and SHALL call
the runtime's typed control interface; the client SHALL refetch after success
or conflict and SHALL NOT optimistically patch runtime progress.

#### Scenario: Waiting Gate offers its declared decisions

- **WHEN** a Run detail is waiting at a Gate
- **THEN** Operations shows only the decisions, resume/escalate choices, or
  cancel operation declared as allowed by that wait
- **AND** every wait-scoped control binds that Gate's exact WaitId

#### Scenario: Uncertain effect does not offer resume

- **WHEN** a Run detail is waiting on an uncertain non-idempotent effect
- **THEN** Operations omits human resume and offers only escalation/cancel
  controls while a trusted Adapter performs effect observation

#### Scenario: Domain-blocked wait offers only frozen recovery controls

- **WHEN** an Action committed a domain-blocked result
- **THEN** Operations shows its structured reason/evidence and only the
  versioned retry/decision/escalate/cancel controls allowed by the profile

#### Scenario: Infrastructure wait remains distinct

- **WHEN** exact artifact, spawn, timeout, or sandbox setup failed
- **THEN** Operations labels the typed infrastructure code/artifact and does
  not render it as domain blocked or domain failed

#### Scenario: Workspace drift requires explicit acceptance

- **WHEN** no writer is active and the Run waits on workspace drift
- **THEN** ordinary resume is absent
- **AND** policy-allowed accept-revision with evidence, escalate, and cancel are
  the only projected controls

#### Scenario: Workspace reservation wait exposes safe retry

- **WHEN** local ready intents are blocked by another Run's workspace access
- **THEN** Operations shows only the local sorted intent/access identities and
  a version+WaitId resume affordance without leaking the blocker Run
- **AND** a still-busy retry does not increment the Record

#### Scenario: Control success renders committed truth

- **WHEN** an operator submits an allowed control with the current Record version
- **THEN** Operations renders the returned committed view/status
- **AND** browser responses contain no executable Action payload

#### Scenario: Browser control defers executable delivery

- **WHEN** an Operations control settles a downstream Action
- **THEN** the HTTP receipt contains no executable Action and the view marks it
  admitted_undelivered
- **AND** trusted CLI resume owns the first atomic delivery grant

#### Scenario: Control conflict refetches

- **WHEN** another actor advances the Run before an Operations control arrives
- **THEN** the stale control changes nothing and Operations refetches the
  current view with a conflict explanation

#### Scenario: Browser cannot submit arbitrary action completion

- **WHEN** a user opens Run detail
- **THEN** the UI provides no free-form result-completion form
- **AND** Agent/command/host completion remains a trusted execution-host seam

### Requirement: Operations preserves engine and planning-space identity

Operations SHALL tag each Run with its frozen engine and SHALL resolve list,
detail, and control within the selected project or store space. It SHALL never
mix same-named Changes from another space or silently switch a legacy Run to
reconciler ownership.

#### Scenario: Same Change name remains space-local

- **WHEN** two planning spaces contain a Change with the same name
- **THEN** Operations list/detail/control for one space addresses only that
  space's Run store

#### Scenario: Legacy and reconciler entries remain distinguishable

- **WHEN** a space contains legacy Run-file state and a reconciler Run history
- **THEN** each entry is tagged with its actual engine and rendered through its
  corresponding projection

#### Scenario: Archived in-flight Run remains discoverable

- **WHEN** an archive Action moved/deleted the active Change before completion
- **THEN** the read-only union list retains the machine-home Run with
  `sourceState` archived or missing
- **AND** exact detail/control stays addressable without a writable Run index

#### Scenario: Linked worktree mutation is isolated

- **WHEN** an exact Run belongs to another WorkspaceInstanceId in the same
  PlanningSpace
- **THEN** detail may show it read-only as other, default list omits it, and
  control fails `workspace_scope_mismatch`
- **AND** top-level `workspace.scope` is `other`, `allowedControls` and receipt
  action grants are empty

### Requirement: Operations communicates waits and drift without inventing state

The Operations detail SHALL present the `root-dag/1` exact wait kind/reason,
active Action/effect identities and workspace/effect diagnostics, plus
frozen-vs-current SourceRevision/Definition/capability/policy/workspace drift.
It SHALL display unavailable observation as unavailable rather than treating
it as unchanged.

#### Scenario: Uncertain effect is explicit

- **WHEN** a Run is suspended because an effect outcome is ambiguous
- **THEN** detail identifies the uncertain-effect wait and exact active
  invocation/effect without showing the effect as complete

#### Scenario: Changed definition is visible

- **WHEN** the current Pipeline source differs from the frozen source
- **THEN** detail shows definition drift while retaining the frozen pipeline,
  plan digest, and canonical frontier

#### Scenario: Drift cannot be observed

- **WHEN** the current source or capability catalog cannot be read
- **THEN** detail labels that comparison unavailable and does not infer unchanged
