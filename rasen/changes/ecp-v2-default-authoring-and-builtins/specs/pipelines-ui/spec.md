# pipelines-ui Specification Delta

## MODIFIED Requirements

### Requirement: Canvas holds one complete versioned Definition draft

Canvas SHALL load and save a complete version-discriminated Pipeline Definition draft. Every fresh assemble flow and not-found empty-draft recovery SHALL start from the canonical blank Definition v2 envelope. Canvas SHALL preserve v1 editing behavior for existing compatibility definitions and SHALL represent v2 directly; Canvas MUST NOT maintain a second executable graph or flatten v2 into the v1 stage model. This requirement changes only the blank default; full v2 primitive and bounded-loop editing parity remains outside this Change.

#### Scenario: Fresh Canvas draft is v2

- **WHEN** a user starts assembling a new pipeline or chooses empty-draft recovery for an absent name
- **THEN** Canvas creates the version 2 blank envelope with the requested stable name and source identity
- **AND** it does not create hidden v1 stages or a parallel v1 draft

#### Scenario: v2 fields survive an unrelated edit

- **WHEN** a user edits one exposed property of a v2 draft that contains declarations or typed fields the current panel does not expose
- **THEN** save preserves every unedited v2 field and the server returns the same semantic plan digest except for the intended edit

#### Scenario: v1 draft remains editable

- **WHEN** a user opens an existing editable v1 Pipeline
- **THEN** the existing stage editing experience and save contract remain available
- **AND** opening the draft does not rewrite it to version 2

#### Scenario: Blank factory mirror cannot drift

- **WHEN** the browser blank-draft factory is compared with the core public blank-v2 fixture for the same name
- **THEN** both produce the same version, identities, typed contract fields, declarations, and empty root graph
