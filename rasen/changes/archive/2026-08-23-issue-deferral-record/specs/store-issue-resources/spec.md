# store-issue-resources Specification — Delta

## MODIFIED Requirements

### Requirement: Plan nodes carry a closed lifecycle vocabulary

A plan's Change nodes SHALL carry a lifecycle drawn from exactly five values — `required`,
`optional`, `cancelled`, `superseded`, `deferred` — where an absent lifecycle SHALL read as
`required`, so every revision published before this vocabulary existed reads back with all its
nodes required and its digest unchanged. A `deferred` node records work the Issue still
intends but explicitly postpones beyond this Issue's completion — postponed, not abandoned and
not replaced — so the deferral is on the books rather than spelled as a dangling optional
node, a false cancellation, or a silent omission. An intent node SHALL carry a lifecycle drawn
from exactly two of those values — `required` or `optional`, absent reading `required` — so a
decomposition's required/optional proposal lives on the node the review surface shows, not in
a sidecar document; `cancelled`, `superseded`, and `deferred` SHALL remain Change-node-only,
because they explain work that existed as a Change and is not demanded toward this Issue's
completion — abandoned, replaced, or postponed — while intent work no Change ever backed is
postponed by keeping it `optional` or expressed as unwanted by omitting the node from the next
revision. A node marked `cancelled`, `superseded`, or `deferred` SHALL carry a recorded
reason, and that reason SHALL satisfy the same portable-durable-text contract Issue records
enforce, refused at the schema rather than trimmed. A reason SHALL be recorded only for
`cancelled`, `superseded`, and `deferred` nodes — a reason authored on wanted work
(`required` or `optional`) is refused rather than stored, because a reason explains only work
the plan does not demand toward Done. A lifecycle value outside the vocabulary a node kind
admits SHALL be refused naming the defined values and the node's kind. A lifecycle change
SHALL be expressed only as a new revision: the next revision says what the current one no
longer does, and the earlier revision's bytes never change.

#### Scenario: An absent lifecycle reads as required

- **WHEN** a revision published before this vocabulary existed is read back
- **THEN** every Change node in it reads as `required`
- **AND** the revision's stored digest still verifies against its bytes

#### Scenario: An intent node may carry required or optional

- **WHEN** a revision is authored with an intent node whose lifecycle is `optional`
- **THEN** the node publishes carrying `optional`, shown on its node line like a Change node's
- **AND** an intent revision published before intent lifecycles existed reads back with every node `required` and its digest unchanged

#### Scenario: A cancelled lifecycle on an intent node is refused

- **WHEN** a revision is authored with an intent node whose lifecycle is `cancelled` or `superseded`
- **THEN** publication is refused, naming the node, the value, and that unwanted intent work is expressed by omitting the node from the next revision
- **AND** nothing is written

#### Scenario: A cancelled node without a reason is refused

- **WHEN** a plan node is authored with lifecycle `cancelled` and no reason
- **THEN** publication is refused, naming the node and that a cancelled node requires a recorded reason
- **AND** nothing is written

#### Scenario: A superseded node without a reason is refused

- **WHEN** a plan node is authored with lifecycle `superseded` and no reason
- **THEN** publication is refused, naming the node and that a superseded node requires a recorded reason
- **AND** nothing is written

#### Scenario: A reason that is not portable durable text is refused

- **WHEN** a cancelled or superseded node's reason carries a machine filesystem path or embedded credential
- **THEN** publication is refused at the schema rather than trimmed
- **AND** nothing is written

#### Scenario: An undefined lifecycle value is refused

- **WHEN** a plan node carries a lifecycle outside the values its kind defines
- **THEN** publication is refused, naming the value and the values that are defined for that kind
- **AND** the Issue's state is unchanged

#### Scenario: A lifecycle change is a new revision, never a rewrite

- **WHEN** a plan is re-published with one node's lifecycle changed from `required` to `cancelled`
- **THEN** the new revision exists at the next ordinal and names that node `cancelled` with its reason
- **AND** the earlier revision's bytes, including that node's previous lifecycle, are unchanged

#### Scenario: A deferred node publishes and reads back with its reason

- **WHEN** a revision is authored with a Change node whose lifecycle is `deferred` and whose reason records why the work is postponed
- **THEN** the revision publishes at the next ordinal and reads back with that node `deferred` carrying the recorded reason verbatim
- **AND** a sibling revision's bytes and digests are unchanged

#### Scenario: A deferred node without a reason is refused

- **WHEN** a plan node is authored with lifecycle `deferred` and no reason
- **THEN** publication is refused, naming the node and that a deferred node requires a recorded reason
- **AND** nothing is written

#### Scenario: A deferred lifecycle on an intent node is refused

- **WHEN** a revision is authored with an intent node whose lifecycle is `deferred`
- **THEN** publication is refused, naming the node, the value, and that intent work is postponed by keeping it `optional` or omitting the node from the next revision
- **AND** nothing is written
