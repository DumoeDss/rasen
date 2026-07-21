## ADDED Requirements

### Requirement: Workflow dependencies are declared in four slots

A workflow definition's `requires` SHALL carry four dependency slots: `workflows`, `skills`, `pipelines`, and `schemas`. The `workflow.yaml` manifest MAY declare any of the four; an omitted slot SHALL default to empty. Each entry SHALL be a stable machine identifier. The `schemas` slot is existence-only in the current round (it declares a dependency to be validated for presence, and does not drive installation). Dependency declarations SHALL NOT participate in workflow digest computation, and adding or changing a `requires` slot SHALL NOT change a workflow's digest.

Built-in workflows SHALL declare their real dependencies: `review-cycle` requires the `rasen-review` skill; `verify-enhanced-command` requires the `rasen-review`, `rasen-cso`, `rasen-qa`, `rasen-design-review`, and `rasen-qa-only` skills; `auto-command` requires the `rasen-review` skill and the `small-feature`, `full-feature`, `bug-fix`, and `auto-decompose` pipelines; `goal-command` requires the `goal-loop-measure`, `goal-loop-evaluate`, and `goal-loop-research` pipelines.

#### Scenario: Manifest omitting a slot defaults to empty

- **WHEN** a user workflow's `workflow.yaml` omits `requires.pipelines` or `requires.schemas`
- **THEN** that slot SHALL resolve to an empty list
- **AND** validation SHALL NOT fail for the omission

#### Scenario: Built-in dependency edges are declared

- **WHEN** the built-in workflow catalog is enumerated
- **THEN** each built-in's `requires` SHALL match its real dependency edges (as above)
- **AND** every declared built-in `requires.skills` and `requires.pipelines` entry SHALL resolve to an existing skill or pipeline

#### Scenario: Dependencies do not affect digest

- **WHEN** a workflow's `requires` slots are populated or changed
- **THEN** its computed digest SHALL be unchanged

### Requirement: Dependency slots are validated for presence

When a workflow is imported or selected, each of its `requires` slots SHALL be validated: `requires.workflows` SHALL be resolved transitively and co-installed (existing selection closure), while `requires.skills`, `requires.pipelines`, and `requires.schemas` SHALL be validated for presence — the named skill SHALL exist in the installed or expert skill set, the named pipeline SHALL resolve among available pipelines, and the named schema SHALL resolve among available schemas. A missing referent SHALL produce a clear validation error naming the missing dependency. Presence-validated slots (skills, pipelines, schemas) SHALL NOT be added to the workflow selection set and SHALL NOT trigger installation in this round.

#### Scenario: User workflow requires a missing pipeline

- **WHEN** a user workflow declares `requires.pipelines` naming a pipeline that does not resolve
- **THEN** validation SHALL fail with an error naming the missing pipeline

#### Scenario: Required workflow is co-installed via closure

- **WHEN** a selected workflow declares `requires.workflows` naming another workflow not otherwise selected
- **THEN** the required workflow SHALL be resolved and installed as part of the selection closure

### Requirement: Workflow delete refcount guard supports a force override

`rasen workflow delete` SHALL, by default, refuse to delete a user workflow that is still referenced — by another workflow's `requires.workflows`, by a pipeline stage's skill reference, by a global or named-profile selection, or by the project artifact ledger — and SHALL name the referrers. Built-in workflows SHALL never be deletable regardless of any flag. A `--force` flag SHALL bypass only the referrer guard: the delete proceeds, a warning naming every referrer left dangling SHALL be emitted, and (in `--json`) the forced referrers SHALL be reported. Confirmation (`-y`/`--yes` or interactive prompt) SHALL still be required.

#### Scenario: Delete refused when referenced

- **WHEN** a user runs `rasen workflow delete <id>` without `--force` and the workflow is referenced
- **THEN** the deletion SHALL be refused with an error naming the referrers

#### Scenario: Force override deletes and warns

- **WHEN** a user runs `rasen workflow delete <id> --force --yes` and the workflow is referenced
- **THEN** the workflow SHALL be deleted
- **AND** a warning naming every dangling referrer SHALL be emitted

#### Scenario: Force never deletes a built-in

- **WHEN** a user runs `rasen workflow delete <built-in-id> --force`
- **THEN** the deletion SHALL still be refused because built-in workflows cannot be deleted
