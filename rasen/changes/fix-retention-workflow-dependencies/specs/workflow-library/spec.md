## MODIFIED Requirements

### Requirement: Workflow dependencies are declared in four slots

A workflow definition's `requires` SHALL carry four dependency slots: `workflows`, `skills`, `pipelines`, and `schemas`. The `workflow.yaml` manifest MAY declare any of the four; an omitted slot SHALL default to empty. Each entry SHALL be a stable machine identifier. The `schemas` slot is existence-only in the current round (it declares a dependency to be validated for presence, and does not drive installation). Dependency declarations SHALL NOT participate in workflow digest computation, and adding or changing a `requires` slot SHALL NOT change a workflow's digest.

Built-in workflows SHALL declare their real dependencies: `review-cycle` requires the `rasen-review` skill; `verify-enhanced-command` requires the `rasen-review`, `rasen-cso`, `rasen-qa`, `rasen-design-review`, and `rasen-qa-only` skills; `ship-command` requires workflow `retain-command`; `auto-command` requires workflow `retain-command`, skill `rasen-review`, and the `small-feature`, `full-feature`, `bug-fix`, and `auto-decompose` pipelines; `goal-command` requires the `goal-loop-measure`, `goal-loop-evaluate`, and `goal-loop-research` pipelines.

#### Scenario: Manifest omitting a slot defaults to empty

- **WHEN** a user workflow's `workflow.yaml` omits `requires.pipelines` or `requires.schemas`
- **THEN** that slot SHALL resolve to an empty list
- **AND** validation SHALL NOT fail for the omission

#### Scenario: Built-in dependency edges are declared

- **WHEN** the built-in workflow catalog is enumerated
- **THEN** each built-in's `requires` SHALL match its real dependency edges, including `ship-command → retain-command`
- **AND** every declared built-in `requires.workflows`, `requires.skills`, and `requires.pipelines` entry SHALL resolve to an existing workflow, skill, or pipeline

#### Scenario: Shipping pulls retention into dependency closure

- **WHEN** a profile or project workflow selection contains `ship-command` without `auto-command`
- **THEN** its resolved strong workflow closure SHALL include `retain-command`
- **AND** the closure SHALL contain each workflow identity only once

#### Scenario: Goal dependency graph includes retention transitively

- **WHEN** the dependency graph resolves `goal-command` through its code-producing goal pipelines and their ship stage
- **THEN** the strong transitive closure SHALL include `ship-command`, `retain-command`, and `archive`

#### Scenario: Dependencies do not affect digest

- **WHEN** a workflow's `requires` slots are populated or changed
- **THEN** its computed digest SHALL be unchanged
