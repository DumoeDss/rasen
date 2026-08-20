## ADDED Requirements

### Requirement: Plan nodes carry a closed lifecycle vocabulary

A plan's Change nodes SHALL carry a lifecycle drawn from exactly four values — `required`,
`optional`, `cancelled`, `superseded` — where an absent lifecycle SHALL read as `required`, so
every revision published before this vocabulary existed reads back with all its nodes required
and its digest unchanged. A node marked `cancelled` or `superseded` SHALL carry a recorded
reason, and that reason SHALL satisfy the same portable-durable-text contract Issue records
enforce, refused at the schema rather than trimmed. A reason SHALL be recorded only for
`cancelled` and `superseded` nodes — a reason authored on wanted work (`required` or
`optional`) is refused rather than stored, because a reason explains only work the plan no
longer wants. A lifecycle value outside the four SHALL be
refused naming the defined values, and an intent node SHALL carry no lifecycle at all. A
lifecycle change SHALL be expressed only as a new revision: the next revision says what the
current one no longer does, and the earlier revision's bytes never change.

#### Scenario: An absent lifecycle reads as required

- **WHEN** a revision published before this vocabulary existed is read back
- **THEN** every Change node in it reads as `required`
- **AND** the revision's stored digest still verifies against its bytes

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

- **WHEN** a plan node carries a lifecycle outside the four defined values
- **THEN** publication is refused, naming the value and the four that are defined
- **AND** the Issue's state is unchanged

#### Scenario: A lifecycle change is a new revision, never a rewrite

- **WHEN** a plan is re-published with one node's lifecycle changed from `required` to `cancelled`
- **THEN** the new revision exists at the next ordinal and names that node `cancelled` with its reason
- **AND** the earlier revision's bytes, including that node's previous lifecycle, are unchanged

## MODIFIED Requirements

### Requirement: A plan graph is normalized, checked, and refused rather than repaired

Plan nodes SHALL be normalized to one canonical form, so two spellings of one plan are one plan.
Duplicate nodes SHALL be refused rather than silently merged, a dependency naming a node not in the
plan SHALL be refused, and a dependency cycle SHALL be refused. No plan SHALL be stored with a defect
the checker can name.

#### Scenario: Two spellings of one plan are one plan

- **WHEN** two plans differ only in node ordering or in equivalent spellings of the same values
- **THEN** they normalize to the same canonical plan

#### Scenario: An explicit required node and an absent lifecycle are one plan

- **WHEN** two plans differ only in one spelling a node's lifecycle as `required` and the other omitting it
- **THEN** they normalize to the same canonical plan
- **AND** the stored canonical form omits a `required` lifecycle, so its digest matches the form published before the field existed

#### Scenario: A duplicate node is refused

- **WHEN** a plan carries two nodes with the same identifier
- **THEN** publication is refused, naming the duplicate
- **AND** the two are not merged into one

#### Scenario: A cycle or dangling dependency is refused

- **WHEN** a plan carries a dependency cycle, or a dependency on a node the plan does not contain
- **THEN** publication is refused, naming the offending nodes
- **AND** no revision is created
