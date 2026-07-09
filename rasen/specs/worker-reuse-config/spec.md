# worker-reuse-config Specification

## Purpose
Adds an optional `reuse` configuration block to pipeline definitions at pipeline level — `planner`/`implementer` modes (`auto` | `never`), a `threshold` (a fraction in `(0, 1]`), and per-role `roles` threshold overrides — with a defined resolution order and validation. This lets a pipeline declare whether and how eagerly planner/implementer workers should be reused across child changes, and surfaces the resolved config together with a worker's `reusedFrom` lineage on resume.

## Requirements
### Requirement: Reuse configuration block
Pipeline definitions SHALL accept an optional `reuse` block at pipeline level (not at stage level), carrying `planner` and `implementer` modes (`auto` | `never`), a `threshold` (a fraction in `(0, 1]`), and `roles` (per-role `threshold` overrides for `planner` and `implementer`). Reuse is a cross-change concern, so it has no stage-level form.

#### Scenario: Valid reuse config parses
- **WHEN** a pipeline.yaml declares `reuse: { planner: auto, implementer: never, threshold: 0.4, roles: { planner: 0.5 } }`
- **THEN** `rasen validate <name> --type pipeline` SHALL pass
- **AND** `rasen pipeline show <name> --json` SHALL expose the resolved reuse config

#### Scenario: Invalid reuse config rejected
- **WHEN** a pipeline.yaml declares a `planner` or `implementer` mode other than `auto`/`never`, a `threshold` (top-level or per-role) outside `(0, 1]`, or an unknown key inside the `reuse` block
- **THEN** validation SHALL fail with an actionable message

### Requirement: Reuse config resolution order
The effective reuse config SHALL resolve field-wise as: for each role's threshold, pipeline `reuse.roles[<role>]` > pipeline `reuse.threshold` > the built-in default; for the `planner` and `implementer` modes, the declared value > the built-in default. The built-in defaults SHALL be `planner: auto`, `implementer: auto`, and `threshold: 0.25`.

#### Scenario: Per-role threshold overrides the pipeline threshold
- **WHEN** a pipeline declares `reuse: { threshold: 0.3, roles: { planner: 0.5 } }`
- **THEN** the resolved planner threshold SHALL be 0.5
- **AND** the resolved implementer threshold SHALL be 0.3

#### Scenario: Defaults apply when nothing is configured
- **WHEN** a pipeline declares no `reuse` block
- **THEN** the resolved reuse config SHALL be the built-in defaults (`planner: auto`, `implementer: auto`, `threshold: 0.25`)
- **AND** pipelines without a `reuse` block SHALL parse exactly as before

### Requirement: Worker-record reuse lineage
The run-state reader SHALL accept an optional `reusedFrom` marker on a worker record — the id of a prior child change whose context the worker's transcript already carries — and `rasen pipeline resume` SHALL surface it unchanged for any worker that has it.

#### Scenario: Resume surfaces a reused worker's lineage
- **WHEN** `auto-run.json` records a stage worker with `reusedFrom: "child-1"` (alongside a transcript or agentId)
- **THEN** `rasen pipeline resume <change> --json` SHALL include `reusedFrom: "child-1"` on that worker
- **AND** run-states whose workers omit `reusedFrom` SHALL parse and resume exactly as before
