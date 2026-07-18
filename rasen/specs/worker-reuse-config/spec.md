# worker-reuse-config Specification

## Purpose
Adds an optional `reuse` configuration block to pipeline definitions at pipeline level — `planner`/`implementer` modes (`auto` | `never`), a `threshold` (a fraction in `(0, 1]`), and per-role `roles` threshold overrides — with a defined resolution order and validation. This lets a pipeline declare whether and how eagerly planner/implementer workers should be reused across child changes, and surfaces the resolved config together with a worker's `reusedFrom` lineage on resume.

## Requirements
### Requirement: Reuse configuration block
Pipeline definitions SHALL accept an optional `reuse` block at pipeline level (not at stage level), carrying `planner` and `implementer` modes (`auto` | `never`), a `threshold`, and `roles` (per-role `threshold` overrides for `planner` and `implementer`). Reuse is a cross-change concern, so it has no stage-level form. Every reuse threshold value (top-level and per-role) SHALL accept two forms: a bare number, which is ALWAYS a fraction of the context window in (0, 1] (an occupancy ceiling), or the object `{ remainingTokens: <positive integer> }`, an absolute headroom floor in tokens. No bare number SHALL ever be interpreted as a token count.

#### Scenario: Valid reuse config parses
- **WHEN** a pipeline.yaml declares `reuse: { planner: auto, implementer: never, threshold: 0.4, roles: { planner: 0.5 } }`
- **THEN** `rasen validate <name> --type pipeline` SHALL pass
- **AND** `rasen pipeline show <name> --json` SHALL expose the resolved reuse config

#### Scenario: Absolute reuse threshold form parses
- **WHEN** a pipeline.yaml declares `reuse: { threshold: { remainingTokens: 200000 }, roles: { implementer: { remainingTokens: 180000 } } }`
- **THEN** `rasen validate <name> --type pipeline` SHALL pass
- **AND** `rasen pipeline show <name> --json` SHALL expose the resolved values as `{ remainingTokens }` objects

#### Scenario: Invalid reuse config rejected
- **WHEN** a pipeline.yaml declares a `planner` or `implementer` mode other than `auto`/`never`, a bare-number `threshold` (top-level or per-role) outside `(0, 1]`, a `remainingTokens` that is not a positive integer, or an unknown key inside the `reuse` block or a threshold object
- **THEN** validation SHALL fail with an actionable message

### Requirement: Reuse config resolution order
The effective reuse config SHALL resolve field-wise as: for each role's threshold, pipeline `reuse.roles[<role>]` > pipeline `reuse.threshold` > model preset (the suggested `reuseThreshold` of the preset matching that role's `agents[<role>]` model, when one is configured) > the built-in default; for the `planner` and `implementer` modes, the declared value > the built-in default. The built-in defaults SHALL be `planner: auto`, `implementer: auto`, and `threshold: 0.25`. A role with no configured model, or whose model has no preset (or a preset without a suggested reuse threshold), SHALL skip the preset layer. The top-level resolved `threshold` SHALL remain the declared value or the built-in default (no preset layer — it is not model-specific).

#### Scenario: Per-role threshold overrides the pipeline threshold
- **WHEN** a pipeline declares `reuse: { threshold: 0.3, roles: { planner: 0.5 } }`
- **THEN** the resolved planner threshold SHALL be 0.5
- **AND** the resolved implementer threshold SHALL be 0.3

#### Scenario: Model preset applies to a role with no configured reuse threshold
- **WHEN** a pipeline declares no `reuse` thresholds and `agents.implementer` names a model matching a preset carrying a suggested reuse threshold
- **THEN** the resolved implementer reuse threshold SHALL be the preset's suggested value
- **AND** any declared `reuse.threshold` or `reuse.roles.implementer` value SHALL win over the preset

#### Scenario: Defaults apply when nothing is configured
- **WHEN** a pipeline declares no `reuse` block and no role model matches a preset with a suggested reuse threshold
- **THEN** the resolved reuse config SHALL be the built-in defaults (`planner: auto`, `implementer: auto`, `threshold: 0.25`)
- **AND** pipelines without a `reuse` block SHALL parse exactly as before

### Requirement: Worker-record reuse lineage
The run-state reader SHALL accept an optional `reusedFrom` marker on a worker record — the id of a prior child change whose context the worker's transcript already carries — and `rasen pipeline resume` SHALL surface it unchanged for any worker that has it.

#### Scenario: Resume surfaces a reused worker's lineage
- **WHEN** `auto-run.json` records a stage worker with `reusedFrom: "child-1"` (alongside a transcript or agentId)
- **THEN** `rasen pipeline resume <change> --json` SHALL include `reusedFrom: "child-1"` on that worker
- **AND** run-states whose workers omit `reusedFrom` SHALL parse and resume exactly as before
