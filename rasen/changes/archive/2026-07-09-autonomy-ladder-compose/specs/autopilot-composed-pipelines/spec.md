## ADDED Requirements

### Requirement: Compose policy is classify-first and fires only when no registered pipeline fits

Under the `compose` selection policy, when no explicit pipeline selection is present, the LEAD SHALL first obtain the classification suggestion exactly as under the `classify` policy and SHALL adopt a keyword-basis suggestion as returned — composition never overrides an affirmative classification match. Only when classification reports a `default` basis AND the LEAD judges that no registered pipeline fits the task's stage needs MAY the LEAD compose a pipeline; composition is permission, not obligation, and a registered pipeline that fits SHALL be preferred. When an explicit pipeline selection is present, composition SHALL NOT occur and `--auto-compose` SHALL have no effect. Absent both the `--auto-compose` flag and a `compose` config value, no composition behavior is introduced — selection behaves per the resolved policy exactly as before this capability existed.

#### Scenario: Keyword suggestion is still adopted under compose

- **WHEN** the policy is `compose` and classification suggests `bug-fix` with matched indicators
- **THEN** the LEAD adopts `bug-fix` exactly as the `classify` policy would, and no composition occurs

#### Scenario: Composition considered only on a default basis with no fit

- **WHEN** the policy is `compose`, classification reports a `default` basis, and the task's needed stages are not covered by any registered pipeline
- **THEN** the LEAD may compose a pipeline; if a registered pipeline fits (including `small-feature`), the LEAD uses it instead of composing

#### Scenario: Explicit selection makes composition inert

- **WHEN** a user runs `/rasen:auto --auto-compose --pipeline full-feature <task>` or names a known pipeline as the first token
- **THEN** the explicitly selected pipeline is used, classification is not consulted, and no composition occurs

### Requirement: Composed pipelines are registered project pipelines

A pipeline the LEAD composes SHALL be written as an ordinary project pipeline (`pipeline.yaml` in the project pipelines directory) so that listing, inspection (`rasen pipeline show`), execution, and resume treat it identically to any other registered pipeline. Its name SHALL carry a `composed-` prefix, SHALL NOT reuse any existing pipeline name (the LEAD checks the registered list first and disambiguates rather than overwriting), and its YAML SHALL carry the `origin: composed` marker. The composed pipeline persists after the run as a normal, user-deletable project pipeline.

#### Scenario: Composed pipeline lands in the project registry

- **WHEN** the LEAD composes a pipeline for a task
- **THEN** the pipeline is written under the project pipelines directory with a `composed-` prefixed name and `origin: composed`, and `rasen pipeline list --json` reports it with source `project`

#### Scenario: Existing names are never overwritten

- **WHEN** the LEAD's chosen composed name already exists in the registered pipeline list
- **THEN** the LEAD picks a non-colliding name (e.g. a numeric suffix) instead of overwriting or shadowing the existing pipeline

#### Scenario: An interrupted composed run resumes

- **WHEN** a run executing a composed pipeline is interrupted and later resumed via `rasen pipeline resume <change> --json`
- **THEN** the run-state's recorded pipeline name resolves to the composed project pipeline and resume reports next/remaining stages exactly as for a built-in pipeline

### Requirement: Validation gates the execution of a composed pipeline

Before any stage of a composed pipeline runs, the LEAD SHALL validate it by name via `rasen validate <composed-name> --type pipeline --json` and SHALL proceed only on a valid result. On a validation failure the LEAD MAY make one bounded fix attempt; if the pipeline still does not validate, the LEAD SHALL fall back to `small-feature`, display the fallback and its cause, and remove the invalid composed pipeline directory so it does not linger in the registry.

#### Scenario: Valid composition proceeds

- **WHEN** a composed pipeline passes `rasen validate <name> --type pipeline --json`
- **THEN** the LEAD proceeds to fetch its DAG via `rasen pipeline show <name> --json` and executes it per the ordinary orchestration flow

#### Scenario: Invalid composition falls back to small-feature

- **WHEN** a composed pipeline fails validation and one fix attempt does not produce a valid pipeline
- **THEN** the run falls back to `small-feature`, the fallback and its cause are displayed, and the invalid composed pipeline directory is removed

### Requirement: Composed pipelines always contain verification and a review loop

A pipeline the LEAD composes SHALL include a verification stage (a stage with role `reviewer`) and a review-loop stage (a stage with `loop.kind: review-cycle`) — the LEAD never composes itself a pipeline free of independent inspection. This floor is enforced mechanically through the `origin: composed` marker (see `opsx-pipeline-registry`): a composed pipeline missing either stage fails to load at all.

#### Scenario: Floor stages present in every composition

- **WHEN** the LEAD composes a pipeline
- **THEN** the resulting YAML contains at least one stage with role `reviewer` and at least one stage with `loop.kind: review-cycle`, and the display calls out these floor stages

#### Scenario: A floor-violating composition never executes

- **WHEN** a pipeline stamped `origin: composed` lacks a `reviewer`-role stage or a `review-cycle` loop stage
- **THEN** it fails validation and loading, and the run falls back per the validation-gate requirement

### Requirement: Composition is displayed and remains user-changeable

Before executing a composed pipeline, the LEAD SHALL display the composition at the selection display point: the composed name, the full stage list (with the verification and review-loop stages identifiable), and the validation verdict. The user SHALL be able to replace the composition with any registered pipeline — or reject it — before any stage runs, exactly as with an adopted classification suggestion.

#### Scenario: Composed DAG displayed before execution

- **WHEN** the LEAD has composed and validated a pipeline
- **THEN** the user sees the composed name, its stages, and the validation verdict before any stage is dispatched

#### Scenario: User replaces the composition

- **WHEN** the user responds to the display by naming a registered pipeline instead
- **THEN** the named pipeline is used and the composed pipeline is not executed

### Requirement: The autopilot executes only registered validated pipelines

The autopilot SHALL only execute pipelines that resolve by name through the pipeline registry — including its own compositions, which become registered project pipelines before execution. The LEAD SHALL NOT execute stages from an unregistered, in-memory DAG: runtime free-form DAG execution is out of scope by decision (it breaks resume, which reloads the run's pipeline by its persisted name, and the audit trail, which references that name), and runtime dynamism remains covered by decompose (runtime fan-out) and goal-loop (runtime iteration).

#### Scenario: Every executed pipeline is registry-resolvable

- **WHEN** any autopilot run is underway or resumed
- **THEN** the pipeline name recorded in its run-state resolves through `rasen pipeline show <name> --json`, whether built-in, user-defined, project-defined, or LEAD-composed
