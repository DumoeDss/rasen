## MODIFIED Requirements

### Requirement: A portfolio run publishes as an Execution Plan revision

`rasen store issue plan <issue-id> --from-portfolio <parent>` SHALL publish the
next Execution Plan revision for the Issue, carrying one Change node per child
the parent's portfolio run-state names. Each node SHALL name its child's Change
instance explicitly, carry the project and target line that Change is committed
under, and carry the child's dependency edges as its node dependencies. The
project a node carries IS its target project: it SHALL be the committed
claimant's own project, derived from the member-project structure the Store
records as committed evidence — never from the run-state, and never inferred
from a name. Each derived target SHALL satisfy the same planning-member
requirement manual authoring is held to: a child that resolves to a Change
committed under a member project that does not plan in this Store SHALL be
refused by name, with the project's recorded roles and the membership repair,
and no revision created. A single publication SHALL be free to carry nodes
whose target projects are different planning members. The
revision SHALL carry exactly what the run-state says: no Change reference SHALL
be inferred from a name prefix, and no child status, pipeline, cohort, or
delivery fact SHALL be written into a node. Publishing SHALL leave the
portfolio run-state file it read byte-identical.

#### Scenario: Every child becomes an explicit Change reference

- **WHEN** an Issue's plan is published from a parent whose portfolio run-state names three children with dependency edges between them
- **THEN** the new revision carries three Change nodes, each naming its child's Change instance, project, and target line
- **AND** each node's dependencies name the same children the run-state's edges name

#### Scenario: Publication leaves the run-state untouched

- **WHEN** a plan is published from a portfolio run-state
- **THEN** the portfolio run-state file's bytes are identical before and after the publication

#### Scenario: Re-publication after a transition appends a revision

- **WHEN** a plan was published from a portfolio, a child of that portfolio then completes, and the plan is published from the same portfolio again
- **THEN** a new revision exists at the next ordinal
- **AND** the earlier revision's bytes are unchanged

#### Scenario: Children in different member projects keep their own targets

- **WHEN** an Issue's plan is published from a portfolio whose children resolve to committed Changes in two different planning members of the Store
- **THEN** the new revision carries each node's target as the project its own Change is committed under
- **AND** the publication is not refused for spanning more than one member project

#### Scenario: A child in a knowledge-only member is refused

- **WHEN** a portfolio child resolves to a Change committed under a member project the Store records with `planning: false`
- **THEN** publication is refused, naming the child, the project, and its recorded roles
- **AND** the refusal carries the membership repair, and no revision is created
