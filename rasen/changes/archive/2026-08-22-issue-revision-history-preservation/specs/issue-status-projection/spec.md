# issue-status-projection Specification — Delta

## ADDED Requirements

### Requirement: Publishing a revision preserves other nodes' observations

Publishing a new Execution Plan revision SHALL NOT change any node's observed execution state
except through real execution or committed Store evidence: a node whose Change instance the
new revision redeclares under the same project, line, and recorded alias SHALL read the same
observation it read under the previous revision, fact for fact — nodes the revision adds,
dependency edges it adds or removes, and lifecycle changes it declares on other nodes leave
the untouched node's observation identical. A node whose lifecycle the revision changes to
`cancelled` or `superseded` keeps its recorded observation on its node line — outside the
execution graph, still observed — and a node whose dependency edges changed keeps its
observation while its dependency facts follow the new declaration. Publishing is not
execution: only run-state writes and committed Store evidence move an observation, so the
operator may replan freely knowing observed history is never disturbed by the replan itself.

#### Scenario: Adding a node leaves its siblings' observations identical

- **WHEN** an Issue's revision N reads one node terminal and one not-started, and revision N+1 adds a third node
- **THEN** the N+1 read reports the first node's terminal observation and the second's not-started fact-for-fact identical to the N read
- **AND** the added node reads not-started, carrying no observation of its siblings

#### Scenario: A superseded node keeps its observation on its line

- **WHEN** revision N reads a node `required` with terminal run-state and revision N+1 marks that node `superseded` with a recorded reason
- **THEN** the N+1 read still reports the node's terminal observation on its node line, beside the superseded lifecycle and its reason
- **AND** the Issue's phase, health, and progress derive from the other nodes alone, exactly as the lifecycle vocabulary already provides

#### Scenario: An edge change moves dependency facts, not observations

- **WHEN** revision N+1 adds a dependency edge from an unchanged node to a non-terminal node
- **THEN** the unchanged node's own observation is identical to its N reading
- **AND** its dependency facts name the new dependency while that dependency's work is not complete

#### Scenario: Replanning does not write execution state

- **WHEN** a new revision is published for an Issue whose nodes have recorded run-state
- **THEN** every run-state file, the Issue record, and every prior revision are byte-identical before and after the publication
- **AND** only a later real run or committed Store evidence can change any observation

### Requirement: A retargeted node starts a new observation lineage

A Change node whose target project or target line changes between revisions SHALL carry a new
Change instance — publication refuses a node that declares a project or line its Change
instance is not committed under — and the new revision's observation of that node SHALL
derive from the new instance alone: the node reads not-started unless the new instance
carries its own run-state or committed archive evidence, and no observation recorded against
the prior revision's instance is inherited by the retargeted node. The prior lineage's facts
SHALL remain readable where they live: the prior revision, immutable and digest-verified, and
the revision delta naming the retarget with both revisions' target facts. An intent node
carries no observation lineage — its observation is `not-started` by construction, whatever
its target.

#### Scenario: A retarget keeping the old instance is refused at publication

- **WHEN** a revision is authored redeclaring a node under a new project while naming the Change instance committed under the old project
- **THEN** publication is refused under the reference scope conflict, naming the node, the declared project and line, and the committed ones
- **AND** no revision is created, so no observation lineage can blur

#### Scenario: A retargeted node reads fresh while the prior revision keeps its history

- **WHEN** revision N reads a node terminal under project A, and revision N+1 redeclares that node under project B naming a new Change instance with no run-state and no archive evidence
- **THEN** the N+1 read reports the node not-started
- **AND** the revision delta names the retarget with both projects, and revision N still reads the node's terminal observation under project A

#### Scenario: A retargeted instance with its own evidence reads that evidence

- **WHEN** revision N+1 redeclares a node under project B naming a Change instance that already carries terminal run-state
- **THEN** the N+1 read reports the node's terminal observation from that instance's own evidence
- **AND** the observation is attributed to the new instance's run-state location, never to the prior lineage's

#### Scenario: An intent node's retarget carries no lineage

- **WHEN** revision N+1 retargets an intent node to another member project
- **THEN** the node's observation remains not-started by construction
- **AND** the revision delta names the retarget with both projects exactly as a Change node's
