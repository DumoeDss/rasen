# skill-template-generator Specification

## Purpose
Provide a build-time generator that scans the skills directory and emits SKILL.md build products with path-variable substitution.

## Requirements
### Requirement: Generator Script Existence
The system SHALL include a `scripts/gen-skill-docs.ts` script that generates SKILL.md files from SKILL.md.tmpl templates.

#### Scenario: Generator script exists
- **WHEN** the OpenSpec source tree is inspected
- **THEN** the file `scripts/gen-skill-docs.ts` exists and is a valid TypeScript file

#### Scenario: Generator script is runnable
- **WHEN** `scripts/gen-skill-docs.ts` is executed via a TypeScript runner (bun or tsx)
- **THEN** the script runs without errors and produces output

### Requirement: Skills Directory Scanning
The generator SHALL scan the `skills/` directory for `.tmpl` files.

#### Scenario: Generator discovers template files
- **WHEN** the generator is run and `skills/review/SKILL.md.tmpl` exists
- **THEN** the generator processes that template file and produces `skills/review/SKILL.md`

#### Scenario: Generator skips directories without templates
- **WHEN** a skill directory contains only `SKILL.md` without a `.tmpl` file
- **THEN** the generator does not modify that directory's `SKILL.md`

#### Scenario: Generator processes multiple templates
- **WHEN** multiple skill directories contain `.tmpl` files
- **THEN** the generator processes all of them and produces a corresponding `SKILL.md` for each

### Requirement: Build Process Integration
The build process SHALL run the generator before TypeScript compilation.

#### Scenario: Generator runs during build
- **WHEN** the project build command is executed
- **THEN** the generator runs before the TypeScript compiler is invoked

#### Scenario: Build fails if generator fails
- **WHEN** the generator encounters an error during the build process
- **THEN** the build process fails and does not proceed to TypeScript compilation

### Requirement: Generated Files Are Build Products
Generated SKILL.md files SHALL be treated as build products; the source of truth is the `.tmpl` file.

#### Scenario: Manual edits are overwritten on rebuild
- **WHEN** a generated SKILL.md file is manually modified and the build process runs again
- **THEN** the generator overwrites the manual edits with content derived from the `.tmpl` source

#### Scenario: Template changes reflected in generated output
- **WHEN** a `.tmpl` file is modified and the generator is run
- **THEN** the corresponding `SKILL.md` file reflects the updated template content

### Requirement: Path Variable Substitution
The generator SHALL substitute path-related template variables during generation to adapt gstack paths to OpenSpec conventions.

#### Scenario: Home directory variable substitution
- **WHEN** a `.tmpl` file contains references to `~/.gstack/`
- **THEN** the generated SKILL.md contains `~/.openspec/`

#### Scenario: Project directory variable substitution
- **WHEN** a `.tmpl` file contains references to `.gstack/`
- **THEN** the generated SKILL.md contains `.openspec/`

