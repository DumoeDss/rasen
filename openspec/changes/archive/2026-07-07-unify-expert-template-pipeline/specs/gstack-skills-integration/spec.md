## MODIFIED Requirements

### Requirement: Skill Source Directory

The system SHALL maintain a `skills/experts/` directory at the project package root containing, for each expert skill that has them, only its sidecar reference files (`.md` other than `SKILL.md`, and `.sh`). The complete skill prompt for each expert SHALL be an inline TypeScript template string in `src/core/templates/experts/<name>.ts`, not a `SKILL.md.tmpl` source or a generated `SKILL.md` build product.

#### Scenario: Expert source directory exists at package root

- **WHEN** the OpenSpec package source tree is inspected
- **THEN** a `skills/experts/` directory exists containing sidecar subdirectories for the experts that carry sidecar files

#### Scenario: No SKILL.md or template under the source directory

- **WHEN** a skill subdirectory such as `skills/experts/review/` is inspected
- **THEN** it SHALL NOT contain a `SKILL.md` or a `SKILL.md.tmpl` file
- **AND** it SHALL contain only sidecar reference files (e.g. `checklist.md`)

#### Scenario: Complete prompt lives in the TypeScript template

- **WHEN** the source of an expert skill originally named `review` is located
- **THEN** its complete prompt SHALL be the inline template string in `src/core/templates/experts/review.ts`
