## ADDED Requirements

### Requirement: Dependency validation resolves project-layer referents

When a workflow's `requires.pipelines` and `requires.schemas` are validated for presence, the validation SHALL accept an optional project context and, when present, resolve referents across the package, user, AND project layers — so a dependency naming a project-layer pipeline or schema is recognized as present. When no project context is supplied, validation SHALL resolve across the package and user layers as before, without regression. The CLI commands that validate or import workflows SHALL supply the resolved project root as the project context.

#### Scenario: Project-layer pipeline dependency resolves

- **WHEN** a workflow declares `requires.pipelines` naming a pipeline that exists only in the project layer
- **AND** validation is run with the project context
- **THEN** the dependency SHALL be recognized as present and validation SHALL pass

#### Scenario: Validation without project context is unchanged

- **WHEN** a workflow directory is validated without a project context
- **THEN** package- and user-layer referents SHALL still resolve as before
- **AND** no regression SHALL occur for workflows whose dependencies resolve at those layers
