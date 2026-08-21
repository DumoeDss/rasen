## MODIFIED Requirements

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
could not be read (`unknown`, with its diagnostic) from either. A node the operator names whose lifecycle is `cancelled` or `superseded`
SHALL be refused, naming that lifecycle and the node's recorded reason, because the plan says
its work is not wanted. An Issue with no readable published plan SHALL be refused toward planning.
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

## ADDED Requirements

### Requirement: Confirming a plan composes the launch contract set

`rasen store issue confirm <issue-id> [--revision <id>]` SHALL be the Issue dispatch's confirm step: it SHALL resolve the named revision, or the latest readable revision when none is named, refusing an Issue with no readable revision toward planning exactly as start does. It SHALL verify every Change node's instance against committed Store evidence and compose, for every node the plan still wants whose dependencies' work is complete and whose Change is bound, the same launch contract `store issue start` would emit for it — working directory, project, line, and pipeline under the same resolution order, suggestion included. Every intent node the revision still carries SHALL be reported as pending Change creation, named with its target project, target line, and suggestion, because confirm composes contracts and mints nothing. The command SHALL write nothing — the Issue record, every revision, every run-state file, and the workspace index are byte-identical before and after — and SHALL refuse, naming the defect, a revision whose Change reference does not resolve or whose revision cannot be read. Confirm is a read: the five declared Issue mutations stay five, and starting a confirmed node remains the operator's per-node act.

#### Scenario: Confirm reports the launchable set and the pending work

- **WHEN** an Issue's latest revision carries one launchable Change node and one intent node and `rasen store issue confirm` runs
- **THEN** the report carries the Change node's launch contract and names the intent node as pending Change creation with its target project, line, and suggestion
- **AND** the human and `--json` forms carry the same facts

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
