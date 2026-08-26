## MODIFIED Requirements

### Requirement: Canvas creates and references a Custom Composite declaration

The Canvas SHALL allow the user to create a new `CompositeDeclaration` with a unique id, provenance `custom`, declared inputs, artifacts, outcomes, and a body graph. The user SHALL be able to reference the declaration from the root graph via a `CompositeRef` node or embed it in a `BoundedLoop`. Referencing SHALL be offered on the declaration itself — each listed declaration SHALL carry an action that inserts a root-level reference to *that* declaration — so the author chooses which declaration is referenced rather than the editor selecting one on their behalf. A declaration that cannot be referenced (a built-in with no body graph) SHALL present that action as unavailable rather than failing after the click. The Canvas SHALL validate that the declaration id is unique within the definition.

#### Scenario: User creates a custom composite and references it

- **WHEN** the user creates a declaration `my-composite` with outcomes `['done']` and a body of two AtomicStage nodes
- **AND** uses that declaration's own insert action to add a CompositeRef node to the root graph
- **AND** saves the definition
- **THEN** the prepared definition SHALL be valid
- **AND** the declaration SHALL appear in `definition.declarations` with `provenance: 'custom'`

#### Scenario: The author chooses which declaration is referenced

- **WHEN** the definition holds several referenceable declarations and the user inserts a reference from the second one's row
- **THEN** the inserted `CompositeRef` SHALL reference that declaration, not the first declaration in the list

#### Scenario: A declaration that cannot be referenced offers no insert

- **WHEN** a listed declaration is a built-in carrying no body graph
- **THEN** its insert action SHALL be presented as unavailable
- **AND** no `CompositeRef` to it SHALL be creatable from the editor

#### Scenario: Duplicate declaration id rejected

- **WHEN** the user creates a declaration with an id that already exists in the definition
- **THEN** the Canvas SHALL reject the creation with a duplicate-id diagnostic
- **AND** the definition SHALL not be saved
