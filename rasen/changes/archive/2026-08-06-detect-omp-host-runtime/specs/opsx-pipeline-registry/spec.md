## MODIFIED Requirements

### Requirement: Effective stage runtime resolves independently from other stage fields

The effective runtime for a stage SHALL resolve independently from model, sandbox, effort, and session-reuse fields. Runtime precedence SHALL be: the per-role runtime configuration instance (project over store over global), then an explicit stage runtime, then an explicit pipeline `agents.<role>.runtime`, then the detected LEAD host when that host has a dispatch adapter, then the legacy Claude fallback. A declaration that configures only a non-runtime field SHALL NOT count as an explicit runtime source. A detected host with no dispatch adapter SHALL NOT become a stage's target runtime, and SHALL take the same annotated legacy Claude fallback as an unidentified host, so a stage never claims a target Rasen cannot dispatch to.

#### Scenario: Model-only stage inherits the Codex host

- **WHEN** a stage declares `model` but no runtime and the detected LEAD host is Codex
- **THEN** the stage's effective runtime SHALL be Codex from host inheritance
- **AND** the model declaration SHALL NOT be treated as an explicit runtime source

#### Scenario: Model-only role object does not manufacture Claude

- **WHEN** `agents.reviewer` is an object containing a model or lifecycle field but no `runtime`
- **AND** no higher runtime configuration instance or stage runtime exists
- **THEN** reviewer stages inherit the detected host
- **AND** do not treat the object’s omitted runtime as an explicit Claude declaration

#### Scenario: Explicit runtime layers retain precedence

- **WHEN** a configured role runtime, stage runtime, pipeline role runtime, and host default provide different values
- **THEN** the configured role runtime wins over the stage runtime
- **AND** the stage runtime wins over the pipeline role runtime
- **AND** every explicit layer wins over host inheritance

#### Scenario: Unknown host uses the annotated legacy default

- **WHEN** no explicit runtime layer exists and host detection returns unknown
- **THEN** the stage resolves runtime `claude`
- **AND** reports runtime source `legacy-default`

#### Scenario: Host with no dispatch adapter uses the annotated legacy default

- **WHEN** no explicit runtime layer exists and host detection returns a recognized runtime that has no dispatch adapter
- **THEN** the stage resolves runtime `claude`
- **AND** reports the same annotated legacy default source as an unknown host
- **AND** SHALL NOT report the runtime as inherited from the host

#### Scenario: Session-reuse threshold host fallback matches stage resolution

- **WHEN** a session-reuse threshold resolves a fallback runtime from the detected LEAD host
- **AND** that host has no dispatch adapter
- **THEN** the fallback runtime SHALL be `claude`, matching the stage runtime fallback
- **AND** SHALL NOT be the non-dispatch-capable host
