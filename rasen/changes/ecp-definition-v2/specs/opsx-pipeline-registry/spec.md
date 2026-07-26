## ADDED Requirements

### Requirement: Registry resolution supports Definition v1 and v2 through preparation

The Pipeline registry SHALL accept unversioned, version 1, and version 2
definitions from project, user, and package layers through the same Definition
Module preparation seam. It SHALL preserve the winning source's authored
content while exposing normalized semantic definition, diagnostics, digests,
and capability status to consumers.

#### Scenario: v1 and v2 resolve from every registry layer

- **WHEN** a valid v1 or v2 definition wins normal project, user, or package precedence
- **THEN** registry load returns its authored version and one prepared semantic result
- **AND** preparation behavior does not vary by the filesystem layer or by Windows, macOS, or Linux path separators

#### Scenario: Registry rejects an unsupported version

- **WHEN** the winning source declares an unsupported explicit version
- **THEN** the registry fails closed with the preparation diagnostic and does not fall through to a lower-precedence definition of the same name

### Requirement: Registry capability status separates validity from execution

Registry list and detail results SHALL report the authored definition version,
whether preparation produced a valid plan, and whether an installed runtime can
execute that plan. A valid v2 plan SHALL remain non-executable in this slice
with an actionable stable reason code.

#### Scenario: Valid v2 definition is visible but non-executable

- **WHEN** a registry consumer lists or shows a valid version 2 Pipeline
- **THEN** it sees that the definition is valid and plan-capable
- **AND** it sees that execution is unavailable until the reconciler runtime lands

#### Scenario: Legacy capability remains explicit

- **WHEN** a version 1 Pipeline retains legacy execution support
- **THEN** registry capability reporting identifies legacy execution separately from v2 plan preparation
- **AND** it does not imply that the prepared plan has a reconciler owner

### Requirement: Built-in and Custom definitions use one registry path

Built-in and Custom Composite declarations SHALL be loaded, normalized,
validated, and compiled by the same registry-to-preparation integration.
Registry source provenance MAY differ, but declaration kind SHALL NOT select a
parallel parser or compiler.

#### Scenario: Equivalent declarations have parity

- **WHEN** equivalent built-in and Custom Composite definitions resolve from different registry layers
- **THEN** they produce the same semantic validation result and compiled plan digest
- **AND** only their registry provenance differs
