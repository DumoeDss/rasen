# runtime-threshold-bindings Specification

## Purpose
Define how global, inherited-store, and project runtime bindings select named threshold schemes while preserving deterministic precedence, diagnostics, and legacy fallback behavior.

## Requirements
### Requirement: Scoped runtime bindings select named schemes

The system SHALL accept `thresholds.bindings.<runtime>: <scheme-name>` at global, inherited-store, and project scope. The runtime placeholder SHALL accept the probe-capable runtime IDs and the reserved literal `default`; audit-only runtime IDs SHALL be rejected. The binding map SHALL be empty until explicitly configured, and creating or parsing configuration SHALL NOT invent a `default` binding.

Registry-mediated writes SHALL offer the scheme names present in the machine-level scheme library and reject an unknown name. A syntactically valid name read from a shared config file SHALL remain available to resolution even when its local scheme is absent, so the resolver can report and safely fall back from a dangling reference.

#### Scenario: Probe-capable runtimes and default are accepted

- **WHEN** bindings are set for `claude`, `codex`, and `default` at any declared scope
- **THEN** all three paths are accepted when their values name locally saved schemes

#### Scenario: Audit-only runtime is rejected

- **WHEN** a user attempts to set `thresholds.bindings.zed`
- **THEN** validation rejects the placeholder because `zed` cannot probe context

#### Scenario: New configuration has no implicit binding

- **WHEN** a config object is created or parsed without a `thresholds` block
- **THEN** its effective binding map has no runtime entries and no `default` entry

#### Scenario: Saved scheme names drive write validation

- **WHEN** a scheme named `focused` exists and `missing` does not
- **THEN** a registry-mediated binding write accepts `focused`, rejects `missing`, and reflects later library changes when validation is run again

### Requirement: Explicit runtime rows precede default rows

Binding selection SHALL consider an explicit row for a recognized probe-capable runtime across project, inherited-store, and global scopes before considering the `default` row across those scopes. Within either row, project SHALL precede inherited store, which SHALL precede global. When runtime is absent or unrecognized, only the `default` row SHALL be considered.

If a binding references a missing or invalid scheme, resolution SHALL emit a non-fatal diagnostic, skip that candidate, and continue with the next binding candidate. After all applicable binding candidates are exhausted, the resolver SHALL continue through the established non-binding threshold layers.

#### Scenario: Store runtime row beats project default row

- **WHEN** project binds `default` to `balanced` and its inherited store binds `codex` to `focused`
- **AND** a Codex threshold is resolved
- **THEN** `focused` is selected from the store runtime row

#### Scenario: Scope precedence applies within a row

- **WHEN** project and global both bind `claude` to valid schemes
- **THEN** the project runtime binding is selected

#### Scenario: Missing runtime uses only default rows

- **WHEN** runtime is absent, project binds `claude`, and global binds `default`
- **THEN** the global default binding is selected and the project runtime-specific row is ignored

#### Scenario: Dangling binding falls through

- **WHEN** a project runtime row names a missing scheme and the inherited store runtime row names a valid scheme
- **THEN** resolution reports the dangling project reference and selects the store scheme

#### Scenario: Every binding candidate can fall back to legacy behavior

- **WHEN** all applicable binding rows are missing, invalid, or dangling
- **THEN** resolution continues to the pipeline, legacy config, preset, and default candidates applicable to the requested threshold family

### Requirement: One pure resolver governs threshold selection

The threshold core SHALL expose a synchronous deterministic resolution operation for the `handoff` and `reuse` families. Callers SHALL inject the runtime, optional role/pipeline/stage identity, scheme snapshot, bindings, and non-binding candidate layers. The result SHALL contain the chosen threshold and source, optional binding metadata identifying scope, selected row, and scheme name, and diagnostics for skipped binding candidates. Repeated calls with equivalent inputs SHALL return equivalent results without reading configuration, the filesystem, environment variables, or process state.

For a selected scheme, handoff roles SHALL resolve `handoffRoles[role]` before `handoff`, and reuse roles SHALL resolve `reuseRoles[role]` before `reuse`. Scheme sources SHALL identify both scope and whether the role override or scalar supplied the value.

#### Scenario: Resolver is deterministic over injected layers

- **WHEN** the resolver is called twice with equivalent normalized inputs while machine files change between calls
- **THEN** both calls return equivalent results because no external state is read during resolution

#### Scenario: Scheme role override beats scheme scalar

- **WHEN** the selected scheme has `handoff: 0.5` and `handoffRoles.reviewer: 0.65` for a reviewer resolution
- **THEN** the threshold is 0.65 with a scope-qualified scheme-role source

#### Scenario: Scheme scalar applies without a supported role override

- **WHEN** the selected scheme has no override for the requested role
- **THEN** its family scalar supplies the threshold with a scope-qualified scheme source

#### Scenario: Binding metadata identifies the selected row

- **WHEN** a project `default` row selects scheme `balanced`
- **THEN** the resolution metadata identifies project scope, the `default` row, and scheme `balanced`

### Requirement: Runtime identity is supplied per threshold consumer

Pipeline handoff SHALL use the effective runtime for the stage's role. Reuse role fields SHALL use the effective runtime for `planner` and `implementer` respectively. The role-agnostic top-level reuse `.threshold` SHALL use only a `default` binding row, followed by pipeline scalar and the built-in default. Agent-context handoff SHALL use the runtime detected or explicitly selected by the probe and SHALL omit pipeline, stage, role, and model-preset candidates.

#### Scenario: Pipeline role selects its runtime scheme

- **WHEN** a reviewer effectively runs on Codex and `codex` is bound to a valid scheme
- **THEN** stage handoff resolution considers that scheme for the reviewer

#### Scenario: Reuse roles can select different schemes

- **WHEN** planner effectively runs on Claude and implementer effectively runs on Codex with different valid bindings
- **THEN** each role's reuse threshold is resolved from its own runtime binding

#### Scenario: Top-level reuse uses the default row

- **WHEN** only a `codex` binding exists and no pipeline reuse scalar is declared
- **THEN** the top-level reuse `.threshold` ignores the runtime-specific row and uses the built-in default

#### Scenario: Agent probe stays role agnostic

- **WHEN** a Codex transcript is probed and its bound scheme contains both a handoff scalar and role overrides
- **THEN** the probe uses the scheme's handoff scalar and does not apply a role, stage, pipeline, or preset override
