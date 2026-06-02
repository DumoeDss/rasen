# browse-integration Specification

## Purpose
Bundle and resolve the optional `browse` binary (with Playwright as an optional dependency) so skills can drive a browser when one is available.

## Requirements
### Requirement: Browse Directory Inclusion
The system SHALL include a `browse/` directory containing the headless Chromium browser CLI.

#### Scenario: Browse directory exists in package
- **WHEN** the OpenSpec package is installed
- **THEN** a `browse/` directory exists at the package root containing the browser CLI source and build output

#### Scenario: Browse directory contains required files
- **WHEN** the `browse/` directory is inspected
- **THEN** it contains the CLI source code and build configuration needed for the headless browser

### Requirement: Browse Binary Availability
The browse binary SHALL be available at `browse/dist/browse` relative to the package root.

#### Scenario: Browse binary exists at expected path
- **WHEN** the OpenSpec package build has completed
- **THEN** the browse binary is available at `browse/dist/browse` relative to the package root

#### Scenario: Browse binary is executable
- **WHEN** the browse binary at `browse/dist/browse` is inspected
- **THEN** it is a valid executable that can be invoked from the command line

### Requirement: Playwright as Optional Dependency
The system SHALL include Playwright as an optional dependency (optionalDependencies).

#### Scenario: Playwright listed in optionalDependencies
- **WHEN** the OpenSpec `package.json` is inspected
- **THEN** Playwright is listed under `optionalDependencies`

#### Scenario: Installation succeeds without Playwright
- **WHEN** the OpenSpec package is installed in an environment where Playwright cannot be installed
- **THEN** the installation succeeds and non-browser functionality works normally

#### Scenario: Installation succeeds with Playwright
- **WHEN** the OpenSpec package is installed in an environment that supports Playwright
- **THEN** Playwright is installed and browser functionality is available

### Requirement: Skill Browser Path Resolution
Skills that reference browser functionality SHALL use the browse binary path relative to the OpenSpec installation.

#### Scenario: Skill references browse binary path
- **WHEN** a built-in skill needs to invoke the headless browser
- **THEN** it references the browse binary using a path relative to the OpenSpec package root (`browse/dist/browse`)

#### Scenario: Browse path resolves correctly from skill context
- **WHEN** a skill is invoked and attempts to use the browse binary
- **THEN** the binary path resolves correctly regardless of the user's current working directory

