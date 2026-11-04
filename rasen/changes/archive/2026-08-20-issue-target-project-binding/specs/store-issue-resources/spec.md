## ADDED Requirements

### Requirement: A plan node's target project is a planning member of the Store

A plan node's target project SHALL be a member project of the Store whose
planning role is true — the `projectId` the node names, which decides which
member project's checkout the node's Change launches from. Publishing an
Execution Plan SHALL refuse a node whose target project the Store records as a
knowledge member only, naming the project, its recorded roles, the Store's
planning members, and the membership repair that would make it a planning
member, and no revision SHALL be created. A node naming a project for which
the Store holds no membership record at all SHALL be refused naming that
project and the members that are recorded. An intent node SHALL be held to the
same rule as a Change node: it names work for a project and line before any
Change exists, so the roster is the only scope fact it can be checked against.
Membership confers eligibility to be targeted; it does not choose the target —
which member project a node names remains the plan author's decision.

A node SHALL name exactly one target project, and one Change instance SHALL be
named by at most one node in a revision, so a Change is bound to one primary
project by construction. A revision that declares a second node for a Change
instance one of its nodes already names SHALL be refused naming both nodes. A
node's target project SHALL change only as a new revision: the next revision
names the new project, and the earlier revision's bytes — including the node's
previous project — never change.

The planning-member rule binds publication. Reading a revision SHALL never
re-verify membership: a revision published before this rule existed, including
one whose target project's roles have since changed, SHALL read back with its
digest verifying and its derivation unchanged.

#### Scenario: A knowledge-only member is refused as a target

- **WHEN** a plan node names a project the Store records with `planning: false` and `knowledge: true`
- **THEN** publication is refused, naming the project, its recorded roles, and the Store's planning members
- **AND** the refusal carries the membership repair that would make the project a planning member, and no revision is created

#### Scenario: A project with no membership record is refused

- **WHEN** a plan node names a project for which the Store holds no membership record
- **THEN** publication is refused, naming that project and the members the Store does record
- **AND** no revision is created

#### Scenario: An intent node is held to the same target rule

- **WHEN** an intent node names a knowledge-only member as its target project
- **THEN** publication is refused under the same rule as a Change node, naming the project and its recorded roles
- **AND** no revision is created

#### Scenario: One Change instance is named by one node

- **WHEN** a revision declares two nodes that both name one Change instance
- **THEN** publication is refused, naming both nodes
- **AND** a Change's work stays bound to one node, one target project, in one revision

#### Scenario: Retargeting a node is a new revision, never a rewrite

- **WHEN** a plan is re-published with one node's target project changed
- **THEN** the new revision exists at the next ordinal naming the new project
- **AND** the earlier revision's bytes, including that node's previous project, are unchanged

#### Scenario: A plan may name several planning members

- **WHEN** a plan's nodes target two different projects that are both planning members of the Store
- **THEN** the revision publishes with each node naming its own target project
- **AND** no rule requires the revision's nodes to share one project

#### Scenario: A revision published before this rule reads as before

- **WHEN** a revision published before the planning-member rule existed is read back, including one whose target project's roles no longer satisfy the rule
- **THEN** its stored digest still verifies against its bytes
- **AND** its nodes, their target projects, and every derived fact read exactly as they did when it was published
