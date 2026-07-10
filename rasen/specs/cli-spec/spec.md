# cli-spec Specification

## Purpose
Define the Zod schema contract used to validate parsed spec structure at runtime. The `rasen spec` noun command group itself has been retired; use `rasen show <spec> --type spec`, `rasen list --specs`, and `rasen validate <spec>` instead.

## Requirements
### Requirement: JSON Schema Definition

The system SHALL define Zod schemas that accurately represent the spec structure for runtime validation.

#### Scenario: Schema validation

- **WHEN** parsing a spec into JSON
- **THEN** validate the structure using Zod schemas
- **AND** ensure all required fields are present
- **AND** provide clear error messages for validation failures
