## MODIFIED Requirements

### Requirement: Plan nodes carry a closed lifecycle vocabulary

A plan's Change nodes SHALL carry a lifecycle drawn from exactly four values — `required`,
`optional`, `cancelled`, `superseded` — where an absent lifecycle SHALL read as `required`, so
every revision published before this vocabulary existed reads back with all its nodes required
and its digest unchanged. An intent node SHALL carry a lifecycle drawn from exactly two of those
values — `required` or `optional`, absent reading `required` — so a decomposition's
required/optional proposal lives on the node the review surface shows, not in a sidecar
document; `cancelled` and `superseded` SHALL remain Change-node-only, because they explain work
that existed and is no longer wanted, while unwanted intent work — work no Change ever backed —
SHALL be expressed by omitting the node from the next revision. A node marked `cancelled` or
`superseded` SHALL carry a recorded
reason, and that reason SHALL satisfy the same portable-durable-text contract Issue records
enforce, refused at the schema rather than trimmed. A reason SHALL be recorded only for
`cancelled` and `superseded` nodes — a reason authored on wanted work (`required` or
`optional`) is refused rather than stored, because a reason explains only work the plan no
longer wants. A lifecycle value outside the vocabulary a node kind admits SHALL be
refused naming the defined values and the node's kind. A
lifecycle change SHALL be expressed only as a new revision: the next revision says what the
current one no longer does, and the earlier revision's bytes never change.

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

### Requirement: An Issue's records are written deterministically and read strictly

An Issue record and an Execution Plan revision SHALL each be written in a stable field order with
stable formatting, so equivalent values produce identical bytes. Reading SHALL reject an unrecognized
field rather than silently drop it, and SHALL reject a record whose required facts are missing rather
than fill them with defaults. Authoring SHALL meet the same strictness: a plan publication input
node carrying a field the node schemas do not define SHALL be refused naming the field and the node,
on the reporting path exactly as on the throwing path, rather than published with the field
silently dropped.

#### Scenario: Equivalent records are written identically

- **WHEN** equivalent Issue records are constructed with different property insertion order
- **THEN** they are written as identical bytes

#### Scenario: An unrecognized field is reported

- **WHEN** a stored Issue record carries a field the product does not define
- **THEN** reading reports the unrecognized field
- **AND** the value is not silently discarded

#### Scenario: A record missing required facts is refused

- **WHEN** a stored record is missing its identifier, title, or state
- **THEN** reading refuses, naming what is missing
- **AND** no default is substituted

#### Scenario: An authored node with an unrecognized field is refused by name

- **WHEN** a plan publication input node carries a field the node schemas do not define, such as a misspelled suggestion key
- **THEN** publication is refused naming the node and the unrecognized field
- **AND** the field is not silently dropped from the published revision
