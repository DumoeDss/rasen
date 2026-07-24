## ADDED Requirements

### Requirement: Retain replaces retro as the internal retention runner

The built-in workflow catalog SHALL include workflow id `retain-command` with canonical skill-directory name `rasen-retain` and kind `internal`, and SHALL NOT expose `retro-command` as a selectable workflow identity. Pipeline references and dependency declarations SHALL use retain rather than retro so retirement leaves no dangling built-in reference. Neither retain nor retro SHALL be an independent profile checkbox; users select retention behavior only through the profile retention radio choice.

#### Scenario: Retain is registered and retro is retired

- **WHEN** the built-in workflow catalog is enumerated
- **THEN** it SHALL contain internal workflow `retain-command` with canonical skill-directory name `rasen-retain`
- **AND** it SHALL NOT contain `retro-command` as a selectable workflow definition
- **AND** built-in profiles and pipelines SHALL contain no selectable reference to `retro-command`

#### Scenario: Retention runner is not independently selectable

- **WHEN** a user creates or updates a current or named profile
- **THEN** neither `retain-command` nor `retro-command` SHALL be offered as a workflow checkbox
- **AND** the single retention radio choice SHALL be the only profile control for `off`, `report`, or `codify`

#### Scenario: Temporary retro wrapper remains outside the catalog

- **WHEN** the `rasen-retro` compatibility wrapper is distributed during its one migration window
- **THEN** it SHALL be user-invoked only and SHALL carry `disable-model-invocation`
- **AND** it SHALL delegate to retain's report behavior
- **AND** it SHALL NOT appear as a selectable workflow, a profile member, or a pipeline dependency

### Requirement: Retain is a shallow lazy-loading router

The `rasen-retain` skill SHALL remain a shallow router whose body selects among `off`, `report`, and `codify`; the substantive report and codify instructions SHALL live in conditional sidecars. The router SHALL load only the selected branch. `auto-command`'s workflow dependency on `retain-command` SHALL make the router and its sidecars available whenever the full-feature pipeline is available, including when active retention is `off`, so pipeline skill preflight does not need mode-dependent alternatives.

#### Scenario: Off loads no retention branch

- **WHEN** `rasen-retain` dispatches mode `off`
- **THEN** it SHALL complete without loading the report sidecar or the codify sidecar

#### Scenario: Report loads only its sidecar

- **WHEN** `rasen-retain` dispatches mode `report`
- **THEN** it SHALL load the report sidecar
- **AND** SHALL NOT load the codify sidecar

#### Scenario: Codify loads only its sidecar

- **WHEN** `rasen-retain` dispatches mode `codify`
- **THEN** it SHALL load the codify sidecar
- **AND** SHALL NOT load the report sidecar

#### Scenario: Retain is installed even while disabled

- **WHEN** a selected workflow makes the built-in full-feature pipeline available through `auto-command`
- **AND** the active profile's retention mode is `off`
- **THEN** dependency closure SHALL still install `rasen-retain` and its conditional sidecars
- **AND** pipeline preflight SHALL resolve one stable retain skill rather than choosing among mode-specific skills

## MODIFIED Requirements

### Requirement: Workflow definitions carry a kind classification

Every workflow definition SHALL carry a `kind` classifying its role, drawn from the values `task`, `driver`, and `internal`. `task` denotes an inner-loop operation a user or agent invokes directly; `driver` denotes an outer-loop engine that consumes pipelines; `internal` denotes a sub-unit invoked by a driver rather than directly by a user. The kind set is extensible (a future `expert` kind is anticipated) and SHALL be represented so that additional values can be introduced without breaking existing definitions.

Built-in workflows SHALL be classified as follows: the pipeline-driving engines (`auto-command`, `goal-command`) are `driver`; the goal sub-units (`goal-plan`, `goal-iterate`, `goal-report`) and the policy-driven retention runner (`retain-command`) are `internal`; all other built-ins are `task`. The temporary `rasen-retro` compatibility wrapper is not a workflow definition and SHALL NOT receive a selectable catalog kind.

`kind` is catalog/presentation metadata: it SHALL NOT participate in workflow digest computation (neither the built-in digest nor the user-workflow file digest). Adding or changing a definition's `kind` SHALL NOT change its digest, and SHALL NOT by itself trigger drift-healing of an installed workflow.

#### Scenario: Built-in workflows expose their kind

- **WHEN** the built-in workflow catalog is enumerated
- **THEN** `auto-command` and `goal-command` SHALL have kind `driver`
- **AND** `goal-plan`, `goal-iterate`, and `goal-report` SHALL have kind `internal`
- **AND** `retain-command` SHALL have kind `internal`
- **AND** every other built-in SHALL have kind `task`

#### Scenario: Kind does not affect digest

- **WHEN** a workflow definition's kind is set or changed
- **THEN** its computed digest SHALL be unchanged
- **AND** an already-installed copy SHALL NOT be flagged for drift solely because of its kind

### Requirement: Workflow dependencies are declared in four slots

A workflow definition's `requires` SHALL carry four dependency slots: `workflows`, `skills`, `pipelines`, and `schemas`. The `workflow.yaml` manifest MAY declare any of the four; an omitted slot SHALL default to empty. Each entry SHALL be a stable machine identifier. The `schemas` slot is existence-only in the current round (it declares a dependency to be validated for presence, and does not drive installation). Dependency declarations SHALL NOT participate in workflow digest computation, and adding or changing a `requires` slot SHALL NOT change a workflow's digest.

Built-in workflows SHALL declare their real dependencies: `review-cycle` requires the `rasen-review` skill; `verify-enhanced-command` requires the `rasen-review`, `rasen-cso`, `rasen-qa`, `rasen-design-review`, and `rasen-qa-only` skills; `auto-command` requires workflow `retain-command`, skill `rasen-review`, and the `small-feature`, `full-feature`, `bug-fix`, and `auto-decompose` pipelines; `goal-command` requires the `goal-loop-measure`, `goal-loop-evaluate`, and `goal-loop-research` pipelines.

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
