## MODIFIED Requirements

### Requirement: A decomposition publishes as a reviewable intent-node revision

`rasen store issue plan <issue-id> --from-decomposition <path>` SHALL read a decomposition document and publish the Issue's next Execution Plan revision as a reviewable execution graph: one intent
node per proposed piece of work, each naming its target project and target line, carrying its
dependency edges as node dependencies, a suggested pipeline, and at least one of a decomposition
rationale or an uncertainty statement. An authored lifecycle — `optional` where optional work is
proposed, absent reading `required` — SHALL be compiled ONTO the intent node: the revision, not
the document, is the durable record of the required/optional proposal, so the review surface, the
revision delta, and every later consumer read one record instead of reconciling two. Publishing
SHALL still leave the decomposition document byte-identical as authored input. The same rules manual authoring
is held to SHALL apply unchanged — normalization, duplicate and cycle and dangling-dependency
refusal, and the planning-member target rule, so a decomposition may propose only work for
projects that plan in this Store. A document that does not read back SHALL be refused as unreadable, never treated
as absent. A document whose node names an existing Change instance SHALL be refused naming
`--from-portfolio` as the source for that shape. A node missing its suggested pipeline, or
carrying neither a rationale nor an uncertainty, SHALL be refused naming the node and the missing
field.

#### Scenario: A decomposition document publishes as intent nodes with suggestions and rationale

- **WHEN** an Issue's plan is published from a decomposition document proposing three pieces of work with dependency edges between them
- **THEN** the new revision carries three intent nodes, each naming its target project and line, its edges, its suggested pipeline, and its rationale or uncertainty
- **AND** the revision is reviewable on the Issue read surface without starting any work

#### Scenario: An authored optional proposal lands on the intent node

- **WHEN** a decomposition document proposes one node with an `optional` lifecycle
- **THEN** the published intent node carries `optional`, and the read surface names it on that node's line
- **AND** the decomposition document's bytes are identical before and after the publication

#### Scenario: A change-kind node in a decomposition is refused toward the portfolio source

- **WHEN** the decomposition document carries a node that names an existing Change instance
- **THEN** publication is refused, naming the node and `--from-portfolio` as the source for binding existing Changes
- **AND** no revision is created

#### Scenario: A node without a suggestion or rationale is refused

- **WHEN** the decomposition document carries a node with no suggested pipeline, or with neither a rationale nor an uncertainty
- **THEN** publication is refused naming the node and the missing field
- **AND** no revision is created

#### Scenario: The decomposition document is left byte-identical

- **WHEN** a plan is published from a decomposition document
- **THEN** the document's bytes are identical before and after the publication

#### Scenario: A knowledge-only target in a decomposition is refused

- **WHEN** the decomposition document proposes a node whose target project the Store records with `planning: false`
- **THEN** publication is refused under the same planning-member rule as manual authoring, naming the project and its recorded roles
- **AND** no revision is created
