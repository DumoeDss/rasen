# project-config-diagnostics Specification

## Purpose
Reading a project config distinguishes absent (no file) from unreadable (file present but unparseable), so bootstrap and identity checks can diagnose a corrupt config rather than conflating it with a missing identity.
## Requirements
### Requirement: Project config reads distinguish absent from unreadable

A read of a project config file SHALL distinguish "the file does not exist" from "the file exists but cannot be parsed." The absent state SHALL be the ordinary signal that no config is present. The unreadable state SHALL carry a diagnostic naming the file and the parse error, so a caller never silently treats a corrupt config as a project with no identity.

#### Scenario: A missing config file returns absent

- **WHEN** the project config file does not exist
- **THEN** the read returns an absent result with no error or diagnostic

#### Scenario: An unparseable config file returns a diagnostic

- **WHEN** the project config file exists but contains invalid YAML
- **THEN** the read returns an unreadable result with a diagnostic naming the file and the parse error
- **AND** the result is not silently equivalent to absent

### Requirement: Path portability validation covers Windows root-relative and NT-namespace forms

A portability check that refuses machine-specific paths SHALL reject single-backslash root-relative paths (e.g., `\Users\foo`, which resolves to the current drive root on Windows) and NT-namespace paths (e.g., `\??\C:\foo`, `\\?\C:\foo`), in addition to the forms it already checks. The check SHALL work regardless of the platform it runs on, because the validated value may be committed on one platform and read on another.

#### Scenario: A single-backslash root-relative path is rejected

- **WHEN** a store membership hint value is `\Users\team\repo`
- **THEN** the portability check rejects it, whether the check runs on POSIX or Windows

#### Scenario: An NT-namespace path is rejected

- **WHEN** a store membership hint value is `\??\C:\Users\team\repo`
- **THEN** the portability check rejects it

#### Scenario: A legitimate relative path is accepted

- **WHEN** a store membership hint value is a permanent identity or a credential-free remote URL
- **THEN** the portability check accepts it
