# issue-plan-publication Specification

## Purpose
This capability publishes an Issue's Execution Plan from a parent change's portfolio run-state.
`rasen store issue plan <issue-id> --from-portfolio <parent>` compiles the parent's portfolio
run-state into the Issue's next Execution Plan revision: one Change node per child the run-state
names, each an explicit reference to exactly one committed Store Change — carrying that Change's
project, its target line, and the child's dependency edges — with no Change reference inferred
from a name and no status or delivery fact the run-state does not carry. A child that resolves to
no committed Change, exists only in a local worktree, is claimed ambiguously, or hits an
unreadable Store ref is refused by name rather than guessed at, and a successful publication
leaves the run-state it read byte-identical.

## Requirements
### Requirement: A portfolio run publishes as an Execution Plan revision

`rasen store issue plan <issue-id> --from-portfolio <parent>` SHALL publish the
next Execution Plan revision for the Issue, carrying one Change node per child
the parent's portfolio run-state names. Each node SHALL name its child's Change
instance explicitly, carry the project and target line that Change is committed
under, and carry the child's dependency edges as its node dependencies. The
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

### Requirement: Child Changes resolve against committed Store evidence

A child the run-state names SHALL be accepted only when exactly one committed
Change in the Store carries that child's name. Publication SHALL be refused,
with the reason named and no revision created, when a child names a Change that
is absent from the Store, that exists only as a local planning worktree on the
reading machine, that more than one committed Change claims, or that belongs to
another Store. A Store ref that cannot be read SHALL be reported as unsearched
rather than concluded as absence, and every ambiguous claimant SHALL be listed
rather than chosen among.

#### Scenario: A child with no committed Change is refused

- **WHEN** the portfolio run-state names a child whose Change exists in no committed Store evidence
- **THEN** publication is refused, naming the child and the search that found nothing
- **AND** no revision is created

#### Scenario: A child only in a local worktree is refused as uncommitted

- **WHEN** the portfolio run-state names a child whose Change exists only as a local planning worktree on the reading machine
- **THEN** publication is refused as uncommitted, naming the child and the machine-local locator
- **AND** no revision is created

#### Scenario: One child name claimed by two committed Changes is refused

- **WHEN** two committed Changes in the Store carry one child's name
- **THEN** publication is refused as ambiguous, listing every claimant with its project and target line
- **AND** no claimant is chosen by ref order, recency, or proximity

#### Scenario: Unreadable Store refs are reported, not concluded absent

- **WHEN** a Store ref cannot be read during the child search
- **THEN** publication is refused naming the unsearched ref and the reason
- **AND** no child is reported missing on the strength of an unreadable ref

### Requirement: The portfolio run-state is located and read honestly

The parent's portfolio run-state SHALL be located through the same placement
chain a pipeline resume reads — the execution root's ephemera directory first,
then the legacy work directory, then the change directory — resolved from the
working directory the command runs from. A record that exists but does not read
back SHALL be refused as unreadable, never treated as absent, and a record
whose own parent name disagrees with the requested parent SHALL be refused
naming both values. A portfolio that names no children SHALL be refused,
because there is nothing to publish.

#### Scenario: No portfolio record names the searched chain

- **WHEN** `--from-portfolio` names a parent for which no portfolio run-state exists anywhere in the placement chain
- **THEN** publication is refused, naming the parent and the locations searched

#### Scenario: Present but unreadable is not absent

- **WHEN** the parent's portfolio run-state exists but does not parse
- **THEN** publication is refused as unreadable, naming the file and the reason
- **AND** the refusal does not present the portfolio as missing

#### Scenario: A record naming a different parent is refused

- **WHEN** the located portfolio run-state's own parent value disagrees with the parent the operator named
- **THEN** publication is refused, naming both values
- **AND** the record is not published as though it belonged to the named parent

#### Scenario: A portfolio with no children is refused

- **WHEN** the parent's portfolio run-state reads back with an empty children list
- **THEN** publication is refused as having nothing to publish
- **AND** no empty revision is created

### Requirement: A plan publication takes exactly one source

`--from-file` and `--from-portfolio` SHALL be the two sources a plan
publication accepts, and exactly one SHALL be given per invocation. Both
together, or neither, SHALL be refused naming both sources.

#### Scenario: Both sources together are refused

- **WHEN** `rasen store issue plan` runs with both `--from-file` and `--from-portfolio`
- **THEN** the command refuses, naming both sources and that one must be chosen

#### Scenario: No source is refused

- **WHEN** `rasen store issue plan` runs with neither `--from-file` nor `--from-portfolio`
- **THEN** the command refuses, naming both sources the publication accepts

### Requirement: A published revision reports where it came from

A successful portfolio publication SHALL report the Issue, the new revision and
its ordinal, the portfolio parent it compiled from, the located run-state path,
and the child count — the same facts in the human form and the `--json` form —
beside the pathspec-scoped commit suggestion plan publication already prints,
and SHALL stage nothing.

#### Scenario: Both forms carry the source facts

- **WHEN** a plan is published from a portfolio in human form and in `--json` form
- **THEN** both name the parent, the located run-state path, the revision ordinal, and the child count
- **AND** both carry the commit suggestion, and the Store's Git index is untouched
