## MODIFIED Requirements

### Requirement: A plan publication takes exactly one source

`--from-file`, `--from-portfolio`, and `--from-decomposition` SHALL be the three sources a plan
publication accepts, and exactly one SHALL be given per invocation. Any two together, or none,
SHALL be refused naming the sources, because the three answer different questions — a hand-authored
node list, a compiled portfolio run, and a machine-proposed decomposition — and guessing a default
would publish a plan the operator never chose.

#### Scenario: Both sources together are refused

- **WHEN** `rasen store issue plan` runs with two of its three sources given together
- **THEN** the command refuses, naming both sources and that one must be chosen
- **AND** the refusal names the third source the publication also accepts

#### Scenario: No source is refused

- **WHEN** `rasen store issue plan` runs with none of `--from-file`, `--from-portfolio`, or `--from-decomposition`
- **THEN** the command refuses, naming the three sources the publication accepts

#### Scenario: A decomposition beside another source is refused

- **WHEN** `rasen store issue plan` runs with `--from-decomposition` together with `--from-file` or `--from-portfolio`
- **THEN** the command refuses, naming both given sources
- **AND** the decomposition document is not read

### Requirement: A published revision reports where it came from

A successful publication SHALL report the Issue, the new revision and its ordinal, the source it
compiled from, and the node count — the same facts in the human form and the `--json` form — beside
the pathspec-scoped commit suggestion plan publication already prints, and SHALL stage nothing. A
portfolio publication SHALL report the portfolio parent and the located run-state path; a
decomposition publication SHALL report the decomposition document path it read.

#### Scenario: Both forms carry the source facts

- **WHEN** a plan is published from a portfolio in human form and in `--json` form
- **THEN** both name the parent, the located run-state path, the revision ordinal, and the child count
- **AND** both carry the commit suggestion, and the Store's Git index is untouched

#### Scenario: A decomposition publication reports its document and node count

- **WHEN** a plan is published from a decomposition document in human form and in `--json` form
- **THEN** both name the decomposition document path, the revision ordinal, and the node count
- **AND** both carry the commit suggestion, and the Store's Git index is untouched

## ADDED Requirements

### Requirement: A decomposition publishes as a reviewable intent-node revision

`rasen store issue plan <issue-id> --from-decomposition <path>` SHALL read a decomposition document
and publish the Issue's next Execution Plan revision as a reviewable execution graph: one intent
node per proposed piece of work, each naming its target project and target line, carrying its
dependency edges as node dependencies, a suggested pipeline, and at least one of a decomposition
rationale or an uncertainty statement. An authored lifecycle — `optional` where optional work is
proposed, absent reading `required` — SHALL be recorded in the decomposition document ALONE: the
document is the sole durable record of the required/optional proposal, and the compiled intent
node deliberately carries no lifecycle at all (the plan schema forbids one, exactly as
`store-issue-resources` holds), so the proposal surfaces at review time through the document —
which this requirement preserves byte-identical for exactly that reason — and how the confirm
flow consumes it is that flow's decision, not this publication's. The same rules manual authoring
is held to SHALL apply unchanged — normalization, duplicate and cycle and dangling-dependency
refusal, and the planning-member target rule, so a decomposition may propose only work for
projects that plan in this Store. Publishing SHALL leave the decomposition document
byte-identical. A document that does not read back SHALL be refused as unreadable, never treated
as absent. A document whose node names an existing Change instance SHALL be refused naming
`--from-portfolio` as the source for that shape. A node missing its suggested pipeline, or
carrying neither a rationale nor an uncertainty, SHALL be refused naming the node and the missing
field.

#### Scenario: A decomposition document publishes as intent nodes with suggestions and rationale

- **WHEN** an Issue's plan is published from a decomposition document proposing three pieces of work with dependency edges between them
- **THEN** the new revision carries three intent nodes, each naming its target project and line, its edges, its suggested pipeline, and its rationale or uncertainty
- **AND** the revision is reviewable on the Issue read surface without starting any work

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
