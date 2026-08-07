## MODIFIED Requirements

### Requirement: Runtime adapters declare independent capabilities

Rasen SHALL maintain one runtime adapter registry in which every runtime id declares independent context-probe, token-audit, and pipeline-dispatch capabilities. The shipped registry SHALL declare Claude and Codex capable of all three operations, Zed capable of audit only, and Oh My Pi capable of context probing only. A registry entry with no capability SHALL still be a recognized runtime for host identification and diagnostics.

#### Scenario: Shipped capability matrix is reported consistently

- **WHEN** a consumer requests the registered runtimes for context probing, token auditing, or pipeline dispatch
- **THEN** the probe set SHALL be `claude`, `codex`, and `omp`
- **AND** the audit set SHALL be `claude`, `codex`, and `zed`
- **AND** the dispatch set SHALL be `claude` and `codex`
- **AND** `omp` SHALL appear in the probe set only

#### Scenario: Capabilities remain independent

- **WHEN** a registered runtime supports token auditing but has no context-probe or pipeline-dispatch adapter
- **THEN** Rasen SHALL include it only in audit-capable runtime results
- **AND** SHALL reject it at probe and dispatch validation boundaries

#### Scenario: A registered runtime with no capability is still recognized

- **WHEN** a runtime is registered with every capability declared false
- **THEN** Rasen SHALL treat it as a recognized runtime for host identification, provenance, and diagnostic messages
- **AND** SHALL reject it wherever a probe-capable, audit-capable, or dispatch-capable runtime is required, with the existing actionable error naming the accepted runtimes for that operation

### Requirement: Runtime eligibility derives from the required capability

Every Rasen surface that validates a context-probe, token-audit, or pipeline-dispatch runtime SHALL derive its accepted values from the corresponding registry capability. This contract SHALL cover CLI validation, core schemas and types, configuration-key enum metadata and parsing, management services, and management wire types; those surfaces SHALL present the same capability-specific runtime set.

#### Scenario: Context probe accepts only probe-capable runtimes

- **WHEN** a user selects a runtime for `rasen agent context`
- **THEN** Claude, Codex, and Oh My Pi SHALL be accepted from the probe-capable registry set
- **AND** Zed or an unknown runtime SHALL be rejected with an actionable error naming the accepted probe runtimes

#### Scenario: Audit surfaces accept only audit-capable runtimes

- **WHEN** a runtime is selected through the audit CLI, native audit management service, report validation, or its management wire contract
- **THEN** Claude, Codex, and Zed SHALL be accepted from the audit-capable registry set
- **AND** a runtime that is registered but not audit-capable, including Oh My Pi, SHALL be rejected without preventing valid runtimes from remaining usable

#### Scenario: Pipeline surfaces accept only dispatch-capable runtimes

- **WHEN** a runtime is declared in pipeline YAML or written through `pipelines.<name>.runtimes.<role>`
- **THEN** Claude and Codex SHALL be accepted from the dispatch-capable registry set across schema, configuration, inspection, and wire surfaces
- **AND** a runtime that is registered but not dispatch-capable, including Zed and Oh My Pi, SHALL be rejected as not dispatch-capable

## ADDED Requirements

### Requirement: A session locator for a multi-layout runtime answers for every layout

A harness may store its sessions under more than one directory layout on the same machine, because the harness changed its own naming and migrated only opportunistically. When a runtime is known to have written more than one layout, its declared session locator SHALL answer for every layout that runtime has written, and SHALL confirm each candidate against the working directory the session itself recorded, so the located session is the newest one belonging to the requested directory rather than the newest one under a single derived name.

This requirement is scoped to multi-layout runtimes rather than every locator. A runtime that has only ever written one layout MAY derive its directory, and the shipped Claude locator does exactly that — it trusts a slug derived from the working directory and reads no recorded `cwd`. Generalizing the confirmation step to that locator is a real improvement (the slug is lossy: `/a/b.c` and `/a/b/c` derive the same name) but it changes a shipped runtime's behavior and is therefore owned by its own change, not by the addition of a harness.

#### Scenario: A locator considers every layout, not one derived name

- **GIVEN** a runtime is known to have written more than one session layout
- **AND** its sessions for one working directory exist under more than one of those layouts
- **WHEN** that runtime's session locator resolves the newest session for the working directory
- **THEN** every layout present SHALL be considered
- **AND** the newest qualifying session SHALL be selected regardless of which layout holds it

#### Scenario: A located session is confirmed against its own recorded directory

- **WHEN** a multi-layout runtime's session locator considers a candidate session
- **THEN** the candidate SHALL be accepted only if the working directory it records is the requested one
- **AND** a candidate recording a different working directory SHALL be rejected even when its layout name suggests a match

#### Scenario: Absence remains distinguishable from a wrong answer

- **WHEN** no session for the requested working directory exists under any layout
- **THEN** the locator SHALL report absence through the established environmental-absence path
- **AND** SHALL NOT return a session belonging to another directory or another layout's stale entry
