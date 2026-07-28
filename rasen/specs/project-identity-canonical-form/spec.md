# project-identity-canonical-form Specification

## Purpose
Project identities are compared by their canonical (trimmed, lower-cased) form at every boundary, so case-differing identifiers that refer to the same project are treated as equal rather than misreported as stale, mismatched, or missing.
## Requirements
### Requirement: Project identity is compared in its normalized form at every boundary

Project identity SHALL be compared using its normalized form (trim + lowercase) at every boundary that checks whether two identity strings refer to the same project. This SHALL apply to comparisons in the project registry, project config, session execution context, frozen execution binding, and knowledge-owner resolution. A project identity that differs only in case or surrounding whitespace SHALL be recognized as the same project, not reported as stale, mismatched, or missing.

#### Scenario: An uppercase UUID in the config is recognized by the registry

- **WHEN** a project's config records its identity in uppercase and the registry records the same identity in lowercase
- **THEN** the knowledge-owner resolution recognizes them as the same project
- **AND** no stale-identity error is reported

#### Scenario: A case-differing UUID passes the frozen execution binding check

- **WHEN** a frozen execution binding records a project identity in one case and the session context carries the same identity in a different case
- **THEN** the frozen binding check recognizes them as the same project
- **AND** no mismatch error is reported

#### Scenario: A whitespace-padded UUID matches its trimmed form

- **WHEN** a project identity with surrounding whitespace is compared against the same identity without whitespace
- **THEN** they are recognized as the same project
