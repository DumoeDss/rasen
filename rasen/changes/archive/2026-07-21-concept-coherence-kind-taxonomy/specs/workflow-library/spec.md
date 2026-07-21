## ADDED Requirements

### Requirement: Workflow definitions carry a kind classification

Every workflow definition SHALL carry a `kind` classifying its role, drawn from the values `task`, `driver`, and `internal`. `task` denotes an inner-loop operation a user or agent invokes directly; `driver` denotes an outer-loop engine that consumes pipelines; `internal` denotes a sub-unit invoked by a driver rather than directly by a user. The kind set is extensible (a future `expert` kind is anticipated) and SHALL be represented so that additional values can be introduced without breaking existing definitions.

Built-in workflows SHALL be classified as follows: the pipeline-driving engines (`auto-command`, `goal-command`) are `driver`; the goal sub-units (`goal-plan`, `goal-iterate`, `goal-report`) are `internal`; all other built-ins are `task`.

`kind` is catalog/presentation metadata: it SHALL NOT participate in workflow digest computation (neither the built-in digest nor the user-workflow file digest). Adding or changing a definition's `kind` SHALL NOT change its digest, and SHALL NOT by itself trigger drift-healing of an installed workflow.

#### Scenario: Built-in workflows expose their kind

- **WHEN** the built-in workflow catalog is enumerated
- **THEN** `auto-command` and `goal-command` SHALL have kind `driver`
- **AND** `goal-plan`, `goal-iterate`, and `goal-report` SHALL have kind `internal`
- **AND** every other built-in SHALL have kind `task`

#### Scenario: Kind does not affect digest

- **WHEN** a workflow definition's kind is set or changed
- **THEN** its computed digest SHALL be unchanged
- **AND** an already-installed copy SHALL NOT be flagged for drift solely because of its kind

### Requirement: User workflows default to task kind and may declare kind in the manifest

A user (packaged or installed) workflow SHALL default to kind `task` when its `workflow.yaml` manifest does not declare a kind. The manifest MAY optionally declare a `kind` restricted to `task` or `internal`; `driver` is reserved for built-in engines and SHALL NOT be a valid user-declared kind. A manifest declaring an out-of-range kind SHALL fail strict validation. The declared kind SHALL NOT introduce a new serialized package field or require a manifest version bump — it is carried within the existing manifest file content.

#### Scenario: Manifest without kind defaults to task

- **WHEN** a user workflow whose `workflow.yaml` omits `kind` is loaded
- **THEN** its definition kind SHALL be `task`

#### Scenario: Manifest declares an allowed kind

- **WHEN** a user workflow's `workflow.yaml` declares `kind: internal`
- **THEN** its definition kind SHALL be `internal`

#### Scenario: Manifest declares a disallowed kind

- **WHEN** a user workflow's `workflow.yaml` declares a kind that is not `task` or `internal`
- **THEN** strict workflow validation SHALL reject it with a manifest schema error

### Requirement: Workflow list groups by kind and hides internal workflows by default

The human-readable `rasen workflow list` output SHALL group workflows by kind, presenting the `task` and `driver` groups under localized headings, and SHALL hide `internal` workflows by default. A `--all` flag SHALL additionally reveal the `internal` group; `--all` SHALL affect only the human-readable output. Group headings SHALL be Rasen-owned localized presentation, not translations of user-authored content.

#### Scenario: Default list hides internal sub-units

- **WHEN** a user runs `rasen workflow list` without `--all`
- **THEN** the output SHALL present the task and driver groups under localized headings
- **AND** the internal goal sub-units SHALL NOT appear

#### Scenario: List with --all reveals internal group

- **WHEN** a user runs `rasen workflow list --all`
- **THEN** the internal group SHALL additionally appear under its localized heading

### Requirement: Workflow JSON output always exposes all workflows with kind

The `--json` output of `rasen workflow list` SHALL include every workflow — `task`, `driver`, and `internal` — regardless of whether `--all` is passed, and SHALL annotate each entry with its `kind` as a stable machine value. Grouping and internal-hiding SHALL apply only to the human-readable output, never to JSON. The `kind` value SHALL be locale-neutral.

#### Scenario: JSON lists internal workflows without --all

- **WHEN** a user runs `rasen workflow list --json` without `--all`
- **THEN** the payload SHALL include internal workflows alongside task and driver workflows
- **AND** each entry SHALL carry its `kind`

#### Scenario: Kind is stable across locales

- **WHEN** `rasen workflow list --json` is run under different CLI locales
- **THEN** each entry's `kind` value SHALL be identical and untranslated
