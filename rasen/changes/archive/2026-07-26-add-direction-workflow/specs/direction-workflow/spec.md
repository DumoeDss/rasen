## ADDED Requirements

### Requirement: Direction is an explicit optional workflow above Change

The system SHALL provide a built-in skill named `rasen-direction` for governing
long-lived direction across multiple Changes. Direction SHALL run only when a
user explicitly invokes it or accepts an explicit suggestion, and ordinary
Rasen work SHALL remain usable when no Direction artifact or skill is present.
The workflow SHALL NOT be an automatic Change pipeline stage or an automatic
next-step edge in the ordinary Change lifecycle.

#### Scenario: Ordinary work has no Direction prerequisite

- **WHEN** a project has no `rasen/work/` directory, North Star, Target State,
  Roadmap, workstream manifest, or installed `rasen-direction` skill
- **THEN** ordinary init, update, propose, auto, goal-loop, apply, verify, ship,
  sync, and archive behavior SHALL remain available without a Direction error
  or prerequisite

#### Scenario: Installing the skill does not adopt Direction

- **WHEN** init or update installs the selected `rasen-direction` skill
- **THEN** it SHALL generate the skill through the normal workflow installation
  surface
- **AND** it SHALL NOT create `rasen/work/`, `work.yaml`, `north-star.md`,
  `target-state.md`, `roadmap.md`, or a slice

#### Scenario: Possible long-lived work is only suggested

- **WHEN** an agent observes that work may span multiple Changes, versions,
  horizons, projects, or repeated principle-level decisions
- **THEN** it MAY offer `rasen-direction` once as a non-blocking option
- **AND** declining, ignoring, or bypassing that option SHALL leave the current
  workflow unchanged

### Requirement: Direction resolves a planning root and discovers workstreams safely

The Direction skill SHALL honor explicit Store/project selection using Rasen's
existing store-selection rules, derive its planning root from CLI-resolved
planning context, and discover experimental workstreams under the planning
root's `rasen/work/` area. It SHALL use platform-native path handling and SHALL
reject a resolved artifact reference that escapes the selected planning root.

#### Scenario: Repo-local discovery

- **WHEN** the user invokes Direction in a repo-local Rasen project
- **THEN** the skill SHALL derive the planning root from Rasen CLI JSON rather
  than assuming that the shell's current directory is the planning root
- **AND** it SHALL discover workstreams relative to that resolved root

#### Scenario: Store-scoped discovery

- **WHEN** the user explicitly names a registered Store or project
- **THEN** the skill SHALL resolve the selection with `rasen store list --json`
  and thread the same `--store <id>` or `--project <id>` selection through
  relevant Rasen planning commands
- **AND** Direction artifacts SHALL be read or written only in that selected
  planning root

#### Scenario: Cross-platform artifact references

- **WHEN** a workstream contains relative references on Windows, macOS, or Linux
- **THEN** the skill SHALL resolve them against their containing artifact using
  platform-native path semantics
- **AND** a missing, malformed, absolute-outside-root, or traversal reference
  SHALL stop the Direction action with a repair instruction rather than being
  guessed or followed

#### Scenario: Missing workstream for a non-Establish action

- **WHEN** Calibrate, Select, Project, or Reconcile is requested and no matching
  workstream exists
- **THEN** the action SHALL make no Direction or Change mutation
- **AND** it SHALL offer Establish as the single repair/next action

### Requirement: Direction uses a thin Git-native workstream model

New Direction workstreams SHALL live under `rasen/work/<work-id>/` and SHALL
contain `work.yaml`, `target-state.md`, `roadmap.md`, and slice directories.
A workstream MAY contain or inherit one `north-star.md`. Each slice SHALL use
`spec.md`, `plan.md`, and an evidence-backed `result.md`, with `log.md` optional.
The manifest SHALL remain a thin discovery/lifecycle index and SHALL NOT
duplicate specifications, implementation tasks, Change state, Run/Session
state, or evidence prose.

#### Scenario: New workstream artifact set

- **WHEN** the user confirms Establish for a new workstream
- **THEN** the workstream SHALL contain a portable id, a Target State, a concise
  Roadmap, and a proposed first vertical slice
- **AND** North Star creation SHALL remain optional

#### Scenario: Thin manifest content

- **WHEN** the skill creates or updates `work.yaml`
- **THEN** it SHALL record version `1`, the workstream id, lifecycle status,
  Target State and Roadmap references, zero or one active slice, an optional
  North Star authority reference, and an optional last-reconciled timestamp
  and revision
- **AND** status SHALL be one of `draft`, `active`, `paused`, `completed`, or
  `superseded`
- **AND** it SHALL NOT copy Roadmap prose, Change tasks, Run status, or evidence
  into the manifest

#### Scenario: One active slice

- **WHEN** a workstream selects work for execution
- **THEN** `work.yaml` SHALL reference at most one active slice
- **AND** any safe parallelism or multiple Changes SHALL be represented inside
  that slice's plan or projected portfolio

#### Scenario: Experimental model is not presented as stable CLI schema

- **WHEN** the generated skill describes `work.yaml` and the Direction artifact
  layout
- **THEN** it SHALL label them as experimental Git-native contracts
- **AND** it SHALL NOT claim a first-class Direction CLI, database, or stable
  public schema exists

### Requirement: Target State is distinct from rasen-goal

New Direction work SHALL use `target-state.md` for the desired product or
domain state of a cross-Change workstream. The skill SHALL distinguish this
artifact and lifecycle from the bounded `rasen-goal` workflow, whose artifacts
remain `goal-plan.md` and `goal-run.json`.

#### Scenario: New Direction work writes Target State

- **WHEN** Establish creates the desired-state artifact for a workstream
- **THEN** it SHALL create `target-state.md`
- **AND** it SHALL NOT create a Direction `goal.md`, `goal-plan.md`, or
  `goal-run.json`

#### Scenario: Legacy goal document is read-only compatibility input

- **WHEN** an experimental legacy workstream has `goal.md` but no
  `target-state.md`
- **THEN** Direction SHALL read and label `goal.md` as legacy Target State input
- **AND** Calibrate, Select, Project, or Reconcile SHALL NOT automatically
  rename, overwrite, delete, or migrate it

#### Scenario: Explicit legacy migration preserves history

- **WHEN** a user explicitly approves migration from legacy `goal.md`
- **THEN** the skill SHALL write the new desired state to `target-state.md`
- **AND** it SHALL preserve `goal.md` unless the user separately authorizes its
  removal

### Requirement: Direction enforces an authority order without replacing current truth

For an explicitly associated workstream, the skill SHALL interpret planning
authority in this order: optional North Star, Target State, Roadmap, Selected
Slice Spec, Slice Plan, then Change planning artifacts. Lower layers SHALL NOT
silently override higher layers. Current accepted product behavior SHALL still
come from main specs and implementation, Change delivery from Change artifacts
and Git, active execution from runtime state, and acceptance from observable
evidence.

#### Scenario: A future Roadmap claim is not current behavior

- **WHEN** a Roadmap or North Star names a future capability that is absent from
  current specs and implementation
- **THEN** the skill SHALL treat it as future direction rather than an existing
  product behavior or completed capability

#### Scenario: Lower-level conflict is surfaced

- **WHEN** a Slice Plan or Change artifact conflicts with Target State or an
  inherited North Star
- **THEN** Direction SHALL report the conflict and request the appropriate
  higher-level decision
- **AND** it SHALL NOT silently reinterpret the higher-level artifact

#### Scenario: Direction does not become execution truth

- **WHEN** Change, Run, Gate, PR, release, or dogfood status is needed
- **THEN** the skill SHALL inspect the authoritative existing artifact or
  runtime/evidence source
- **AND** it SHALL NOT infer that status solely from Roadmap text, checkboxes,
  or the manifest

### Requirement: Establish creates a reviewable draft before activation

The Establish action SHALL first search for an existing related workstream,
inspect current specs, changes, capabilities, and failure evidence, and then
draft a Target State, concise Roadmap, and first independently acceptable
vertical slice. It SHALL default to no North Star and SHALL require human
confirmation before activating the workstream or selected slice.

#### Scenario: Existing workstream is reused

- **WHEN** Establish discovers a workstream with the same durable scope
- **THEN** it SHALL present that workstream and offer Calibrate rather than
  creating a duplicate

#### Scenario: North Star is not required

- **WHEN** the requested workstream can inherit existing direction or does not
  need a separate long-term authority
- **THEN** Establish SHALL create the workstream without `north-star.md`
- **AND** the Target State and Roadmap SHALL remain valid Direction artifacts

#### Scenario: Human confirms the initial authority and slice

- **WHEN** Establish has drafted a Target State, optional North Star decision,
  Roadmap, and first Slice
- **THEN** it SHALL show the user what will become authoritative and what
  evidence closes the first Slice
- **AND** it SHALL leave the workstream draft until the user confirms activation

#### Scenario: Establish does not enter implementation

- **WHEN** Establish completes
- **THEN** it SHALL report the created/updated Direction artifact paths and one
  next action
- **AND** it SHALL NOT create application code or start a Change pipeline

### Requirement: Calibrate compares direction with observable reality

The Calibrate action SHALL load the authority chain and last reconciliation
baseline, compare it with current specs, changes, Git revisions, and available
run/delivery/dogfood evidence, and identify stale claims or references before
selection. It SHALL require confirmation for a material Target State scope
change.

#### Scenario: Roadmap text is not accepted as evidence

- **WHEN** a Roadmap marks a capability complete but current specs,
  implementation, or runtime evidence do not support it
- **THEN** Calibrate SHALL report the discrepancy and correct the factual
  capability baseline
- **AND** it SHALL NOT treat document presence, module count, or an unchecked
  runtime claim as proof

#### Scenario: Material Target State revision needs confirmation

- **WHEN** observed evidence suggests changing the workstream's outcome, scope,
  success criteria, or locked decisions
- **THEN** Calibrate SHALL present a Target State revision for human
  confirmation before applying the material change

### Requirement: Select commits one evidence-bearing vertical slice

The Select action SHALL choose from Roadmap candidates using user value,
uncertainty, dependencies, and observable exit evidence. It SHALL define a
slice that can be independently accepted, paused, failed, superseded, or
completed, and SHALL set it active only after user confirmation.

#### Scenario: Selected slice raises only necessary complexity

- **WHEN** candidates differ by multiple complexity dimensions
- **THEN** Select SHALL prefer a vertical slice that proves user value while
  raising only the dimensions required for that proof
- **AND** it SHALL record deferred complexity as Later or Not Now

#### Scenario: Acceptance precedes activation

- **WHEN** Select proposes the next slice
- **THEN** its `spec.md` SHALL state the user-visible outcome, reason to validate
  now, observable acceptance, explicit exclusions, and alignment with Target
  State and any North Star
- **AND** `activeSlice` SHALL change only after the user confirms the slice

#### Scenario: Parallel Changes remain one slice

- **WHEN** the selected outcome requires multiple Changes that can run in
  parallel
- **THEN** Select SHALL keep one Slice-level acceptance contract
- **AND** its `plan.md` SHALL describe the Change/portfolio boundaries,
  dependencies, parallelism, dogfood path, and evidence to return

### Requirement: Project hands a selected slice to the existing Change lifecycle

The Project action SHALL require a confirmed active slice and hand that slice
to one `rasen-propose` Change or an `auto-decompose` portfolio. It SHALL pass
the slice objective, boundaries, acceptance, target project context, and a
lightweight Direction source reference, while leaving Change technical design,
tasks, execution, verification, and delivery to existing lifecycles.

#### Scenario: One-Change projection

- **WHEN** the selected slice is independently deliverable as one Change
- **THEN** Project SHALL prepare that Slice Spec and Plan as input to
  `rasen-propose`
- **AND** the Change planning context SHALL retain a lightweight source
  reference to the workstream and slice

#### Scenario: Portfolio projection

- **WHEN** the selected slice legitimately spans multiple independently
  deliverable Changes
- **THEN** Project SHALL pass the selected slice to `auto-decompose`
- **AND** it SHALL NOT pass the entire Roadmap and ask auto-decompose to choose
  product direction

#### Scenario: Project does not implement

- **WHEN** Project has created or prepared the downstream Change/portfolio
  handoff
- **THEN** it SHALL report the downstream workflow as the next action
- **AND** `rasen-direction` itself SHALL NOT edit application code or execute
  implementation tasks

### Requirement: Reconcile returns evidence to the Roadmap without rewriting history

The Reconcile action SHALL read the active Slice, its historical Result, and
observable Change/Run/Git/PR/release/dogfood evidence; classify the outcome as
`passed`, `partial`, `failed`, `superseded`, or `cancelled`; update the current
Roadmap path and manifest baseline; and preserve the factual history of prior
attempts.

#### Scenario: Change completion is insufficient for Slice acceptance

- **WHEN** every required Change is complete but the Slice's observable
  acceptance or dogfood evidence is not satisfied
- **THEN** Reconcile SHALL record `partial` or `failed` as supported by evidence
- **AND** it SHALL NOT mark the Slice `passed`

#### Scenario: Roadmap changes while Result remains factual

- **WHEN** evidence changes which candidate Slice should come next
- **THEN** Reconcile SHALL update the Roadmap's current position and candidate
  order
- **AND** it SHALL preserve prior failures, attempts, revisions, and evidence in
  Result/Log/Git rather than rewriting them as current intent

#### Scenario: Stale and contradictory state is detected

- **WHEN** a referenced Change, branch, PR, artifact, or revision is stale or
  unresolvable, `activeSlice` conflicts with a Result, or checkboxes contradict
  authoritative state
- **THEN** Reconcile SHALL report the contradiction and either repair the
  projection from evidence or request a decision
- **AND** it SHALL NOT silently guess the intended state

#### Scenario: Workstream cannot remain vaguely active

- **WHEN** reconciliation finds no credible next Slice
- **THEN** it SHALL set or propose `completed` if Target State is satisfied,
  `paused` if an external condition or decision is required, or `superseded` if
  another workstream replaced it
- **AND** if Target State is unsatisfied with no credible path, it SHALL request
  replanning rather than report completion

### Requirement: North Star changes always require explicit human approval

North Star SHALL be an optional, durable authority containing long-term product
outcome, invariant principles, non-goals, remembered failure modes, maturity
horizons, health measures, and open long-term choices. No ordinary
implementation result, calibration, selection, or reconciliation SHALL modify
it automatically.

#### Scenario: Evidence suggests a long-term pivot

- **WHEN** a Result or repeated evidence appears to invalidate a North Star
  principle or long-term outcome
- **THEN** Direction SHALL present a separate proposed North Star revision with
  rationale and impact
- **AND** the existing North Star SHALL remain byte-unchanged until the user
  explicitly approves that revision

#### Scenario: Reconcile does not edit North Star

- **WHEN** Reconcile updates Result, Roadmap, Target State proposal, active
  Slice, or workstream status
- **THEN** it SHALL treat North Star as read-only unless the user has separately
  and explicitly approved a displayed North Star change

### Requirement: Direction reports durable state and one next action

After any action, the skill SHALL summarize the resolved workstream, authority
chain, files created or changed, evidence consulted, decisions made or awaiting
approval, detected conflicts, and exactly one recommended next action. It SHALL
not use chat history as the only place where a locked decision or result lives.

#### Scenario: Fresh agent can continue from Git artifacts

- **WHEN** a fresh agent receives only the planning root and workstream id
- **THEN** it SHALL be able to discover the optional North Star, Target State or
  labeled legacy input, current Roadmap, sole active Slice, prior Result, last
  reconciliation baseline, and next action from durable artifacts

#### Scenario: Direction action completes with a useful handoff

- **WHEN** Establish, Calibrate, Select, Project, or Reconcile finishes
- **THEN** the user-facing response SHALL identify the durable files and any
  pending human decision
- **AND** it SHALL close with one context-appropriate next action rather than an
  unranked menu
