## MODIFIED Requirements

### Requirement: Starting an Issue's node resolves its bound execution context

`rasen store issue start` SHALL resolve, for one Issue, the plan node that is next to execute and
the execution context it is bound to, and SHALL emit the launch contract — the Issue, the node,
the Change instance and alias, the member project and target line, the working directory to
launch from, the attached Store planning root, and the pipeline to run when one is known. The
next-to-execute node SHALL be the node the operator names with `--node`, or the single node of
the lifecycles the plan still wants — `required` or `optional` — that has not started and whose
dependencies' work is complete; when several nodes qualify the command
SHALL refuse naming every candidate rather than choose one, and when none qualifies it SHALL
refuse naming why. A node the operator names whose lifecycle is `cancelled` or `superseded`
SHALL be refused, naming that lifecycle and the node's recorded reason, because the plan says
its work is not wanted. An Issue with no readable published plan SHALL be refused toward planning.
The command resolves and verifies the binding; launching the pipeline itself remains an action
for the operator or agent session that receives the contract, executed from the emitted working
directory.

#### Scenario: A single frontier node yields its launch contract

- **WHEN** an Issue's plan has one not-started node whose dependencies' work is complete, and `rasen store issue start` runs for that Issue
- **THEN** the command emits the node's launch contract naming the Change, the member project, the working directory to launch from, and the attached Store planning root

#### Scenario: Several runnable nodes are named, not chosen among

- **WHEN** an Issue's plan has two not-started nodes whose dependencies' work is complete
- **THEN** the command refuses, naming every runnable node
- **AND** names the `--node` selection the operator must make

#### Scenario: A blocked node names its blockers

- **WHEN** `--node` names a node whose dependencies' work is not complete
- **THEN** the command refuses, naming the nodes whose work must complete first

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
