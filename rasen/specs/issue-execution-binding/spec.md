# issue-execution-binding Specification

## Purpose
This capability binds an Issue's plan nodes to the execution contexts they run in.
`rasen store issue start` resolves the node that is next to execute (the operator's `--node`
choice, or the single not-started node whose dependencies' work is complete) and emits its
launch contract: the Change instance and alias, the member project and target line, the working
directory to launch from, and the pipeline to run when one is known. The working directory is
composed from the Store's workspace index or the member project's registered checkout, never
invented. A node already running or complete is reported, not restarted, and the Issue read
surface carries per-node attribution facts (recorded pipeline, durable session pointers,
evidence locator) that join execution back to the Issue. The binding and its attribution are
derived at read time and persisted nowhere.

## Requirements
### Requirement: Starting an Issue's node resolves its bound execution context

`rasen store issue start` SHALL resolve, for one Issue, the plan node that is next to execute and
the execution context it is bound to, and SHALL emit the launch contract — the Issue, the node,
the Change instance and alias, the member project and target line, the working directory to
launch from, the attached Store planning root, and the pipeline to run when one is known. For a
fresh node the pipeline SHALL be known in this order: an explicit `--pipeline` first, then the
pipeline the node's run-state records, then the pipeline the plan revision records as the node's
suggestion — a suggestion is a proposal the operator's explicit choice overrides without
refusal, and the contract SHALL name which source supplied the pipeline. For a node already
running, the recorded pipeline SHALL lead exactly as before, and an explicit `--pipeline` that
disagrees with it SHALL still be refused. The
next-to-execute node SHALL be the node the operator names with `--node`, or the single node of
the lifecycles the plan still wants — `required` or `optional` — that has not started and whose
dependencies' work is complete; when several nodes qualify the command
SHALL refuse naming every candidate rather than choose one, and when none qualifies it SHALL
refuse naming why. Dependency gating SHALL be edge-wise and project-blind: a dependency whose
node targets another member project gates its downstream exactly as a same-project dependency
does, and the gate releases on completed work — terminal run-state or finalized evidence —
never on archiving. A refusal that names blockers SHALL name each one's node identifier, its
target project, and its current observed state, and SHALL distinguish a dependency no local
run-state explains from one observed not-started, and a dependency whose reference or run-state
could not be read (`unknown`, with its diagnostic) from either. A node the operator names whose
lifecycle is `cancelled`, `superseded`, or `deferred` SHALL be refused, naming that lifecycle
and the node's recorded reason, because the plan says its work is not demanded now — a deferred
node's refusal points at re-publishing a revision whose lifecycle wants the work, never at a
side door around the plan. An Issue with no readable published plan SHALL be refused toward planning.
The command resolves and verifies the binding; launching the pipeline itself remains an action
for the operator or agent session that receives the contract, executed from the emitted working
directory.

#### Scenario: A single frontier node yields its launch contract

- **WHEN** an Issue's plan has one not-started node whose dependencies' work is complete, and `rasen store issue start` runs for that Issue
- **THEN** the command emits the node's launch contract naming the Change, the member project, the working directory to launch from, and the attached Store planning root

#### Scenario: A fresh node's recorded suggestion supplies the pipeline

- **WHEN** a fresh node's revision records `suggestedPipeline: small-feature` and `store issue start` runs for it with no `--pipeline`
- **THEN** the emitted contract's pipeline is `small-feature`, named as coming from the plan's suggestion
- **AND** an explicit `--pipeline` on the same invocation overrides the suggestion without refusal, named as the operator's choice

#### Scenario: A running node's recorded pipeline still leads

- **WHEN** `store issue start --node` addresses a node whose run-state records a pipeline and no `--pipeline` is given
- **THEN** the contract's pipeline is the recorded one, whichever value the revision's suggestion carries
- **AND** an explicit `--pipeline` disagreeing with the recorded value is refused exactly as before

#### Scenario: Several runnable nodes are named, not chosen among

- **WHEN** an Issue's plan has two not-started nodes whose dependencies' work are complete
- **THEN** the command refuses, naming every runnable node
- **AND** names the `--node` selection the operator must make

#### Scenario: A blocked node names its blockers

- **WHEN** `--node` names a node whose dependencies' work is not complete
- **THEN** the command refuses, naming the nodes whose work must complete first

#### Scenario: A cross-project blocker is named with its project and state

- **WHEN** `--node` names a not-started node one of whose dependencies targets another member project and is in flight
- **THEN** the command refuses, naming that dependency's node, its target project, and its in-flight observation
- **AND** the refusal names every other non-terminal dependency the same way, each with its own project and observed state

#### Scenario: A cross-project dependency releases on completed work

- **WHEN** a dependency targeting another member project has terminal run-state while its Change is not yet archived
- **THEN** the downstream node is runnable and its launch contract is emitted
- **AND** the gate does not wait for the dependency's archive

#### Scenario: A blocker with no local run-state is named as such

- **WHEN** a non-terminal dependency's run-state is not visible from the machine the command runs on
- **THEN** the refusal names that dependency with its project and says no local run-state explains it
- **AND** the absence is not presented as a recorded not-started state

#### Scenario: An unreadable blocker is named unknown with its diagnostic

- **WHEN** a dependency's reference does not resolve or its run-state file cannot be parsed
- **THEN** the refusal names that dependency as unknown with its project and the diagnostic
- **AND** the dependency still gates its downstream

#### Scenario: An Issue without a plan is refused toward planning

- **WHEN** `rasen store issue start` runs for an Issue with no readable published plan
- **THEN** the command refuses, naming the planning phase and the publish action that precedes execution

#### Scenario: A cancelled node is refused at start

- **WHEN** `--node` names a node whose lifecycle is `cancelled`
- **THEN** the command refuses, naming the node, its cancelled lifecycle, and its recorded reason
- **AND** no launch contract is emitted

#### Scenario: A superseded node is refused at start

- **WHEN** `--node` names a node whose lifecycle is `superseded`
- **THEN** the command refuses, naming the node, its superseded lifecycle, and its recorded reason
- **AND** no launch contract is emitted

#### Scenario: The runnable frontier never names a cancelled node

- **WHEN** an Issue's plan has one not-started `required` node and one not-started `cancelled` node, both otherwise runnable
- **THEN** the frontier resolves to the required node alone
- **AND** a several-candidates refusal, had both qualified, would not name the cancelled node

#### Scenario: A deferred node is refused at start

- **WHEN** `--node` names a node whose lifecycle is `deferred`
- **THEN** the command refuses with its own refusal code, naming the node, its deferred lifecycle, and its recorded reason
- **AND** no launch contract is emitted, and the frontier never names the deferred node as a candidate

### Requirement: The launch context composes the member-project binding

The working directory a launch contract emits SHALL come from the Change's own binding, composed
and never invented: the execution root recorded for that Change's instance in the Store's
workspace index, or the member project's registered checkout resolved through the same
session-launch composition a supervised session uses — member-project working directory, Store
planning root attached as context, the Store's membership record vouching for the project, and
the checkout's recorded identity checked against the chosen project. When neither binding exists
the command SHALL refuse and name the exact workspace preparation that would create it, and a
launch-context failure SHALL carry the session-launch composition's own diagnostic through
rather than replace it. When a pipeline name is supplied it SHALL be validated against the
pipeline registry before the contract is emitted.

#### Scenario: A workspace-bound Change launches from its pair's execution root

- **WHEN** the node's Change instance has a workspace index entry recording an execution root
- **THEN** the emitted contract's working directory is that execution root
- **AND** the contract labels the binding as the workspace pair

#### Scenario: A registered checkout launches with the Store attached

- **WHEN** the node's Change has no workspace index entry and its member project resolves through the session-launch composition
- **THEN** the emitted contract's working directory is the member project's checkout
- **AND** the Store planning root is carried as attached context

#### Scenario: An unprepared Change names its preparation

- **WHEN** the node's Change has neither a workspace index entry nor a resolvable member-project checkout
- **THEN** the command refuses with the exact `store workspace plan --existing-change` command that prepares the binding

#### Scenario: A launch-context failure carries its own diagnostic

- **WHEN** the session-launch composition refuses the member project, for membership or identity
- **THEN** the refusal carries that composition's diagnostic and repair guidance unchanged

#### Scenario: The start command writes nothing

- **WHEN** `rasen store issue start` resolves and emits a launch contract
- **THEN** the Issue record, every plan revision, every run-state file, and the workspace index are byte-identical before and after

### Requirement: A running node is reported, not restarted

When the node `start` addresses has already begun or completed, the command SHALL report that
node's real state with a resume-oriented contract — the pipeline recorded in its run-state, its
run-state location, and the launch working directory — rather than a fresh-launch contract, and
a node whose work is complete SHALL be reported complete with no launch contract at all. A
`--pipeline` value SHALL be recorded in the contract as the pipeline to run; when the node's
run-state already records a pipeline, both values SHALL agree or the command SHALL refuse the
disagreement.

#### Scenario: An in-flight node is reported running

- **WHEN** `rasen store issue start --node` addresses a node whose Change has in-flight run-state
- **THEN** the command reports the node as running, carrying the pipeline and run-state location its run-state records

#### Scenario: A complete node is reported complete

- **WHEN** `--node` addresses a node whose work is complete or finalized
- **THEN** the command reports the node complete and emits no launch contract

#### Scenario: A conflicting pipeline choice is refused

- **WHEN** `--pipeline` names a pipeline and the addressed node's run-state records a different one
- **THEN** the command refuses, naming both values

### Requirement: Run and Session facts are attributed per node

The Issue read surface SHALL carry, for each plan node whose run-state was located, the
attribution facts that join the node's execution back to the Issue: the pipeline recorded in its
run-state, the durable session pointers its stages record — each carrying its stage, role,
runtime, and whichever of the session id, thread id, and transcript location that stage's worker
recorded — and the locator of the Change's evidence directory when its planning address
resolves. A live agent handle SHALL NOT be presented as a durable session fact, and a run-state
that records no session pointers SHALL report none rather than synthesize any. The `--json` form
SHALL carry the same attribution facts as the human form.

#### Scenario: A node carries its recorded session pointers

- **WHEN** a node's located run-state records stage workers with session ids and transcript locations
- **THEN** the node's attribution on the Issue read surface lists each stage's role, runtime, session id, and transcript location

#### Scenario: A run without session pointers reports none

- **WHEN** a node's located run-state records no stage workers
- **THEN** the node's attribution reports no session facts
- **AND** no session fact is synthesized

#### Scenario: Live agent handles are excluded

- **WHEN** a stage's worker record carries a live agent handle alongside its durable pointers
- **THEN** the durable pointers are attributed and the live handle is not presented as durable

### Requirement: The binding and its attribution add no second mutable truth

The launch binding and the attribution facts SHALL be derived at read time from the plan
revision, the Store's membership and committed evidence, and the workspace index, and SHALL be
persisted nowhere: no binding or attribution value SHALL be written into an Issue record, a plan
revision, a Change's run-state, or the workspace index by the start command or by the Issue read
surface. Reading the same Issue over unchanged evidence SHALL yield the same binding and
attribution.

#### Scenario: An attribution read writes nothing

- **WHEN** an Issue's status and attribution are read
- **THEN** the Issue record, plan revisions, run-state files, and workspace index are byte-identical before and after

#### Scenario: Unchanged evidence yields the same binding

- **WHEN** `rasen store issue start` resolves the same Issue twice with no change to its plan, evidence, or index
- **THEN** both invocations emit the same launch contract

### Requirement: Confirming a plan composes the launch contract set

`rasen store issue confirm <issue-id> [--revision <id>]` SHALL be the Issue dispatch's confirm step: it SHALL resolve the named revision, or the latest readable revision when none is named, refusing an Issue with no readable revision toward planning exactly as start does. It SHALL verify every Change node's instance against committed Store evidence and compose, for every node the plan still wants whose dependencies' work is complete and whose Change is bound, the same launch contract `store issue start` would emit for it — working directory, project, line, and pipeline under the same resolution order, suggestion included. A node the plan still wants whose observation is anything other than `not-started` SHALL receive that same per-node resolution regardless of its dependencies' observed state — dependency gating applies to fresh launches, and a begun node is reported as what it is (a resume-oriented or report-only contract, or an unprepared report), never as waiting. Every intent node the revision still carries SHALL be reported as pending Change creation, named with its target project, target line, and suggestion, because confirm composes contracts and mints nothing. The command SHALL write nothing — the Issue record, every revision, every run-state file, and the workspace index are byte-identical before and after — and SHALL refuse, naming the defect, a revision whose Change reference does not resolve or whose revision cannot be read. Confirm is a read: the five declared Issue mutations stay five, and starting a confirmed node remains the operator's per-node act.

#### Scenario: Confirm reports the launchable set and the pending work

- **WHEN** an Issue's latest revision carries one launchable Change node and one intent node and `rasen store issue confirm` runs
- **THEN** the report carries the Change node's launch contract and names the intent node as pending Change creation with its target project, line, and suggestion
- **AND** the human and `--json` forms carry the same facts

#### Scenario: A begun node keeps its per-node resolution over an incomplete dependency

- **WHEN** a wanted node's observation is in-flight while a dependency it still names has not started
- **THEN** the report carries the begun node's resume-oriented contract, not a waiting entry
- **AND** the not-started dependency is itself part of the launchable scope exactly as the ready set derives it

#### Scenario: Confirm refuses an unresolvable reference

- **WHEN** the resolved revision names a Change instance no committed Store evidence resolves
- **THEN** confirm refuses, naming the node and the missing evidence
- **AND** no contract set is reported as launchable

#### Scenario: Confirm refuses a named revision that does not read back with the readable range

- **WHEN** `--revision` names a revision that does not read back on an Issue that has published revisions
- **THEN** confirm refuses with its own refusal, naming the requested revision id and the Issue's readable revision range with its latest
- **AND** the refusal's advice points at reading the ordinals, never at publishing a new revision

#### Scenario: Confirm writes nothing

- **WHEN** `rasen store issue confirm` runs to completion
- **THEN** the Issue record, every plan revision, every run-state file, and the workspace index are byte-identical before and after
- **AND** no Change, worktree, or run is created
