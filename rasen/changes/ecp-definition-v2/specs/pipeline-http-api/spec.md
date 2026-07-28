## ADDED Requirements

### Requirement: Pipeline wire contracts discriminate Definition v1 and v2

Pipeline catalog, detail, draft-validation, save, and export responses SHALL
use a version-discriminated definition union and shared diagnostic and
capability shapes. Existing version 1 fields SHALL remain backward compatible;
version 2 SHALL carry its complete typed definition without flattening it into
the v1 stage DAG.

#### Scenario: Existing v1 client remains compatible

- **WHEN** an existing client requests detail for an unversioned or version 1 Pipeline
- **THEN** it receives the existing v1 definition fields and explicit normalized version information without a breaking field removal

#### Scenario: v2 detail remains a full definition

- **WHEN** a client requests detail for a version 2 Pipeline
- **THEN** it receives the complete v2 envelope, declarations, root graph, typed ports and outcomes, diagnostics, digests, and capability status
- **AND** no server-derived shadow graph replaces authored Definition data

### Requirement: Validation and save use authoritative preparation

The draft-validation and save endpoints SHALL prepare the submitted v1 or v2
definition against the same capability snapshot used by registry load. Errors
SHALL block save and use the shared path-addressed diagnostic contract; warnings
SHALL remain observable without changing semantic content.

#### Scenario: Server validation identifies a v2 graph error

- **WHEN** a v2 draft contains a port mismatch, recursion, nested loop, missing exit, invalid limit, forbidden capability, or impossible budget
- **THEN** validation returns the same stable code and JSON Pointer path produced by Definition preparation

#### Scenario: Save does not bypass preparation

- **WHEN** a client attempts to save a draft that preparation rejects
- **THEN** save returns those diagnostics and does not create or overwrite registry content

### Requirement: Version 2 save, detail, and export are semantic-lossless

A valid version 2 definition SHALL survive save, detail, and export without loss
of declarations, node identity, typed connections, limits, exits, outcomes, or
unexposed fields. Export SHALL prepare the selected source before producing a
package and SHALL fail without modifying the target when preparation fails.

#### Scenario: v2 round trip preserves plan meaning

- **WHEN** a valid v2 definition is saved, loaded by detail, and exported
- **THEN** each returned definition prepares to the same normalized semantic model and plan digest as the submitted draft

#### Scenario: Cross-platform export is equivalent

- **WHEN** the same prepared v2 Pipeline is exported to valid target paths on Windows, macOS, and Linux
- **THEN** package path handling uses the platform path model and package content has the same semantic definition and digest

### Requirement: API capability reporting prevents partial execution

Pipeline catalog and detail responses SHALL report definition validity, plan
availability, and executable runtime availability as separate fields. Before
the version 2 runtime spine is installed, v2 SHALL report non-executable and a
stable reason suitable for UI and CLI guidance.

#### Scenario: Consumer cannot mistake compiled for executable

- **WHEN** a valid v2 Pipeline has a compiled plan but no complete reconciler runtime
- **THEN** catalog and detail report plan availability as true and executable as false
- **AND** the reason does not advertise Operations controls or a partial run path
