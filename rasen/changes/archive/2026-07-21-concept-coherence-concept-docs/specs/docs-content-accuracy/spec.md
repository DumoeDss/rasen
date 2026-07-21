## ADDED Requirements

### Requirement: The conceptual model is documented

The documentation SHALL present rasen's conceptual model in a reader-facing concept document: `schema` as the content layer (what artifacts a methodology produces and how they depend on each other), `workflow` as the execution inner loop (how one task unit runs in a single session), and `pipeline` as the execution outer loop (how a harness chains multiple inner-loop tasks). The document SHALL explain the workflow `kind` taxonomy (`task`, `driver`, `internal`) consistently with the shipped `kind` field, and SHALL state why the three concept names are retained.

Any `rasen` CLI command or `/rasen:*` command the concept document presents as current behavior SHALL exist in the shipped CLI. Behavior that has not yet shipped SHALL be presented as design direction, not as current behavior.

#### Scenario: Concept document presents the model

- **WHEN** the concepts documentation is read
- **THEN** it SHALL describe schema, workflow, and pipeline as the content layer plus the inner and outer execution loops
- **AND** it SHALL describe the `task`, `driver`, and `internal` kinds consistently with the CLI's `kind` field

#### Scenario: Referenced commands exist

- **WHEN** the concept document names a `rasen` or `/rasen:*` command as current behavior
- **THEN** that command SHALL exist in the shipped CLI
- **AND** any not-yet-shipped capability the document mentions SHALL be marked as design direction rather than current behavior
