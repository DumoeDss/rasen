## MODIFIED Requirements

### Requirement: Reuse config resolution order

The effective reuse config SHALL resolve field-wise. For each role's threshold, a scheme selected by that role's effective runtime SHALL apply first (`reuseRoles[<role>]` before the scheme's `reuse` scalar), followed by pipeline `reuse.roles[<role>]`, pipeline `reuse.threshold`, model preset (the suggested `reuseThreshold` of the preset matching that role's `agents[<role>]` model, when one is configured), and the built-in default. Scheme selection SHALL consider the explicit runtime binding across project, inherited-store, and global scope before the `default` binding across those scopes; a missing or invalid referenced scheme SHALL warn and fall through through the remaining binding candidates and then the pipeline/preset/default chain.

For the `planner` and `implementer` modes, the declared value SHALL precede the built-in default. The built-in defaults SHALL be `planner: auto`, `implementer: auto`, and `threshold: 0.25`. A role with no configured model, or whose model has no preset (or a preset without a suggested reuse threshold), SHALL skip the preset layer.

The top-level resolved `threshold` has no role-specific runtime identity. It SHALL resolve from a valid scheme selected only through the `default` binding row (project, inherited store, then global), then the declared pipeline scalar, then the built-in default; it SHALL have no model-preset layer. Runtime-specific bindings SHALL apply to the planner and implementer role thresholds, not to this top-level summary.

#### Scenario: Per-role threshold overrides the pipeline threshold

- **WHEN** no usable binding exists and a pipeline declares `reuse: { threshold: 0.3, roles: { planner: 0.5 } }`
- **THEN** the resolved planner threshold SHALL be 0.5
- **AND** the resolved implementer threshold SHALL be 0.3

#### Scenario: Bound role scheme beats pipeline threshold

- **WHEN** planner's effective runtime selects a valid scheme with `reuseRoles.planner: 0.45` and the pipeline declares `reuse.roles.planner: 0.5`
- **THEN** the resolved planner threshold SHALL be 0.45 with a scope-qualified scheme-role source

#### Scenario: Different role runtimes select independently

- **WHEN** planner effectively runs on Claude and implementer effectively runs on Codex, and those runtimes bind different valid schemes
- **THEN** each role SHALL use its own selected scheme's role override or scalar

#### Scenario: Model preset applies to a role with no configured reuse threshold

- **WHEN** no usable binding exists, a pipeline declares no `reuse` thresholds, and `agents.implementer` names a model matching a preset carrying a suggested reuse threshold
- **THEN** the resolved implementer reuse threshold SHALL be the preset's suggested value
- **AND** any declared `reuse.threshold` or `reuse.roles.implementer` value SHALL win over the preset

#### Scenario: Top-level threshold uses only the default binding row

- **WHEN** a valid `codex` binding supplies reuse 0.4, no `default` binding exists, and the pipeline declares `reuse.threshold: 0.3`
- **THEN** the top-level resolved threshold SHALL be 0.3
- **AND** a valid default-row scheme would win over that pipeline scalar

#### Scenario: Dangling binding falls through to pipeline and preset layers

- **WHEN** every applicable role binding references a missing or invalid scheme and the pipeline declares a role or scalar reuse threshold
- **THEN** resolution reports the skipped binding references and uses the first applicable pipeline threshold

#### Scenario: Defaults apply when nothing is configured

- **WHEN** no usable binding exists, a pipeline declares no `reuse` block, and no role model matches a preset with a suggested reuse threshold
- **THEN** the resolved reuse config SHALL be the built-in defaults (`planner: auto`, `implementer: auto`, `threshold: 0.25`)
- **AND** pipelines without a `reuse` block SHALL parse exactly as before
