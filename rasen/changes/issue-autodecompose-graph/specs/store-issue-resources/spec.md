## ADDED Requirements

### Requirement: Plan nodes may carry an execution suggestion and decomposition rationale

A plan node of either kind MAY carry an execution suggestion and the decomposition reasoning that produced it; each such field SHALL be optional and validated as this requirement states.
The three fields are a `suggestedPipeline` naming the pipeline the plan proposes to run for that
node, a `rationale` stating why the work exists as this node, and an `uncertainty` stating what the
decomposer was unsure about. A `suggestedPipeline` SHALL be a name the pipeline registry resolves at
publication, and publication SHALL refuse a node whose suggestion names no known pipeline, naming
the node and the unknown pipeline. `rationale` and `uncertainty` SHALL satisfy the same portable
durable text contract Issue records enforce — refused at the schema rather than trimmed. Absent
fields SHALL be omitted from the stored canonical form, so a revision published before these fields
existed reads back with every field absent and its stored digest still verifying, and an authored
absence never reads as an empty string.

#### Scenario: An unknown suggested pipeline is refused at publication

- **WHEN** a plan node carries a `suggestedPipeline` that names no pipeline the registry resolves
- **THEN** publication is refused, naming the node and the unknown pipeline
- **AND** no revision is created

#### Scenario: A rationale carrying a machine path is refused at the schema

- **WHEN** a node's `rationale` or `uncertainty` carries a machine filesystem path or embedded credential
- **THEN** publication is refused at the schema rather than trimmed
- **AND** nothing is written

#### Scenario: A revision published before these fields reads back unchanged

- **WHEN** a revision published before these fields existed is read back
- **THEN** each of its nodes carries no suggestion, rationale, or uncertainty
- **AND** the revision's stored digest still verifies against its bytes
